import * as THREE from "three";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * flow — "Curl-Noise Flow Field" (ANIMATED STUB for the Shell foundation card).
 *
 * Placeholder that boots cleanly on the shared engine and showcases the perf
 * readout (crank the count, watch fps/triangles climb). It will be REPLACED in
 * full by the "flow" demo card — that card owns this file and rewrites the body
 * (tens of thousands of genuinely advected particles; knobs for turbulence,
 * speed, count, trails).
 *
 * Engine contract: export init(container) -> { update, destroy }, plus an
 * optional handle.shell = { controls, appliedParams } the shell reads.
 */

class Flow extends BaseDemo {
  mount(engine) {
    const { scene, camera } = engine;
    scene.background = new THREE.Color(0x05070f);
    camera.position.set(0, 0, 60);

    // Particle buffer (advected each frame by a cheap curl-ish field).
    this.MAX = 20000;
    this.count = 6000; // live count (the "count" knob changes this)
    this.speed = 1.0;
    this.turbulence = 1.0;
    this.trail = 0.5; // placeholder proxy -> point size / opacity

    this.positions = new Float32Array(this.MAX * 3);
    for (let i = 0; i < this.MAX; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * 120;
      this.positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.posAttr);
    this.geo.setDrawRange(0, this.count);

    this.mat = new THREE.PointsMaterial({
      color: 0x7fd0ff,
      size: 0.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    scene.add(this.points);
    scene.add(new THREE.AmbientLight(0x334455, 0.5));

    // Apply URL values over the defaults (deep-link round-trip).
    this._controls = controls(this);
    const pending = (engine._pendingUrlState && engine._pendingUrlState.params) || {};
    this.appliedParams = {};
    for (const k of Object.keys(pending)) {
      const spec = this._controls.find((c) => c.key === k);
      if (spec && pending[k] !== undefined && pending[k] !== "") {
        spec.onInput(pending[k]);
        this.appliedParams[k] = pending[k];
      }
    }
  }

  update(_delta, elapsed) {
    const pos = this.posAttr.array;
    const t = elapsed * 0.3;
    const sp = this.speed;
    const tur = this.turbulence;
    for (let i = 0; i < this.count; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      // Cheap curl-ish field (not a true curl-noise solver — stub).
      const a = Math.sin(y * 0.05 * tur + t) + Math.cos(z * 0.07 * tur - t);
      const b = Math.sin(z * 0.05 * tur + t * 1.2) + Math.cos(x * 0.06 * tur + t);
      pos[i * 3] = x + a * 0.12 * sp;
      pos[i * 3 + 1] = y + b * 0.12 * sp;
      pos[i * 3 + 2] = z + Math.sin(x * 0.04 * tur + t) * 0.05 * sp;
      // Wrap into the box.
      if (pos[i * 3] > 60) pos[i * 3] = -60; else if (pos[i * 3] < -60) pos[i * 3] = 60;
      if (pos[i * 3 + 1] > 40) pos[i * 3 + 1] = -40; else if (pos[i * 3 + 1] < -40) pos[i * 3 + 1] = 40;
    }
    this.posAttr.needsUpdate = true;
  }

  unmount() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

function controls(demo) {
  return [
    {
      type: "slider",
      key: "count",
      label: "Count",
      min: 500, max: 20000, step: 500,
      value: demo.count,
      onInput: (v) => {
        demo.count = Math.round(v);
        demo.geo.setDrawRange(0, demo.count);
      },
    },
    {
      type: "slider",
      key: "speed",
      label: "Speed",
      min: 0, max: 4, step: 0.1,
      value: demo.speed,
      onInput: (v) => { demo.speed = v; },
    },
    {
      type: "slider",
      key: "turbulence",
      label: "Turb.",
      min: 0, max: 3, step: 0.1,
      value: demo.turbulence,
      onInput: (v) => { demo.turbulence = v; },
    },
    {
      type: "slider",
      key: "trails",
      label: "Trails",
      min: 0, max: 1, step: 0.05,
      value: demo.trail,
      onInput: (v) => {
        demo.trail = v;
        // Stub proxy: longer "trails" -> dimmer, smaller points.
        demo.mat.opacity = 0.9 - v * 0.4;
        demo.mat.size = 0.5 - v * 0.25;
      },
    },
  ];
}

export function init(container) {
  const demo = new Flow();
  const handle = demo.init(container);
  handle.shell = {
    controls: demo._controls || [],
    appliedParams: demo.appliedParams || {},
  };
  return handle;
}
