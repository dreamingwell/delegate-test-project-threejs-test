import { getDemo, DEMOS } from "../engine/registry.js";

/**
 * Hash-based deep-linkable router: #/demo/<id>.
 *
 * On every navigation it unloads whatever demo is currently active
 * (engine.unload() -> stops the shared rAF loop, calls the demo's own
 * destroy(), then scrubs scene/camera/composer/listeners) BEFORE importing
 * and loading the next one, so there is never a moment with two demos'
 * resources both live.
 */
export class Router {
  /**
   * @param {import("../engine/Engine.js").Engine} engine
   * @param {(text: string) => void} [onMessage] called with a status/error
   *   string when there is nothing (yet) to render, e.g. no route or an
   *   unknown/failed demo id. Optional; defaults to a no-op.
   */
  constructor(engine, onMessage) {
    this.engine = engine;
    this.onMessage = onMessage || (() => {});
    this.currentId = null;
    this._navToken = 0;
    this._onHashChange = () => this.navigate();
    addEventListener("hashchange", this._onHashChange);
  }

  parseHash() {
    const m = location.hash.match(/^#\/demo\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async navigate() {
    const id = this.parseHash();
    const myToken = ++this._navToken;

    if (!id) {
      this.engine.unload();
      this.currentId = null;
      this.onMessage("Pick a demo: " + DEMOS.map((d) => `#/demo/${d.id}`).join(", "));
      return;
    }

    const demo = getDemo(id);
    if (!demo) {
      this.engine.unload();
      this.currentId = null;
      this.onMessage(`Unknown demo "${id}". Available: ${DEMOS.map((d) => d.id).join(", ")}`);
      return;
    }

    if (id === this.currentId) return;

    try {
      await this.engine.load(demo.module);
    } catch (err) {
      if (myToken !== this._navToken) return; // superseded
      console.error(`Failed to load demo "${id}":`, err);
      this.currentId = null;
      this.onMessage(`Failed to load demo "${id}". See console for details.`);
      return;
    }

    if (myToken !== this._navToken) return; // a newer navigation superseded this one
    this.currentId = id;
    this.onMessage("");
  }

  /** Remove the router's own hashchange listener (does not touch the engine). */
  destroy() {
    removeEventListener("hashchange", this._onHashChange);
  }
}
