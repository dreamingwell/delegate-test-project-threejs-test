import * as THREE from "three";

/**
 * Horizon demo — "Drift Fields", a field of individually-animated crystal
 * shards.
 *
 * #TJDG-7: the brand-new demo proving the shared engine generalises.
 * Chosen capability (stretches the engine beyond frontier + local):
 *   1. Procedural solid-mesh geometry (IcosahedronGeometry meshes) — both
 *      existing demos are CPU-updated *point clouds* (THREE.Points); neither
 *      builds a real mesh.
 *   2. Keyboard-driven scene state — number keys 1/2/3 switch the formation
 *      (grid / spiral / sphere). Neither existing demo listens to the
 *      keyboard.
 *   3. Per-object raycast picking — a click raycasts into the scene and the
 *      hit shard flares and spins. frontier orbits the whole camera via
 *      OrbitControls and local herds the *whole* swarm with the pointer;
 *      neither raycasts into individual scene objects.
 *
 * All interactive listeners (keydown, pointermove, pointerdown, pointerup)
 * are registered via eng.addListener so the engine tracks them, counts them
 * via listenerCount, and removes them on reset() — destroy() also removes
 * them explicitly, matching the frontier/local teardown pattern.
 *
 * Demo contract (see engine/Engine.js):
 *   export function init(container) -> { update, destroy }
 *
 * File ownership: this module is the only file #TJDG-7 touches.
 */
