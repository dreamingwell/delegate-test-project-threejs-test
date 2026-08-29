import { Engine } from "./engine/Engine.js";
import { Router } from "./router/router.js";

const engine = new Engine({ container: document.getElementById("app") ?? document.body });

function showMessage(text) {
  let el = document.getElementById("router-message");
  if (!text) {
    if (el) el.remove();
    return;
  }
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

const router = new Router(engine, showMessage);
router.navigate();

export { engine, router };
