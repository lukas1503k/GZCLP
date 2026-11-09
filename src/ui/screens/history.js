// History: workout log (expandable), e1RM charts per T1 lift, per-lift state cards.

import { h, mount, formatDate, fmtNum } from "../dom.js";
import { plateConfig } from "../../logic/plates.js";
import { e1rmSeries } from "../../logic/onerm.js";
import { previewOutcomes, prescription, slotSuccess } from "../../logic/progression.js";
import { canUndo } from "../../logic/session.js";
import { weightLabel } from "../components/plateBadge.js";
import { renderE1rmChart } from "../components/chart.js";
import { confirmDialog, showToast } from "../components/dialog.js";

const TABS = [["log", "Log"], ["progress", "e1RM"], ["lifts", "Lifts"]];
let activeTab = "log";
const expanded = new Set();
const allChanges = new Set();
const CHANGE_CAP = 5;
const SHOWN_EVENT_TYPES = new Set(["override", "reset"]);
const REASON_LABELS = { "tested-5rm": "Reset from tested 5RM", "estimated-5rm": "Reset from estimated 5RM", "t2-reset": "T2 reset" };

function diffText(from = {}, to = {}) {
  const parts = [];
  const lbs = (v) => (v == null ? "–" : `${fmtNum(v, 2)} lb`);
  if ((from.weight ?? null) !== (to.weight ?? null)) parts.push(`weight ${lbs(from.weight)} → ${lbs(to.weight)}`);
  if ((from.stage ?? null) !== (to.stage ?? null)) parts.push(`stage ${from.stage ?? "–"} → ${to.stage ?? "–"}`);
  if ((from.stageStartWeight ?? null) !== (to.stageStartWeight ?? null)) parts.push(`stage-1 start ${lbs(from.stageStartWeight)} → ${lbs(to.stageStartWeight)}`);
  if ((from.repTarget ?? null) !== (to.repTarget ?? null)) parts.push(`rep target ${from.repTarget ?? "–"} → ${to.repTarget ?? "–"}`);
  return parts.length ? parts.join(", ") : "no change";
}

function renderLiftChanges(ctx, lift, key) {
  const events = (lift?.history || []).filter((e) => e && SHOWN_EVENT_TYPES.has(e.type)).slice().reverse();
  if (!events.length) return null;
  const showAll = allChanges.has(key);
  const shown = showAll ? events : events.slice(0, CHANGE_CAP);
  return h("div", { class: "lift-changes" },
    h("h4", { class: "lift-changes-title" }, "Changes"),
    h("ol", { class: "lift-change-list" }, shown.map((e) => h("li", { class: `lift-change is-${e.type}` },
      h("div", { class: "lift-change-head" },
        h("span", { class: "lift-change-type" }, e.type === "override" ? "Manual" : "Reset"),
        h("span", { class: "muted" }, formatDate(e.at, { month: "short", day: "numeric", year: "numeric" }))),
      h("p", { class: "lift-change-diff" }, diffText(e.from, e.to)),
      e.reason ? h("p", { class: "lift-change-reason" }, e.type === "override" ? `“${e.reason}”` : (REASON_LABELS[e.reason] || e.reason)) : null))),
    events.length > CHANGE_CAP ? h("button", {
      type: "button", class: "btn btn-ghost btn-block", "aria-expanded": showAll ? "true" : "false",
      onClick: () => { if (showAll) allChanges.delete(key); else allChanges.add(key); render(rootRef, ctxRef); },
    }, showAll ? "Show fewer" : `Show all ${events.length} changes`) : null);
}

function exerciseOf(ctx, id) {
  return ctx.program.exercises?.[id] || { id, name: id, type: "barbell", plates: false };
}

