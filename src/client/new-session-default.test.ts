// Offline self-check for the order a blank Claude session's model comes from: the workspace's own
// memory, then the box default, never over a provider someone picked by hand.
import assert from "node:assert/strict";
import { blankSessionTarget } from "./new-session-default.js";

const saved = { model: "claude-sonnet-5-5", provider: "claude-code", effort: "medium" };
const def = { provider: "claude-code", model: "claude-opus-5-5", effort: "high" };

// Memory wins over the default, effort and all.
assert.deepEqual(blankSessionTarget({ current: "claude-code", picked: undefined, saved, def }), {
  provider: "claude-code",
  model: "claude-sonnet-5-5",
  reasoningEffort: "medium",
});
// Nothing remembered: the default, on the box it names, even when the blank is already Claude.
assert.deepEqual(
  blankSessionTarget({ current: "claude-code-lilly", picked: undefined, saved: undefined, def }),
  { provider: "claude-code", model: "claude-opus-5-5", reasoningEffort: "high" },
);
assert.deepEqual(
  blankSessionTarget({
    current: "claude-code",
    picked: undefined,
    saved: undefined,
    def: { ...def, provider: "claude-code-lilly" },
  }),
  { provider: "claude-code-lilly", model: "claude-opus-5-5", reasoningEffort: "high" },
);
// A Claude mount picked by hand keeps its box; the default only fills in the model.
assert.deepEqual(
  blankSessionTarget({
    current: "claude-code-lilly",
    picked: "claude-code-lilly",
    saved: undefined,
    def,
  }),
  { provider: "claude-code-lilly", model: "claude-opus-5-5", reasoningEffort: "high" },
);
// A blank that is not Claude stays put unless the default says all workspaces...
assert.equal(
  blankSessionTarget({ current: undefined, picked: undefined, saved: undefined, def }),
  undefined,
);
assert.deepEqual(
  blankSessionTarget({
    current: undefined,
    picked: undefined,
    saved: undefined,
    def: { ...def, all: true },
  }),
  { provider: "claude-code", model: "claude-opus-5-5", reasoningEffort: "high" },
);
// ...and never against a provider someone picked by hand.
assert.equal(
  blankSessionTarget({
    current: undefined,
    picked: "llama",
    saved: undefined,
    def: { ...def, all: true },
  }),
  undefined,
);
assert.equal(blankSessionTarget({ current: undefined, picked: "llama", saved, def }), undefined);
// The memory pulls a non-Claude blank onto the Claude it last ran there; an old row has no effort.
assert.deepEqual(
  blankSessionTarget({
    current: undefined,
    picked: undefined,
    saved: { model: "claude-opus-5", provider: "claude-code" },
    def: undefined,
  }),
  { provider: "claude-code", model: "claude-opus-5" },
);
// A default without an effort leaves the model's own.
assert.deepEqual(
  blankSessionTarget({
    current: "claude-code",
    picked: undefined,
    saved: undefined,
    def: { provider: "claude-code", model: "claude-opus-5-5" },
  }),
  { provider: "claude-code", model: "claude-opus-5-5" },
);
// A box picked by hand after the blank came up local: the pick decides the mount, for the default
// and for the memory alike (`current` is read at mount, `picked` just before the apply).
assert.deepEqual(
  blankSessionTarget({
    current: "claude-code",
    picked: "claude-code-lilly",
    saved: undefined,
    def,
  }),
  { provider: "claude-code-lilly", model: "claude-opus-5-5", reasoningEffort: "high" },
);
assert.deepEqual(
  blankSessionTarget({ current: "claude-code", picked: "claude-code-lilly", saved, def }),
  { provider: "claude-code-lilly", model: "claude-sonnet-5-5", reasoningEffort: "medium" },
);
// Nothing at all: leave the blank alone.
assert.equal(
  blankSessionTarget({
    current: "claude-code",
    picked: undefined,
    saved: undefined,
    def: undefined,
  }),
  undefined,
);
console.log("new-session-default ok");
