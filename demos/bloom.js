import * as THREE from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * bloom — "Bloom Playground" (ANIMATED STUB for the Shell foundation card).
 *
 * A small neon scene with an emissive subject + a bloom pass. It showcases the
 * QUALITY TIERS: Low/Med/High change the pixel ratio AND the bloom pass
 * strength (via the shell's quality system, which scales the bloom pass this
 * demo added), so the scene VISIBLY softens/dims at Low and gets fuller at
 * High. The live "Glow" knob drives the emissive strength independently.
 *
 * It will be REPLACED in full by the "bloom" demo card — that card owns this
 * file and rewrites the body (a neon scene where Low/Med/High visibly change
 * pixel ratio + bloom resolution/strength).
 *
 * Engine contract: export init(container) -> { update, destroy }, plus an
 * optional handle.shell = { controls, appliedParams } the shell reads.
 */

class Bloom extends BaseDemo {
  mount(engine) {
    const { scene, camera, renderer } = engine;
    scene.background = new THREE.Color(0x02030a);
    camera.position.set(0, 0, 7);

    // A neon emissive subject (rotating) + a ring of glowing dots.
    this.geo = new THREE.IcosahedronGeometry(1.6, 1);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0x33aaff,
      emissiveIntensity: 1.4,
      metalness: 0.2,
      roughness: 0.4,
    });
    this.core = new THREE.Mesh(this.geo, this.mat);
    scene.add(this.core);

    this.ringGeo = new THREE.TorusGeometry(3.2, 0.08, 12, 96);
    this.ringMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xff4bd8,
      emissiveIntensity: 1.6,
    });
    this.ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    this.ring.rotation.x = Math.PI / 3;
    scene.add(this.ring);

    // A single bloom pass (the engine's composer already holds a RenderPass).
    // The shell's quality tier scales this pass's strength (Low dimmer, High
    // fuller) and the pixel ratio, so the scene visibly changes per tier.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      1.1, 0.5, 0.2,
    );
    engine.addPass(this.bloom);
    // Capture the base strength so repeated quality.applyTier() calls never
    // compound the multiplier (the quality system keys off this base).
    this._bloomBase = this.bloom.strength;

    this.emissiveIntensity = 1.4;

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
    this.core.rotation.y = elapsed * 0.6;
    this.core.rotation.x = elapsed * 0.25;
    this.ring.rotation.z = elapsed * 0.4;
    // Gentle pulse so the glow is clearly alive.
    const pulse = 1 + Math.sin(elapsed * 1.5) * 0.12;
    this.mat.emissiveIntensity = this.emissiveIntensity * pulse;
    this.ringMat.emissiveIntensity = this.emissiveIntensity * 1.15 * pulse;
  }

  unmount() {
    this.bloom.dispose();
    this.geo.dispose();
    this.mat.dispose();
    this.ringGeo.dispose();
    this.ringMat.dispose();
  }
}

function controls(demo) {
  return [
    {
      type: "slider",
      key: "glow",
      label: "Glow",
      min: 0, max: 4, step: 0.05,
      value: demo.emissiveIntensity,
      onInput: (v) => { demo.emissiveIntensity = v; },
    },
    {
      type: "select",
      key: "neon",
      label: "Neon",
      options: [
        { label: "Cyan", value: "cyan" },
        { label: "Magenta", value: "magenta" },
        { label: "Green", value: "green" },
      ],
      value: "cyan",
      onInput: (v) => {
        const map = { cyan: 0x33aaff, magenta: 0xff4bd8, green: 0x5aff8f };
        demo.mat.emissive.setHex(map[v]);
      },
    },
  ];
}

export function init(container) {
  const demo = new Bloom();
  const handle = demo.init(container);
  handle.shell = {
    controls: demo._controls || [],
    appliedParams: demo.appliedParams || {},
  };
  return handle;
}
