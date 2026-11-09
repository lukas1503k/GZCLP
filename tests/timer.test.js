import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startTimer, remainingMs, adjustTimer, formatRemaining, createTimerRunner,
} from "../src/services/timer.js";

const T0 = 1_700_000_000_000;

function fakeClock(start = T0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
}

// Manual scheduler: queued callbacks run only when the test says so.
function manualScheduler() {
  let id = 0;
  const queue = new Map();
  return {
    schedule: (fn) => { const h = ++id; queue.set(h, fn); return h; },
    cancel: (h) => { queue.delete(h); },
    pending: () => queue.size,
    runAll() {
      const fns = [...queue.values()];
      queue.clear();
      for (const fn of fns) fn();
    },
  };
}

function fakeDoc() {
  const listeners = new Map();
  return {
    visibilityState: "visible",
    addEventListener(type, fn) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type) { for (const fn of [...(listeners.get(type) ?? [])]) fn({ type }); },
    count(type) { return listeners.get(type)?.size ?? 0; },
  };
}

function setup({ doc } = {}) {
  const clock = fakeClock();
  const sched = manualScheduler();
  const ticks = [];
  const finished = [];
  const runner = createTimerRunner({
    now: clock.now, schedule: sched.schedule, cancel: sched.cancel, doc,
    onTick: (ms, timer) => ticks.push({ ms, timer }),
    onFinish: (timer) => finished.push(timer),
  });
  return { clock, sched, ticks, finished, runner };
}

const META = { exerciseId: "squat", slotIndex: 0, setIndex: 1, kind: "working", nextLabel: "Squat · set 3 of 5" };

test("startTimer builds a TimerState from now + seconds", () => {
  const t = startTimer(T0, 180, META);
  assert.deepEqual(t, {
    endsAt: T0 + 180_000, durationSec: 180, exerciseId: "squat", slotIndex: 0, setIndex: 1,
    kind: "working", nextLabel: "Squat · set 3 of 5",
  });
  const bare = startTimer(T0, 60, {});
  assert.equal(bare.exerciseId, null);
  assert.equal(bare.kind, "working");
  assert.equal(bare.nextLabel, null);
  assert.equal(startTimer(T0, 60, { kind: "warmup" }).kind, "warmup");
});

test("start 180 s, advance clock 60 s -> 120000 ms remaining", () => {
  const { clock, sched, ticks, runner } = setup();
  const timer = startTimer(clock.now(), 180, META);
  runner.set(timer);
  assert.equal(ticks.at(-1).ms, 180_000);
  clock.advance(60_000);
  sched.runAll();
  assert.equal(ticks.at(-1).ms, 120_000);
  assert.equal(remainingMs(timer, clock.now()), 120_000);
  assert.equal(formatRemaining(ticks.at(-1).ms), "2:00");
});

test("ticks never accumulate: remaining depends only on the clock", () => {
  const { clock, sched, ticks, runner } = setup();
  runner.set(startTimer(clock.now(), 180, META));
  // Many ticks with no clock movement do not change the remaining time.
  for (let i = 0; i < 50; i++) sched.runAll();
  assert.equal(ticks.at(-1).ms, 180_000);
  // Only one tick is ever queued at a time.
  assert.equal(sched.pending(), 1);
});

test("adjustTimer ±30 s, clamped at now", () => {
  const t = startTimer(T0, 180, META);
  assert.equal(adjustTimer(t, 30, T0).endsAt, T0 + 210_000);
  assert.equal(adjustTimer(t, -30, T0).endsAt, T0 + 150_000);
  // 20 s left, -30 -> clamps to now (0 remaining), never in the past
  const late = T0 + 160_000;
  assert.equal(adjustTimer(t, -30, late).endsAt, late);
  assert.equal(remainingMs(adjustTimer(t, -30, late), late), 0);
  // pure
  assert.equal(t.endsAt, T0 + 180_000);
  assert.equal(adjustTimer(t, 30, T0).durationSec, 180);
});

test("adjusted timer passed to the runner fires at the new endsAt", () => {
  const { clock, sched, finished, runner } = setup();
  let t = startTimer(clock.now(), 60, META);
  runner.set(t);
  t = adjustTimer(t, 30, clock.now());
  runner.set(t);
  clock.advance(61_000);
  sched.runAll();
  assert.equal(finished.length, 0);
  clock.advance(30_000);
  sched.runAll();
  assert.equal(finished.length, 1);
});

test("skip via set(null) stops ticking and never fires", () => {
  const { clock, sched, ticks, finished, runner } = setup();
  runner.set(startTimer(clock.now(), 75, META));
  const n = ticks.length;
  runner.set(null);
  assert.equal(sched.pending(), 0);
  clock.advance(120_000);
  sched.runAll();
  runner.sync();
  assert.equal(ticks.length, n);
  assert.equal(finished.length, 0);
});

