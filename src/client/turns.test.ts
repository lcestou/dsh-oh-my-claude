// Offline self-check for the turn-accounting format helpers.
import assert from "node:assert/strict";
import { fmtCost, fmtDuration, cacheShare, formatCacheRead } from "./index.js";

// fmtCost rounds to two decimals.
assert.equal(fmtCost(0.42), "$0.42");
assert.equal(fmtCost(0), "$0.00");
assert.equal(fmtCost(1.5), "$1.50");
assert.equal(fmtCost(10), "$10.00");

// fmtDuration: seconds only, minutes only, mixed.
assert.equal(fmtDuration(34000), "34s");
assert.equal(fmtDuration(95000), "1m 35s");
assert.equal(fmtDuration(60000), "1m");
assert.equal(fmtDuration(0), "0s");
assert.equal(fmtDuration(500), "1s");
assert.equal(fmtDuration(125000), "2m 5s");

// cacheShare: basic ratios, edge cases.
assert.equal(cacheShare({ input: 100, cacheRead: 900, cacheWrite: 0 }), 0.9);
assert.equal(cacheShare({ input: 0, cacheRead: 100, cacheWrite: 0 }), 1);
assert.equal(cacheShare({ input: 100, cacheRead: 0, cacheWrite: 50 }), 0);
assert.equal(cacheShare({ input: 0, cacheRead: 0, cacheWrite: 0 }), 0);
assert.equal(cacheShare({ input: 50, cacheRead: 50, cacheWrite: 0 }), 0.5);

// formatCacheRead: compact format with K/M suffixes, drop trailing .0.
assert.equal(formatCacheRead(0), "");
assert.equal(formatCacheRead(999), "999");
assert.equal(formatCacheRead(1000), "1K");
assert.equal(formatCacheRead(12_345), "12.3K");
assert.equal(formatCacheRead(1_500_000), "1.5M");
assert.equal(formatCacheRead(2_000_000), "2M");

console.log("✓ All turn accounting checks pass");
