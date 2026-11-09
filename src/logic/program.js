// Program definition: validation, loading, and merging user modifications. Pure (loadProgram takes fetchFn).

const TYPES = ["barbell", "machine", "bodyweight"];
const RESET_TYPES = ["t1-reset", "t2-reset"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPosInt = (v) => Number.isInteger(v) && v > 0;

function validateTier(key, t, errors) {
  const p = `tiers.${key}`;
  if (!isObj(t)) return errors.push(`${p} must be an object`);
  if (!Array.isArray(t.stages) || t.stages.length === 0) {
    errors.push(`${p}.stages must be a non-empty array`);
  } else {
    t.stages.forEach((s, i) => {
      if (!isObj(s) || !isPosInt(s.sets) || !isPosInt(s.reps) || typeof s.amrap !== "boolean") {
        errors.push(`${p}.stages[${i}] needs integer sets, reps > 0 and boolean amrap`);
      }
    });
  }
  if (t.reset !== undefined) {
    const r = t.reset;
    if (!isObj(r) || !RESET_TYPES.includes(r.type)) {
      errors.push(`${p}.reset.type must be one of ${RESET_TYPES.join(", ")}`);
    } else if (r.type === "t1-reset") {
      if (!isNum(r.percentOf5RM) || r.percentOf5RM <= 0 || r.percentOf5RM > 1) errors.push(`${p}.reset.percentOf5RM must be in (0, 1]`);
      if (!isPosInt(r.lookbackWorkouts)) errors.push(`${p}.reset.lookbackWorkouts must be a positive integer`);
    } else {
      if (!isNum(r.addMin) || !isNum(r.addMax) || r.addMax < r.addMin) errors.push(`${p}.reset needs numeric addMin <= addMax`);
    }
  }
  if (t.weighted !== undefined && (!isObj(t.weighted) || !isPosInt(t.weighted.amrapThreshold))) {
    errors.push(`${p}.weighted.amrapThreshold must be a positive integer`);
  }
  if (t.bodyweight !== undefined) {
    const b = t.bodyweight;
    if (!isObj(b) || !isPosInt(b.sets) || !isNum(b.amrapBonus) || !isNum(b.repTargetIncrement)) {
      errors.push(`${p}.bodyweight needs integer sets and numeric amrapBonus, repTargetIncrement`);
    }
  }
}

function validateExercise(id, ex, tiers, errors) {
  const p = `exercises.${id}`;
  if (!isObj(ex)) return errors.push(`${p} must be an object`);
  if (ex.id !== id) errors.push(`${p}.id must equal "${id}"`);
  if (typeof ex.name !== "string" || !ex.name.trim()) errors.push(`${p}.name must be a non-empty string`);
  if (!TYPES.includes(ex.type)) errors.push(`${p}.type must be one of ${TYPES.join(", ")}`);
  if (!isObj(ex.startingWeight)) {
    errors.push(`${p}.startingWeight must be an object`);
  } else {
    for (const [tier, w] of Object.entries(ex.startingWeight)) {
      if (!(tier in tiers)) errors.push(`${p}.startingWeight.${tier} is not a known tier`);
      if (w !== null && !(isNum(w) && w >= 0)) errors.push(`${p}.startingWeight.${tier} must be a number >= 0 or null`);
    }
  }
  if (!isNum(ex.increment) || ex.increment < 0) errors.push(`${p}.increment must be a number >= 0`);
  if (ex.smallIncrement != null && !(isNum(ex.smallIncrement) && ex.smallIncrement > 0)) errors.push(`${p}.smallIncrement must be a positive number or null`);
  if (typeof ex.warmup !== "boolean") errors.push(`${p}.warmup must be boolean`);
  if (typeof ex.plates !== "boolean") errors.push(`${p}.plates must be boolean`);
  if (ex.type === "bodyweight" && !isPosInt(ex.startingRepTarget)) errors.push(`${p}.startingRepTarget must be a positive integer for bodyweight exercises`);
}

function validateDefaults(d, errors) {
  if (!isObj(d)) return errors.push("defaults must be an object");
  if (!isNum(d.barWeight) || d.barWeight <= 0) errors.push("defaults.barWeight must be a positive number");
  if (!Array.isArray(d.plates) || d.plates.length === 0 || !d.plates.every((x) => isNum(x) && x > 0)) errors.push("defaults.plates must be a non-empty array of positive numbers");
  if (d.smallPlates !== undefined && !(Array.isArray(d.smallPlates) && d.smallPlates.every((x) => isNum(x) && x > 0))) errors.push("defaults.smallPlates must be an array of positive numbers");
  if (!isObj(d.rest) || !Object.values(d.rest).every((x) => isNum(x) && x >= 0)) errors.push("defaults.rest must map to numbers of seconds");
  if (!Array.isArray(d.warmup) || !d.warmup.every((w) => isObj(w) && isNum(w.pct) && w.pct >= 0 && w.pct < 1 && isPosInt(w.reps))) errors.push("defaults.warmup must be an array of { pct in [0,1), reps > 0 }");
}

export function validateProgram(json) {
  const errors = [];
  if (!isObj(json)) return { ok: false, errors: ["program must be an object"] };
  if (!isPosInt(json.version)) errors.push("version must be a positive integer");
  const tiers = isObj(json.tiers) ? json.tiers : {};
  if (!isObj(json.tiers) || Object.keys(tiers).length === 0) errors.push("tiers must be a non-empty object");
  for (const [k, t] of Object.entries(tiers)) validateTier(k, t, errors);
  const exercises = isObj(json.exercises) ? json.exercises : {};
  if (!isObj(json.exercises)) errors.push("exercises must be an object");
  for (const [id, ex] of Object.entries(exercises)) validateExercise(id, ex, tiers, errors);
  const days = isObj(json.days) ? json.days : {};
  if (!isObj(json.days)) errors.push("days must be an object");
  for (const [dayId, day] of Object.entries(days)) {
    if (!isObj(day) || !Array.isArray(day.slots) || day.slots.length === 0) {
      errors.push(`days.${dayId}.slots must be a non-empty array`);
      continue;
    }
    day.slots.forEach((s, i) => {
      const p = `days.${dayId}.slots[${i}]`;
      if (!isObj(s)) return errors.push(`${p} must be an object`);
      if (!(s.exerciseId in exercises)) errors.push(`${p}.exerciseId "${s.exerciseId}" is not a defined exercise`);
      if (!(s.tier in tiers)) errors.push(`${p}.tier "${s.tier}" is not a defined tier`);
    });
  }
  if (!Array.isArray(json.rotation) || json.rotation.length === 0) {
    errors.push("rotation must be a non-empty array of day ids");
  } else {
    json.rotation.forEach((d) => {
      if (!(d in days)) errors.push(`rotation day "${d}" is not defined in days`);
    });
  }
  const hasBodyweightRule = Object.values(tiers).some((t) => isObj(t?.bodyweight));
  if (!hasBodyweightRule && Object.values(exercises).some((e) => e?.type === "bodyweight")) {
    errors.push("a bodyweight exercise exists but no tier defines a bodyweight rule");
  }
  validateDefaults(json.defaults, errors);
  return { ok: errors.length === 0, errors };
}

export async function loadProgram(url, fetchFn = globalThis.fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load program (HTTP ${res.status})`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error("program.json is not valid JSON");
  }
  const { ok, errors } = validateProgram(json);
  if (!ok) throw new Error(`Invalid program.json: ${errors.join("; ")}`);
  return json;
}

export function effectiveProgram(baseProgram, stateProgram) {
  const program = structuredClone(baseProgram);
  const custom = stateProgram?.customExercises ?? {};
  program.exercises = { ...program.exercises, ...structuredClone(custom) };
  const subs = stateProgram?.substitutions ?? {};
  for (const [dayId, day] of Object.entries(program.days)) {
    day.slots.forEach((slot, i) => {
      slot.originalExerciseId = slot.exerciseId;
      const sub = subs[`${dayId}:${i}`];
      if (sub && sub in program.exercises) slot.exerciseId = sub;
    });
  }
  return program;
}

export function getDay(program, dayId) {
  const day = program.days[dayId];
  if (!day) throw new Error(`Unknown day "${dayId}"`);
  return day;
}

export function getExercise(program, exerciseId) {
  const ex = program.exercises[exerciseId];
  if (!ex) throw new Error(`Unknown exercise "${exerciseId}"`);
  return ex;
}

export function listSlots(program) {
  const out = [];
  for (const [dayId, day] of Object.entries(program.days)) {
    day.slots.forEach((s, slotIndex) => {
      out.push({
        dayId,
        slotIndex,
        exerciseId: s.exerciseId,
        tier: s.tier,
        label: s.label ?? s.tier,
        originalExerciseId: s.originalExerciseId ?? s.exerciseId,
      });
    });
  }
  return out;
}
