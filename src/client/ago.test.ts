// Offline self-check: bun src/client/ago.test.ts. Pure clock math, no DOM, no network.
import assert from "node:assert/strict";
import { ago } from "./shared.js";

const now = Date.now();

// A timestamp in the future (clock skew between the box and the CLI's own stamps) must not read as a
// negative or zero age: the clamp floors it at "1 min ago" rather than showing "0 min ago".
assert.equal(ago(now + 60_000), "1 min ago");

// Under an hour rounds to whole minutes. Values are kept off the .5 boundary so half-rounding cannot
// make this flaky as Date.now advances mid-call.
assert.equal(ago(now - 45_000), "1 min ago");
assert.equal(ago(now - 100_000), "2 min ago");
assert.equal(ago(now - 59 * 60_000), "59 min ago");

// An hour or more, under a day, switches to whole hours.
assert.equal(ago(now - 2 * 3600_000), "2 h ago");

// A day or more falls back to an absolute date: it must not still say "ago", or the row would claim a
// two-day-old session was minutes fresh.
const old = ago(now - 30 * 3600_000);
assert.ok(old.length > 0);
assert.equal(old.endsWith("ago"), false, old);

console.log("ago ok");
