// Post-workout summary: what happened per exercise + reset decisions.

import { h, mount, formatDate, fmtNum } from "../dom.js";
import { plateConfig, loadStep } from "../../logic/plates.js";
import { t1ResetWeight } from "../../logic/progression.js";
import { weightLabel } from "../components/plateBadge.js";
import { numberStepper, showToast } from "../components/dialog.js";

function exerciseOf(ctx, id) {
  return ctx.program.exercises?.[id] || { id, name: id, type: "barbell", plates: false };
}

function setsText(slot) {
  if (!slot) return "";
  return slot.sets.map((x) => (x.done && x.reps != null ? String(x.reps) : "–")).join(" · ");
}

function tryResolve(ctx, decision, choice, errorEl) {
  try {
    ctx.actions.resolveDecision(decision.id, choice);
  } catch (err) {
    const msg = err?.message || "Couldn't apply that choice.";
    if (errorEl) errorEl.textContent = msg;
    showToast(msg);
  }
}

function renderChange(ctx, change, workout, cfg) {
  const slot = workout?.slots?.find((x) => x.slotIndex === change.slotIndex);
  const exercise = exerciseOf(ctx, change.exerciseId);
  const pending = change.kind === "pending";
  return h("li", { class: `card change-card ${change.success ? "is-success" : "is-fail"}${pending ? " is-pending" : ""}` },
    h("div", { class: "slot-head" },
      h("span", { class: `tier-badge tier-${change.tier}` }, slot?.label || change.tier),
      h("h3", { class: "slot-name" }, change.name || exercise.name),
      h("span", { class: `slot-result ${change.success ? "is-success" : "is-fail"}`, "aria-label": change.success ? "Success" : "Failed" },
        change.success ? "✓" : "✗")),
    slot ? h("p", { class: "change-did" },
      h("span", { class: "change-scheme" }, slot.scheme),
      slot.weight != null ? h("span", {}, ` at ${fmtNum(slot.weight, 2)} lb`) : null,
      h("span", { class: "change-reps" }, ` — reps ${setsText(slot)}`)) : null,
    h("p", { class: `change-message${pending ? " is-pending" : ""}` }, change.message),
    change.to && change.to.weight != null && exercise.plates
      ? h("div", { class: "change-next" }, h("span", { class: "muted" }, "Load: "), weightLabel(change.to.weight, exercise, cfg, { compact: true }))
      : null,
  );
}

function renderT1Decision(ctx, decision, cfg) {
  const exercise = exerciseOf(ctx, decision.exerciseId);
  const sug = decision.suggestion || {};
  const error = h("p", { class: "field-error", role: "alert" });

  // Option A: tested 5RM
  const testedResult = h("div", { class: "decision-result" });
  const testedBtn = h("button", { type: "button", class: "btn btn-primary btn-block" }, "Use tested 5RM");
  const updateTested = (v) => {
    if (v == null || !(v > 0)) {
      mount(testedResult, h("span", { class: "muted" }, "Enter the 5RM you tested."));
      testedBtn.disabled = true;
      return;
    }
    let w;
    try { w = t1ResetWeight(v, cfg, ctx.program); } catch { w = null; }
    mount(testedResult, h("span", { class: "muted" }, "New weight: "), w != null ? weightLabel(w, exercise, cfg) : "–");
    testedBtn.disabled = w == null;
  };
  const initial5 = sug.estimated5RM != null ? Math.round(sug.estimated5RM / 5) * 5 : decision.context?.currentWeight ?? null;
  const tested = numberStepper({ value: initial5, step: 5, min: 0, max: 2000, label: "Tested 5RM (lb)", onInput: updateTested });
  updateTested(tested.get());
  testedBtn.addEventListener("click", () => {
    const v = tested.get();
    if (v == null || !(v > 0)) { error.textContent = "Enter a 5RM greater than 0."; return; }
    tryResolve(ctx, decision, { method: "tested", fiveRM: v }, error);
  });

  // Option B: estimate
  const hasEstimate = sug.estimated5RM != null && sug.weight != null;
  const sources = sug.sourceSets || [];
  const estimate = h("div", { class: "decision-option" },
    h("h4", { class: "option-title" }, "B · Accept estimate"),
    hasEstimate
      ? [
        h("p", { class: "decision-stat" },
          h("span", { class: "muted" }, "Estimated 5RM "), h("strong", {}, `${fmtNum(sug.estimated5RM)} lb`),
          sug.e1RM != null ? h("span", { class: "muted" }, ` (best e1RM ${fmtNum(sug.e1RM)} lb)`) : null),
        h("div", { class: "decision-result" }, h("span", { class: "muted" }, "New weight: "), weightLabel(sug.weight, exercise, cfg)),
      ]
      : h("p", { class: "muted" }, "No usable sets in the last workouts to estimate from."),
    sources.length ? h("table", { class: "data-table source-table" },
      h("caption", {}, "Best set from each recent workout"),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Date"), h("th", { scope: "col" }, "Set"), h("th", { scope: "col", class: "num" }, "e1RM"))),
      h("tbody", {}, sources.map((src) => h("tr", { class: src.best ? "is-best" : "" },
        h("td", {}, formatDate(src.date, { month: "short", day: "numeric" })),
        h("td", {}, `${fmtNum(src.weight, 2)} × ${src.reps}`, src.best ? h("span", { class: "best-tag" }, "best") : null),
        h("td", { class: "num" }, fmtNum(src.e1RM)))))) : null,
    h("button", {
      type: "button", class: "btn btn-secondary btn-block", disabled: !hasEstimate,
      onClick: () => tryResolve(ctx, decision, { method: "estimate" }, error),
    }, "Accept estimate"),
  );

  return h("section", { class: "card decision-card", "aria-labelledby": `dec-${decision.id}` },
    h("div", { class: "slot-head" },
      h("span", { class: "tier-badge tier-T1" }, "T1"),
      h("h3", { class: "slot-name", id: `dec-${decision.id}` }, `Reset: ${decision.name || exercise.name}`)),
    h("p", { class: "sheet-message" },
      `Stage 3 failed at ${fmtNum(decision.context?.currentWeight, 2)} lb. Restart at stage 1 with 85% of a 5RM — choose one:`),
    h("div", { class: "decision-option" },
      h("h4", { class: "option-title" }, "A · Enter a tested 5RM"),
      h("div", { class: "stepper-row" }, tested.el, h("span", { class: "stepper-unit" }, "lb")),
      testedResult,
      testedBtn),
    estimate,
    error,
  );
}

