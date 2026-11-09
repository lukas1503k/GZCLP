import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  incrementFor, prescription, initialLiftState, applyWorkout, resolveDecision,
  t1ResetWeight, previewOutcomes, slotSuccess,
} from "../src/logic/progression.js";
import { plateConfig } from "../src/logic/plates.js";
import { buildWorkout, buildSlot, logSet } from "../src/logic/workout.js";
import { ensureLifts, finishWorkout, applyOverride } from "../src/logic/session.js";

const program = JSON.parse(readFileSync(new URL("../program.json", import.meta.url), "utf8"));
const SETTINGS = { smallIncrements: false, smallPlates: false, barWeight: 45, rest: { T1: 180, T2: 120, T3: 75, warmup: 60 }, warmupStartsTimer: false, sound: true, vibration: true };

function fresh(settings = {}) {
  return ensureLifts({
    schemaVersion: 1, program: { substitutions: {}, customExercises: {} }, lifts: {}, rotationIndex: 0,
    workouts: [], inProgress: null, timer: null, pendingDecisions: [], settings: { ...SETTINGS, ...settings },
  }, program);
}

/** plan: { [label]: number[] | null[] } ; unlisted slots hit every target. */
function fill(workout, plan = {}) {
  let w = workout;
  for (const slot of w.slots) {
    const reps = plan[slot.label];
    slot.sets.forEach((s, i) => {
      const r = reps ? reps[i] : s.target;
      if (r != null) w = logSet(w, slot.slotIndex, i, r);
    });
  }
  return w;
}

let clock = 1_000_000;
/** Builds, fills and finishes `dayId`; returns finishWorkout's result. */
function doDay(state, dayId, plan) {
  clock += 1000;
  const inProgress = fill(buildWorkout(state, program, dayId, clock), plan);
  return finishWorkout({ ...state, inProgress }, program, clock + 500);
}
const lift = (s, id, tier) => s.lifts[id][tier];
const change = (r, id, tier) => r.changes.find((c) => c.exerciseId === id && c.tier === tier);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// ---------- basics ----------

test("initialLiftState reads starting weights / rep targets from program", () => {
  assert.deepEqual(initialLiftState(program, "squat", "T1"), { weight: 245, stage: 1, stageStartWeight: 245, repTarget: null, history: [] });
  assert.equal(initialLiftState(program, "squat", "T2").weight, 185);
  assert.equal(initialLiftState(program, "barbell_curl", "T3").weight, null);
  assert.deepEqual(initialLiftState(program, "hanging_leg_raise", "T3"), { weight: null, stage: 1, stageStartWeight: null, repTarget: 10, history: [] });
  assert.equal(initialLiftState(program, "rdl", "T2").weight, null);
});

test("prescription per tier/stage", () => {
  const p = (id, tier, l) => prescription(program, id, tier, l);
  const t1 = p("squat", "T1", { stage: 1 });
  assert.equal(t1.scheme, "5×3");
  assert.equal(t1.sets.length, 5);
  assert.deepEqual(t1.sets.map((s) => s.amrap), [false, false, false, false, true]);
  assert.equal(p("squat", "T1", { stage: 2 }).scheme, "6×2");
  assert.equal(p("squat", "T1", { stage: 3 }).scheme, "10×1");
  const t2 = p("bench", "T2", { stage: 1 });
  assert.equal(t2.scheme, "3×10");
  assert.ok(t2.sets.every((s) => !s.amrap));
  assert.equal(p("bench", "T2", { stage: 3 }).scheme, "3×6");
  const t3 = p("lat_pulldown", "T3", { stage: 1 });
  assert.equal(t3.scheme, "3×15");
  assert.deepEqual(t3.sets.map((s) => s.amrap), [false, false, true]);
  const bw = p("hanging_leg_raise", "T3", { repTarget: 10 });
  assert.equal(bw.scheme, "3×10+");
  assert.deepEqual(bw.sets, [{ target: 10, amrap: false }, { target: 10, amrap: false }, { target: 10, amrap: true }]);
});

test("slotSuccess: every set >= target; null reps fail", () => {
  const sets = (reps) => ({ sets: reps.map((r) => ({ target: 3, reps: r })) });
  assert.equal(slotSuccess(sets([3, 3, 4])), true);
  assert.equal(slotSuccess(sets([3, 2, 4])), false);
  assert.equal(slotSuccess(sets([3, null, 4])), false);
});

