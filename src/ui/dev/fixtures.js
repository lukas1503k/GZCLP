// Dev-only fixtures: hard-coded fake State objects (CONTRACTS §3) for the preview harness.
// Not shipped (src/ui/dev is excluded from precache).

const DAY = 24 * 60 * 60 * 1000;
export const NOW = Date.UTC(2026, 10, 9, 17, 30); // fixed "today" for reproducible screenshots

const settings = () => ({
  smallIncrements: false, smallPlates: false, barWeight: 45,
  rest: { T1: 180, T2: 120, T3: 75, warmup: 60 },
  warmupStartsTimer: false, sound: true, vibration: true,
});

const lift = (weight, stage = 1, ssw = weight, repTarget = null, history = []) =>
  ({ weight, stage, stageStartWeight: ssw, repTarget, history });

function sets(target, n, amrap, reps = []) {
  return Array.from({ length: n }, (_, i) => {
    const r = reps[i];
    return { target, reps: r ?? null, amrap: amrap && i === n - 1, done: r != null };
  });
}

const T1_STAGES = [[5, 3], [6, 2], [10, 1]];
const T2_STAGES = [[3, 10], [3, 8], [3, 6]];

function t1Slot(exerciseId, weight, stage, reps, warmups = []) {
  const [n, t] = T1_STAGES[stage - 1];
  return { slotIndex: 0, label: "T1", exerciseId, tier: "T1", stage, weight, repTarget: null, scheme: `${n}×${t}`, sets: sets(t, n, true, reps), warmups };
}
function t2Slot(exerciseId, weight, stage, reps) {
  const [n, t] = T2_STAGES[stage - 1];
  return { slotIndex: 1, label: "T2", exerciseId, tier: "T2", stage, weight, repTarget: null, scheme: `${n}×${t}`, sets: sets(t, n, false, reps), warmups: [] };
}
function t3Slot(slotIndex, label, exerciseId, weight, reps) {
  return { slotIndex, label, exerciseId, tier: "T3", stage: 1, weight, repTarget: null, scheme: "3×15", sets: sets(15, 3, true, reps), warmups: [] };
}
function bwSlot(slotIndex, label, exerciseId, target, reps) {
  return { slotIndex, label, exerciseId, tier: "T3", stage: 1, weight: null, repTarget: target, scheme: `3×${target}+`, sets: sets(target, 3, true, reps), warmups: [] };
}
const wu = (weight, reps, pct, done = false) => ({ weight, reps, pct, done });
const squatWarmups = (done = 0) => [wu(45, 10, 0), wu(100, 5, 0.4), wu(145, 3, 0.6), wu(185, 2, 0.75), wu(210, 1, 0.85)]
  .map((w, i) => ({ ...w, done: i < done }));

function change(slot, name, success, kind, message, to) {
  return {
    slotIndex: slot.slotIndex, exerciseId: slot.exerciseId, tier: slot.tier, name, success, kind,
    from: { weight: slot.weight, stage: slot.stage, repTarget: slot.repTarget },
    to: kind === "pending" ? null : to, message,
  };
}

function finished(dayId, startedAt, slots, changes) {
  return { id: `w${startedAt}`, dayId, startedAt, finishedAt: startedAt + 70 * 60 * 1000, slots, changes, snapshotBefore: null };
}

