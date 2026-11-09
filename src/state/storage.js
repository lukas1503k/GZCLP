// localStorage-backed persistence of the whole State under one namespaced key.
import { migrate } from "./migrations.js";
import { validateState } from "./schema.js";

export const STORAGE_KEY = "gzclp.state.v1";

/** Minimal localStorage shim (getItem/setItem/removeItem) for tests. */
export function createMemoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

function summarizeErrors(errors, max = 5) {
  const shown = errors.slice(0, max).join("; ");
  return errors.length > max ? `${shown}; and ${errors.length - max} more` : shown;
}

export function createStorage(backend = globalThis.localStorage) {
  function raw() {
    if (!backend) return null;
    try {
      return backend.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  return {
    /** State | null. Throws Error with a readable message on corrupt, invalid or newer data. */
    load() {
      const text = raw();
      if (text === null || text === undefined) return null;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Saved data is corrupt (not valid JSON).");
      }
      let state;
      try {
        state = migrate(parsed);
      } catch (e) {
        throw new Error(`Saved data could not be loaded: ${e.message}.`);
      }
      const { ok, errors } = validateState(state);
      if (!ok) throw new Error(`Saved data is invalid: ${summarizeErrors(errors)}.`);
      return state;
    },
    /** true on success; false on quota or any other error. */
    save(state) {
      if (!backend) return false;
      try {
        backend.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      if (!backend) return;
      try {
        backend.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    },
    raw,
  };
}
