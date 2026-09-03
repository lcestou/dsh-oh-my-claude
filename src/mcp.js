// MCP bridge: exposes the dsh tools visible to a session's agent (subagents, jobs, skills, ...) to
// the Claude Code process of that session over MCP Streamable HTTP, so a Claude parent can fan out
// to dsh subagents and they show up under the session like any other child. Shell and file tools are
// left out: Claude Code has its own. Guarded by a per-process key that only the adapter knows.
import { randomUUID } from "node:crypto";
import { readBody } from "./sessions.js";

export const MCP_PATH = "/dsh-llm-claude/mcp";
export const KEY_HEADER = "x-dsh-llm-claude-key";
const PROTOCOL = "2025-06-18";
const BODY_LIMIT = 1024 * 1024;
/** dsh tools Claude Code already has natively; proxying them would only confuse the model. */
const HIDDEN = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "multi_edit",
  "glob",
  "grep",
  "ls",
  "run_code",
]);

/** Bridge-only tool: a new top-level dsh session (sidebar row), not a child of the caller. */
const OPEN_SESSION = {
  name: "open_session",
  description:
    "Start a new top-level dsh session in a workspace and send it a first prompt. It appears in the sidebar as its own session, not under this one, and runs independently; nothing comes back here. Omit provider and model for the dsh default. Returns the new session id.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "The complete first message for the new session." },
      workspaceId: {
        type: "string",
        description: "Workspace id to open it in. Default: the workspace of this session.",
      },
      provider: { type: "string", description: "LLM provider id, e.g. someone-llm." },
      model: { type: "string", description: "Model id for that provider." },
      agentPreset: { type: "string", description: "Agent preset id. Default: the dsh default." },
    },
    required: ["prompt"],
  },
};

async function openSession(ctx, agent, args, signal) {
  const cwd = agent.session?.header?.cwd ?? ctx.sessions.get(agent.session?.id)?.header?.cwd;
  const workspaceId =
    args.workspaceId ?? ctx.workspaceRegistry.list().find((w) => w.path === cwd)?.id;
  const { sessionId } = await ctx.sessionController.create({
    ...(workspaceId ? { workspaceId } : { cwd }),
    ...(args.agentPreset ? { agentPreset: args.agentPreset } : {}),
  });
  if (args.provider && args.model) {
    const child = ctx.agents.get(sessionId);
    ctx.sessionController.agents.selectForNextRequest(child, {
      provider: args.provider,
      model: args.model,
    });
  }
  await ctx.sessionController.prompt(
    { sessionId, requestId: randomUUID(), content: [{ type: "text", text: args.prompt }] },
    signal,
  );
  return `opened session ${sessionId}${workspaceId ? ` in workspace ${workspaceId}` : ` at ${cwd}`}`;
}

const textOf = (blocks) =>
  (Array.isArray(blocks) ? blocks : [blocks])
    .map((b) =>
      b && typeof b === "object" && typeof b.text === "string" ? b.text : JSON.stringify(b),
    )
    .join("\n");

const errorReply = (id, e) => ({
  jsonrpc: "2.0",
  id,
  result: { content: [{ type: "text", text: String(e?.message ?? e) }], isError: true },
});

/** One JSON-RPC request against the tools visible to `agent`. Returns null for notifications. */
export async function handleRpc(msg, { tools, agent, signal, version, open, relay, log }) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const failed = (e) => {
    log?.("warn", `mcp bridge: ${msg.params?.name ?? msg.method} failed: ${e?.stack ?? e}`);
    return errorReply(msg.id, e?.stack ?? e);
  };
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "dsh", version },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: tools
          .schemas(agent)
          .filter((t) => !HIDDEN.has(t.name))
          // readOnlyHint is what Claude Code keys concurrency on: without it every MCP call runs
          // one after another, so parallel subagents would serialize. dsh's own permission
          // presets still govern what a child may do.
          .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters,
            annotations: { readOnlyHint: true },
          }))
          .concat(open ? [OPEN_SESSION] : []),
      });
    case "tools/call": {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      if (name === OPEN_SESSION.name && open) {
        try {
          return reply({ content: [{ type: "text", text: await open(args) }] });
        } catch (e) {
          return failed(e);
        }
      }
      const tool = HIDDEN.has(name) ? undefined : tools.get(name, agent);
      if (!tool) return errorReply(msg.id, `unknown tool ${name}`);
      try {
        // A live Claude turn takes the call first: dsh then runs the tool itself and renders it
        // natively (subagent cards, counts, notices). Otherwise execute it here.
        const relayed = relay ? await relay(name, args, signal) : undefined;
        if (relayed)
          return reply({
            content: [{ type: "text", text: relayed.text }],
            ...(relayed.isError ? { isError: true } : {}),
          });
        const exec = { agent, signal, name, arguments: args, callId: randomUUID() };
        const returned = await tool.execute(args, exec);
        const rendered = tool.output?.render ? tool.output.render(args, returned) : returned;
        return reply({ content: [{ type: "text", text: textOf(rendered) }] });
      } catch (e) {
        return failed(e);
      }
    }
    default:
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `unknown method ${msg.method}` },
      };
  }
}

const send = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(value === undefined ? "" : JSON.stringify(value));
};

/** The bridge key outlives a plugin hot reload: running Claude processes were spawned with it. */
const KEY_REGISTRY = Symbol.for("dsh-llm-claude.mcpKey");

/**
 * Mount `POST /dsh-llm-claude/mcp/<dsh session id>`. Resolves once the web server is up with the
 * base URL and key the adapter must hand to `claude --mcp-config`.
 */
export function registerMcpBridge(ctx, { log, version, relay }) {
  const key = (globalThis[KEY_REGISTRY] ??= randomUUID());
  return new Promise((resolve) => {
    ctx.inject(
      ["webServer", "tools", "agents", "sessions", "sessionController", "workspaceRegistry"],
      (ctx) => {
        ctx.effect(() =>
          ctx.webServer.register({
            kind: "prefix",
            path: MCP_PATH,
            handler: async (req, res) => {
              if (req.headers[KEY_HEADER] !== key) return send(res, 403, { error: "forbidden" });
              if (req.method !== "POST") return send(res, 405, { error: "POST only" });
              const sessionId = decodeURIComponent(
                (req.url ?? "").slice(MCP_PATH.length + 1).split("?")[0],
              );
              const agent = ctx.agents.get(sessionId);
              if (!agent)
                return send(res, 404, { error: `no live agent for session ${sessionId}` });
              const controller = new AbortController();
              // Node fires the request's own "close" once the body is consumed; the response's
              // fires when the client actually goes away.
              res.on("close", () => {
                if (!res.writableFinished) controller.abort();
              });
              try {
                const msg = await readBody(req, BODY_LIMIT);
                const out = await handleRpc(msg, {
                  tools: ctx.tools,
                  agent,
                  signal: controller.signal,
                  version,
                  open: (args) => openSession(ctx, agent, args, controller.signal),
                  relay: relay
                    ? (name, args, signal) => relay(sessionId, name, args, signal)
                    : undefined,
                  log,
                });
                return out === null ? send(res, 202) : send(res, 200, out);
              } catch (e) {
                log("warn", `mcp bridge: ${e?.message ?? e}`);
                return send(res, 400, { error: String(e?.message ?? e) });
              }
            },
          }),
        );
        resolve({ base: `http://127.0.0.1:${ctx.webServer.port}`, key });
      },
    );
  });
}
