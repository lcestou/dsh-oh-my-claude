// The card's rules without a DOM: a clean first pass and a cancel show nothing, a run left
// mid-state after its turn ended shows nothing, and only a pass gets the success colour.
import { strict as assert } from "node:assert";
import { T } from "./shared.js";
import type { TestGateRun } from "../test-gate.js";
import { cardLine, dotColour } from "./test-gate-card.js";

const run = (state: TestGateRun["state"], attempt = 0): TestGateRun => ({
  state,
  attempt,
  tries: 3,
  command: "x",
  startedAt: 1,
  tail: "",
});

assert.equal(cardLine(run("passed"), false), null, "a clean first pass shows no card");

assert.equal(cardLine(run("passed", 1), false), "Tests pass after 1 fix.");

assert.equal(cardLine(run("stopped"), false), null);

assert.equal(cardLine(run("fixing", 1), false), null, "the turn ended under a fix: no card");

assert.equal(cardLine(run("fixing", 1), true), "Tests failed. Claude is fixing them (1/3).");

assert.equal(cardLine(run("running"), false), null);

assert.equal(cardLine({ ...run("gave-up", 3), dismissed: true }, false), null);

assert.deepEqual((["held", "timed-out", "running", "passed", "gave-up"] as const).map(dotColour), [
  T.muted,
  T.muted,
  T.muted,
  T.ok,
  T.err,
]);

console.log("test-gate card ok");
