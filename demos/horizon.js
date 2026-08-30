import * as THREE from "three";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * Horizon demo — "Drift Fields", a field of individually-animated crystal
 * shards.
 *
 * Built on the shared engine + the BaseDemo scaffold (engine/BaseDemo.js).
 * Chosen capability (stretches the engine beyond frontier + local):
 *   1. Procedural solid-mesh geometry (IcosahedronGeometry meshes) — the two
 *      other demos are CPU-updated point clouds; this builds real meshes.
 *   2. Keyboard-driven scene state — number keys 1/2/3 switch the formation
 *      (grid / spiral / sphere).
 *   3. Per-object raycast picking — a click raycasts into the scene and the
 *      hit shard flares and spins.
 *
 * Every interactive listener (keydown, pointermove, pointerdown, pointerup)
 * is registered via engine.addListener so the engine tracks it, counts it via
 * listenerCount, and removes it on reset() — the BaseDemo scaffold needs no
 * manual removeListener for them. Teardown that the engine cannot infer
 * (the shared geometry and per-shard materials) is done in unmount().
 *
 * Visual behavior is identical to the pre-refactor demo — this card is a
 * refactor, not a redesign.
 *
 * Demo contract (see engine/Engine.js):
 *   export function init(container) -> { update, destroy }
 */
