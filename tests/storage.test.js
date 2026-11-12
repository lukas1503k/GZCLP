import { test } from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY, createStorage, createMemoryBackend } from "../src/state/storage.js";
import { defaultState } from "../src/state/schema.js";

const DEFAULTS = { barWeight: 45, plates: [45, 35, 25, 10, 5, 2.5], smallPlates: [1.25],
  rest: { T1: 180, T2: 120, T3: 75, warmup: 60 } };

function sampleState() {
  const s = defaultState(DEFAULTS);
  s.lifts = {
    squat: { T1: { weight: 245, stage: 1, stageStartWeight: 245, repTarget: null, history: [] } },
    hanging_leg_raise: { T3: { weight: null, stage: 1, stageStartWeight: null, repTarget: 10, history: [] } },
  };
  s.rotationIndex = 3;
  s.timer = { endsAt: 1_700_000_180_000, durationSec: 180, exerciseId: "squat", slotIndex: 0, setIndex: 0,
    kind: "working", nextLabel: "Squat · set 2 of 5" };
  return s;
}

test("STORAGE_KEY is the fixed namespaced key", () => {
  assert.equal(STORAGE_KEY, "gzclp.state.v1");
});

test("memory backend behaves like localStorage", () => {
  const b = createMemoryBackend();
  assert.equal(b.getItem("x"), null);
  b.setItem("x", 5);
  assert.equal(b.getItem("x"), "5");
  b.removeItem("x");
  assert.equal(b.getItem("x"), null);
});

test("load returns null when nothing is stored", () => {
  const st = createStorage(createMemoryBackend());
  assert.equal(st.load(), null);
  assert.equal(st.raw(), null);
});

test("save/load round-trip", () => {
  const backend = createMemoryBackend();
  const st = createStorage(backend);
  const s = sampleState();
  assert.equal(st.save(s), true);
  assert.equal(typeof backend.getItem(STORAGE_KEY), "string");
  assert.equal(st.raw(), JSON.stringify(s));
  assert.deepEqual(st.load(), s);
  // a second storage instance on the same backend sees it too
  assert.deepEqual(createStorage(backend).load(), s);
});

test("clear removes the saved state", () => {
  const st = createStorage(createMemoryBackend());
  st.save(sampleState());
  st.clear();
  assert.equal(st.load(), null);
});

test("load throws a readable error on corrupt JSON", () => {
  const st = createStorage(createMemoryBackend({ [STORAGE_KEY]: "{oops" }));
  assert.throws(() => st.load(), { message: "Saved data is corrupt (not valid JSON)." });
});

test("load throws on structurally invalid data", () => {
  const bad = { ...sampleState(), rotationIndex: "two" };
  const st = createStorage(createMemoryBackend({ [STORAGE_KEY]: JSON.stringify(bad) }));
  assert.throws(() => st.load(), /Saved data is invalid: .*rotationIndex must be an integer >= 0/);
});

test("load throws on a newer schema version", () => {
  const st = createStorage(createMemoryBackend({ [STORAGE_KEY]: JSON.stringify({ ...sampleState(), schemaVersion: 9 }) }));
  assert.throws(() => st.load(), /newer schema version 9; this app supports 2/);
});

test("load migrates a v0 state", () => {
  const v0 = sampleState();
  delete v0.schemaVersion; delete v0.timer; delete v0.pendingDecisions;
  const st = createStorage(createMemoryBackend({ [STORAGE_KEY]: JSON.stringify(v0) }));
  const s = st.load();
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.timer, null);
  assert.deepEqual(s.pendingDecisions, []);
});

test("save returns false when the backend throws QuotaExceededError", () => {
  const backend = createMemoryBackend();
  backend.setItem = () => {
    const e = new Error("quota"); e.name = "QuotaExceededError"; throw e;
  };
  const st = createStorage(backend);
  assert.equal(st.save(sampleState()), false);
});

test("save returns false for unserializable state", () => {
  const st = createStorage(createMemoryBackend());
  const s = sampleState();
  s.self = s;
  assert.equal(st.save(s), false);
  assert.equal(st.save({ big: 10n }), false);
});
