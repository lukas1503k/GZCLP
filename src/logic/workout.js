// Building and logging an in-progress workout. Pure.
import { getDay, getExercise } from "./program.js";
import { plateConfig, roundToLoadable } from "./plates.js";
import { warmupSets } from "./warmup.js";
import { initialLiftState, prescription } from "./progression.js";

export function buildSlot(state, program, dayId, slotIndex) {
  const def = getDay(program, dayId).slots[slotIndex];
  if (!def) throw new Error(`Day ${dayId} has no slot ${slotIndex}`);
  const exercise = getExercise(program, def.exerciseId);
  const lift = state.lifts?.[exercise.id]?.[def.tier] ?? initialLiftState(program, exercise.id, def.tier);
  const cfg = plateConfig(program, state.settings);
  const isBodyweight = exercise.type === "bodyweight";

  let weight = lift.weight ?? null;
  if (weight != null && exercise.plates) weight = roundToLoadable(weight, cfg);

  const { stage, sets, scheme } = prescription(program, exercise.id, def.tier, lift);
  const warmups =
    def.tier === "T1" && exercise.warmup && weight != null
      ? warmupSets(weight, cfg, program.defaults.warmup).map((w) => ({ ...w, done: false }))
      : [];

  return {
    slotIndex,
    label: def.label ?? def.tier,
    exerciseId: exercise.id,
    tier: def.tier,
    stage,
    weight,
    repTarget: isBodyweight ? lift.repTarget : null,
    scheme,
    sets: sets.map((s) => ({ target: s.target, reps: null, amrap: s.amrap, done: false })),
    warmups,
  };
}

export function buildWorkout(state, program, dayId, now) {
  const day = getDay(program, dayId);
  return {
    id: `w${now}`,
    dayId,
    startedAt: now,
    finishedAt: null,
    slots: day.slots.map((_, i) => buildSlot(state, program, dayId, i)),
    changes: null,
    snapshotBefore: null,
  };
}

function updateSet(workout, slotIndex, setIndex, patch) {
  const slot = workout.slots[slotIndex];
  if (!slot || !slot.sets[setIndex]) throw new Error(`No set ${setIndex} in slot ${slotIndex}`);
  const sets = slot.sets.map((s, i) => (i === setIndex ? { ...s, ...patch } : s));
  const slots = workout.slots.map((s, i) => (i === slotIndex ? { ...s, sets } : s));
  return { ...workout, slots };
}

export function logSet(workout, slotIndex, setIndex, reps) {
  if (!Number.isInteger(reps) || reps < 0) throw new Error("Reps must be a whole number ≥ 0");
  return updateSet(workout, slotIndex, setIndex, { reps, done: true });
}

export function clearSet(workout, slotIndex, setIndex) {
  return updateSet(workout, slotIndex, setIndex, { reps: null, done: false });
}

export function toggleWarmup(workout, slotIndex, warmupIndex) {
  const slot = workout.slots[slotIndex];
  if (!slot || !slot.warmups[warmupIndex]) throw new Error(`No warm-up ${warmupIndex} in slot ${slotIndex}`);
  const warmups = slot.warmups.map((w, i) => (i === warmupIndex ? { ...w, done: !w.done } : w));
  const slots = workout.slots.map((s, i) => (i === slotIndex ? { ...s, warmups } : s));
  return { ...workout, slots };
}

export function allSetsDone(workout) {
  return workout.slots.every((slot) => slot.sets.every((s) => s.done));
}

export function nextSet(workout) {
  for (const slot of workout.slots) {
    const setIndex = slot.sets.findIndex((s) => !s.done);
    if (setIndex !== -1) return { slotIndex: slot.slotIndex, setIndex };
  }
  return null;
}

export function describeSet(workout, program, pointer) {
  if (!pointer) return null;
  const slot = workout.slots.find((s) => s.slotIndex === pointer.slotIndex) ?? workout.slots[pointer.slotIndex];
  if (!slot) return null;
  const name = getExercise(program, slot.exerciseId).name;
  return `${name} · set ${pointer.setIndex + 1} of ${slot.sets.length}`;
}
