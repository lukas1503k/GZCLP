import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, migrations } from "../src/state/migrations.js";
import { SCHEMA_VERSION, validateState } from "../src/state/schema.js";

function v0State() {
  // Pre-release shape: no schemaVersion, no pendingDecisions, no timer.
  return {
    program: { substitutions: { "A1:1": "incline_bench" }, customExercises: {} },
    lifts: { squat: { T1: { weight: 255, stage: 1, stageStartWeight: 245, repTarget: null, history: [] } } },
    rotationIndex: 1,
    workouts: [{
      id: "w1000", dayId: "A1", startedAt: 1000, finishedAt: 5000,
      slots: [{ slotIndex: 0, label: "T1", exerciseId: "squat", tier: "T1", stage: 1, weight: 245, repTarget: null,
        scheme: "5×3", sets: [{ target: 3, reps: 3, amrap: false, done: true }], warmups: [] }],
      changes: [], snapshotBefore: { lifts: {}, rotationIndex: 0 },
    }],
    inProgress: null,
    settings: { smallIncrements: false, smallPlates: true, barWeight: 35,
      rest: { T1: 150, T2: 120, T3: 75, warmup: 60 }, warmupStartsTimer: false, sound: true, vibration: false },
  };
}

test("SCHEMA_VERSION is 2 and migrations[0..1] exist, migrations[2] does not", () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(typeof migrations[0], "function");
  assert.equal(typeof migrations[1], "function");
  assert.equal(migrations[2], undefined);
});

test("v0 state migrates to a valid current state, keeping user data", () => {
  const raw = v0State();
  const s = migrate(raw);
  assert.equal(s.schemaVersion, 2);
  assert.deepEqual(s.pendingDecisions, []);
  assert.equal(s.timer, null);
  assert.equal(s.rotationIndex, 1);
  assert.equal(s.lifts.squat.T1.weight, 255);
  assert.equal(s.settings.barWeight, 35);
  assert.equal(s.settings.rest.T1, 150);
  assert.deepEqual(s.program.substitutions, { "A1:1": "incline_bench" });
  assert.deepEqual(validateState(s).errors, []);
});

// ---------- v1 -> v2: RDL slot inserted at A1/A2 index 2 ----------

function v1State(extra = {}) {
  return { ...migrations[0](v0State()), schemaVersion: 1, ...extra };
}
const a1Slot = (slotIndex, exerciseId, done = false) => ({
  slotIndex, label: "x", exerciseId, tier: slotIndex < 2 ? (slotIndex ? "T2" : "T1") : "T3", stage: 1, weight: 100, repTarget: null,
  scheme: "3×15", sets: [{ target: 15, reps: done ? 15 : null, amrap: false, done }], warmups: [],
});
const oldA1 = (done) => ({
  id: "w9", dayId: "A1", startedAt: 9, finishedAt: null, changes: null, snapshotBefore: null,
  slots: [a1Slot(0, "squat", done), a1Slot(1, "bench"), a1Slot(2, "lat_pulldown", done), a1Slot(3, "hanging_leg_raise")],
});

test("v1 -> v2 shifts A1/A2 substitutions at or after index 2; other days untouched", () => {
  const s = migrate(v1State({ program: { customExercises: {}, substitutions: {
    "A1:0": "front_squat", "A1:2": "dumbbell_row", "A2:3": "chin_up", "B1:2": "dumbbell_row", "B2:1": "incline_bench",
  } } }));
  assert.equal(s.schemaVersion, 2);
  assert.deepEqual(s.program.substitutions, {
    "A1:0": "front_squat", "A1:3": "dumbbell_row", "A2:4": "chin_up", "B1:2": "dumbbell_row", "B2:1": "incline_bench",
  });
  assert.deepEqual(validateState(s).errors, []);
});

test("v1 -> v2 drops an untouched old-layout A-day workout so it is rebuilt with the RDL slot", () => {
  const s = migrate(v1State({ inProgress: oldA1(false), timer: null }));
  assert.equal(s.inProgress, null);
});

