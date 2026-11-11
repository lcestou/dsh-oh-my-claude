import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleRpc,
  HIDDEN,
  KEY_HEADER,
  MCP_PATH,
  openSession,
  promptSession,
  registerMcpBridge,
  waitSession,
} from "./mcp.js";
import { OWN_TOOL_NAMES } from "./mcp-config.js";
import type { Agent } from "./dsh.js";

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
chmodSync(tmp, 0o755); // as a umask of 022 leaves a state dir the stores made
// SAFETY: host double above carries the services registerMcpBridge needs
const plain = await registerMcpBridge(fakeHost(false) as never, {
  log: () => {},
  version: "t",
  keyFile: join(tmp, "mcp.key"),
});
assert.equal(plain.via, "webserver", "a host without the gate keeps the web server route");
assert.equal(plain.base, "http://127.0.0.1:43120", "and the web server's own port");
assert.equal(existsSync(join(tmp, "mcp-port")), false, "and starts no listener of its own");
// The key's folder is the state dir, with tokens and keeper files in it: closed to other users.
if (process.platform !== "win32")
  assert.equal(statSync(tmp).mode & 0o777, 0o700, "the state dir is the owner's alone");
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

// Code mode: when dsh offers the model only run_code, the bridge offers exactly that and refuses
// direct calls to anything else, so Claude reaches every tool from a run_code program.
{
  const runCode = {
    name: "run_code",
    description: "Execute a TypeScript program",
    parameters: { type: "object" },
  };
  const ptcAgent = { id: "a2", session: { requestHeader: () => ({ tools: [runCode] }) } };
  const relayed: string[] = [];
  // SAFETY: cast to HandleRpcParams shape for test double
  const ptcEnv = {
    ...env,
    agent: ptcAgent,
    relay: async (name: string) => (relayed.push(name), { text: "ran", isError: false }),
  } as unknown as Parameters<typeof handleRpc>[1];
  const ptcList = (await handleRpc({ jsonrpc: "2.0", id: 40, method: "tools/list" }, ptcEnv)) as {
    result: { tools: Array<{ name: string }> };
  };
  assert.deepEqual(
    ptcList.result.tools.map((t) => t.name),
    ["run_code"],
    "code mode offers only run_code",
  );
  const direct = (await handleRpc(
    {
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: { name: "subagent_local", arguments: {} },
    },
    ptcEnv,
  )) as { result?: { isError?: boolean; content: Array<{ text: string }> } };
  assert.equal(direct.result?.isError, true);
  assert.match(
    direct.result?.content[0]?.text ?? "",
    /only run_code is callable directly/,
    "direct calls are refused in code mode",
  );
  const program = (await handleRpc(
    {
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "run_code", arguments: { code: "1" } },
    },
    ptcEnv,
  )) as { result?: { content: Array<{ text: string }> } };
  assert.equal(
    program.result?.content[0]?.text,
    "ran",
    "run_code runs through the live turn's relay",
  );
  assert.deepEqual(relayed, ["run_code"]);
  // SAFETY: cast to HandleRpcParams shape for test double
  const noRelay = { ...env, agent: ptcAgent } as unknown as Parameters<typeof handleRpc>[1];
  const idle = (await handleRpc(
    { jsonrpc: "2.0", id: 43, method: "tools/call", params: { name: "run_code", arguments: {} } },
    noRelay,
  )) as { result?: { isError?: boolean } };
  assert.equal(
    idle.result?.isError,
    true,
    "run_code without a live turn fails instead of running nothing",
  );
  assert.match(
    JSON.stringify(idle),
    /run_code needs a live dsh turn/,
    "the failure says why, not unknown tool",
  );
  // The bridge's own tools are not dsh's, so code mode still offers them.
  // SAFETY: cast to HandleRpcParams shape for test double
  const withOpen = (await handleRpc({ jsonrpc: "2.0", id: 45, method: "tools/list" }, {
    ...env,
    agent: ptcAgent,
    open: async () => "opened",
    prompt: async () => "sent",
    wait: async () => "waited",
  } as unknown as Parameters<typeof handleRpc>[1])) as {
    result: { tools: Array<{ name: string }> };
  };
  assert.deepEqual(
    withOpen.result.tools.map((t) => t.name),
    ["run_code", "open_session", "prompt_session", "wait_session"],
    "code mode keeps the bridge's own tools",
  );
  // A header offering more than run_code is ordinary mode: the full bridged list comes back.
  const nativeAgent = {
    id: "a3",
    session: { requestHeader: () => ({ tools: [runCode, { name: "bash", parameters: {} }] }) },
  };
  // SAFETY: cast to HandleRpcParams shape for test double
  const nativeList = (await handleRpc({ jsonrpc: "2.0", id: 44, method: "tools/list" }, {
    ...env,
    agent: nativeAgent,
  } as unknown as Parameters<typeof handleRpc>[1])) as {
    result: { tools: Array<{ name: string }> };
  };
  assert.deepEqual(
    nativeList.result.tools.map((t) => t.name),
    ["subagent_local", "bash"],
  );
}

