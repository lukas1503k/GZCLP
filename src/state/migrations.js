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
};

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
  return state;
}
