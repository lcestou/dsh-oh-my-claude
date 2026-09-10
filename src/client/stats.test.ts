import { strict as assert } from "node:assert";
import { costDetails, isStatsRow } from "./index.js";

/** The smallest node the predicate reads: dsh's row, its children and its class. */
function el(
  className: string,
  children: { className?: string; aria?: string; text?: string }[],
  text = "",
  attr = "",
): HTMLElement {
  const node = {
    isConnected: true,
    className,
    hasAttribute: (name: string) => name === attr,
    textContent: text || children.map((c) => c.text ?? "").join(" "),
    children: { length: children.length },
    querySelector(selector: string) {
      if (!selector.startsWith(":scope > span")) return null;
      const match = children.find((c) => c.aria === "true" && (c.className ?? "").endsWith("_sep"));
      return match ? { textContent: match.text ?? "" } : null;
    },
  };
  // SAFETY: the predicate reads only these five members; a real DOM is not available under bun
  return node as unknown as HTMLElement;
}

const groups = (sepClass: string, sepText: string, text = "") =>
  el(
    "-NDN2W_root",
    [
      { text: "3 Runden · 9 Schritte" },
      { className: sepClass, aria: "true", text: sepText },
      { text: "LLM 4s" },
    ],
    text,
  );

// The row is found by its shape, so a dsh in any other language still gets the cost line.
assert.equal(isStatsRow(groups("-NDN2W_sep", "|")), true);
// A build with another hash in front of the suffix is the same row.
assert.equal(isStatsRow(groups("-ABC123_sep", "|")), true);
// The three other dsh components that draw a `_sep` span leave it empty.
assert.equal(isStatsRow(groups("o3BgMG_sep", "")), false);
// No module class at all, and nothing that reads as the English row.
assert.equal(isStatsRow(el("plain", [{ text: "hello" }, { text: "there" }])), false);
// One group and therefore no separator yet: the English text is the last resort.
assert.equal(
  isStatsRow(el("-NDN2W_root", [{ text: "3 turns" }, { text: "· 9 steps" }], "3 turns · 9 steps")),
  true,
);

// dsh 0.1.5's pill row: one pill so far, no bar, no English text, but dsh's own mark on it.
assert.equal(
  isStatsRow(el("bOPqQW_root", [{ text: "1.8M tok · Cache hit 96%" }], "", "data-composer-stats")),
  true,
);

const detached = groups("-NDN2W_sep", "|");
// SAFETY: same fake node as above; the predicate refuses a row React has already dropped
(detached as unknown as { isConnected: boolean }).isConnected = false;
assert.equal(isStatsRow(detached), false);

// The cost dialog's rows: sums across turns, the last turn's own figures, and the optional rows
// (cache write, cache hit, first token) only when there is something to say.
const turn = (over: Partial<Parameters<typeof costDetails>[0][number]>) => ({
  at: 0,
  costUsd: 0.1,
  durationMs: 4000,
  apiMs: 3000,
  turns: 1,
  input: 1000,
  output: 500,
  cacheRead: 9000,
  cacheWrite: 0,
  ...over,
});
assert.deepEqual(costDetails([turn({}), turn({ costUsd: 0.42, ttftMs: 840 })]), [
  ["Last turn", "$0.42"],
  ["Turns", "2"],
  ["Wall time", "8s"],
  ["API time", "6s"],
  ["Input", "2K"],
  ["Cache read", "18K"],
  ["Output", "1K"],
  ["Cache hit", "90%"],
  ["First token", "840ms"],
]);
assert.deepEqual(costDetails([turn({ cacheWrite: 2500, cacheRead: 0, ttftMs: 1500 })]), [
  ["Last turn", "$0.10"],
  ["Turns", "1"],
  ["Wall time", "4s"],
  ["API time", "3s"],
  ["Input", "1K"],
  ["Cache read", "0"],
  ["Cache write", "2.5K"],
  ["Output", "500"],
  ["Cache hit", "0%"],
  ["First token", "1.5s"],
]);
assert.deepEqual(costDetails([]).slice(0, 2), [
  ["Last turn", "$0.00"],
  ["Turns", "0"],
]);

console.log("stats-row ok");
