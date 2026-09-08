import { strict as assert } from "node:assert";
import { atBottom, distanceFromBottom, type Geom, nextFollow } from "./tailFollow.js";

const g = (scrollTop: number, scrollHeight = 1000, clientHeight = 400): Geom => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

// distanceFromBottom: gap above the bottom, clamped at 0 for over-scroll.
assert.equal(distanceFromBottom(g(600)), 0, "exactly at bottom");
assert.equal(distanceFromBottom(g(500)), 100);
assert.equal(distanceFromBottom(g(9999)), 0, "over-scroll clamps to 0");

// atBottom slack.
assert.equal(atBottom(g(600), 120), true);
assert.equal(atBottom(g(500), 120), true, "within slack");
assert.equal(atBottom(g(479), 120), false, "121px above bottom");

const PX = 120;

// A new turn always re-arms following, even if the reader was parked up-thread.
assert.equal(nextFollow(false, "turn-start", g(0), PX), true);

// A reader gesture up disarms following regardless of position.
assert.equal(nextFollow(true, "user-up", g(600), PX), false);

// A plain scroll that lands at the bottom re-arms; one that stays up-thread holds prior state,
// so our own pin writes (which fire `scroll` near the bottom) never disarm following.
assert.equal(nextFollow(false, "scroll", g(600), PX), true, "reached bottom re-arms");
assert.equal(nextFollow(false, "scroll", g(200), PX), false, "still up-thread, stays off");
assert.equal(nextFollow(true, "scroll", g(200), PX), true, "our pin overshoot keeps following");

console.log("tailFollow: ok");
