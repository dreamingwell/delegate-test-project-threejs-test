/**
 * The exact list of demos this gallery ships. Each entry:
 *   - id: used in deep links (#/demo/<id>) and as the dictionary key.
 *   - title: human-readable name shown in the gallery list.
 *   - module: path (relative to repo root) to the ES module implementing
 *     the demo contract: `export function init(container) { return { update, destroy }; }`.
 *
 * Adding a demo module file is the job of that demo's own card; this
 * registry entry is added ahead of time so the router/gallery never need
 * edits later. horizon's module does not exist yet (lands on #TJDG-7) —
 * that is expected; the router surfaces an import failure for it until then.
 */
// Paths are resolved relative to this file (not the caller) so router.js can
// dynamic-import(demo.module) regardless of which directory it lives in.
export const DEMOS = [
  { id: "frontier", title: "Frontier", module: new URL("../demos/frontier.js", import.meta.url).href },
  { id: "local", title: "Local", module: new URL("../demos/local.js", import.meta.url).href },
  { id: "horizon", title: "Horizon", module: new URL("../demos/horizon.js", import.meta.url).href },
];

export function getDemo(id) {
  return DEMOS.find((d) => d.id === id) || null;
}