test("incrementFor: smallIncrement only when both toggles are on", () => {
  const bench = program.exercises.bench, squat = program.exercises.squat;
  assert.equal(incrementFor(bench, { smallIncrements: false, smallPlates: false }), 5);
  assert.equal(incrementFor(bench, { smallIncrements: true, smallPlates: false }), 5);
  assert.equal(incrementFor(bench, { smallIncrements: false, smallPlates: true }), 5);
  assert.equal(incrementFor(bench, { smallIncrements: true, smallPlates: true }), 2.5);
  assert.equal(incrementFor(squat, { smallIncrements: true, smallPlates: true }), 10);
  assert.equal(incrementFor(program.exercises.ohp, { smallIncrements: true, smallPlates: true }), 2.5);
});

// ---------- T1 ----------

test("T1 success -> + increment, same stage", () => {
  const r = doDay(fresh(), "A1");
  assert.deepEqual({ ...lift(r.state, "squat", "T1"), history: undefined }, { weight: 255, stage: 1, stageStartWeight: 245, repTarget: null, history: undefined });
  const c = change(r, "squat", "T1");
  assert.equal(c.kind, "increase");
  assert.equal(c.success, true);
  assert.deepEqual(c.from, { weight: 245, stage: 1, repTarget: null });
  assert.deepEqual(c.to, { weight: 255, stage: 1, repTarget: null });
  assert.equal(c.message, "Next: 255 lb · stage 1 (5×3)");
  const ev = lift(r.state, "squat", "T1").history.at(-1);
  assert.equal(ev.type, "progress");
  assert.equal(ev.workoutId, r.state.workouts[0].id);
  assert.deepEqual(ev.from, { weight: 245, stage: 1, stageStartWeight: 245, repTarget: null });
  assert.deepEqual(ev.to, { weight: 255, stage: 1, stageStartWeight: 245, repTarget: null });
});

test("T1 AMRAP above target is still a plain success", () => {
  const r = doDay(fresh(), "A1", { T1: [3, 3, 3, 3, 9] });
  assert.equal(lift(r.state, "squat", "T1").weight, 255);
});

test("T1 fail: stage 1 -> 2 -> 3 at same weight, then reset decision", () => {
  let s = fresh();
  let r = doDay(s, "A1", { T1: [3, 3, 3, 3, 2] });
  assert.deepEqual([lift(r.state, "squat", "T1").weight, lift(r.state, "squat", "T1").stage], [245, 2]);
  assert.equal(change(r, "squat", "T1").kind, "stage");
  assert.equal(change(r, "squat", "T1").message, "Next: stage 2 (6×2) at 245 lb");
  assert.equal(lift(r.state, "squat", "T1").history.at(-1).type, "stage");

  r = doDay(r.state, "A1", { T1: [2, 2, 2, 1, 2, 2] });
  assert.deepEqual([lift(r.state, "squat", "T1").weight, lift(r.state, "squat", "T1").stage], [245, 3]);
  assert.equal(change(r, "squat", "T1").message, "Next: stage 3 (10×1) at 245 lb");

  const before = lift(r.state, "squat", "T1");
  r = doDay(r.state, "A1", { T1: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0] });
  assert.deepEqual(lift(r.state, "squat", "T1"), before, "lift state unchanged while decision pending");
  const c = change(r, "squat", "T1");
  assert.equal(c.kind, "pending");
  assert.equal(c.to, null);
  assert.equal(c.message, "Reset decision needed");
  assert.equal(r.pendingDecisions.length, 1);
  const d = r.pendingDecisions[0];
  assert.equal(d.type, "t1-reset");
  assert.equal(d.id, `${r.state.workouts.at(-1).id}:squat:T1`);
  assert.equal(d.tier, "T1");
  assert.equal(d.name, "Squat");
  assert.deepEqual(d.context, { currentWeight: 245, stageStartWeight: 245 });
  assert.deepEqual(r.state.pendingDecisions, [d]);
});

/** W1 success at 245 (AMRAP 6 -> e1RM 294); W2 fail s1 at 255; W3 fail s2 at 255 (AMRAP 4); W4 fail s3. */
function t1ResetScenario() {
  let r = doDay(fresh(), "A1", { T1: [3, 3, 3, 3, 6] });
  r = doDay(r.state, "A1", { T1: [3, 3, 3, 3, 2] });
  r = doDay(r.state, "A1", { T1: [2, 2, 2, 2, 1, 4] });
  r = doDay(r.state, "A1", { T1: [1, 1, 1, 1, 1, 1, 1, 0, 0, 0] });
  return r;
}

