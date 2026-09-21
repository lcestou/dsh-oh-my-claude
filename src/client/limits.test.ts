// Offline self-check: bun src/client/limits.test.ts.
import assert from "node:assert/strict";

import { bindsModel, worstLimit } from "./limits.js";

const fable = {
  label: "Fable weekly",
  usedPercent: 100,
  resetsAt: 1,
  severity: "critical",
  model: "Fable",
};
const weekly = { label: "Weekly", usedPercent: 74, resetsAt: 2, severity: "normal" };
const session = { label: "5-hour", usedPercent: 91, resetsAt: 3, severity: "high" };

// A scoped window binds only its own model; an unscoped one binds every model.
assert.equal(bindsModel(fable, "claude-fable-5-1"), true);
assert.equal(bindsModel(fable, "claude-opus-5"), false);
assert.equal(bindsModel(fable, undefined), false, "unknown model: a scoped window does not count");
assert.equal(bindsModel(weekly, "claude-opus-5"), true);

// The loudest binding window wins; critical beats an unknown non-normal grade, which reads as warning.
assert.deepEqual(worstLimit([weekly, session, fable], "claude-fable-5-1"), {
  level: "critical",
  window: fable,
});
assert.deepEqual(worstLimit([weekly, session, fable], "claude-opus-5"), {
  level: "warning",
  window: session,
});
assert.equal(worstLimit([weekly, fable], "claude-opus-5"), undefined, "Fable full, Opus fine");
assert.equal(worstLimit([{ label: "x", usedPercent: 9, resetsAt: null }], "m"), undefined);

console.log("limits ok");
