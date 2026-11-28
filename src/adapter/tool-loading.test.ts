// `toolLoading: dsh`: a bridged tool dsh loads up front carries Claude Code's alwaysLoad key, a
// tool dsh defers does not, and the default mode lists the tools as before.
import { strict as assert } from "node:assert";
import type { DshToolsRegistry } from "../dsh.js";
import { ALWAYS_LOAD, handleRpc } from "../mcp.js";
import type { RpcEnv } from "../mcp.js";
import { fakeAgent, rpcTools } from "../test-context.js";
import { Config } from "./config.js";

const schema = (name: string) => ({ name, description: "", parameters: { type: "object" } });

const tools: DshToolsRegistry = {
  schemas: () => [schema("bash"), { ...schema("ha_restart"), deferLoading: true }],
  get: () => undefined,
};

const META = "_meta";

/** What tools/list answers, with `alwaysLoad` as given. */
const listed = async (alwaysLoad?: boolean) => {
  const env: RpcEnv = {
    tools,
    agent: fakeAgent(),
    signal: new AbortController().signal,
    version: "t",
    alwaysLoad,
  };

  return rpcTools(await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, env));
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
