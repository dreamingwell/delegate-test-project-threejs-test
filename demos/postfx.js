import * as THREE from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { BaseDemo } from "../engine/BaseDemo.js";

/**
 * postfx — a genuine multi-pass composer chain, beyond the single bloom the
 * frontier demo already has.
 *
 *   RenderPass (engine-owned, stays first)
 *     -> SSAOPass            (self-occlusion: the "SSAO" of the spec)
 *     -> UnrealBloomPass     (glow on the emissive subject)
 *     -> ChromaticAberration (custom radial CA ShaderPass)
 *     -> Vignette            (custom ShaderPass)
 *     -> FXAA                (final anti-alias pass; the composer auto-sets it
 *                             as the last enabled pass -> renderToScreen)
 *
 * The composer is the engine's; we inject passes via engine.addPass(). engine.reset()
 * disposes every pass (bumping engine.disposedPasses) and re-adds a single RenderPass,
 * so on unload composer.passes -> 1, scene.children -> 0, rafId -> null and the
 * FXAA resize listener (added via engine.addListener) is swept. Leak-free by
 * construction: every listener is registered through engine.addListener.
 *
 * Engine contract: export init(container) -> { update, destroy }.
 */

const fullScreenVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Radial chromatic aberration: R/G/B sampled with an offset that grows toward
// the corners, so the effect is subtle at the centre and visible at the edges.
const ChromaticAberrationShader = {
  name: "ChromaticAberrationShader",
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0.0038 },
  },
  vertexShader: fullScreenVertex,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - 0.5;
      float d = length(dir);
      vec2 off = dir * amount * d;
      float r = texture2D(tDiffuse, vUv - off).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv + off).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

// Soft vignette: darken the frame edges.
const VignetteShader = {
  name: "VignetteShader",
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.75 },
    radius: { value: 0.92 },
  },
  vertexShader: fullScreenVertex,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float radius;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      float d = smoothstep(radius, radius * 0.45, length(vUv - 0.5) * 2.0);
      gl_FragColor = vec4(tex.rgb * (1.0 - d * strength), tex.a);
    }
  `,
};

class PostFxDemo extends BaseDemo {
  mount(engine) {
    this.engine = engine;
    const scene = engine.scene;
    const camera = engine.camera;

    // Dark background so bloom + CA read clearly.
    scene.background = new THREE.Color(0x05070d);

    // --- Subject: a bright, self-lit emissive torus knot (bloom picks it up) ---
    const knotGeo = new THREE.TorusKnotGeometry(0.85, 0.24, 160, 24);
    const knotMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a14,
      emissive: 0x38e0ff,
      emissiveIntensity: 2.4,
      metalness: 0.2,
      roughness: 0.35,
    });
    this.knot = new THREE.Mesh(knotGeo, knotMat);
    this.knot.position.set(0, 1.5, 0);
    scene.add(this.knot);

    // --- Depth cues: emissive spheres at a range of depths (DoF/SSAO range) ---
    const farMat = new THREE.MeshStandardMaterial({
      color: 0x10131f,
      emissive: 0xff5db1,
      emissiveIntensity: 1.6,
      roughness: 0.5,
    });
    const nearMat = new THREE.MeshStandardMaterial({
      color: 0x10131f,
      emissive: 0xffb84d,
      emissiveIntensity: 1.8,
      roughness: 0.5,
    });
    const sphereGeo = new THREE.SphereGeometry(0.34, 32, 24);
    const depths = [
      [-2.2, 2.2, -3.0, farMat],
      [2.3, 1.1, -4.0, farMat],
      [3.1, 2.6, -2.2, farMat],
      [-1.6, 0.7, -1.2, nearMat],
      [1.4, 2.0, -0.6, nearMat],
    ];
    this.spheres = [];
    for (const [x, y, z, mat] of depths) {
      const m = new THREE.Mesh(sphereGeo, mat);
      m.position.set(x, y, z);
      scene.add(m);
      this.spheres.push(m);
    }

    // --- Ground plane: a surface the subject hovers over, so SSAO has a real
    // --- contact shadow to compute.
    const groundGeo = new THREE.PlaneGeometry(24, 24, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0a0d16,
      roughness: 0.95,
      metalness: 0.0,
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.4;
    scene.add(this.ground);

    // --- Lights ---
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 7, 5);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0x223, 0.6));

    // --- Camera: start framed on the subject; a gentle auto-orbit in update(). ---
    camera.position.set(0, 2.0, 7.5);
    camera.lookAt(0, 1.0, -0.5);

    // --- Composer passes (in order). The engine's RenderPass stays first. ---
    const w = innerWidth;
    const h = innerHeight;

    const ssao = new SSAOPass(scene, camera, w, h);
    ssao.kernelRadius = 9;
    ssao.minDistance = 0.0009;
    ssao.maxDistance = 0.05;

    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.55, 0.25);

    const ca = new ShaderPass(ChromaticAberrationShader);
    const vig = new ShaderPass(VignetteShader);
    const fxaa = new ShaderPass(FXAAShader);
    this._setFxaaSize(fxaa, engine);

    // SSAO before bloom: SSAO re-renders the scene + AO and writes it to the
    // buffer, so bloom composites on the AO'd image, not the raw one.
    engine.addPass(ssao);
    engine.addPass(bloom);
    engine.addPass(ca);
    engine.addPass(vig);
    engine.addPass(fxaa);
    this.passes = { ssao, bloom, ca, vig, fxaa };

    // FXAA's resolution uniform must track the actual drawing-buffer size. The
    // engine's own resize handler sizes the composer but not this uniform, so we
    // register a tracked resize listener (swept by engine.reset() on unload).
    this._onResize = () => this._setFxaaSize(this.passes.fxaa, engine);
    engine.addListener(window, "resize", this._onResize);

    this._t = 0;
  }

  _setFxaaSize(fxaa, engine) {
    const s = new THREE.Vector2();
    engine.renderer.getDrawingBufferSize(s);
    fxaa.material.uniforms.resolution.value.set(1 / s.x, 1 / s.y);
  }

  update(delta) {
    this._t += delta;
    const t = this._t;

    // Slow subject spin + gentle bob.
    this.knot.rotation.x = t * 0.35;
    this.knot.rotation.y = t * 0.5;
    this.knot.position.y = 1.5 + Math.sin(t * 0.7) * 0.18;

    // Spheres drift subtly so the depth field is alive.
    for (let i = 0; i < this.spheres.length; i++) {
      const m = this.spheres[i];
      m.position.y += Math.sin(t * 0.9 + i) * 0.0009;
    }

    // Gentle camera orbit around the subject.
    const a = t * 0.18;
    const r = 7.5;
    this.engine.camera.position.set(Math.sin(a) * r, 2.0 + Math.sin(t * 0.3) * 0.4, Math.cos(a) * r);
    this.engine.camera.lookAt(0, 1.0, -0.5);
  }

  unmount() {
    // engine.reset() handles everything it can infer: it disposes every composer
    // pass (this.passes) and re-adds one RenderPass, removes the tracked FXAA
    // resize listener (registered via engine.addListener), and disposes every
    // scene object (knot/spheres/ground/lights) + clears scene.background. No
    // timers/object URLs/in-flight fetches here, so there is nothing
    // engine.reset() cannot infer. Drop our ref to the passes.
    this.passes = null;
  }
}

// Engine contract (see engine/Engine.js + engine/BaseDemo.js):
//   export function init(container) -> { update, destroy }
// BaseDemo.init(container) wires mount/update/unmount and returns the pair.
export function init(container) {
  return new PostFxDemo().init(container);
}