test("T1 reset suggestion: best Epley set across the last 3 T1 workouts", () => {
  const r = t1ResetScenario();
  const d = r.pendingDecisions[0];
  const s = d.suggestion;
  const ws = r.state.workouts;
  assert.equal(s.sourceSets.length, 3);
  assert.deepEqual(s.sourceSets.map((x) => x.workoutId), [ws[1].id, ws[2].id, ws[3].id]); // W1's 294 is outside lookback
  assert.deepEqual(s.sourceSets.map((x) => [x.weight, x.reps]), [[255, 3], [255, 4], [255, 1]]);
  assert.deepEqual(s.sourceSets.map((x) => x.best), [false, true, false]);
  assert.equal(s.sourceSets[1].date, ws[2].finishedAt);
  close(s.e1RM, 255 * (1 + 4 / 30));
  close(s.estimated5RM, (255 * (1 + 4 / 30)) / (1 + 5 / 30));
  // 0.85 * 247.71 = 210.56 -> 210
  assert.equal(s.weight, 210);
});

test("resolveDecision with tested 5RM: stage 1 at round(0.85 x 5RM)", () => {
  const r = t1ResetScenario();
  const d = r.pendingDecisions[0];
  const s = resolveDecision(r.state, d, { method: "tested", fiveRM: 260 }, program, 9e9);
  const l = lift(s, "squat", "T1");
  assert.equal(l.weight, 220); // 221 -> 220
  assert.equal(l.stage, 1);
  assert.equal(l.stageStartWeight, 220);
  const ev = l.history.at(-1);
  assert.equal(ev.type, "reset");
  assert.equal(ev.reason, "tested-5rm");
  assert.equal(ev.at, 9e9);
  assert.equal(ev.workoutId, d.workoutId);
  assert.deepEqual(ev.from, { weight: 255, stage: 3, stageStartWeight: 245, repTarget: null });
  assert.deepEqual(ev.to, { weight: 220, stage: 1, stageStartWeight: 220, repTarget: null });
  assert.deepEqual(s.pendingDecisions, []);
  const c = s.workouts.at(-1).changes.find((x) => x.exerciseId === "squat" && x.tier === "T1");
  assert.equal(c.kind, "reset");
  assert.deepEqual(c.to, { weight: 220, stage: 1, repTarget: null });
  assert.equal(c.message, "Reset: stage 1 (5×3) at 220 lb");
  // input not mutated
  assert.equal(r.state.pendingDecisions.length, 1);
  assert.equal(r.state.workouts.at(-1).changes.find((x) => x.tier === "T1").kind, "pending");
  // ties round down: 0.85 * 250 = 212.5 -> 210
  assert.equal(lift(resolveDecision(r.state, d.id, { method: "tested", fiveRM: 250 }, program, 1), "squat", "T1").weight, 210);
  // next workout is built from the reset
  const slot = buildSlot(s, program, "A1", 0);
  assert.equal(slot.weight, 220);
  assert.equal(slot.scheme, "5×3");
});

test("resolveDecision with estimate uses suggestion.weight", () => {
  const r = t1ResetScenario();
  const d = r.pendingDecisions[0];
  const s = resolveDecision(r.state, d, { method: "estimate" }, program, 5);
  const l = lift(s, "squat", "T1");
  assert.deepEqual([l.weight, l.stage, l.stageStartWeight], [210, 1, 210]);
  assert.equal(l.history.at(-1).reason, "estimated-5rm");
  assert.equal(l.history.at(-1).detail.sourceSets.length, 3);
});

test("resolveDecision rejects invalid choices", () => {
  const r = t1ResetScenario();
  const d = r.pendingDecisions[0];
  for (const choice of [{ method: "tested", fiveRM: 0 }, { method: "tested", fiveRM: -5 }, { method: "tested", fiveRM: NaN }, { method: "tested" }, { weight: 200 }, null]) {
    assert.throws(() => resolveDecision(r.state, d, choice, program, 1), Error);
  }
  assert.throws(() => resolveDecision(r.state, { id: "nope" }, { method: "estimate" }, program, 1), /not found/);
});

