# Threejs Lab

A small gallery of standalone Three.js demos: no build step, no bundler —
static files, an import map, and a shared engine. Pinning the library
version keeps the site deterministic.

## Demos

| id | title | what it shows |
|----|-------|---------------|
| `frontier` | Frontier | Stellar Drift — a warp-field particle galaxy you can orbit |
| `local` | Local | Murmuration — a starling flock you herd with the mouse |
| `horizon` | Horizon | Drift Fields — a crystal-shard horizon with formations + picking |
| `instancing` | Instancing | Shard Drift — 6,000 GPU-instanced shards in a single draw call |
| `shaders` | Shaders | SDF Raymarch — a custom GLSL `ShaderMaterial`: per-pixel raymarched SDFs |
| `postfx` | PostFX | Multi-pass composer — SSAO + bloom + chromatic aberration + vignette + FXAA |
| `physics` | Physics | Verlet cloth — a 252-point cloth drapes over a rigid ball-pit |

Every demo follows the shared engine contract `init(container) -> { update,
destroy }` so it is leak-free on unload and inherits the engine's resize +
requestAnimationFrame loop.

## Performance

**Budget (a TARGET, not a measurement): 60fps @1080p on integrated graphics.**

Every measured number below comes from a **headless** harness and must be read
with its caveat. **The harness GPU is SwiftShader — CPU software rasterisation,
NOT an integrated (or any real) GPU.** It is not claimed anywhere that a demo
"measured 60fps on integrated graphics"; the iGPU figure is a target that this
harness cannot certify.

### Method

- **Harness:** headless Chromium (Google Chrome for Testing) driven by
  Puppeteer (Node). A dev tool — not shipped, not part of the build.