// ---- a realistic 3-week history (oldest first) ----
function historyWorkouts() {
  const t0 = NOW - 20 * DAY;
  const w = [];
  let s;
  // A1
  s = [t1Slot("squat", 245, 1, [3, 3, 3, 3, 6]), t2Slot("bench", 110, 1, [10, 10, 10]), t3Slot(2, "T3a", "lat_pulldown", 100, [15, 15, 22]), bwSlot(3, "T3b", "hanging_leg_raise", 10, [10, 10, 12])];
  w.push(finished("A1", t0, s, [
    change(s[0], "Squat", true, "increase", "Next: 255 lb · stage 1 (5×3)", { weight: 255, stage: 1, repTarget: null }),
    change(s[1], "Bench", true, "increase", "Next: 115 lb · stage 1 (3×10)", { weight: 115, stage: 1, repTarget: null }),
    change(s[2], "Lat pulldown", true, "same", "Next: same weight (100 lb)", { weight: 100, stage: 1, repTarget: null }),
    change(s[3], "Hanging leg raise", true, "same", "Next: same target (3×10+)", { weight: null, stage: 1, repTarget: 10 })]));
  // B1
  s = [t1Slot("ohp", 100, 1, [3, 3, 3, 3, 5]), t2Slot("deadlift", 205, 1, [10, 10, 10]), t3Slot(2, "T3a", "barbell_row", 95, [15, 15, 25]), t3Slot(3, "T3b", "barbell_curl", 50, [15, 15, 18])];
  w.push(finished("B1", t0 + 2 * DAY, s, [
    change(s[0], "Overhead press", true, "increase", "Next: 105 lb · stage 1 (5×3)", { weight: 105, stage: 1, repTarget: null }),
    change(s[1], "Deadlift", true, "increase", "Next: 215 lb · stage 1 (3×10)", { weight: 215, stage: 1, repTarget: null }),
    change(s[2], "Barbell row", true, "increase", "Next: 100 lb (3×15)", { weight: 100, stage: 1, repTarget: null }),
    change(s[3], "Barbell curl", true, "same", "Next: same weight (50 lb)", { weight: 50, stage: 1, repTarget: null })]));
  // A2
  s = [t1Slot("bench", 145, 1, [3, 3, 3, 3, 7]), t2Slot("squat", 185, 1, [10, 10, 10]), t3Slot(2, "T3a", "lat_pulldown", 100, [15, 15, 20]), bwSlot(3, "T3b", "hanging_leg_raise", 10, [10, 10, 15])];
  w.push(finished("A2", t0 + 4 * DAY, s, [
    change(s[0], "Bench", true, "increase", "Next: 150 lb · stage 1 (5×3)", { weight: 150, stage: 1, repTarget: null }),
    change(s[1], "Squat", true, "increase", "Next: 195 lb · stage 1 (3×10)", { weight: 195, stage: 1, repTarget: null }),
    change(s[2], "Lat pulldown", true, "same", "Next: same weight (100 lb)", { weight: 100, stage: 1, repTarget: null }),
    change(s[3], "Hanging leg raise", true, "repTarget", "Next: target 12 reps (3×12+)", { weight: null, stage: 1, repTarget: 12 })]));
  // B2
  s = [t1Slot("deadlift", 270, 1, [3, 3, 3, 3, 8]), t2Slot("ohp", 75, 1, [10, 10, 9]), t3Slot(2, "T3a", "barbell_row", 100, [15, 15, 19]), t3Slot(3, "T3b", "barbell_curl", 50, [15, 15, 20])];
  w.push(finished("B2", t0 + 6 * DAY, s, [
    change(s[0], "Deadlift", true, "increase", "Next: 280 lb · stage 1 (5×3)", { weight: 280, stage: 1, repTarget: null }),
    change(s[1], "Overhead press", false, "stage", "Next: stage 2 (3×8) at 75 lb", { weight: 75, stage: 2, repTarget: null }),
    change(s[2], "Barbell row", true, "same", "Next: same weight (100 lb)", { weight: 100, stage: 1, repTarget: null }),
    change(s[3], "Barbell curl", true, "same", "Next: same weight (50 lb)", { weight: 50, stage: 1, repTarget: null })]));
  // A1
  s = [t1Slot("squat", 255, 1, [3, 3, 3, 3, 5]), t2Slot("bench", 115, 1, [10, 10, 8]), t3Slot(2, "T3a", "lat_pulldown", 100, [15, 15, 25]), bwSlot(3, "T3b", "hanging_leg_raise", 12, [12, 12, 13])];
  w.push(finished("A1", t0 + 8 * DAY, s, [
    change(s[0], "Squat", true, "increase", "Next: 265 lb · stage 1 (5×3)", { weight: 265, stage: 1, repTarget: null }),
    change(s[1], "Bench", false, "stage", "Next: stage 2 (3×8) at 115 lb", { weight: 115, stage: 2, repTarget: null }),
    change(s[2], "Lat pulldown", true, "increase", "Next: 105 lb (3×15)", { weight: 105, stage: 1, repTarget: null }),
    change(s[3], "Hanging leg raise", true, "same", "Next: same target (3×12+)", { weight: null, stage: 1, repTarget: 12 })]));
  // B1
  s = [t1Slot("ohp", 105, 1, [3, 3, 3, 3, 4]), t2Slot("deadlift", 215, 1, [10, 10, 10]), t3Slot(2, "T3a", "barbell_row", 100, [15, 15, 21]), t3Slot(3, "T3b", "barbell_curl", 50, [15, 15, 22])];
  w.push(finished("B1", t0 + 10 * DAY, s, [
    change(s[0], "Overhead press", true, "increase", "Next: 110 lb · stage 1 (5×3)", { weight: 110, stage: 1, repTarget: null }),
    change(s[1], "Deadlift", true, "increase", "Next: 225 lb · stage 1 (3×10)", { weight: 225, stage: 1, repTarget: null }),
    change(s[2], "Barbell row", true, "same", "Next: same weight (100 lb)", { weight: 100, stage: 1, repTarget: null }),
    change(s[3], "Barbell curl", true, "same", "Next: same weight (50 lb)", { weight: 50, stage: 1, repTarget: null })]));
  // A2
  s = [t1Slot("bench", 150, 1, [3, 3, 3, 3, 5]), t2Slot("squat", 195, 1, [10, 10, 10]), t3Slot(2, "T3a", "lat_pulldown", 105, [15, 15, 17]), bwSlot(3, "T3b", "hanging_leg_raise", 12, [12, 12, 14])];
  w.push(finished("A2", t0 + 12 * DAY, s, [
    change(s[0], "Bench", true, "increase", "Next: 155 lb · stage 1 (5×3)", { weight: 155, stage: 1, repTarget: null }),
    change(s[1], "Squat", true, "increase", "Next: 205 lb · stage 1 (3×10)", { weight: 205, stage: 1, repTarget: null }),
    change(s[2], "Lat pulldown", true, "same", "Next: same weight (105 lb)", { weight: 105, stage: 1, repTarget: null }),
    change(s[3], "Hanging leg raise", true, "same", "Next: same target (3×12+)", { weight: null, stage: 1, repTarget: 12 })]));
  // B2
  s = [t1Slot("deadlift", 280, 1, [3, 3, 3, 2, 2]), t2Slot("ohp", 75, 2, [8, 8, 8]), t3Slot(2, "T3a", "barbell_row", 100, [15, 15, 18]), t3Slot(3, "T3b", "barbell_curl", 50, [15, 14, 15])];
  const last = finished("B2", t0 + 14 * DAY, s, [
    change(s[0], "Deadlift", false, "stage", "Next: stage 2 (6×2) at 280 lb", { weight: 280, stage: 2, repTarget: null }),
    change(s[1], "Overhead press", true, "increase", "Next: 80 lb · stage 2 (3×8)", { weight: 80, stage: 2, repTarget: null }),
    change(s[2], "Barbell row", true, "same", "Next: same weight (100 lb)", { weight: 100, stage: 1, repTarget: null }),
    change(s[3], "Barbell curl", false, "same", "Next: same weight (50 lb)", { weight: 50, stage: 1, repTarget: null })]);
  last.snapshotBefore = { lifts: {}, rotationIndex: 3 };
  w.push(last);
  return w;
}

