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
const opened = [];
const env2 = { ...env, open: async (args) => (opened.push(args), "opened session s1") };
const list2 = await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/list" }, env2);
assert.deepEqual(
  list2.result.tools.map((t) => t.name),
  ["subagent_local", "open_session"],
  "open_session is offered when the host provides it",
);
const openCall = await handleRpc(
  {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "open_session", arguments: { prompt: "go" } },
  },
  env2,
);
assert.equal(openCall.result.content[0].text, "opened session s1");
assert.deepEqual(opened, [{ prompt: "go" }]);
const logged = [];
const boom = await handleRpc(
  {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "open_session", arguments: { prompt: "x" } },
  },
  {
    ...env2,
    open: async () => {
      throw new Error("prompt refused");
    },
    log: (...a) => logged.push(a),
  },
);
assert.equal(boom.result.isError, true, "open failure is an error reply, not a throw");
assert.match(boom.result.content[0].text, /prompt refused/);
assert.equal(logged.length, 1, "failure is logged once");
console.log("mcp ok");
