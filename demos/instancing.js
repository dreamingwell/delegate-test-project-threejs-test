import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * Instancing demo — "Shard Drift", 6,000 GPU-instanced shards in a swirl.
 *
 * The point of this card is GPU InstancedMesh: thousands of objects rendered
 * in a SINGLE draw call, driven by per-instance attributes. It is the biggest
 * capability gap the existing gallery left open (none of frontier/local/
 * horizon instance).
 *
 * Two per-instance attributes are demonstrated:
 *   1. `instanceMatrix` — the built-in per-instance transform (a
 *      mat4 per shard: position / rotation / scale). Updated on the CPU each
 *      frame to orbit + spin + pulse every shard; the GPU draws all of them
 *      in one draw call from that one attribute stream.
 *   2. `instanceColor` — a custom per-instance color attribute written via
 *      setColorAt() (an InstancedBufferAttribute under the hood). Each shard
 *      gets its own color from a radius-based palette, so per-instance
 *      *color* is visible on top of the per-instance transform.
 *
 * One `THREE.InstancedMesh` => one draw call for all 6,000 shards (a
 * structural fact of how InstancedMesh renders, not a measured perf number —
 * fps is #TJL-10's job with a real GL context).
 *
 * Built on the shared engine + the BaseDemo scaffold (engine/BaseDemo.js).
 * Builds into container.engine.scene/.camera/.renderer and registers
 * per-frame work with the engine's single rAF loop; the shared boilerplate
 * (active guard, HUD management, fog/background clear) is inherited.
 * This subclass adds only the instanced-field build, per-frame matrix
 * updates, and the teardown the engine cannot infer (OrbitControls.dispose()
 * removes its own canvas listeners; the InstancedMesh's geometry + material
 * + instance buffers are disposed here and again by the engine's reset()).
 *
 * Demo contract (see engine/Engine.js):
 *   export function init(container) -> { update, destroy }
 */
class Instancing extends BaseDemo {
  mount(engine) {
    const { scene, camera, renderer } = engine;
    this.scene = scene;
    this.camera = camera;

    // ---- Scene setup ----
    scene.fog = new THREE.FogExp2(0x050310, 0.0012);
    camera.position.set(0, 140, 320);
    renderer.setClearColor(0x050310);

    // Orbit controls on the shared canvas. It attaches its own
    // pointer/wheel listeners directly to renderer.domElement; unmount()
    // calls controls.dispose() to remove them. The engine already owns the
    // window resize handler (camera + renderer + composer resize).
    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 900;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.4;

    // ---- Instanced field of shards ----
    this.COUNT = 6000;
    this.RADIUS_MAX = 260;

    // Cheap, low-poly geometry => each shard is a handful of triangles; the
    // draw-call count is what the instancing is about, so we keep the per-
    // shard vertex count small.
    this.geo = new THREE.TetrahedronGeometry(1.4, 0);
    this.material = new THREE.MeshStandardMaterial({
      metalness: 0.35,
      roughness: 0.4,
      // Per-instance color is supplied via mesh.setColorAt(); enable it on
      // the material so the per-instance `instanceColor` attribute is used.
      vertexColors: false,
    });

    this.mesh = new THREE.InstancedMesh(this.geo, this.material, this.COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // the swarm spans the whole frustum
    scene.add(this.mesh);

    // ---- Per-instance base parameters (the "per-instance attributes" the
    //      CPU keeps so it can rebuild instanceMatrix every frame). ----
    const r3 = new THREE.Color();
    const colorCore = new THREE.Color(0xffe9b0); // warm core
    const colorMid = new THREE.Color(0x8fd0ff); // mid
    const colorEdge = new THREE.Color(0x7a4bff); // violet edge
    const colorHot = new THREE.Color(0xff5ea0); // accent
    this.baseAngle = new Float32Array(this.COUNT);
    this.baseRadius = new Float32Array(this.COUNT);
    this.baseY = new Float32Array(this.COUNT);
    this.speed = new Float32Array(this.COUNT);
    this.spin = new Float32Array(this.COUNT);
    this.spinPhase = new Float32Array(this.COUNT);
    this.scale = new Float32Array(this.COUNT);
    this.phase = new Float32Array(this.COUNT);
    const baseAngle = this.baseAngle;
    const baseRadius = this.baseRadius;
    const baseY = this.baseY;
    const speed = this.speed;
    const spin = this.spin;
    const spinPhase = this.spinPhase;
    const scale = this.scale;
    const phase = this.phase;
    this._dummy = new THREE.Object3D();
    const dummy = this._dummy;

    for (let i = 0; i < this.COUNT; i++) {
      const t = Math.pow(Math.random(), 1.4); // bias toward the core
      const radius = t * this.RADIUS_MAX + 4;
      const angle0 = Math.random() * Math.PI * 2;
      const y =
        (Math.random() - 0.5) *
        (6 + (1 - radius / this.RADIUS_MAX) * 26) *
        Math.exp(-radius / 200);

      baseRadius[i] = radius;
      baseAngle[i] = angle0;
      baseY[i] = y;
      // Kepler-ish: inner shards orbit faster.
      speed[i] = (0.12 + (1 - t) * 0.55) * (0.7 + Math.random() * 0.6);
      spin[i] = (Math.random() - 0.5) * 2.4; // per-instance spin rate
      spinPhase[i] = Math.random() * Math.PI * 2;
      scale[i] = 0.5 + Math.random() * 1.6;
      phase[i] = Math.random() * Math.PI * 2;

      // Per-instance color: a radius palette with a few accent shards, so the
      // custom `instanceColor` attribute is clearly visible per shard.
      if (Math.random() < 0.05) r3.copy(colorHot);
      else if (t < 0.5) r3.copy(colorCore).lerp(colorMid, t * 2);
      else r3.copy(colorMid).lerp(colorEdge, (t - 0.5) * 2);
      r3.multiplyScalar(0.7 + Math.random() * 0.5);
      this.mesh.setColorAt(i, r3);
    }
    // First pass: fill the initial instanceMatrix so the very first frame
    // (and the load-time state) is fully populated.
    this._writeMatrices(0, baseAngle, baseRadius, baseY, speed, spin, spinPhase, scale, phase, dummy);

    // ---- Lights so the standard material reads the per-instance color ----
    this.ambient = new THREE.AmbientLight(0x404060, 0.7);
    scene.add(this.ambient);
    this.dir = new THREE.DirectionalLight(0xffffff, 0.8);
    this.dir.position.set(120, 220, 120);
    scene.add(this.dir);
    this.coreLight = new THREE.PointLight(0xffd9a0, 3, 700, 2);
    scene.add(this.coreLight);

    // ---- HUD (title + hint). Scoped to the demo container by the BaseDemo
    //      scaffold and removed on destroy(). The gallery shell provides the
    //      "back to demos" affordance, so no in-scene back link is needed. ----
    this.createHud({
      id: "instancing-hud",
      cssText:
        "position:absolute;top:14px;left:16px;color:#cfe8ff;" +
        "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "text-shadow:0 0 6px rgba(120,140,255,0.7);" +
        "pointer-events:none;user-select:none;",
      html:
        `<div><b style="color:#fff">Shard Drift</b> — ${this.COUNT.toLocaleString()} GPU-instanced shards</div>` +
        "<div>one InstancedMesh &rarr; a single draw call, per-instance transform + color</div>" +
        "<div>drag to orbit &middot; scroll to zoom</div>",
    });
  }

  /**
   * Rebuild every shard's instanceMatrix (orbit position + spin + pulse
   * scale) from the per-instance base parameters. Called every frame; the
   * one buffer upload (instanceMatrix.needsUpdate) drives all COUNT shards.
   */
  _writeMatrices(
    t,
    baseAngle,
    baseRadius,
    baseY,
    speed,
    spin,
    spinPhase,
    scale,
    phase,
    dummy,
  ) {
    const mesh = this.mesh;
    for (let i = 0; i < this.COUNT; i++) {
      const angle = baseAngle[i] + t * speed[i];
      const r = baseRadius[i];
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = baseY[i] + Math.sin(t * 0.7 + phase[i]) * 1.4;
      const s = scale[i] * (1 + 0.14 * Math.sin(t * 1.5 + phase[i]));

      dummy.position.set(x, y, z);
      // Orbit yaw + an independent per-instance tumble.
      dummy.rotation.set(
        spinPhase[i] + t * spin[i] * 0.5,
        angle + t * spin[i],
        spinPhase[i] * 0.5,
      );
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(_delta, elapsed) {
    const { baseAngle, baseRadius, baseY, speed, spin, spinPhase, scale, phase } = this;
    this._writeMatrices(
      elapsed,
      baseAngle,
      baseRadius,
      baseY,
      speed,
      spin,
      spinPhase,
      scale,
      phase,
      this._dummy,
    );
    // Keep the central light breathing for depth.
    this.coreLight.intensity = 2.6 + Math.sin(elapsed * 1.4) * 0.7;
    this.controls.update();
  }

  unmount() {
    // OrbitControls owns its own pointer/wheel listeners on renderer.domElement
    // — dispose() removes them (the engine's reset() cannot reach them).
    this.controls.dispose();
    // Dispose the instanced mesh's buffers + geometry + material. The
    // engine's reset() also sweeps scene geometry/material, idempotently.
    this.mesh.dispose();
    this.geo.dispose();
    this.material.dispose();
  }
}

export function init(container) {
  return new Instancing().init(container);
}