const ev = (daysAgo, type, from, to, reason) => ({
  at: NOW - daysAgo * DAY, type, workoutId: null, reason, detail: null,
  from: { weight: null, stage: 1, stageStartWeight: null, repTarget: null, ...from },
  to: { weight: null, stage: 1, stageStartWeight: null, repTarget: null, ...to },
});

function currentLifts() {
  const benchHistory = [
    ev(19, "override", { weight: 145, stageStartWeight: 145 }, { weight: 140, stageStartWeight: 145 }, "shoulder tweak"),
    ev(17, "override", { weight: 140, stageStartWeight: 145 }, { weight: 145, stageStartWeight: 145 }, "felt fine"),
    ev(15, "override", { weight: 145, stage: 1 }, { weight: 145, stage: 2 }, null),
    ev(13, "override", { weight: 145, stage: 2 }, { weight: 145, stage: 1 }, "misclick"),
    ev(9, "reset", { weight: 175, stage: 3, stageStartWeight: 145 }, { weight: 150, stage: 1, stageStartWeight: 150 }, "tested-5rm"),
    ev(2, "override", { weight: 150, stageStartWeight: 150 }, { weight: 155, stageStartWeight: 145 }, "gym has microplates now"),
  ];
  return {
    squat: { T1: lift(265, 1, 245, null, [ev(3, "override", { weight: 255, stageStartWeight: 245 }, { weight: 265, stageStartWeight: 245 }, "felt easy, jumped 10")]), T2: lift(205, 1, 185) },
    bench: { T1: lift(155, 1, 145, null, benchHistory), T2: lift(115, 2, 110, null, [ev(4, "reset", { weight: 130, stage: 3, stageStartWeight: 100 }, { weight: 115, stage: 1, stageStartWeight: 115 }, "t2-reset")]) },
    ohp: { T1: lift(110, 1, 100), T2: lift(80, 2, 75) },
    deadlift: { T1: lift(280, 2, 270), T2: lift(225, 1, 205) },
    lat_pulldown: { T3: lift(105) },
    barbell_row: { T3: lift(100) },
    barbell_curl: { T3: lift(50) },
    hanging_leg_raise: { T3: lift(null, 1, null, 12) },
  };
}

