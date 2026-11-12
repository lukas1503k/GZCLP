// Schema migrations. migrations[N] upgrades a state at version N to version N + 1.
import { SCHEMA_VERSION, defaultSettings } from "./schema.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export const migrations = {
  // v0 (pre-release): no schemaVersion, no pendingDecisions/timer. Fill every missing top-level default.
  0(state) {
    const s = { ...state };
    const program = isPlainObject(s.program) ? { ...s.program } : {};
    if (!isPlainObject(program.substitutions)) program.substitutions = {};
    if (!isPlainObject(program.customExercises)) program.customExercises = {};
    s.program = program;
    if (!isPlainObject(s.lifts)) s.lifts = {};
    if (s.rotationIndex === undefined) s.rotationIndex = 0;
    if (!Array.isArray(s.workouts)) s.workouts = [];
    if (s.inProgress === undefined) s.inProgress = null;
    if (s.timer === undefined) s.timer = null;
    if (!Array.isArray(s.pendingDecisions)) s.pendingDecisions = [];
    const defaults = defaultSettings();
    const settings = isPlainObject(s.settings) ? s.settings : {};
    s.settings = {
      ...defaults,
      ...settings,
      rest: { ...defaults.rest, ...(isPlainObject(settings.rest) ? settings.rest : {}) },
    };
    s.schemaVersion = 1;
    return s;
  },

  // v1 -> v2: program.json inserted a Romanian deadlift slot at index 2 of A1 and A2
  // (after T2, before the other T3s). Slots are addressed by "dayId:slotIndex", so shift
  // substitutions and any in-progress A-day workout that still has the old layout.
  1(state) {
    const s = { ...state };
    const shift = (dayId, i) => (V2_INSERTED[dayId] != null && i >= V2_INSERTED[dayId] ? i + 1 : i);
    if (isPlainObject(s.program?.substitutions)) {
      const subs = {};
      for (const [k, v] of Object.entries(s.program.substitutions)) {
        const m = /^([^:]+):(\d+)$/.exec(k);
        subs[m ? `${m[1]}:${shift(m[1], Number(m[2]))}` : k] = v;
      }
      s.program = { ...s.program, substitutions: subs };
    }
    const w = s.inProgress;
    if (isPlainObject(w) && V2_INSERTED[w.dayId] != null && Array.isArray(w.slots) && w.slots.length === V2_OLD_SLOT_COUNT) {
      const touched = w.slots.some((sl) => sl?.sets?.some((x) => x?.done) || sl?.warmups?.some((x) => x?.done));
      if (!touched) {
        // Nothing logged yet: let the app build it fresh with the new slot.
        s.inProgress = null;
        s.timer = null;
      } else {
        s.inProgress = { ...w, slots: w.slots.map((sl) => (isPlainObject(sl) ? { ...sl, slotIndex: shift(w.dayId, sl.slotIndex) } : sl)) };
        if (isPlainObject(s.timer) && Number.isInteger(s.timer.slotIndex)) s.timer = { ...s.timer, slotIndex: shift(w.dayId, s.timer.slotIndex) };
      }
    }
    s.schemaVersion = 2;
    return s;
  },
};

const V2_INSERTED = { A1: 2, A2: 2 };
const V2_OLD_SLOT_COUNT = 4;

/**
 * Upgrade a raw (parsed) state object to SCHEMA_VERSION. Never mutates `raw`.
 * Missing schemaVersion = 0. Throws on newer or invalid versions.
 */
export function migrate(raw) {
  if (!isPlainObject(raw)) throw new Error("state must be an object");
  let version = raw.schemaVersion === undefined ? 0 : raw.schemaVersion;
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`invalid schema version ${JSON.stringify(raw.schemaVersion)}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`newer schema version ${version}; this app supports ${SCHEMA_VERSION}`);
  }
  let state = structuredClone(raw);
  while (version < SCHEMA_VERSION) {
    const step = migrations[version];
    if (typeof step !== "function") throw new Error(`no migration from schema version ${version}`);
    state = step(state);
    version += 1;
    state.schemaVersion = version;
  }
  normalize(state);
  return state;
}

// Runs on every migrate (any version) on the already-cloned state: fills optional-but-assumed fields.
function normalize(state) {
  const fixWorkout = (w) => {
    if (!isPlainObject(w) || !Array.isArray(w.slots)) return;
    for (const slot of w.slots) {
      if (isPlainObject(slot) && slot.warmups === undefined) slot.warmups = [];
    }
  };
  if (Array.isArray(state.workouts)) state.workouts.forEach(fixWorkout);
  fixWorkout(state.inProgress);
}
