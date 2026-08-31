import { Engine } from "./engine/Engine.js";
import { Router } from "./router/router.js";
import { bootShell } from "./shell/shell.js";

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

// Boot the shell (nav + current name + app-level controls panel + quality +
// perf) and wire the five shared systems. It observes the router via a load
// wrapper and stays authoritative for nothing (routing stays with the
// router). Must run before router.navigate() so the initial load is observed.
bootShell(engine, router);
router.navigate();

export { engine, router };
