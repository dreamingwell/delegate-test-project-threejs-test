/**
 * Base class for gallery demos running on the shared Engine.
 *
 * Lifecycle driven by the router (see /app.js):
 *   load(engine)   - async, fetch/build any resources, construct scene objects
 *                    but do not rely on engine.scene having been reset yet by
 *                    the time load() is called for the *first* demo; the
 *                    router always calls engine.reset() before load().
 *   mount(engine)  - attach objects to engine.scene, position engine.camera,
 *                    register listeners via engine.addListener(), add any
 *                    postprocessing passes via engine.addPass().
 *   update(delta, elapsed) - called once per frame while this demo is active.
 *   unmount(engine) - demo-specific teardown before the router calls
 *                    engine.reset(). Scene/material/geometry disposal is
 *                    handled by engine.reset(); use unmount() for anything
 *                    engine.reset() cannot infer (e.g. stopping timers,
 *                    releasing object URLs, canceling in-flight fetches).
 */
export class BaseDemo {
  /**
   * Load/construct demo resources. Called once before mount().
   * @param {import("./Engine.js").Engine} engine
   */
  async load(engine) {}

  /**
   * Attach this demo's objects/camera/passes/listeners to the engine.
   * @param {import("./Engine.js").Engine} engine
   */
  mount(engine) {}

  /**
   * Per-frame update, called by the router's render loop callback.
   * @param {number} delta seconds since last frame
   * @param {number} elapsed seconds since this demo's engine.start() call
   */
  update(delta, elapsed) {}

  /**
   * Demo-specific teardown, called before engine.reset() on route change.
   * @param {import("./Engine.js").Engine} engine
   */
  unmount(engine) {}
}
