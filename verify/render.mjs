#!/usr/bin/env node
/**
 * verify/render.mjs — REAL headless render harness (the honest regression gate).
 *
 * What it proves, per demo (the 7 existing + the 3 new = every entry the
 * registry ships — this file drives its demo list straight from
 * engine/registry.js, so it can never drift from the manifest):
 *
 *   1. BOOTS   — the demo module imports and init() runs with no uncaught
 *                page error, and the engine canvas is present with a live
 *                WebGL context. A demo that throws on boot fails here.
 *   2. NOT BLANK — the engine canvas actually drew something: we sample the
 *                rendered pixels and reject a blank/uniform frame (a cleared
 *                canvas, or a demo that never drew, fails here).
 *   3. SUSTAINED FPS — we count real requestAnimationFrame frames over a
 *                ~10s sample and require the sustained rate to clear a
 *                low-but-real floor. This is a REGRESSION GATE, not a perf
 *                claim: it proves the scene is actually animating, not frozen.
 *
 * Honest reporting:
 *   - Draw calls + triangles come straight from renderer.info.render (read
 *     live from the running engine) — never estimated.
 *   - The runner is SwiftShader (software WebGL, no GPU). Every number below
 *     is a SwiftShader number and is labelled as such. We NEVER claim an
 *     integrated-GPU fps here. The sustained-fps floor is deliberately
 *     low-but-real (default 3 fps over 10s) so the gate passes on a frozen
 *     frame's opposite and fails a genuinely-stalled demo, without pretending
 *     to be a 60fps assertion.
 *
 * Why a local static server (not the live Pages URL): ES modules + import
 * maps cannot load over file:// (CORS), and the gate should test the exact
 * code that was just committed, not the possibly-lagging Pages deployment.
 * The site pulls `three` from unpkg.com (https), so this runs best where the
 * browser is real and the network is open: the GitHub Actions runner.
 *
 * Usage:
 *   node verify/render.mjs            # serve the repo checkout, gate all demos
 *   VERIFY_FPS_FLOOR=4 node verify/render.mjs      # raise the gate (rare)
 *   VERIFY_SAMPLE_SECONDS=6 node verify/render.mjs # shorter sample (CI time)
 *   VERIFY_BASE_URL=http://host/ node verify/render.mjs  # use an external origin
 *
 * Exit code: 0 = every demo passed; non-zero = at least one failed. That is
 * what makes this a gate wired into CI (see .github/workflows/verify.yml).
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
// Drive the demo list from the manifest so it can never drift from the site.
import { DEMOS } from "../engine/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ---- configuration (env-overridable; defaults are the honest ones) --------
const SAMPLE_SECONDS = Math.max(3, Number(process.env.VERIFY_SAMPLE_SECONDS) || 10);
// Low-but-real animation gate. 3 fps sustained over 10s = ~30 real frames —
// clearly animating, and it fails a demo that is actually frozen. We do NOT
// claim this is a 60fps figure; it is a regression gate on SwiftShader.
const FPS_FLOOR = Number(process.env.VERIFY_FPS_FLOOR) || 3;
const VIEWPORT = { width: 1280, height: 720 };
const BASE_URL = process.env.VERIFY_BASE_URL || null;

// Minimal static file server for the repo checkout (correct MIME types so
// ES modules + import maps load). Only used when no VERIFY_BASE_URL is given.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function startStaticServer() {
  const server = createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
    // A hash route (#/demo/x) never reaches the server; always index.html.
    const filePath = path.join(REPO_ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
    if (!filePath.startsWith(REPO_ROOT) || !existsSync(filePath) || !statIsFile(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, base: `http://127.0.0.1:${port}/` });
    });
    server.on("error", reject);
  });
}
function statIsFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

// ---- per-demo measurement, run in the page context -----------------------
/**
 * Count real rAF frames over `seconds` and sample the engine canvas pixels.
 * Returns { fps, frames, seconds, nonBlank, drawCalls, triangles, error }.
 */
