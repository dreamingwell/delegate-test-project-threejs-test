import { Engine } from "./engine/Engine.js";

/**
 * Hash router: #/demo/<id>
 *
 * Registry maps a demo id to a dynamic import() that resolves to a module
 * with a default export extending BaseDemo. Demos are expected to live under
 * <id>/demo.js (kept separate from each demo's existing standalone
 * index.html, which is untouched by this router).
 */
const REGISTRY = {
  "frontier-demo": () => import("./frontier-demo/demo.js"),
  "local-demo": () => import("./local-demo/demo.js"),
};

const engine = new Engine({ container: document.getElementById("app") ?? document.body });

let currentDemo = null;
let currentId = null;
let loadToken = 0;

function parseHash() {
  const m = location.hash.match(/^#\/demo\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function navigate() {
  const id = parseHash();
  if (!id) {
    showMessage("Pick a demo: " + Object.keys(REGISTRY).map((k) => `#/demo/${k}`).join(", "));
    return;
  }
  if (id === currentId) return;
  if (!REGISTRY[id]) {
    showMessage(`Unknown demo "${id}". Available: ${Object.keys(REGISTRY).join(", ")}`);
    return;
  }

  const myToken = ++loadToken;

  // Exact route-change sequence, in order:
  engine.stop();
  if (currentDemo) {
    await currentDemo.unmount(engine);
  }
  engine.reset();

  let mod;
  try {
    mod = await REGISTRY[id]();
  } catch (err) {
    console.error(`Failed to load demo "${id}":`, err);
    showMessage(`Failed to load demo "${id}". See console for details.`);
    return;
  }

  if (myToken !== loadToken) return; // a newer navigation has superseded this one

  const DemoClass = mod.default;
  const demo = new DemoClass();

  await demo.load(engine);
  if (myToken !== loadToken) return;

  demo.mount(engine);

  currentDemo = demo;
  currentId = id;

  engine.start((delta, elapsed) => demo.update(delta, elapsed));
}

function showMessage(text) {
  let el = document.getElementById("router-message");
  if (!el) {
    el = document.createElement("div");
    el.id = "router-message";
    Object.assign(el.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      color: "#cfe8ff",
      font: "16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      textAlign: "center",
      zIndex: 10000,
    });
    document.body.appendChild(el);
  }
  el.textContent = text;
}

addEventListener("hashchange", navigate);
navigate();

export { engine };
