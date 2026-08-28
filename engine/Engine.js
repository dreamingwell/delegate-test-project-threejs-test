import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";

/**
 * Shared engine for the Three.js Lab gallery.
 *
 * INVARIANT: the Engine instance, its canvas and its WebGLRenderer live for
 * the lifetime of the page and are never destroyed. Only the Scene and
 * Camera (and anything demos attach to them, plus composer passes and
 * engine-owned listeners) are scrubbed between route changes via reset().
 */
export class Engine {
  /**
   * @param {Object} [opts]
   * @param {HTMLElement} [opts.container] element to mount the canvas into (defaults to document.body)
   * @param {boolean} [opts.hud] show the optional perf HUD (fps + frame ms). Off by default.
   */
  constructor(opts = {}) {
    const { container = document.body, hud = false } = opts;

    this.container = container;

    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);

    this.clock = new THREE.Clock();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // rAF handle. Publicly readable so tooling (e.g. leak audits) can check
    // whether the loop is running: non-null while start()'d, null after stop().
    this.rafId = null;
    this._cb = null;

    // Engine-owned listeners: { target, type, handler }. All demo/engine
    // listeners must be registered via addListener() so they are countable
    // and fully removable on reset().
    this._listeners = [];

    this._onResize = () => this._handleResize();
    this.addListener(window, "resize", this._onResize);

    this._hudEnabled = !!hud;
    this._hudEl = null;
    this._hudAccum = 0;
    this._hudFrames = 0;
    if (this._hudEnabled) this._createHud();
  }

  get listenerCount() {
    return this._listeners.length;
  }

  _handleResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  /**
   * Register a listener so it is tracked, countable via listenerCount, and
   * guaranteed to be removed on reset(). ALL listeners (engine or demo) must
   * be added through this method rather than target.addEventListener directly.
   */
  addListener(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    const entry = { target, type, handler, options };
    this._listeners.push(entry);
    return entry;
  }

  removeListener(entry) {
    const idx = this._listeners.indexOf(entry);
    if (idx === -1) return;
    const { target, type, handler, options } = entry;
    target.removeEventListener(type, handler, options);
    this._listeners.splice(idx, 1);
  }

  _removeAllListeners() {
    for (const { target, type, handler, options } of this._listeners) {
      target.removeEventListener(type, handler, options);
    }
    this._listeners = [];
  }

  /** Start the render loop. cb(delta, elapsed) is called once per frame. */
  start(cb) {
    this._cb = cb;
    this.clock.start();
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      const delta = this.clock.getDelta();
      const elapsed = this.clock.elapsedTime;
      if (this._cb) this._cb(delta, elapsed);
      this.composer.render();
      this._tickHud(delta);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Stop the render loop. rafId is set to null so callers can detect the stopped state. */
  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this._cb = null;
  }

  /**
   * Scrub the scene and camera for a route change. Disposes every
   * geometry/material/texture still attached to the scene graph, clears and
   * disposes composer passes and render targets, resets the camera, and
   * removes every engine-registered listener (demo listeners must have been
   * added via addListener so they are caught here too).
   */
  reset() {
    // Dispose everything left in the scene: geometries, materials, textures.
    this._disposeObject(this.scene);
    while (this.scene.children.length) {
      this.scene.remove(this.scene.children[0]);
    }
    this.scene.background = null;
    this.scene.fog = null;

    // Reset camera to defaults.
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.camera.up.set(0, 1, 0);
    this.camera.fov = 60;
    this.camera.near = 0.1;
    this.camera.far = 5000;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();

    // Clear composer passes and dispose its render targets explicitly.
    this.composer.passes.length = 0;
    if (this.composer.renderTarget1) this.composer.renderTarget1.dispose();
    if (this.composer.renderTarget2) this.composer.renderTarget2.dispose();
    this.composer.readBuffer = this.composer.renderTarget1;
    this.composer.writeBuffer = this.composer.renderTarget2;

    // Recreate a fresh scene/camera pairing on the render pass so the next
    // demo's mount() starts from a clean composer with the same scene/camera
    // objects (they are never replaced, only scrubbed, per invariant).
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Remove every engine-registered listener except the engine's own resize
    // handler, which must persist for the lifetime of the engine.
    const survivors = this._listeners.filter((l) => l.handler === this._onResize);
    for (const entry of this._listeners) {
      if (entry.handler === this._onResize) continue;
      entry.target.removeEventListener(entry.type, entry.handler, entry.options);
    }
    this._listeners = survivors;
  }

  _disposeObject(root) {
    root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) this._disposeMaterial(mat);
      }
    });
  }

  _disposeMaterial(material) {
    for (const key of Object.keys(material)) {
      const value = material[key];
      if (value && value.isTexture) value.dispose();
    }
    material.dispose();
  }

  /** Add a postprocessing pass to the composer. Demos inject bloom, etc. here. */
  addPass(pass) {
    this.composer.addPass(pass);
  }

  /** renderer.info.memory: { geometries, textures } */
  getMemoryStats() {
    return this.renderer.info.memory;
  }

  _createHud() {
    this._hudEl = document.createElement("div");
    Object.assign(this._hudEl.style, {
      position: "fixed",
      bottom: "8px",
      right: "8px",
      padding: "4px 8px",
      background: "rgba(0,0,0,0.55)",
      color: "#8fd0ff",
      font: "11px monospace",
      zIndex: 9999,
      pointerEvents: "none",
    });
    document.body.appendChild(this._hudEl);
  }

  _tickHud(delta) {
    if (!this._hudEnabled || !this._hudEl) return;
    this._hudAccum += delta;
    this._hudFrames++;
    if (this._hudAccum >= 0.5) {
      const fps = this._hudFrames / this._hudAccum;
      const ms = (this._hudAccum / this._hudFrames) * 1000;
      this._hudEl.textContent = `${fps.toFixed(1)} fps · ${ms.toFixed(2)} ms`;
      this._hudAccum = 0;
      this._hudFrames = 0;
    }
  }

  setHudEnabled(enabled) {
    this._hudEnabled = enabled;
    if (enabled && !this._hudEl) this._createHud();
    if (!enabled && this._hudEl) {
      this._hudEl.remove();
      this._hudEl = null;
    }
  }
}
