// `builtinTools`: the `--tools` list the CLI starts with, the dsh file tools the bridge offers in
// place of the Claude Code ones left out, and the guidance that names them.
import { strict as assert } from "node:assert";
import { handleRpc, HIDDEN, hiddenFor } from "../mcp.js";
import { buildArgs, dshToolsGuidance } from "./cli.js";
import { Config } from "./config.js";

/** The value after `flag`, or undefined when the flag is absent. */
const valueOf = (args: string[], flag: string) => {
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

const schema = (name: string, ...params: string[]) => ({
  name,
  description: "",
  parameters: { type: "object", properties: Object.fromEntries(params.map((p) => [p, {}])) },
});
// SAFETY: partial fake registry for tests
const tools = {
  schemas: () => [schema("read"), schema("bash", "run_in_background"), schema("run_code")],
  get: (name: string) => ({
    ...schema(name),
    execute: () => [{ type: "text", text: `ran ${name}` }],
  }),
};
// SAFETY: test double carries only what handleRpc reads
const env = (hidden?: ReadonlySet<string>) =>
  ({
    tools,
    agent: {},
    signal: new AbortController().signal,
    version: "t",
    hidden,
  }) as unknown as Parameters<typeof handleRpc>[1];
/** The tool names tools/list answers with under `hidden`. */
const listed = async (hidden?: ReadonlySet<string>) => {
  // SAFETY: tools/list always answers a result with tools
  const reply = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, env(hidden))) as {
    result: { tools: { name: string }[] };
  };
  return reply.result.tools.map((t) => t.name);
};
assert.deepEqual(await listed(), ["bash"], "default: read stays Claude Code's");
assert.deepEqual(await listed(hiddenFor(["ToolSearch"])), ["read", "bash"]);
// SAFETY: tools/call always answers a result
const called = (await handleRpc(
  { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read", arguments: {} } },
  env(hiddenFor(["ToolSearch"])),
)) as { result: { content: { text: string }[]; isError?: boolean } };
assert.equal(called.result.isError, undefined);
assert.equal(called.result.content[0]?.text, "ran read");
// A served dsh writer changes files, so it is listed without the read-only hint and Claude Code
// runs it one call at a time; a reader keeps the hint and runs in parallel.
{
  // SAFETY: test double carries only what handleRpc reads
  const withWrite = {
    ...env(hiddenFor(["ToolSearch"])),
    tools: { ...tools, schemas: () => [schema("read"), schema("write")] },
  } as unknown as Parameters<typeof handleRpc>[1];
  // SAFETY: tools/list always answers a result with tools
  const reply = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, withWrite)) as {
    result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
  };
  const hint = Object.fromEntries(
    reply.result.tools.map((t) => [t.name, t.annotations.readOnlyHint]),
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