test("T1 estimate unavailable when no usable sets", () => {
  let s = applyOverride(fresh(), "squat", "T1", { stage: 3 }, "test", 1);
  const r = doDay(s, "A1", { T1: Array(10).fill(0) });
  const d = r.pendingDecisions[0];
  assert.deepEqual(d.suggestion, { estimated5RM: null, e1RM: null, weight: null, sourceSets: [] });
  assert.throws(() => resolveDecision(r.state, d, { method: "estimate" }, program, 1), /estimate/);
  assert.equal(lift(resolveDecision(r.state, d, { method: "tested", fiveRM: 300 }, program, 1), "squat", "T1").weight, 255);
});

test("t1ResetWeight", () => {
  const cfg = plateConfig(program, SETTINGS);
  assert.equal(t1ResetWeight(300, cfg, program), 255);
  assert.equal(t1ResetWeight(250, cfg, program), 210);
  assert.equal(t1ResetWeight(250, plateConfig(program, { smallPlates: true }), program), 212.5);
});

// ---------- T2 ----------

function failT2ThreeTimes(state) {
  let r = doDay(state, "A1", { T2: [10, 10, 9] });
  r = doDay(r.state, "A1", { T2: [8, 7, 8] });
  return doDay(r.state, "A1", { T2: [6, 6, 5] });
}

test("T2: 3×10 fail -> 3×8 -> 3×6 -> t2-reset decision", () => {
  let r = doDay(fresh(), "A1", { T2: [10, 10, 9] });
  let l = lift(r.state, "bench", "T2");
  assert.deepEqual([l.weight, l.stage], [110, 2]);
  assert.equal(change(r, "bench", "T2").message, "Next: stage 2 (3×8) at 110 lb");
  r = doDay(r.state, "A1", { T2: [8, 7, 8] });
  l = lift(r.state, "bench", "T2");
  assert.deepEqual([l.weight, l.stage], [110, 3]);
  r = doDay(r.state, "A1", { T2: [6, 6, 5] });
  const d = r.pendingDecisions.find((x) => x.tier === "T2");
  assert.equal(d.type, "t2-reset");
  assert.deepEqual(d.suggestion, { weight: 125, min: 125, max: 130 });
  assert.deepEqual(d.context, { currentWeight: 110, stageStartWeight: 110 });
  assert.equal(change(r, "bench", "T2").kind, "pending");
});

test("T2 success -> + increment, stage kept; stageStartWeight unchanged", () => {
  let r = doDay(fresh(), "A1", { T2: [10, 10, 9] }); // stage 2
  r = doDay(r.state, "A1"); // success at stage 2
  const l = lift(r.state, "bench", "T2");
  assert.deepEqual([l.weight, l.stage, l.stageStartWeight], [115, 2, 110]);
  assert.equal(change(r, "bench", "T2").message, "Next: 115 lb · stage 2 (3×8)");
});

test("T2 reset with custom weight; rounded to loadable", () => {
  const r = failT2ThreeTimes(fresh());
  const d = r.pendingDecisions[0];
  let s = resolveDecision(r.state, d, { weight: 140 }, program, 1);
  assert.deepEqual([lift(s, "bench", "T2").weight, lift(s, "bench", "T2").stage, lift(s, "bench", "T2").stageStartWeight], [140, 1, 140]);
  assert.equal(lift(s, "bench", "T2").history.at(-1).reason, "t2-reset");
  s = resolveDecision(r.state, d, { weight: 127 }, program, 1);
  assert.equal(lift(s, "bench", "T2").weight, 125);
  assert.throws(() => resolveDecision(r.state, d, { weight: 0 }, program, 1));
  assert.throws(() => resolveDecision(r.state, d, { method: "estimate" }, program, 1));
});

