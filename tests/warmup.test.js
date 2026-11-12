import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plateConfig } from "../src/logic/plates.js";
import { warmupSets } from "../src/logic/warmup.js";

const program = JSON.parse(readFileSync(new URL("../program.json", import.meta.url), "utf8"));
const cfg = plateConfig(program, { barWeight: 45 });
const scheme = program.defaults.warmup;
const brief = (ws) => ws.map((w) => `${w.weight}×${w.reps}`);

test("245 -> bar×10, 100×5, 145×3, 185×2, 210×1", () => {
  const ws = warmupSets(245, cfg, scheme);
  assert.deepEqual(brief(ws), ["45×10", "100×5", "145×3", "185×2", "210×1"]);
  assert.deepEqual(ws.map((w) => w.pct), [0, 0.4, 0.6, 0.75, 0.85]);
});

test("light weights drop entries <= bar", () => {
  assert.deepEqual(brief(warmupSets(75, cfg, scheme)), ["45×10", "55×2", "65×1"]);
  assert.deepEqual(brief(warmupSets(95, cfg, scheme)), ["45×10", "55×3", "70×2", "80×1"]);
  assert.deepEqual(brief(warmupSets(100, cfg, scheme)), ["45×10", "60×3", "75×2", "85×1"]);
});

test("duplicates are dropped (first kept)", () => {
  // 60: 0.4 -> 24 (dropped), 0.6 -> 36 (dropped), 0.75 -> 45 (= bar, dropped), 0.85 -> 51 -> 50
  assert.deepEqual(brief(warmupSets(60, cfg, scheme)), ["45×10", "50×1"]);
  const dupScheme = [{ pct: 0, reps: 10 }, { pct: 0.5, reps: 5 }, { pct: 0.51, reps: 3 }];
  assert.deepEqual(brief(warmupSets(200, cfg, dupScheme)), ["45×10", "100×5"]);
});

test("entries >= working weight are dropped; bar-weight work gets no warm-ups", () => {
  assert.deepEqual(warmupSets(45, cfg, scheme), []);
  assert.deepEqual(brief(warmupSets(50, cfg, scheme)), ["45×10"]);
  assert.deepEqual(warmupSets(null, cfg, scheme), []);
});

test("small plates change rounding", () => {
  const small = plateConfig(program, { barWeight: 45, smallPlates: true });
  // 0.4*245 = 98 -> 97.5; 0.6*245 = 147 -> 147.5; 0.75*245 = 183.75 -> 182.5 (tie down); 0.85*245 = 208.25 -> 207.5
  assert.deepEqual(brief(warmupSets(245, small, scheme)), ["45×10", "97.5×5", "147.5×3", "182.5×2", "207.5×1"]);
});

test("non-plate exercises skip the bar set and round to 5 lb", () => {
  assert.deepEqual(brief(warmupSets(100, cfg, scheme, { plates: false })), ["40×5", "60×3", "75×2", "85×1"]);
  assert.deepEqual(brief(warmupSets(10, cfg, scheme, { plates: false })), ["5×5"]);
});
