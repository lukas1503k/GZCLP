import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ensureLifts, finishWorkout, undoLastWorkout, canUndo, applyOverride, setSubstitution, addCustomExercise,
} from "../src/logic/session.js";
import { effectiveProgram } from "../src/logic/program.js";
import { buildWorkout, buildSlot, logSet } from "../src/logic/workout.js";
import { nextDayId } from "../src/logic/rotation.js";
import { resolveDecision } from "../src/logic/progression.js";

const base = JSON.parse(readFileSync(new URL("../program.json", import.meta.url), "utf8"));
const SETTINGS = { smallIncrements: false, smallPlates: false, barWeight: 45 };
const empty = () => ({ schemaVersion: 1, program: { substitutions: {}, customExercises: {} }, lifts: {}, rotationIndex: 0, workouts: [], inProgress: null, timer: null, pendingDecisions: [], settings: { ...SETTINGS } });

function fillAll(w, repsFor = (s) => s.target) {
  for (const slot of w.slots) slot.sets.forEach((s, i) => { w = logSet(w, slot.slotIndex, i, repsFor(s, slot, i)); });
  return w;
}
/** Starts the next day (per rotation) and finishes it. */
function next(state, program, now, repsFor) {
  const inProgress = fillAll(buildWorkout(state, program, nextDayId(program, state.rotationIndex), now), repsFor);
  return finishWorkout({ ...state, inProgress, timer: { endsAt: now + 1 } }, program, now + 10).state;
}

test("ensureLifts adds every (exercise, tier) used by days and never touches existing", () => {
  const s = ensureLifts(empty(), base);
  assert.deepEqual(Object.keys(s.lifts).sort(), ["barbell_curl", "barbell_row", "bench", "deadlift", "hanging_leg_raise", "lat_pulldown", "leg_press", "ohp", "rdl", "squat"]);
  assert.deepEqual(Object.keys(s.lifts.squat).sort(), ["T1", "T2"]);
  assert.equal(s.lifts.deadlift.T1.weight, 270);
  assert.equal(s.lifts.deadlift.T2.weight, 205);
  assert.equal(s.lifts.ohp.T1.weight, 100);
  assert.equal(s.lifts.ohp.T2.weight, 75);
  assert.equal(s.lifts.bench.T1.weight, 145);
  assert.equal(s.lifts.barbell_row.T3.weight, 95);
  assert.deepEqual(Object.keys(s.lifts.rdl), ["T3"]);
  assert.equal(s.lifts.rdl.T3.weight, null, "RDL starting weight is entered on first use");
  assert.equal(s.lifts.rdl.T3.repTarget, 8);
  assert.equal(s.lifts.leg_press.T3.weight, null);
  assert.equal(s.lifts.front_squat, undefined, "library exercises get no state until used");
  const custom = { ...s, lifts: { ...s.lifts, squat: { ...s.lifts.squat, T1: { ...s.lifts.squat.T1, weight: 999 } } } };
  assert.equal(ensureLifts(custom, base).lifts.squat.T1.weight, 999);
});

test("finishWorkout: snapshot, rotation advance, cleanup", () => {
  const s0 = ensureLifts(empty(), base);
  const s1 = next(s0, base, 100);
  assert.equal(s1.rotationIndex, 1);
  assert.equal(s1.inProgress, null);
  assert.equal(s1.timer, null);
  assert.equal(s1.workouts.length, 1);
  const w = s1.workouts[0];
  assert.equal(w.finishedAt, 110);
  assert.equal(w.changes.length, 5);
  assert.deepEqual(w.snapshotBefore, { lifts: s0.lifts, rotationIndex: 0 });
  assert.notEqual(w.snapshotBefore.lifts, s0.lifts, "deep clone");
  assert.equal(s1.lifts.squat.T1.weight, 255);

  const s2 = next(s1, base, 200);
  assert.equal(s2.workouts[0].snapshotBefore, null, "older snapshots stripped");
  assert.ok(s2.workouts[1].snapshotBefore);
  const s3 = next(s2, base, 300);
  const s4 = next(s3, base, 400);
  assert.equal(s3.workouts.at(-1).dayId, "A2");
  assert.equal(s4.workouts.at(-1).dayId, "B2");
  assert.equal(s4.rotationIndex, 0, "B2 -> A1 wraps");
  assert.equal(nextDayId(base, s4.rotationIndex), "A1");
  assert.equal(s4.workouts.filter((w) => w.snapshotBefore).length, 1);
  assert.throws(() => finishWorkout(s4, base, 1), /No workout/);
});

