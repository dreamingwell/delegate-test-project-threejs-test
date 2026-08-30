import * as THREE from "three";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * physics — a Verlet-cloth collision simulation.
 *
 * A grid of point masses (a cloth) falls under gravity and drapes over a
 * rigid "ball-pit": a set of spheres plus an AABB box sitting on a floor.
 * The cloth is a distance-constraint lattice solved with Gauss–Seidel
 * iterations; each point is collided per sub-step against the spheres, the
 * box and the floor. Pure CPU in update() with a fixed-step accumulator and a
 * clamped delta — no external physics engine (keeps the zero-build, static
 * constraint).
 *
 * The ball-pit bodies are static (immovable) — a ball-pit is the classic
 * rigid-body collider a soft body deforms against. (A fully dynamic rigid-
 * body stack would be a heavier dependency; this shows the physics clearly
 * and stays within the engine contract.)
 *
 * Engine contract: export init(container) -> { update, destroy }.
 * Leak-free: the cloth geometry/material are scene children disposed by
 * engine.reset(); no engine listeners or timers are created here, so
 * listenerCount stays at the engine baseline and disposedPasses is unaffected.
 */

const COLS = 18;      // cloth points across (X)
const ROWS = 14;      // cloth points down (Y)
const SPACING = 0.22; // distance between points
const ITERATIONS = 5; // Gauss–Seidel constraint passes per sub-step
const FIXED_STEP = 1 / 60; // seconds
const POINT_RADIUS = 0.05; // cloth point collision radius (thickness)
const HANG_Y = 4.2;    // initial y of the pinned top row

// Rigid colliders (static ball-pit).
const FLOOR_Y = 0;
const SPHERES = [
  { x: -1.5, y: 0.7, z: 0.0, r: 0.7 },
  { x: 0.0, y: 0.95, z: 0.15, r: 0.95 },
  { x: 1.5, y: 0.7, z: 0.0, r: 0.7 },
  { x: -0.9, y: 0.5, z: 0.9, r: 0.5 },
  { x: 0.9, y: 0.5, z: -0.9, r: 0.5 },
];
const BOX = { x: 0.0, y: 0.45, z: 0.0, hx: 0.5, hy: 0.45, hz: 0.5 }; // AABB (centre + half-extents)

