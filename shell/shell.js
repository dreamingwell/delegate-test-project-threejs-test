/**
 * shell/shell.js — the persistent app chrome (system 1) + orchestrator for
 * the five shared shell systems.
 *
 * It builds, once, a fixed toolbar (brand + the current demo's NAME, always
 * visible), a nav row listing EVERY registered demo (driven by
 * engine/registry.js, so it stays in sync automatically), an app-level
 * controls panel (the panel belongs to the app, not to any single demo), a
 * Low/Med/High quality select, and a Perf toggle. It then wires the other
 * four systems in:
 *
 *   - controls.js  -> renders the active demo's descriptor into the panel.
 *   - urlstate.js  -> the URL is the state: read on load, write on every
 *                     control/quality/perf change (history.replaceState).
 *   - perf.js      -> real fps + renderer.info draw calls/triangles, on
 *                     demand (the engine samples these in its rAF loop).
 *   - quality.js   -> Low/Med/High change the pixel ratio + the bloom pass
 *                     strength so the scene VISIBLY changes; the tier is in
 *                     the URL.
 *
 * Integration is NON-INVASIVE: the shell wraps engine.load() (it does not
 * replace the router) so that after the router loads a demo it (a) reads the
 * demo's optional `shell` contract (controls descriptor + the params the demo
 * applied to the URL on load), (b) renders the panel, (c) updates the current
 * name, and (d) re-applies the global quality tier so any bloom pass the new
 * demo just added gets scaled. The router remains authoritative for routing.
 *
 * Backward compatibility: the 7 existing demos export init() with no `shell`
 * field. They work unchanged — they simply gain the global nav, the current
 * name, the global quality/perf controls, and an empty (but present) panel.
 */

import { DEMOS } from "../engine/registry.js";
import { renderControls } from "./controls.js";
import { parseHash, setHash } from "./urlstate.js";
import {
  init as initPerf,
  setEnabled as setPerf,
} from "./perf.js";
import {
  initQuality,
  applyTier,
  DEFAULT_TIER,
  QUALITY_TIERS,
} from "./quality.js";

/**
 * Boot the shell. Idempotent (no-op if the chrome is already present).
 *
 * @param {import("../engine/Engine.js").Engine} engine the shared engine.
 * @param {import("../router/router.js").Router} router the existing router
 *   (kept authoritative for routing; the shell observes via a load wrapper).
 * @returns {{ serialize: Function, setQuality: Function, setPerf: Function }}
 */
