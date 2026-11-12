import { test } from "node:test";
import assert from "node:assert/strict";
import { backupFilename, serializeBackup, parseBackup } from "../src/state/exportImport.js";
import { SCHEMA_VERSION, defaultState, validateState } from "../src/state/schema.js";

const DAY = 86_400_000;
const T0 = new Date(2026, 9, 1, 18, 0).getTime();

function lift(weight, { stage = 1, ssw = weight, repTarget = null, history = [] } = {}) {
  return { weight, stage, stageStartWeight: ssw, repTarget, history };
}
function set(target, reps, amrap = false) {
  return { target, reps, amrap, done: reps !== null };
}

function fixtureState() {
  const w1 = {
    id: `w${T0}`, dayId: "A1", startedAt: T0, finishedAt: T0 + 3_600_000,
    slots: [
      { slotIndex: 0, label: "T1", exerciseId: "squat", tier: "T1", stage: 1, weight: 245, repTarget: null, scheme: "5×3",
        sets: [set(3, 3), set(3, 3), set(3, 3), set(3, 3), set(3, 6, true)],
        warmups: [{ weight: 45, reps: 10, pct: 0, done: true }, { weight: 100, reps: 5, pct: 0.4, done: true }] },
      { slotIndex: 1, label: "T2", exerciseId: "bench", tier: "T2", stage: 1, weight: 110, repTarget: null, scheme: "3×10",
        sets: [set(10, 10), set(10, 10), set(10, 10)], warmups: [] },
      { slotIndex: 2, label: "T3a", exerciseId: "lat_pulldown", tier: "T3", stage: 1, weight: 100, repTarget: null, scheme: "3×15",
        sets: [set(15, 15), set(15, 15), set(15, 20, true)], warmups: [] },
      { slotIndex: 3, label: "T3b", exerciseId: "hanging_leg_raise", tier: "T3", stage: 1, weight: null, repTarget: 10, scheme: "3×10+",
        sets: [set(10, 10), set(10, 10), set(10, 12, true)], warmups: [] },
    ],
    changes: [
      { slotIndex: 0, exerciseId: "squat", tier: "T1", name: "Squat", success: true, kind: "increase",
        from: { weight: 245, stage: 1, repTarget: null }, to: { weight: 255, stage: 1, repTarget: null }, message: "Next: 255 lb, stage 1" },
    ],
    snapshotBefore: null,
  };
  const w2 = {
    id: `w${T0 + 2 * DAY}`, dayId: "B1", startedAt: T0 + 2 * DAY, finishedAt: T0 + 2 * DAY + 3_000_000,
    slots: [
      { slotIndex: 0, label: "T1", exerciseId: "ohp", tier: "T1", stage: 3, weight: 100, repTarget: null, scheme: "10×1",
        sets: Array.from({ length: 10 }, (_, i) => set(1, i < 8 ? 1 : 0, i === 9)), warmups: [] },
      { slotIndex: 1, label: "T2", exerciseId: "rdl", originalExerciseId: "deadlift", tier: "T2", stage: 1, weight: 185,
        repTarget: null, scheme: "3×10", sets: [set(10, 10), set(10, 9), set(10, null)], warmups: [] },
    ],
    changes: [
      { slotIndex: 0, exerciseId: "ohp", tier: "T1", name: "Overhead press", success: false, kind: "pending",
        from: { weight: 100, stage: 3, repTarget: null }, to: null, message: "Reset decision needed" },
    ],
    snapshotBefore: {
      rotationIndex: 1,
      lifts: { squat: { T1: lift(255) }, ohp: { T1: lift(100, { stage: 3, ssw: 100 }) } },
    },
  };
  const inProgress = {
    id: `w${T0 + 4 * DAY}`, dayId: "A2", startedAt: T0 + 4 * DAY, finishedAt: null,
    slots: [
      { slotIndex: 0, label: "T1", exerciseId: "bench", tier: "T1", stage: 1, weight: 145, repTarget: null, scheme: "5×3",
        sets: [set(3, 3), set(3, null), set(3, null), set(3, null), { target: 3, reps: null, amrap: true, done: false }],
        warmups: [{ weight: 45, reps: 10, pct: 0, done: true }] },
    ],
    changes: null, snapshotBefore: null,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    program: {
      substitutions: { "B1:1": "rdl" },
      customExercises: {
        custom_cable_fly: { id: "custom_cable_fly", name: "Cable fly", type: "machine",
          startingWeight: { T3: 30 }, increment: 5, smallIncrement: null, warmup: false, plates: false },
      },
    },
    lifts: {
      squat: {
        T1: lift(255, { ssw: 245, history: [
          { at: T0, type: "init", workoutId: null, from: { weight: null, stage: 1, stageStartWeight: null, repTarget: null },
            to: { weight: 245, stage: 1, stageStartWeight: 245, repTarget: null }, reason: null, detail: null },
          { at: T0 + 3_600_000, type: "progress", workoutId: `w${T0}`,
            from: { weight: 245, stage: 1, stageStartWeight: 245, repTarget: null },
            to: { weight: 255, stage: 1, stageStartWeight: 245, repTarget: null }, reason: null, detail: null },
        ] }),
        T2: lift(185),
      },
      bench: { T1: lift(145), T2: lift(115, { ssw: 110 }) },
      ohp: { T1: lift(100, { stage: 3 }) },
      hanging_leg_raise: { T3: lift(null, { ssw: null, repTarget: 12 }) },
      rdl: { T2: lift(185) },
    },
    rotationIndex: 2,
    workouts: [w1, w2],
    inProgress,
    timer: { endsAt: T0 + 4 * DAY + 180_000, durationSec: 180, exerciseId: "bench", slotIndex: 0, setIndex: 1,
      kind: "working", nextLabel: "Bench · set 2 of 5" },
    pendingDecisions: [{
      id: `w${T0 + 2 * DAY}:ohp:T1`, type: "t1-reset", workoutId: `w${T0 + 2 * DAY}`,
      exerciseId: "ohp", tier: "T1", name: "Overhead press",
      suggestion: { estimated5RM: 96.4, e1RM: 112.5, weight: 80,
        sourceSets: [{ workoutId: `w${T0 + 2 * DAY}`, date: T0 + 2 * DAY, weight: 100, reps: 1, e1RM: 103.3, best: true }] },
      context: { currentWeight: 100, stageStartWeight: 100 },
    }],
    settings: { smallIncrements: true, smallPlates: true, barWeight: 45,
      rest: { T1: 200, T2: 120, T3: 75, warmup: 60 }, warmupStartsTimer: true, sound: false, vibration: true },
  };
}

