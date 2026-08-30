import * as THREE from "three";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * Local demo — "Murmuration", a starling flock (boids).
 *
 * Built on the shared engine + the BaseDemo scaffold (engine/BaseDemo.js).
 * Instead of creating a second renderer/context it builds into
 * `container.engine.scene` / `.camera` and registers per-frame work with the
 * engine's single rAF loop. The shared boilerplate (active guard, HUD
 * element management, fog/background clear on teardown) is inherited from
 * BaseDemo; the pointermove listener is registered via engine.addListener so
 * the engine tracks, counts, and removes it — no manual removeListener needed.
 *
 * Visual behavior is identical to the pre-refactor standalone demo — this
 * card is a refactor, not a redesign.
 *
 * Demo contract (see engine/Engine.js):
 *   export function init(container) -> { update, destroy }
 */
class Local extends BaseDemo {
  mount(engine) {
    const { scene, camera } = engine;
    this.scene = scene;
    this.camera = camera;

    // ---- Scene setup (matches the legacy standalone demo) ----
    scene.background = new THREE.Color(0x05070d);
    scene.fog = new THREE.FogExp2(0x05070d, 0.012);

    // Glow sprite texture shared by the points material.
    this.glowTexture = makeGlowSprite();

    // ---- Flock state ----
    this.COUNT = 340;
    this.pos = new Float32Array(this.COUNT * 3);
    this.col = new Float32Array(this.COUNT * 3);
    this.vel = new Float32Array(this.COUNT * 3);
    const pos = this.pos, col = this.col, vel = this.vel;
    for (let i = 0; i < this.COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 50;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 50;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
      vel[i * 3] = (Math.random() - 0.5) * 10;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 10;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

    this.material = new THREE.PointsMaterial({
      size: 1.5,
      map: this.glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(this.geo, this.material);
    scene.add(points);

    // ---- Pointer input (herd the swarm). Registered via the engine so it is
    //      tracked, counted via listenerCount, and removed on reset(); the
    //      BaseDemo scaffold does not need to remove it explicitly. ----
    this.mouse = new THREE.Vector2(0, 0);
    const onPointerMove = (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    engine.addListener(window, "pointermove", onPointerMove);

    // ---- Flocking constants + scratch objects ----
    this._a = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this.herd = new THREE.Vector3();
    this.target = new THREE.Color(0x86b6ff);
    this.hot = new THREE.Color(0xffd9a0);
    this.MAXS = 13;
    this.MINS = 4;
    this.RAD = 7;
    this.RADSQ = this.RAD * this.RAD;
    this.SEP = 9;
    this.MAXF = 60;

    // ---- Camera orbit state ----
    this.camA = 0;

    // ---- HUD (title + hint). Scoped to the demo container by the BaseDemo
    //      scaffold and removed on destroy(). The "back to demos" affordance
    //      is provided by the gallery shell (#back-link), so the old <a> is
    //      omitted. ----
    this.createHud({
      id: "local-hud",
      cssText:
        "position:absolute;top:14px;left:16px;color:#9fb4d8;" +
        "font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.4px;" +
        "text-shadow:0 1px 3px #000;opacity:.92;pointer-events:none;user-select:none;",
      html:
        '<b style="color:#eaf2ff;font-weight:600">Murmuration</b> &mdash; a starling flock<br/>' +
        "move your mouse to herd the swarm",
    });
  }

  updateHerd() {
    const { camera } = this;
    this._u.set(this.mouse.x, this.mouse.y, 0.5).unproject(camera)
      .sub(camera.position).normalize().multiplyScalar(30);
    this.herd.copy(camera.position).add(this._u);
  }

  sim(dt, tt) {
    const { pos, vel, col, geo, MAXS, MINS, RADSQ, SEP, MAXF } = this;
    const COUNT = this.COUNT;
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
      const _a = this._a;
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
      const { herd } = this;
      _a.x += (herd.x - px) * 0.6; _a.y += (herd.y - py) * 0.6; _a.z += (herd.z - pz) * 0.6;
      _a.clampLength(0, MAXF);
      vel[i * 3] += _a.x * dt; vel[i * 3 + 1] += _a.y * dt; vel[i * 3 + 2] += _a.z * dt;
      let vx = vel[i * 3], vy = vel[i * 3 + 1], vz = vel[i * 3 + 2];
      let sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > MAXS) { const k = MAXS / sp; vx *= k; vy *= k; vz *= k; }
      else if (sp < MINS && sp > 0) { const k = MINS / sp; vx *= k; vy *= k; vz *= k; }
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    }
    const target = this.target, hot = this.hot;
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

  update(delta, elapsed) {
    const { camera } = this;
    const dt = Math.min(delta, 0.05) || 0.016;
    this.updateHerd();
    this.sim(dt, elapsed * 0.6);
    this.camA += dt * 0.08;
    const r = 70;
    camera.position.set(Math.sin(this.camA) * r, 6 + Math.sin(this.camA * 0.7) * 8, Math.cos(this.camA) * r);
    camera.lookAt(0, 0, 0);
  }

  unmount() {
    // Explicit, idempotent extra cleanup the engine's reset() does not cover
    // (reset() disposes the scene objects and removes the tracked
    // pointermove listener; these dispose the non-scene resources this demo
    // created so the module is leak-free even if reset() were skipped).
    this.geo.dispose();        // flock geometry
    this.material.dispose();   // points material
    this.glowTexture.dispose(); // glow sprite texture
  }
}

export function init(container) {
  return new Local().init(container);
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