export function bootShell(engine, router) {
  if (document.getElementById("shell")) return; // already booted

  // ---- global state (persists across demos; the URL is its source of
  //         truth on load, and this mirrors it in-memory) ----
  let currentId = null;
  let currentControls = [];  // active demo's controls descriptor
  let teardownControls = null;
  let appliedParams = {};    // demo params the shell will serialize to the URL
  let quality = DEFAULT_TIER;
  let perfOn = false;

  // ---- build the chrome once ----
  const chrome = buildChrome();
  const { navRow, nameEl, qualitySel, perfBtn, panelBody, readout } = chrome;

  // ---- init the subsystems ----
  initPerf(engine);
  initQuality(engine);

  // Perf readout: the engine samples the REAL rAF clock + renderer.info in
  // its rAF loop (after composer.render) and calls this every frame.
  engine.onFrame(() => {
    if (!perfOn) return;
    const { fps, calls, triangles } = engine.readPerfStats();
    readout.textContent =
      `${Math.round(fps)} fps · ${calls} draws · ${triangles.toLocaleString()} tris`;
    readout.dataset.fps = String(Math.round(fps));
  });

  // ---- serialize the current global state into the URL (no history spam) ----
  function serialize() {
    if (!currentId) return;
    setHash({
      id: currentId,
      params: appliedParams,
      quality: quality !== DEFAULT_TIER ? quality : null,
      perf: perfOn,
    });
  }

  // ---- render the active demo's descriptor into the app-level panel ----
  function renderPanel() {
    if (teardownControls) teardownControls();
    panelBody.textContent = "";
    if (!currentControls || !currentControls.length) {
      const note = document.createElement("div");
      note.className = "ctl-empty";
      note.textContent = "No live controls on this demo.";
      panelBody.appendChild(note);
      teardownControls = null;
      return;
    }
    teardownControls = renderControls(currentControls, panelBody, (key, value) => {
      appliedParams[key] = value;
      serialize();
    });
  }

  // ---- reflect the current demo's name (always visible) ----
  function updateName() {
    const demo = DEMOS.find((d) => d.id === currentId);
    nameEl.textContent = demo ? demo.title : "Gallery";
    nameEl.dataset.active = demo ? "true" : "false";
    for (const a of navRow.querySelectorAll(".shell-nav-item")) {
      a.classList.toggle("active", a.dataset.id === currentId);
    }
  }

  // ---- global quality: apply + reflect in the select ----
  function applyQualityNow() {
    applyTier(engine, quality);
    qualitySel.value = quality;
  }

  // ---- global perf toggle: reflect + show/hide the readout ----
  function applyPerfNow() {
    setPerf(perfOn);
    perfBtn.classList.toggle("on", perfOn);
    perfBtn.textContent = perfOn ? "Perf: on" : "Perf: off";
    readout.style.display = perfOn ? "block" : "none";
  }

  // ---- the toolbar/nav controls (global, part of the app) ----
  for (const a of navRow.querySelectorAll(".shell-nav-item")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = `#/demo/${a.dataset.id}`; // router handles the load
    });
  }
  qualitySel.addEventListener("change", () => {
    const q = qualitySel.value;
    if (!QUALITY_TIERS[q]) return;
    quality = q;
    applyQualityNow();
    serialize();
  });
  perfBtn.addEventListener("click", () => {
    perfOn = !perfOn;
    applyPerfNow();
    serialize();
  });

  // ---- keep the shell in step with the router via a load wrapper. ----
  // The router does `await this.engine.load(demo.module)`. Wrap it so the
  // shell observes every load, reads the demo's optional `shell` contract,
  // and re-applies the global state. The router's return value (and routing
  // authority) is preserved.
  const origLoad = engine.load.bind(engine);
  engine.load = async (modulePath) => {
    const handle = await origLoad(modulePath);
    // Read the pending URL state AFTER the load: by now the hashchange
    // dispatch is complete (the shell's onHashChange has set
    // _pendingUrlState for this URL), so this reflects the URL we just
    // loaded, not a stale prior value.
    const pending = engine._pendingUrlState || { params: {}, quality: null, perf: false, perfPresent: false };

    // Resolve the loaded demo id: registry match first, then the pending URL.
    const byModule = DEMOS.find((d) => d.module === modulePath);
    currentId = (byModule && byModule.id) || pending.id || currentId;

    const shell = (handle && handle.shell) || {};
    currentControls = shell.controls || [];
    appliedParams = shell.appliedParams || {};

    // Quality: the URL wins on load (it's the state); otherwise keep the
    // in-memory global. Then re-apply so the new demo's bloom pass is scaled.
    if (pending.quality && QUALITY_TIERS[pending.quality]) quality = pending.quality;
    applyQualityNow();

    // Perf: explicit ?perf= in the URL wins on load; otherwise keep state.
    if (pending.perfPresent) perfOn = pending.perf;
    applyPerfNow();

    renderPanel();
    updateName();
    serialize();
    return handle;
  };

  // ---- hashchange: publish the URL state to the engine BEFORE the demo's
  //      init() runs (the router's handler starts the async load; the demo
  //      reads engine._pendingUrlState during mount). ----
  window.addEventListener("hashchange", () => {
    engine._pendingUrlState = parseHash(location.hash);
  });

  // ---- boot: read the initial URL, set up globals, render the empty panel.
  //      The router's own navigate() runs in app.js and loads the demo, so
  //      here we only set up globals + the (still empty) chrome. ----
  const s0 = parseHash(location.hash);
  engine._pendingUrlState = s0;
  if (s0.quality && QUALITY_TIERS[s0.quality]) quality = s0.quality;
  perfOn = !!s0.perf;
  applyQualityNow();
  applyPerfNow();
  renderPanel();
  updateName();

  return {
    serialize,
    setQuality: (q) => { if (QUALITY_TIERS[q]) { quality = q; applyQualityNow(); serialize(); } },
    setPerf: (on) => { perfOn = !!on; applyPerfNow(); serialize(); },
  };
}

