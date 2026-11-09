import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateProgram, loadProgram, effectiveProgram, getDay, getExercise, listSlots } from "../src/logic/program.js";
import { applyWorkout } from "../src/logic/progression.js";
import { buildWorkout, logSet } from "../src/logic/workout.js";
import { ensureLifts } from "../src/logic/session.js";

const program = JSON.parse(readFileSync(new URL("../program.json", import.meta.url), "utf8"));
const clone = () => structuredClone(program);
const rejects = (mutate, pattern) => {
  const p = clone();
  mutate(p);
  const r = validateProgram(p);
  assert.equal(r.ok, false, "expected program to be rejected");
  if (pattern) assert.ok(r.errors.some((e) => pattern.test(e)), `no error matching ${pattern}: ${r.errors.join(" | ")}`);
};

test("shipped program.json is valid", () => {
  assert.deepEqual(validateProgram(program), { ok: true, errors: [] });
});

test("shipped program.json matches SPEC §2", () => {
  assert.deepEqual(program.rotation, ["A1", "B1", "A2", "B2"]);
  const table = Object.fromEntries(program.rotation.map((d) => [d, program.days[d].slots.map((s) => `${s.label}:${s.exerciseId}:${s.tier}`)]));
  assert.deepEqual(table, {
    A1: ["T1:squat:T1", "T2:bench:T2", "T3a:lat_pulldown:T3", "T3b:hanging_leg_raise:T3"],
    B1: ["T1:ohp:T1", "T2:deadlift:T2", "T3a:barbell_row:T3", "T3b:barbell_curl:T3"],
    A2: ["T1:bench:T1", "T2:squat:T2", "T3a:lat_pulldown:T3", "T3b:hanging_leg_raise:T3"],
    B2: ["T1:deadlift:T1", "T2:ohp:T2", "T3a:barbell_row:T3", "T3b:barbell_curl:T3"],
  });
  const ex = program.exercises;
  assert.deepEqual(ex.squat.startingWeight, { T1: 245, T2: 185 });
  assert.deepEqual(ex.deadlift.startingWeight, { T1: 270, T2: 205 });
  assert.deepEqual(ex.bench.startingWeight, { T1: 145, T2: 110 });
  assert.deepEqual(ex.ohp.startingWeight, { T1: 100, T2: 75 });
  assert.equal(ex.barbell_row.startingWeight.T3, 95);
  assert.equal(ex.lat_pulldown.startingWeight.T3, 100);
  assert.equal(ex.barbell_curl.startingWeight.T3, null);
  assert.deepEqual([ex.squat.increment, ex.deadlift.increment, ex.bench.increment, ex.ohp.increment], [10, 10, 5, 5]);
  assert.deepEqual([ex.bench.smallIncrement, ex.ohp.smallIncrement], [2.5, 2.5]);
  assert.equal(ex.hanging_leg_raise.type, "bodyweight");
  assert.equal(ex.hanging_leg_raise.startingRepTarget, 10);
  assert.equal(ex.lat_pulldown.plates, false);
  assert.equal(ex.hanging_leg_raise.plates, false);
  for (const id of ["rdl", "front_squat", "incline_bench", "dumbbell_row", "chin_up"]) assert.equal(ex[id].library, true, id);
  assert.equal(ex.dumbbell_row.type, "machine");
  assert.equal(ex.dumbbell_row.plates, false);
  assert.equal(ex.chin_up.type, "bodyweight");
  assert.deepEqual(program.defaults.plates, [45, 35, 25, 15, 10, 5, 2.5]); // spec set + the gym's 15s
  assert.deepEqual(program.defaults.rest, { T1: 180, T2: 120, T3: 75, warmup: 60 });
});