export function init(container) {
  const eng = container.engine;
  if (!eng) throw new Error("horizon: container.engine is not set");
  const { scene, camera } = eng;

  // ---- Scene setup ----
  scene.background = new THREE.Color(0x04060c);
  scene.fog = new THREE.FogExp2(0x04060c, 0.0055);

  // Lighting: ambient + a key light + a warm light that follows the pointer.
  const ambient = new THREE.AmbientLight(0x223355, 0.55);
  scene.add(ambient);
  const keyLight = new THREE.PointLight(0x88bbff, 2.2, 800, 2);
  keyLight.position.set(60, 90, 60);
  scene.add(keyLight);
  const pointerLight = new THREE.PointLight(0xff9a5a, 2.6, 240, 2);
  pointerLight.position.set(0, 0, 30);
  scene.add(pointerLight);

  // ---- Procedural shard geometry (shared) + per-shard material/state ----
  const SHARD_COUNT = 140;
  const geo = new THREE.IcosahedronGeometry(1.0, 0);

  const colorA = new THREE.Color(0x5fd0ff);
  const colorB = new THREE.Color(0xb07bff);

  const shards = [];
  const materials = [];
  for (let i = 0; i < SHARD_COUNT; i++) {
    const useA = i % 2 === 0;
    const mat = new THREE.MeshStandardMaterial({
      color: useA ? colorA : colorB,
      metalness: 0.5,
      roughness: 0.22,
      emissive: useA ? colorB : colorA,
      emissiveIntensity: 0.15,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const baseScale = 0.6 + Math.random() * 1.1;
    mesh.scale.setScalar(baseScale);
    scene.add(mesh);
    materials.push(mat);
    shards.push({
      mesh,
      mat,
      baseScale,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.9,
      flare: 0, // decays over time; boosted to 1 on a successful pick
      target: new THREE.Vector3(),
      current: new THREE.Vector3(),
    });
  }

  // ---- Formations (each writes a target position for shard i) ----
  const SPHERE_R = 44;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  function formationGrid(i, out) {
    const side = Math.ceil(Math.sqrt(SHARD_COUNT));
    const col = i % side;
    const row = Math.floor(i / side);
    out.set((col - (side - 1) / 2) * 8, (row - (side - 1) / 2) * 8, 0);
  }
  function formationSpiral(i, out) {
    const t = i / SHARD_COUNT;
    const angle = t * Math.PI * 6;
    const r = 8 + t * 38;
    out.set(Math.cos(angle) * r, Math.sin(t * Math.PI * 3) * 14, Math.sin(angle) * r);
  }
  function formationSphere(i, out) {
    const y = 1 - (i / (SHARD_COUNT - 1)) * 2; // 1..-1
    const rad = Math.sqrt(1 - y * y);
    const theta = i * GOLDEN;
    out.set(Math.cos(theta) * rad * SPHERE_R, y * SPHERE_R, Math.sin(theta) * rad * SPHERE_R);
  }

  const formations = [formationGrid, formationSpiral, formationSphere];
  const formationNames = ["grid", "spiral", "sphere"];
  let formation = 1; // spiral

  function applyFormation() {
    for (let i = 0; i < SHARD_COUNT; i++) formations[formation](i, shards[i].target);
  }
  applyFormation();
  for (const s of shards) s.current.copy(s.target);

  // ---- HUD (title + formation hint). Scoped to the demo container; removed
  //      by destroy(). ----
  const hud = document.createElement("div");
  hud.id = "horizon-hud";
  hud.style.cssText =
    "position:absolute;top:14px;left:16px;color:#cfe8ff;" +
    "font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    "text-shadow:0 0 6px rgba(80,160,255,0.6);pointer-events:none;user-select:none;";
  const hudTitle = document.createElement("div");
  hudTitle.innerHTML = '<b style="color:#fff">Drift Fields</b> — a shard horizon';
  const hudHint = document.createElement("div");
  hudHint.textContent = "keys 1/2/3 switch formation · click a shard to flare it";
  const hudState = document.createElement("div");
  hudState.style.color = "#ffd9a0";
  hudState.textContent = `formation: ${formationNames[formation]}`;
  hud.appendChild(hudTitle);
  hud.appendChild(hudHint);
  hud.appendChild(hudState);
  container.appendChild(hud);

  // ---- Keyboard: switch formation. Registered via the engine so it is
  //      tracked and removed on reset(); also removed in destroy(). ----
  const onKey = (e) => {
    if (e.key === "1") formation = 0;
    else if (e.key === "2") formation = 1;
    else if (e.key === "3") formation = 2;
    else return;
    applyFormation();
    hudState.textContent = `formation: ${formationNames[formation]}`;
  };
  const keyEntry = eng.addListener(window, "keydown", onKey);

  // ---- Pointer: parallax camera + light-follow. Engine-tracked. ----
  const pointer = new THREE.Vector2(0, 0);
  const onPointerMove = (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  };
  const pointerEntry = eng.addListener(window, "pointermove", onPointerMove);

  // ---- Raycast picking: a click (not a drag) flares the shard under the
  //      cursor. This is the capability neither frontier nor local uses. ----
  const raycaster = new THREE.Raycaster();
  const pickNDC = new THREE.Vector2();
  let downX = 0, downY = 0;
  const onPointerDown = (e) => { downX = e.clientX; downY = e.clientY; };
  const onPointerUp = (e) => {
    if (Math.abs(e.clientX - downX) > 6 || Math.abs(e.clientY - downY) > 6) return;
    pickNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    pickNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pickNDC, camera);
    const meshes = shards.map((s) => s.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const idx = shards.findIndex((s) => s.mesh === hits[0].object);
      if (idx >= 0) shards[idx].flare = 1;
    }
  };
  const downEntry = eng.addListener(window, "pointerdown", onPointerDown);
  const upEntry = eng.addListener(window, "pointerup", onPointerUp);

  // ---- Per-frame work. The engine owns the rAF loop and renders the
  //      composer after update(), so this never renders itself. ----
  let camA = 0;
  let active = true;

  function update(delta, elapsed) {
    if (!active) return;
    const dt = Math.min(delta, 0.05) || 0.016;

    // Slow auto-orbit + pointer parallax on the shared camera.
    camA += dt * 0.12;
    const r = 80;
    camera.position.set(
      Math.sin(camA) * r + pointer.x * 12,
      4 + Math.sin(camA * 0.6) * 6 + pointer.y * 9,
      Math.cos(camA) * r,
    );
    camera.lookAt(0, 0, 0);

    // Warm light follows the pointer across the field.
    pointerLight.position.set(pointer.x * 44, pointer.y * 34, 34);

    // Per-shard: ease toward the formation target, bob, spin, decay flare.
    for (let i = 0; i < SHARD_COUNT; i++) {
      const s = shards[i];
      s.current.lerp(s.target, 0.035);
      const bob = Math.sin(elapsed * 0.7 + s.phase) * 1.3;
      s.mesh.position.set(s.current.x, s.current.y + bob, s.current.z);
      s.mesh.rotation.x += s.spin * dt;
      s.mesh.rotation.y += s.spin * 0.7 * dt;

      s.flare = Math.max(0, s.flare - dt * 1.4);
      const pulse = 0.14 + 0.06 * Math.sin(elapsed * 1.5 + s.phase);
      s.mat.emissiveIntensity = pulse + s.flare * 2.4;
      s.mesh.scale.setScalar(s.baseScale * (1 + s.flare * 0.45));
    }
  }

  // ---- Teardown. Runs from Engine.unload() before the engine's reset()
  //      sweep; explicit and idempotent so the module cannot leak resources,
  //      listeners, or DOM even if reset() were skipped. (reset() additionally
  //      disposes the shared geometry/materials found in the scene and removes
  //      the light children.) ----
  function destroy() {
    if (!active) return;
    active = false;

    hud.remove(); // remove the HUD element
    eng.removeListener(keyEntry);
    eng.removeListener(pointerEntry);
    eng.removeListener(downEntry);
    eng.removeListener(upEntry);
    geo.dispose(); // shared shard geometry
    for (const m of materials) m.dispose(); // per-shard materials
    scene.fog = null; // engine reset() also nulls these
    scene.background = null;
  }

  return { update, destroy };
}
