// Offline self-check for the login mask: every surface that names the account runs through it.
import assert from "node:assert/strict";
import type { ClientCtx } from "./shared.js";
import {
  claudeProviderOf,
  groupSkillsByScope,
  maskEmail,
  numberOr,
  openSession,
  openSessionId,
  resumeCommand,
  skillStateFromReply,
} from "./shared.js";

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

assert.equal(numberOr(5), 5);
assert.equal(numberOr(true), undefined);
assert.equal(numberOr(undefined), undefined);

assert.equal(resumeCommand("abc", undefined), "claude --resume abc");
assert.equal(resumeCommand("abc", "/w/a"), "cd '/w/a' && claude --resume abc");
assert.equal(resumeCommand("abc", "/w/it's"), "cd '/w/it'\\''s' && claude --resume abc");
assert.equal(resumeCommand("abc", "/w/a", "nova"), "ssh nova \"cd '/w/a' && claude --resume abc\"");

// Which session is on screen, in both shapes dsh has had for it. Kept as one check so dropping
// dsh 0.1.5 means deleting the halves marked 0.1.5 here and in `shared.ts` together.
const listCtx = (snapshot: unknown): ClientCtx =>
  ({ sessions: { list: { getSnapshot: () => snapshot } } }) as unknown as ClientCtx;

// dsh 0.1.5: the snapshot names it outright.
assert.equal(openSessionId(listCtx({ current: "s1", byId: {} })), "s1");
// dsh 0.1.6-alpha.2: no `current`, and the main view's retention marks the row instead.
assert.equal(
  openSessionId(
    listCtx({ byId: { s1: { retainedBy: { sidebar: 1 } }, s2: { retainedBy: { mainView: 1 } } } }),
  ),
  "s2",
);
// A retention the main view has let go of is not a selection.
assert.equal(openSessionId(listCtx({ byId: { s1: { retainedBy: {} } } })), undefined);
assert.equal(openSessionId(listCtx(undefined)), undefined);
// `current` wins when both are there, so 0.1.5 never pays for the scan.
assert.equal(
  openSessionId(listCtx({ current: "s1", byId: { s2: { retainedBy: { mainView: 1 } } } })),
  "s1",
);

// Navigation, the same two shapes. 0.1.5 answers on the sessions service itself.
{
  const opened: string[] = [];
  const ctx = {
    sessions: { open: (id: string) => opened.push(`sessions:${id}`) },
    get: () => undefined,
  } as unknown as ClientCtx;
  openSession(ctx, "s1");
  assert.deepEqual(opened, ["sessions:s1"]);
}
// 0.1.6-alpha.2 moved it to `uiWorkspace`, reached through `ctx.get` so a host without it mounts.
{
  const opened: string[] = [];
  const ctx = {
    sessions: {},
    get: (name: string) =>
      name === "uiWorkspace"
        ? { openSession: (id: string) => opened.push(`uiWorkspace:${id}`) }
        : undefined,
  } as unknown as ClientCtx;
  openSession(ctx, "s1");
  assert.deepEqual(opened, ["uiWorkspace:s1"]);
}

// groupSkillsByScope sorts each scope into its bucket; an unknown scope falls to plugin.
{
  const g = groupSkillsByScope([
    { scope: "user", name: "a" },
    { scope: "project", name: "b" },
    { scope: "plugin:foo", name: "c" },
    { scope: "something-else", name: "d" },
  ]);
  assert.deepEqual(
    g.user.map((r) => r.name),
    ["a"],
  );
  assert.deepEqual(
    g.project.map((r) => r.name),
    ["b"],
  );
  assert.deepEqual(
    g.plugin.map((r) => r.name),
    ["c", "d"],
  );
}

// skillStateFromReply maps each /skill-doctor reply shape to its SkillState.
assert.deepEqual(skillStateFromReply({ ok: true, report: "Skills loaded" }), {
  kind: "report",
  text: "Skills loaded",
  partial: false,
});
assert.deepEqual(skillStateFromReply({ ok: true, report: "u only", partial: true }), {
  kind: "report",
  text: "u only",
  partial: true,
});
assert.deepEqual(skillStateFromReply({ ok: false, declined: true, error: "no_user_skills" }), {
  kind: "declined",
  text: "no_user_skills",
});
assert.deepEqual(skillStateFromReply({ ok: false, error: "boom" }), {
  kind: "error",
  text: "boom",
});

console.log("✓ All login mask checks pass");
