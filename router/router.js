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
    // The full hash we last loaded. Used to detect a query-only change on the
    // same demo (e.g. a pasted deep link with different params) and reload so
    // the URL's state is applied. The shell's own live serialization uses
    // history.replaceState (no hashchange), so dragging a slider does NOT
    // trigger a reload here — only a real URL change does.
    this._lastHash = location.hash;
    this._onHashChange = () => this.navigate();
    addEventListener("hashchange", this._onHashChange);
  }

  parseHash() {
    // Tolerate a query string on the id: #/demo/<id>?<...> still resolves to
    // <id>. (The shell's urlstate.js owns the query; the router only needs
    // the id to route. Stopping at ?/# so `#/demo/surface?metalness=0.7`
    // still yields `surface`.)
    const m = location.hash.match(/^#\/demo\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async navigate() {
    const id = this.parseHash();
    const myToken = ++this._navToken;

    if (!id) {
      this.engine.unload();
      this.currentId = null;
      this._lastHash = location.hash;
      this.onMessage("Pick a demo: " + DEMOS.map((d) => `#/demo/${d.id}`).join(", "));
      return;
    }

    const demo = getDemo(id);
    if (!demo) {
      this.engine.unload();
      this.currentId = null;
      this._lastHash = location.hash;
      this.onMessage(`Unknown demo "${id}". Available: ${DEMOS.map((d) => d.id).join(", ")}`);
      return;
    }

    // Same demo AND the query is unchanged -> nothing to do (and a slider
    // drag, which serializes via replaceState, never got here in the first
    // place). Same demo but a DIFFERENT query (a pasted deep link with new
    // params) -> reload so the URL's params re-apply over the defaults.
    if (id === this.currentId && this._lastHash === location.hash) return;

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
    this._lastHash = location.hash;
    this.onMessage("");
  }

  /** Remove the router's own hashchange listener (does not touch the engine). */
  destroy() {
    removeEventListener("hashchange", this._onHashChange);
  }
}
