// State schema: version constant, defaults, and a hand-written structural validator.
// See docs/CONTRACTS.md §3 (shapes) and §5 (API).

export const SCHEMA_VERSION = 1;

const FALLBACK_DEFAULTS = Object.freeze({
  barWeight: 45,
  rest: Object.freeze({ T1: 180, T2: 120, T3: 75, warmup: 60 }),
});

/** Settings built from program.json `defaults` (falls back to the stock values). */
export function defaultSettings(programDefaults = {}) {
  const d = programDefaults || {};
  const rest = { ...FALLBACK_DEFAULTS.rest, ...(isPlainObject(d.rest) ? d.rest : {}) };
  return {
    smallIncrements: false,
    smallPlates: false,
    barWeight: isNum(d.barWeight) ? d.barWeight : FALLBACK_DEFAULTS.barWeight,
    rest: { T1: rest.T1, T2: rest.T2, T3: rest.T3, warmup: rest.warmup },
    warmupStartsTimer: false,
    sound: true,
    vibration: true,
  };
}

/** A fresh, empty State. The app calls ensureLifts afterwards. */
export function defaultState(programDefaults = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    program: { substitutions: {}, customExercises: {} },
    lifts: {},
    rotationIndex: 0,
    workouts: [],
    inProgress: null,
    timer: null,
    pendingDecisions: [],
    settings: defaultSettings(programDefaults),
  };
}

// ---------------------------------------------------------------- validator

const TIERS = ["T1", "T2", "T3"];
const EXERCISE_TYPES = ["barbell", "machine", "bodyweight"];
const EVENT_TYPES = ["progress", "stage", "reset", "override", "init"];
const CHANGE_KINDS = ["increase", "stage", "same", "repTarget", "pending", "reset"];
const TIMER_KINDS = ["working", "warmup"];
const DECISION_TYPES = ["t1-reset", "t2-reset"];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isInt(v) {
  return Number.isInteger(v);
}

/** Small collector that records "path message" strings. */
function makeChecker(errors) {
  const fail = (path, msg) => errors.push(`${path} ${msg}`);
  const c = {
    fail,
    object(v, path) {
      if (!isPlainObject(v)) { fail(path, "must be an object"); return false; }
      return true;
    },
    array(v, path) {
      if (!Array.isArray(v)) { fail(path, "must be an array"); return false; }
      return true;
    },
    number(v, path) { if (!isNum(v)) fail(path, "must be a number"); },
    numberOrNull(v, path) { if (v !== null && !isNum(v)) fail(path, "must be a number or null"); },
    /** Optional field: undefined allowed, otherwise number or null. */
    optNumberOrNull(v, path) { if (v !== undefined) c.numberOrNull(v, path); },
    int(v, path, min = -Infinity) {
      if (!isInt(v) || v < min) fail(path, min === -Infinity ? "must be an integer" : `must be an integer >= ${min}`);
    },
    intOrNull(v, path, min = -Infinity) {
      if (v !== null && (!isInt(v) || v < min)) fail(path, `must be an integer${min === -Infinity ? "" : ` >= ${min}`} or null`);
    },
    string(v, path) { if (typeof v !== "string") fail(path, "must be a string"); },
    nonEmptyString(v, path) { if (typeof v !== "string" || v === "") fail(path, "must be a non-empty string"); },
    stringOrNull(v, path) { if (v !== null && typeof v !== "string") fail(path, "must be a string or null"); },
    optStringOrNull(v, path) { if (v !== undefined) c.stringOrNull(v, path); },
    boolean(v, path) { if (typeof v !== "boolean") fail(path, "must be a boolean"); },
    oneOf(v, allowed, path) {
      if (!allowed.includes(v)) fail(path, `must be one of ${allowed.map((a) => JSON.stringify(a)).join(", ")}`);
    },
  };
  return c;
}

function key(path, k) {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
}

function checkSettings(c, s, path) {
  if (!c.object(s, path)) return;
  c.boolean(s.smallIncrements, `${path}.smallIncrements`);
  c.boolean(s.smallPlates, `${path}.smallPlates`);
  if (!isNum(s.barWeight) || s.barWeight < 0) c.fail(`${path}.barWeight`, "must be a number >= 0");
  if (c.object(s.rest, `${path}.rest`)) {
    for (const k of ["T1", "T2", "T3", "warmup"]) {
      if (!isNum(s.rest[k]) || s.rest[k] < 0) c.fail(`${path}.rest.${k}`, "must be a number >= 0");
    }
  }
  c.boolean(s.warmupStartsTimer, `${path}.warmupStartsTimer`);
  c.boolean(s.sound, `${path}.sound`);
  c.boolean(s.vibration, `${path}.vibration`);
}

function checkExercise(c, ex, path) {
  if (!c.object(ex, path)) return;
  c.nonEmptyString(ex.id, `${path}.id`);
  c.string(ex.name, `${path}.name`);
  c.oneOf(ex.type, EXERCISE_TYPES, `${path}.type`);
  if (ex.startingWeight !== undefined && c.object(ex.startingWeight, `${path}.startingWeight`)) {
    for (const [t, w] of Object.entries(ex.startingWeight)) c.numberOrNull(w, key(`${path}.startingWeight`, t));
  }
  if (ex.increment !== undefined) c.number(ex.increment, `${path}.increment`);
  c.optNumberOrNull(ex.smallIncrement, `${path}.smallIncrement`);
}

