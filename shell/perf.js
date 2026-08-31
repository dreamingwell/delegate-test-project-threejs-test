/**
 * shell/perf.js — honest, on-demand performance readout.
 *
 * The five shared shell systems, part 4. Reads the real numbers, never
 * estimates them:
 *
 *   - fps:         computed from the engine's REAL rAF clock (delta-timing
 *                  over a short window, exponential smoothing) — the engine
 *                  accumulates frame count + delta each loop in _perf and
 *                  exposes readPerfTick(), which resets the window. This is
 *                  NOT a fixed value and NOT a per-frame counter read from a
 *                  constant; it reflects the viewer's actual frame time.
 *   - draw calls:  renderer.info.render.calls, read straight from the
 *                  renderer after this frame's composer render (three resets
 *                  renderer.info every render, so this is this frame's value).
 *   - triangles:   renderer.info.render.triangles, same source.
 *
 * The readout is OPT-IN (off by default, matching the engine's own HUD): a
 * "Perf" toggle in the shell toolbar shows/hides it. The toggle state is
 * part of the deep-link state (`?perf=1`).
 *
 * Honesty note: these numbers are for the VIEWER's machine (the browser
 * they open the demo in). They are never a claim about any other GPU.
 */

/** @type {{enabled:boolean}} */
const state = { enabled: false };

let _engine = null;

/**
 * @param {import("../engine/Engine.js").Engine} engine the shared engine.
 */
export function init(engine) {
  _engine = engine;
  state.enabled = false;
}

/**
 * Show or hide the readout element.
 * @param {boolean} enabled
 */
export function setEnabled(enabled) {
  state.enabled = !!enabled;
  if (!_engine) return;
  const el = document.getElementById("perf-readout");
  if (!el) return;
  el.style.display = enabled ? "block" : "none";
}

/** @returns {boolean} current toggle state. */
export function isEnabled() {
  return state.enabled;
}

/**
 * Refresh the readout DOM from the engine's real numbers. Called once per
 * frame by the shell's rAF hook (no-op when disabled).
 */
export function update() {
  if (!state.enabled || !_engine) return;
  const el = document.getElementById("perf-readout");
  if (!el) return;
  const { fps, calls, triangles } = _engine.readPerfStats();
  el.textContent = `${fps.toFixed(0)} fps · ${calls} draws · ${triangles.toLocaleString()} tris`;
}
