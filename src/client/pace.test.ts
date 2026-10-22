import assert from "node:assert/strict";
import { paceOf, WINDOW_MS } from "./pace.js";

const H = 3_600_000;
const now = 1_000_000_000_000;
const five = WINDOW_MS.session;

// Half the window gone at 30 %: ends at 60 %.
assert.deepEqual(paceOf(30, now + five / 2, five, now), { kind: "ends", percent: 60 });
// Half gone at 60 %: cap at 50/60 of the time spent so far, past now.
const cap = paceOf(60, now + five / 2, five, now);
assert.equal(cap?.kind, "cap");
assert.equal(cap?.kind === "cap" ? Math.round(cap.at - now) : 0, Math.round((40 / 60) * 2.5 * H));
// Exactly on pace for the cap counts as a cap.
assert.equal(paceOf(50, now + five / 2, five, now)?.kind, "cap");
// Too early in the window to read a rate (4 % elapsed), nothing used, no reset, or already reset.
assert.equal(paceOf(2, now + five * 0.96, five, now), undefined);
assert.equal(paceOf(0, now + five / 2, five, now), undefined);
assert.equal(paceOf(30, null, five, now), undefined);
assert.equal(paceOf(30, now - 1, five, now), undefined);
// Weekly window: one day in at 10 % ends at 70 %.
const week = WINDOW_MS.weekly;
assert.deepEqual(paceOf(10, now + week - 86_400_000, week, now), { kind: "ends", percent: 70 });

console.log("pace ok");