function checkProgram(c, p, path) {
  if (!c.object(p, path)) return;
  if (c.object(p.substitutions, `${path}.substitutions`)) {
    for (const [k, v] of Object.entries(p.substitutions)) {
      const kp = key(`${path}.substitutions`, k);
      if (!/^[^:]+:\d+$/.test(k)) c.fail(kp, 'key must look like "dayId:slotIndex"');
      c.nonEmptyString(v, kp);
    }
  }
  if (c.object(p.customExercises, `${path}.customExercises`)) {
    for (const [id, ex] of Object.entries(p.customExercises)) {
      const ep = key(`${path}.customExercises`, id);
      checkExercise(c, ex, ep);
      if (isPlainObject(ex) && typeof ex.id === "string" && ex.id !== id) c.fail(`${ep}.id`, `must match its key "${id}"`);
    }
  }
}

function checkLiftSnapshot(c, v, path) {
  // Event.from / Event.to: { weight, stage, stageStartWeight, repTarget } — be lenient on missing keys.
  if (!c.object(v, path)) return;
  c.optNumberOrNull(v.weight, `${path}.weight`);
  c.optNumberOrNull(v.stage, `${path}.stage`);
  c.optNumberOrNull(v.stageStartWeight, `${path}.stageStartWeight`);
  c.optNumberOrNull(v.repTarget, `${path}.repTarget`);
}

function checkEvent(c, e, path) {
  if (!c.object(e, path)) return;
  c.number(e.at, `${path}.at`);
  c.oneOf(e.type, EVENT_TYPES, `${path}.type`);
  c.optStringOrNull(e.workoutId, `${path}.workoutId`);
  if (e.from !== undefined && e.from !== null) checkLiftSnapshot(c, e.from, `${path}.from`);
  if (e.to !== undefined && e.to !== null) checkLiftSnapshot(c, e.to, `${path}.to`);
  c.optStringOrNull(e.reason, `${path}.reason`);
  if (e.detail !== undefined && e.detail !== null && typeof e.detail !== "object") {
    c.fail(`${path}.detail`, "must be an object or null");
  }
}

function checkLiftState(c, l, path) {
  if (!c.object(l, path)) return;
  c.numberOrNull(l.weight, `${path}.weight`);
  c.int(l.stage, `${path}.stage`, 1);
  c.numberOrNull(l.stageStartWeight, `${path}.stageStartWeight`);
  c.numberOrNull(l.repTarget, `${path}.repTarget`);
  if (c.array(l.history, `${path}.history`)) {
    l.history.forEach((e, i) => checkEvent(c, e, `${path}.history[${i}]`));
  }
}

function checkLifts(c, lifts, path) {
  if (!c.object(lifts, path)) return;
  for (const [exId, byTier] of Object.entries(lifts)) {
    const ep = key(path, exId);
    if (!c.object(byTier, ep)) continue;
    for (const [tier, ls] of Object.entries(byTier)) {
      const tp = key(ep, tier);
      if (!TIERS.includes(tier)) c.fail(tp, 'tier key must be "T1", "T2" or "T3"');
      checkLiftState(c, ls, tp);
    }
  }
}

function checkSet(c, s, path) {
  if (!c.object(s, path)) return;
  c.number(s.target, `${path}.target`);
  c.numberOrNull(s.reps, `${path}.reps`);
  c.boolean(s.amrap, `${path}.amrap`);
  c.boolean(s.done, `${path}.done`);
}

function checkWarmup(c, w, path) {
  if (!c.object(w, path)) return;
  c.number(w.weight, `${path}.weight`);
  c.number(w.reps, `${path}.reps`);
  c.number(w.pct, `${path}.pct`);
  c.boolean(w.done, `${path}.done`);
}

function checkSlot(c, s, path) {
  if (!c.object(s, path)) return;
  c.int(s.slotIndex, `${path}.slotIndex`, 0);
  c.string(s.label, `${path}.label`);
  c.nonEmptyString(s.exerciseId, `${path}.exerciseId`);
  c.optStringOrNull(s.originalExerciseId, `${path}.originalExerciseId`);
  c.oneOf(s.tier, TIERS, `${path}.tier`);
  c.int(s.stage, `${path}.stage`, 1);
  c.numberOrNull(s.weight, `${path}.weight`);
  c.optNumberOrNull(s.repTarget, `${path}.repTarget`);
  c.string(s.scheme, `${path}.scheme`);
  if (c.array(s.sets, `${path}.sets`)) s.sets.forEach((x, i) => checkSet(c, x, `${path}.sets[${i}]`));
  c.optNumberOrNull(s.requestedWeight, `${path}.requestedWeight`);
  if (c.array(s.warmups, `${path}.warmups`)) {
    s.warmups.forEach((x, i) => checkWarmup(c, x, `${path}.warmups[${i}]`));
  }
}

