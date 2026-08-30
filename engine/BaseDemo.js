/**
 * Base class for gallery demos running on the shared Engine.
 *
 * This is the shared scaffold every demo builds on. A concrete demo
 * subclasses BaseDemo, implements `mount(engine)` (build scene objects,
 * position the camera, register listeners via engine.addListener, add any
 * postprocessing passes via engine.addPass), `update(delta, elapsed)`
 * (per-frame work), and `unmount()` (demo-specific teardown for anything
 * engine.reset() cannot infer — e.g. OrbitControls.dispose(), a HUD element,
 * or a non-scene texture).
 *
 * The module's exported `init(container)` is still the single entry point
 * the Engine calls (see engine/Engine.js), so the engine contract is
 * unchanged:
 *
 *     init(container) -> { update, destroy }
 *
 * The boilerplate each demo used to reimplement is now provided here once:
 *   - the `active` guard (update/destroy are idempotent — a second destroy()
 *     or an in-flight update() after unload is a no-op),
 *   - demo-scoped HUD element management (createHud / attachHud / removeHud),
 *   - clearing scene.fog / scene.background on teardown (idempotent; the
 *     engine's reset() also clears them),
 *   - relying on the engine's tracked listeners for teardown: any listener
 *     a demo registers via engine.addListener() is counted by
 *     engine.listenerCount and removed by engine.reset() on unload, so a
 *     demo cannot leak them. (Listeners added directly to
 *     renderer.domElement, e.g. by OrbitControls, are NOT engine-tracked and
 *     must be removed in unmount() via the owning object's dispose().)
 */
export class BaseDemo {
  /** @type {import("./Engine.js").Engine} */
  engine = null;
  /** @type {HTMLElement} */
  container = null;
  /** @type {HTMLElement|null} demo-scoped HUD element, removed on destroy() */
  _hud = null;
  /** @type {boolean} true while this demo is active; makes update/destroy idempotent */
  _active = false;

  /**
   * Shared init. Validates the shared engine, stashes refs, marks the demo
   * active, runs the subclass's mount(), and returns the { update, destroy }
   * pair the Engine's load() expects.
   *
   * @param {HTMLElement} container the mount element; container.engine must
   *   already be the shared Engine instance (the Engine sets it before
   *   calling init()).
   * @returns {{ update: (delta: number, elapsed: number) => void,
   *             destroy: () => void }}
   */
  init(container) {
    this.container = container;
    const engine = container.engine;
    if (!engine) throw new Error("BaseDemo: container.engine is not set");
    this.engine = engine;
    this._active = true;
    this.mount(engine);
    return {
      update: (delta, elapsed) => this._update(delta, elapsed),
      destroy: () => this.destroy(),
    };
  }

  /**
   * Attach this demo's objects/camera/passes/listeners to the engine.
   * Build scene objects into engine.scene, position engine.camera, register
   * listeners via engine.addListener() (engine-tracked, removed on reset()),
   * and add any postprocessing passes via engine.addPass().
   *
   * @param {import("./Engine.js").Engine} engine
   */
  mount(engine) {}

  /**
   * Per-frame work, called once per frame by the engine's single rAF loop.
   * @param {number} delta seconds since last frame
   * @param {number} elapsed seconds since this demo's engine.start()
   */
  update(_delta, _elapsed) {}

  /**
   * Demo-specific teardown for anything engine.reset() cannot infer
   * (OrbitControls.dispose(), non-scene textures, stopping timers, releasing
   * object URLs). Runs before the engine's reset() on unload.
   */
  unmount() {}

  _update(delta, elapsed) {
    if (!this._active) return;
    this.update(delta, elapsed);
  }

  /**
   * Shared teardown. Runs the subclass's unmount() once, then removes the
   * demo-scoped HUD and clears scene.fog / scene.background. Idempotent via
   * the _active flag — a second call is a no-op. The engine's reset()
   * additionally disposes every remaining scene geometry/material and every
   * composer pass, and removes every listener registered via
   * engine.addListener(), so nothing leaks even if unmount() is incomplete.
   */
  destroy() {
    if (!this._active) return;
    this._active = false;
    this.unmount();
    this.removeHud();
    const scene = this.engine.scene;
    scene.fog = null;
    scene.background = null;
  }

  /**
   * Build + attach a demo-scoped HUD element.
   * @param {{ id?: string, cssText?: string, html?: string }} [opts]
   * @returns {HTMLElement} the HUD element (also stored on this._hud).
   */
  createHud(opts = {}) {
    const hud = document.createElement("div");
    if (opts.id) hud.id = opts.id;
    if (opts.cssText) hud.style.cssText = opts.cssText;
    if (opts.html !== undefined && opts.html !== null) hud.innerHTML = opts.html;
    this.attachHud(hud);
    return hud;
  }

  /**
   * Attach an already-built HUD element (for demos whose HUD is more than a
   * flat HTML string). Stored on this._hud and removed on destroy().
   * @param {HTMLElement} hud
   * @returns {HTMLElement} the same element, for convenience.
   */
  attachHud(hud) {
    this._hud = hud;
    this.container.appendChild(hud);
    return hud;
  }

  /** Remove the demo-scoped HUD element (no-op if none). */
  removeHud() {
    if (this._hud) {
      this._hud.remove();
      this._hud = null;
    }
  }
}
