/**
 * Verification harness for #TJL-5 Foundation.
 *
 * Runs the REAL engine/Engine.js, engine/registry.js, router/router.js,
 * engine/BaseDemo.js and the three real demo modules in Node, against a
 * faithful DOM/WebGL stub (verify/stub.mjs), and asserts the acceptance
 * criteria:
 *   1. Each demo LOADS CLEAN (init/mount run, no console error/warn).
 *   2. Each demo RUNS (300 frames of update() without throwing).
 *   3. Each demo is LEAK-FREE on unload:
 *        - engine stops (rafId -> null),
 *        - listenerCount returns to the engine baseline (demo listeners -> 0),
 *        - composer passes return to the 1 RenderPass baseline,
 *        - the scene graph is scrubbed empty.
 *   4. The registry contract holds: id -> conventional module path -> a file
 *      that actually exists; unknown ids resolve to null.
 *
 * This is a CORRECTNESS + LEAK audit, not a GPU render or perf measurement.
 * No fps is claimed (that is #TJL-10's job with a real GL context).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installStubs } from "./stub.mjs";
import { Engine } from "../engine/Engine.js";
import { Router } from "../router/router.js";
import { DEMOS, getDemo, resolveModule } from "../engine/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const FRAME_COUNT = 300;

// ---- capture real errors; keep benign stub warnings + expected router
//      status messages as informational (not "not-clean") evidence. ----
const errors = [];      // real console.error (e.g. router "Failed to load demo")
const warnings = [];    // console.warn (THREE benign extension warns, etc.)
const routerMessages = []; // expected gallery/router status lines
const origError = console.error;
const origWarn = console.warn;
const origLog = console.log;
const fmt = (...a) => a.map((x) => (typeof x === "string" ? x : x && x.stack ? x.stack : String(x))).join(" ");
console.error = (...a) => { errors.push(fmt(...a)); };
console.warn = (...a) => { warnings.push(fmt(...a)); };
const BENIGN = /extension not supported/i; // THREE warns on the stub's missing GL exts; not a demo defect.

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    origLog(`  ok   ${msg}`);
  } else {
    failures++;
    origLog(`  FAIL ${msg}`);
  }
}

// ---- install browser/DOM/WebGL stubs into globalThis ----
installStubs();
const g = globalThis;

const engine = new Engine({ container: g.__appEl });
const router = new Router(engine, (text) => {
  if (text) routerMessages.push(text); // expected gallery status, not an error
});

// Baseline BEFORE any demo loads: exactly the engine's own resize listener.
const BASELINE = engine.listenerCount;
origLog(`\n=== Foundation verification (real engine + real demos, DOM/GL stub) ===`);
origLog(`engine baseline listenerCount (resize listener only) = ${BASELINE}\n`);

// ---- 1-3: load / run / unload each real demo, assert invariants ----
const perDemo = {};
for (const demo of DEMOS) {
  origLog(`\n--- ${demo.id} ("${demo.title}") ---`);

  g.location.hash = `#/demo/${demo.id}`;
  await router.navigate();

  assert(engine.rafId !== null, `${demo.id}: engine running after load (rafId set)`);
  const loadedListenerCount = engine.listenerCount;
  perDemo[demo.id] = { loadedListenerCount, demoListeners: loadedListenerCount - BASELINE };

  // Drive a realistic frame sequence through the shared loop callback.
  // engine._cb(delta, elapsed) runs the demo's update() only — it does NOT
  // call composer.render(), so the GPU/shader path is intentionally skipped.
  let lastErr = null;
  for (let i = 0; i < FRAME_COUNT; i++) {
    try {
      engine._cb(1 / 60, i / 60);
    } catch (err) {
      lastErr = err;
      break;
    }
  }
  assert(lastErr === null, `${demo.id}: ${FRAME_COUNT} update() frames ran without throwing${lastErr ? ` (threw: ${lastErr.message})` : ""}`);

  // Route to the gallery (empty hash) -> router calls engine.unload().
  g.location.hash = "";
  await router.navigate();

  assert(engine.rafId === null, `${demo.id}: engine stopped after unload (rafId null)`);
  assert(
    engine.listenerCount === BASELINE,
    `${demo.id}: listenerCount back to baseline ${BASELINE} (was ${loadedListenerCount} while loaded; demo listeners now ${engine.listenerCount - BASELINE})`,
  );
  assert(
    engine.composer.passes.length === 1,
    `${demo.id}: composer passes back to 1 RenderPass (got ${engine.composer.passes.length})`,
  );
  assert(
    engine.scene.children.length === 0,
    `${demo.id}: scene graph scrubbed empty after unload (children=${engine.scene.children.length})`,
  );
  perDemo[demo.id].unloadedListenerCount = engine.listenerCount;
  perDemo[demo.id].composerPassesAfter = engine.disposedPasses;
}

// ---- 4: registry contract: id -> conventional module path -> real file ----
origLog(`\n--- registry contract (add a demo = file + one manifest line) ---`);
for (const demo of DEMOS) {
  const modUrl = demo.module;
  assert(modUrl && modUrl.endsWith(`/demos/${demo.id}.js`), `${demo.id}: module resolves to conventional path ${modUrl.split("/").pop()}`);
  const onDisk = path.join(repoRoot, "demos", `${demo.id}.js`);
  assert(fs.existsSync(onDisk), `${demo.id}: module file exists on disk (demos/${demo.id}.js)`);
}
assert(typeof getDemo("frontier") === "object", `getDemo("frontier") resolves`);
assert(getDemo("does-not-exist") === null, `getDemo("does-not-exist") -> null (unknown ids are safe)`);
assert(resolveModule("shaders").endsWith("/demos/shaders.js"), `resolveModule("shaders") -> conventional demos/shaders.js (future demo: drop a file + one line)`);

// ---- report ----
origLog(`\n=== per-demo summary ===`);
for (const d of Object.keys(perDemo)) {
  const r = perDemo[d];
  origLog(
    `  ${d.padEnd(9)} loadedListeners=${r.loadedListenerCount} ` +
      `(demo-tracked=${r.demoListeners}) | afterUnload listenerCount=${r.unloadedListenerCount} ` +
      `(demo-tracked=${r.unloadedListenerCount - BASELINE}) | passesDisposed=${r.composerPassesAfter}`,
  );
}

console.error = origError;
console.warn = origWarn;

const realErrors = errors;
const benignWarnings = warnings.filter((w) => BENIGN.test(w));
const otherWarnings = warnings.filter((w) => !BENIGN.test(w));

origLog(`\n=== evidence: real console.error: ${realErrors.length} ===`);
for (const c of realErrors) origLog(`  - ${c}`);
origLog(`=== benign THREE stub warnings (missing GL extensions; expected): ${benignWarnings.length} ===`);
for (const c of benignWarnings) origLog(`  - ${c}`);
origLog(`=== other warnings (unexpected): ${otherWarnings.length} ===`);
for (const c of otherWarnings) origLog(`  - ${c}`);
origLog(`=== expected router/gallery status messages (info, not errors): ${routerMessages.length} ===`);
for (const c of routerMessages) origLog(`  - ${c}`);

if (failures > 0) {
  origLog(`\nRESULT: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
} else if (realErrors.length > 0 || otherWarnings.length > 0) {
  origLog(`\nRESULT: PARTIAL PASS (assertions passed, but ${realErrors.length} real error / ${otherWarnings.length} unexpected warning — see above)`);
  process.exit(2);
} else {
  origLog(`\nRESULT: PASS — all assertions passed; zero real console errors; all three demos load clean, run ${FRAME_COUNT} frames, and unload leak-free (listenerCount->baseline, passes->1 RenderPass, scene scrubbed empty)`);
  process.exit(0);
}
