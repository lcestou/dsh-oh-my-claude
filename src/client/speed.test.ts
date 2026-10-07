import assert from "node:assert/strict";
import { tokensPerSecond, withSpeed } from "./speed.js";

const turn = (output: number, apiMs: number, durationMs: number) => ({ output, apiMs, durationMs });

// 6,000 tokens over 80 s of API time; the turn's wall time is longer because tools ran.
assert.equal(tokensPerSecond([turn(2000, 30_000, 45_000), turn(4000, 50_000, 300_000)]), 75);
// A record that stored the session's whole API time as one turn's: 8,147 s against a 3.9 s turn.
assert.equal(
  tokensPerSecond([turn(2000, 20_000, 25_000), turn(5, 8_147_642, 3906)]),
  100,
  "API time longer than the turn is left out",
);
assert.equal(tokensPerSecond([]), undefined);
assert.equal(tokensPerSecond([turn(100, 0, 500), turn(0, 400, 500)]), undefined);
assert.equal(tokensPerSecond([turn(Number.NaN, Number.NaN, Number.NaN)]), undefined);

assert.equal(withSpeed("486 tok/s", 75.4), "75 tok/s");
assert.equal(
  withSpeed("3 turns · 12 steps · 5199000 tok/s", 9.44),
  "3 turns · 12 steps · 9.4 tok/s",
);
assert.equal(withSpeed("9.4 tok/s", 106), "106 tok/s");
assert.equal(withSpeed("3 turns · 12 steps", 75), "3 turns · 12 steps", "no reading, no change");
assert.equal(withSpeed("75 tok/s", 75), "75 tok/s");