test("finishWorkout appends new decisions to existing pending ones", () => {
  let s = ensureLifts(empty(), base);
  s = applyOverride(s, "squat", "T1", { stage: 3 }, null, 1);
  s = applyOverride(s, "bench", "T2", { stage: 3 }, null, 1);
  const prior = { id: "old:x:T1", workoutId: "old" };
  s = { ...s, pendingDecisions: [prior] };
  const r = finishWorkout({ ...s, inProgress: fillAll(buildWorkout(s, base, "A1", 50), () => 0) }, base, 60);
  assert.equal(r.pendingDecisions.length, 2);
  assert.deepEqual(r.state.pendingDecisions.map((d) => d.id), ["old:x:T1", "w50:squat:T1", "w50:bench:T2"]);
});

test("undoLastWorkout restores lifts + rotation exactly and removes workout & its decisions", () => {
  let s = ensureLifts(empty(), base);
  s = next(s, base, 100);
  s = applyOverride(s, "ohp", "T1", { stage: 3 }, null, 150);
  const before = structuredClone(s);
  const after = next(s, base, 200, (set, slot) => (slot.tier === "T1" ? 0 : set.target)); // B1: OHP T1 stage-3 fail
  assert.equal(after.pendingDecisions.length, 1);
  assert.equal(canUndo(after), true);
  const undone = undoLastWorkout(after);
  assert.deepEqual(undone.lifts, before.lifts);
  assert.equal(undone.rotationIndex, before.rotationIndex);
  assert.deepEqual(undone.workouts.map((w) => w.id), ["w100"]);
  assert.deepEqual(undone.pendingDecisions, []);
  assert.equal(undone.inProgress, null);
  assert.equal(undone.timer, null);
  // older workout lost its snapshot -> nothing more to undo
  assert.equal(canUndo(undone), false);
  assert.throws(() => undoLastWorkout(undone), /undo/);
  assert.equal(canUndo(empty()), false);
});

test("undo after resolving a decision restores the pre-workout state", () => {
  let s = ensureLifts(empty(), base);
  s = applyOverride(s, "squat", "T1", { stage: 3 }, null, 1);
  const before = structuredClone(s);
  const r = finishWorkout({ ...s, inProgress: fillAll(buildWorkout(s, base, "A1", 50), (x, slot) => (slot.tier === "T1" ? 0 : x.target)) }, base, 60);
  const resolved = resolveDecision(r.state, r.pendingDecisions[0], { method: "tested", fiveRM: 250 }, base, 70);
  const undone = undoLastWorkout(resolved);
  assert.deepEqual(undone.lifts, before.lifts);
});

test("applyOverride logs an override event and next buildSlot uses it", () => {
  const s0 = ensureLifts(empty(), base);
  const s1 = applyOverride(s0, "squat", "T1", { weight: 225, stage: 2 }, "  deload  ", 777);
  const l = s1.lifts.squat.T1;
  assert.deepEqual([l.weight, l.stage, l.stageStartWeight], [225, 2, 245]);
  const ev = l.history.at(-1);
  assert.deepEqual(ev, {
    at: 777, type: "override", workoutId: null,
    from: { weight: 245, stage: 1, stageStartWeight: 245, repTarget: null },
    to: { weight: 225, stage: 2, stageStartWeight: 245, repTarget: null },
    reason: "deload", detail: null,
  });
  const slot = buildSlot(s1, base, "A1", 0);
  assert.equal(slot.weight, 225);
  assert.equal(slot.scheme, "6×2");
  assert.equal(slot.sets.length, 6);
  assert.equal(s0.lifts.squat.T1.weight, 245, "input untouched");
  assert.equal(applyOverride(s0, "squat", "T1", { weight: 200 }, "  ", 1).lifts.squat.T1.history.at(-1).reason, null);
  const rt = applyOverride(s0, "hanging_leg_raise", "T3", { repTarget: 14 }, null, 1);
  assert.equal(buildSlot(rt, base, "A1", 4).scheme, "3×14+");
  const ssw = applyOverride(s0, "bench", "T2", { stageStartWeight: 100 }, null, 1);
  assert.equal(ssw.lifts.bench.T2.stageStartWeight, 100);
  assert.equal(ssw.lifts.bench.T2.weight, 110);
});

test("applyOverride creates missing lift state; starting weight starts the stage-1 run", () => {
  const s = applyOverride(empty(), "barbell_curl", "T3", { weight: 65 }, "starting weight", 5);
  assert.deepEqual({ ...s.lifts.barbell_curl.T3, history: null }, { weight: 65, stage: 1, stageStartWeight: 65, repTarget: null, history: null });
  assert.equal(s.lifts.barbell_curl.T3.history.length, 1);
  // ensureLifts keeps it
  assert.equal(ensureLifts(s, base).lifts.barbell_curl.T3.weight, 65);
  // ignores unknown patch keys
  assert.equal(applyOverride(s, "barbell_curl", "T3", { bogus: 1 }, null, 6).lifts.barbell_curl.T3.bogus, undefined);
});