function usedLifts(ctx) {
  const seen = new Set();
  const out = [];
  const rotation = ctx.program.rotation || Object.keys(ctx.program.days || {});
  const tierOrder = { T1: 0, T2: 1, T3: 2 };
  for (const dayId of rotation) {
    for (const slot of ctx.program.days?.[dayId]?.slots || []) {
      const key = `${slot.exerciseId}:${slot.tier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ exerciseId: slot.exerciseId, tier: slot.tier });
    }
  }
  return out.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);
}

function t1Exercises(ctx) {
  return usedLifts(ctx).filter((l) => l.tier === "T1").map((l) => l.exerciseId);
}

function setChip(set, weight) {
  const ok = set.done && set.reps != null && set.reps >= set.target;
  const reps = set.done && set.reps != null ? set.reps : 0;
  return h("li", { class: `set-chip ${ok ? "is-success" : "is-fail"}` },
    weight != null ? `${fmtNum(weight, 2)} × ${reps}` : `× ${reps}`,
    h("span", { class: "set-chip-mark", "aria-label": ok ? "hit" : "missed" }, ok ? " ✓" : " ✗"));
}

function renderWorkoutEntry(ctx, workout, cfg, isNewest) {
  const open = expanded.has(workout.id);
  const changes = workout.changes || [];
  const wins = changes.length ? changes.filter((c) => c.success).length : workout.slots.filter((sl) => slotSuccess(sl)).length;
  const total = changes.length || workout.slots.length;
  const dayName = ctx.program.days?.[workout.dayId]?.name || workout.dayId;
  const bodyId = `wk-${workout.id}`;

  const toggle = h("button", {
    type: "button", class: "log-toggle", "aria-expanded": open ? "true" : "false", "aria-controls": bodyId,
    onClick: () => { if (open) expanded.delete(workout.id); else expanded.add(workout.id); render(rootRef, ctxRef); },
  },
    h("span", { class: "log-day" }, dayName),
    h("span", { class: "log-date" }, formatDate(workout.finishedAt ?? workout.startedAt, { weekday: "short", month: "short", day: "numeric", year: "numeric" })),
    h("span", { class: `log-score ${wins === total ? "is-success" : "is-mixed"}` }, `${wins}/${total} ✓`),
    h("span", { class: "log-chevron", "aria-hidden": "true" }, open ? "▴" : "▾"));

  const summaryLine = h("p", { class: "log-lines" },
    workout.slots.map((sl) => exerciseOf(ctx, sl.exerciseId).name).join(" · "));

  let body = null;
  if (open) {
    body = h("div", { class: "log-body", id: bodyId },
      workout.slots.map((sl) => {
        const ex = exerciseOf(ctx, sl.exerciseId);
        const change = changes.find((c) => c.slotIndex === sl.slotIndex);
        return h("div", { class: "log-slot" },
          h("div", { class: "slot-head" },
            h("span", { class: `tier-badge tier-${sl.tier}` }, sl.label || sl.tier),
            h("h3", { class: "slot-name" }, ex.name),
            h("span", { class: "muted" }, sl.scheme)),
          sl.weight != null && ex.plates ? h("div", { class: "log-plates" }, weightLabel(sl.weight, ex, cfg, { compact: true })) : null,
          h("ul", { class: "set-chips" }, sl.sets.map((set) => setChip(set, sl.weight))),
          change ? h("p", { class: `change-message${change.kind === "pending" ? " is-pending" : ""}` }, change.message) : null);
      }),
      isNewest && canUndo(ctx.state)
        ? h("button", {
          type: "button", class: "btn btn-danger-ghost btn-block",
          onClick: async () => {
            const ok = await confirmDialog("Undo this workout? Weights, stages and the rotation go back to how they were before it, and the entry is deleted.", {
              okLabel: "Undo workout", danger: true,
            });
            if (!ok) return;
            try { ctx.actions.undoLastWorkout(); } catch (err) { showToast(err?.message || "Nothing to undo."); }
          },
        }, "Undo last workout")
        : null);
  }

  return h("li", { class: `card log-entry${open ? " is-open" : ""}` }, toggle, open ? null : summaryLine, body);
}

function renderLog(ctx, cfg) {
  const workouts = [...(ctx.state.workouts || [])].reverse();
  if (!workouts.length) return h("div", { class: "empty-state" }, h("p", {}, "No workouts yet. Finish one and it shows up here."));
  return h("ol", { class: "log-list" }, workouts.map((w, i) => renderWorkoutEntry(ctx, w, cfg, i === 0)));
}

function renderProgress(ctx) {
  const ids = t1Exercises(ctx);
  return h("div", { class: "progress-cards" }, ids.map((id) => {
    const ex = exerciseOf(ctx, id);
    const series = e1rmSeries(ctx.state.workouts || [], id, "T1");
    const latest = series[series.length - 1];
    const chartEl = h("div", { class: "chart-wrap" });
    renderE1rmChart(chartEl, series, { title: `${ex.name} e1RM` });
    return h("section", { class: "card" },
      h("div", { class: "slot-head" },
        h("span", { class: "tier-badge tier-T1" }, "T1"),
        h("h3", { class: "slot-name" }, ex.name),
        latest ? h("span", { class: "chart-latest" }, `${fmtNum(latest.e1RM, 0)} lb`) : null),
      chartEl);
  }));
}

function recentResults(ctx, exerciseId, tier, n = 3) {
  const out = [];
  const workouts = ctx.state.workouts || [];
  for (let i = workouts.length - 1; i >= 0 && out.length < n; i -= 1) {
    const w = workouts[i];
    for (const sl of w.slots) {
      if (sl.exerciseId === exerciseId && sl.tier === tier) { out.push({ workout: w, slot: sl }); break; }
    }
  }
  return out;
}

function renderLiftCard(ctx, { exerciseId, tier }, cfg) {
  const ex = exerciseOf(ctx, exerciseId);
  const lift = ctx.state.lifts?.[exerciseId]?.[tier];
  const bodyweight = ex.type === "bodyweight";
  let scheme = null;
  let preview = null;
  if (lift) {
    try { scheme = prescription(ctx.program, exerciseId, tier, lift).scheme; } catch { scheme = null; }
    try { preview = previewOutcomes(ctx.program, exerciseId, tier, lift, ctx.state.settings); } catch { preview = null; }
  }
  const recent = recentResults(ctx, exerciseId, tier);
  return h("section", { class: "card lift-card" },
    h("div", { class: "slot-head" },
      h("span", { class: `tier-badge tier-${tier}` }, tier),
      h("h3", { class: "slot-name" }, ex.name),
      scheme ? h("span", { class: "muted" }, tier === "T3" ? scheme : `Stage ${lift.stage} · ${scheme}`) : null),
    h("div", { class: "slot-weight" },
      bodyweight
        ? h("span", { class: "plate-badge" }, h("span", { class: "plate-weight" }, `Bodyweight · target ${lift?.repTarget ?? "–"}`))
        : lift?.weight != null ? weightLabel(lift.weight, ex, cfg) : h("span", { class: "muted" }, "Weight not set yet")),
    h("div", { class: "lift-recent" },
      h("span", { class: "muted" }, "Last 3: "),
      recent.length
        ? h("ul", { class: "set-chips" }, recent.map(({ workout, slot }) => {
          const ok = slotSuccess(slot);
          return h("li", { class: `set-chip ${ok ? "is-success" : "is-fail"}`, title: formatDate(workout.finishedAt ?? workout.startedAt) },
            `${ok ? "✓" : "✗"} ${slot.weight != null ? fmtNum(slot.weight, 2) : `×${slot.sets.map((x) => x.reps ?? 0).join("/")}`}`);
        }))
        : h("span", { class: "muted" }, "no results yet")),
    preview ? h("dl", { class: "lift-next" },
      h("div", {}, h("dt", {}, "If you hit it"), h("dd", {}, preview.onSuccess)),
      h("div", {}, h("dt", {}, "If you miss"), h("dd", {}, preview.onFail))) : null,
    renderLiftChanges(ctx, lift, `${exerciseId}:${tier}`),
  );
}

function renderLifts(ctx, cfg) {
  return h("div", { class: "lift-cards" }, usedLifts(ctx).map((l) => renderLiftCard(ctx, l, cfg)));
}

let rootRef = null;
let ctxRef = null;

export function render(root, ctx) {
  rootRef = root;
  ctxRef = ctx;
  const cfg = plateConfig(ctx.program, ctx.state.settings);
  const content = activeTab === "progress" ? renderProgress(ctx) : activeTab === "lifts" ? renderLifts(ctx, cfg) : renderLog(ctx, cfg);
  mount(root, h("div", { class: "screen screen-history" },
    h("header", { class: "screen-header" }, h("div", { class: "title-block" }, h("h1", {}, "History"))),
    h("div", { class: "segmented", role: "tablist", "aria-label": "History views" },
      TABS.map(([id, label]) => h("button", {
        type: "button", role: "tab", class: "segment", "aria-selected": activeTab === id ? "true" : "false",
        onClick: () => { activeTab = id; render(root, ctx); },
      }, label))),
    h("div", { role: "tabpanel" }, content)));
  return () => { rootRef = null; ctxRef = null; };
}