function renderT2Decision(ctx, decision, cfg) {
  const exercise = exerciseOf(ctx, decision.exerciseId);
  const sug = decision.suggestion || {};
  const error = h("p", { class: "field-error", role: "alert" });
  const result = h("div", { class: "decision-result" });
  const saveBtn = h("button", { type: "button", class: "btn btn-primary btn-block" }, "Restart at this weight");
  const update = (v) => {
    error.textContent = "";
    if (v == null || v < 0) { mount(result, h("span", { class: "muted" }, "Enter a weight.")); saveBtn.disabled = true; return; }
    mount(result, h("span", { class: "muted" }, "New stage-1 weight: "), weightLabel(v, exercise, cfg));
    saveBtn.disabled = false;
  };
  const step = exercise.plates ? loadStep(cfg) : 5;
  const stepper = numberStepper({ value: sug.weight, step, min: 0, max: 2000, label: "New weight (lb)", onInput: update });
  update(stepper.get());
  saveBtn.addEventListener("click", () => {
    const v = stepper.get();
    if (v == null || v < 0) { error.textContent = "Enter a weight."; return; }
    tryResolve(ctx, decision, { weight: v }, error);
  });

  return h("section", { class: "card decision-card", "aria-labelledby": `dec-${decision.id}` },
    h("div", { class: "slot-head" },
      h("span", { class: "tier-badge tier-T2" }, "T2"),
      h("h3", { class: "slot-name", id: `dec-${decision.id}` }, `Reset: ${decision.name || exercise.name}`)),
    h("p", { class: "sheet-message" },
      `Stage 3 failed at ${fmtNum(decision.context?.currentWeight, 2)} lb. Restart at 3×10 from your last stage-1 start`,
      decision.context?.stageStartWeight != null ? ` (${fmtNum(decision.context.stageStartWeight, 2)} lb)` : "",
      " plus 15–20 lb, or type any weight."),
    h("p", { class: "decision-stat" }, h("span", { class: "muted" }, "Suggested window "),
      h("strong", {}, `${fmtNum(sug.min, 2)}–${fmtNum(sug.max, 2)} lb`)),
    h("div", { class: "quick-row" },
      h("button", { type: "button", class: "btn btn-secondary", onClick: () => stepper.set(sug.min) }, `${fmtNum(sug.min, 2)} lb`),
      h("button", { type: "button", class: "btn btn-secondary", onClick: () => stepper.set(sug.max) }, `${fmtNum(sug.max, 2)} lb`)),
    h("div", { class: "stepper-row" }, stepper.el, h("span", { class: "stepper-unit" }, "lb")),
    result,
    saveBtn,
    error,
  );
}

export function render(root, ctx) {
  const workouts = ctx.state.workouts || [];
  const workout = workouts[workouts.length - 1];
  const decisions = ctx.state.pendingDecisions || [];
  const cfg = plateConfig(ctx.program, ctx.state.settings);

  if (!workout) {
    mount(root, h("div", { class: "screen screen-summary" },
      h("div", { class: "empty-state" }, h("h1", {}, "No finished workout yet"),
        h("button", { type: "button", class: "btn btn-primary btn-block btn-xl", onClick: () => ctx.navigate("workout") }, "Go to workout"))));
    return undefined;
  }

  const changes = workout.changes || [];
  const wins = changes.filter((c) => c.success).length;
  const dayName = ctx.program.days?.[workout.dayId]?.name || workout.dayId;

  mount(root, h("div", { class: "screen screen-summary" },
    h("header", { class: "screen-header" },
      h("div", { class: "title-block" },
        h("h1", {}, `${dayName} done`),
        h("p", { class: "subtitle" }, `${formatDate(workout.finishedAt ?? workout.startedAt, { weekday: "long", month: "short", day: "numeric" })} · ${wins}/${changes.length} lifts hit`))),
    decisions.length ? h("div", { class: "decisions" },
      h("h2", { class: "section-title" }, decisions.length === 1 ? "1 decision needed" : `${decisions.length} decisions needed`),
      decisions.map((d) => (d.type === "t1-reset" ? renderT1Decision(ctx, d, cfg) : renderT2Decision(ctx, d, cfg)))) : null,
    h("h2", { class: "section-title" }, "What changes next time"),
    h("ul", { class: "change-list" }, changes.map((c) => renderChange(ctx, c, workout, cfg))),
    h("div", { class: "finish-area" },
      h("button", {
        type: "button", class: "btn btn-primary btn-block btn-xl", disabled: decisions.length > 0,
        onClick: () => ctx.actions.dismissSummary(),
      }, "Done"),
      decisions.length ? h("p", { class: "finish-note" }, "Resolve the reset decision above to continue.") : null),
  ));
  return undefined;
}
