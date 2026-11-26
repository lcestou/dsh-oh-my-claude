// Offline self-check: bun src/client/history-strip.test.ts. No DOM, no server.
import assert from "node:assert/strict";
import { absentSeries, barText, seriesLabel } from "./history-strip.js";
import { installLocale } from "./i18n.js";

const e = { resetsAt: 0, percent: 40, partial: false };

// Absent series: only those with ended windows that no live row drew, 5-hour, weekly, models, rest.
assert.deepEqual(
  absentSeries(
    {
      "label:Cowork": [e],
      "model:Opus": [e],
      weekly: [e],
      "model:Fable": [e],
      session: [e],
      "model:Haiku": [],
    },
    new Set(["weekly"]),
  ),
  ["session", "model:Fable", "model:Opus", "label:Cowork"],
);

// Names follow the live rows' words; an unmet kind keeps its API label.
assert.equal(seriesLabel("session"), "5-hour");
assert.equal(seriesLabel("weekly"), "Weekly");
assert.equal(seriesLabel("model:Fable"), "Fable weekly");
assert.equal(seriesLabel("label:Cowork"), "Cowork");

// A partial window says "at least"; a whole one does not.
assert.match(barText({ ...e, partial: true }), /at least 40%/);
assert.doesNotMatch(barText(e), /at least/);

// The end date follows dsh's language: with dsh on Chinese a window that ended yesterday names
// its weekday in Chinese, whatever the process locale is.
{
  const off = installLocale({
    get: () => ({
      register: () => undefined,
      bind: () => (_key: string, params?: Record<string, string | number>) =>
        JSON.stringify(params ?? {}),
      subscribe: () => () => {},
      getSnapshot: () => ({ active: "zh", revision: 1 }),
    }),
  });
  const line = barText({ ...e, resetsAt: Date.now() - 86_400_000 });
  off();
  assert.match(line, /周|星期/, `a Chinese weekday, got ${line}`);
}

console.log("history-strip ok");
