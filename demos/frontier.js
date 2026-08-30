import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * Frontier demo — "Stellar Drift", a warp-field particle galaxy.
 *
 * Built on the shared engine + the BaseDemo scaffold (engine/BaseDemo.js).
 * Instead of creating a second renderer/context it builds into
 * `container.engine.scene` / `.camera` / `.renderer` / `.composer` and
 * registers per-frame work with the engine's single rAF loop. The shared
 * boilerplate (active guard, HUD element management, fog/background clear on
 * teardown) is inherited from BaseDemo; this subclass only adds the
 * galaxy-specific build, per-frame work, and teardown the engine cannot
 * infer (OrbitControls.dispose() removes its own canvas listeners, and the
 * bloom pass + GPU resources it created).
 *
 * Visual behavior is identical to the pre-refactor standalone demo — this
 * card is a refactor, not a redesign.
 *
 * Demo contract (see engine/Engine.js):
 *   export function init(container) -> { update, destroy }
 */
class Frontier extends BaseDemo {
  mount(engine) {
    const { scene, camera, renderer } = engine;
    this.scene = scene;
    this.camera = camera;

    // ---- Scene setup (matches the legacy standalone demo) ----
    scene.fog = new THREE.FogExp2(0x000008, 0.0009);
    camera.position.set(0, 60, 260);
    renderer.setClearColor(0x000006);

    // Orbit controls bound to the shared canvas. It attaches its own
    // pointer/wheel listeners directly to renderer.domElement — unmount()
    // calls controls.dispose() to remove them. No separate resize listener is
    // added: the engine already owns a window resize handler that resizes the
    // camera, renderer, and composer (same work the legacy demo's resize did).
    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 900;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;

    // ---- Galaxy of particles arranged in a spiral, colored by radius ----
    this.ARM_COUNT = 5;
    this.PARTICLES = 42000;

    const positions = new Float32Array(this.PARTICLES * 3);
    const colors = new Float32Array(this.PARTICLES * 3);
    const sizes = new Float32Array(this.PARTICLES);
    this.basePositions = new Float32Array(this.PARTICLES * 3);
    this.speeds = new Float32Array(this.PARTICLES);

    const colorCore = new THREE.Color(0xfff0c0);
    const colorMid = new THREE.Color(0x8fd0ff);
    const colorEdge = new THREE.Color(0x7a4bff);

    for (let i = 0; i < this.PARTICLES; i++) {
      const radius = Math.pow(Math.random(), 1.5) * 220 + 2;
      const armOffset = (i % this.ARM_COUNT) * ((Math.PI * 2) / this.ARM_COUNT);
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
      this.basePositions[idx] = radius; // packed as [radius, angle, y]
      this.basePositions[idx + 1] = angle;
      this.basePositions[idx + 2] = y;

      const t = radius / 220;
      const c = new THREE.Color();
      if (t < 0.5) c.copy(colorCore).lerp(colorMid, t * 2);
      else c.copy(colorMid).lerp(colorEdge, (t - 0.5) * 2);
      c.multiplyScalar(0.6 + Math.random() * 0.6);
      colors[idx] = c.r;
      colors[idx + 1] = c.g;
      colors[idx + 2] = c.b;

      sizes[i] = Math.random() * 2.2 + 0.4;
      this.speeds[i] = (0.15 + (1 - t) * 0.9) * (0.5 + Math.random() * 0.5);
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    this.starTexture = (() => {
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

    this.material = new THREE.PointsMaterial({
      size: 2.4,
      map: this.starTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(this.geo, this.material);
    scene.add(points);

    // ---- Central glowing core ----
    this.coreGeo = new THREE.SphereGeometry(6, 32, 32);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
    this.core = new THREE.Mesh(this.coreGeo, this.coreMat);
    scene.add(this.core);

    this.coreLight = new THREE.PointLight(0xfff2c8, 4, 400, 2);
    scene.add(this.coreLight);

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
    this.bgGeo = new THREE.BufferGeometry();
    this.bgGeo.setAttribute("position", new THREE.BufferAttribute(bgPos, 3));
    this.bgMat = new THREE.PointsMaterial({
      size: 1.4,
      color: 0xaaccff,
      map: this.starTexture,
      transparent: true,
      depthWrite: false,
    });
    const bgPoints = new THREE.Points(this.bgGeo, this.bgMat);
    scene.add(bgPoints);

    // ---- Post-processing: bloom for the glow. The engine's composer already
    //      holds a RenderPass; we add only the bloom pass. It is disposed by
    //      unmount() and again (idempotently) by the engine's reset(). ----
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      1.15,
      0.6,
      0.15,
    );
    engine.addPass(this.bloom);

    // ---- HUD (title + hint). Scoped to the demo container by the BaseDemo
    //      scaffold and removed on destroy(). The "back to demos" affordance
    //      is provided by the gallery shell (#back-link), so the old <a> is
    //      omitted. ----
    this.createHud({
      id: "frontier-hud",
      cssText:
        "position:absolute;top:14px;left:16px;color:#cfe8ff;" +
        "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "text-shadow:0 0 6px rgba(80,160,255,0.7);" +
        "pointer-events:none;user-select:none;",
      html:
        '<div><b style="color:#fff">Stellar Drift</b> — a warp-field particle galaxy</div>' +
        "<div>drag to orbit · scroll to zoom</div>",
    });
  }

  update(_delta, elapsed) {
    const posAttr = this.geo.attributes.position;
    const arr = posAttr.array;
    for (let i = 0; i < this.PARTICLES; i++) {
      const idx = i * 3;
      const radius = this.basePositions[idx];
      const angle = this.basePositions[idx + 1] + elapsed * 0.02 * this.speeds[i];
      const y = this.basePositions[idx + 2];
      arr[idx] = Math.cos(angle) * radius;
      arr[idx + 2] = Math.sin(angle) * radius;
      arr[idx + 1] = y + Math.sin(elapsed * 0.6 + radius * 0.05) * 0.6;
    }
    posAttr.needsUpdate = true;

    this.core.scale.setScalar(1 + Math.sin(elapsed * 2) * 0.06);
    this.coreLight.intensity = 3.5 + Math.sin(elapsed * 2) * 0.8;

    this.controls.update();
  }

  unmount() {
    // OrbitControls owns its own pointer/wheel listeners on renderer.domElement
    // — dispose() removes them (the engine's reset() cannot reach them).
    this.controls.dispose();
    // Remove the bloom pass (engine reset() re-sweeps passes, idempotently).
    this.bloom.dispose();
    // Dispose every GPU resource this demo created.
    this.geo.dispose();
    this.material.dispose();
    this.starTexture.dispose();
    this.coreGeo.dispose();
    this.coreMat.dispose();
    this.bgGeo.dispose();
    this.bgMat.dispose();
  }
}

export function init(container) {
  return new Frontier().init(container);
}
