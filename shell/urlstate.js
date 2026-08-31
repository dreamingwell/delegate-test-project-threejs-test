/**
 * shell/urlstate.js — the URL IS the state (no localStorage).
 *
 * The five shared shell systems, part 3. URL shape:
 *
 *     #/demo/<id>?<param>=<value>&quality=<tier>&perf=1
 *
 * The existing hash router already handles `#/demo/<id>`; this module
 * EXTENDS it (it does not replace it) so the hash also carries the
 * query-string state. It never touches anything before `#`.
 *
 * Behaviour:
 *   - READ on load: parse the current hash into { id, params, quality, perf }.
 *     The shell applies `params` OVER the demo's declared default control
 *     values and calls each control's live onInput so the scene matches the
 *     URL. A pasted URL (e.g. #/demo/surface?metalness=0.7&quality=high)
 *     reopens exactly what the sender saw.
 *   - WRITE on every change (control, quality, perf): serialize the current
 *     state into the hash with history.replaceState — no history spam, no
 *     back/forward entries.
 *   - Round-trip stable: change -> URL updates -> reload -> identical state.
 *
 * This module is pure string <-> object (no DOM), so it is unit-testable in
 * Node and safe to import from the shell.
 */

export const RESERVED_KEYS = ["quality", "perf"];

/**
 * Parse a hash string like "#/demo/<id>?a=1&quality=high&perf=1" into a
 * normalized state object.
 *
 * @param {string} hash
 * @returns {{ id: string|null, params: Record<string,string>,
 *             quality: string|null, perf: boolean }}
 */
export function parseHash(hash) {
  const out = { id: null, params: {}, quality: null, perf: false, perfPresent: false };
  const h = hash || "";
  const m = h.match(/^#\/demo\/([^?#]+)/);
  if (!m) return out;
  out.id = decodeURIComponent(m[1]);
  const qIndex = h.indexOf("?", m.index);
  if (qIndex === -1) return out; // no query string
  const qs = h.slice(qIndex + 1);
  if (!qs) return out;
  for (const pair of qs.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const k = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
    const v = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
    if (k === "quality") out.quality = v;
    else if (k === "perf") {
      out.perf = v === "1" || v === "true";
      out.perfPresent = true;
    }
    else out.params[k] = v;
  }
  return out;
}

/**
 * Build a hash from a state object: "#/demo/<id>?<params>&quality=<t>&perf=1".
 * @param {{ id: string|null, params?: Record<string,string|number>,
 *           quality?: string|null, perf?: boolean }} state
 */
export function buildHash({ id, params = {}, quality = null, perf = false }) {
  if (!id) return "#";
  const q = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  if (quality) q.push(`quality=${encodeURIComponent(quality)}`);
  if (perf) q.push("perf=1");
  return `#/demo/${encodeURIComponent(id)}${q.length ? "?" + q.join("&") : ""}`;
}

/**
 * Serialize a state object into the URL with history.replaceState (no
 * history spam). @param same shape as buildHash.
 */
export function setHash(state) {
  const h = buildHash(state);
  if (typeof history !== "undefined" && typeof history.replaceState === "function") {
    try {
      history.replaceState(null, "", h);
      return;
    } catch {
      /* fall through to location.hash (rare: cross-origin document, etc.) */
    }
  }
  location.hash = h;
}
