import assert from "node:assert/strict";
import type { HistoryFile } from "./usage-history.js";
import { createUsageHistory, parseUsageHistory } from "./usage-history-store.js";

const D = 86_400_000;
const t0 = 1_800_000_000_000;

const s1 = {
  label: "5-hour",
  kind: "session" as const,
  usedPercent: 10,
  resetsAt: t0 + 4 * 3_600_000,
};

// A torn or foreign file reads as empty; a bad row, or a login that is not a list, is dropped alone.
assert.deepEqual(parseUsageHistory("{"), { version: 1, logins: {} });

assert.deepEqual(parseUsageHistory("[]"), { version: 1, logins: {} });

const good = { series: "weekly", resetsAt: 1, peak: 2, firstAt: 0, lastAt: 1 };

assert.deepEqual(
  parseUsageHistory(
    JSON.stringify({
      logins: { a: [good, { series: 3 }, null, { ...good, peak: undefined }], b: 5 },
    }),
  ).logins,
  { a: [good] },
);

// The store: loads once, writes only on change, keeps logins apart, and prunes every login's old
// rows on a write, not only the login it recorded: b@x's 1970 row goes, c@x's young one stays.
const writes: Array<HistoryFile> = [];
const young = { series: "weekly", resetsAt: t0 - D, peak: 2, firstAt: t0 - 3 * D, lastAt: t0 - D };

const store = createUsageHistory(
  async () => JSON.stringify({ version: 1, logins: { "b@x": [good], "c@x": [young] } }),
  async (v) => {
    writes.push(structuredClone(v));
  },
);

await store.record("a@x", [s1], t0);

await store.record("a@x", [s1], t0);

await new Promise((r) => setTimeout(r, 0));

assert.equal(writes.length, 1);

assert.deepEqual(Object.keys(writes[0]!.logins).toSorted(), ["a@x", "c@x"]);

assert.deepEqual(await store.view("b@x", t0), {});

assert.deepEqual(await store.view("c@x", t0), {
  weekly: [{ resetsAt: t0 - D, percent: 2, partial: false }],
});

assert.deepEqual(await store.view("nobody", t0), {});

console.log("usage-history-store ok");
