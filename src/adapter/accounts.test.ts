// Mounting accounts: one local instance per saved account, with its config dir and name, the
// default mount's bridge shared, an id something else holds left alone, a dropped account withdrawn.
import { strict as assert } from "node:assert";
import { ADAPTER_CURRENT } from "../dsh.js";
import type { McpBridge } from "../mcp.js";
import { fakeClaudeProcess, fakePluginContext, notFaked } from "../test-context.js";
import { localMountsOf, reconcileAccounts, serialAccounts } from "./accounts.js";
import type { AccountMount } from "./accounts.js";
import { heldByOther, tagPluginMount } from "./ssh-boxes.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { setTimeout as sleep } from "node:timers/promises";

const registered: Array<string> = [];
const disposed: Array<string> = [];

/** A registration handle whose call runs `withdraw`; a replace is not part of these cases. */
const registration = (withdraw: () => void) =>
  Object.assign(
    () => {
      withdraw();
    },
    { replace: notFaked("registration.replace") },
  );

// reconcileAccounts reaches the context through `llm` and the constructor through `on`.
const ctx = fakePluginContext({
  on() {},
  llm: {
    registerConfigurableProviders: (rows) => {
      registered.push(`dir:${rows[0]?.provider}`);

      return registration(() => disposed.push(`dir:${rows[0]?.provider}`));
    },
    registerAdapter: (ids) => {
      registered.push(`adapter:${ids[0]}`);

      return registration(() => disposed.push(`adapter:${ids[0]}`));
    },
  },
});

// A command that answers nothing, so the mount's login probe reads logged out and spawns no Claude.
// The transcript mirror is on for the default; an account must not inherit it.
const base = Config({ command: "/bin/false", ownTranscripts: true });
const mounts = new Map<string, AccountMount>();
const adapters = new Map<string, ClaudeCodeAdapter>();
const handWritten = new ClaudeCodeAdapter(ctx, Config({ providerId: "claude-code-side" }));

adapters.set("claude-code-side", handWritten);

// The bridge is only carried, never called, in this test.
const bridge: McpBridge = {
  base: "",
  key: "k",
  via: "webserver",
  toolsFor: notFaked("bridge.toolsFor"),
  openCalls: notFaked("bridge.openCalls"),
};

const mounting = Promise.resolve();
const logs: Array<string> = [];

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

// A restart mounts each account again and must adopt the keepers still running its sessions.
const adopted: Array<string> = [];
const adoptKeepers = ClaudeCodeAdapter.prototype.adoptKeepers;

ClaudeCodeAdapter.prototype.adoptKeepers = async function (this: ClaudeCodeAdapter) {
  adopted.push(this.providerId);

  return new Set<string>();
};

run([
  { name: "Work", configDir: "/tmp/omc-acct-r/work" },
  { name: "Side", configDir: "/tmp/omc-acct-r/side" },
]);

ClaudeCodeAdapter.prototype.adoptKeepers = adoptKeepers;

assert.deepEqual(adopted, ["claude-code-work"], "a new account mount adopts its own keepers");

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

// The mount-time login probe runs: /bin/false answers no login, so the name gains the suffix.
for (let i = 0; i < 50 && work.providerInfo("x").name === "Work"; i++) {
  await sleep(50);
}

assert.notEqual(work.providerInfo("x").name, "Work", "the new mount probes its login");

// Logged out, the picker's refusal names the account rather than this PC's hostname.
await assert.rejects(work.listModels("claude-code-work"), /not logged in on Work\./);

// The Models block and the new-session default name the account; a mount on the default dir is
// This box and stays unnamed. `adapters` stands in for the cross-process registry, as in the plugin.
{
  // SAFETY: the registry symbol is this plugin's own key on globalThis
  const g = globalThis as typeof globalThis & {
    [ADAPTER_CURRENT]?: Map<string, ClaudeCodeAdapter>;
  };

  g[ADAPTER_CURRENT] = adapters;
  const boxes = await work.pickerBoxes();
  delete g[ADAPTER_CURRENT];
  assert.equal(boxes.find((b) => b.provider === "claude-code-work")?.name, "Work");
  assert.equal(boxes.find((b) => b.provider === "claude-code-side")?.name, null);
}

