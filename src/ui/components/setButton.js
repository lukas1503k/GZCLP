// One big button per working set. Tap -> onTap; long-press (500 ms) or the
// visible "fewer" control -> onFewer.

import { h } from "../dom.js";

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 12;

export function createSetButton({ set, index, onTap, onFewer, isNext = false, total = null, showFewer = true }) {
  const success = set.done && set.reps != null && set.reps >= set.target;
  const state = set.done ? (success ? "is-success" : "is-fail") : isNext ? "is-next" : "is-todo";
  const targetText = `${set.target}${set.amrap ? "+" : ""}`;
  const setNo = index + 1;
  const aria = set.done
    ? `Set ${setNo}${total ? ` of ${total}` : ""}: ${set.reps} reps logged, target ${targetText}. ${success ? "Hit" : "Missed"}. Tap to edit.`
    : `Set ${setNo}${total ? ` of ${total}` : ""}: target ${targetText} reps${set.amrap ? ", as many as possible" : ""}. Tap to log.`;

  const main = h("button", { type: "button", class: `set-btn ${state}${set.amrap ? " is-amrap" : ""}`, "aria-label": aria },
    h("span", { class: "set-btn-reps" }, set.done ? String(set.reps) : targetText),
    h("span", { class: "set-btn-caption", "aria-hidden": "true" },
      set.done ? `${success ? "✓" : "✗"} of ${targetText}` : set.amrap ? "AMRAP" : `set ${setNo}`),
  );

  let timer = null;
  let longPressed = false;
  let start = null;
  const cancelPress = () => { clearTimeout(timer); timer = null; };

  main.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    longPressed = false;
    start = { x: e.clientX, y: e.clientY };
    cancelPress();
    timer = setTimeout(() => {
      timer = null;
      longPressed = true;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch { /* ignore */ } }
      onFewer?.();
    }, LONG_PRESS_MS);
  });
  main.addEventListener("pointermove", (e) => {
    if (!timer || !start) return;
    if (Math.abs(e.clientX - start.x) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - start.y) > MOVE_TOLERANCE_PX) cancelPress();
  });
  for (const evt of ["pointerup", "pointercancel", "pointerleave"]) main.addEventListener(evt, cancelPress);
  main.addEventListener("contextmenu", (e) => e.preventDefault());
  main.addEventListener("click", (e) => {
    if (longPressed) { longPressed = false; e.preventDefault(); return; }
    onTap?.();
  });

  const withFewer = !set.done && onFewer && showFewer;
  const cell = h("div", { class: `set-cell${withFewer ? " has-fewer" : ""}` }, main);
  if (withFewer) {
    cell.append(h("button", {
      type: "button", class: "set-fewer", "aria-label": `Log fewer reps for set ${setNo}`, onClick: () => onFewer(),
    }, "fewer"));
  }
  return cell;
}
