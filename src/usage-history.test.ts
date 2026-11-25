import assert from "node:assert/strict";
import {
  HISTORY_KEEP_MS,
  HISTORY_ROWS_MAX,
  historyView,
  recordWindows,
  seriesOf,
  typicalPercent,
} from "./usage-history.js";

const H = 3_600_000;
const D = 24 * H;
const t0 = 1_800_000_000_000;
const s1 = { label: "5-hour", kind: "session" as const, usedPercent: 10, resetsAt: t0 + 4 * H };
const wk = { label: "Weekly", kind: "weekly" as const, usedPercent: 17, resetsAt: t0 + 5 * D };
const fable = { label: "Fable weekly", model: "Fable", usedPercent: 2, resetsAt: t0 + 5 * D };

// Series ids: the two plan windows by kind, a model's weekly by model name, an unmet kind by label.
assert.equal(seriesOf(s1), "session");
assert.equal(seriesOf(fable), "model:Fable");
assert.equal(seriesOf({ label: "Cowork", usedPercent: 1, resetsAt: null }), "label:Cowork");

// First reply makes one row per window; a window with no reset is skipped.
let rows = recordWindows([], [s1, wk, fable, { label: "X", usedPercent: 5, resetsAt: null }], t0);
assert.deepEqual(
  rows.map((r) => [r.series, r.peak]),
  [
    ["session", 10],
    ["weekly", 17],
    ["model:Fable", 2],
  ],
);

// The same fetchedAt again changes nothing and hands back the same array (no write).
assert.equal(recordWindows(rows, [s1, wk, fable], t0), rows);

// A later reading raises the peak and lastAt; an older one is ignored.
rows = recordWindows(rows, [{ ...s1, usedPercent: 40 }], t0 + H);
assert.equal(rows.find((r) => r.series === "session")?.peak, 40);
assert.equal(rows.find((r) => r.series === "session")?.lastAt, t0 + H);
assert.equal(recordWindows(rows, [{ ...s1, usedPercent: 90 }], t0 + H / 2), rows);

// Resets a minute apart are one window (the endpoint's instant jitters across a minute); one three
// minutes later is another.
const jitter = recordWindows([], [s1], t0);
assert.equal(recordWindows(jitter, [{ ...s1, resetsAt: s1.resetsAt + 60_000 }], t0 + 1).length, 1);
assert.equal(recordWindows(jitter, [{ ...s1, resetsAt: s1.resetsAt }], t0 + 2).length, 1);
assert.equal(recordWindows(jitter, [{ ...s1, resetsAt: s1.resetsAt + 180_000 }], t0 + 3).length, 2);

// Nothing has ended yet: every series present, every list empty.
assert.deepEqual(historyView(rows, t0 + 2 * H), { session: [], weekly: [], "model:Fable": [] });

// The 5-hour window ends; its last read was 3 h before the end, more than a tenth of 5 h: partial.
let view = historyView(rows, t0 + 5 * H);
assert.deepEqual(view.session, [{ resetsAt: t0 + 4 * H, percent: 40, partial: true }]);

// A read 10 minutes before the end is not partial.
rows = recordWindows(rows, [{ ...s1, usedPercent: 55 }], t0 + 4 * H - 10 * 60_000);
view = historyView(rows, t0 + 5 * H);
assert.deepEqual(view.session, [{ resetsAt: t0 + 4 * H, percent: 55, partial: false }]);

// An early reset: a newer weekly window appears before the old reset time; the old one counts as ended.
rows = recordWindows(rows, [{ ...wk, usedPercent: 3, resetsAt: t0 + 12 * D }], t0 + 2 * D);
view = historyView(rows, t0 + 2 * D);
assert.deepEqual(
  view.weekly?.map((e) => e.resetsAt),
  [t0 + 5 * D],
);

// An early-reset window read ten minutes before its replacement appeared is not partial: its end
// is when the next window was first seen, not its old reset days later.
{
  const a = recordWindows([], [{ ...wk, resetsAt: t0 + 5 * D }], t0 + 2 * D - 10 * 60_000);
  const b = recordWindows(a, [{ ...wk, usedPercent: 1, resetsAt: t0 + 9 * D }], t0 + 2 * D);
  assert.deepEqual(historyView(b, t0 + 2 * D).weekly, [
    { resetsAt: t0 + 5 * D, percent: 17, partial: false },
  ]);
}

// Bounds: rows past 90 days go, and at most HISTORY_ROWS_MAX stay.
let many: ReturnType<typeof recordWindows> = [];
for (let i = 0; i < HISTORY_ROWS_MAX + 30; i++)
  many = recordWindows(many, [{ ...s1, resetsAt: t0 + i * 5 * H }], t0 + i * 5 * H - H);
assert.equal(many.length, HISTORY_ROWS_MAX);
const late = t0 + (HISTORY_ROWS_MAX + 30) * 5 * H + HISTORY_KEEP_MS;
const trimmed = recordWindows(many, [{ ...wk, resetsAt: late + D }], late);
assert.ok(trimmed.every((r) => r.resetsAt >= late - HISTORY_KEEP_MS));

// The view sends at most twelve 5-hour windows, the newest.
const shown = historyView(many, t0 + 10_000 * H).session ?? [];
assert.equal(shown.length, 12);
assert.equal(shown.at(-1)?.resetsAt, many.at(-1)?.resetsAt);

// Typical: the median of three or more, nothing below three.
const e = (percent: number) => ({ resetsAt: 0, percent, partial: false });
assert.equal(typicalPercent([e(10), e(90)]), undefined);
assert.equal(typicalPercent([e(90), e(10), e(40)]), 40);
assert.equal(typicalPercent([e(10), e(20), e(30), e(41)]), 25);

console.log("usage-history ok");
