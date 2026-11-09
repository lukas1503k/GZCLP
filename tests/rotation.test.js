import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextDayId, advance } from "../src/logic/rotation.js";

const program = JSON.parse(readFileSync(new URL("../program.json", import.meta.url), "utf8"));

test("nextDayId follows program.rotation", () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => nextDayId(program, i)), ["A1", "B1", "A2", "B2"]);
  assert.equal(nextDayId(program, 4), "A1");
});

test("advance wraps B2 -> A1", () => {
  assert.equal(advance(program, 0), 1);
  assert.equal(advance(program, 3), 0);
  assert.equal(nextDayId(program, advance(program, 3)), "A1");
});

test("rotation length is read from the program", () => {
  const p = { ...program, rotation: ["A1", "B1"] };
  assert.equal(advance(p, 1), 0);
});