// ---------------------------------------------------------------------------
// Chrome construction (real DOM; this module is only loaded in a browser).
// ---------------------------------------------------------------------------
function buildChrome() {
  const shell = document.createElement("div");
  shell.id = "shell";

  // ---- top bar: brand | current name | quality + perf ----
  const bar = document.createElement("div");
  bar.className = "shell-bar";

  const brand = document.createElement("a");
  brand.className = "shell-brand";
  brand.href = "#";
  brand.textContent = "Threejs Lab";
  brand.addEventListener("click", (e) => {
    e.preventDefault();
    location.hash = "";
  });

  const nameWrap = document.createElement("div");
  nameWrap.className = "shell-name-wrap";
  const nameLabel = document.createElement("span");
  nameLabel.className = "shell-name-label";
  nameLabel.textContent = "Now";
  const nameEl = document.createElement("span");
  nameEl.className = "shell-name";
  nameEl.textContent = "Gallery";
  nameWrap.appendChild(nameLabel);
  nameWrap.appendChild(nameEl);

  const right = document.createElement("div");
  right.className = "shell-right";
  const qualityWrap = document.createElement("label");
  qualityWrap.className = "shell-qwrap";
  const qlabel = document.createElement("span");
  qlabel.className = "shell-qwrap-label";
  qlabel.textContent = "Quality";
  const qualitySel = document.createElement("select");
  qualitySel.className = "shell-quality";
  for (const key of ["low", "medium", "high"]) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = QUALITY_TIERS[key].label;
    qualitySel.appendChild(o);
  }
  qualityWrap.appendChild(qlabel);
  qualityWrap.appendChild(qualitySel);

  const perfBtn = document.createElement("button");
  perfBtn.className = "shell-perf";
  perfBtn.textContent = "Perf: off";

  right.appendChild(qualityWrap);
  right.appendChild(perfBtn);

  bar.appendChild(brand);
  bar.appendChild(nameWrap);
  bar.appendChild(right);

  // ---- nav: one entry per registered demo (registry-driven) ----
  const navRow = document.createElement("nav");
  navRow.className = "shell-nav";
  for (const demo of DEMOS) {
    const a = document.createElement("a");
    a.className = "shell-nav-item";
    a.dataset.id = demo.id;
    a.href = `#/demo/${demo.id}`;
    a.textContent = demo.title;
    navRow.appendChild(a);
  }

  // ---- app-level controls panel (head + body; renderControls fills body) ----
  const panel = document.createElement("aside");
  panel.className = "shell-panel";
  const panelHead = document.createElement("div");
  panelHead.className = "shell-panel-head";
  panelHead.textContent = "Live controls";
  const panelBody = document.createElement("div");
  panelBody.className = "shell-panel-body";
  panel.appendChild(panelHead);
  panel.appendChild(panelBody);

  // ---- perf readout (opt-in; hidden until toggled) ----
  const readout = document.createElement("div");
  readout.id = "perf-readout";
  readout.style.display = "none";
  readout.textContent = "0 fps · 0 draws · 0 tris";

  shell.appendChild(bar);
  shell.appendChild(navRow);
  shell.appendChild(panel);
  document.body.appendChild(shell);
  document.body.appendChild(readout);

  return { bar, navRow, nameEl, qualitySel, perfBtn, panelBody, readout };
}
