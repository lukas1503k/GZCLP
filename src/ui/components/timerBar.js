// Fixed rest-timer bar above the tab bar.

import { h, mount } from "../dom.js";
import { formatRemaining } from "../../services/timer.js";

export function createTimerBar(el, { onAdjust, onSkip } = {}) {
  const time = h("span", { class: "timer-time", role: "timer", "aria-live": "off" }, "0:00");
  const label = h("span", { class: "timer-label" }, "Rest");
  const next = h("span", { class: "timer-next" });
  const fill = h("span", { class: "timer-fill" });
  const progress = h("span", { class: "timer-progress", "aria-hidden": "true" }, fill);

  const bar = h("div", { class: "timer-bar", role: "region", "aria-label": "Rest timer" },
    progress,
    h("div", { class: "timer-row" },
      h("div", { class: "timer-info" }, h("div", { class: "timer-top" }, label, time), next),
      h("div", { class: "timer-controls" },
        h("button", { type: "button", class: "timer-btn", "aria-label": "Subtract 30 seconds", onClick: () => onAdjust?.(-30) }, "−30"),
        h("button", { type: "button", class: "timer-btn", "aria-label": "Add 30 seconds", onClick: () => onAdjust?.(30) }, "+30"),
        h("button", { type: "button", class: "timer-btn timer-skip", "aria-label": "Skip rest", onClick: () => onSkip?.() }, "Skip"),
      ),
    ),
  );
  mount(el, bar);
  el.hidden = true;

  let lastText = "";
  return {
    show(timer, remaining) {
      if (!timer) { this.hide(); return; }
      if (el.hidden) {
        el.hidden = false;
        document.documentElement.classList.add("has-timer");
      }
      const ms = Math.max(0, remaining);
      const text = formatRemaining(ms);
      if (text !== lastText) { time.textContent = text; lastText = text; }
      const totalMs = Math.max(1, (timer.durationSec || 1) * 1000);
      const frac = Math.min(1, Math.max(0, ms / totalMs));
      fill.style.transform = `scaleX(${frac})`;
      bar.classList.toggle("is-done", ms <= 0);
      bar.classList.toggle("is-warmup", timer.kind === "warmup");
      label.textContent = ms <= 0 ? "Rest over" : timer.kind === "warmup" ? "Warm-up rest" : "Rest";
      const nextText = timer.nextLabel ? `Next: ${timer.nextLabel}` : "Last set done";
      if (next.textContent !== nextText) next.textContent = nextText;
    },
    hide() {
      el.hidden = true;
      lastText = "";
      document.documentElement.classList.remove("has-timer");
    },
  };
}
