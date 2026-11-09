import test from "node:test";
import assert from "node:assert/strict";
import { epley, estimate5RM, bestE1RM, e1rmSeries } from "../src/logic/onerm.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("epley", () => {
  close(epley(300, 3), 330);
  close(epley(270, 5), 315);
  close(epley(100, 1), 100 * (1 + 1 / 30));
  assert.equal(epley(300, 0), 0);
  assert.equal(epley(300, -1), 0);
  assert.equal(epley(null, 5), 0);
});

test("estimate5RM", () => {
  close(estimate5RM(315), 270);
  close(estimate5RM(350), 300);
});

test("bestE1RM picks best set, ignores reps <= 0", () => {
  const sets = [{ weight: 300, reps: 1 }, { weight: 270, reps: 5 }, { weight: 400, reps: 0 }, { weight: 250, reps: null }];
  const best = bestE1RM(sets);
  close(best.e1RM, 315);
  assert.equal(best.set, sets[1]);
  assert.equal(bestE1RM([{ weight: 100, reps: 0 }]), null);
  assert.equal(bestE1RM([]), null);
});

const mkWorkout = (id, at, slots) => ({ id, startedAt: at - 100, finishedAt: at, dayId: "A1", slots });
const slot = (exerciseId, tier, weight, reps) => ({ exerciseId, tier, weight, sets: reps.map((r) => ({ target: 3, reps: r, amrap: false, done: r != null })) });

test("e1rmSeries: one point per workout, T1 only by default, chronological", () => {
  const ws = [
    mkWorkout("w2", 2000, [slot("squat", "T1", 255, [3, 3, 3, 3, 6]), slot("squat", "T2", 400, [10, 10, 10])]),
    mkWorkout("w1", 1000, [slot("squat", "T1", 245, [3, 3, 3, 3, 3])]),
    mkWorkout("w3", 3000, [slot("bench", "T1", 145, [3, 3, 3, 3, 3])]),
    mkWorkout("w4", 4000, [slot("squat", "T1", 265, [0, 0, null, null, null])]),
  ];
  const s = e1rmSeries(ws, "squat");
  assert.deepEqual(s.map((p) => p.workoutId), ["w1", "w2"]);
  close(s[1].e1RM, 255 * 1.2);
  assert.equal(s[1].reps, 6);
  assert.equal(s[1].weight, 255);
  assert.equal(s[0].date, 1000);
  const t2 = e1rmSeries(ws, "squat", "T2");
  assert.equal(t2.length, 1);
  close(t2[0].e1RM, 400 * (1 + 10 / 30));
});