test("v1 -> v2 keeps a started old-layout A-day workout, re-indexing its T3 slots and the timer", () => {
  const timer = { endsAt: 10, durationSec: 75, exerciseId: "lat_pulldown", slotIndex: 2, setIndex: 0, kind: "working", nextLabel: null };
  const s = migrate(v1State({ inProgress: oldA1(true), timer }));
  assert.deepEqual(s.inProgress.slots.map((x) => [x.slotIndex, x.exerciseId]), [[0, "squat"], [1, "bench"], [3, "lat_pulldown"], [4, "hanging_leg_raise"]]);
  assert.equal(s.timer.slotIndex, 3);
  assert.deepEqual(validateState(s).errors, []);
});

test("v1 -> v2 leaves B-day workouts alone", () => {
  const w = { ...oldA1(false), dayId: "B1" };
  const s = migrate(v1State({ inProgress: w }));
  assert.deepEqual(s.inProgress, w);
});

test("v0 migration fills other missing top-level defaults", () => {
  const s = migrate({ lifts: {}, settings: { sound: false, rest: { T1: 200 } } });
  assert.deepEqual(s.program, { substitutions: {}, customExercises: {} });
  assert.deepEqual(s.workouts, []);
  assert.equal(s.inProgress, null);
  assert.equal(s.rotationIndex, 0);
  assert.equal(s.settings.sound, false);
  assert.deepEqual(s.settings.rest, { T1: 200, T2: 120, T3: 75, warmup: 60 });
  assert.deepEqual(validateState(s).errors, []);
});

test("migrate does not mutate its input", () => {
  const raw = v0State();
  const before = structuredClone(raw);
  const s = migrate(raw);
  assert.deepEqual(raw, before);
  s.lifts.squat.T1.weight = 999;
  s.workouts[0].slots[0].sets[0].reps = 0;
  assert.deepEqual(raw, before);
});

test("current-version state passes through unchanged (but cloned)", () => {
  const s1 = migrate(v0State());
  const s2 = migrate(s1);
  assert.deepEqual(s2, s1);
  assert.notEqual(s2, s1);
});

test("newer schema version throws a clear error", () => {
  assert.throws(() => migrate({ ...v0State(), schemaVersion: 3 }),
    { message: "newer schema version 3; this app supports 2" });
});

test("invalid input throws", () => {
  assert.throws(() => migrate(null), /state must be an object/);
  assert.throws(() => migrate([]), /state must be an object/);
  assert.throws(() => migrate({ schemaVersion: "1" }), /invalid schema version/);
});

test("migrate fills missing slot.warmups with [] in workouts and inProgress (any version), without mutating input", () => {
  const raw = migrate(v0State());
  delete raw.workouts[0].slots[0].warmups;
  raw.inProgress = structuredClone(raw.workouts[0]);
  raw.inProgress.finishedAt = null;
  const before = structuredClone(raw);
  const s = migrate(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(s.workouts[0].slots[0].warmups, []);
  assert.deepEqual(s.inProgress.slots[0].warmups, []);
  assert.deepEqual(validateState(s).errors, []);
});

test("validateState requires slot.warmups to be an array and accepts optional requestedWeight", () => {
  const s = migrate(v0State());
  s.workouts[0].slots[0].requestedWeight = 247.5;
  assert.deepEqual(validateState(s).errors, []);
  s.workouts[0].slots[0].requestedWeight = null;
  assert.deepEqual(validateState(s).errors, []);
  s.workouts[0].slots[0].requestedWeight = "heavy";
  delete s.workouts[0].slots[0].warmups;
  const { errors } = validateState(s);
  assert.ok(errors.includes("workouts[0].slots[0].requestedWeight must be a number or null"), errors.join("\n"));
  assert.ok(errors.includes("workouts[0].slots[0].warmups must be an array"), errors.join("\n"));
});
