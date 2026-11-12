// Workout screen: the next (or chosen) day, set buttons, warm-ups, finish.

import { h, mount, formatDate, fmtNum } from "../dom.js";
import { plateConfig, plateBreakdown } from "../../logic/plates.js";
import { allSetsDone, nextSet } from "../../logic/workout.js";
import { formatRemaining } from "../../services/timer.js";
import { weightLabel, plateBadge } from "../components/plateBadge.js";
import { createSetButton } from "../components/setButton.js";
import { openRepEntry } from "../components/repEntry.js";
import { confirmDialog, promptNumber, chooseOption, showToast } from "../components/dialog.js";

// UI-only memory across re-renders (which warm-up panels the user opened/closed).
const warmupOpen = new Map();
let focusKey = null;

function exerciseOf(ctx, id) {
  return ctx.program.exercises?.[id] || { id, name: id, type: "barbell", plates: false };
}

function schemeLine(slot) {
  return slot.tier === "T3" ? `T3 · ${slot.scheme}` : `${slot.tier} · Stage ${slot.stage} · ${slot.scheme}`;
}

function dayName(ctx, dayId) {
  return ctx.program.days?.[dayId]?.name || dayId;
}

function countIncomplete(workout) {
  return workout.slots.reduce((n, slot) => n + slot.sets.filter((set) => !set.done).length, 0);
}

function countDone(workout) {
  const done = workout.slots.reduce((n, slot) => n + slot.sets.filter((set) => set.done).length, 0);
  const total = workout.slots.reduce((n, slot) => n + slot.sets.length, 0);
  return { done, total };
}

function gridColumns(n) {
  if (n <= 5) return Math.max(n, 3);
  if (n === 6) return 3;
  return 5;
}

function anyProgress(workout) {
  return workout.slots.some((slot) => slot.sets.some((x) => x.done) || slot.warmups.some((w) => w.done));
}

function rememberFocus(key) {
  focusKey = key;
}

async function handleSetTap(ctx, slot, setIndex, mode) {
  const set = slot.sets[setIndex];
  const name = exerciseOf(ctx, slot.exerciseId).name;
  const title = `${name} · set ${setIndex + 1} of ${slot.sets.length}`;
  rememberFocus(`set:${slot.slotIndex}:${setIndex}`);
  const targetText = `${set.target}${set.amrap ? "+" : ""}`;

  if (set.done) {
    const result = await openRepEntry({
      title, initial: set.reps ?? set.target, min: 0, max: 100, allowClear: true,
      hint: `Logged ${set.reps} (target ${targetText}). Change the reps or un-complete the set.`,
    });
    if (result === "clear") ctx.actions.clearSet(slot.slotIndex, setIndex);
    else if (result != null) ctx.actions.logSet(slot.slotIndex, setIndex, result);
    return;
  }

  const range = slot.repRange;
  if (mode === "tap" && !set.amrap && !range) {
    ctx.actions.logSet(slot.slotIndex, setIndex, set.target);
    return;
  }

  const initial = mode === "fewer" ? Math.max(0, set.target - 1) : set.target;
  const hint = mode === "fewer"
    ? `Target ${targetText}. How many reps did you get?`
    : range
      ? `Goal ${set.target}, range ${range.min}–${range.max}.${slot.hint ? ` ${slot.hint}.` : ""} Enter the reps you got.`
      : `AMRAP — target ${targetText}. Enter every rep you got.`;
  const result = await openRepEntry({ title, initial, min: 0, max: 100, hint });
  if (result != null && result !== "clear") ctx.actions.logSet(slot.slotIndex, setIndex, result);
}

async function handleStartingWeight(ctx, slot) {
  const name = exerciseOf(ctx, slot.exerciseId).name;
  rememberFocus(`sw:${slot.slotIndex}`);
  const weight = await promptNumber({
    title: `Starting weight: ${name}`,
    message: `Enter your ${slot.tier} working weight in lb. You can change it later in Settings.`,
    initial: 45, step: 5, min: 0, max: 1000,
  });
  if (weight != null) ctx.actions.setStartingWeight(slot.exerciseId, slot.tier, weight);
}

