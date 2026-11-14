// `isolate`: no user settings, hooks or MCP servers reach Claude Code, the plugin passes its own
// settings and privacy environment, two inherited names are removed, and the engine digest keys a
// process only when the config leaves its defaults.
import { strict as assert } from "node:assert";
import { childEnv } from "../process.js";
import { buildArgs } from "./cli.js";
import { Config } from "./config.js";
import { ISOLATED_ENV, engineDigest } from "./isolate.js";

/** The value after `flag`, or undefined when the flag is absent. */
const valueOf = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const plain = buildArgs({ model: "m", config: new Config({}) });
assert.ok(!plain.includes("--setting-sources") && !plain.includes("--strict-mcp-config"));
assert.equal(valueOf(plain, "--settings"), undefined, "the default passes no settings");

const isolated = buildArgs({ model: "m", config: new Config({ isolate: true, fastMode: true }) });
assert.equal(valueOf(isolated, "--setting-sources"), "", "no settings source at all");
assert.ok(isolated.includes("--strict-mcp-config"));
const settings = JSON.parse(valueOf(isolated, "--settings") ?? "{}");
assert.equal(settings.autoMemoryEnabled, false);
assert.equal(settings.awaySummaryEnabled, false);
assert.deepEqual(settings.attribution, { commit: "", pr: "" });
assert.equal(settings.fastMode, true, "fast mode rides in the same settings");
const aux = buildArgs({
  model: "m",
  config: new Config({ isolate: true }),
  purpose: "session-title",
});
assert.ok(aux.includes("--strict-mcp-config"), "a side call reads no user settings either");

const env = childEnv(
  {
    CLAUDE_CODE_SIMPLE: "1",
    CLAUDE_CODE_EFFORT_LEVEL: "low",
    MCP_TOOL_TIMEOUT: "60000",
    HOME: "/h",
  },
  ISOLATED_ENV,
);
assert.equal(env.CLAUDE_CODE_SIMPLE, undefined, "removed, not emptied");
assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, undefined);
assert.equal(env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING, undefined);
assert.equal(env.MCP_TOOL_TIMEOUT, "2000000000");
assert.equal(env.DISABLE_TELEMETRY, "1");
assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
assert.equal(env.HOME, "/h");
assert.ok(Number(ISOLATED_ENV.MCP_TOOL_TIMEOUT) < 2 ** 31, "under setTimeout's ceiling");

assert.equal(engineDigest(new Config({})), undefined, "defaults key as before");
const a = engineDigest(new Config({ isolate: true }));
assert.ok(a);
assert.notEqual(engineDigest(new Config({ isolate: true, builtinTools: ["ToolSearch"] })), a);
assert.notEqual(engineDigest(new Config({ toolLoading: "dsh" })), undefined);

console.log("isolate: ok");