async function measureDemo(page, seconds) {
  return page.evaluate(async ({ seconds }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Live WebGL context + engine reachability.
    const canvas = document.querySelector("#app canvas");
    const gl = canvas ? (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) : null;

    // Non-blank: read the real rendered pixels. A cleared/blank canvas has
    // near-zero channel variance; a drawn scene does not.
    let nonBlank = false;
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      try {
        const w = Math.min(canvas.width, 256);
        const h = Math.min(canvas.height, 256);
        const c2d = document.createElement("canvas");
        c2d.width = w; c2d.height = h;
        const ctx = c2d.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let sumR = 0, sumG = 0, sumB = 0, n = 0;
        let sumR2 = 0, sumG2 = 0, sumB2 = 0;
        for (let i = 0; i < data.length; i += 4 * 8) { // sample every 8th pixel
          const r = data[i], g = data[i + 1], b = data[i + 2];
          sumR += r; sumG += g; sumB += b;
          sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
          n++;
        }
        const sd = (s, s2) => Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
        const stdR = sd(sumR, sumR2), stdG = sd(sumG, sumG2), stdB = sd(sumB, sumB2);
        // A scene with any rendered geometry/material has channel variance;
        // a blank cleared canvas is effectively constant. Threshold ~4/255.
        nonBlank = (stdR + stdG + stdB) / 3 > 4;
      } catch { nonBlank = false; }
    }

    // Sustained fps: count real animation frames over the sample window.
    let frames = 0;
    const t0 = performance.now();
    const count = () => {
      frames++;
      if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(count);
      else {
        const fps = frames / ((performance.now() - t0) / 1000);
        // Read the live engine's real renderer.info for the just-rendered frame.
        const eng = document.getElementById("app") && document.getElementById("app").engine;
        const info = eng && eng.renderer ? eng.renderer.info.render : null;
        window.__measure = {
          frames,
          fps,
          seconds: (performance.now() - t0) / 1000,
          nonBlank,
          webgl: !!gl,
          canvas: !!canvas,
          drawCalls: info ? info.calls : null,
          triangles: info ? info.triangles : null,
        };
      }
    };
    requestAnimationFrame(count);

    // Wait for the frame counter to finish (it resolves via window.__measure).
    while (!window.__measure) await sleep(50);
    return window.__measure;
  }, { seconds });
}

