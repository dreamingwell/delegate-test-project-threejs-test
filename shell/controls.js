/**
 * shell/controls.js — the "knobs you turn while it's running" contract.
 *
 * The five shared shell systems, part 2. Every demo that wants live controls
 * exposes a CONTROLS descriptor — a plain array of control specs — and the
 * shell renders it into the app-level controls panel. The panel is part of
 * the app (shell/shell.js), not bolted onto each demo: demos never build
 * their own panel, they just declare what knobs exist.
 *
 * DESCRIPTOR CONTRACT (exported as the demo module's CONTROLS, or as
 * controls() on the demo's exported object):
 *
 *   [
 *     { type: "slider",  key: "speed", label: "Speed",
 *       min: 0, max: 4, step: 0.1, value: 1, onInput(v) {} },
 *     { type: "select",  key: "shape", label: "Shape",
 *       options: ["sphere", "box"], value: "sphere", onInput(v) {} },
 *     { type: "button",  key: "burst", label: "Burst", onClick() {} },
 *   ]
 *
 * Fields:
 *   - key:      unique id; also the URL-state key (`?<key>=<value>`).
 *   - label:    shown next to the control.
 *   - value:    the demo's DEFAULT value (used to build the UI; on load,
 *               URL values are applied OVER this default by urlstate.js).
 *   - onInput:  called LIVE (on input, not on change-only) with the new
 *               value whenever the user moves the control. The demo wires
 *               this to mutate the live scene.
 *   - (slider)  min / max / step.
 *   - (select)  options: array of {label,value} or strings.
 *   - (button)  onClick() instead of onInput; no URL state.
 *
 * A demo with no controls exposes an empty array (or nothing); the panel is
 * still present, just empty.
 *
 * `renderControls(descriptor, panelEl, onValueChange)` builds the UI and
 * returns a teardown function. onValueChange(key, value) is called after the
 * demo's onInput, so the shell can serialize the change into the URL
 * (round-trip deep-link state). Buttons don't emit URL state.
 */

/**
 * Build the controls UI from a descriptor.
 *
 * @param {Array} descriptor the control specs (see contract above).
 * @param {HTMLElement} panelEl the app-level panel element to fill.
 * @param {(key: string, value: any) => void} [onValueChange] called live on
 *   every slider/select change (value), so the shell can serialize to the
 *   URL. Buttons do not call it.
 * @returns {() => void} teardown: removes the built UI.
 */
export function renderControls(descriptor, panelEl, onValueChange = () => {}) {
  panelEl.textContent = ""; // start clean
  const rows = [];

  for (const spec of descriptor || []) {
    const row = document.createElement("div");
    row.className = "ctl-row";

    if (spec.type === "slider") {
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(spec.min ?? 0);
      input.max = String(spec.max ?? 1);
      input.step = String(spec.step ?? 0.01);
      input.value = String(spec.value ?? spec.min ?? 0);
      input.style.flex = "1";
      input.style.minWidth = "90px";

      const live = document.createElement("span");
      live.className = "ctl-val";
      const show = (v) => {
        const n = Number(v);
        live.textContent = Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
      };
      show(input.value);

      // LIVE: fire on input, not change, so the scene responds while dragging.
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        try { spec.onInput && spec.onInput(v); } catch (e) { console.error("controls onInput", e); }
        show(v);
        if (spec.key) onValueChange(spec.key, v);
      });

      row.appendChild(label(spec.label));
      row.appendChild(input);
      row.appendChild(live);
      rows.push(row);
    } else if (spec.type === "select") {
      const sel = document.createElement("select");
      const opts = (spec.options || []).map((o) =>
        typeof o === "string" ? { label: o, value: o } : o,
      );
      for (const o of opts) {
        const opt = document.createElement("option");
        opt.value = String(o.value);
        opt.textContent = o.label ?? String(o.value);
        sel.appendChild(opt);
      }
      if (opts.length) sel.value = String(spec.value ?? opts[0].value);
      // If the value isn't one of the options (e.g. a stale URL value), fall
      // back to the first option so the UI is never left with a blank select.
      if (opts.length && [...sel.options].every((o) => o.value !== sel.value)) {
        sel.value = String(opts[0].value);
      }

      // LIVE: selects fire on change (commit), which is the correct UX.
      sel.addEventListener("change", () => {
        try { spec.onInput && spec.onInput(sel.value); } catch (e) { console.error("controls onInput", e); }
        if (spec.key) onValueChange(spec.key, sel.value);
      });

      row.appendChild(label(spec.label));
      row.appendChild(sel);
      rows.push(row);
    } else if (spec.type === "button") {
      const btn = document.createElement("button");
      btn.className = "ctl-btn";
      btn.textContent = spec.label ?? spec.key ?? "Button";
      btn.addEventListener("click", () => {
        try { spec.onClick && spec.onClick(); } catch (e) { console.error("controls onClick", e); }
      });
      row.appendChild(btn);
      rows.push(row);
    }

    panelEl.appendChild(row);
  }

  return () => {
    for (const r of rows) r.remove();
  };
}

function label(text) {
  const l = document.createElement("label");
  l.className = "ctl-label";
  l.textContent = text ?? "";
  return l;
}