test("validateProgram rejects broken programs", () => {
  assert.equal(validateProgram(null).ok, false);
  assert.equal(validateProgram([]).ok, false);
  assert.equal(validateProgram("x").ok, false);
  rejects((p) => { p.days.A1.slots[0].exerciseId = "nope"; }, /not a defined exercise/);
  rejects((p) => { p.days.A1.slots[0].tier = "T9"; }, /not a defined tier/);
  rejects((p) => { p.rotation.push("C1"); }, /rotation day "C1"/);
  rejects((p) => { p.rotation = []; }, /rotation/);
  rejects((p) => { delete p.version; }, /version/);
  rejects((p) => { p.exercises.squat.type = "kettlebell"; }, /type/);
  rejects((p) => { p.exercises.squat.id = "sq"; }, /id must equal/);
  rejects((p) => { delete p.exercises.squat.name; }, /name/);
  rejects((p) => { p.exercises.squat.increment = "10"; }, /increment/);
  rejects((p) => { p.exercises.squat.warmup = "yes"; }, /warmup/);
  rejects((p) => { delete p.exercises.squat.plates; }, /plates/);
  rejects((p) => { p.exercises.squat.startingWeight.T7 = 100; }, /not a known tier/);
  rejects((p) => { p.exercises.squat.startingWeight.T1 = -5; }, /startingWeight/);
  rejects((p) => { delete p.exercises.hanging_leg_raise.startingRepTarget; }, /startingRepTarget/);
  rejects((p) => { p.tiers.T1.stages = []; }, /stages/);
  rejects((p) => { p.tiers.T1.stages[0].reps = 0; }, /stages\[0\]/);
  rejects((p) => { p.tiers.T1.reset.type = "magic"; }, /reset\.type/);
  rejects((p) => { p.tiers.T1.reset.percentOf5RM = 1.5; }, /percentOf5RM/);
  rejects((p) => { p.tiers.T2.reset.addMax = 1; }, /addMin/);
  rejects((p) => { p.tiers.T3.weighted.amrapThreshold = 0; }, /amrapThreshold/);
  rejects((p) => { delete p.tiers.T3.bodyweight; }, /bodyweight/);
  rejects((p) => { p.defaults.plates = []; }, /plates/);
  rejects((p) => { p.defaults.barWeight = 0; }, /barWeight/);
  rejects((p) => { p.defaults.warmup[1].pct = 2; }, /warmup/);
  rejects((p) => { delete p.days; }, /days/);
  rejects((p) => { delete p.exercises; }, /exercises/);
  rejects((p) => { delete p.tiers; }, /tiers/);
});

test("loadProgram fetches, validates and throws on invalid", async () => {
  const ok = await loadProgram("./program.json", async (url) => ({ ok: true, status: 200, json: async () => clone(), url }));
  assert.deepEqual(ok, program);
  await assert.rejects(loadProgram("x", async () => ({ ok: false, status: 404, json: async () => ({}) })), /404/);
  await assert.rejects(loadProgram("x", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } })), /not valid JSON/);
  const broken = clone();
  broken.days.A1.slots[0].exerciseId = "nope";
  await assert.rejects(loadProgram("x", async () => ({ ok: true, status: 200, json: async () => broken })), /Invalid program\.json/);
});

test("effectiveProgram merges custom exercises & applies substitutions without mutating base", () => {
  const before = clone();
  const custom = { id: "custom_x", name: "X", type: "machine", startingWeight: { T3: 40 }, increment: 5, smallIncrement: null, warmup: false, plates: false };
  const eff = effectiveProgram(program, { substitutions: { "B1:1": "rdl", "A1:2": "custom_x", "A1:3": "ghost" }, customExercises: { custom_x: custom } });
  assert.deepEqual(program, before);
  assert.equal(getDay(eff, "B1").slots[1].exerciseId, "rdl");
  assert.equal(getDay(eff, "B1").slots[1].originalExerciseId, "deadlift");
  assert.equal(getDay(eff, "B2").slots[0].exerciseId, "deadlift");
  assert.equal(getDay(eff, "A1").slots[2].exerciseId, "custom_x");
  assert.equal(getDay(eff, "A1").slots[3].exerciseId, "hanging_leg_raise", "unknown substitute ignored");
  assert.equal(getExercise(eff, "custom_x").name, "X");
  assert.equal(validateProgram(eff).ok, true);
  assert.deepEqual(effectiveProgram(program, undefined).days.A1.slots[0].exerciseId, "squat");
  assert.throws(() => getDay(eff, "Z9"), /Unknown day/);
  assert.throws(() => getExercise(eff, "nope"), /Unknown exercise/);
});