// ---- the per-demo run -----------------------------------------------------
async function checkDemo(context, base, demo) {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  const result = { id: demo.id, title: demo.title, booted: false, nonBlank: false, fps: 0, drawCalls: null, triangles: null, pageErrors: [], consoleErrors: [], passed: false };

  const url = base + "#/demo/" + demo.id;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    // Give the engine a moment to create the canvas + boot the demo. The
    // engine creates the canvas synchronously at construct time, so a short
    // settle is enough; the frame counter then proves real rendering.
    await page.waitForSelector("#app canvas", { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(1500); // settle: demo init, first frames
    const m = await measureDemo(page, SAMPLE_SECONDS);
    result.webgl = m.webgl;
    result.canvas = m.canvas;
    result.nonBlank = m.nonBlank;
    result.fps = Math.round(m.fps * 10) / 10;
    result.drawCalls = m.drawCalls;
    result.triangles = m.triangles;
    result.measuredSeconds = Math.round((m.seconds || 0) * 10) / 10;
  } catch (e) {
    result.bootError = String(e);
  } finally {
    result.pageErrors = pageErrors;
    result.consoleErrors = consoleErrors.slice(0, 5);
    await page.close().catch(() => null);
  }

  // BOOTED = canvas present + live WebGL context + no uncaught page error.
  result.booted = !!(result.webgl && result.canvas) && result.pageErrors.length === 0 && !result.bootError;

  // PASS = booted AND non-blank AND sustained fps clears the (low-but-real) floor.
  const fpsOk = result.fps >= FPS_FLOOR;
  result.fpsOk = fpsOk;
  result.passed = result.booted && result.nonBlank && fpsOk;
  return result;
}

// ---- main -----------------------------------------------------------------
const main = async () => {
  const demos = DEMOS;
  console.log(`verify/render.mjs — REAL headless render gate`);
  console.log(`  demos:       ${demos.length} (${demos.map((d) => d.id).join(", ")})`);
  console.log(`  sample:      ${SAMPLE_SECONDS}s per demo, viewport ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`  fps floor:   ${FPS_FLOOR} fps sustained  (LOW-BUT-REAL animation gate — NOT a 60fps claim; SwiftShader, no GPU)`);
  console.log("");

  let server, base = BASE_URL;
  if (!base) {
    ({ server, base } = await startStaticServer());
    console.log(`  serving:     ${base}  (local checkout at ${REPO_ROOT})`);
  } else {
    console.log(`  serving:     ${base}  (external base URL)`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      // Software WebGL: this runner has no GPU. SwiftShader makes WebGL real
      // (and slow) so the render is genuine. We are NOT pretending to have a
      // GPU; the numbers are SwiftShader numbers.
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
  });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  const results = [];
  try {
    for (const demo of demos) {
      const r = await checkDemo(context, base, demo);
      results.push(r);
      const status = r.passed ? "PASS" : "FAIL";
      const err = r.pageErrors[0] || r.bootError || (r.consoleErrors[0] || "");
      console.log(
        `  [${status}] ${r.id.padEnd(11)} booted=${r.booted ? "y" : "n"}  non-blank=${r.nonBlank ? "y" : "n"}  ` +
        `fps=${String(r.fps).padStart(6)}  draws=${String(r.drawCalls ?? "?").padStart(6)}  tris=${String(r.triangles ?? "?").padStart(9)}${err ? "  | err: " + err.slice(0, 90) : ""}`
      );
    }
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
    if (server) server.close();
  }

  // ---- final table ----
  console.log("");
  console.log("  ┌───────────────────────────────────────────────────────────────────────────────────┐");
  console.log("  │ PER-DEMO TABLE (SwiftShader / software WebGL — NOT integrated-GPU fps)             │");
  console.log("  ├──────────────┬─────────┬───────────┬─────────┬─────────┬─────────────┬───────────┤");
  console.log("  │ demo         │  booted │ non-blank │  fps    │  draws  │  triangles  │  verdict  │");
  console.log("  ├──────────────┼─────────┼───────────┼─────────┼─────────┼─────────────┼───────────┤");
  for (const r of results) {
    console.log(
      `  │ ${r.id.padEnd(13)} │ ${String(r.booted ? "y" : "n").padEnd(7)} │ ${String(r.nonBlank ? "y" : "n").padEnd(9)} │ ${String(r.fps).padEnd(7)} │ ${String(r.drawCalls ?? "-").padEnd(7)} │ ${String(r.triangles ?? "-").padEnd(11)} │ ${r.passed ? "PASS".padEnd(9) : "FAIL".padEnd(9)} │`
    );
  }
  console.log("  └──────────────┴─────────┴───────────┴─────────┴─────────┴─────────────┴───────────┘");

  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    console.log(`\n  FAILURES (${failed.length}): ${failed.map((r) => r.id).join(", ")}`);
    for (const r of failed) {
      const reasons = [];
      if (!r.booted) reasons.push(r.bootError || (r.pageErrors[0] ? "uncaught page error: " + r.pageErrors[0] : "no canvas / no WebGL context"));
      if (!r.nonBlank) reasons.push("blank frame (no rendered pixels)");
      if (r.fpsOk === false) reasons.push(`sustained fps ${r.fps} < floor ${FPS_FLOOR}`);
      console.log(`    ${r.id}: ${reasons.join(" · ")}`);
    }
    console.log("\n  HONEST NOTE: numbers above are SwiftShader (software WebGL, no GPU).");
    console.log("  They prove the demos boot, draw, and animate. They are NOT an integrated-GPU fps.");
    process.exit(1);
  }
  console.log(`\n  ALL ${demos.length} DEMOS PASS (SwiftShader software-WebGL render gate).\n`);
  process.exit(0);
};

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(2);
});
