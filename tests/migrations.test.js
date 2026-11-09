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

test("SCHEMA_VERSION is 1 and migrations[0] exists, migrations[1] does not", () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(typeof migrations[0], "function");
  assert.equal(migrations[1], undefined);
});

test("v0 state migrates to a valid v1 state, keeping user data", () => {
  const raw = v0State();
  const s = migrate(raw);
  assert.equal(s.schemaVersion, 1);
  assert.deepEqual(s.pendingDecisions, []);
  assert.equal(s.timer, null);
  assert.equal(s.rotationIndex, 1);
  assert.equal(s.lifts.squat.T1.weight, 255);
  assert.equal(s.settings.barWeight, 35);
  assert.equal(s.settings.rest.T1, 150);
  assert.deepEqual(s.program.substitutions, { "A1:1": "incline_bench" });
  assert.deepEqual(validateState(s).errors, []);
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
  assert.throws(() => migrate({ ...v0State(), schemaVersion: 2 }),
    { message: "newer schema version 2; this app supports 1" });
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
