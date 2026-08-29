import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/**
 * Frontier demo — "Stellar Drift", a warp-field particle galaxy.
 *
 * Refactored from the standalone `frontier-demo/index.html` onto the shared
 * engine. Instead of creating a second renderer/context it builds into
 * `container.engine.scene` / `.camera` / `.renderer` / `.composer`, and it
 * registers its per-frame work with the engine's single rAF loop through
 * `update(delta, elapsed)`. `destroy()` stops the module's per-frame work
 * (the engine owns the loop) and disposes every GPU resource and DOM element
 * it created, so nothing leaks when the router unloads the demo.
 *
 * Demo contract (see engine/Engine.js):
 *   export function init(container) -> { update, destroy }
 *
 * File ownership: this module is the only file #TJDG-5 touches.
 */
export function init(container) {
  const eng = container.engine;
  if (!eng) throw new Error("frontier: container.engine is not set");
  const { scene, camera, renderer } = eng;

  // ---- Scene setup (matches the legacy standalone demo) ----
  scene.fog = new THREE.FogExp2(0x000008, 0.0009);
  camera.position.set(0, 60, 260);
  renderer.setClearColor(0x000006);

  // Orbit controls bound to the shared canvas. It attaches its own
  // pointer/wheel listeners directly to renderer.domElement — destroy() must
  // call controls.dispose() to remove them. No separate resize listener is
  // added: the engine already owns a window resize handler that resizes the
  // camera, renderer, and composer (same work the legacy demo's resize did).
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 20;
  controls.maxDistance = 900;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;

  // ---- Galaxy of particles arranged in a spiral, colored by radius ----
  const ARM_COUNT = 5;
  const PARTICLES = 42000;

  const positions = new Float32Array(PARTICLES * 3);
  const colors = new Float32Array(PARTICLES * 3);
  const sizes = new Float32Array(PARTICLES);
  const basePositions = new Float32Array(PARTICLES * 3);
  const speeds = new Float32Array(PARTICLES);

  const colorCore = new THREE.Color(0xfff0c0);
  const colorMid = new THREE.Color(0x8fd0ff);
  const colorEdge = new THREE.Color(0x7a4bff);

  for (let i = 0; i < PARTICLES; i++) {
    const radius = Math.pow(Math.random(), 1.5) * 220 + 2;
    const armOffset = (i % ARM_COUNT) * ((Math.PI * 2) / ARM_COUNT);
    const spin = radius * 0.045;
    const spread = (Math.random() - 0.5) * (0.55 + radius * 0.01);
    const angle = armOffset + spin + spread;

    const height =
      (Math.random() - 0.5) * (10 + (1 - radius / 220) * 22) * Math.exp(-radius / 260);

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = height;

    const idx = i * 3;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;
    basePositions[idx] = radius; // packed as [radius, angle, y]
    basePositions[idx + 1] = angle;
    basePositions[idx + 2] = y;

    const t = radius / 220;
    const c = new THREE.Color();
    if (t < 0.5) c.copy(colorCore).lerp(colorMid, t * 2);
    else c.copy(colorMid).lerp(colorEdge, (t - 0.5) * 2);
    c.multiplyScalar(0.6 + Math.random() * 0.6);
    colors[idx] = c.r;
    colors[idx + 1] = c.g;
    colors[idx + 2] = c.b;

    sizes[i] = Math.random() * 2.2 + 0.4;
    speeds[i] = (0.15 + (1 - t) * 0.9) * (0.5 + Math.random() * 0.5);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

  const starTexture = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  const material = new THREE.PointsMaterial({
    size: 2.4,
    map: starTexture,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, material);
  scene.add(points);

  // ---- Central glowing core ----
  const coreGeo = new THREE.SphereGeometry(6, 32, 32);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);

  const coreLight = new THREE.PointLight(0xfff2c8, 4, 400, 2);
  scene.add(coreLight);

  // ---- Distant static starfield backdrop ----
  const bgCount = 3000;
  const bgPos = new Float32Array(bgCount * 3);
  for (let i = 0; i < bgCount; i++) {
    const r = 1400 + Math.random() * 900;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    bgPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    bgPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    bgPos[i * 3 + 2] = r * Math.cos(phi);
  }
  const bgGeo = new THREE.BufferGeometry();
  bgGeo.setAttribute("position", new THREE.BufferAttribute(bgPos, 3));
  const bgMat = new THREE.PointsMaterial({
    size: 1.4,
    color: 0xaaccff,
    map: starTexture,
    transparent: true,
    depthWrite: false,
  });
  const bgPoints = new THREE.Points(bgGeo, bgMat);
  scene.add(bgPoints);

  // ---- Post-processing: bloom for the glow. The engine's composer already
  //      holds a RenderPass; we add only the bloom pass. It is disposed by
  //      destroy() and again (idempotently) by the engine's reset(). ----
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    1.15,
    0.6,
    0.15,
  );
  eng.addPass(bloom);

  // ---- HUD (title + hint). Mounted into the demo container so it is scoped
  //      to this demo; removed by destroy(). The "back to demos" affordance is
  //      provided by the gallery shell (#back-link), so the old <a> is omitted.
  const hud = document.createElement("div");
  hud.id = "frontier-hud";
  hud.style.cssText =
    "position:absolute;top:14px;left:16px;color:#cfe8ff;" +
    "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    "text-shadow:0 0 6px rgba(80,160,255,0.7);" +
    "pointer-events:none;user-select:none;";
  hud.innerHTML =
    '<div><b style="color:#fff">Stellar Drift</b> — a warp-field particle galaxy</div>' +
    "<div>drag to orbit · scroll to zoom</div>";
  container.appendChild(hud);

  // ---- Per-frame work. The engine owns the rAF loop and calls
  //      composer.render() after update(), so this does not render itself.
  //      `elapsed` is the engine clock's elapsedTime, matching the legacy
  //      demo's per-frame phase. ----
  let active = true;

  function update(_delta, elapsed) {
    if (!active) return;

    const posAttr = geo.attributes.position;
    const arr = posAttr.array;
    for (let i = 0; i < PARTICLES; i++) {
      const idx = i * 3;
      const radius = basePositions[idx];
      const angle = basePositions[idx + 1] + elapsed * 0.02 * speeds[i];
      const y = basePositions[idx + 2];
      arr[idx] = Math.cos(angle) * radius;
      arr[idx + 2] = Math.sin(angle) * radius;
      arr[idx + 1] = y + Math.sin(elapsed * 0.6 + radius * 0.05) * 0.6;
    }
    posAttr.needsUpdate = true;

    core.scale.setScalar(1 + Math.sin(elapsed * 2) * 0.06);
    coreLight.intensity = 3.5 + Math.sin(elapsed * 2) * 0.8;

    controls.update();
  }

  // ---- Teardown. Runs from Engine.unload() before the engine's reset()
  //      sweep; it is explicit and idempotent so the module cannot leak
  //      resources, listeners, or DOM even if reset() were skipped. ----
  function destroy() {
    if (!active) return;
    active = false;

    // Stop the module's per-frame work (the engine stops the shared loop and
    // nulls its callback; this flag also makes any in-flight update() a no-op).
    hud.remove(); // remove the HUD element
    controls.dispose(); // removes OrbitControls' own pointer/wheel listeners
    bloom.dispose(); // remove the bloom pass (engine reset() re-sweeps passes)
    geo.dispose(); // galaxy geometry
    material.dispose(); // galaxy points material
    starTexture.dispose(); // shared star sprite texture
    coreGeo.dispose(); // core geometry
    coreMat.dispose(); // core material
    bgGeo.dispose(); // backdrop geometry
    bgMat.dispose(); // backdrop material
    scene.fog = null; // drop the fog (engine reset() also nulls it)
  }

  return { update, destroy };
}
