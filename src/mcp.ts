// MCP bridge: exposes the dsh tools visible to a session's agent (subagents, jobs, skills, ...) to
// the Claude Code process of that session over MCP Streamable HTTP, so a Claude parent can fan out
// to dsh subagents and they show up under the session like any other child. Shell and file tools are
// left out: Claude Code has its own. Guarded by a per-process key that only the adapter knows.
// This is an I/O boundary: JSON-RPC bodies are decoded here.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody } from "./sessions.js";
import { errorText } from "./process.js";
import type { RelayResult } from "./process.js";
import type { Agent, DshToolsRegistry, JsonValue, PluginContext, ToolSchema } from "./dsh.js";
import { asSessionId } from "./dsh.js";

/** HTTP endpoint path for the MCP bridge handler. */
export const MCP_PATH = "/dsh-oh-my-claude/mcp";
/** HTTP header name for the MCP bridge authentication key. */
export const KEY_HEADER = "x-dsh-oh-my-claude-key";
const PROTOCOL = "2025-06-18";
const BODY_LIMIT = 1024 * 1024;
/** dsh tools Claude Code already has natively; proxying them would only confuse the model. */
export const HIDDEN = new Set([
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
const OPEN_SESSION: ToolSchema = {
  name: "open_session",
  description:
    "Start a new top-level dsh session in a workspace and send it a first prompt. It appears in the sidebar as its own session, not under this one, and runs independently; nothing comes back here. Omit provider and model for the dsh default. Returns the new session id.",
  parameters: {
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

/** The open_session arguments Claude sends, as far as the bridge reads them. */
interface OpenSessionArgs {
  prompt?: JsonValue;
  workspaceId?: JsonValue;
  provider?: JsonValue;
  model?: JsonValue;
  agentPreset?: JsonValue;
}

const str = (v: JsonValue | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;

/** The host services openSession needs; all are injected before the bridge mounts. */
type OpenHost = Required<
  Pick<PluginContext, "sessions" | "workspaceRegistry" | "sessionController" | "agents">
>;

/**
 * Creates and initializes a new top-level dsh session with an initial prompt.
 * Used by the MCP bridge to fan out sessions from Claude Code to dsh.
 */
async function openSession(
  ctx: OpenHost,
  agent: Agent,
  args: OpenSessionArgs,
  signal: AbortSignal,
): Promise<string> {
  const sessionOf = agent.session;
  const cwd =
    sessionOf?.header?.cwd ?? (sessionOf ? ctx.sessions.get(sessionOf.id)?.header?.cwd : undefined);
  const workspaceId =
    str(args.workspaceId) ?? ctx.workspaceRegistry.list().find((w) => w.path === cwd)?.id;
  const agentPreset = str(args.agentPreset);
  const create: Parameters<OpenHost["sessionController"]["create"]>[0] = workspaceId
    ? { workspaceId }
    : { cwd };
  if (agentPreset) create.agentPreset = agentPreset;
  const { sessionId } = await ctx.sessionController.create(create);
  const provider = str(args.provider);
  const model = str(args.model);
  if (provider && model) {
    const child = ctx.agents.get(sessionId);
    ctx.sessionController.agents.selectForNextRequest(child, { provider, model });
  }
  await ctx.sessionController.prompt(
    {
      sessionId,
      requestId: randomUUID(),
      content: [{ type: "text", text: String(args.prompt) }],
    },
    signal,
  );
  return `opened session ${sessionId}${workspaceId ? ` in workspace ${workspaceId}` : ` at ${cwd}`}`;
}

/** Text of a tool's rendered output: text blocks read as text, anything else as JSON. */
const textOf = (blocks: JsonValue): string =>
  (Array.isArray(blocks) ? blocks : [blocks])
    .map((b) =>
      b && typeof b === "object" && !Array.isArray(b) && typeof b.text === "string"
        ? b.text
        : JSON.stringify(b),
    )
    .join("\n");

/** One JSON-RPC request as the CLI sends it; only `id`, `method` and `params` are read. */
export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonValue;
  method?: string;
  params?: Record<string, JsonValue>;
}

/** A tools/call result: text content, flagged when the tool failed. */
interface CallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** A JSON-RPC reply: a result, or an error object. */
export interface JsonRpcReply {
  jsonrpc: "2.0";
  id: JsonValue | undefined;
  result?: object;
  error?: { code: number; message: string };
}

const errorReply = (id: JsonValue | undefined, e: unknown): JsonRpcReply => ({
  jsonrpc: "2.0",
  id,
  result: { content: [{ type: "text", text: errorText(e) }], isError: true },
});

/** What handleRpc needs from the host for one request. */
export interface RpcEnv {
  tools: DshToolsRegistry;
  agent: Agent;
  signal: AbortSignal;
  version: string;
  open?: (args: OpenSessionArgs) => Promise<string>;
  relay?: (
    name: string,
    args: Record<string, JsonValue>,
    signal: AbortSignal,
  ) => Promise<RelayResult | undefined> | undefined;
  log?: (level: string, msg: string) => void;
}

/** One JSON-RPC request against the tools visible to `agent`. Returns null for notifications. */
export async function handleRpc(
  msg: JsonRpcRequest,
  { tools, agent, signal, version, open, relay, log }: RpcEnv,
): Promise<JsonRpcReply | null> {
  const reply = (result: object): JsonRpcReply => ({ jsonrpc: "2.0", id: msg.id, result });
  const failed = (e: unknown): JsonRpcReply => {
    const stack = e instanceof Error ? (e.stack ?? e.message) : String(e);
    log?.("warn", `mcp bridge: ${str(msg.params?.name) ?? msg.method} failed: ${stack}`);
    return errorReply(msg.id, stack);
  };
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: str(msg.params?.protocolVersion) ?? PROTOCOL,
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
          .concat(
            open
              ? [
                  {
                    name: OPEN_SESSION.name,
                    description: OPEN_SESSION.description,
                    inputSchema: OPEN_SESSION.parameters,
                    annotations: { readOnlyHint: true },
                  },
                ]
              : [],
          ),
      });
    case "tools/call": {
      const name = str(msg.params?.name) ?? "";
      const rawArgs = msg.params?.arguments;
      const args: Record<string, JsonValue> =
        rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};
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
        if (relayed) {
          const result: CallResult = {
            content: [{ type: "text", text: relayed.text }],
          };
          if (relayed.isError) result.isError = true;
          return reply(result);
        }
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

const send = (res: ServerResponse, status: number, value?: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(value === undefined ? "" : JSON.stringify(value));
};

/** The bridge key outlives a plugin hot reload: running Claude processes were spawned with it. */
const KEY_REGISTRY = Symbol.for("dsh-oh-my-claude.mcpKey");

/** What the adapter hands the bridge. */
export interface BridgeOptions {
  log: (level: string, msg: string) => void;
  version: string;
  relay?: (
    sessionId: string,
    name: string,
    args: Record<string, JsonValue>,
    signal: AbortSignal,
  ) => Promise<RelayResult | undefined> | undefined;
}

/** A JSON-RPC body is any JSON object; the bridge reads three fields off it. */
const asRpc = (body: Record<string, JsonValue>): JsonRpcRequest => ({
  jsonrpc: str(body.jsonrpc),
  id: body.id,
  method: str(body.method),
  params:
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? body.params
      : undefined,
});

/**
 * Mount `POST /dsh-oh-my-claude/mcp/<dsh session id>`. Resolves once the web server is up with the
 * base URL and key the adapter must hand to `claude --mcp-config`.
 */
export function registerMcpBridge(
  ctx: PluginContext,
  { log, version, relay }: BridgeOptions,
): Promise<{ base: string; key: string }> {
  // SAFETY: the key symbol is this plugin's own key on globalThis, typed here once
  const g = globalThis as typeof globalThis & { [KEY_REGISTRY]?: string };
  const key = (g[KEY_REGISTRY] ??= randomUUID());
  return new Promise((resolve) => {
    ctx.inject?.(
      ["webServer", "tools", "agents", "sessions", "sessionController", "workspaceRegistry"],
      (host) => {
        const { webServer, tools, agents, sessions, sessionController, workspaceRegistry } = host;
        if (!webServer || !tools || !sessionController) return;
        const openHost: OpenHost = { sessions, workspaceRegistry, sessionController, agents };
        host.effect?.(() =>
          webServer.register({
            kind: "prefix",
            path: MCP_PATH,
            handler: async (req: IncomingMessage, res: ServerResponse) => {
              if (req.headers[KEY_HEADER] !== key) return send(res, 403, { error: "forbidden" });
              if (req.method !== "POST") return send(res, 405, { error: "POST only" });
              const sessionId = decodeURIComponent(
                (req.url ?? "").slice(MCP_PATH.length + 1).split("?")[0] ?? "",
              );
              const agent = agents.get(asSessionId(sessionId));
              if (!agent)
                return send(res, 404, { error: `no live agent for session ${sessionId}` });
              const controller = new AbortController();
              // Node fires the request's own "close" once the body is consumed; the response's
              // fires when the client actually goes away.
              res.on("close", () => {
                if (!res.writableFinished) controller.abort();
              });
              try {
                const msg = asRpc(await readBody(req, BODY_LIMIT));
                const out = await handleRpc(msg, {
                  tools,
                  agent,
                  signal: controller.signal,
                  version,
                  open: (args) => openSession(openHost, agent, args, controller.signal),
                  relay: relay
                    ? (name, args, signal) => relay(sessionId, name, args, signal)
                    : undefined,
                  log,
                });
                return out === null ? send(res, 202) : send(res, 200, out);
              } catch (e) {
                log("warn", `mcp bridge: ${errorText(e)}`);
                return send(res, 400, { error: errorText(e) });
              }
            },
          }),
        );
        resolve({ base: `http://127.0.0.1:${webServer.port}`, key });
      },
    );
  });
}
