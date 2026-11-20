// Mounting accounts: one local instance per saved account, with its config dir and name, the
// default mount's bridge shared, an id something else holds left alone, a dropped account withdrawn.
import { strict as assert } from "node:assert";
import type { PluginContext } from "../dsh.js";
import { type AccountMount, localMountsOf, reconcileAccounts } from "./accounts.js";
import { heldByOther, tagPluginMount } from "./ssh-boxes.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";

const registered: string[] = [];
const disposed: string[] = [];
// SAFETY: reconcileAccounts reaches the context through `llm` and the constructor through `on`
const ctx = {
  on() {},
  llm: {
    registerConfigurableProviders: (rows: Array<{ provider: string }>) => {
      registered.push(`dir:${rows[0]?.provider}`);
      return () => disposed.push(`dir:${rows[0]?.provider}`);
    },
    registerAdapter: (ids: string[]) => {
      registered.push(`adapter:${ids[0]}`);
      return () => disposed.push(`adapter:${ids[0]}`);
    },
  },
} as unknown as PluginContext;
// A command that answers nothing, so the mount's login probe reads logged out and spawns no Claude.
// The transcript mirror is on for the default; an account must not inherit it.
const base = Config({ command: "/bin/false", ownTranscripts: true });
const mounts = new Map<string, AccountMount>();
const adapters = new Map<string, ClaudeCodeAdapter>();
const handWritten = new ClaudeCodeAdapter(ctx, Config({ providerId: "claude-code-side" }));
adapters.set("claude-code-side", handWritten);
// SAFETY: the bridge is only carried, never called, in this test
const bridge = { key: "k" } as unknown as ClaudeCodeAdapter["mcp"];
const mounting = Promise.resolve();
const logs: string[] = [];
/** One reconcile of this scope's `mounts` against `accounts`, logging into `logs`. */
const run = (accounts: Array<{ name: string; configDir: string }>) =>
  reconcileAccounts(
    ctx,
    base,
    accounts,
    mounts,
    adapters,
    { mcp: () => bridge, mounting: () => mounting },
    (_l, m) => logs.push(m),
  );

run([
  { name: "Work", configDir: "/tmp/omc-acct-r/work" },
  { name: "Side", configDir: "/tmp/omc-acct-r/side" },
]);
const work = adapters.get("claude-code-work");
assert.ok(work && work !== handWritten);
assert.equal(work.displayName, "Work");
assert.equal(work.realClaudeHome, "/tmp/omc-acct-r/work");
assert.equal(work.config.sshHost, "");
assert.equal(work.loginKey, "dir:/tmp/omc-acct-r/work");
assert.equal(work.mcp, bridge, "the account gets dsh's tools through the shared bridge");
assert.equal(work.mcpMounting, mounting);
assert.equal(
  work.claudeHome,
  work.realClaudeHome,
  "an account runs on its own dir, never a mirror",
);
assert.deepEqual(registered, ["dir:claude-code-work", "adapter:claude-code-work"]);
assert.equal(adapters.get("claude-code-side"), handWritten, "a hand-written mount is left alone");
assert.ok(logs.some((l) => l.includes("already mounted; skipped")));

// Dropping Work withdraws it; running it again with the same list changes nothing.
run([]);
assert.deepEqual(disposed, ["adapter:claude-code-work", "dir:claude-code-work"]);
assert.equal(adapters.has("claude-code-work"), false);
assert.equal(adapters.get("claude-code-side"), handWritten, "and still is on withdraw");
run([]);
assert.equal(disposed.length, 2);

// The routes' view of the mounts: accounts and hand-written ones, never the default or an SSH box.
{
  const main = new ClaudeCodeAdapter(ctx, Config({}));
  const box = new ClaudeCodeAdapter(
    ctx,
    Config({ providerId: "claude-code-nova", sshHost: "nova" }),
  );
  const own = new ClaudeCodeAdapter(
    ctx,
    Config({
      providerId: "claude-code-work",
      providerName: "Work",
      configDir: "/tmp/omc-acct-r/work",
    }),
  );
  assert.deepEqual(localMountsOf([main, box, own, handWritten]), [
    {
      provider: "claude-code-work",
      name: "Work",
      home: "/tmp/omc-acct-r/work",
      loginKey: "dir:/tmp/omc-acct-r/work",
    },
    {
      provider: "claude-code-side",
      name: handWritten.displayName,
      home: handWritten.realClaudeHome,
      loginKey: "",
    },
  ]);
}

// After an in-process re-apply the new scope starts with an empty `mounts` map while the shared
// registry still holds the old scope's account: that one is the plugin's own, so it is mounted over.
{
  const again = new Map<string, AccountMount>();
  const before = registered.length;
  reconcileAccounts(
    ctx,
    base,
    [{ name: "Work", configDir: "/tmp/omc-acct-r/work" }],
    mounts,
    adapters,
    { mcp: () => bridge, mounting: () => mounting },
    () => {},
  );
  const first = adapters.get("claude-code-work");
  reconcileAccounts(
    ctx,
    base,
    [{ name: "Work", configDir: "/tmp/omc-acct-r/work" }],
    again,
    adapters,
    { mcp: () => bridge, mounting: () => mounting },
    () => {},
  );
  assert.equal(registered.length - before, 4, "registered once per scope");
  assert.ok(adapters.get("claude-code-work") !== first, "the new scope's instance is the one held");
  assert.equal(
    adapters.get("claude-code-side"),
    handWritten,
    "the hand-written mount still is not",
  );
  assert.equal(heldByOther(adapters, "claude-code-side"), true);
  assert.equal(heldByOther(adapters, "claude-code-work"), false);
  const loose = new Map([["claude-code-x", handWritten]]);
  tagPluginMount(handWritten);
  assert.equal(heldByOther(loose, "claude-code-x"), false, "a tagged entry is the plugin's own");
}
console.log("account mounts ok");
