import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRpc, HIDDEN, KEY_HEADER, MCP_PATH, registerMcpBridge } from "./mcp.js";

const agent = { id: "a1" };
// SAFETY: partial fake for tests
const echo = {
  name: "subagent_local",
  description: "spawn",
  parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
  // SAFETY: cast to match tool shape
  output: {
    render: (_a: unknown, r: { output?: string }) => [{ type: "text", text: `ran:${r.output}` }],
  } as const,
  execute: (args: Record<string, unknown>, exec: { agent?: unknown }) => {
    assert.equal(exec.agent, agent, "tool sees the session agent");
    return { output: (args.prompt as string) ?? "" };
  },
};
// SAFETY: partial fake for tests
const tools = {
  schemas: (_scope: unknown) => [echo, { name: "bash", parameters: {} }],
  get: (name: string, _scope: unknown) => (name === echo.name ? echo : undefined),
};
// SAFETY: cast to HandleRpcParams shape for test double
const env = {
  tools,
  agent,
  signal: new AbortController().signal,
  version: "t",
} as unknown as Parameters<typeof handleRpc>[1];

assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, env), null);
// SAFETY: initialize always returns a response
const init = (await handleRpc(
  { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  env,
)) as { result: { serverInfo: { name: string } } } | null;
assert.ok(init);
assert.equal(init.result.serverInfo.name, "dsh");
// SAFETY: tools/list always returns a response
const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, env)) as {
  result: { tools: Array<{ name: string; inputSchema?: unknown }> };
} | null;
assert.ok(list);
assert.deepEqual(
  list.result.tools.map((t) => t.name),
  ["subagent_local", "bash"],
  "bash is bridged; only file tools remain hidden",
);
assert.ok(!HIDDEN.has("bash"), "bash is no longer hidden so dsh can register background jobs");
assert.ok(HIDDEN.has("read") && HIDDEN.has("edit"), "file tools stay hidden");
// SAFETY: tools array has at least one element for this test
const firstTool = list.result.tools[0];
assert.ok(firstTool);
assert.deepEqual(firstTool.inputSchema, echo.parameters, "dsh schemas pass through untouched");
const call = (await handleRpc(
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "subagent_local", arguments: { prompt: "hi" } },
  },
  env,
)) as { result: { content: Array<{ type: string; text?: string }> } } | null;
assert.ok(call);
assert.deepEqual(call.result.content, [{ type: "text", text: "ran:hi" }]);
const bad = (await handleRpc(
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool" } },
  env,
)) as { result: { isError?: boolean } } | null;
assert.ok(bad);
assert.equal(bad.result.isError, true, "unregistered tools still error");
const opened: unknown[] = [];
const env2 = { ...env, open: async (args: unknown) => (opened.push(args), "opened session s1") };
const list2 = (await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/list" }, env2)) as {
  result: { tools: Array<{ name: string }> };
} | null;
assert.ok(list2);
assert.deepEqual(
  list2.result.tools.map((t) => t.name),
  ["subagent_local", "bash", "open_session"],
  "open_session is offered when the host provides it",
);
const openCall = (await handleRpc(
  {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "open_session", arguments: { prompt: "go" } },
  },
  env2,
)) as { result: { content: Array<{ text?: string }> } } | null;
assert.ok(openCall);
// SAFETY: content[0] exists for open_session call
const firstContent = openCall.result.content[0];
assert.ok(firstContent);
assert.equal(firstContent.text, "opened session s1");
assert.deepEqual(opened, [{ prompt: "go" }]);
const logged: unknown[][] = [];
const boom = (await handleRpc(
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
    log: (...a: unknown[]) => logged.push(a),
  },
)) as { result: { isError?: boolean; content: Array<{ text?: string }> } } | null;
assert.ok(boom);
assert.equal(boom.result.isError, true, "open failure is an error reply, not a throw");
// SAFETY: content[0] exists for error response
const boomContent = boom.result.content[0];
assert.ok(boomContent);
assert.match(boomContent.text ?? "", /prompt refused/);
assert.equal(logged.length, 1, "failure is logged once");
const relayed = (await handleRpc(
  {
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: { name: "subagent_local", arguments: { a: 1 } },
  },
  {
    ...env,
    relay: async (name: string, args: unknown) => ({
      text: `relayed ${name} ${JSON.stringify(args)}`,
    }),
  },
)) as { result: { content: Array<{ text?: string }>; isError?: boolean } } | null;
assert.ok(relayed);
// SAFETY: content[0] exists for relayed call
const relayedContent = relayed.result.content[0];
assert.ok(relayedContent);
assert.equal(relayedContent.text, 'relayed subagent_local {"a":1}');
assert.equal(relayed.result.isError, undefined);
const fallback = (await handleRpc(
  {
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: { name: "subagent_local", arguments: {} },
  },
  { ...env, relay: async () => undefined },
)) as { result: { content: Array<{ text?: string }>; isError?: boolean } } | null;
assert.ok(fallback);
assert.equal(fallback.result.isError, undefined, "no live turn: executed directly");
// SAFETY: content[0] exists for fallback call
const fallbackContent = fallback.result.content[0];
assert.ok(fallbackContent);
assert.notEqual(fallbackContent.text, undefined);
const relayErr = (await handleRpc(
  {
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: { name: "subagent_local", arguments: {} },
  },
  { ...env, relay: async () => ({ text: "boom", isError: true }) },
)) as { result: { isError?: boolean } } | null;
assert.ok(relayErr);
assert.equal(relayErr.result.isError, true);
const listed = (await handleRpc({ jsonrpc: "2.0", id: 11, method: "tools/list" }, env)) as {
  result: { tools: Array<{ annotations?: { readOnlyHint?: boolean } }> };
} | null;
assert.ok(listed);
assert.ok(
  listed.result.tools.every((t) => t.annotations?.readOnlyHint === true),
  "dsh tools are marked concurrency-safe for the CLI",
);

