// Offline self-check: bun src/switches.test.ts. No CLI, no network.
import assert from "node:assert/strict";
import { claudeMdDisabledBy, DEFAULT_RETENTION_DAYS, featureSwitches } from "./switches.js";

const scopes = (files: Record<string, unknown>) =>
  Object.entries(files).map(([scope, value]) => ({ scope, text: JSON.stringify(value) }));

// Nothing set: the sweep still runs, on the CLI's own default, and neither switch is on.
{
  const out = featureSwitches(scopes({ managed: {}, local: {}, project: {}, user: {} }), {});
  assert.deepEqual(out.retention, { days: DEFAULT_RETENTION_DAYS, scope: null });
  assert.equal(out.bypassDisabled, undefined);
  assert.equal(out.checkpointingDisabled, false);
}

// Retention comes from the user file, and from the managed file over it.
{
  const user = featureSwitches(scopes({ user: { cleanupPeriodDays: 3 } }), {});
  assert.deepEqual(user.retention, { days: 3, scope: "user" });
  const both = featureSwitches(
    scopes({ managed: { cleanupPeriodDays: 7 }, user: { cleanupPeriodDays: 3 } }),
    {},
  );
  assert.deepEqual(both.retention, { days: 7, scope: "managed" }, "the higher scope decides");
}

// A project file's retention is ignored: the CLI reads the key from policy and user settings only.
{
  const out = featureSwitches(scopes({ project: { cleanupPeriodDays: 1 }, user: {} }), {});
  assert.deepEqual(out.retention, { days: DEFAULT_RETENTION_DAYS, scope: null });
}

// Values the CLI's schema rejects leave the default standing rather than reporting a wrong number.
for (const days of [0, -5, 2.5, "30", null]) {
  const out = featureSwitches(scopes({ user: { cleanupPeriodDays: days } }), {});
  assert.deepEqual(
    out.retention.scope,
    null,
    `cleanupPeriodDays ${String(days)} is not a retention`,
  );
}

// Bypass: the CLI's own string, a hand-written boolean, and a value that means neither.
{
  const off = featureSwitches(
    scopes({ user: { permissions: { disableBypassPermissionsMode: "disable" } } }),
    {},
  );
  assert.deepEqual(off.bypassDisabled, { scope: "user" });
  const written = featureSwitches(
    scopes({ project: { permissions: { disableBypassPermissionsMode: true } } }),
    {},
  );
  assert.deepEqual(written.bypassDisabled, { scope: "project" });
  const on = featureSwitches(
    scopes({ user: { permissions: { disableBypassPermissionsMode: "allow" } } }),
    {},
  );
  assert.equal(on.bypassDisabled, undefined);
}

// A file that is not JSON says nothing about any of it, and does not throw.
{
  const out = featureSwitches([{ scope: "user", text: "{ nope" }], {});
  assert.deepEqual(out.retention, { days: DEFAULT_RETENTION_DAYS, scope: null });
  assert.equal(out.bypassDisabled, undefined);
}

// Checkpointing: any non-empty value is on, because the CLI's check is truthiness.
{
  for (const value of ["1", "0", "false"])
    assert.equal(
      featureSwitches([], { CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: value }).checkpointingDisabled,
      true,
      `${value} disables checkpointing`,
    );
  assert.equal(
    featureSwitches([], { CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: "" }).checkpointingDisabled,
    false,
  );
}

// Usage limits: the plugin's own flag is what acts, and the CLI's key is reported as it is found.
{
  const none = featureSwitches(scopes({ user: {} }), {});
  assert.deepEqual(none.usageLimit, { plugin: true, cli: null }, "unset is not off");
  const off = featureSwitches(scopes({ user: { autoContinueAtUsageLimit: false } }), {}, false);
  assert.deepEqual(off.usageLimit, { plugin: false, cli: false });
  const higher = featureSwitches(
    scopes({
      project: { autoContinueAtUsageLimit: true },
      user: { autoContinueAtUsageLimit: false },
    }),
    {},
  );
  assert.deepEqual(higher.usageLimit.cli, true, "the higher scope decides");
}

// CLAUDE.md loading: nothing set anywhere leaves it on.
{
  assert.equal(claudeMdDisabledBy(scopes({ user: {} }), undefined, true), undefined);
  assert.equal(claudeMdDisabledBy([], undefined, true), undefined);
}

// A settings file sets it, and the scope that did is named. Only the CLI's two true values count.
{
  const off = { env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" } };
  assert.equal(claudeMdDisabledBy(scopes({ project: off }), undefined, true), "project");
  assert.equal(
    claudeMdDisabledBy(
      scopes({ user: { env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "true" } } }),
      undefined,
      true,
    ),
    "user",
  );
  assert.equal(
    claudeMdDisabledBy(
      scopes({ user: { env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "0" } } }),
      undefined,
      true,
    ),
    undefined,
    "the CLI reads 0 as unset, so the files still load",
  );
}

// The environment dsh runs in is the other half, and only a local child inherits it. The remote pair
// is the test that keeps the row from claiming a box's shell it cannot read.
{
  assert.equal(claudeMdDisabledBy([], "1", true), "env");
  assert.equal(claudeMdDisabledBy([], "1", false), undefined, "an ssh box's shell is unreadable");
  assert.equal(claudeMdDisabledBy([], "0", true), undefined);
}

// Settings beat the environment either way, because the CLI spreads a file's env over what it
// inherited. A "0" in the highest file that names the key turns a set variable back on.
{
  assert.equal(
    claudeMdDisabledBy(
      scopes({ user: { env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "0" } } }),
      "1",
      true,
    ),
    undefined,
  );
  assert.equal(
    claudeMdDisabledBy(
      scopes({
        project: { env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "0" } },
        user: { env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" } },
      }),
      undefined,
      true,
    ),
    undefined,
    "the first scope that names the key decides; the lower file changes nothing",
  );
}

console.log("switches ok");