class PhysicsDemo extends BaseDemo {
  mount(engine) {
    this.engine = engine;
    const scene = engine.scene;

    scene.background = new THREE.Color(0x080b12);
    scene.fog = new THREE.Fog(0x080b12, 14, 40);

    const clothW = (COLS - 1) * SPACING;
    const clothH = (ROWS - 1) * SPACING;

    // --- Verlet state ---
    this.px = new Float32Array(COLS * ROWS);
    this.py = new Float32Array(COLS * ROWS);
    this.pz = new Float32Array(COLS * ROWS);
    this.ox = new Float32Array(COLS * ROWS); // previous position (Verlet)
    this.oy = new Float32Array(COLS * ROWS);
    this.oz = new Float32Array(COLS * ROWS);
    this.pinned = new Uint8Array(COLS * ROWS);

    const halfW = clothW / 2;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const x = -halfW + c * SPACING;
        const y = HANG_Y - r * SPACING;
        const z = 0;
        this.px[i] = x; this.py[i] = y; this.pz[i] = z;
        this.ox[i] = x; this.oy[i] = y; this.oz[i] = z;
        if (r === 0) this.pinned[i] = 1; // pin the top row so the cloth hangs
      }
    }

    // --- Distance constraints (structural + shear + bend) ---
    const at = (r, c) => r * COLS + c;
    const constraints = []; // [a, b, restLength]
    const add = (a, b) => constraints.push([a, b, this._rest(this.px, this.py, this.pz, a, b)]);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c + 1 < COLS) add(at(r, c), at(r, c + 1));        // structural (X)
        if (r + 1 < ROWS) add(at(r, c), at(r + 1, c));        // structural (Y)
        if (c + 1 < COLS && r + 1 < ROWS) add(at(r, c), at(r + 1, c + 1));   // shear
        if (c + 1 < COLS && r + 1 < ROWS) add(at(r, c + 1), at(r + 1, c));   // shear
        if (c + 2 < COLS) add(at(r, c), at(r, c + 2));        // bend (X)
        if (r + 2 < ROWS) add(at(r, c), at(r + 2, c));        // bend (Y)
      }
    }
    this.constraints = constraints;

    // --- Cloth geometry (indexed, double-sided, vertex-coloured by row) ---
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COLS * ROWS * 3);
    const col = new Float32Array(COLS * ROWS * 3);
    const top = new THREE.Color(0xffd27a); // warm
    const bot = new THREE.Color(0x4aa0ff); // cool
    const tmp = new THREE.Color();
    for (let i = 0; i < COLS * ROWS; i++) {
      tmp.copy(top).lerp(bot, i / (COLS * ROWS - 1));
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const idx = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        const a = at(r, c), b = at(r, c + 1), d = at(r + 1, c), e = at(r + 1, c + 1);
        idx.push(a, d, b, b, d, e);
      }
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0.05,
    });
    this.cloth = new THREE.Mesh(geo, mat);
    this._posAttr = geo.getAttribute("position");
    this._normAttr = geo.getAttribute("normal");
    scene.add(this.cloth);

    // --- Rigid ball-pit bodies (visual only; colliders are the constants) ---
    this.rigidBodies = [];
    const sphereGeo = new THREE.SphereGeometry(1, 40, 28);
    for (const s of SPHERES) {
      const m = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({
        color: 0x1b2436, roughness: 0.35, metalness: 0.25,
      }));
      m.position.set(s.x, s.y, s.z);
      m.scale.setScalar(s.r);
      scene.add(m);
      this.rigidBodies.push(m);
    }
    const boxMesh = new THREE.Mesh(
      new THREE.BoxGeometry(BOX.hx * 2, BOX.hy * 2, BOX.hz * 2),
      new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.4, metalness: 0.3 }),
    );
    boxMesh.position.set(BOX.x, BOX.y, BOX.z);
    scene.add(boxMesh);
    this.rigidBodies.push(boxMesh);

    // --- Floor ---
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0x0c111c, roughness: 1.0, metalness: 0.0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    scene.add(floor);

    // --- Lights ---
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(5, 9, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x66aaff, 0.5);
    rim.position.set(-4, 3, -5);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x334, 0.7));

    // --- Camera: fixed, framed on the action. A slight orbit in update(). ---
    engine.camera.position.set(0, 3.0, 9.5);
    engine.camera.lookAt(0, 1.4, 0);

    this._acc = 0;
    this._t = 0;
  }

  _rest(px, py, pz, a, b) {
    const dx = px[a] - px[b], dy = py[a] - py[b], dz = pz[a] - pz[b];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _subStep(dt) {
    const { px, py, pz, ox, oy, oz, pinned } = this;
    const n = px.length;
    const g = -9.8 * dt * dt; // Verlet gravity (velocity-less form)
    const wind = Math.sin(this._t * 1.3) * 0.02 * dt * dt; // gentle sway

    // Integrate (Verlet): pos += pos - prev + accel.
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const vx = (px[i] - ox[i]) * 0.985; // mild damping
      const vy = (py[i] - oy[i]) * 0.985;
      const vz = (pz[i] - oz[i]) * 0.985;
      ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];
      px[i] += vx + wind; // wind along X
      py[i] += vy + g;
      pz[i] += vz;
    }

    // Satisfy distance constraints (Gauss–Seidel).
    const c = this.constraints;
    for (let k = 0; k < ITERATIONS; k++) {
      for (let j = 0; j < c.length; j++) {
        const a = c[j][0], b = c[j][1], rest = c[j][2];
        let dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (len - rest) / len;
        if (pinned[a]) { // move only the free end
          px[b] -= dx * diff; py[b] -= dy * diff; pz[b] -= dz * diff;
        } else if (pinned[b]) {
          px[a] += dx * diff; py[a] += dy * diff; pz[a] += dz * diff;
        } else {
          const half = diff * 0.5;
          px[a] += dx * half; py[a] += dy * half; pz[a] += dz * half;
          px[b] -= dx * half; py[b] -= dy * half; pz[b] -= dz * half;
        }
      }
    }

    // Collide every point with the floor, the box (AABB), and the spheres.
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;

      // Floor.
      if (py[i] < FLOOR_Y + POINT_RADIUS) {
        py[i] = FLOOR_Y + POINT_RADIUS;
      }

      // Box (AABB closest-point push-out).
      this._collideAABB(i);

      // Spheres (surface push-out).
      for (const s of SPHERES) {
        const dx = px[i] - s.x, dy = py[i] - s.y, dz = pz[i] - s.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const min = s.r + POINT_RADIUS;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 1e-6;
          px[i] = s.x + (dx / d) * min;
          py[i] = s.y + (dy / d) * min;
          pz[i] = s.z + (dz / d) * min;
        }
      }
    }
  }

  _collideAABB(i) {
    const { px, py, pz } = this;
    // Closest point on the AABB to the cloth point.
    const cx = Math.max(BOX.x - BOX.hx, Math.min(px[i], BOX.x + BOX.hx));
    const cy = Math.max(BOX.y - BOX.hy, Math.min(py[i], BOX.y + BOX.hy));
    const cz = Math.max(BOX.z - BOX.hz, Math.min(pz[i], BOX.z + BOX.hz));
    const dx = px[i] - cx, dy = py[i] - cy, dz = pz[i] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < POINT_RADIUS * POINT_RADIUS) {
      const d = Math.sqrt(d2);
      if (d > 1e-6) {
        const push = (POINT_RADIUS - d) / d;
        px[i] += dx * push; py[i] += dy * push; pz[i] += dz * push;
      } else {
        // Point is at the AABB centre (degenerate); push straight up.
        py[i] = BOX.y + BOX.hy + POINT_RADIUS;
      }
    }
  }

  update(delta) {
    this._t += delta;
    // Fixed-step accumulator, clamped so a slow frame can't explode the sim.
    this._acc += Math.min(delta, 0.1);
    let steps = 0;
    while (this._acc >= FIXED_STEP && steps < 5) {
      this._subStep(FIXED_STEP);
      this._acc -= FIXED_STEP;
      steps++;
    }

    // Push Verlet positions into the cloth geometry.
    const arr = this._posAttr.array;
    const n = this.px.length;
    for (let i = 0; i < n; i++) {
      arr[i * 3] = this.px[i];
      arr[i * 3 + 1] = this.py[i];
      arr[i * 3 + 2] = this.pz[i];
    }
    this._posAttr.needsUpdate = true;
    this.cloth.geometry.computeVertexNormals();

    // Gentle camera orbit so the drape reads from every angle.
    const a = this._t * 0.15;
    const r = 9.5;
    this.engine.camera.position.set(Math.sin(a) * r, 3.0 + Math.sin(this._t * 0.3) * 0.3, Math.cos(a) * r);
    this.engine.camera.lookAt(0, 1.4, 0);
  }

  unmount() {
    // engine.reset() disposes the cloth + ball-pit + floor scene objects and
    // their materials. No engine listeners, timers or object URLs were created,
    // so listenerCount returns to the engine baseline on unload. Drop refs.
    this.constraints = null;
    this.px = this.py = this.pz = this.ox = this.oy = this.oz = null;
  }
}

// Engine contract (see engine/Engine.js + engine/BaseDemo.js):
//   export function init(container) -> { update, destroy }
// BaseDemo.init(container) wires mount/update/unmount and returns the pair.
export function init(container) {
  return new PhysicsDemo().init(container);
}
