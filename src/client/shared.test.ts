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
  revive,
  parseSkillCosts,
  resumeCommand,
  skillStateFromReply,
  sortSkillCosts,
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
// A pending pick of another provider wins over a Claude turn that already ran: the switch is the
// newer truth, and reading `lastUsed` past it kept the Claude control on a session moved to dsh.
assert.equal(
  claudeProviderOf(
    coldCtx({ lastUsed: { provider: "claude-code" }, next: { provider: "deepseek" } }),
    "s1",
  ),
  undefined,
);

// An opened session has a live model directory, and its current provider is the answer whether or
// not it is Claude: a non-Claude read must not fall through to a stale Claude `lastUsed`.
const liveCtx = (provider: string, modelSelection: unknown): ClientCtx =>
  ({
    modelDirectories: {
      directoryFor: () => ({ store: { getSnapshot: () => ({ current: { provider } }) } }),
    },
    sessions: {
      list: {
        getSnapshot: () => ({ byId: { s1: { id: "s1", projectionValues: { modelSelection } } } }),
      },
    },
  }) as unknown as ClientCtx;
assert.equal(
  claudeProviderOf(
    liveCtx("deepseek", { lastUsed: { provider: "claude-code" }, next: null }),
    "s1",
  ),
  undefined,
);
assert.equal(
  claudeProviderOf(liveCtx("claude-code-nova", { lastUsed: { provider: "deepseek" } }), "s1"),
  "claude-code-nova",
);

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
// A throw that is not a disposed context answers undefined and leaves the bundle live: the next
// read still works. It used to retire everything until a refresh (owner, 2026-09-22: new sessions
// lost the Claude look after switching languages back and forth).
{
  const flaky = {
    sessions: {
      list: {
        getSnapshot: () => {
          throw new Error("store is being rebuilt");
        },
      },
    },
  } as unknown as ClientCtx;
  assert.equal(openSessionId(flaky), undefined);
  assert.equal(openSessionId(listCtx({ current: "s1", byId: {} })), "s1", "still live after it");
}
// A disposed context retires; `revive` (what apply runs first) brings the module back.
{
  const dead = {
    sessions: {
      list: {
        getSnapshot: () => {
          throw new Error('cannot get required service "sessions" in inactive context');
        },
      },
    },
  } as unknown as ClientCtx;
  assert.equal(openSessionId(dead), undefined);
  assert.equal(openSessionId(listCtx({ current: "s1", byId: {} })), undefined, "retired");
  revive();
  assert.equal(openSessionId(listCtx({ current: "s1", byId: {} })), "s1", "live again");
}
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

// parseSkillCosts turns the /skill-doctor raw report into one SkillCostRow per skill; a header that
// is not the six known columns returns null so the caller keeps the raw report instead of garbage.
const REPORT = [
  "Skills loaded this session",
  "",
  "  skill                            source          context  7d tokens   uses  last used",
  "  ask-matt                         userSettings          -          -     0×  never",
  "  n8n-node-configuration           userSettings       < 20          -     0×  never",
  "  llm-optim                        userSettings       ~100       1.9m     2×  3 days",
  "  local-subagent                   userSettings       ~270     188.5m    11×  1 day",
  "  unslop                           userSettings        ~20      54.3m    35×  today",
  "  caveman:caveman-evidence-review  plugin              ~35       2.1k     1×  2 days",
  "  writing-for-agents               userSettings        ~40       1.1m     2×  today",
  "",
  "  context = this skill's one-line listing in the system prompt, included every turn",
  "  (dash = not in the current listing, costs nothing; full SKILL.md loads only when it runs)",
  "  7d tokens = tokens attributed to the skill over the last 7 days of sessions on this machine",
  "",
  "42 skills loaded but never invoked. Each one adds to the system prompt every turn.",
].join("\n");

const WIDE = [
  "  skill                                      source           context  7d tokens   uses  last used",
  "  zz-a-very-long-skill-name-for-width-probe  projectSettings      ~30          -     0×  never",
].join("\n");

// 1. The report parses and holds exactly the seven skills under the header; the blank line stops the
//    table before the indented legend.
const parsed = parseSkillCosts(REPORT);
assert.notEqual(parsed, null);
const rows = parsed ?? [];
assert.equal(rows.length, 7);

// 2. The last row is the last skill, and no row's name ran past the blank line into the legend prose,
//    whose definition lines carry " = ".
assert.equal(rows[rows.length - 1]?.skill, "writing-for-agents");
assert.ok(rows.every((r) => !r.skill.includes(" = ")));

// 3. The first row's cells, including the dash and never placeholders.
assert.deepEqual(rows[0], {
  skill: "ask-matt",
  source: "userSettings",
  context: "-",
  tokens: "-",
  uses: "0×",
  lastUsed: "never",
});

// 4. A cell that contains a space survives the fixed-column slice: "< 20" and "3 days".
assert.equal(rows[1]?.context, "< 20");
assert.equal(rows[2]?.lastUsed, "3 days");

// 5. A header whose columns no longer line up with the six names is not a table.
assert.equal(parseSkillCosts(REPORT.replace("7d tokens", "7d toks  ")), null);

// 6. A wide header shifts with its widest row and still parses to one row.
const wideRows = parseSkillCosts(WIDE) ?? [];
assert.equal(wideRows.length, 1);
assert.equal(wideRows[0]?.source, "projectSettings");

// 7. Uses sort by magnitude, so 35× beats 11×.
assert.equal(sortSkillCosts(rows, "uses", "desc")[0]?.skill, "unslop");

// 8. Token magnitude orders 188.5m above 54.3m, which a string sort gets backwards.
assert.equal(sortSkillCosts(rows, "tokens", "desc")[0]?.skill, "local-subagent");

// 9. `never` has the largest magnitude, so it sorts last ascending. ask-matt and n8n-node-configuration
//    are both `never`; a stable sort keeps input order, so n8n lands last. Assert the invariant the
//    order depends on (a never row is last) rather than one specific never row.
assert.equal(sortSkillCosts(rows, "lastUsed", "asc").at(-1)?.lastUsed, "never");
// Both `never` rows tie, and a tie must not be NaN: Infinity minus Infinity is, and no sort owes a
// NaN comparator an answer. Their order is the report's order, and a today row sorts to the front.
assert.equal(sortSkillCosts(rows, "lastUsed", "asc")[0]?.lastUsed, "today");
assert.deepEqual(
  sortSkillCosts(rows, "lastUsed", "asc")
    .filter((r) => r.lastUsed === "never")
    .map((r) => r.skill),
  ["ask-matt", "n8n-node-configuration"],
);

console.log("✓ All login mask checks pass");