function renderWarmups(ctx, workout, slot, cfg, exercise) {
  if (!slot.warmups || !slot.warmups.length) return null;
  const key = `${workout.id}:${slot.slotIndex}`;
  const doneCount = slot.warmups.filter((w) => w.done).length;
  const defaultOpen = doneCount < slot.warmups.length && !slot.sets.some((x) => x.done);
  const open = warmupOpen.has(key) ? warmupOpen.get(key) : defaultOpen;

  const details = h("details", { class: "warmups" },
    h("summary", { class: "warmups-summary" },
      h("span", {}, "Warm-ups"),
      h("span", { class: "warmups-count" }, `${doneCount}/${slot.warmups.length}`)),
    h("div", { class: "warmup-list" }, slot.warmups.map((w, i) => {
      const plates = exercise.plates ? plateBreakdown(w.weight, cfg).text : null;
      const isBar = w.pct === 0;
      return h("button", {
        type: "button", class: `warmup-btn${w.done ? " is-done" : ""}`, "aria-pressed": w.done ? "true" : "false",
        dataset: { focusKey: `wu:${slot.slotIndex}:${i}` },
        onClick: () => { rememberFocus(`wu:${slot.slotIndex}:${i}`); ctx.actions.toggleWarmup(slot.slotIndex, i); },
      },
        h("span", { class: "warmup-check", "aria-hidden": "true" }, w.done ? "✓" : ""),
        h("span", { class: "warmup-main" }, `${isBar ? "Bar" : `${fmtNum(w.weight, 2)} lb`} × ${w.reps}`),
        h("span", { class: "warmup-plates" }, isBar ? `${fmtNum(w.weight, 2)} lb` : plates ? plates : ""),
        h("span", { class: "warmup-pct" }, isBar ? "" : `${Math.round(w.pct * 100)}%`),
      );
    })),
  );
  // Setting `open` programmatically fires an async "toggle"; ignore that one so the
  // default (collapse once a working set is logged) isn't mistaken for a user choice.
  let ignoreNextToggle = open;
  details.open = open;
  details.addEventListener("toggle", () => {
    if (ignoreNextToggle && details.open === open) { ignoreNextToggle = false; return; }
    ignoreNextToggle = false;
    warmupOpen.set(key, details.open);
  });
  return details;
}

function renderSlot(ctx, workout, slot, cfg, next) {
  const exercise = exerciseOf(ctx, slot.exerciseId);
  const bodyweight = exercise.type === "bodyweight";
  const needsWeight = !bodyweight && slot.weight == null;
  const restSec = ctx.state.settings?.rest?.[slot.tier];
  const success = slot.sets.length && slot.sets.every((x) => x.done && x.reps >= x.target);
  const allDone = slot.sets.every((x) => x.done);

  let weightLine;
  if (bodyweight) {
    weightLine = h("div", { class: "slot-weight" },
      h("span", { class: "plate-badge" }, h("span", { class: "plate-weight" }, "Bodyweight")),
      slot.repTarget != null ? h("span", { class: "slot-reptarget" }, `target ${slot.repTarget} reps`) : null);
  } else if (!needsWeight) {
    const req = slot.requestedWeight;
    const inexact = exercise.plates && req != null && req !== slot.weight;
    weightLine = h("div", { class: "slot-weight" }, inexact ? plateBadge(req, cfg) : weightLabel(slot.weight, exercise, cfg));
  }

  const body = needsWeight
    ? h("button", {
      type: "button", class: "btn btn-primary btn-block btn-xl", dataset: { focusKey: `sw:${slot.slotIndex}` },
      onClick: () => handleStartingWeight(ctx, slot),
    }, "Enter starting weight")
    : h("div", {
      class: "set-grid", role: "group", "aria-label": `${exercise.name} working sets`,
      style: { "--cols": String(gridColumns(slot.sets.length)) },
    },
      slot.sets.map((set, i) => {
        const cell = createSetButton({
          set, index: i, total: slot.sets.length, rangeMax: slot.repRange?.max ?? null,
          isNext: !!next && next.slotIndex === slot.slotIndex && next.setIndex === i,
          onTap: () => handleSetTap(ctx, slot, i, "tap"),
          onFewer: () => handleSetTap(ctx, slot, i, set.done ? "edit" : "fewer"),
        });
        cell.querySelector(".set-btn").dataset.focusKey = `set:${slot.slotIndex}:${i}`;
        return cell;
      }));

  return h("section", {
    class: `card slot-card${allDone ? (success ? " is-success" : " is-fail") : ""}`,
    "aria-labelledby": `slot-title-${slot.slotIndex}`,
  },
    h("div", { class: "slot-head" },
      h("span", { class: `tier-badge tier-${slot.tier}` }, slot.label || slot.tier),
      h("h2", { class: "slot-name", id: `slot-title-${slot.slotIndex}` }, exercise.name),
      allDone ? h("span", { class: `slot-result ${success ? "is-success" : "is-fail"}` }, success ? "✓" : "✗") : null),
    h("p", { class: "slot-meta" },
      h("span", {}, schemeLine(slot)),
      restSec ? h("span", { class: "slot-rest" }, `rest ${formatRemaining(restSec * 1000)}`) : null),
    slot.hint ? h("p", { class: "slot-hint" }, slot.hint) : null,
    weightLine,
    needsWeight ? null : renderWarmups(ctx, workout, slot, cfg, exercise),
    body,
  );
}

async function onChangeDay(ctx, workout) {
  const rotation = ctx.program.rotation || Object.keys(ctx.program.days || {});
  const nextId = rotation[ctx.state.rotationIndex % rotation.length];
  const dayId = await chooseOption({
    title: "Change day",
    message: "Doing a different day doesn't change the rotation order; finishing it still advances to the next day.",
    current: workout.dayId,
    options: rotation.map((id) => ({
      value: id,
      label: dayName(ctx, id),
      detail: [
        (ctx.program.days?.[id]?.slots || []).slice(0, 2).map((sl) => exerciseOf(ctx, sl.exerciseId).name).join(" · "),
        id === nextId ? "next in rotation" : null,
      ].filter(Boolean).join(" — "),
    })),
  });
  if (!dayId || dayId === workout.dayId) return;
  if (anyProgress(workout)) {
    const ok = await confirmDialog(`Switch to ${dayName(ctx, dayId)}? Sets logged so far will be discarded.`, { okLabel: "Switch day", danger: true });
    if (!ok) return;
  }
  ctx.actions.changeDay(dayId);
}

