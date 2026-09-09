// Offline self-check for the login mask: every surface that names the account runs through it.
import assert from "node:assert/strict";
import type { ClientCtx } from "./shared.js";
import { claudeProviderOf, maskEmail } from "./shared.js";

assert.equal(maskEmail("someone@example.com"), "s******@example.com");
// Never fewer than three stars, so a short local part does not leak its length.
assert.equal(maskEmail("ab@x.io"), "a***@x.io");
// Not an address: the placeholders these callers pass through are left alone.
assert.equal(maskEmail("logged in"), "logged in");
assert.equal(maskEmail("@host"), "@host");
assert.equal(maskEmail(""), "");

// A session the tab has never opened has no model directory — dsh's `directoryFor` throws for it —
// so the provider has to come off the cold list row. dsh's `projectList` flattens the summary's
// projection block onto the row as `projectionValues`, and reading any other shape leaves a Claude
// session looking like a dsh one (the sidebar dot stays blue until the row is clicked).
const coldCtx = (modelSelection: unknown): ClientCtx =>
  ({
    modelDirectories: {
      directoryFor: () => {
        throw new Error('ui-model-selection: session "s1" resolved no scope');
      },
    },
    sessions: {
      list: {
        getSnapshot: () => ({ byId: { s1: { id: "s1", projectionValues: { modelSelection } } } }),
      },
    },
  }) as unknown as ClientCtx;

// `next` is the pending pick; it answers first.
assert.equal(
  claudeProviderOf(coldCtx({ lastUsed: null, next: { provider: "claude-code-nova" } }), "s1"),
  "claude-code-nova",
);
// No pick pending: the last request's header still names the mount.
assert.equal(
  claudeProviderOf(coldCtx({ lastUsed: { provider: "claude-code" }, next: null }), "s1"),
  "claude-code",
);
// A session on another provider is not ours, and neither is a row with no selection at all.
assert.equal(
  claudeProviderOf(coldCtx({ lastUsed: { provider: "deepseek" }, next: null }), "s1"),
  undefined,
);
assert.equal(claudeProviderOf(coldCtx(undefined), "s1"), undefined);

console.log("✓ All login mask checks pass");