test("sleep/background: advance 10 min, then tick -> expired, onFinish exactly once", () => {
  const { clock, sched, ticks, finished, runner } = setup();
  const timer = startTimer(clock.now(), 180, META);
  runner.set(timer);
  clock.advance(10 * 60_000);
  sched.runAll();
  assert.ok(ticks.at(-1).ms <= 0);
  assert.equal(ticks.at(-1).ms, -420_000);
  assert.equal(finished.length, 1);
  assert.equal(finished[0], timer);
  // no further ticks scheduled; manual syncs/ticks never refire
  assert.equal(sched.pending(), 0);
  sched.runAll();
  runner.sync();
  runner.sync();
  clock.advance(60_000);
  runner.sync();
  assert.equal(finished.length, 1);
  assert.equal(formatRemaining(ticks.at(-1).ms), "0:00");
});

test("sleep/background: sync() alone (no pending tick run) detects expiry once", () => {
  const { clock, finished, ticks, runner } = setup();
  runner.set(startTimer(clock.now(), 180, META));
  clock.advance(10 * 60_000);
  runner.sync();
  assert.ok(ticks.at(-1).ms <= 0);
  assert.equal(finished.length, 1);
  runner.sync();
  assert.equal(finished.length, 1);
});

test("re-setting the same expired timer does not refire; a new endsAt can fire", () => {
  const { clock, finished, runner } = setup();
  const t = startTimer(clock.now(), 10, META);
  runner.set(t);
  clock.advance(11_000);
  runner.sync();
  assert.equal(finished.length, 1);
  runner.set(t); // e.g. app re-render passes the same state back
  assert.equal(finished.length, 1);
  runner.set(startTimer(clock.now(), 5, META));
  clock.advance(5_000);
  runner.sync();
  assert.equal(finished.length, 2);
});

test("set(expiredTimer, {silentIfExpired:true}) does not fire onFinish", () => {
  const { clock, sched, finished, ticks, runner } = setup();
  const t = startTimer(clock.now() - 300_000, 180, META); // ended 2 min ago (reload case)
  runner.set(t, { silentIfExpired: true });
  sched.runAll();
  runner.sync();
  assert.equal(finished.length, 0);
  assert.ok(ticks.at(-1).ms <= 0);
});

test("silentIfExpired has no effect on a timer that is still running", () => {
  const { clock, sched, finished, runner } = setup();
  runner.set(startTimer(clock.now(), 30, META), { silentIfExpired: true });
  clock.advance(31_000);
  sched.runAll();
  assert.equal(finished.length, 1);
});

test("set(expiredTimer) without silent fires once", () => {
  const { clock, finished, runner } = setup();
  runner.set(startTimer(clock.now() - 300_000, 180, META));
  assert.equal(finished.length, 1);
});

test("visibilitychange on the doc triggers sync", () => {
  const doc = fakeDoc();
  const { clock, ticks, finished, runner } = setup({ doc });
  assert.equal(doc.count("visibilitychange"), 1);
  runner.set(startTimer(clock.now(), 180, META));
  const n = ticks.length;
  clock.advance(100_000);
  doc.visibilityState = "visible";
  doc.dispatch("visibilitychange"); // no scheduler run: the event alone recomputes
  assert.equal(ticks.length, n + 1);
  assert.equal(ticks.at(-1).ms, 80_000);
  clock.advance(100_000);
  doc.dispatch("visibilitychange");
  assert.equal(finished.length, 1);
  runner.stop();
  assert.equal(doc.count("visibilitychange"), 0);
});

test("stop() cancels pending ticks", () => {
  const { clock, sched, ticks, runner } = setup();
  runner.set(startTimer(clock.now(), 180, META));
  runner.stop();
  assert.equal(sched.pending(), 0);
  const n = ticks.length;
  sched.runAll();
  assert.equal(ticks.length, n);
});

test("formatRemaining m:ss", () => {
  assert.equal(formatRemaining(61_000), "1:01");
  assert.equal(formatRemaining(180_000), "3:00");
  assert.equal(formatRemaining(119_001), "2:00"); // rounds up: shows 0:00 only when done
  assert.equal(formatRemaining(9_000), "0:09");
  assert.equal(formatRemaining(1), "0:01");
  assert.equal(formatRemaining(0), "0:00");
  assert.equal(formatRemaining(-5_000), "0:00");
  assert.equal(formatRemaining(-1), "0:00");
  assert.equal(formatRemaining(NaN), "0:00");
  assert.equal(formatRemaining(3_600_000), "60:00");
});

test("default scheduler works without DOM (Node setTimeout fallback)", async () => {
  let finished = 0;
  const runner = createTimerRunner({ onFinish: () => { finished++; } });
  runner.set(startTimer(Date.now(), 0.3, {}));
  await new Promise((r) => setTimeout(r, 700));
  runner.stop();
  assert.equal(finished, 1);
});
