// `builtinTools`: the `--tools` list the CLI starts with, the dsh file tools the bridge offers in
// place of the Claude Code ones left out, and the guidance that names them.
import { strict as assert } from "node:assert";
import type { DshToolsRegistry } from "../dsh.js";
import { handleRpc, HIDDEN, hiddenFor } from "../mcp.js";
import type { RpcEnv } from "../mcp.js";
import {
  fakeAgent,
  fieldsOf,
  rpcFirstText,
  rpcReadOnly,
  rpcResult,
  rpcToolNames,
  rpcTools,
} from "../test-context.js";
import { buildArgs, dshToolsGuidance } from "./cli.js";
import { Config } from "./config.js";

/** The value after `flag`, or undefined when the flag is absent. */
const valueOf = (args: Array<string>, flag: string) => {
  const i = args.indexOf(flag);

  return i === -1 ? undefined : args[i + 1];
};

assert.equal(valueOf(buildArgs({ model: "m", config: new Config({}) }), "--tools"), "default");

assert.equal(
  valueOf(
    buildArgs({ model: "m", config: new Config({ builtinTools: ["ToolSearch"] }) }),
    "--tools",
  ),
  "ToolSearch",
);

assert.equal(
  valueOf(buildArgs({ model: "m", config: new Config({ builtinTools: [] }) }), "--tools"),
  "",
  "an empty list switches every built-in off",
);

assert.equal(hiddenFor(["default"]), HIDDEN, "default: Claude Code's file tools, dsh's stay off");

assert.deepEqual([...hiddenFor(["ToolSearch"])], ["run_code"], "none native: every file tool");

const someNative = hiddenFor(["Read", "Grep", "ToolSearch"]);

assert.ok(someNative.has("read") && someNative.has("grep") && !someNative.has("edit"));

assert.ok(hiddenFor(["Bash,Edit"]).has("multi_edit"), "a comma list counts as names too");

const schema = (name: string, ...params: Array<string>) => ({
  name,
  description: "",
  parameters: { type: "object", properties: Object.fromEntries(params.map((p) => [p, {}])) },
});

const tools: DshToolsRegistry = {
  schemas: () => [schema("read"), schema("bash", "run_in_background"), schema("run_code")],
  get: (name) => ({
    ...schema(name),
    execute: async () => [{ type: "text", text: `ran ${name}` }],
  }),
};

/** The env handleRpc runs under, with `hidden` as the session's hidden tools. */
const env = (hidden?: ReadonlySet<string>): RpcEnv => ({
  tools,
  agent: fakeAgent(),
  signal: new AbortController().signal,
  version: "t",
  hidden,
});

/** The tool names tools/list answers with under `hidden`. */
const listed = async (hidden?: ReadonlySet<string>) => {
  return rpcToolNames(
    await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, env(hidden)),
  );
};

assert.deepEqual(await listed(), ["bash"], "default: read stays Claude Code's");

assert.deepEqual(await listed(hiddenFor(["ToolSearch"])), ["read", "bash"]);

const called = await handleRpc(
  { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read", arguments: {} } },
  env(hiddenFor(["ToolSearch"])),
);

assert.equal(rpcResult(called).isError, undefined);

assert.equal(rpcFirstText(called), "ran read");

// A served dsh writer changes files, so it is listed without the read-only hint and Claude Code
// runs it one call at a time; a reader keeps the hint and runs in parallel.
{
  const withWrite: RpcEnv = {
    ...env(hiddenFor(["ToolSearch"])),
    tools: { ...tools, schemas: () => [schema("read"), schema("write")] },
  };

  const reply = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, withWrite);

  const hint = Object.fromEntries(
    rpcTools(reply).map((t) => [fieldsOf(t, { name: "string" }).name, rpcReadOnly(t)]),
  );

  assert.deepEqual(hint, { read: true, write: false });
}

const bash = [schema("bash", "run_in_background"), schema("job_output")];
const mixed = dshToolsGuidance(bash);

assert.ok(mixed.includes("Short foreground commands stay on native `Bash`"));

assert.ok(!mixed.includes("without a prefix"));

const engine = dshToolsGuidance(bash, ["ToolSearch"]);

assert.ok(engine.includes("Every command goes through `mcp__dsh__bash`"));

assert.ok(!engine.includes("native `Bash`"), "no native shell to send short commands to");

assert.ok(engine.includes("is the mcp__dsh__ tool of that name"));

console.log("builtin-tools: ok");
