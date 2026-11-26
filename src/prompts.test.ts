// Offline self-check: bun src/prompts.test.ts. No CLI, no file, no network.
import assert from "node:assert/strict";
import { diffQuestion, reviewPrompt, secondOpinionSteer } from "./prompts.js";

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

// secondOpinionSteer: the model named, each finding on its own line, a note without a location.
assert.equal(
  secondOpinionSteer("lutechi-llm", [
    { kind: "bug", where: "a.ts:3", text: "Off by one." },
    { kind: "note", where: "", text: "Odd." },
  ]),
  "A second model (lutechi-llm) reviewed the changes from your last turn and raised the points below. Check each one against the code. Fix the ones that hold, and say briefly why the others do not.\n\n- [bug] a.ts:3 Off by one.\n- [note] Odd.",
);

console.log("prompts ok");
