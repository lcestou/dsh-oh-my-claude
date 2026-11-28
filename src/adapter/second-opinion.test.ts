// Offline self-check: bun src/adapter/second-opinion.test.ts. No CLI, no model, no network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changedPaths,
  opinions,
  parseFindings,
  REVIEW_CAP,
  reviewInput,
  treeMarks,
} from "./second-opinion.js";
import type { WorkspaceDiff } from "../process.js";
import type { TurnDeps } from "./second-opinion.js";
import { fakePluginContext } from "../test-context.js";

/** A diff with one tracked file and one new file, the shape `decodeWorkspaceDiff` returns. */
const diff = (aLines: Array<string>, newFile = true): WorkspaceDiff => ({
  filesCount: newFile ? 2 : 1,
  linesAdded: 1,
  linesRemoved: 0,
  files: [
    {
      path: "a.ts",
      added: 1,
      removed: 0,
      binary: false,
      untracked: false,
      hunks: [{ oldStart: 1, newStart: 1, lines: aLines }],
    },
    ...(newFile
      ? [{ path: "n.ts", added: 0, removed: 0, binary: false, untracked: true, hunks: [] }]
      : []),
  ],
});

// changedPaths: no baseline means nothing is this turn's.
assert.deepEqual(changedPaths(undefined, treeMarks(diff([" a", "+b"]), new Map())), []);

// A tracked file whose hunks changed counts; one that did not, does not.
const start = treeMarks(diff([" a", "+b"], false), new Map());

assert.deepEqual(changedPaths(start, treeMarks(diff([" a", "+b"], false), new Map())), []);

assert.deepEqual(changedPaths(start, treeMarks(diff([" a", "+c"], false), new Map())), ["a.ts"]);

// A new file counts when it appears, and again when its text changes, though the CLI's counts stay 0.
const withNew = treeMarks(diff([" a", "+b"]), new Map([["n.ts", "one"]]));

assert.deepEqual(changedPaths(start, withNew), ["n.ts"]);

assert.deepEqual(changedPaths(withNew, treeMarks(diff([" a", "+b"]), new Map([["n.ts", "two"]]))), [
  "n.ts",
]);

assert.deepEqual(
  changedPaths(withNew, treeMarks(diff([" a", "+b"]), new Map([["n.ts", "one"]]))),
  [],
);

// reviewInput: request first, then only the wanted files; a new file's text as added lines.
const both = reviewInput(
  "Fix it",
  diff([" a", "+b"]),
  ["a.ts", "n.ts"],
  new Map([["n.ts", "x\ny"]]),
);

assert.equal(both.reviewed, 2);

assert.equal(
  both.text,
  "Request:\nFix it\n\nDiff:\n--- a.ts\n@@ -1 +1 @@\n a\n+b\n\n--- n.ts (new file)\n+x\n+y",
);

const unread = reviewInput("", diff([" a"]), ["n.ts"], new Map());

assert.equal(unread.text, "Request:\n(no request text)\n\nDiff:\n--- n.ts (new file, not read)");

// Over the cap: the first file always goes (cut to the cap), the rest are counted, not sent.
const big = "+".concat("x".repeat(REVIEW_CAP));
const capped = reviewInput("r", diff([big]), ["a.ts", "n.ts"], new Map([["n.ts", "y"]]));

assert.equal(capped.reviewed, 1);

assert.ok(capped.text.endsWith("(diff cut: 1 of 2 files shown)"), "the cut is named");

assert.ok(!capped.text.includes("n.ts"), "the second file stays out");

// parseFindings: the line format, a quoted line, a leading star and any case; the cap at three;
// a finding about a file the reviewer never saw is dropped.
const seen = ["a.ts", "b.ts"];

assert.deepEqual(
  parseFindings(
    "- [bug] a.ts:3 `return kept.slice(0, max);` Keeps the oldest.\n* [RISK] ./b.ts:9 May race.",
    seen,
  ),
  [
    { kind: "bug", where: "a.ts:3", text: "`return kept.slice(0, max);` Keeps the oldest." },
    { kind: "risk", where: "./b.ts:9", text: "May race." },
  ],
);

assert.equal(parseFindings(Array(7).fill("- [bug] a.ts:1 x").join("\n"), seen).length, 3);

assert.deepEqual(parseFindings("- [bug] c.ts:1 Guess about an unseen file.", seen), []);

assert.deepEqual(parseFindings("No findings.", seen), []);

assert.deepEqual(parseFindings("  no findings  ", seen), []);

assert.deepEqual(parseFindings("The change looks fine to me.", seen), [
  { kind: "note", where: "", text: "The change looks fine to me." },
]);

// Off (nothing primed, as on a box that never picked a model): a turn start asks the CLI nothing
// and a turn end leaves no card.
{
  let asked = 0;

  const deps: TurnDeps = {
    diff: () => {
      asked++;

      return Promise.resolve({ ok: false, error: "not asked" });
    },
    read: () => Promise.resolve(null),
    // The off path returns before it touches the model service, whose methods all throw.
    llm: fakePluginContext().llm,
  };

  opinions.turnStarting("s-off", "request", deps);
  await opinions.turnEnded("s-off");
  assert.equal(asked, 0, "no control request while off");
  assert.deepEqual(opinions.reply("s-off"), { card: null });
}

// On, and a second turn starts while the first turn's end is still waiting: the first turn's end
// must not put up a card for a tree the second turn is already changing.
{
  const dir = mkdtempSync(join(tmpdir(), "so-test-"));
  writeFileSync(join(dir, "second-opinion.json"), JSON.stringify({ provider: "p", model: "m" }));
  await opinions.prime(dir);
  let calls = 0;

  const deps: TurnDeps = {
    // Each snapshot sees a different a.ts, so any two of them differ.
    diff: () => {
      calls++;

      return Promise.resolve({ ok: true as const, ...diff([" a", `+${calls}`], false) });
    },
    read: () => Promise.resolve(null),
    // No review runs in this block (auto is off), so the model service is never touched.
    llm: fakePluginContext().llm,
  };

  opinions.turnStarting("s-race", "one", deps);
  // turnEnded runs up to its first await, then turn 2 starts before it resumes.
  const ending = opinions.turnEnded("s-race");
  opinions.turnStarting("s-race", "two", deps);
  await ending;
  assert.deepEqual(opinions.reply("s-race"), { card: null }, "a stale turn end shows nothing");

  // Run pressed twice (a double click, or two tabs) prepares one call; a provider that throws
  // shows as a failed card with its message.
  let prepared = 0;

  // The review reads only these three methods off the model service.
  const { llm } = fakePluginContext({
    llm: {
      listProviders: () => [{ id: "p" }],
      listModels: async () => [{ id: "m" }],
      prepareCall: async () => {
        prepared++;
        throw new Error("provider down");
      },
    },
  });

  const runDeps: TurnDeps = { ...deps, llm };
  opinions.turnStarting("s-run", "fix it", runDeps);
  await opinions.turnEnded("s-run");
  assert.equal(opinions.reply("s-run").card?.state, "ready");
  const [first, second] = await Promise.all([opinions.run("s-run"), opinions.run("s-run")]);
  assert.deepEqual([first, second, prepared], [true, false, 1], "one review per press pair");
  const failed = opinions.reply("s-run").card;
  assert.ok(failed?.state === "failed", "the throw shows as a failed card");
  assert.equal(failed.reason, "error");
  assert.equal(failed.detail, "provider down");
  rmSync(dir, { recursive: true, force: true });
}

console.log("second-opinion ok");
