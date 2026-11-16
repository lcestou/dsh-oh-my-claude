// Claude Code compacts on its own at dsh's threshold. dsh asks for its compaction between steps,
// and a Claude Code mid-turn can only refuse, so a long turn (a subagent on one long job) ran past
// dsh's threshold to the CLI's own, about 97% of the window, paying for the whole context on every
// step.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeAdapter, Config } from "../adapter.js";
import type { PluginContext } from "../dsh.js";
import { stateDir } from "../state.js";
import { buildArgs, probeCli } from "./cli.js";
import { AUTOCOMPACT_PCT_ENV, cliCompactPct } from "./cli-compaction.js";

// dsh's threshold, resolved as `dsh-compaction-basic` does: min(window × ratio, window − headroom
// − output reservation), as a percentage of the window, rounded down.
const route = { provider: "claude-code", model: "claude-opus-5-5" };
assert.equal(cliCompactPct({ thresholdRatio: 0.25 }, route, 1_000_000, 32_000), 25);
assert.equal(cliCompactPct({}, route, 1_000_000, 32_000), 80, "dsh's own default, 80%");
assert.equal(
  cliCompactPct({}, route, 200_000, 32_000),
  51.2,
  "a small window: headroom and the output reservation decide",
);
assert.equal(cliCompactPct({ thresholdRatio: 0.333 }, route, 1_000_000), 33.3);
assert.equal(
  cliCompactPct(
    {
      thresholdRatio: 0.25,
      modelPolicies: [
        { ...route, thresholdRatio: 0.5 },
        { provider: "x", model: "y" },
      ],
    },
    route,
    1_000_000,
  ),
  50,
  "a policy for the exact route wins",
);
assert.equal(cliCompactPct({ auto: false, thresholdRatio: 0.25 }, route, 1_000_000), undefined);
assert.equal(cliCompactPct(undefined, route, 1_000_000), undefined, "no compaction service");
assert.equal(cliCompactPct({ thresholdRatio: 0.25 }, route, undefined), undefined, "no window");
assert.equal(cliCompactPct({ thresholdRatio: 1 }, route, 1_000_000, 0), 93.4);
assert.equal(cliCompactPct({ headroomTokens: 1_000_000 }, route, 1_000_000), undefined);

// The command line: the variable rides in `--settings`' `env`, which the CLI copies into its
// own environment at start (measured on 2.1.325), so a keeper and a box get it as a child does.
const settingsOf = (args: string[]) => {
  const at = args.indexOf("--settings");
  return at < 0 ? undefined : JSON.parse(args[at + 1] ?? "{}");
};
const flags = new Set(["--settings", "--input-format"]);
const base = { model: "claude-opus-5-5", config: Config({}), flags };
assert.deepEqual(settingsOf(buildArgs({ ...base, compactPct: 25 })).env, {
  [AUTOCOMPACT_PCT_ENV]: "25",
});
assert.ok(settingsOf(buildArgs({ ...base, compactPct: 25 })).hooks, "the hooks stay");
assert.equal(settingsOf(buildArgs(base)).env, undefined, "none picked, none sent");
assert.equal(
  settingsOf(buildArgs({ ...base, compactPct: 25, purpose: "session-title" })),
  undefined,
  "a side call compacts nothing",
);

// A turn's preparation: dsh's threshold for the session's route lands on the command line and on
// the spec, so a changed threshold starts a new process on the session's next turn.
{
  const providerId = "claude-code-threshold";
  mkdirSync(stateDir(providerId), { recursive: true });
  writeFileSync(join(stateDir(providerId), "cli-models.json"), JSON.stringify([]));
  await probeCli(
    (_cmd, args, _opts, cb) =>
      cb(
        null,
        (args.at(-1) ?? "").includes("--help")
          ? "  --input-format <f>\n  --settings <s>\n"
          : "2.1.325\n",
      ),
    "claude",
  );
  let config: object | undefined = { thresholdRatio: 0.25, retainRatio: 0.1 };
  const ctx = {
    on() {},
    logger: { info() {}, warn() {} },
    get: (name: string) =>
      name === "compaction" ? { config, compactNow: async () => null } : undefined,
  } as unknown as PluginContext;
  const a = new ClaudeCodeAdapter(
    ctx,
    Config({ providerId, dshTools: false, spawn: "node" }),
  ) as any;
  a.stateDir = stateDir(providerId);
  const turn = () =>
    a.prepare({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-opus-5-5",
      sessionId: "s-threshold",
    });
  const first = await turn();
  assert.equal(first.spec.compactPct, 25, "dsh's 25% of the window");
  assert.equal(settingsOf(first.args).env[AUTOCOMPACT_PCT_ENV], "25");

  config = { thresholdRatio: 0.3, retainRatio: 0.1 };
  assert.equal((await turn()).spec.compactPct, 30, "a changed threshold changes the key");

  // Someone set the CLI's variable themselves: theirs stands.
  process.env[AUTOCOMPACT_PCT_ENV] = "60";
  const theirs = await turn();
  assert.equal(theirs.spec.compactPct, undefined);
  assert.equal(settingsOf(theirs.args)?.env, undefined);
  delete process.env[AUTOCOMPACT_PCT_ENV];

  // dsh compacting on its own off, or the plugin's dsh-driven compaction off: the CLI keeps its own.
  config = { auto: false, thresholdRatio: 0.25 };
  assert.equal((await turn()).spec.compactPct, undefined);
  config = { thresholdRatio: 0.25 };
  const off = new ClaudeCodeAdapter(
    ctx,
    Config({ providerId, dshTools: false, spawn: "node", cliCompaction: false }),
  ) as any;
  off.stateDir = stateDir(providerId);
  assert.equal(
    (
      await off.prepare({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-opus-5-5",
        sessionId: "s-off",
      })
    ).spec.compactPct,
    undefined,
  );
}
console.log("cli compact threshold ok");
