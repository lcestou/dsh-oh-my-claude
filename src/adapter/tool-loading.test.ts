// `toolLoading: dsh`: a bridged tool dsh loads up front carries Claude Code's alwaysLoad key, a
// tool dsh defers does not, and the default mode lists the tools as before.
import { strict as assert } from "node:assert";
import { ALWAYS_LOAD, handleRpc } from "../mcp.js";
import { Config } from "./config.js";

const schema = (name: string) => ({ name, description: "", parameters: { type: "object" } });
// SAFETY: partial fake registry for tests
const tools = {
  schemas: () => [schema("bash"), { ...schema("ha_restart"), deferLoading: true }],
  get: () => undefined,
};
const META = "_meta";
/** What tools/list answers, with `alwaysLoad` as given. */
const listed = async (alwaysLoad?: boolean) => {
  // SAFETY: test double carries only what handleRpc reads
  const env = {
    tools,
    agent: {},
    signal: new AbortController().signal,
    version: "t",
    alwaysLoad,
  } as unknown as Parameters<typeof handleRpc>[1];
  // SAFETY: tools/list always answers a result with tools
  const reply = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, env)) as {
    result: { tools: Record<string, unknown>[] };
  };
  return reply.result.tools;
};

const plain = await listed();
assert.ok(
  plain.every((t) => t[META] === undefined),
  "default: Claude Code decides",
);
const dsh = await listed(true);
assert.deepEqual(dsh.find((t) => t.name === "bash")?.[META], { [ALWAYS_LOAD]: true });
assert.equal(
  dsh.find((t) => t.name === "ha_restart")?.[META],
  undefined,
  "deferred stays deferred",
);

assert.equal(new Config({}).toolLoading, "claude");
console.log("tool-loading: ok");
