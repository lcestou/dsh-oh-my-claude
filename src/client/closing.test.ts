import assert from "node:assert/strict";
import { closingVerb, CLOSING_VERBS, clockText, isStopped, tookDuration } from "./closing.js";

// The CLI's hash: "a" is 97, 97 % 8 is 1.
assert.equal(closingVerb("a", CLOSING_VERBS), "Brewed");
assert.equal(closingVerb("s1:10", CLOSING_VERBS), closingVerb("s1:10", CLOSING_VERBS), "stable");
assert.ok(CLOSING_VERBS.includes(closingVerb("session-x:3", CLOSING_VERBS)));
// A negative hash still lands in the list (the CLI's `>>>0`).
assert.ok(CLOSING_VERBS.includes(closingVerb("zzzzzzzzzzzz", CLOSING_VERBS)));

assert.equal(tookDuration("Took 38s"), "38s");
assert.equal(tookDuration("Took 1m 20s"), "1m 20s");
assert.equal(tookDuration("用时 38s"), "38s");
assert.equal(tookDuration("Deep diving for 12s"), undefined, "a running label is not finished");

assert.equal(clockText("03:33", false), "3:33 AM");
assert.equal(clockText("00:08", false), "12:08 AM");
assert.equal(clockText("12:05", false), "12:05 PM");
assert.equal(clockText("15:21", false), "3:21 PM");
assert.equal(clockText("9/23 15:21", false), "9/23 3:21 PM");
assert.equal(clockText("15:21", true), "15:21", "Chinese keeps dsh's 24-hour clock");
assert.equal(clockText("yesterday", false), "yesterday");
assert.equal(isStopped("Stopped"), true);
assert.equal(isStopped(" 已停止 "), true);
assert.equal(isStopped("Failed"), false, "a failed turn keeps dsh's word");
assert.equal(isStopped("Took 38s"), false);
console.log("closing ok");