test("substitution: T2 Deadlift -> RDL gets its own state; deadlift T1/T2 untouched", () => {
  let s = ensureLifts(empty(), base);
  s = next(s, base, 100); // A1 -> rotation at B1
  const deadliftBefore = structuredClone(s.lifts.deadlift);
  s = setSubstitution(s, "B1", 1, "rdl");
  assert.deepEqual(s.program.substitutions, { "B1:1": "rdl" });
  assert.deepEqual(s.lifts.deadlift, deadliftBefore, "setSubstitution touches no lift state");
  const program = effectiveProgram(base, s.program);
  s = ensureLifts(s, program);
  assert.deepEqual(s.lifts.rdl.T2, { weight: null, stage: 1, stageStartWeight: null, repTarget: null, history: [] });
  s = applyOverride(s, "rdl", "T2", { weight: 135 }, "starting weight", 150);
  const slot = buildSlot(s, program, "B1", 1);
  assert.deepEqual([slot.exerciseId, slot.tier, slot.weight, slot.scheme], ["rdl", "T2", 135, "3×10"]);

  s = next(s, program, 200); // B1 with RDL as T2
  assert.equal(s.lifts.rdl.T2.weight, 145);
  assert.deepEqual(s.lifts.deadlift, deadliftBefore, "deadlift T1 and T2 untouched");
  assert.equal(s.workouts.at(-1).changes[1].exerciseId, "rdl");

  s = next(s, program, 300); // A2
  s = next(s, program, 400); // B2: deadlift is T1 (not substituted)
  assert.equal(s.lifts.deadlift.T1.weight, 280);
  assert.deepEqual(s.lifts.deadlift.T2, deadliftBefore.T2);
  assert.equal(s.lifts.rdl.T2.weight, 145);

  // remove substitution -> deadlift T2 back with its old state
  s = setSubstitution(s, "B1", 1, null);
  assert.deepEqual(s.program.substitutions, {});
  const restored = effectiveProgram(base, s.program);
  assert.equal(buildSlot(s, restored, "B1", 1).weight, 205);
});

test("addCustomExercise validates id and is usable through effectiveProgram", () => {
  assert.throws(() => addCustomExercise(empty(), { id: "goblet", name: "Goblet" }), /custom_/);
  const ex = { id: "custom_goblet", name: "Goblet squat", type: "machine", startingWeight: { T3: 50 }, increment: 5, smallIncrement: null, warmup: false, plates: false };
  let s = addCustomExercise(ensureLifts(empty(), base), ex);
  assert.deepEqual(s.program.customExercises.custom_goblet, ex);
  s = setSubstitution(s, "A1", 2, "custom_goblet");
  const program = effectiveProgram(base, s.program);
  s = ensureLifts(s, program);
  assert.equal(s.lifts.custom_goblet.T3.weight, 50);
  assert.equal(buildSlot(s, program, "A1", 2).weight, 50);
});

test("undo restores only the undone workout's lifts; later changes to other lifts survive", () => {
  let s = ensureLifts(empty(), base);
  const before = structuredClone(s);
  s = next(s, base, 100); // A1: squat T1, bench T2, lat_pulldown T3, leg raise T3 progress
  s = applyOverride(s, "barbell_curl", "T3", { weight: 65 }, "starting weight", 120); // B1 slot, set after finishing A1
  s = applyOverride(s, "deadlift", "T1", { weight: 300 }, "settings", 130);
  s = applyOverride(s, "rdl", "T2", { weight: 135 }, "starting weight", 140); // substitute weight
  const undone = undoLastWorkout(s);
  for (const [id, tier] of [["squat", "T1"], ["bench", "T2"], ["lat_pulldown", "T3"], ["hanging_leg_raise", "T3"]]) {
    assert.deepEqual(undone.lifts[id][tier], before.lifts[id][tier], `${id} ${tier} restored exactly`);
  }
  assert.equal(undone.lifts.barbell_curl.T3.weight, 65);
  assert.equal(undone.lifts.barbell_curl.T3.history.length, 1);
  assert.equal(undone.lifts.deadlift.T1.weight, 300);
  assert.equal(undone.lifts.rdl.T2.weight, 135);
  assert.deepEqual(undone.lifts.squat.T2, s.lifts.squat.T2);
  assert.equal(undone.rotationIndex, 0);
});

test("undo deletes lift states the workout created (absent from snapshot)", () => {
  let s = ensureLifts(empty(), base);
  s = setSubstitution(s, "A1", 3, "chin_up"); // no ensureLifts: the workout itself creates chin_up T3
  const program = effectiveProgram(base, s.program);
  assert.equal(s.lifts.chin_up, undefined);
  const after = next(s, program, 100);
  assert.equal(after.lifts.chin_up.T3.repTarget, 8);
  const undone = undoLastWorkout(after);
  assert.equal(undone.lifts.chin_up, undefined);
  assert.deepEqual(undone.lifts, s.lifts);
});
