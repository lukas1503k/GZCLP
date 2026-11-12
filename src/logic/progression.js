// GZCLP progression rules (SPEC §3). Pure: never mutates inputs; time is passed in.
import { getExercise } from "./program.js";
import { plateConfig, roundToLoadable } from "./plates.js";
import { bestE1RM, estimate5RM, workoutDate, workoutSets } from "./onerm.js";

const lb = (w) => `${w} lb`;
const round4 = (w) => Math.round(w * 10000) / 10000;

// ---------- helpers ----------

function tierDef(program, tier) {
  const t = program.tiers[tier];
  if (!t) throw new Error(`Unknown tier "${tier}"`);
  return t;
}

/** Bodyweight rule: the slot's own tier if it defines one, otherwise the first tier that does. */
function bodyweightRule(program, tier) {
  return program.tiers[tier]?.bodyweight ?? Object.values(program.tiers).find((t) => t.bodyweight)?.bodyweight;
}

/**
 * Exercise-level double progression (e.g. RDL 3×8–12): only applies in a T3 slot,
 * so the same exercise used as a T1/T2 substitute still follows that tier's stages.
 */
export function doubleRule(exercise, tier) {
  const p = exercise?.progression;
  return tier === "T3" && p?.type === "double" && exercise.type !== "bodyweight" ? p : null;
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/** Current rep goal for a double-progression lift, kept inside the rule's range. */
function doubleTarget(rule, liftState) {
  return clamp(liftState?.repTarget ?? rule.minReps, rule.minReps, rule.maxReps);
}

/** "bodyweight" | "double" | "threshold" | "stages" */
function ruleKind(exercise, def, tier) {
  if (exercise.type === "bodyweight") return "bodyweight";
  if (doubleRule(exercise, tier)) return "double";
  if (def.weighted) return "threshold";
  return "stages";
}

/** Round a computed weight the way this exercise is loaded: plates -> loadable, otherwise as-is. */
export function roundWeightFor(exercise, weight, cfg) {
  if (weight == null) return null;
  return exercise.plates ? roundToLoadable(weight, cfg) : round4(weight);
}

function snap(lift) {
  return {
    weight: lift.weight,
    stage: lift.stage,
    stageStartWeight: lift.stageStartWeight,
    repTarget: lift.repTarget,
  };
}

function makeEvent(now, type, workoutId, from, to, reason = null, detail = null) {
  return { at: now, type, workoutId, from: snap(from), to: snap(to), reason, detail };
}

// ---------- public API ----------

export function incrementFor(exercise, settings) {
  const useSmall = settings?.smallIncrements && settings?.smallPlates && exercise.smallIncrement != null;
  return useSmall ? exercise.smallIncrement : exercise.increment;
}

export function initialLiftState(program, exerciseId, tier) {
  const ex = getExercise(program, exerciseId);
  const weight = ex.startingWeight?.[tier] ?? null;
  let repTarget = null;
  if (ex.type === "bodyweight") {
    repTarget = ex.startingRepTarget ?? tierDef(program, tier).stages[0].reps;
  } else if (doubleRule(ex, tier)) {
    repTarget = doubleRule(ex, tier).minReps;
  }
  return { weight, stage: 1, stageStartWeight: weight, repTarget, history: [] };
}

export function prescription(program, exerciseId, tier, liftState) {
  const ex = getExercise(program, exerciseId);
  const def = tierDef(program, tier);
  if (ex.type === "bodyweight") {
    const rule = bodyweightRule(program, tier);
    const target = liftState.repTarget;
    const sets = Array.from({ length: rule.sets }, (_, i) => ({ target, amrap: i === rule.sets - 1 }));
    return { stage: 1, sets, scheme: `${rule.sets}×${target}+` };
  }
  const dbl = doubleRule(ex, tier);
  if (dbl) {
    const target = doubleTarget(dbl, liftState);
    const sets = Array.from({ length: dbl.sets }, () => ({ target, amrap: false }));
    return { stage: 1, sets, scheme: `${dbl.sets}×${target} (${dbl.minReps}–${dbl.maxReps})` };
  }
  const stage = Math.min(Math.max(liftState.stage ?? 1, 1), def.stages.length);
  const s = def.stages[stage - 1];
  const sets = Array.from({ length: s.sets }, (_, i) => ({ target: s.reps, amrap: s.amrap && i === s.sets - 1 }));
  return { stage, sets, scheme: `${s.sets}×${s.reps}` };
}

export function slotSuccess(slot) {
  const sets = slot.sets ?? [];
  return sets.length > 0 && sets.every((s) => s.reps != null && s.reps >= s.target);
}

export function t1ResetWeight(fiveRM, cfg, program, exercise) {
  const reset = Object.values(program.tiers).find((t) => t.reset?.type === "t1-reset")?.reset;
  if (!reset) throw new Error("program has no t1-reset tier");
  const raw = reset.percentOf5RM * fiveRM;
  return exercise ? roundWeightFor(exercise, raw, cfg) : roundToLoadable(raw, cfg);
}

function t1Suggestion(state, workout, program, exercise, tier, cfg) {
  const { lookbackWorkouts, percentOf5RM } = tierDef(program, tier).reset;
  const uses = (w) => (w.slots ?? []).some((s) => s.exerciseId === exercise.id && s.tier === tier);
  const prior = (state.workouts ?? []).filter((w) => w.id !== workout.id);
  const considered = [...prior, workout].filter(uses).slice(-lookbackWorkouts);
  const sourceSets = [];
  for (const w of considered) {
    const best = bestE1RM(workoutSets(w, exercise.id, tier));
    if (best) {
      sourceSets.push({ workoutId: w.id, date: workoutDate(w), weight: best.set.weight, reps: best.set.reps, e1RM: best.e1RM, best: false });
    }
  }
  if (sourceSets.length === 0) return { estimated5RM: null, e1RM: null, weight: null, sourceSets };
  const top = sourceSets.reduce((a, b) => (b.e1RM > a.e1RM ? b : a));
  top.best = true;
  const estimated5RM = estimate5RM(top.e1RM);
  return { estimated5RM, e1RM: top.e1RM, weight: roundWeightFor(exercise, percentOf5RM * estimated5RM, cfg), sourceSets };
}

function t2Suggestion(program, exercise, tier, lift, slot, cfg) {
  const { addMin, addMax } = tierDef(program, tier).reset;
  const ssw = lift.stageStartWeight ?? lift.weight ?? slot.weight;
  const min = roundWeightFor(exercise, ssw + addMin, cfg);
  return { weight: min, min, max: roundWeightFor(exercise, ssw + addMax, cfg) };
}

function buildDecision(state, workout, program, exercise, slot, lift, cfg) {
  const def = tierDef(program, slot.tier);
  const type = def.reset.type;
  const suggestion =
    type === "t1-reset"
      ? t1Suggestion(state, workout, program, exercise, slot.tier, cfg)
      : t2Suggestion(program, exercise, slot.tier, lift, slot, cfg);
  return {
    id: `${workout.id}:${exercise.id}:${slot.tier}`,
    type,
    workoutId: workout.id,
    exerciseId: exercise.id,
    tier: slot.tier,
    name: exercise.name,
    suggestion,
    context: { currentWeight: slot.weight, stageStartWeight: lift.stageStartWeight },
  };
}

/** Evaluates one slot. Returns { next (LiftState|null = unchanged), kind, decision? }. */
function evaluateSlot(state, workout, program, exercise, slot, prev, cfg) {
  const def = tierDef(program, slot.tier);
  const kind = ruleKind(exercise, def, slot.tier);
  const reps = (slot.sets ?? []).map((s) => s.reps ?? 0);
  const last = reps.length ? reps[reps.length - 1] : 0;
  const inc = incrementFor(exercise, state.settings);

  if (kind === "bodyweight") {
    const rule = bodyweightRule(program, slot.tier);
    const target = slot.repTarget ?? prev.repTarget;
    if (last >= target + rule.amrapBonus) {
      return { next: { ...prev, repTarget: target + rule.repTargetIncrement }, kind: "repTarget" };
    }
    return { next: { ...prev, repTarget: target }, kind: "same" };
  }

  if (slot.weight == null) return { next: null, kind: "same" };

  if (kind === "double") {
    // All sets at the top of the range -> add weight and drop back to the bottom.
    // Otherwise keep the weight; once every set reaches the goal, the next goal is
    // one rep past the weakest set (capped at the top of the range).
    const rule = doubleRule(exercise, slot.tier);
    const target = clamp(slot.repTarget ?? doubleTarget(rule, prev), rule.minReps, rule.maxReps);
    const lowest = reps.length ? Math.min(...reps) : 0;
    if (reps.length && lowest >= rule.maxReps) {
      return { next: { ...prev, weight: round4(slot.weight + inc), stage: 1, repTarget: rule.minReps }, kind: "increase" };
    }
    if (reps.length && lowest >= target) {
      return { next: { ...prev, weight: slot.weight, stage: 1, repTarget: Math.min(lowest + 1, rule.maxReps) }, kind: "repTarget" };
    }
    return { next: { ...prev, weight: slot.weight, stage: 1, repTarget: target }, kind: "same" };
  }

  if (kind === "threshold") {
    if (last >= def.weighted.amrapThreshold) return { next: { ...prev, weight: round4(slot.weight + inc), stage: 1 }, kind: "increase" };
    return { next: { ...prev, weight: slot.weight, stage: 1 }, kind: "same" };
  }

  const ssw = prev.stageStartWeight ?? slot.weight;
  const stage = slot.stage ?? prev.stage;
  if (slotSuccess({ sets: slot.sets })) {
    return { next: { ...prev, weight: round4(slot.weight + inc), stage, stageStartWeight: ssw }, kind: "increase" };
  }
  if (stage < def.stages.length) {
    return { next: { ...prev, weight: slot.weight, stage: stage + 1, stageStartWeight: ssw }, kind: "stage" };
  }
  return { next: null, kind: "pending", decision: buildDecision(state, workout, program, exercise, slot, prev, cfg) };
}

function changeMessage(kind, program, exercise, tier, next) {
  if (kind === "pending") return "Reset decision needed";
  if (!next) return "No weight set";
  const { scheme, stage } = prescription(program, exercise.id, tier, next);
  const hasStages = tierDef(program, tier).stages.length > 1 && exercise.type !== "bodyweight";
  switch (kind) {
    case "repTarget":
      return doubleRule(exercise, tier) ? `Next: ${scheme} at ${lb(next.weight)}` : `Next: target ${next.repTarget} reps (${scheme})`;
    case "stage":
      return `Next: stage ${stage} (${scheme}) at ${lb(next.weight)}`;
    case "reset":
      return `Reset: stage 1 (${scheme}) at ${lb(next.weight)}`;
    case "increase":
      return hasStages ? `Next: ${lb(next.weight)} · stage ${stage} (${scheme})` : `Next: ${lb(next.weight)} (${scheme})`;
    default:
      return exercise.type === "bodyweight" ? `Next: same target (${scheme})` : `Next: same weight (${lb(next.weight)})`;
  }
}

export function applyWorkout(state, workout, program, now) {
  const lifts = structuredClone(state.lifts ?? {});
  const cfg = plateConfig(program, state.settings);
  const changes = [];
  const pendingDecisions = [];

  for (const slot of workout.slots ?? []) {
    const exercise = getExercise(program, slot.exerciseId);
    const prev = lifts[exercise.id]?.[slot.tier] ?? initialLiftState(program, exercise.id, slot.tier);
    const { next, kind, decision } = evaluateSlot(state, workout, program, exercise, slot, prev, cfg);

    if (next) {
      const reps = (slot.sets ?? []).map((s) => s.reps ?? 0);
      const detail = { kind, success: slotSuccess(slot), reps, weight: slot.weight };
      const event = makeEvent(now, kind === "stage" ? "stage" : "progress", workout.id, prev, next, null, detail);
      lifts[exercise.id] = { ...(lifts[exercise.id] ?? {}), [slot.tier]: { ...next, history: [...(prev.history ?? []), event] } };
    }
    if (decision) pendingDecisions.push(decision);

    const from = { weight: slot.weight, stage: slot.stage, repTarget: slot.repTarget ?? null };
    let to = null;
    if (kind !== "pending") to = next ? { weight: next.weight, stage: next.stage, repTarget: next.repTarget } : { ...from };
    changes.push({
      slotIndex: slot.slotIndex,
      exerciseId: exercise.id,
      tier: slot.tier,
      name: exercise.name,
      success: slotSuccess(slot),
      kind,
      from,
      to,
      message: changeMessage(kind, program, exercise, slot.tier, next),
    });
  }
  return { state: { ...state, lifts }, changes, pendingDecisions };
}

function positive(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function resetWeight(decision, choice, program, exercise, cfg) {
  if (!choice || typeof choice !== "object") throw new Error("Invalid choice");
  if (decision.type === "t1-reset") {
    const pct = tierDef(program, decision.tier).reset.percentOf5RM;
    if (choice.method === "tested") {
      if (!positive(choice.fiveRM)) throw new Error("Tested 5RM must be a positive number");
      return { weight: roundWeightFor(exercise, pct * choice.fiveRM, cfg), reason: "tested-5rm", detail: { method: "tested", fiveRM: choice.fiveRM } };
    }
    if (choice.method === "estimate") {
      const s = decision.suggestion;
      if (s?.weight == null) throw new Error("No estimate available; enter a tested 5RM");
      return { weight: s.weight, reason: "estimated-5rm", detail: { method: "estimate", estimated5RM: s.estimated5RM, e1RM: s.e1RM, sourceSets: s.sourceSets } };
    }
    throw new Error("Invalid choice for a T1 reset");
  }
  if (!positive(choice.weight)) throw new Error("Reset weight must be a positive number");
  return { weight: roundWeightFor(exercise, choice.weight, cfg), reason: "t2-reset", detail: { method: "weight", chosen: choice.weight, suggestion: decision.suggestion } };
}

export function resolveDecision(state, decision, choice, program, now) {
  const id = typeof decision === "string" ? decision : decision?.id;
  const d = (state.pendingDecisions ?? []).find((x) => x.id === id);
  if (!d) throw new Error("Decision not found");
  const exercise = getExercise(program, d.exerciseId);
  const cfg = plateConfig(program, state.settings);
  const { weight, reason, detail } = resetWeight(d, choice, program, exercise, cfg);

  const prev = state.lifts?.[d.exerciseId]?.[d.tier] ?? initialLiftState(program, d.exerciseId, d.tier);
  const next = { ...prev, weight, stage: 1, stageStartWeight: weight };
  const event = makeEvent(now, "reset", d.workoutId, prev, next, reason, detail);
  const lifts = {
    ...state.lifts,
    [d.exerciseId]: { ...(state.lifts?.[d.exerciseId] ?? {}), [d.tier]: { ...next, history: [...(prev.history ?? []), event] } },
  };

  const message = changeMessage("reset", program, exercise, d.tier, next);
  const workouts = (state.workouts ?? []).map((w) => {
    if (w.id !== d.workoutId || !w.changes) return w;
    const changes = w.changes.map((c) =>
      c.exerciseId === d.exerciseId && c.tier === d.tier && c.kind === "pending"
        ? { ...c, kind: "reset", to: { weight, stage: 1, repTarget: c.from?.repTarget ?? null }, message }
        : c,
    );
    return { ...w, changes };
  });

  return {
    ...state,
    lifts,
    workouts,
    pendingDecisions: state.pendingDecisions.filter((x) => x.id !== id),
  };
}

export function previewOutcomes(program, exerciseId, tier, liftState, settings) {
  const ex = getExercise(program, exerciseId);
  const def = tierDef(program, tier);
  const cfg = plateConfig(program, settings);
  const kind = ruleKind(ex, def, tier);
  if (kind === "bodyweight") {
    const rule = bodyweightRule(program, tier);
    const t = liftState.repTarget;
    return {
      onSuccess: `Target ${t + rule.repTargetIncrement} reps (last set ≥ ${t + rule.amrapBonus})`,
      onFail: `Same target (${t} reps)`,
    };
  }
  if (liftState.weight == null) return { onSuccess: "Set a starting weight", onFail: "Set a starting weight" };
  const w = roundWeightFor(ex, liftState.weight, cfg);
  const up = lb(round4(w + incrementFor(ex, settings)));
  if (kind === "double") {
    const rule = doubleRule(ex, tier);
    const t = doubleTarget(rule, liftState);
    return {
      onSuccess: `${up} × ${rule.minReps} (all sets ≥ ${rule.maxReps})`,
      onFail: t >= rule.maxReps ? `Same weight, aim for ${rule.maxReps} on every set` : `Same weight, add reps (goal ${t}+ each set)`,
    };
  }
  if (kind === "threshold") {
    return { onSuccess: `${up} (last set ≥ ${def.weighted.amrapThreshold})`, onFail: `Same weight (${lb(w)})` };
  }
  const stage = Math.min(Math.max(liftState.stage ?? 1, 1), def.stages.length);
  if (stage < def.stages.length) {
    const s = def.stages[stage];
    return { onSuccess: up, onFail: `Stage ${stage + 1} (${s.sets}×${s.reps}) at ${lb(w)}` };
  }
  return { onSuccess: up, onFail: "Reset decision" };
}
