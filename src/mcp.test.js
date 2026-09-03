import assert from "node:assert/strict";
import { handleRpc } from "./mcp.js";

const agent = { id: "a1" };
const echo = {
  name: "subagent_local",
  description: "spawn",
  parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
  output: { render: (_a, r) => [{ type: "text", text: `ran:${r.output}` }] },
  execute: (args, exec) => {
    assert.equal(exec.agent, agent, "tool sees the session agent");
    return { output: args.prompt };
  },
};
const tools = {
  schemas: (scope) => (scope === agent ? [echo, { name: "bash", parameters: {} }] : []),
  get: (name, scope) => (scope === agent && name === echo.name ? echo : undefined),
};
const env = { tools, agent, signal: new AbortController().signal, version: "t" };

assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, env), null);
const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, env);
assert.equal(init.result.serverInfo.name, "dsh");
const list = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, env);
assert.deepEqual(
  list.result.tools.map((t) => t.name),
  ["subagent_local"],
  "native shell/file tools are hidden",
);
assert.deepEqual(
  list.result.tools[0].inputSchema,
  echo.parameters,
  "dsh schemas pass through untouched",
);
const call = await handleRpc(
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "subagent_local", arguments: { prompt: "hi" } },
  },
  env,
);
assert.deepEqual(call.result.content, [{ type: "text", text: "ran:hi" }]);
const bad = await handleRpc(
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "bash" } },
  env,
);
assert.equal(bad.result.isError, true, "hidden tools cannot be called either");
console.log("mcp ok");
