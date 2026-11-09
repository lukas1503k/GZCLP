// End-to-end scenario through pure logic + storage (no browser): first launch, A1 with a
// failed T1 set, finish, persistence, rotation, barbell-curl prompt, undo, export/import.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateProgram, effectiveProgram } from "../src/logic/program.js";
import { ensureLifts, finishWorkout, undoLastWorkout, applyOverride } from "../src/logic/session.js";
import { buildWorkout, buildSlot, logSet } from "../src/logic/workout.js";
import { nextDayId } from "../src/logic/rotation.js";
import { defaultState } from "../src/state/schema.js";
import { createStorage, createMemoryBackend } from "../src/state/storage.js";
import { serializeBackup, parseBackup } from "../src/state/exportImport.js";

const base = JSON.parse(readFileSync(new URL("../program.json", import.meta.url), "utf8"));
const T0 = Date.UTC(2026, 10, 9, 12);

function fresh() {
  const s = defaultState(base.defaults);
  return ensureLifts(s, effectiveProgram(base, s.program));
}

function doAll(workout, overrides = {}) {
  let w = workout;
  w.slots.forEach((slot, si) => slot.sets.forEach((set, i) => {
    const reps = overrides[`${si}:${i}`] ?? set.target;
    w = logSet(w, si, i, reps);
  }));
  return w;
}

test("program.json is valid", () => assert.equal(validateProgram(base).ok, true));

test("full A1 scenario with persistence, rotation, undo and backup", () => {
  const storage = createStorage(createMemoryBackend());
  let state = fresh();
  const program = effectiveProgram(base, state.program);

  // First launch shows A1 with the spec's starting weights.
  assert.equal(nextDayId(program, state.rotationIndex), "A1");
  let w = buildWorkout(state, program, "A1", T0);
  assert.deepEqual(w.slots.map((s) => [s.exerciseId, s.tier, s.weight]), [
    ["squat", "T1", 245], ["bench", "T2", 110], ["lat_pulldown", "T3", 100], ["hanging_leg_raise", "T3", null],
  ]);
  assert.equal(w.slots[0].warmups.map((x) => `${x.weight}x${x.reps}`).join(","), "45x10,100x5,145x3,185x2,210x1");

  // Log everything at target except one squat set; lat pulldown AMRAP 25; leg raise AMRAP 15.
  w = doAll(w, { "0:2": 2, "2:2": 25, "3:2": 15 });
  state = { ...state, inProgress: w };

  // Mid-workout persistence round-trip.
  assert.equal(storage.save(state), true);
  assert.deepEqual(storage.load(), state);

  const result = finishWorkout(storage.load(), program, T0 + 3600e3);
  state = result.state;
  assert.equal(result.pendingDecisions.length, 0);
  assert.equal(state.lifts.squat.T1.stage, 2);
  assert.equal(state.lifts.squat.T1.weight, 245);
  assert.equal(state.lifts.bench.T2.weight, 115);
  assert.equal(state.lifts.lat_pulldown.T3.weight, 105);
  assert.equal(state.lifts.hanging_leg_raise.T3.repTarget, 12);
  assert.equal(state.inProgress, null);
  assert.equal(nextDayId(program, state.rotationIndex), "B1");
  storage.save(state);

  // B1 has barbell curl with no weight: set once via override, then it sticks.
  let b1 = buildWorkout(state, program, "B1", T0 + 86400e3);
  const curl = b1.slots.find((s) => s.exerciseId === "barbell_curl");
  assert.equal(curl.weight, null);
  state = applyOverride(state, "barbell_curl", "T3", { weight: 65 }, "starting weight", T0 + 86400e3);
  assert.equal(buildSlot(state, program, "B1", curl.slotIndex).weight, 65);

  // Export / import round-trip.
  const { filename, text } = serializeBackup(state, T0);
  assert.match(filename, /^gzclp-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const parsed = parseBackup(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state, state);

  // Undo restores pre-workout state and rotation.
  const undone = undoLastWorkout(state);
  assert.equal(undone.workouts.length, 0);
  assert.equal(undone.rotationIndex, 0);
  assert.equal(undone.lifts.squat.T1.stage, 1);
  assert.equal(undone.lifts.bench.T2.weight, 110);
});

test("rotation wraps B2 -> A1 and discarding never advances", () => {
  let state = fresh();
  const program = effectiveProgram(base, state.program);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const day = nextDayId(program, state.rotationIndex);
    seen.push(day);
    // A discarded workout (built, then dropped) leaves the pointer alone.
    buildWorkout(state, program, day, T0 + i);
    assert.equal(nextDayId(program, state.rotationIndex), day);
    state = { ...state, inProgress: doAll(buildWorkout(state, program, day, T0 + i)) };
    state = finishWorkout(state, program, T0 + i + 1).state;
  }
  assert.deepEqual(seen, ["A1", "B1", "A2", "B2", "A1"]);
});
