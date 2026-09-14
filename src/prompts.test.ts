// Offline self-check: bun src/prompts.test.ts. No CLI, no file, no network.
import assert from "node:assert/strict";
import { diffQuestion, reviewPrompt } from "./prompts.js";

// diffQuestion: empty means the whole tree, non-empty names the path.
{
  assert.equal(
    diffQuestion(""),
    "What do my uncommitted changes do, and is anything in them risky?",
    "empty means the whole tree",
  );
  assert.equal(
    diffQuestion("src/foo.ts"),
    "What does the change to src/foo.ts do, and is anything in it risky?",
    "non-empty names the path",
  );
}

// reviewPrompt: empty list returns just the head; up to 12 paths are named; past 12 counts instead.
{
  assert.equal(
    reviewPrompt([]),
    "Review my uncommitted changes. Start with correctness, then anything risky.",
    "empty list",
  );

  const twelve = Array.from({ length: 12 }, (_, i) => `f${i}.ts`);
  assert.equal(
    reviewPrompt(twelve),
    "Review my uncommitted changes. Start with correctness, then anything risky. Files: f0.ts, f1.ts, f2.ts, f3.ts, f4.ts, f5.ts, f6.ts, f7.ts, f8.ts, f9.ts, f10.ts, f11.ts",
    "12 paths named, boundary low",
  );

  const thirteen = Array.from({ length: 13 }, (_, i) => `f${i}.ts`);
  assert.equal(
    reviewPrompt(thirteen),
    "Review my uncommitted changes. Start with correctness, then anything risky. 13 files changed.",
    "13 paths counted, boundary high",
  );
}

console.log("prompts ok");