async function onDiscard(ctx) {
  const ok = await confirmDialog("Discard this workout? Logged sets will be lost and the rotation won't advance.", {
    okLabel: "Discard", danger: true,
  });
  if (ok) ctx.actions.discardWorkout();
}

async function onFinish(ctx, workout) {
  if (!allSetsDone(workout)) {
    const n = countIncomplete(workout);
    const ok = await confirmDialog(`${n} set${n === 1 ? "" : "s"} incomplete will count as failed.`, {
      title: "Finish anyway?", okLabel: "Finish workout", danger: true,
    });
    if (!ok) return;
  }
  try {
    ctx.actions.finishWorkout();
  } catch (err) {
    showToast(err?.message || "Couldn't finish the workout.");
  }
}

// After a set is logged the rest timer appears; make sure the next set button isn't hidden
// behind the fixed timer bar / tabs. Checked twice because the timer bar shows a tick later.
function revealNext(root) {
  const btn = root.querySelector(".set-btn.is-next");
  if (!btn || !btn.isConnected) return;
  const timer = document.getElementById("timer");
  const tabs = document.getElementById("tabs");
  const timerTop = timer && !timer.hidden ? timer.getBoundingClientRect().top : Infinity;
  const tabsTop = tabs ? tabs.getBoundingClientRect().top : window.innerHeight;
  const timerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--timer-h")) || 104;
  const banner = document.querySelector("#banner-root .update-banner");
  const bannerTop = banner ? banner.getBoundingClientRect().top : Infinity;
  const limit = Math.min(timerTop, bannerTop, tabsTop - (timer && timer.hidden ? timerH + 8 : 0));
  const r = btn.getBoundingClientRect();
  const cell = btn.closest(".set-cell") || btn;
  const bottom = Math.max(r.bottom, cell.getBoundingClientRect().bottom);
  if (bottom > limit - 8 || r.top < 0) {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    btn.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }
}

function scheduleRevealNext(root) {
  requestAnimationFrame(() => revealNext(root));
  setTimeout(() => revealNext(root), 320);
}

export function render(root, ctx) {
  const workout = ctx.state.inProgress;
  if (!workout) {
    const pending = ctx.state.pendingDecisions?.length;
    mount(root, h("div", { class: "screen screen-workout" },
      h("div", { class: "empty-state" },
        h("h1", {}, pending ? "Decision needed" : "No workout in progress"),
        h("p", {}, pending ? "Resolve the reset decision from your last workout first." : "Your next workout will appear here."),
        pending ? h("button", { type: "button", class: "btn btn-primary btn-block btn-xl", onClick: () => ctx.navigate("summary") }, "Go to summary") : null)));
    return undefined;
  }

  const cfg = plateConfig(ctx.program, ctx.state.settings);
  const next = nextSet(workout);
  const done = allSetsDone(workout);
  const { done: doneSets, total } = countDone(workout);

  const screen = h("div", { class: "screen screen-workout" },
    h("header", { class: "screen-header" },
      h("div", { class: "title-block" },
        h("h1", { class: "day-title" }, dayName(ctx, workout.dayId)),
        h("p", { class: "subtitle" }, formatDate(workout.startedAt, { weekday: "long", month: "short", day: "numeric" }))),
      h("div", { class: "header-actions" },
        h("button", { type: "button", class: "btn btn-secondary btn-small", onClick: () => onChangeDay(ctx, workout) }, "Change day"),
        h("button", { type: "button", class: "btn btn-danger-ghost btn-small", onClick: () => onDiscard(ctx) }, "Discard"))),
    h("div", { class: "progress-line", role: "status" },
      h("span", {}, `${doneSets} / ${total} sets`),
      h("span", { class: "progress-track", "aria-hidden": "true" },
        h("span", { class: "progress-fill", style: { width: `${total ? (doneSets / total) * 100 : 0}%` } }))),
    workout.slots.map((slot) => renderSlot(ctx, workout, slot, cfg, next)),
    h("div", { class: "finish-area" },
      h("button", {
        type: "button", class: `btn btn-block btn-xl ${done ? "btn-primary btn-finish-ready" : "btn-secondary"}`,
        onClick: () => onFinish(ctx, workout),
      }, done ? "Finish workout" : "Finish workout early"),
      done ? null : h("p", { class: "finish-note" }, `${total - doneSets} set${total - doneSets === 1 ? "" : "s"} to go`)),
  );

  mount(root, screen);

  if (focusKey && focusKey.startsWith("set:")) scheduleRevealNext(root);
  if (focusKey) {
    const target = root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    if (target && document.activeElement === document.body) target.focus({ preventScroll: true });
    focusKey = null;
  }
  return undefined;
}