// openSession: a provider and model go on the new session's own agent before the first prompt,
// so its first turn already runs on that route and no box default changes; without both, none.
{
  const calls: string[] = [];
  const selected: unknown[] = [];
  const child = {
    model: { select: (r: unknown) => void (calls.push("select"), selected.push(r)) },
  };
  // SAFETY: a stand-in for the three host services openSession reads; there is no selectModel,
  // since that one would also save the pick as the box's default for new sessions
  const host = {
    sessions: { get: () => undefined },
    workspaceRegistry: {
      list: () => [{ id: "w1", path: "/p" }],
      archiveSession: async () => void calls.push("archive"),
    },
    sessionController: {
      create: async () => (calls.push("create"), { sessionId: "n1" }),
      resolveAgent: async () => ({ agent: child }),
      prompt: async () => void calls.push("prompt"),
    },
  } as unknown as Parameters<typeof openSession>[0];
  // SAFETY: an agent whose session header names the workspace path
  const caller = { id: "a", session: { id: "s", header: { cwd: "/p" } } } as unknown as Agent;
  const signal = new AbortController().signal;
  const text = await openSession(
    host,
    caller,
    { prompt: "go", provider: "claude-code", model: "claude-haiku-5-5" },
    signal,
  );
  assert.equal(text, "opened session n1 in workspace w1");
  assert.deepEqual(calls, ["create", "select", "prompt"], "route set before the first prompt");
  assert.deepEqual(selected, [{ provider: "claude-code", model: "claude-haiku-5-5" }]);
  // A reasoning effort rides on the route (#250); without a route it is dropped with it.
  selected.length = 0;
  calls.length = 0;
  await openSession(
    host,
    caller,
    { prompt: "go", provider: "openai-codex", model: "gpt-6.1-sol", reasoningEffort: "high" },
    signal,
  );
  assert.deepEqual(selected, [
    { provider: "openai-codex", model: "gpt-6.1-sol", reasoningEffort: "high" },
  ]);
  calls.length = 0;
  await openSession(host, caller, { prompt: "go", reasoningEffort: "high" }, signal);
  assert.deepEqual(calls, ["create", "prompt"], "an effort without a route sets nothing");
  calls.length = 0;
  await openSession(host, caller, { prompt: "go", model: "claude-haiku-5-5" }, signal);
  assert.deepEqual(calls, ["create", "prompt"], "a model without a provider sets no route");
  // A session the controller cannot resolve is reported, never prompted on dsh's default route.
  calls.length = 0;
  // SAFETY: the same stand-in with a controller that cannot resolve the new session
  const lost = {
    ...host,
    sessionController: { ...host.sessionController, resolveAgent: async () => ({ error: "gone" }) },
  } as unknown as Parameters<typeof openSession>[0];
  await assert.rejects(
    openSession(lost, caller, { prompt: "go", provider: "p", model: "m" }, signal),
    /gone/,
  );
  assert.deepEqual(
    calls,
    ["create", "archive"],
    "archived, never prompted, after a failed resolve",
  );
  // An agent with no model route is reported too, instead of opening on dsh's default model.
  calls.length = 0;
  // SAFETY: the same stand-in with an agent that carries no model route
  const bare = {
    ...host,
    sessionController: { ...host.sessionController, resolveAgent: async () => ({ agent: {} }) },
  } as unknown as Parameters<typeof openSession>[0];
  await assert.rejects(
    openSession(bare, caller, { prompt: "go", provider: "p", model: "m" }, signal),
    /has no agent to select p\/m on/,
  );
  assert.deepEqual(calls, ["create", "archive"], "archived, never prompted on the default route");
  console.log("open-session ok");
}

