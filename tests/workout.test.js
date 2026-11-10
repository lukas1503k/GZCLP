import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSlot, buildWorkout, logSet, clearSet, toggleWarmup, allSetsDone, nextSet, describeSet,
} from "../src/logic/workout.js";
import { ensureLifts, applyOverride } from "../src/logic/session.js";

const program = JSON.parse(readFileSync(new URL("../program.json", import.meta.url), "utf8"));
const SETTINGS = { smallIncrements: false, smallPlates: false, barWeight: 45 };
const fresh = (settings = {}) => ensureLifts({ program: { substitutions: {}, customExercises: {} }, lifts: {}, rotationIndex: 0, workouts: [], inProgress: null, timer: null, pendingDecisions: [], settings: { ...SETTINGS, ...settings } }, program);

test("buildWorkout A1 uses starting weights from program.json", () => {
  const w = buildWorkout(fresh(), program, "A1", 1234);
  assert.equal(w.id, "w1234");
  assert.equal(w.dayId, "A1");
  assert.equal(w.startedAt, 1234);
  assert.equal(w.finishedAt, null);
  assert.equal(w.changes, null);
  assert.equal(w.snapshotBefore, null);
  assert.deepEqual(w.slots.map((s) => [s.label, s.exerciseId, s.tier, s.weight, s.scheme]), [
    ["T1", "squat", "T1", 245, "5×3"],
    ["T2", "bench", "T2", 110, "3×10"],
    ["T3a", "lat_pulldown", "T3", 100, "3×15"],
    ["T3b", "hanging_leg_raise", "T3", null, "3×10+"],
  ]);
  assert.equal(w.slots[3].repTarget, 10);
  assert.equal(w.slots[0].repTarget, null);
  assert.deepEqual(w.slots[0].sets[4], { target: 3, reps: null, amrap: true, done: false });
});

test("warm-ups for every tier with warmup:true and a weight", () => {
  const w = buildWorkout(fresh(), program, "A1", 1);
  const brief = (slot) => slot.warmups.map((x) => `${x.weight}x${x.reps}`).join(",");
  assert.deepEqual(w.slots[0].warmups.map((x) => [x.weight, x.reps, x.done]), [[45, 10, false], [100, 5, false], [145, 3, false], [185, 2, false], [210, 1, false]]);
  assert.equal(brief(w.slots[1]), "45x10,65x3,80x2,95x1"); // bench as T2
  assert.equal(brief(w.slots[2]), "40x5,60x3,75x2,85x1"); // lat pulldown (machine): no bar set
  assert.deepEqual(w.slots[3].warmups, []); // bodyweight
  const b2 = buildWorkout(fresh(), program, "B2", 1);
  assert.equal(b2.slots[0].exerciseId, "deadlift");
  assert.equal(b2.slots[0].warmups.length, 5);
});

test("buildSlot: null weight for unset lifts, raw weight for non-plate exercises", () => {
  const s = fresh();
  assert.equal(buildSlot(s, program, "B1", 3).weight, null); // barbell curl
  const odd = applyOverride(s, "lat_pulldown", "T3", { weight: 102.5 }, null, 1);
  assert.equal(buildSlot(odd, program, "A1", 2).weight, 102.5); // machine: not rounded
  const oddBar = applyOverride(s, "bench", "T2", { weight: 112.5 }, null, 1);
  assert.equal(buildSlot(oddBar, program, "A1", 1).weight, 110); // barbell: rounded (tie down)
  // missing lift state falls back to initial state
  assert.equal(buildSlot({ ...s, lifts: {} }, program, "A1", 0).weight, 245);
  assert.throws(() => buildSlot(s, program, "A1", 9));
});

test("logSet / clearSet / toggleWarmup are pure", () => {
  const w0 = buildWorkout(fresh(), program, "A1", 1);
  const snapshot = structuredClone(w0);
  const w1 = logSet(w0, 0, 4, 7);
  assert.deepEqual(w0, snapshot);
  assert.deepEqual(w1.slots[0].sets[4], { target: 3, reps: 7, amrap: true, done: true });
  const w2 = clearSet(w1, 0, 4);
  assert.deepEqual(w2.slots[0].sets[4], { target: 3, reps: null, amrap: true, done: false });
  const w3 = toggleWarmup(w0, 0, 1);
  assert.equal(w3.slots[0].warmups[1].done, true);
  assert.equal(toggleWarmup(w3, 0, 1).slots[0].warmups[1].done, false);
  assert.deepEqual(w0, snapshot);
  assert.equal(logSet(w0, 0, 0, 0).slots[0].sets[0].reps, 0);
  assert.throws(() => logSet(w0, 0, 0, -1));
  assert.throws(() => logSet(w0, 0, 0, 2.5));
  assert.throws(() => logSet(w0, 0, 99, 3));
  assert.throws(() => toggleWarmup(w0, 3, 0));
});

test("allSetsDone / nextSet / describeSet", () => {
  let w = buildWorkout(fresh(), program, "A1", 1);
  assert.deepEqual(nextSet(w), { slotIndex: 0, setIndex: 0 });
  assert.equal(describeSet(w, program, nextSet(w)), "Squat · set 1 of 5");
  w = logSet(w, 0, 0, 3);
  w = logSet(w, 0, 2, 3);
  assert.deepEqual(nextSet(w), { slotIndex: 0, setIndex: 1 });
  assert.equal(describeSet(w, program, nextSet(w)), "Squat · set 2 of 5");
  // warm-ups don't count
  w = toggleWarmup(w, 0, 0);
  for (const slot of w.slots) slot.sets.forEach((_, i) => { w = logSet(w, slot.slotIndex, i, 1); });
  assert.equal(allSetsDone(w), true);
  assert.equal(nextSet(w), null);
  assert.equal(describeSet(w, program, null), null);
  w = clearSet(w, 3, 2);
  assert.equal(allSetsDone(w), false);
  assert.equal(describeSet(w, program, nextSet(w)), "Hanging leg raise · set 3 of 3");
});

test("requestedWeight carries the raw lift weight; differs from weight when not loadable", () => {
  const s = applyOverride(fresh(), "bench", "T2", { weight: 117.5 }, null, 1);
  const slot = buildSlot(s, program, "A1", 1);
  assert.equal(slot.weight, 115); // 117.5 tie -> down
  assert.equal(slot.requestedWeight, 117.5);
  const on = buildSlot({ ...s, settings: { ...s.settings, smallPlates: true } }, program, "A1", 1);
  assert.equal(on.weight, 117.5);
  assert.equal(on.requestedWeight, 117.5);
  const plain = buildSlot(fresh(), program, "A1", 0);
  assert.equal(plain.requestedWeight, plain.weight);
  assert.equal(buildSlot(fresh(), program, "B1", 3).requestedWeight, null);
  assert.equal(buildSlot(fresh(), program, "A1", 3).requestedWeight, null);
});
