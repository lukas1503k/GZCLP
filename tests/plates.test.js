import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  plateConfig, loadStep, roundToLoadable, isLoadable, platesPerSide, formatPlates, plateBreakdown,
} from "../src/logic/plates.js";

const program = JSON.parse(readFileSync(new URL("../program.json", import.meta.url), "utf8"));
// SPEC §5 vectors are defined for the spec's plate set (no 15s), so most tests pin it explicitly.
const SPEC_PLATES = { defaults: { ...program.defaults, plates: [45, 35, 25, 10, 5, 2.5] } };
const cfg = plateConfig(SPEC_PLATES, { barWeight: 45, smallPlates: false });
const smallCfg = plateConfig(SPEC_PLATES, { barWeight: 45, smallPlates: true });
// The shipped program.json reflects the gym's actual plates (includes 15s).
const gymCfg = plateConfig(program, { barWeight: 45, smallPlates: false });
const per = (w, c = cfg) => formatPlates(platesPerSide(w, c));

test("plateConfig reads bar and plates from program/settings", () => {
  assert.deepEqual(cfg, { barWeight: 45, plates: [45, 35, 25, 10, 5, 2.5] });
  assert.deepEqual(smallCfg.plates, [45, 35, 25, 10, 5, 2.5, 1.25]);
  assert.equal(plateConfig(program, {}).barWeight, 45);
  assert.equal(plateConfig(program, undefined).barWeight, 45);
  assert.equal(plateConfig(program, { barWeight: 35 }).barWeight, 35);
});

test("shipped program.json includes 15 lb plates", () => {
  assert.deepEqual(gymCfg.plates, [45, 35, 25, 15, 10, 5, 2.5]);
  assert.deepEqual(plateConfig(program, { smallPlates: true }).plates, [45, 35, 25, 15, 10, 5, 2.5, 1.25]);
});

const GYM_VECTORS = [
  [45, "bar"],
  [75, "15"],
  [100, "25 + 2.5"],
  [105, "25 + 5"],
  [115, "35"],
  [125, "35 + 5"],
  [110, "25 + 5 + 2.5"],
  [165, "45 + 15"],
  [245, "45 + 45 + 10"],
  [270, "45 + 45 + 15 + 5 + 2.5"],
];
for (const [w, text] of GYM_VECTORS) {
  test(`gym plates (with 15s): ${w} lb -> ${text}`, () => assert.equal(per(w, gymCfg), text));
}

test("loadStep is 2x smallest plate", () => {
  assert.equal(loadStep(cfg), 5);
  assert.equal(loadStep(smallCfg), 2.5);
});

const VECTORS = [
  [45, "bar"],
  [75, "10 + 5"],
  [100, "25 + 2.5"],
  [110, "25 + 5 + 2.5"],
  [135, "45"],
  [145, "45 + 5"],
  [185, "45 + 25"],
  [205, "45 + 35"],
  [245, "45 + 45 + 10"],
  [270, "45 + 45 + 10 + 10 + 2.5"],
];
for (const [w, text] of VECTORS) {
  test(`SPEC §5 vector: ${w} lb -> ${text}`, () => {
    assert.equal(per(w), text);
    assert.equal(isLoadable(w, cfg), true);
  });
}

test("platesPerSide returns arrays; [] for bar only", () => {
  assert.deepEqual(platesPerSide(45, cfg), []);
  assert.deepEqual(platesPerSide(270, cfg), [45, 45, 10, 10, 2.5]);
});

test("formatPlates", () => {
  assert.equal(formatPlates([]), "bar");
  assert.equal(formatPlates([45, 25, 5]), "45 + 25 + 5");
  assert.equal(formatPlates([2.5, 1.25]), "2.5 + 1.25");
});

test("roundToLoadable: nearest, ties round down, below bar -> bar", () => {
  assert.equal(roundToLoadable(47.5, cfg), 45);
  assert.equal(roundToLoadable(102.5, cfg), 100);
  assert.equal(roundToLoadable(103, cfg), 105);
  assert.equal(roundToLoadable(102, cfg), 100);
  assert.equal(roundToLoadable(98, cfg), 100);
  assert.equal(roundToLoadable(245, cfg), 245);
  assert.equal(roundToLoadable(30, cfg), 45);
  assert.equal(roundToLoadable(0, cfg), 45);
  assert.equal(roundToLoadable(45, cfg), 45);
  assert.equal(roundToLoadable(null, cfg), null);
});

test("small plates make 2.5 lb steps loadable", () => {
  assert.equal(isLoadable(102.5, cfg), false);
  assert.equal(isLoadable(102.5, smallCfg), true);
  assert.equal(roundToLoadable(102.5, smallCfg), 102.5);
  assert.deepEqual(platesPerSide(102.5, smallCfg), [25, 2.5, 1.25]);
  assert.equal(per(102.5, smallCfg), "25 + 2.5 + 1.25");
  assert.equal(per(147.5, smallCfg), "45 + 5 + 1.25");
  // ties with small plates also round down: 103.75 is halfway between 102.5 and 105
  assert.equal(roundToLoadable(103.75, smallCfg), 102.5);
});

test("disabling small plates re-rounds", () => {
  assert.equal(roundToLoadable(147.5, smallCfg), 147.5);
  assert.equal(roundToLoadable(147.5, cfg), 145);
  assert.equal(per(147.5, cfg), "45 + 5");
});

test("isLoadable rejects off-step, below-bar and null", () => {
  assert.equal(isLoadable(47.5, cfg), false);
  assert.equal(isLoadable(40, cfg), false);
  assert.equal(isLoadable(null, cfg), false);
  assert.equal(isLoadable(45, cfg), true);
});

test("plateBreakdown flags inexact weights", () => {
  assert.deepEqual(plateBreakdown(245, cfg), { requested: 245, loaded: 245, exact: true, plates: [45, 45, 10], text: "45 + 45 + 10" });
  const b = plateBreakdown(102.5, cfg);
  assert.equal(b.exact, false);
  assert.equal(b.loaded, 100);
  assert.equal(b.text, "25 + 2.5");
  assert.equal(plateBreakdown(102.5, smallCfg).exact, true);
  assert.equal(plateBreakdown(30, cfg).exact, false);
  assert.equal(plateBreakdown(30, cfg).text, "bar");
});

test("custom bar weight is respected", () => {
  const c = plateConfig(program, { barWeight: 35 });
  assert.equal(per(135, c), "45 + 5");
  assert.equal(roundToLoadable(20, c), 35);
});
