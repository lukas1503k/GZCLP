// Backup export / import (SPEC §8, CONTRACTS §5).
import { SCHEMA_VERSION, validateState } from "./schema.js";
import { migrate } from "./migrations.js";

const pad = (n) => String(n).padStart(2, "0");

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** "gzclp-backup-YYYY-MM-DD.json" using the LOCAL date of `now` (epoch ms or Date). */
export function backupFilename(now) {
  const d = new Date(now);
  return `gzclp-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export function serializeBackup(state, now) {
  const wrapper = {
    app: "gzclp",
    exportedAt: now,
    schemaVersion: state && state.schemaVersion !== undefined ? state.schemaVersion : SCHEMA_VERSION,
    state,
  };
  return { filename: backupFilename(now), text: JSON.stringify(wrapper, null, 2) };
}

const NOT_GZCLP = "This file isn't a GZCLP backup.";

function looksLikeBareState(o) {
  // Lenient: a bare State must have at least the core collections.
  return isPlainObject(o) && isPlainObject(o.lifts) && Array.isArray(o.workouts) &&
    (isPlainObject(o.settings) || "rotationIndex" in o);
}

function summarize(state) {
  const lifts = [];
  for (const exerciseId of Object.keys(state.lifts).sort()) {
    for (const tier of Object.keys(state.lifts[exerciseId]).sort()) {
      const l = state.lifts[exerciseId][tier];
      lifts.push({ exerciseId, tier, weight: l.weight, stage: l.stage, repTarget: l.repTarget });
    }
  }
  return { schemaVersion: state.schemaVersion, workouts: state.workouts.length, lifts };
}

/**
 * @returns {{ ok: true, state, summary } | { ok: false, error: string }}
 */
export function parseBackup(text) {
  let parsed;
  try {
    if (typeof text !== "string") throw new Error("not text");
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't valid JSON." };
  }
  if (!isPlainObject(parsed)) return { ok: false, error: NOT_GZCLP };

  let raw;
  if ("app" in parsed || "state" in parsed) {
    if (parsed.app !== "gzclp" || !isPlainObject(parsed.state)) return { ok: false, error: NOT_GZCLP };
    raw = parsed.state;
    // If the wrapper declares a version and the inner state lacks one, trust the wrapper.
    if (raw.schemaVersion === undefined && Number.isInteger(parsed.schemaVersion) && parsed.schemaVersion > 0) {
      raw = { ...raw, schemaVersion: parsed.schemaVersion };
    }
    const wrapperVersion = parsed.schemaVersion;
    if (Number.isInteger(wrapperVersion) && wrapperVersion > SCHEMA_VERSION) {
      return { ok: false, error: newerMessage(wrapperVersion) };
    }
  } else if (looksLikeBareState(parsed)) {
    raw = parsed;
  } else {
    return { ok: false, error: NOT_GZCLP };
  }

  if (Number.isInteger(raw.schemaVersion) && raw.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: newerMessage(raw.schemaVersion) };
  }

  let state;
  try {
    state = migrate(raw);
  } catch (e) {
    return { ok: false, error: `This backup couldn't be read: ${e.message}.` };
  }
  const { ok, errors } = validateState(state);
  if (!ok) {
    const shown = errors.slice(0, 5).join("; ");
    const more = errors.length > 5 ? `; and ${errors.length - 5} more` : "";
    return { ok: false, error: `This backup is damaged or incomplete: ${shown}${more}.` };
  }
  return { ok: true, state, summary: summarize(state) };
}

function newerMessage(v) {
  return `This backup was made by a newer version of the app (schema ${v}); this app supports schema ${SCHEMA_VERSION}.`;
}