// prompt_session and wait_session (#255): offered only when the host provides them, after
// open_session, and also in code mode, since they are the bridge's own.
{
  // SAFETY: cast to HandleRpcParams shape for test double
  const own = {
    ...env,
    open: async () => "opened",
    prompt: async (a: unknown) => `prompted ${JSON.stringify(a)}`,
    wait: async () => "waited",
  } as unknown as Parameters<typeof handleRpc>[1];
  // SAFETY: tools/list always returns a response
  const listed = (await handleRpc({ jsonrpc: "2.0", id: 60, method: "tools/list" }, own)) as {
    result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> };
  };
  assert.deepEqual(
    listed.result.tools.map((t) => t.name),
    ["subagent_local", "bash", "open_session", "prompt_session", "wait_session"],
  );
  assert.deepEqual(
    // Everything listed after the two dsh tools is the bridge's own, so a tool added to one list
    // and not the other fails here in either direction.
    listed.result.tools.map((t) => t.name).slice(2),
    [...OWN_TOOL_NAMES],
    "the names the translator keeps out of relay matching are the bridge's own tools",
  );
  assert.deepEqual(
    listed.result.tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name),
    ["prompt_session"],
    "only prompt_session runs alone, so a batched wait_session cannot read ahead of it",
  );
  // SAFETY: tools/call always returns a response
  const sent = (await handleRpc(
    {
      jsonrpc: "2.0",
      id: 61,
      method: "tools/call",
      params: { name: "prompt_session", arguments: { sessionId: "s2", prompt: "redo step 2" } },
    },
    own,
  )) as { result: { content: Array<{ text: string }> } };
  assert.equal(sent.result.content[0]?.text, 'prompted {"sessionId":"s2","prompt":"redo step 2"}');
  // Without the host functions the tools are neither listed nor callable.
  // SAFETY: tools/call always returns a response
  const absent = (await handleRpc(
    { jsonrpc: "2.0", id: 62, method: "tools/call", params: { name: "wait_session" } },
    env,
  )) as { result: { isError?: boolean } };
  assert.equal(absent.result.isError, true);

  const calls: string[] = [];
  let waited: unknown;
  /** One assistant message record as dsh's wait returns it. */
  const record = (seq: number, content: unknown[]) => ({
    event: { type: "assistant/message", seq, data: { message: { content } } },
  });
  // newest first, as dsh returns them; the block shapes are dsh's own, where thinking is a
  // `reasoning` block that carries `text` like a text block does
  let records = [
    record(46, [
      { type: "reasoning", text: "hidden" },
      { type: "text", text: "step 2 redone" },
    ]),
    record(44, [
      { type: "reasoning", text: "thinking only" },
      { type: "tool-call", toolName: "bash" },
    ]),
    record(43, [{ type: "tool-call", toolName: "bash" }]),
    record(42, [{ type: "text", text: "on it" }]),
  ];
  let truncated = false;
  // SAFETY: a stand-in for the controller methods the two tools read
  const host = {
    sessionController: {
      // dsh's state read is what refuses an unknown id; promptSession resolves nothing itself.
      state: async (r: { sessionId: string }) => {
        if (r.sessionId === "gone") throw new Error('session "gone" not found');
        calls.push("state");
        return { cursor: 41 };
      },
      prompt: async (r: { mode: string; content: Array<{ text: string }> }) =>
        void calls.push(`prompt ${r.mode} ${r.content[0]?.text}`),
      wait: async (r: unknown) => {
        waited = r;
        return {
          reason: "idle",
          state: { cursor: 47, running: false, queue: [], pendingInput: [] },
          output: { truncated, records },
        };
      },
    },
  } as unknown as Parameters<typeof promptSession>[0];
  const from =
    "[Sent by the agent in dsh session s1 through prompt_session, not typed by the user.]";
  // SAFETY: the calling agent's session is s1
  const caller = { id: "a", session: { id: "s1" } } as unknown as Agent;
  const signal = new AbortController().signal;
  assert.equal(
    await promptSession(host, caller, { sessionId: "s2", prompt: "redo step 2" }, signal),
    "sent to session s2 (queue); afterSeq 41",
  );
  assert.deepEqual(
    calls,
    ["state", `prompt queue ${from}\n\nredo step 2`],
    "cursor read before the prompt, and the message names its sender",
  );
  calls.length = 0;
  await promptSession(host, caller, { sessionId: "s2", prompt: "hint", mode: "steer" }, signal);
  assert.deepEqual(calls, ["state", `prompt steer ${from}\n\nhint`]);
  calls.length = 0;
  await assert.rejects(
    promptSession(host, caller, { sessionId: "s1", prompt: "x" }, signal),
    /cannot target the calling session/,
  );
  await assert.rejects(promptSession(host, caller, { prompt: "x" }, signal), /needs a sessionId/);
  await assert.rejects(
    promptSession(host, caller, { sessionId: "s2", prompt: "  " }, signal),
    /non-empty prompt/,
  );
  await assert.rejects(
    promptSession(host, caller, { sessionId: "gone", prompt: "x" }, signal),
    /session "gone" not found/,
  );
  assert.deepEqual(calls, [], "a refused call never prompts");

  const text = await waitSession(host, caller, { sessionId: "s2", afterSeq: 41 }, signal);
  assert.deepEqual(waited, { sessionId: "s2", timeoutMs: 30_000, maxMessages: 50, afterSeq: 41 });
  assert.equal(
    text,
    [
      "session s2: idle, not running, 0 queued, afterSeq 47",
      "--- reply at seq 42 ---\non it",
      "--- reply at seq 46 ---\nstep 2 redone",
    ].join("\n"),
    "replies oldest first, text blocks only: reasoning and tool-only messages left out",
  );
  await waitSession(host, caller, { sessionId: "s2", timeoutSeconds: 9999 }, signal);
  assert.deepEqual(
    waited,
    { sessionId: "s2", timeoutMs: 240_000, maxMessages: 50 },
    "timeout clamped, no cursor",
  );
  await assert.rejects(
    waitSession(host, caller, { sessionId: "s1" }, signal),
    /cannot target the calling session/,
  );
  // A cursor of the wrong type is refused: run without it, the wait returned the session's old
  // replies as if they answered the message just sent.
  waited = undefined;
  for (const afterSeq of ["41", 41.5, -2, true])
    await assert.rejects(
      waitSession(host, caller, { sessionId: "s2", afterSeq }, signal),
      /afterSeq must be an integer/,
    );
  await assert.rejects(
    waitSession(host, caller, { sessionId: "s2", timeoutSeconds: "60" }, signal),
    /timeoutSeconds must be a number/,
  );
  assert.equal(waited, undefined, "a refused wait never reaches dsh");
  await waitSession(
    host,
    caller,
    { sessionId: "s2", afterSeq: null, timeoutSeconds: null },
    signal,
  );
  assert.deepEqual(
    waited,
    { sessionId: "s2", timeoutMs: 30_000, maxMessages: 50 },
    "null reads as not given",
  );
  await waitSession(host, caller, { sessionId: "s2", afterSeq: -0 }, signal);
  // SAFETY: the stand-in recorded the request waitSession built
  assert.ok(Object.is((waited as { afterSeq: number }).afterSeq, 0), "-0 goes to dsh as 0");
  await waitSession(host, caller, { sessionId: "s2", afterSeq: -1 }, signal);
  // SAFETY: as above
  assert.equal((waited as { afterSeq: number }).afterSeq, -1, "-1 is dsh's own 'from the start'");

  // The output is bounded: the newest replies are kept up to the budget, the oldest kept one is
  // cut short, and a line says older ones were left out.
  records = [
    record(53, [{ type: "text", text: "c".repeat(10_000) }]),
    record(52, [{ type: "text", text: "b".repeat(10_000) }]),
    record(51, [{ type: "text", text: "a".repeat(10_000) }]),
  ];
  const long = (await waitSession(host, caller, { sessionId: "s2" }, signal)).split("\n");
  assert.deepEqual(
    [long[1], long[2], long[3]?.length, long[4], long[5]?.length, long.length],
    [
      "(older replies left out)",
      "--- reply at seq 52 ---",
      6000 + "… (reply cut short)".length,
      "--- reply at seq 53 ---",
      10_000,
      6,
    ],
    "16,000 characters of reply text at most, the newest whole",
  );
  // A cut that lands inside an emoji drops the half it would have left behind.
  records = [record(55, [{ type: "text", text: `${"d".repeat(15_999)}😀 tail` }])];
  const emoji = (await waitSession(host, caller, { sessionId: "s2" }, signal)).split("\n")[2];
  assert.equal(emoji, `${"d".repeat(15_999)}… (reply cut short)`, "no lone surrogate at the cut");
  records = [record(60, [{ type: "text", text: "latest" }])];
  truncated = true;
  assert.ok(
    (await waitSession(host, caller, { sessionId: "s2" }, signal)).includes(
      "(older replies left out)\n--- reply at seq 60 ---",
    ),
    "dsh's own cut at 50 messages is reported the same way",
  );

  // Through the bridge, a failed call of the bridge's own answers with the message alone. Only a
  // failure that is not the caller's argument reaches the log, with its stack.
  const logLines: string[] = [];
  // SAFETY: cast to HandleRpcParams shape for test double
  const live = {
    ...env,
    prompt: (a: Record<string, never>) => promptSession(host, caller, a, signal),
    log: (_level: string, line: string) => void logLines.push(line),
  } as unknown as Parameters<typeof handleRpc>[1];
  /** The result of a prompt_session call through handleRpc. */
  const callPrompt = async (args: Record<string, string>) =>
    // SAFETY: tools/call always returns a response
    (
      (await handleRpc(
        {
          jsonrpc: "2.0",
          id: 63,
          method: "tools/call",
          params: { name: "prompt_session", arguments: args },
        },
        live,
      )) as { result: { isError?: boolean; content: Array<{ text: string }> } }
    ).result;
  const refused = await callPrompt({ sessionId: "s2", prompt: " " });
  assert.deepEqual(
    [refused.isError, refused.content[0]?.text],
    [true, "prompt_session needs a non-empty prompt"],
    "a refused argument answers with its message, no stack",
  );
  assert.deepEqual(logLines, [], "and is not logged");
  const unknown = await callPrompt({ sessionId: "gone", prompt: "x" });
  assert.deepEqual(
    [unknown.isError, unknown.content[0]?.text],
    [true, 'session "gone" not found'],
    "dsh's own error answers with its message too",
  );
  assert.equal(logLines.length, 1, "but is logged");
  assert.match(logLines[0] ?? "", /prompt_session failed: Error: session "gone" not found\n\s+at /);
  console.log("prompt-session ok");
}