test("fixture is a valid State", () => {
  const r = validateState(fixtureState());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test("backupFilename uses zero-padded local date", () => {
  assert.equal(backupFilename(new Date(2026, 0, 5, 23, 59).getTime()), "gzclp-backup-2026-01-05.json");
  assert.equal(backupFilename(new Date(2026, 10, 9, 0, 1).getTime()), "gzclp-backup-2026-11-09.json");
});

test("serializeBackup wraps state with app, exportedAt and schemaVersion", () => {
  const s = fixtureState();
  const now = new Date(2026, 2, 7, 12).getTime();
  const { filename, text } = serializeBackup(s, now);
  assert.equal(filename, "gzclp-backup-2026-03-07.json");
  const obj = JSON.parse(text);
  assert.equal(obj.app, "gzclp");
  assert.equal(obj.exportedAt, now);
  assert.equal(obj.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(obj.state, s);
});

test("export/import round-trip deep-equals the original state", () => {
  const s = fixtureState();
  const r = parseBackup(serializeBackup(s, T0).text);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.state, s);
});

test("summary lists workouts count and lift weights", () => {
  const r = parseBackup(serializeBackup(fixtureState(), T0).text);
  assert.equal(r.summary.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.summary.workouts, 2);
  assert.deepEqual(r.summary.lifts.find((l) => l.exerciseId === "squat" && l.tier === "T1"),
    { exerciseId: "squat", tier: "T1", weight: 255, stage: 1, repTarget: null });
  assert.deepEqual(r.summary.lifts.find((l) => l.exerciseId === "hanging_leg_raise"),
    { exerciseId: "hanging_leg_raise", tier: "T3", weight: null, stage: 1, repTarget: 12 });
  assert.equal(r.summary.lifts.length, 7);
});

test("accepts a bare State object leniently", () => {
  const s = fixtureState();
  const r = parseBackup(JSON.stringify(s));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.state, s);
});

test("migrates an older (v0) backup", () => {
  const s = fixtureState();
  delete s.schemaVersion; delete s.pendingDecisions; delete s.timer;
  const r = parseBackup(JSON.stringify({ app: "gzclp", exportedAt: T0, state: s }));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(r.state.pendingDecisions, []);
  assert.equal(r.state.timer, null);
});

test("rejects malformed JSON", () => {
  assert.deepEqual(parseBackup("{not json"), { ok: false, error: "This file isn't valid JSON." });
  assert.deepEqual(parseBackup(""), { ok: false, error: "This file isn't valid JSON." });
});

test("rejects JSON that isn't a GZCLP backup", () => {
  for (const text of ["[]", "42", "null", '"hi"', '{"foo":1}', '{"app":"other","state":{}}']) {
    assert.deepEqual(parseBackup(text), { ok: false, error: "This file isn't a GZCLP backup." }, text);
  }
});

test("rejects newer schema version with a clear message", () => {
  const s = { ...fixtureState(), schemaVersion: 3 };
  const msg = `This backup was made by a newer version of the app (schema 3); this app supports schema ${SCHEMA_VERSION}.`;
  assert.deepEqual(parseBackup(JSON.stringify({ app: "gzclp", exportedAt: T0, schemaVersion: 3, state: s })),
    { ok: false, error: msg });
  assert.deepEqual(parseBackup(JSON.stringify(s)), { ok: false, error: msg });
});

test("rejects wrong-shape state with path-specific errors", () => {
  const s = fixtureState();
  s.workouts[1].slots[0].sets[1].reps = "eight";
  s.settings.sound = "yes";
  const r = parseBackup(JSON.stringify({ app: "gzclp", schemaVersion: 1, state: s }));
  assert.equal(r.ok, false);
  assert.match(r.error, /^This backup is damaged or incomplete: /);
  assert.match(r.error, /workouts\[1\]\.slots\[0\]\.sets\[1\]\.reps must be a number or null/);
  assert.match(r.error, /settings\.sound must be a boolean/);
});

test("validateState accepts defaultState and rejects common mistakes", () => {
  assert.deepEqual(validateState(defaultState({ barWeight: 45, rest: { T1: 180, T2: 120, T3: 75, warmup: 60 } })).errors, []);
  assert.equal(validateState(null).ok, false);
  const s = fixtureState();
  s.lifts.squat.T1.stage = 0;
  s.inProgress = undefined;
  s.timer.kind = "nap";
  s.pendingDecisions[0].suggestion = null;
  const { ok, errors } = validateState(s);
  assert.equal(ok, false);
  assert.ok(errors.includes("lifts.squat.T1.stage must be an integer >= 1"), errors.join("\n"));
  assert.ok(errors.includes("inProgress must be an object or null"));
  assert.ok(errors.some((e) => e.startsWith("timer.kind must be one of")));
  assert.ok(errors.includes("pendingDecisions[0].suggestion must be an object"));
});

test("import of a hand-edited backup missing slot.warmups normalises to []", () => {
  const s = fixtureState();
  delete s.inProgress.slots[0].warmups;
  delete s.workouts[0].slots[1].warmups;
  const r = parseBackup(JSON.stringify({ app: "gzclp", schemaVersion: 1, state: s }));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.state.inProgress.slots[0].warmups, []);
  assert.deepEqual(r.state.workouts[0].slots[1].warmups, []);
});
