// Offline self-check: bun src/context-sources.test.ts. Pure, no DOM, no network.
import assert from "node:assert/strict";
import { contextDrops, CONTEXT_SOURCES, TOGGLEABLE } from "./context-sources.js";

assert.deepEqual(contextDrops({}), new Set());
assert.deepEqual(contextDrops({ dshContextInstructionsOff: true }), new Set(["instructions"]));
assert.deepEqual(contextDrops({ dshContextSkillsOff: true }), new Set(["skills"]));
assert.deepEqual(
  contextDrops({ dshContextInstructionsOff: true, dshContextSkillsOff: true }),
  new Set(["instructions", "skills"]),
);
assert.deepEqual(contextDrops({ dshContextOff: true }), new Set(["instructions", "skills"]));
assert.deepEqual(
  contextDrops({ dshContextOff: true, dshContextInstructionsOff: false }),
  new Set(["instructions", "skills"]),
);
assert.deepEqual(
  contextDrops({ dshContextInstructionsOff: false, dshContextSkillsOff: false }),
  new Set(),
);
assert.equal(contextDrops({}).has("runtime"), false);
assert.equal(contextDrops({ dshContextInstructionsOff: true }).has("runtime"), false);
assert.equal(contextDrops({ dshContextSkillsOff: true }).has("runtime"), false);
assert.equal(
  contextDrops({ dshContextInstructionsOff: true, dshContextSkillsOff: true }).has("runtime"),
  false,
);
assert.equal(contextDrops({ dshContextOff: true }).has("runtime"), false);
assert.equal(
  contextDrops({ dshContextOff: true, dshContextInstructionsOff: false }).has("runtime"),
  false,
);
assert.equal(
  contextDrops({ dshContextInstructionsOff: false, dshContextSkillsOff: false }).has("runtime"),
  false,
);
assert.equal(
  contextDrops({ dshContextOff: true, dshContextRuntimeOff: true }).has("runtime"),
  false,
);
assert.equal(contextDrops({ dshContextRuntimeOff: true }).has("runtime"), false);
const HINT_KEYS = ["dshContextOff", "dshContextInstructionsOff", "dshContextSkillsOff"];
for (const k of HINT_KEYS) {
  assert.equal(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k), true);
}
assert.deepEqual(CONTEXT_SOURCES, ["instructions", "skills", "runtime"]);
assert.deepEqual(TOGGLEABLE, ["instructions", "skills"]);

console.log("context-sources.test.ts: ok");