test("listSlots", () => {
  const eff = effectiveProgram(program, { substitutions: { "B1:1": "rdl" }, customExercises: {} });
  const slots = listSlots(eff);
  assert.equal(slots.length, 16);
  assert.deepEqual(slots[0], { dayId: "A1", slotIndex: 0, exerciseId: "squat", tier: "T1", label: "T1", originalExerciseId: "squat" });
  assert.deepEqual(slots.find((s) => s.dayId === "B1" && s.slotIndex === 1), { dayId: "B1", slotIndex: 1, exerciseId: "rdl", tier: "T2", label: "T2", originalExerciseId: "deadlift" });
  assert.equal(listSlots(program)[5].originalExerciseId, "deadlift");
});

// ---------- program-driven behaviour (no hard-coding) ----------

function runA1(p, settings = {}, reps) {
  const state = ensureLifts({ program: { substitutions: {}, customExercises: {} }, lifts: {}, rotationIndex: 0, workouts: [], inProgress: null, timer: null, pendingDecisions: [], settings: { ...settings } }, p);
  let w = buildWorkout(state, p, "A1", 1);
  for (const slot of w.slots) slot.sets.forEach((s, i) => { w = logSet(w, slot.slotIndex, i, reps?.[slot.label]?.[i] ?? s.target); });
  return applyWorkout(state, w, p, 2).state;
}

test("changing the squat increment in program.json changes progression", () => {
  assert.equal(runA1(program).lifts.squat.T1.weight, 255);
  const p = clone();
  p.exercises.squat.increment = 5;
  assert.equal(runA1(p).lifts.squat.T1.weight, 250);
});

test("starting weights, thresholds, rep rules and stages come from program.json", () => {
  const p = clone();
  p.exercises.squat.startingWeight.T1 = 300;
  p.exercises.lat_pulldown.increment = 10;
  p.tiers.T3.weighted.amrapThreshold = 20;
  p.tiers.T3.bodyweight.repTargetIncrement = 3;
  p.tiers.T3.bodyweight.amrapBonus = 2;
  p.tiers.T1.stages[0] = { sets: 4, reps: 4, amrap: true };
  const s = runA1(p, {}, { T3a: [15, 15, 20], T3b: [10, 10, 12] });
  assert.equal(s.lifts.squat.T1.weight, 310);
  assert.equal(s.lifts.lat_pulldown.T3.weight, 110);
  assert.equal(s.lifts.hanging_leg_raise.T3.repTarget, 13);
  const w = buildWorkout(s, p, "A1", 3);
  assert.equal(w.slots[0].scheme, "4×4");
  // plates/bar from defaults
  const p2 = clone();
  p2.defaults.barWeight = 35;
  p2.defaults.plates = [45, 25, 10, 5];
  const w2 = buildWorkout(runA1(p2), p2, "A1", 1);
  assert.equal(w2.slots[0].warmups[0].weight, 35);
  assert.equal(w2.slots[1].weight, 105); // 10-lb steps from a 35 bar: 110 is a tie between 105 and 115 -> down
});

test("bodyweight rule applies regardless of tier", () => {
  const p = clone();
  p.days.A1.slots[1] = { exerciseId: "chin_up", tier: "T2", label: "T2" };
  assert.equal(validateProgram(p).ok, true);
  const s = runA1(p, {}, { T2: [8, 8, 13] });
  assert.equal(s.lifts.chin_up.T2.repTarget, 10);
  assert.equal(buildWorkout(s, p, "A1", 5).slots[1].scheme, "3×10+");
});
