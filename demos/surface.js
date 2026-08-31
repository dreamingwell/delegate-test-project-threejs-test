import * as THREE from "three";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * surface — "Materials Lab".
 *
 * One PBR torus-knot + a key/fill light rig, on the shared engine.
 * SHOWCASE: the richest live-controls panel in the release.
 *
 * Controls (all live onInput):
 *   - metalness    (slider 0–1)
 *   - roughness    (slider 0–1)
 *   - lightIntensity (slider 0–4)
 *   - lightColor   (select: cool / warm / neon)
 *   - lightAngle   (slider 0–360°, key-light azimuth)
 *   - spinSpeed    (slider 0–3, object rotation multiplier)
 */

class Surface extends BaseDemo {
  mount(engine) {
    const { scene, camera } = engine;
    scene.background = new THREE.Color(0x070a14);
    camera.position.set(0, 0, 6);

    // PBR object.
    this.geo = new THREE.TorusKnotGeometry(1.3, 0.42, 128, 24);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x9fc4ff,
      metalness: 0.4,
      roughness: 0.25,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    scene.add(this.mesh);

    // Light rig: key directional + fill + ambient.
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.position.set(3, 3, 4);
    scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0x5a7bff, 0.5);
    this.fill.position.set(-4, -2, 2);
    scene.add(this.fill);
    scene.add(new THREE.AmbientLight(0x223344, 0.4));
    this.rot = 0; // accumulated rotation angle

    // Live-control state (defaults; shell applies URL values over these).
    this.state = {
      metalness: 0.4,
      roughness: 0.25,
      lightIntensity: 1.6,
      lightColor: "cool",
      lightAngle: 45,
      spinSpeed: 1.0,
    };

    // Apply URL params over defaults (deep-link round-trip).
    const pending = (engine._pendingUrlState && engine._pendingUrlState.params) || {};
    this.appliedParams = {};
    this._controls = controls(this);
    const apply = (key, v) => {
      const spec = this._controls.find((c) => c.key === key);
      if (spec && v !== undefined && v !== "") {
        spec.onInput(v);
        this.appliedParams[key] = v;
      }
    };
    for (const k of Object.keys(pending)) apply(k, pending[k]);
  }

  update(delta, _elapsed) {
    // Delta-integrated so changing spinSpeed mid-run never causes a jump.
    this.rot += delta * 0.6 * this.state.spinSpeed;
    this.mesh.rotation.x = this.rot * 0.667;
    this.mesh.rotation.y = this.rot;

    // Keep key light at the current angle (idempotent; also set in onInput).
    const rad = (this.state.lightAngle * Math.PI) / 180;
    this.key.position.set(Math.sin(rad) * 5, 3, Math.cos(rad) * 5);
  }

  unmount() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * Controls descriptor — the "knobs you turn while it's running" contract.
 * onInput is called LIVE so the scene responds immediately.
 */
function controls(demo) {
  return [
    {
      type: "slider",
      key: "metalness",
      label: "Metalness",
      min: 0, max: 1, step: 0.01,
      value: demo.state.metalness,
      onInput: (v) => { demo.mat.metalness = v; demo.state.metalness = v; },
    },
    {
      type: "slider",
      key: "roughness",
      label: "Roughness",
      min: 0, max: 1, step: 0.01,
      value: demo.state.roughness,
      onInput: (v) => { demo.mat.roughness = v; demo.state.roughness = v; },
    },
    {
      type: "slider",
      key: "lightIntensity",
      label: "Light",
      min: 0, max: 4, step: 0.05,
      value: demo.state.lightIntensity,
      onInput: (v) => { demo.key.intensity = v; demo.state.lightIntensity = v; },
    },
    {
      type: "select",
      key: "lightColor",
      label: "Tint",
      options: [
        { label: "Cool", value: "cool" },
        { label: "Warm", value: "warm" },
        { label: "Neon", value: "neon" },
      ],
      value: demo.state.lightColor,
      onInput: (v) => {
        const c = v === "warm" ? 0xffd27a : v === "neon" ? 0xff4bd8 : 0xffffff;
        demo.key.color.setHex(c);
        demo.state.lightColor = v;
      },
    },
    {
      type: "slider",
      key: "lightAngle",
      label: "Angle",
      min: 0, max: 360, step: 1,
      value: demo.state.lightAngle,
      onInput: (v) => {
        demo.state.lightAngle = v;
        const rad = (v * Math.PI) / 180;
        demo.key.position.set(Math.sin(rad) * 5, 3, Math.cos(rad) * 5);
      },
    },
    {
      type: "slider",
      key: "spinSpeed",
      label: "Spin",
      min: 0, max: 3, step: 0.1,
      value: demo.state.spinSpeed,
      onInput: (v) => { demo.state.spinSpeed = v; },
    },
  ];
}

export function init(container) {
  const demo = new Surface();
  const handle = demo.init(container);
  handle.shell = {
    controls: demo._controls || [],
    appliedParams: demo.appliedParams || {},
  };
  return handle;
}