- **GL backend:** **SwiftShader software rasteriser** (no real GPU is present
  in the harness sandbox; confirmed via the unmasked renderer string:
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader
  driver)`).
- **Resolution:** **1920×1080 @ deviceScaleFactor 1** (a true 1080p framebuffer).
- **Sample:** ~10 s after a ~4 s warm-up (module import + first shader compiles
  are out of the window). `fps = requestAnimationFrame frames / elapsed`,
  cross-checked against the engine's own HUD.
- **Budget asserted:** ≥ 58 fps (2 fps of headroom below 60 for jitter).
- **Runs:** single run per demo; SwiftShader frame timing jitters, so treat the
  numbers as an order-of-magnitude baseline, not a precise benchmark.

### Measured (1080p, SwiftShader software GL, ~10 s sample)

| demo | measured fps | tris/frame | notes |
|------|-------------|-----------|-------|
| `frontier` | 1.9 | 1 (point galaxy) | particle galaxy + full-res post |
| `local` | 24.2 | 0 (flock) | mouse-herded starling flock |
| `horizon` | 23.6 | 2,800 | crystal-shard horizon + picking |
| `instancing` | 0.8 | 24,000 | 6,000 instanced shards, one draw call |
| `shaders` | 4.0 | 2 (full-screen) | per-pixel SDF raymarch (~30 march steps/px) |
| `postfx` | 0.5 | 1 (full-screen) | multi-pass composer (SSAO+bloom+CA+vignette+FXAA) |
| `physics` | 10.1 | 11,256 | Verlet cloth over a rigid ball-pit |

**No demo meets the 58 fps budget on this harness.** That is the expected
outcome and is **not** evidence a demo cannot hit 60 fps on a real iGPU: the
harness rasterises a 1080p framebuffer on the CPU, which is an order of
magnitude slower than real graphics silicon. A resolution-scaling check
(`frontier` at **1.9 → 3.2 → 7.2 fps** as the viewport drops
1080p → 720p → 360p) shows fps tracks pixel count — i.e. the bottleneck is the
software rasteriser's per-pixel throughput, not the demo's scene complexity.
To certify the 60fps@1080p iGPU budget you need to run this harness on a
machine that has an integrated GPU.

### Per-demo

Each block below repeats the four required lines. **TARGET** is the budget;
**MEASURED** is the headless number; **METHOD** is how it was taken; **CAVEAT**
is why the iGPU claim is a target, not a measurement.

#### `frontier` — Frontier
- **TARGET:** 60fps @1080p, integrated graphics.
- **MEASURED:** 1.9 fps (headless, single run).
- **METHOD:** headless harness, 1920×1080 @ deviceScaleFactor 1, ~10 s sample after ~4 s warm-up.
- **CAVEAT:** measured on SwiftShader software GL (not an integrated GPU); the 60fps iGPU figure is a target, not a measurement.

#### `local` — Local
- **TARGET:** 60fps @1080p, integrated graphics.
- **MEASURED:** 24.2 fps (headless, single run).
- **METHOD:** headless harness, 1920×1080 @ deviceScaleFactor 1, ~10 s sample after ~4 s warm-up.
- **CAVEAT:** measured on SwiftShader software GL (not an integrated GPU); the 60fps iGPU figure is a target, not a measurement.

#### `horizon` — Horizon
- **TARGET:** 60fps @1080p, integrated graphics.
- **MEASURED:** 23.6 fps (headless, single run).
- **METHOD:** headless harness, 1920×1080 @ deviceScaleFactor 1, ~10 s sample after ~4 s warm-up.
- **CAVEAT:** measured on SwiftShader software GL (not an integrated GPU); the 60fps iGPU figure is a target, not a measurement.

#### `instancing` — Instancing
- **TARGET:** 60fps @1080p, integrated graphics.
- **MEASURED:** 0.8 fps (headless, single run).
- **METHOD:** headless harness, 1920×1080 @ deviceScaleFactor 1, ~10 s sample after ~4 s warm-up.
- **CAVEAT:** measured on SwiftShader software GL (not an integrated GPU); the 60fps iGPU figure is a target, not a measurement. 24k tris/frame rasterised in software is a heavy load; the number reflects the software rasteriser, not the instancing technique.

#### `shaders` — Shaders
- **TARGET:** 60fps @1080p, integrated graphics.
- **MEASURED:** 4.0 fps (headless, single run).
- **METHOD:** headless harness, 1920×1080 @ deviceScaleFactor 1, ~10 s sample after ~4 s warm-up.
- **CAVEAT:** measured on SwiftShader software GL (not an integrated GPU); the 60fps iGPU figure is a target, not a measurement. A per-pixel full-screen raymarch on software GL is inherently slow; the number reflects the software rasteriser, not the SDF raymarch technique. (See note: a GLSL bug in this demo was fixed to make the measurement valid — see card comment.)

#### `postfx` — PostFX
- **TARGET:** 60fps @1080p, integrated graphics.
- **MEASURED:** 0.5 fps (headless, single run).
- **METHOD:** headless harness, 1920×1080 @ deviceScaleFactor 1, ~10 s sample after ~4 s warm-up.
- **CAVEAT:** measured on SwiftShader software GL (not an integrated GPU); the 60fps iGPU figure is a target, not a measurement. Multiple full-screen composer passes at 1080p on software GL dominate the cost; the number reflects the software rasteriser, not the post-processing chain.

#### `physics` — Physics
- **TARGET:** 60fps @1080p, integrated graphics.
- **MEASURED:** 10.1 fps (headless, single run).
- **METHOD:** headless harness, 1920×1080 @ deviceScaleFactor 1, ~10 s sample after ~4 s warm-up.
- **CAVEAT:** measured on SwiftShader software GL (not an integrated GPU); the 60fps iGPU figure is a target, not a measurement.

---
*Performance harness is a dev tool (headless Chromium + Puppeteer, SwiftShader
software GL). It is not shipped to the static site and does not affect the
zero-build-step constraint (the shipped site keeps its pinned `unpkg` import
map for THREE 0.160.1).*