function base(extra = {}) {
  return {
    schemaVersion: 1,
    program: { substitutions: {}, customExercises: {} },
    lifts: currentLifts(),
    rotationIndex: 0,
    workouts: historyWorkouts(),
    inProgress: null,
    timer: null,
    pendingDecisions: [],
    settings: settings(),
    ...extra,
  };
}

// ---- scenarios ----

function workoutMid() {
  const startedAt = NOW - 25 * 60 * 1000;
  const inProgress = {
    id: `w${startedAt}`, dayId: "A1", startedAt, finishedAt: null, changes: null, snapshotBefore: null,
    slots: [
      t1Slot("squat", 265, 1, [3, 3], squatWarmups(3).map((w, i) => (i === 0 ? w : { ...w, weight: [45, 105, 160, 200, 225][i] }))),
      t2Slot("bench", 115, 2, []),
      t3Slot(2, "T3a", "lat_pulldown", 105, []),
      bwSlot(3, "T3b", "hanging_leg_raise", 12, []),
    ],
  };
  inProgress.slots[1].sets = sets(8, 3, false, []);
  inProgress.slots[1].requestedWeight = 117.5; // not loadable with 2.5s -> shows the ≈ flag
  return base({
    inProgress,
    timer: { endsAt: NOW + 128 * 1000, durationSec: 180, exerciseId: "squat", slotIndex: 0, setIndex: 1, kind: "working", nextLabel: "Squat · set 3 of 5" },
  });
}

function workoutFresh() {
  // B1 with barbell curl never set (weight null) and OHP at stage 2.
  const startedAt = NOW - 2 * 60 * 1000;
  const lifts = currentLifts();
  lifts.barbell_curl.T3 = lift(null);
  lifts.ohp.T1 = lift(110, 2, 100);
  const slots = [
    { ...t1Slot("ohp", 110, 2, [], [wu(45, 10, 0), wu(65, 3, 0.6), wu(85, 2, 0.75), wu(95, 1, 0.85)]) },
    t2Slot("deadlift", 225, 1, []),
    t3Slot(2, "T3a", "barbell_row", 100, []),
    { ...t3Slot(3, "T3b", "barbell_curl", null, []) },
  ];
  return base({
    lifts, rotationIndex: 1,
    workouts: historyWorkouts().slice(0, 4),
    inProgress: { id: `w${startedAt}`, dayId: "B1", startedAt, finishedAt: null, changes: null, snapshotBefore: null, slots },
  });
}

