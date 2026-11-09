// "245 lb · 45 + 45 + 10" — flagged when the requested weight isn't loadable.

import { h, fmtNum } from "../dom.js";
import { plateBreakdown } from "../../logic/plates.js";

export function plateBadge(weight, cfg, { compact = false } = {}) {
  if (weight == null) return h("span", { class: "plate-badge is-empty" }, "–");
  const b = plateBreakdown(weight, cfg);
  const el = h("span", {
    class: `plate-badge${b.exact ? "" : " is-inexact"}${compact ? " is-compact" : ""}`,
    title: b.exact ? `Plates per side: ${b.text}` : `${fmtNum(b.requested, 2)} lb isn't loadable; nearest is ${fmtNum(b.loaded, 2)} lb`,
  },
    b.exact ? null : h("span", { class: "plate-flag", "aria-hidden": "true" }, "≈"),
    h("span", { class: "plate-weight" }, `${fmtNum(b.loaded, 2)} lb`),
    h("span", { class: "plate-sep", "aria-hidden": "true" }, " · "),
    h("span", { class: "plate-text" }, h("span", { class: "visually-hidden" }, "per side: "), b.text),
    b.exact ? null : h("span", { class: "plate-note" }, `nearest loadable (requested ${fmtNum(b.requested, 2)} lb)`),
  );
  return el;
}

/** Weight line for any exercise: plate badge if it uses plates, plain "100 lb" otherwise. */
export function weightLabel(weight, exercise, cfg, opts) {
  if (weight == null) return h("span", { class: "plate-badge is-empty" }, "–");
  if (exercise && exercise.plates) return plateBadge(weight, cfg, opts);
  return h("span", { class: "plate-badge" }, h("span", { class: "plate-weight" }, `${fmtNum(weight, 2)} lb`));
}