class Horizon extends BaseDemo {
  mount(engine) {
    const { scene, camera } = engine;
    this.scene = scene;
    this.camera = camera;

    // ---- Scene setup ----
    scene.background = new THREE.Color(0x04060c);
    scene.fog = new THREE.FogExp2(0x04060c, 0.0055);

    // Lighting: ambient + a key light + a warm light that follows the pointer.
    const ambient = new THREE.AmbientLight(0x223355, 0.55);
    scene.add(ambient);
    const keyLight = new THREE.PointLight(0x88bbff, 2.2, 800, 2);
    keyLight.position.set(60, 90, 60);
    scene.add(keyLight);
    this.pointerLight = new THREE.PointLight(0xff9a5a, 2.6, 240, 2);
    this.pointerLight.position.set(0, 0, 30);
    scene.add(this.pointerLight);

    // ---- Procedural shard geometry (shared) + per-shard material/state ----
    this.SHARD_COUNT = 140;
    this.geo = new THREE.IcosahedronGeometry(1.0, 0);

    const colorA = new THREE.Color(0x5fd0ff);
    const colorB = new THREE.Color(0xb07bff);

    this.shards = [];
    this.materials = [];
    for (let i = 0; i < this.SHARD_COUNT; i++) {
      const useA = i % 2 === 0;
      const mat = new THREE.MeshStandardMaterial({
        color: useA ? colorA : colorB,
        metalness: 0.5,
        roughness: 0.22,
        emissive: useA ? colorB : colorA,
        emissiveIntensity: 0.15,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      const baseScale = 0.6 + Math.random() * 1.1;
      mesh.scale.setScalar(baseScale);
      scene.add(mesh);
      this.materials.push(mat);
      this.shards.push({
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
    this.SPHERE_R = 44;
    this.GOLDEN = Math.PI * (3 - Math.sqrt(5));
    this.formation = 1; // spiral
    this.formationNames = ["grid", "spiral", "sphere"];

    // ---- HUD (title + formation hint). Built from parts because it has a
    //      live state line; scoped to the container by the BaseDemo scaffold
    //      and removed on destroy(). ----
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
    this.hudState = document.createElement("div");
    this.hudState.style.color = "#ffd9a0";
    this.hudState.textContent = `formation: ${this.formationNames[this.formation]}`;
    hud.appendChild(hudTitle);
    hud.appendChild(hudHint);
    hud.appendChild(this.hudState);
    this.attachHud(hud);

    // ---- Keyboard: switch formation. Registered via the engine so it is
    //      tracked and removed on reset(). ----
    const onKey = (e) => {
      if (e.key === "1") this.formation = 0;
      else if (e.key === "2") this.formation = 1;
      else if (e.key === "3") this.formation = 2;
      else return;
      this.applyFormation();
      this.hudState.textContent = `formation: ${this.formationNames[this.formation]}`;
    };
    engine.addListener(window, "keydown", onKey);

    // ---- Pointer: parallax camera + light-follow. Engine-tracked. ----
    this.pointer = new THREE.Vector2(0, 0);
    const onPointerMove = (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    engine.addListener(window, "pointermove", onPointerMove);

    // ---- Raycast picking: a click (not a drag) flares the shard under the
    //      cursor. This is the capability neither frontier nor local uses. ----
    this.raycaster = new THREE.Raycaster();
    this.pickNDC = new THREE.Vector2();
    let downX = 0, downY = 0;
    const onPointerDown = (e) => { downX = e.clientX; downY = e.clientY; };
    const onPointerUp = (e) => {
      if (Math.abs(e.clientX - downX) > 6 || Math.abs(e.clientY - downY) > 6) return;
      this.pickNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pickNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.pickNDC, this.camera);
      const meshes = this.shards.map((s) => s.mesh);
      const hits = this.raycaster.intersectObjects(meshes, false);
      if (hits.length) {
        const idx = this.shards.findIndex((s) => s.mesh === hits[0].object);
        if (idx >= 0) this.shards[idx].flare = 1;
      }
    };
    engine.addListener(window, "pointerdown", onPointerDown);
    engine.addListener(window, "pointerup", onPointerUp);

    // Initialize the formation (positions + targets) for the default spiral.
    this.applyFormation();
    for (const s of this.shards) s.current.copy(s.target);

    // ---- Per-frame state ----
    this.camA = 0;
  }

  applyFormation() {
    const i_target = (i, out) => {
      switch (this.formation) {
        case 0: return this.formationGrid(i, out);
        case 1: return this.formationSpiral(i, out);
        case 2: return this.formationSphere(i, out);
      }
    };
    for (let i = 0; i < this.SHARD_COUNT; i++) i_target(i, this.shards[i].target);
  }

  formationGrid(i, out) {
    const side = Math.ceil(Math.sqrt(this.SHARD_COUNT));
    const col = i % side;
    const row = Math.floor(i / side);
    out.set((col - (side - 1) / 2) * 8, (row - (side - 1) / 2) * 8, 0);
  }

  formationSpiral(i, out) {
    const t = i / this.SHARD_COUNT;
    const angle = t * Math.PI * 6;
    const r = 8 + t * 38;
    out.set(Math.cos(angle) * r, Math.sin(t * Math.PI * 3) * 14, Math.sin(angle) * r);
  }

  formationSphere(i, out) {
    const y = 1 - (i / (this.SHARD_COUNT - 1)) * 2; // 1..-1
    const rad = Math.sqrt(1 - y * y);
    const theta = i * this.GOLDEN;
    out.set(Math.cos(theta) * rad * this.SPHERE_R, y * this.SPHERE_R, Math.sin(theta) * rad * this.SPHERE_R);
  }

  update(delta, elapsed) {
    const { camera, pointer, pointerLight, shards } = this;
    const dt = Math.min(delta, 0.05) || 0.016;

    // Slow auto-orbit + pointer parallax on the shared camera.
    this.camA += dt * 0.12;
    const r = 80;
    camera.position.set(
      Math.sin(this.camA) * r + pointer.x * 12,
      4 + Math.sin(this.camA * 0.6) * 6 + pointer.y * 9,
      Math.cos(this.camA) * r,
    );
    camera.lookAt(0, 0, 0);

    // Warm light follows the pointer across the field.
    pointerLight.position.set(pointer.x * 44, pointer.y * 34, 34);

    // Per-shard: ease toward the formation target, bob, spin, decay flare.
    for (let i = 0; i < this.SHARD_COUNT; i++) {
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

  unmount() {
    // Explicit, idempotent extra cleanup the engine's reset() does not cover.
    // reset() disposes the shared geometry + per-shard materials found in the
    // scene and removes the light children and all tracked listeners; this
    // keeps the module leak-free even if reset() were skipped.
    this.geo.dispose();              // shared shard geometry
    for (const m of this.materials) m.dispose(); // per-shard materials
  }
}

export function init(container) {
  return new Horizon().init(container);
}