test("T2: two consecutive reset cycles use the current stageStartWeight", () => {
  let r = failT2ThreeTimes(fresh());
  let s = resolveDecision(r.state, r.pendingDecisions[0], { weight: r.pendingDecisions[0].suggestion.weight }, program, 1);
  assert.equal(lift(s, "bench", "T2").stageStartWeight, 125);
  r = doDay(s, "A1"); // success: 130, ssw stays 125
  assert.deepEqual([lift(r.state, "bench", "T2").weight, lift(r.state, "bench", "T2").stageStartWeight], [130, 125]);
  r = failT2ThreeTimes(r.state);
  const d2 = r.pendingDecisions.find((x) => x.tier === "T2");
  assert.deepEqual(d2.suggestion, { weight: 140, min: 140, max: 145 });
  assert.deepEqual(d2.context, { currentWeight: 130, stageStartWeight: 125 });
  s = resolveDecision(r.state, d2, { weight: 140 }, program, 2);
  assert.deepEqual([lift(s, "bench", "T2").weight, lift(s, "bench", "T2").stage, lift(s, "bench", "T2").stageStartWeight], [140, 1, 140]);
});

// ---------- T3 ----------

test("T3 weighted: last set >= 25 -> + increment; 24 -> unchanged", () => {
  let r = doDay(fresh(), "A1", { T3a: [15, 15, 25] });
  assert.equal(lift(r.state, "lat_pulldown", "T3").weight, 105);
  assert.equal(change(r, "lat_pulldown", "T3").kind, "increase");
  assert.equal(change(r, "lat_pulldown", "T3").message, "Next: 105 lb (3×15)");
  r = doDay(fresh(), "A1", { T3a: [15, 15, 24] });
  assert.equal(lift(r.state, "lat_pulldown", "T3").weight, 100);
  assert.equal(change(r, "lat_pulldown", "T3").kind, "same");
  assert.equal(change(r, "lat_pulldown", "T3").success, true);
  assert.equal(change(r, "lat_pulldown", "T3").message, "Next: same weight (100 lb)");
  r = doDay(fresh(), "B1", { T3a: [12, 10, 30] });
  assert.equal(lift(r.state, "barbell_row", "T3").weight, 100);
  assert.equal(change(r, "barbell_row", "T3").success, false);
});

test("T3 with no weight set yet changes nothing", () => {
  const s = fresh();
  const r = doDay(s, "B1", { T3b: [null, null, null] });
  assert.deepEqual(lift(r.state, "barbell_curl", "T3"), lift(s, "barbell_curl", "T3"));
  assert.equal(change(r, "barbell_curl", "T3").kind, "same");
});

test("bodyweight: last set >= target + 5 -> target + 2; 14 -> unchanged", () => {
  let r = doDay(fresh(), "A1", { T3b: [10, 10, 15] });
  assert.equal(lift(r.state, "hanging_leg_raise", "T3").repTarget, 12);
  assert.equal(lift(r.state, "hanging_leg_raise", "T3").weight, null);
  assert.equal(change(r, "hanging_leg_raise", "T3").kind, "repTarget");
  assert.equal(change(r, "hanging_leg_raise", "T3").message, "Next: target 12 reps (3×12+)");
  assert.equal(buildSlot(r.state, program, "A1", 3).scheme, "3×12+");
  r = doDay(r.state, "A1", { T3b: [12, 12, 17] });
  assert.equal(lift(r.state, "hanging_leg_raise", "T3").repTarget, 14);
  r = doDay(fresh(), "A1", { T3b: [10, 10, 14] });
  assert.equal(lift(r.state, "hanging_leg_raise", "T3").repTarget, 10);
  assert.equal(change(r, "hanging_leg_raise", "T3").kind, "same");
});

// ---------- incomplete & misc ----------

test("incomplete sets (reps null) count as failure", () => {
  const r = doDay(fresh(), "A1", { T1: [3, 3, 3, null, null], T2: [10, null, null] });
  assert.equal(lift(r.state, "squat", "T1").stage, 2);
  assert.equal(lift(r.state, "bench", "T2").stage, 2);
  assert.equal(change(r, "squat", "T1").success, false);
  assert.deepEqual(lift(r.state, "squat", "T1").history.at(-1).detail.reps, [3, 3, 3, 0, 0]);
});

test("small increments: bench +2.5 with both toggles; disabling plates re-rounds the slot", () => {
  const r = doDay(fresh({ smallIncrements: true, smallPlates: true }), "A1");
  assert.equal(lift(r.state, "bench", "T2").weight, 112.5);
  assert.equal(lift(r.state, "squat", "T1").weight, 255);
  assert.equal(buildSlot(r.state, program, "A1", 1).weight, 112.5);
  const off = { ...r.state, settings: { ...r.state.settings, smallPlates: false } };
  assert.equal(buildSlot(off, program, "A1", 1).weight, 110); // 112.5 tie -> down
  const onlyIncrements = doDay(fresh({ smallIncrements: true }), "A1");
  assert.equal(lift(onlyIncrements.state, "bench", "T2").weight, 115);
});

