import * as THREE from "three";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * surface — "Materials Lab" (ANIMATED STUB for the Shell foundation card).
 *
 * This is a placeholder that boots cleanly on the shared engine and exposes
 * the live-controls contract, so the Shell card's deep-link round-trip and
 * the shell video have a real, live demo to drag knobs on. It will be REPLACED
 * in full by the "surface" demo card — that card owns this file and rewrites
 * the body (one PBR object + a light rig; knobs for metalness, roughness,
 * light intensity, light color, bloom strength).
 *
 * Engine contract: export init(container) -> { update, destroy }, plus an
 * optional handle.shell = { controls, appliedParams } the shell reads.
 */

class Surface extends BaseDemo {
  mount(engine) {
    const { scene, camera } = engine;
    scene.background = new THREE.Color(0x070a14);
    camera.position.set(0, 0, 6);

    // One PBR object.
    this.geo = new THREE.TorusKnotGeometry(1.3, 0.42, 128, 24);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x9fc4ff,
      metalness: 0.4,
      roughness: 0.25,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    scene.add(this.mesh);

    // A light rig: a key directional light + a fill.
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.position.set(3, 3, 4);
    scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0x5a7bff, 0.5);
    this.fill.position.set(-4, -2, 2);
    scene.add(this.fill);
    scene.add(new THREE.AmbientLight(0x223344, 0.4));

    // Live-control state (defaults; the shell applies URL values over these).
    this.state = {
      metalness: 0.4,
      roughness: 0.25,
      lightIntensity: 1.6,
      lightColor: "cool",
    };

    // Apply any URL-provided values over the defaults (deep-link round-trip).
    const pending = (engine._pendingUrlState && engine._pendingUrlState.params) || {};
    this.appliedParams = {};
    const apply = (key, v) => {
      const spec = this._controls.find((c) => c.key === key);
      if (spec && v !== undefined && v !== "") {
        spec.onInput(v);
        this.appliedParams[key] = v;
      }
    };
    // controls() below closes over `this`; call it now to seed _controls.
    this._controls = controls(this);
    for (const k of Object.keys(pending)) apply(k, pending[k]);
  }

  update(_delta, elapsed) {
    this.mesh.rotation.x = elapsed * 0.4;
    this.mesh.rotation.y = elapsed * 0.6;
  }

  unmount() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * The controls descriptor (the "knobs you turn while it's running" contract).
 * onInput is called LIVE, so dragging updates the scene immediately.
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
      label: "Light",
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
