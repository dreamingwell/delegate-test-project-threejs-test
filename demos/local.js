import * as THREE from "three";

/**
 * Local demo — "Murmuration", a starling flock (boids).
 *
 * Refactored from the standalone `local-demo/index.html` onto the shared
 * engine. Instead of creating a second renderer/context it builds into
 * `container.engine.scene` / `.camera`, and it registers its per-frame work
 * with the engine's single rAF loop through `update(delta, elapsed)`.
 * `destroy()` stops the module's per-frame work (the engine owns the loop)
 * and disposes every GPU resource and DOM element it created, so nothing
 * leaks when the router unloads the demo.
 *
 * Demo contract (see engine/Engine.js):
 *   export function init(container) -> { update, destroy }
 *
 * File ownership: this module is the only file #TJDG-6 touches.
 */
export function init(container) {
  const eng = container.engine;
  if (!eng) throw new Error("local: container.engine is not set");
  const { scene, camera } = eng;

  // ---- Scene setup (matches the legacy standalone demo) ----
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x05070d, 0.012);

  // Glow sprite texture shared by the points material.
  const glowTexture = makeGlowSprite();

  // ---- Flock state ----
  const COUNT = 340;
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 50;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 50;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
    vel[i * 3] = (Math.random() - 0.5) * 10;
    vel[i * 3 + 1] = (Math.random() - 0.5) * 10;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 10;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

  const material = new THREE.PointsMaterial({
    size: 1.5,
    map: glowTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, material);
  scene.add(points);

  // ---- Pointer input (herd the swarm). Registered via the engine so it is
  //      tracked, counted, and removed on reset(); destroy() also removes it
  //      explicitly. ----
  const mouse = new THREE.Vector2(0, 0);
  const onPointerMove = (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  };
  const pointerEntry = eng.addListener(window, "pointermove", onPointerMove);

  // ---- Flocking constants + scratch objects ----
  const _a = new THREE.Vector3();
  const _u = new THREE.Vector3();
  const herd = new THREE.Vector3();
  const target = new THREE.Color(0x86b6ff);
  const hot = new THREE.Color(0xffd9a0);
  const MAXS = 13, MINS = 4, RAD = 7, RADSQ = RAD * RAD, SEP = 9, MAXF = 60;

  function updateHerd() {
    _u.set(mouse.x, mouse.y, 0.5).unproject(camera)
      .sub(camera.position).normalize().multiplyScalar(30);
    herd.copy(camera.position).add(_u);
  }

  function sim(dt, tt) {
    for (let i = 0; i < COUNT; i++) {
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      let an = 0, sn = 0;
      let axa = 0, aya = 0, aza = 0, cxa = 0, cya = 0, cza = 0;
      let sxa = 0, sya = 0, sza = 0;
      for (let j = 0; j < COUNT; j++) {
        if (j === i) continue;
        const dx = pos[j * 3] - px, dy = pos[j * 3 + 1] - py, dz = pos[j * 3 + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < RADSQ) {
          axa += vel[j * 3]; aya += vel[j * 3 + 1]; aza += vel[j * 3 + 2];
          cxa += pos[j * 3]; cya += pos[j * 3 + 1]; cza += pos[j * 3 + 2];
          an++;
          if (d2 < SEP) {
            const d = Math.sqrt(d2) || 0.001, f = (Math.sqrt(SEP) - d) / Math.sqrt(SEP);
            sxa -= (dx / d) * f; sya -= (dy / d) * f; sza -= (dz / d) * f;
            sn++;
          }
        }
      }
      _a.set(0, 0, 0);
      if (an > 0) {
        _a.x += (axa / an - vel[i * 3]) + (cxa / an - px) * 0.5;
        _a.y += (aya / an - vel[i * 3 + 1]) + (cya / an - py) * 0.5;
        _a.z += (aza / an - vel[i * 3 + 2]) + (cza / an - pz) * 0.5;
      }
      if (sn > 0) { _a.x += sxa * 3.0; _a.y += sya * 3.0; _a.z += sza * 3.0; }
      _a.x += -px * 0.02; _a.y += -py * 0.02; _a.z += -pz * 0.02;
      _a.x += Math.sin(tt + py * 0.05) * 0.3;
      _a.z += Math.cos(tt + px * 0.05) * 0.3;
      _a.x += (herd.x - px) * 0.6; _a.y += (herd.y - py) * 0.6; _a.z += (herd.z - pz) * 0.6;
      _a.clampLength(0, MAXF);
      vel[i * 3] += _a.x * dt; vel[i * 3 + 1] += _a.y * dt; vel[i * 3 + 2] += _a.z * dt;
      let vx = vel[i * 3], vy = vel[i * 3 + 1], vz = vel[i * 3 + 2];
      let sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > MAXS) { const k = MAXS / sp; vx *= k; vy *= k; vz *= k; }
      else if (sp < MINS && sp > 0) { const k = MINS / sp; vx *= k; vy *= k; vz *= k; }
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    }
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const sp = Math.sqrt(vel[i * 3] * vel[i * 3] + vel[i * 3 + 1] * vel[i * 3 + 1] + vel[i * 3 + 2] * vel[i * 3 + 2]);
      const f = Math.min(sp / MAXS, 1);
      col[i * 3] = target.r + f * (hot.r - target.r);
      col[i * 3 + 1] = target.g + f * (hot.g - target.g);
      col[i * 3 + 2] = target.b + f * (hot.b - target.b);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  // ---- Camera orbit state ----
  let camA = 0;

  // ---- HUD (title + hint). Mounted into the demo container so it is scoped
  //      to this demo; removed by destroy(). The "back to demos" affordance
  //      is provided by the gallery shell (#back-link), so the old <a> is
  //      omitted. ----
  const hud = document.createElement("div");
  hud.id = "local-hud";
  hud.style.cssText =
    "position:absolute;top:14px;left:16px;color:#9fb4d8;" +
    "font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.4px;" +
    "text-shadow:0 1px 3px #000;opacity:.92;pointer-events:none;user-select:none;";
  hud.innerHTML =
    '<b style="color:#eaf2ff;font-weight:600">Murmuration</b> &mdash; a starling flock<br/>' +
    "move your mouse to herd the swarm";
  container.appendChild(hud);

  // ---- Per-frame work. The engine owns the rAF loop and calls
  //      composer.render() after update(), so this does not render itself.
  //      `dt` mirrors the legacy demo's clamped frame delta; the turbulence
  //      phase uses the engine clock (elapsed * 0.6 == (now - t0) ms * 0.0006).
  let active = true;

  function update(delta, elapsed) {
    if (!active) return;
    const dt = Math.min(delta, 0.05) || 0.016;
    updateHerd();
    sim(dt, elapsed * 0.6);
    camA += dt * 0.08;
    const r = 70;
    camera.position.set(Math.sin(camA) * r, 6 + Math.sin(camA * 0.7) * 8, Math.cos(camA) * r);
    camera.lookAt(0, 0, 0);
  }

  // ---- Teardown. Runs from Engine.unload() before the engine's reset()
  //      sweep; it is explicit and idempotent so the module cannot leak
  //      resources, listeners, or DOM even if reset() were skipped. ----
  function destroy() {
    if (!active) return;
    active = false;

    // Stop the module's per-frame work (the engine stops the shared loop and
    // nulls its callback; this flag also makes any in-flight update() a no-op).
    hud.remove();                         // remove the HUD element
    eng.removeListener(pointerEntry);     // remove the pointermove listener (engine reset() would too)
    geo.dispose();                        // flock geometry
    material.dispose();                   // points material
    glowTexture.dispose();                // glow sprite texture
    scene.fog = null;                     // drop the fog (engine reset() also nulls it)
    scene.background = null;              // drop the background (engine reset() also nulls it)
  }

  return { update, destroy };
}

// Radial-gradient glow sprite for the additive points (same as the legacy demo).
function makeGlowSprite() {
  const s = 64, cv = document.createElement("canvas"); cv.width = cv.height = s;
  const x = cv.getContext("2d");
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv); t.needsUpdate = true; return t;
}
