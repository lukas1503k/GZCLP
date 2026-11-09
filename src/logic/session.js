// Session-level state transitions: finishing, undo, overrides, substitutions. Pure.
import { applyWorkout, initialLiftState } from "./progression.js";
import { advance } from "./rotation.js";

const LIFT_FIELDS = ["weight", "stage", "stageStartWeight", "repTarget"];

export function ensureLifts(state, program) {
  const lifts = { ...(state.lifts ?? {}) };
  for (const day of Object.values(program.days)) {
    for (const slot of day.slots) {
      const byTier = lifts[slot.exerciseId] ?? {};
      if (byTier[slot.tier]) continue;
      lifts[slot.exerciseId] = { ...byTier, [slot.tier]: initialLiftState(program, slot.exerciseId, slot.tier) };
    }
  }
  return { ...state, lifts };
}

export function finishWorkout(state, program, now) {
  if (!state.inProgress) throw new Error("No workout in progress");
  const snapshotBefore = structuredClone({ lifts: state.lifts ?? {}, rotationIndex: state.rotationIndex ?? 0 });
  const finished = { ...state.inProgress, finishedAt: now };
  const { state: applied, changes, pendingDecisions } = applyWorkout(state, finished, program, now);
  const workout = { ...finished, changes, snapshotBefore };
  const older = (state.workouts ?? []).map((w) => (w.snapshotBefore ? { ...w, snapshotBefore: null } : w));
  return {
    state: {
      ...applied,
      workouts: [...older, workout],
      rotationIndex: advance(program, state.rotationIndex ?? 0),
      inProgress: null,
      timer: null,
      pendingDecisions: [...(state.pendingDecisions ?? []), ...pendingDecisions],
    },
    changes,
    pendingDecisions,
  };
}

export function canUndo(state) {
  const last = state.workouts?.[state.workouts.length - 1];
  return Boolean(last?.snapshotBefore);
}

export function undoLastWorkout(state) {
  if (!canUndo(state)) throw new Error("Nothing to undo");
  const last = state.workouts[state.workouts.length - 1];
  const { lifts: snap, rotationIndex } = structuredClone(last.snapshotBefore);
  // Restore only the lifts this workout touched; later changes to other lifts survive.
  const lifts = structuredClone(state.lifts ?? {});
  for (const { exerciseId, tier } of last.slots ?? []) {
    const saved = snap?.[exerciseId]?.[tier];
    if (saved) {
      lifts[exerciseId] = { ...(lifts[exerciseId] ?? {}), [tier]: saved };
    } else if (lifts[exerciseId]) {
      delete lifts[exerciseId][tier];
      if (Object.keys(lifts[exerciseId]).length === 0) delete lifts[exerciseId];
    }
  }
  return {
    ...state,
    lifts,
    rotationIndex,
    workouts: state.workouts.slice(0, -1),
    pendingDecisions: (state.pendingDecisions ?? []).filter((d) => d.workoutId !== last.id),
    inProgress: null,
    timer: null,
  };
}

export function applyOverride(state, exerciseId, tier, patch, reason, now) {
  const prev = state.lifts?.[exerciseId]?.[tier] ?? { weight: null, stage: 1, stageStartWeight: null, repTarget: null, history: [] };
  const next = { ...prev };
  for (const k of LIFT_FIELDS) if (patch && k in patch) next[k] = patch[k];
  // A starting weight set over an unset run also starts the stage-1 run.
  if (prev.stageStartWeight == null && patch && "weight" in patch && !("stageStartWeight" in patch)) {
    next.stageStartWeight = patch.weight;
  }
  const text = typeof reason === "string" && reason.trim() ? reason.trim() : null;
  const pick = (l) => Object.fromEntries(LIFT_FIELDS.map((k) => [k, l[k] ?? null]));
  const event = { at: now, type: "override", workoutId: null, from: pick(prev), to: pick(next), reason: text, detail: null };
  next.history = [...(prev.history ?? []), event];
  return {
    ...state,
    lifts: { ...state.lifts, [exerciseId]: { ...(state.lifts?.[exerciseId] ?? {}), [tier]: next } },
  };
}

function withProgram(state, fn) {
  const program = {
    substitutions: { ...(state.program?.substitutions ?? {}) },
    customExercises: { ...(state.program?.customExercises ?? {}) },
  };
  fn(program);
  return { ...state, program };
}

export function setSubstitution(state, dayId, slotIndex, exerciseId) {
  return withProgram(state, (p) => {
    const key = `${dayId}:${slotIndex}`;
    if (exerciseId == null) delete p.substitutions[key];
    else p.substitutions[key] = exerciseId;
  });
}

export function addCustomExercise(state, exercise) {
  if (!exercise || typeof exercise.id !== "string" || !exercise.id.startsWith("custom_")) {
    throw new Error('Custom exercise id must start with "custom_"');
  }
  return withProgram(state, (p) => {
    p.customExercises[exercise.id] = structuredClone(exercise);
  });
}