// Dropping Work withdraws it and stops its running sessions; running it again with the same list
// changes nothing.
let killed = 0;

// Withdraw only calls kill on a held process.
work.processes.set(
  "claude-code-work:s1",
  fakeClaudeProcess({
    kill: () => {
      killed++;
    },
  }),
);

run([]);

assert.equal(killed, 1, "remove stops the account's sessions");

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
      command: "/opt/work/claude",
    }),
  );

  assert.deepEqual(localMountsOf([main, box, own, handWritten]), [
    {
      provider: "claude-code-work",
      name: "Work",
      home: "/tmp/omc-acct-r/work",
      loginKey: "dir:/tmp/omc-acct-r/work",
      command: "/opt/work/claude",
    },
    {
      provider: "claude-code-side",
      name: handWritten.displayName,
      home: handWritten.realClaudeHome,
      loginKey: "",
      command: handWritten.config.command,
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

// An SSH box saved under the account's name (two tabs at once, or a hand edit) holds the id live:
// dsh refuses the second registration, and the account is skipped with its directory row taken
// back, instead of the throw ending the reconcile.
{
  const live = new Set<string>();
  const rows: Array<string> = [];

  // As above, with a registry that refuses an id already live, the way dsh's does.
  const strict = fakePluginContext({
    on() {},
    llm: {
      registerConfigurableProviders: (r) => {
        rows.push(`+${r[0]?.provider}`);

        return registration(() => rows.push(`-${r[0]?.provider}`));
      },
      registerAdapter: (ids) => {
        const id = ids[0] ?? "";

        if (live.has(id)) {
          throw new Error(`DUPLICATE_ADAPTER ${id}`);
        }

        live.add(id);

        return registration(() => live.delete(id));
      },
    },
  });

  const box = new ClaudeCodeAdapter(
    strict,
    Config({ providerId: "claude-code-work", sshHost: "nova", configDir: "" }),
  );

  tagPluginMount(box);
  live.add("claude-code-work");
  const held = new Map([["claude-code-work", box]]);
  const seen: Array<string> = [];
  reconcileAccounts(
    strict,
    base,
    [{ name: "Work", configDir: "/tmp/omc-acct-r/work" }],
    new Map(),
    held,
    { mcp: () => bridge, mounting: () => mounting },
    (_l, m) => seen.push(m),
  );
  assert.equal(held.get("claude-code-work"), box, "the SSH box keeps its id");
  assert.deepEqual(rows, ["+claude-code-work", "-claude-code-work"]);
  assert.ok(seen.some((m) => m.includes("claude-code-work not mounted: DUPLICATE_ADAPTER")));
}

// The boot read and an add's reconcile queue one behind the other, each on the file as it is then,
// so a slow boot read cannot withdraw an account added while it ran.
{
  type List = Array<{ name: string; configDir: string }>;

  const added: List = [{ name: "Work", configDir: "/w" }];
  let releaseBoot: (l: List) => void = () => {};

  const bootRead = new Promise<List>((r) => {
    releaseBoot = r;
  });

  let file: List = [];
  const reads = [() => bootRead, async () => file];
  const applied: Array<List> = [];

  const reconcile = serialAccounts(
    () => (reads.shift() ?? (async () => file))(),
    (a) => applied.push(a),
  );

  const boot = reconcile();
  file = added;
  const add = reconcile();
  releaseBoot([]);
  await Promise.all([boot, add]);
  assert.deepEqual(applied.at(-1), added, "the add lands last, whatever the boot read saw");
}

console.log("account mounts ok");