function checkChangeEnd(c, v, path) {
  if (!c.object(v, path)) return;
  c.optNumberOrNull(v.weight, `${path}.weight`);
  c.optNumberOrNull(v.stage, `${path}.stage`);
  c.optNumberOrNull(v.repTarget, `${path}.repTarget`);
}

function checkChange(c, ch, path) {
  if (!c.object(ch, path)) return;
  c.int(ch.slotIndex, `${path}.slotIndex`, 0);
  c.nonEmptyString(ch.exerciseId, `${path}.exerciseId`);
  c.string(ch.tier, `${path}.tier`);
  if (ch.name !== undefined) c.string(ch.name, `${path}.name`);
  c.boolean(ch.success, `${path}.success`);
  c.oneOf(ch.kind, CHANGE_KINDS, `${path}.kind`);
  checkChangeEnd(c, ch.from, `${path}.from`);
  if (ch.to !== null) checkChangeEnd(c, ch.to, `${path}.to`);
  c.string(ch.message, `${path}.message`);
}

function checkWorkout(c, w, path) {
  if (!c.object(w, path)) return;
  c.nonEmptyString(w.id, `${path}.id`);
  c.nonEmptyString(w.dayId, `${path}.dayId`);
  c.number(w.startedAt, `${path}.startedAt`);
  c.numberOrNull(w.finishedAt, `${path}.finishedAt`);
  if (c.array(w.slots, `${path}.slots`)) w.slots.forEach((s, i) => checkSlot(c, s, `${path}.slots[${i}]`));
  if (w.changes !== undefined && w.changes !== null && c.array(w.changes, `${path}.changes`)) {
    w.changes.forEach((ch, i) => checkChange(c, ch, `${path}.changes[${i}]`));
  }
  if (w.snapshotBefore !== undefined && w.snapshotBefore !== null && c.object(w.snapshotBefore, `${path}.snapshotBefore`)) {
    checkLifts(c, w.snapshotBefore.lifts, `${path}.snapshotBefore.lifts`);
    c.int(w.snapshotBefore.rotationIndex, `${path}.snapshotBefore.rotationIndex`, 0);
  }
}

function checkTimer(c, t, path) {
  if (!c.object(t, path)) return;
  c.number(t.endsAt, `${path}.endsAt`);
  if (!isNum(t.durationSec) || t.durationSec < 0) c.fail(`${path}.durationSec`, "must be a number >= 0");
  c.optStringOrNull(t.exerciseId, `${path}.exerciseId`);
  if (t.slotIndex !== undefined) c.intOrNull(t.slotIndex, `${path}.slotIndex`, 0);
  if (t.setIndex !== undefined) c.intOrNull(t.setIndex, `${path}.setIndex`, 0);
  c.oneOf(t.kind, TIMER_KINDS, `${path}.kind`);
  c.optStringOrNull(t.nextLabel, `${path}.nextLabel`);
}

function checkDecision(c, d, path) {
  if (!c.object(d, path)) return;
  c.nonEmptyString(d.id, `${path}.id`);
  c.oneOf(d.type, DECISION_TYPES, `${path}.type`);
  c.nonEmptyString(d.workoutId, `${path}.workoutId`);
  c.nonEmptyString(d.exerciseId, `${path}.exerciseId`);
  c.oneOf(d.tier, ["T1", "T2"], `${path}.tier`);
  if (d.name !== undefined) c.string(d.name, `${path}.name`);
  // suggestion shapes differ (T1Suggestion / T2Suggestion); only require an object.
  c.object(d.suggestion, `${path}.suggestion`);
  if (c.object(d.context, `${path}.context`)) {
    c.numberOrNull(d.context.currentWeight, `${path}.context.currentWeight`);
    c.optNumberOrNull(d.context.stageStartWeight, `${path}.context.stageStartWeight`);
  }
}

/**
 * Structural validation of a full (current-version) State.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateState(obj) {
  const errors = [];
  const c = makeChecker(errors);
  if (!isPlainObject(obj)) return { ok: false, errors: ["state must be an object"] };

  if (obj.schemaVersion !== SCHEMA_VERSION) {
    c.fail("schemaVersion", `must be ${SCHEMA_VERSION}`);
  }
  checkProgram(c, obj.program, "program");
  checkLifts(c, obj.lifts, "lifts");
  c.int(obj.rotationIndex, "rotationIndex", 0);
  if (c.array(obj.workouts, "workouts")) {
    obj.workouts.forEach((w, i) => checkWorkout(c, w, `workouts[${i}]`));
  }
  if (obj.inProgress === undefined) c.fail("inProgress", "must be an object or null");
  else if (obj.inProgress !== null) checkWorkout(c, obj.inProgress, "inProgress");
  if (obj.timer === undefined) c.fail("timer", "must be an object or null");
  else if (obj.timer !== null) checkTimer(c, obj.timer, "timer");
  if (c.array(obj.pendingDecisions, "pendingDecisions")) {
    obj.pendingDecisions.forEach((d, i) => checkDecision(c, d, `pendingDecisions[${i}]`));
  }
  checkSettings(c, obj.settings, "settings");

  return { ok: errors.length === 0, errors };
}
