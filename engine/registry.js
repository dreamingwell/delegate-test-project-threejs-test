/**
 * The manifest: the single, explicit list of demos this gallery ships.
 *
 * CONTRACT — adding a demo is "drop a file + one manifest line":
 *   1. Drop the demo's ES module at `../demos/<id>.js` (sibling `demos/`
 *      directory next to this file).
 *   2. Add ONE entry to the DEMOS array below: { id, title, description }.
 *
 * That is all. No edits to index.html, app.js, or router/router.js:
 *   - index.html imports DEMOS and renders one gallery card per entry.
 *   - router/router.js deep-links to `#/demo/<id>` and resolves the module
 *     from <id> via the DEMOS entry.
 *   - Engine.load(modulePath) imports the module and calls its exported
 *     `init(container)` (see engine/Engine.js for the full contract).
 *
 * ENTRY FIELDS:
 *   - id:          unique string; used as the deep-link path (`#/demo/<id>`),
 *                  the module filename (`../demos/<id>.js`), and the
 *                  dictionary key the router looks up.
 *   - title:       human-readable name shown in the gallery list.
 *   - description: one-line blurb shown under the title in the gallery card.
 *   - module:      OPTIONAL. Defaults to `../demos/<id>.js`, resolved relative
 *                  to THIS file (not the caller) so router.js can
 *                  dynamic-import(demo.module) no matter where it lives. Set
 *                  it only to point at a non-conventional path.
 */

/**
 * Resolve a demo's module URL.
 *
 * Conventional form (preferred; do not override unless the demo lives
 * somewhere other than `demos/<id>.js`): `../demos/<id>.js` relative to this
 * file. new URL(..., import.meta.url) resolves it the same way it does in a
 * browser and in Node, so the registry works in both.
 *
 * @param {string} id the demo id (filename stem under demos/).
 * @returns {string} an absolute URL for the demo module.
 */
export function resolveModule(id) {
  return new URL(`../demos/${id}.js`, import.meta.url).href;
}

/**
 * The exact list of demos this gallery ships. Order here is the order the
 * gallery cards appear.
 */
export const DEMOS = [
  {
    id: "frontier",
    title: "Frontier",
    description: "Stellar Drift — a warp-field particle galaxy you can orbit.",
  },
  {
    id: "local",
    title: "Local",
    description: "Murmuration — a starling flock you herd with the mouse.",
  },
  {
    id: "horizon",
    title: "Horizon",
    description: "Drift Fields — a crystal-shard horizon with formations + picking.",
  },
  {
    id: "instancing",
    title: "Instancing",
    description: "Shard Drift — 6,000 GPU-instanced shards in a single draw call.",
  },
  {
    id: "shaders",
    title: "Shaders",
    description: "SDF Raymarch — a custom GLSL ShaderMaterial: per-pixel raymarched SDFs.",
  },
  {
    id: "postfx",
    title: "PostFX",
    description: "Multi-pass composer — SSAO + bloom + chromatic aberration + vignette + FXAA.",
  },
  {
    id: "physics",
    title: "Physics",
    description: "Verlet cloth — a 252-point cloth drapes over a rigid ball-pit (5 spheres + box + floor).",
  },
  {
    id: "surface",
    title: "Surface",
    description: "Materials Lab — one PBR object + a light rig; live knobs for metalness, roughness, light intensity, light color.",
  },
  {
    id: "flow",
    title: "Flow",
    description: "Curl-Noise Flow Field — tens of thousands of advected particles; crank count and watch fps/triangles climb.",
  },
  {
    id: "bloom",
    title: "Bloom",
    description: "Bloom Playground — a neon scene where Low/Med/High visibly change pixel ratio + bloom strength.",
  },
].map((entry) => ({
  ...entry,
  // Resolve the module for the entry (default to the conventional path, or
  // keep an explicit override if one was given).
  module: entry.module || resolveModule(entry.id),
}));

/**
 * Look up a demo by id (the deep-link path segment).
 * @param {string} id
 * @returns {Object|null} the DEMOS entry for id, or null if not present.
 */
export function getDemo(id) {
  return DEMOS.find((d) => d.id === id) || null;
}
