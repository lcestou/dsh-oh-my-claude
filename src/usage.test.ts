import assert from "node:assert/strict";
import { readUsage, usageWindows } from "./usage.js";

// limits shape: session + weekly + one active scoped model, one inactive scoped model skipped
const w = usageWindows({
  limits: [
    { kind: "session", percent: 34.4, resets_at: "2026-09-05T12:00:00Z" },
    { kind: "weekly_all", percent: 12, resets_at: 1_800_000_000 },
    {
      kind: "weekly_scoped",
      percent: 140,
      is_active: true,
      scope: { model: { display_name: "Opus" } },
    },
    { kind: "weekly_scoped", percent: 5, is_active: false, scope: { surface: "code" } },
    { kind: "session", percent: 99 },
    { kind: "opus_daily", percent: 7, resets_at: null },
    { kind: "sonnet_daily", percent: 3, is_active: false },
  ],
});
assert.deepEqual(
  w.map((x) => [x.label, x.usedPercent, x.resetsAt]),
  [
    ["5-hour", 34.4, Date.parse("2026-09-05T12:00:00Z")],
    ["Weekly", 12, 1_800_000_000_000],
    ["Opus weekly", 100, null],
    ["Opus daily", 7, null],
  ],
);
// legacy shape
assert.deepEqual(usageWindows({ five_hour: { utilization: 50, resets_at: null }, seven_day: {} }), [
  { label: "5-hour", usedPercent: 50, resetsAt: null },
]);
assert.deepEqual(usageWindows(null), []);
assert.deepEqual(usageWindows({ limits: "nope" }), []);

// readUsage never throws
const dead = await readUsage(async () => {
  throw new Error("ECONNREFUSED");
});
assert.equal(dead.ok, false);
console.log("usage ok");