// Under DSH Desktop the bridge serves new Claude processes from its own loopback listener, so the
// browser-access gate Desktop puts on web server routes cannot 403 it. The web server route stays
// registered as a fallback. A host without the gate keeps the web server route and starts nothing.
// Honor TMPDIR like the test script's DSH_OMC_STATE_DIR: sandboxed runs cannot write os.tmpdir().
const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "omc-mcp-"));
const cleanups: Array<() => void> = [];
// SAFETY: minimal host double: only what registerMcpBridge reads
/** A host double; `gated` adds the service DSH Desktop's launcher provides. */
const fakeHost = (gated: boolean) => ({
  inject: (
    _names: string[],
    cb: (host: {
      webServer: { port: number; register: (route: unknown) => () => void };
      tools: typeof tools;
      agents: { get: (_id: unknown) => typeof agent | undefined };
      sessions: object;
      sessionController: object;
      workspaceRegistry: object;
      get: (name: string) => object | undefined;
      effect: (fn: () => () => void) => () => void;
    }) => void,
  ) => {
    cb({
      webServer: {
        port: 43120,
        register: (_route: unknown) => () => {},
      },
      tools,
      agents: { get: (_id: unknown) => agent },
      sessions: {},
      sessionController: {},
      workspaceRegistry: {},
      get: (name: string) =>
        gated && name === "desktopBrowserAccess" ? { ordinaryBrowserEnabled: false } : undefined,
      effect: (fn: () => () => void) => {
        cleanups.push(fn());
        return () => {};
      },
    });
  },
});
// Plain dsh web: no gate service, so the URL is the web server's and no listener or port file
// appears. This is every install that is not Desktop, and it must not move.
// SAFETY: host double above carries the services registerMcpBridge needs
const plain = await registerMcpBridge(fakeHost(false) as never, {
  log: () => {},
  version: "t",
  keyFile: join(tmp, "mcp.key"),
});
assert.equal(plain.via, "webserver", "a host without the gate keeps the web server route");
assert.equal(plain.base, "http://127.0.0.1:43120", "and the web server's own port");
assert.equal(existsSync(join(tmp, "mcp-port")), false, "and starts no listener of its own");
for (const fn of cleanups) fn();
cleanups.length = 0;
const fakeCtx = fakeHost(true);
// SAFETY: host double above carries the services registerMcpBridge needs
const bridge = await registerMcpBridge(fakeCtx as never, {
  log: () => {},
  version: "t",
  keyFile: join(tmp, "mcp.key"),
});
assert.equal(bridge.via, "loopback", "new processes are pointed at the loopback listener");
assert.match(bridge.base, /^http:\/\/127\.0\.0\.1:\d+$/, "loopback base is a 127.0.0.1 URL");
const remembered = Number.parseInt(readFileSync(join(tmp, "mcp-port"), "utf8").trim(), 10);
assert.ok(Number.isInteger(remembered) && remembered > 0, "loopback port is remembered");
const post = (path: string, body: unknown, key?: string) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== undefined) headers[KEY_HEADER] = key;
  return fetch(`${bridge.base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
};
// SAFETY: initialize always returns a response
const loopInit = (await (
  await post(
    `${MCP_PATH}/s1`,
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    bridge.key,
  )
).json()) as { result: { serverInfo: { name: string } } };
assert.equal(loopInit.result.serverInfo.name, "dsh", "loopback answers without a gate");
// SAFETY: tools/list always returns a response
const loopList = (await (
  await post(`${MCP_PATH}/s1`, { jsonrpc: "2.0", id: 2, method: "tools/list" }, bridge.key)
).json()) as { result: { tools: Array<{ name: string }> } };
assert.ok(
  loopList.result.tools.some((t) => t.name === "subagent_local"),
  "loopback serves the session tools",
);
assert.equal(
  (await post(`${MCP_PATH}/s1`, { jsonrpc: "2.0", id: 3, method: "ping" }, "wrong-key")).status,
  403,
  "loopback still checks the bridge key",
);
assert.equal(
  (await post(`${MCP_PATH}/s1`, { jsonrpc: "2.0", id: 4, method: "ping" })).status,
  403,
  "loopback rejects a missing key",
);
// A second mount rebinds the remembered port once the first listener is gone.
for (const fn of cleanups) fn();
cleanups.length = 0;
// SAFETY: same host double shape as above
const bridge2 = await registerMcpBridge(fakeCtx as never, {
  log: () => {},
  version: "t",
  keyFile: join(tmp, "mcp.key"),
});
assert.equal(bridge2.via, "loopback");
assert.equal(bridge2.base, bridge.base, "restart rebinds the remembered port");
assert.equal(bridge2.key, bridge.key, "restart keeps the bridge key");
assert.equal(bridge.key, plain.key, "one key whichever way the bridge is reached");
for (const fn of cleanups) fn();
console.log("mcp ok");
