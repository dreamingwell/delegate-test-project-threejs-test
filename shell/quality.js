/**
 * shell/quality.js — Low / Medium / High quality tiers.
 *
 * The five shared shell systems, part 5. A tier changes what actually gets
 * rendered, so the difference is VISIBLE on screen, not just a number in a
 * log:
 *
 *   - Low:  low pixel ratio (crisper + lighter: fewer pixels, dimmer glow).
 *   - Med:  default pixel ratio (matches the engine's original behaviour).
 *   - High: the highest available pixel ratio (capped at 2, as the engine
 *           already caps it) — the fullest, brightest render.
 *
 * The tier also scales the strength of any bloom pass the active demo has
 * injected into the shared composer (`pass.strength` is read live by the
 * bloom composite material), so a bloom-heavy demo looks visibly softer at
 * Low and fuller at High. A demo that injects no bloom pass is unaffected by
 * the multiplier (only the pixel ratio changes for it).
 *
 * `quality` is part of the deep-link state (`?quality=<tier>`); see
 * shell/urlstate.js.
 */

export const QUALITY_TIERS = {
  low: {
    label: "Low",
    pixelRatioScale: 0.75,
    bloomMultiplier: 0.55,
  },
  medium: {
    label: "Medium",
    pixelRatioScale: 1,
    bloomMultiplier: 1,
  },
  high: {
    label: "High",
    pixelRatioScale: 1.25,
    bloomMultiplier: 1.35,
  },
};

export const DEFAULT_TIER = "medium";

/**
 * @param {import("../engine/Engine.js").Engine} engine the shared engine.
 */
export function initQuality(engine) {
  engine._currentQualityTier = engine._currentQualityTier || DEFAULT_TIER;
  globalThis.__qualityTier = engine._currentQualityTier;
  // Store the base strength of every bloom pass once so repeated
  // applyTier() calls never compound the multiplier.
  if (!engine._qualityBloomBase) {
    engine._qualityBloomBase = new Map();
    for (const pass of engine.composer.passes) {
      if (pass && typeof pass.strength === "number" && typeof pass.radius === "number") {
        engine._qualityBloomBase.set(pass, pass.strength);
      }
    }
  }
}

/** The currently-applied tier key (single source of truth: global, set by applyTier/initQuality). */
export function getQuality() {
  return globalThis.__qualityTier || DEFAULT_TIER;
}

/**
 * Apply a tier: set the renderer + composer pixel ratio (capped at 2) and
 * scale the strength of every bloom pass in the active composer. Idempotent.
 *
 * @param {import("../engine/Engine.js").Engine} engine
 * @param {"low"|"medium"|"high"} tier
 */
export function applyTier(engine, tier) {
  const key = QUALITY_TIERS[tier] ? tier : DEFAULT_TIER;
  const t = QUALITY_TIERS[key];
  engine._currentQualityTier = key;
  globalThis.__qualityTier = key; // getQuality() can read this without the engine ref

  const cap = (v) => Math.min(v, 2);
  const pr = cap(devicePixelRatio * t.pixelRatioScale);
  engine.renderer.setPixelRatio(pr);
  // Resize the renderer so the canvas backing store matches the new ratio
  // (setPixelRatio alone does not resize). Matches the engine's own resize.
  engine.renderer.setSize(innerWidth, innerHeight);
  engine.composer.setPixelRatio(pr);
  engine.composer.setSize(innerWidth, innerHeight);

  if (engine._qualityBloomBase) {
    for (const pass of engine.composer.passes) {
      if (pass && typeof pass.strength === "number" && typeof pass.radius === "number") {
        if (!engine._qualityBloomBase.has(pass)) engine._qualityBloomBase.set(pass, pass.strength);
        pass.strength = engine._qualityBloomBase.get(pass) * t.bloomMultiplier;
      }
    }
  }
  return key;
}