function workoutAllDone() {
  const st = workoutMid();
  const slots = st.inProgress.slots.map((sl) => ({
    ...sl,
    sets: sl.sets.map((x, i) => ({ ...x, done: true, reps: i === sl.sets.length - 1 && x.amrap ? x.target + 2 : x.target })),
    warmups: sl.warmups.map((w) => ({ ...w, done: true })),
  }));
  slots[1].sets[2] = { ...slots[1].sets[2], reps: 6 };
  return { ...st, inProgress: { ...st.inProgress, slots }, timer: null };
}

function summaryPending() {
  const workouts = historyWorkouts();
  const t = NOW - 75 * 60 * 1000;
  const s = [t1Slot("deadlift", 300, 3, [1, 1, 1, 1, 1, 1, 1, 1, 0, 0]), t2Slot("ohp", 90, 3, [6, 5, 4]), t3Slot(2, "T3a", "barbell_row", 105, [15, 15, 26]), t3Slot(3, "T3b", "barbell_curl", 55, [15, 15, 16])];
  const w = finished("B2", t, s, [
    change(s[0], "Deadlift", false, "pending", "Reset decision needed"),
    change(s[1], "Overhead press", false, "pending", "Reset decision needed"),
    change(s[2], "Barbell row", true, "increase", "Next: 110 lb (3×15)", { weight: 110, stage: 1, repTarget: null }),
    change(s[3], "Barbell curl", true, "same", "Next: same weight (55 lb)", { weight: 55, stage: 1, repTarget: null })]);
  w.snapshotBefore = { lifts: {}, rotationIndex: 3 };
  workouts.forEach((x) => { x.snapshotBefore = null; });
  workouts.push(w);
  const pendingDecisions = [
    {
      id: `${w.id}:deadlift:T1`, type: "t1-reset", workoutId: w.id, exerciseId: "deadlift", tier: "T1", name: "Deadlift",
      suggestion: {
        estimated5RM: 278.14, e1RM: 324.5, weight: 235,
        sourceSets: [
          { workoutId: "wA", date: NOW - 12 * DAY, weight: 295, reps: 3, e1RM: 324.5, best: true },
          { workoutId: "wB", date: NOW - 6 * DAY, weight: 300, reps: 2, e1RM: 320, best: false },
          { workoutId: w.id, date: w.finishedAt, weight: 300, reps: 1, e1RM: 310, best: false },
        ],
      },
      context: { currentWeight: 300, stageStartWeight: 270 },
    },
    {
      id: `${w.id}:ohp:T2`, type: "t2-reset", workoutId: w.id, exerciseId: "ohp", tier: "T2", name: "Overhead press",
      suggestion: { weight: 90, min: 90, max: 95 },
      context: { currentWeight: 90, stageStartWeight: 75 },
    },
  ];
  return base({ workouts, pendingDecisions, rotationIndex: 0 });
}

function summaryClean() {
  return base({ rotationIndex: 0 });
}

function empty() {
  return {
    schemaVersion: 1, program: { substitutions: {}, customExercises: {} }, lifts: {}, rotationIndex: 0,
    workouts: [], inProgress: null, timer: null, pendingDecisions: [], settings: settings(),
  };
}

export const SCENARIOS = {
  "workout-mid": { label: "Workout · mid A1 + timer", route: "workout", build: workoutMid },
  "workout-fresh": { label: "Workout · B1 curl needs weight", route: "workout", build: workoutFresh },
  "workout-done": { label: "Workout · all sets done", route: "workout", build: workoutAllDone },
  "summary-pending": { label: "Summary · T1+T2 resets", route: "summary", build: summaryPending },
  "summary-clean": { label: "Summary · no decisions", route: "summary", build: summaryClean },
  "history": { label: "History", route: "history", build: () => base({ rotationIndex: 0 }) },
  "settings": { label: "Settings", route: "settings", build: () => base({ settings: { ...settings(), smallPlates: true } }) },
  "empty": { label: "Empty / first launch", route: "workout", build: empty },
};
