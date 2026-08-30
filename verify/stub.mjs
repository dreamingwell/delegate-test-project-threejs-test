/**
 * Minimal browser/DOM + WebGL context stub for running the REAL engine,
 * three.js, and real demo modules in Node.
 *
 * Purpose: exercise the engine's JS-level lifecycle (init/mount/update/
 * destroy, engine-tracked listeners, composer pass disposal, scene scrub)
 * and prove the demos are construct + run + unload clean and leak-free.
 *
 * What it is honest about (important for the evidence claim):
 *   - three.js, Engine.js, BaseDemo.js and the demo modules are all the REAL
 *     code, running unmodified. The engine's tracked-listener logic and
 *     reset()/unload() disposal logic are real and are what we assert on.
 *   - The WebGL context is a faithful STUB: it satisfies three's
 *     WebGLRenderer constructor (getParameter, getExtension, the create*
 *     methods, checkFramebufferStatus, isContextLost) but performs NO real
 *     GPU work.
 *   - The harness drives the render loop via engine._cb(delta, elapsed) and
 *     deliberately does NOT call composer.render(), so the deep shader-
 *     compile / GPU path is not exercised. This is a correctness + leak
 *     audit, NOT a GPU render or a performance measurement. It proves the
 *     demos are leak-free and load/update clean; it does NOT prove any
 *     fps number (that is #TJL-10's job with a real GL context).
 */

// ---------------------------------------------------------------------------
// GL context stub
// ---------------------------------------------------------------------------
function makeGLStub() {
  const constants = new Map();
  let constSeq = 1000;
  const constFor = (name) => {
    if (!constants.has(name)) constants.set(name, constSeq++);
    return constants.get(name);
  };

  function makeHandle(kind) {
    return { __glHandle: kind, id: kind + "_" + Math.floor(Math.random() * 1e9) };
  }

  const calls = {};
  const callCount = new Map();

  function makeGLCall(name) {
    const fn = (...args) => {
      callCount.set(name, (callCount.get(name) || 0) + 1);
      if (name.startsWith("create")) return makeHandle(name);
      if (name === "getParameter") {
        const arg = args[0];
        if (arg === constFor("VERSION")) return "WebGL 2.0 (Headless Stub)";
        if (arg === constFor("SHADING_LANGUAGE_VERSION")) return "GLSL 3.00 (Headless Stub)";
        if (
          arg === constFor("MAX_TEXTURE_SIZE") ||
          arg === constFor("MAX_CUBE_MAP_TEXTURE_SIZE")
        )
          return 16384;
        return 16;
      }
      if (name === "getExtension") return { __extensionStub: true, name: args[0] };
      if (name === "getShaderPrecisionFormat") return { rangeMin: 127, rangeMax: 127, precision: 23 };
      if (name === "isContextLost") return false;
      if (name === "getError") return 0;
      if (name === "checkFramebufferStatus") return constFor("FRAMEBUFFER_COMPLETE");
      if (name === "getShaderInfoLog" || name === "getProgramInfoLog") return "";
      if (name === "getShaderParameter" || name === "getProgramParameter") return true;
      if (name === "getActiveUniform") return { name: "stub", type: constFor("FLOAT") };
      if (name === "getActiveAttrib") return { name: "stub", type: constFor("FLOAT_VEC4") };
      return undefined;
    };
    fn.__name = name;
    return fn;
  }

  const gl = new Proxy(
    { __glStub: true },
    {
      get(target, prop) {
        if (typeof prop !== "string") return undefined;
        if (/^[A-Z0-9_]+$/.test(prop)) return constFor(prop);
        if (prop in target) return target[prop];
        if (!calls[prop]) calls[prop] = makeGLCall(prop);
        return target[prop] = calls[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
      has() {
        return true;
      },
    },
  );

  gl.__callCount = callCount;
  return gl;
}

// ---------------------------------------------------------------------------
// 2D canvas context stub (for the star/glow sprite canvases the demos make)
// ---------------------------------------------------------------------------
function make2DContext() {
  return {
    fillStyle: "",
    createRadialGradient() {
      return { addColorStop() {} };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillRect() {},
    clearRect() {},
  };
}

// ---------------------------------------------------------------------------
// DOM element stub
// ---------------------------------------------------------------------------
function makeStyle() {
  return { cssText: "" };
}

function makeElement(tag) {
  const el = {
    nodeType: 1,
    tagName: String(tag || "div").toUpperCase(),
    style: makeStyle(),
    children: [],
    parent: null,
    id: "",
    className: "",
    innerHTML: "",
    textContent: "",
    href: "",
    width: 0,
    height: 0,
    _listeners: Object.create(null),
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parent = null;
      return child;
    },
    remove() {
      if (this.parent) this.parent.removeChild(this);
    },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || new Set()).add(handler);
    },
    removeEventListener(type, handler) {
      if (this._listeners[type]) this._listeners[type].delete(handler);
    },
    get listenerKeys() {
      return Object.keys(this._listeners).filter((t) => this._listeners[t].size > 0);
    },
  };
  return el;
}

function makeCanvas() {
  const el = makeElement("canvas");
  const gl = makeGLStub();
  const ctx2d = make2DContext();
  el.width = 0;
  el.height = 0;
  el.__glStub = gl;
  el.getContext = (name) => {
    if (name === "2d") return ctx2d;
    if (name === "webgl2" || name === "webgl" || name === "experimental-webgl") return gl;
    return null;
  };
  el.toBlob = (cb) => cb(null);
  return el;
}

// ---------------------------------------------------------------------------
// Install the stubs into globalThis.
// ---------------------------------------------------------------------------
export function installStubs() {
  const g = globalThis;

  g.innerWidth = 1920;
  g.innerHeight = 1080;
  g.devicePixelRatio = 1;

  // Global event bus (Engine.addListener uses `window`; Router uses global
  // addEventListener for hashchange). Tracked so we can audit leaks.
  const globalListeners = Object.create(null);
  g.addEventListener = (type, handler) => {
    (globalListeners[type] = globalListeners[type] || new Set()).add(handler);
  };
  g.removeEventListener = (type, handler) => {
    if (globalListeners[type]) globalListeners[type].delete(handler);
  };
  g.__globalListeners = globalListeners;

  let rafId = 1;
  g.requestAnimationFrame = (cb) => rafId++;
  g.cancelAnimationFrame = () => {};
  g.self = g;
  g.window = g;
  g.navigator = g.navigator || { userAgent: "Node Headless Stub", maxTouchPoints: 0 };
  g.location = g.location || { hash: "", href: "https://example.test/#" };

  const appEl = makeElement("div");
  appEl.id = "app";
  const bodyEl = makeElement("body");
  const documentStub = {
    body: bodyEl,
    createElement: (tag) => (tag === "canvas" ? makeCanvas() : makeElement(tag)),
    getElementById: (id) => (id === "app" ? appEl : null),
    addEventListener() {},
    removeEventListener() {},
  };
  g.document = documentStub;
  g.__appEl = appEl;
  g.__document = documentStub;
}

export function resetFrameClock() {
  // No-op hook; frames are driven by the caller via engine._cb.
}