test("applyWorkout is pure and leaves workouts/rotation/pendingDecisions alone", () => {
  const s = fresh();
  const w = fill(buildWorkout(s, program, "A1", 1), { T1: [1, 1, 1, 1, 1] });
  const frozen = structuredClone(s);
  const r = applyWorkout(s, w, program, 2);
  assert.deepEqual(s, frozen);
  assert.equal(r.state.workouts, s.workouts);
  assert.equal(r.state.rotationIndex, 0);
  assert.equal(r.state.pendingDecisions, s.pendingDecisions);
  assert.equal(r.changes.length, 4);
});

test("previewOutcomes", () => {
  const s = fresh();
  const pv = (id, tier, l, st = SETTINGS) => previewOutcomes(program, id, tier, l ?? lift(s, id, tier), st);
  assert.deepEqual(pv("squat", "T1"), { onSuccess: "255 lb", onFail: "Stage 2 (6×2) at 245 lb" });
  assert.deepEqual(pv("squat", "T1", { weight: 245, stage: 3 }), { onSuccess: "255 lb", onFail: "Reset decision" });
  assert.deepEqual(pv("bench", "T2"), { onSuccess: "115 lb", onFail: "Stage 2 (3×8) at 110 lb" });
  assert.equal(pv("bench", "T2", null, { ...SETTINGS, smallIncrements: true, smallPlates: true }).onSuccess, "112.5 lb");
  assert.deepEqual(pv("lat_pulldown", "T3"), { onSuccess: "105 lb (last set ≥ 25)", onFail: "Same weight (100 lb)" });
  assert.deepEqual(pv("hanging_leg_raise", "T3"), { onSuccess: "Target 12 reps (last set ≥ 15)", onFail: "Same target (10 reps)" });
  assert.equal(pv("barbell_curl", "T3").onSuccess, "Set a starting weight");
});

test("plates:false exercise in a T1 slot: reset weights are not rounded to the bar/plates", () => {
  const p = structuredClone(program);
  p.exercises.custom_press = { id: "custom_press", name: "Machine press", type: "machine", startingWeight: { T1: 30 }, increment: 5, smallIncrement: null, warmup: false, plates: false };
  p.days.A1.slots[0] = { exerciseId: "custom_press", tier: "T1", label: "T1" };
  const cfg = plateConfig(p, SETTINGS);
  const ex = p.exercises.custom_press;
  assert.equal(t1ResetWeight(40, cfg, p), 45, "no exercise -> legacy loadable rounding");
  assert.equal(t1ResetWeight(40, cfg, p, ex), 34);
  assert.equal(t1ResetWeight(250, cfg, p, program.exercises.squat), 210);

  let s = ensureLifts({ ...fresh(), lifts: {} }, p);
  s = applyOverride(s, "custom_press", "T1", { stage: 3 }, null, 1);
  const w = buildWorkout(s, p, "A1", 10);
  assert.equal(w.slots[0].weight, 30);
  assert.deepEqual(w.slots[0].warmups, []);
  let inProgress = w;
  for (const slot of w.slots) slot.sets.forEach((x, i) => { inProgress = logSet(inProgress, slot.slotIndex, i, slot.slotIndex === 0 ? (i === 0 ? 4 : 0) : x.target); });
  const r = finishWorkout({ ...s, inProgress }, p, 20);
  const d = r.pendingDecisions[0];
  // best set 30x4 -> e1RM 34, 5RM 29.14, x0.85 = 24.77 (not rounded up to the 45 bar)
  close(d.suggestion.weight, Math.round(0.85 * (30 * (1 + 4 / 30)) / (1 + 5 / 30) * 10000) / 10000);
  assert.ok(d.suggestion.weight < 45);
  const est = resolveDecision(r.state, d, { method: "estimate" }, p, 30);
  assert.equal(est.lifts.custom_press.T1.weight, d.suggestion.weight);
  const tested = resolveDecision(r.state, d, { method: "tested", fiveRM: 40 }, p, 30);
  assert.equal(tested.lifts.custom_press.T1.weight, t1ResetWeight(40, cfg, p, ex));
  assert.equal(tested.lifts.custom_press.T1.weight, 34);
});
