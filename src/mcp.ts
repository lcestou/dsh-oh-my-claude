// MCP bridge: exposes the dsh tools visible to a session's agent (subagents, jobs, skills, ...) to
// the Claude Code process of that session over MCP Streamable HTTP, so a Claude parent can fan out
// to dsh subagents and they show up under the session like any other child. Shell and file tools are
// left out: Claude Code has its own. Guarded by a per-process key that only the adapter knows.
// This is an I/O boundary: JSON-RPC bodies are decoded here.
//
// On DSH Desktop the bridge listens on its own loopback port rather than only on dsh's web server:
// Desktop wraps every web server route in a browser-access gate (403 for anything without the
// Electron renderer's capability header), which the CLI's MCP client has no way to present, so a
// bridge served only there is unreachable and Claude sees zero dsh tools. Plain `dsh web` has no
// gate and keeps the web server route alone, whose port is the one dsh was started on. The web
// server route is registered either way, and is the fallback when the listener cannot start.
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody } from "./sessions.js";
import { KEY_HEADER } from "./mcp-config.js";
// The header name lives in mcp-config.ts, a leaf, so the CLI argument builder can read it without
// importing this module, whose route helpers lead back to the adapter.
export { KEY_HEADER } from "./mcp-config.js";
import { errorText } from "./process.js";
import type { RelayResult } from "./process.js";
import type {
  Agent,
  DshToolsRegistry,
  JsonValue,
  PluginContext,
  SessionId,
  ToolSchema,
} from "./dsh.js";
import { asSessionId } from "./dsh.js";
import { resolvedAgent } from "./adapter/turn.js";

/** HTTP endpoint path for the MCP bridge handler. */
export const MCP_PATH = "/dsh-oh-my-claude/mcp";
const PROTOCOL = "2025-06-18";
const BODY_LIMIT = 1024 * 1024;
/** dsh tools Claude Code already has natively; proxying them would only confuse the model.
 *  `str_replace_editor` is the file editor some presets offer in place of `edit`. */
export const HIDDEN = new Set([
  "read",
  "write",
  "edit",
  "multi_edit",
  "str_replace_editor",
  "glob",
  "grep",
  "ls",
  "run_code",
]);

/** dsh's code-mode tool: under a PTC preset it is the only tool the model may call directly. */
export const RUN_CODE = "run_code";

/** `run_code` when dsh offers the agent only that tool (a code-mode preset), else undefined. dsh's
 *  registry lists every registered tool either way; the request header holds what the model sees. */
export const codeModeTool = (agent: Agent): ToolSchema | undefined => {
  const offered = agent.session?.requestHeader()?.tools;
  const only = offered?.length === 1 ? offered[0] : undefined;
  return only?.name === RUN_CODE ? only : undefined;
};

/** The dsh tools the bridge offers `agent`: in code mode only `run_code`; otherwise what dsh shows
 *  that agent, minus the ones Claude Code has natively. `open_session` and its two siblings are the
 *  bridge's own, not dsh tools, so code mode leaves them alone; the callers that offer them add them. */
const bridgedSchemas = (tools: DshToolsRegistry, agent: Agent): ToolSchema[] => {
  const runCode = codeModeTool(agent);
  return runCode ? [runCode] : tools.schemas(agent).filter((t) => !HIDDEN.has(t.name));
};

/** Bridge-only tool: a new top-level dsh session (sidebar row), not a child of the caller. */
const OPEN_SESSION: ToolSchema = {
  name: "open_session",
  description:
    "Start a new top-level dsh session in a workspace and send it a first prompt. It appears in the sidebar as its own session, not under this one, and runs independently. Its replies do not come back here on their own: read them with wait_session. Omit provider and model for the dsh default. Returns the new session id.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "The complete first message for the new session." },
      workspaceId: {
        type: "string",
        description: "Workspace id to open it in. Default: the workspace of this session.",
      },
      provider: { type: "string", description: "LLM provider id, e.g. claude-code." },
      model: { type: "string", description: "Model id for that provider." },
      reasoningEffort: {
        type: "string",
        description:
          "Thinking level for that model, e.g. low, medium, high. Applied only with provider and model. Default: the provider's default.",
      },
      agentPreset: { type: "string", description: "Agent preset id. Default: the dsh default." },
    },
    required: ["prompt"],
  },
};

/** Bridge-only tool: a follow-up into a session that already exists, so a correction or hint keeps
 *  that session's context instead of paying for a new one. dsh's `send_message` cannot do it: it
 *  reaches only the caller's own children and teammates, and an open_session row is neither. */
const PROMPT_SESSION: ToolSchema = {
  name: "prompt_session",
  description:
    "Send a follow-up message into an existing dsh session, e.g. one open_session returned. A cold session resumes and keeps its own model and context. mode queue (default) runs it after the current turn; steer injects it into the running turn. The message arrives under a line naming this session as its sender. Returns at once with a cursor: pass it to wait_session as afterSeq to read only the replies that come after this message.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Target session id, as open_session returned it." },
      prompt: { type: "string", description: "The complete message to send." },
      mode: {
        type: "string",
        enum: ["queue", "steer"],
        description: "queue (default) waits for the running turn; steer injects into it.",
      },
    },
    required: ["sessionId", "prompt"],
  },
};

/** Longest wait_session accepts. Claude's MCP client drops a call that stays silent for about
 *  300 s, so a longer wait would lose its answer; Claude calls again instead. */
const WAIT_MAX_S = 240;
/** Most assistant messages one wait_session asks dsh for. dsh's own default, pinned here because
 *  the tool description states it; WAIT_MAX_CHARS is what bounds the size. */
const WAIT_MAX_REPLIES = 50;
/** Most reply text one wait_session returns. Past its MCP output cap Claude Code moves a result
 *  out of the conversation into a file, and below the cap a long one still fills the caller's
 *  context; Chinese runs near a token a character, so the bound is set for that case. */
const WAIT_MAX_CHARS = 16_000;

/** Bridge-only tool: the other half of open_session and prompt_session, which return at once. */
const WAIT_SESSION: ToolSchema = {
  name: "wait_session",
  description: `Wait until a dsh session stops working (idle, or waiting on input such as an approval or a question) or the timeout passes, then return its assistant replies, oldest first. afterSeq, from prompt_session, limits them to the replies after that point; without it the session's latest replies come back. At most ${WAIT_MAX_REPLIES} replies and ${WAIT_MAX_CHARS} characters of reply text are returned, the newest kept. The first line ends with the next afterSeq: on timeout, call again with that one, and replies already returned are not repeated. Default timeout 30 s, longest ${WAIT_MAX_S} s.`,
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session id, as open_session returned it." },
      afterSeq: {
        type: "integer",
        description:
          "Return only replies after this cursor, as prompt_session or the last wait_session gave it.",
      },
      timeoutSeconds: {
        type: "integer",
        description: `How long to wait, 1 to ${WAIT_MAX_S}. Default 30.`,
      },
    },
    required: ["sessionId"],
  },
};

/** The bridge's own tools in the order tools/list offers them. */
const OWN_TOOLS = [OPEN_SESSION, PROMPT_SESSION, WAIT_SESSION];

/** A call refused for its arguments. The caller made the mistake, so it gets the message alone:
 *  no stack in the answer, no line in the log. */
class BadCall extends Error {}

/** The open_session arguments Claude sends, as far as the bridge reads them. */
interface OpenSessionArgs {
  prompt?: JsonValue;
  workspaceId?: JsonValue;
  provider?: JsonValue;
  model?: JsonValue;
  reasoningEffort?: JsonValue;
  agentPreset?: JsonValue;
}

/** The value when it is a string, else undefined; never a coerced value. */
const str = (v: JsonValue | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;

/** The host services openSession needs; all are injected before the bridge mounts. */
type OpenHost = Required<
  Pick<PluginContext, "sessions" | "workspaceRegistry" | "sessionController">
>;

/**
 * Creates and initializes a new top-level dsh session with an initial prompt.
 * Used by the MCP bridge to fan out sessions from Claude Code to dsh. A provider is applied only
 * with a model; either alone is ignored and the session opens on dsh's default route. A reasoning
 * effort rides on that route and is ignored without it; dsh does not check it against the model,
 * so an effort the model lacks shows up in the new session's first turn, like an unknown model.
 */
export async function openSession(
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
  // From huananhuxu-debug's patch in #250: without it every child ran at the provider's default.
  const reasoningEffort = str(args.reasoningEffort);
  // dsh 0.2 dropped `agents.selectForNextRequest`. The controller's `selectModel` is not the
  // replacement: it also saves the pick as the box's default for every new session, so a model
  // Claude named for one child would become everyone's. The child's own agent takes the route
  // instead, the step `selectModel` runs before that save. dsh leaves validation to the caller,
  // so an unknown model fails in the new session's first turn, where it shows.
  // A route that cannot be set archives the new, still empty session before the error goes back,
  // so a failed call leaves no blank row in the sidebar.
  if (provider && model) {
    try {
      const child = resolvedAgent(await ctx.sessionController.resolveAgent(sessionId));
      // An agent without a model route would leave the session on dsh's default without a word.
      if (!child.model)
        throw new Error(`session ${sessionId} has no agent to select ${provider}/${model} on`);
      child.model.select(
        reasoningEffort ? { provider, model, reasoningEffort } : { provider, model },
      );
    } catch (e) {
      await ctx.workspaceRegistry.archiveSession(sessionId).catch(() => {});
      throw e;
    }
  }
  await ctx.sessionController.prompt(
    {
      sessionId,
      requestId: randomUUID(),
      // Required from dsh 0.1.7: a prompt says whether it queues behind the running turn or
      // steers into it. A fresh child session has no turn to steer, so it queues.
      mode: "queue",
      content: [{ type: "text", text: String(args.prompt) }],
    },
    signal,
  );
  return `opened session ${sessionId}${workspaceId ? ` in workspace ${workspaceId}` : ` at ${cwd}`}`;
}

/** The target session id from a prompt_session or wait_session call. Throws when it is missing or
 *  names the calling session: a session prompting itself would queue behind its own turn, and one
 *  waiting on itself would only ever time out. */
function targetOf(agent: Agent, args: Record<string, JsonValue>, tool: string): SessionId {
  const id = str(args.sessionId);
  if (!id) throw new BadCall(`${tool} needs a sessionId`);
  if (agent.session?.id === id) throw new BadCall(`${tool} cannot target the calling session`);
  return asSessionId(id);
}

/** The line prompt_session puts above a message. dsh records the message as a plain user message
 *  with nothing to say who sent it, so without this line the target session, and the owner reading
 *  its transcript, could not tell it from the owner's own typing. The model reads it, so it is not
 *  translated. */
const senderLine = (agent: Agent): string =>
  `[Sent by the agent in dsh session ${agent.session?.id ?? "unknown"} through prompt_session, not typed by the user.]`;

/**
 * Sends a follow-up into an existing session (#255, from huananhuxu-debug's patch), under a line
 * naming the calling session as its sender. The cursor is read before the prompt, so replies past
 * it are this message's, plus any the session's running turn finishes meanwhile; reading it does
 * not wake a cold session, and an unknown id fails there with dsh's own "not found". dsh's `prompt`
 * resolves the session itself, so a cold one resumes only for a message that is really sent, and
 * keeps its route.
 */
export async function promptSession(
  ctx: Pick<OpenHost, "sessionController">,
  agent: Agent,
  args: Record<string, JsonValue>,
  signal: AbortSignal,
): Promise<string> {
  const sessionId = targetOf(agent, args, PROMPT_SESSION.name);
  const prompt = str(args.prompt) ?? "";
  if (!prompt.trim()) throw new BadCall("prompt_session needs a non-empty prompt");
  const mode = str(args.mode) === "steer" ? "steer" : "queue";
  const { cursor } = await ctx.sessionController.state({ sessionId }, signal);
  await ctx.sessionController.prompt(
    {
      sessionId,
      requestId: randomUUID(),
      mode,
      content: [{ type: "text", text: `${senderLine(agent)}\n\n${prompt}` }],
    },
    signal,
  );
  return `sent to session ${sessionId} (${mode}); afterSeq ${cursor}`;
}

/** The visible text of one dsh assistant message, its text blocks joined; empty when it has none.
 *  dsh's reasoning blocks carry a `text` field too, so the block type is what is checked: tool
 *  calls and thinking are the session's working, not its answer. */
function replyText(data: JsonValue): string {
  // SAFETY: dsh event data is JsonValue; an assistant message nests its blocks under `message`
  const content = (data as { message?: { content?: unknown } } | null)?.message?.content;
  return (Array.isArray(content) ? content : [])
    .flatMap((b: unknown) =>
      b &&
      typeof b === "object" &&
      "type" in b &&
      b.type === "text" &&
      "text" in b &&
      typeof b.text === "string"
        ? [b.text]
        : [],
    )
    .join("\n")
    .trim();
}

/**
 * Waits on a session through dsh's own `sessionController.wait` and renders its text replies,
 * oldest first, under a status line that ends with the cursor to pass next time. The output is
 * bounded twice: dsh is asked for WAIT_MAX_REPLIES messages at most, and the newest of those are
 * kept up to WAIT_MAX_CHARS, the oldest kept one cut short; a line says when older replies were
 * left out, and nothing here can fetch them afterwards. An afterSeq or timeoutSeconds of the wrong
 * type is refused, since a wait that quietly ran without its cursor returned old replies as if they
 * answered the last message. A timeout outside 1..WAIT_MAX_S seconds is clamped rather than refused.
 */
export async function waitSession(
  ctx: Pick<OpenHost, "sessionController">,
  agent: Agent,
  args: Record<string, JsonValue>,
  signal: AbortSignal,
): Promise<string> {
  const sessionId = targetOf(agent, args, WAIT_SESSION.name);
  // A JSON null reads as "not given", the way Claude sometimes fills an optional argument.
  const after = args.afterSeq ?? undefined;
  if (
    after !== undefined &&
    !(typeof after === "number" && Number.isSafeInteger(after) && after >= -1)
  )
    throw new BadCall(
      "wait_session afterSeq must be an integer, -1 or more, as prompt_session or the last wait_session gave it",
    );
  const seconds = args.timeoutSeconds ?? 30;
  if (typeof seconds !== "number")
    throw new BadCall(`wait_session timeoutSeconds must be a number, 1 to ${WAIT_MAX_S}`);
  const timeoutMs = Math.round(Math.min(Math.max(seconds, 1), WAIT_MAX_S) * 1000);
  const { reason, state, output } = await ctx.sessionController.wait(
    after === undefined
      ? { sessionId, timeoutMs, maxMessages: WAIT_MAX_REPLIES }
      : // `+ 0` turns a -0 into 0: dsh refuses -0 as a cursor.
        { sessionId, timeoutMs, maxMessages: WAIT_MAX_REPLIES, afterSeq: after + 0 },
    signal,
  );
  const status = [
    `session ${sessionId}: ${reason}`,
    state.running ? "running" : "not running",
    `${state.queue?.length ?? 0} queued`,
    state.pendingInput.length > 0 ? `${state.pendingInput.length} waiting on input` : "",
    `afterSeq ${state.cursor}`,
  ].filter(Boolean);
  const replies: string[] = [];
  let room = WAIT_MAX_CHARS;
  let leftOut = output.truncated;
  // dsh hands the records newest first, so the budget goes to the latest replies.
  for (const { event } of output.records) {
    const text = replyText(event.data);
    if (!text) continue;
    if (room <= 0) {
      leftOut = true;
      break;
    }
    // A cut that lands inside an emoji would leave half of its surrogate pair behind.
    const kept =
      text.length > room
        ? `${text.slice(0, room).replace(/[\uD800-\uDBFF]$/, "")}… (reply cut short)`
        : text;
    room -= text.length;
    replies.unshift(`--- reply at seq ${event.seq} ---\n${kept}`);
  }
  if (leftOut) replies.unshift("(older replies left out)");
  return [status.join(", "), ...(replies.length ? replies : ["(no replies in range)"])].join("\n");
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

/** The JSON-RPC reply for a failed call: a result with `isError` set and the error's text, under
 *  the request's own id. */
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
  /** prompt_session and wait_session; each is offered only when given, like `open`. */
  prompt?: (args: Record<string, JsonValue>) => Promise<string>;
  wait?: (args: Record<string, JsonValue>) => Promise<string>;
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
  { tools, agent, signal, version, open, prompt, wait, relay, log }: RpcEnv,
): Promise<JsonRpcReply | null> {
  // The bridge's own tools the host provided, by name; dsh never sees these.
  const own = new Map<string, (args: Record<string, JsonValue>) => Promise<string>>();
  if (open) own.set(OPEN_SESSION.name, open);
  if (prompt) own.set(PROMPT_SESSION.name, prompt);
  if (wait) own.set(WAIT_SESSION.name, wait);
  const reply = (result: object): JsonRpcReply => ({ jsonrpc: "2.0", id: msg.id, result });
  /** Writes a failed call to the log with its stack, and returns that stack. */
  const logged = (e: unknown): string => {
    const stack = e instanceof Error ? (e.stack ?? e.message) : String(e);
    log?.("warn", `mcp bridge: ${str(msg.params?.name) ?? msg.method} failed: ${stack}`);
    return stack;
  };
  /** The reply for a failed dsh tool: logged, and answered with the stack, as it always was. */
  const failed = (e: unknown): JsonRpcReply => errorReply(msg.id, logged(e));
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
        tools: bridgedSchemas(tools, agent)
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
            OWN_TOOLS.filter((t) => own.has(t.name)).map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.parameters,
              // prompt_session changes another session, so the CLI runs it on its own: batched
              // beside a wait_session, the wait could otherwise read the session before it lands.
              annotations: { readOnlyHint: t !== PROMPT_SESSION },
            })),
          ),
      });
    case "tools/call": {
      const name = str(msg.params?.name) ?? "";
      const rawArgs = msg.params?.arguments;
      const args: Record<string, JsonValue> =
        rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};
      const ownTool = own.get(name);
      if (ownTool) {
        try {
          return reply({ content: [{ type: "text", text: await ownTool(args) }] });
        } catch (e) {
          // The message alone goes back: a stack of plugin and dsh paths tells Claude nothing
          // about a mistyped session id. A refused argument is not logged either.
          if (!(e instanceof BadCall)) logged(e);
          return errorReply(msg.id, e);
        }
      }
      const codeMode = codeModeTool(agent) !== undefined;
      if (codeMode && name !== RUN_CODE)
        return errorReply(
          msg.id,
          `only ${RUN_CODE} is callable directly in code mode; call ${name} from a ${RUN_CODE} program`,
        );
      // run_code is dsh's executor transport, not a registered tool: only a live turn's relay can run it.
      if (codeMode && !relay) return errorReply(msg.id, `${RUN_CODE} needs a live dsh turn`);
      const tool = codeMode || HIDDEN.has(name) ? undefined : tools.get(name, agent);
      if (!tool && !codeMode) return errorReply(msg.id, `unknown tool ${name}`);
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
        if (!tool) return errorReply(msg.id, `${RUN_CODE} needs a live dsh turn`);
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

/** Write a JSON response. An undefined value ends with an empty body rather than the text
 *  `null`. */
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
  /** Path of a file holding the bridge key; created once, reused across restarts. */
  keyFile?: string;
  /** Path of a file holding the loopback listener's port, so a restart rebinds the same port and
   *  keeper-mode Claude processes keep their URL. Defaults to `mcp-port` next to `keyFile`.
   *  Pass `null` to take a fresh ephemeral port on every mount. */
  portFile?: string | null;
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
 * The bridge key: the file's contents when they are a valid key, else a fresh key written to the
 * file, so the key survives a restart.
 */
function stableKey(file: string): string {
  // The key's folder is the plugin's state dir, which also holds saved boxes, login tokens and
  // keeper files. It is made wherever a store first writes, at whatever mode the umask gives, so
  // it is closed to other users here, on the one path every start takes.
  try {
    mkdirSync(dirname(file), { recursive: true });
    chmodSync(dirname(file), 0o700);
  } catch {}
  try {
    const k = readFileSync(file, "utf8").trim();
    if (/^[0-9a-f-]{36}$/.test(k)) return k;
  } catch {}
  const k = randomUUID();
  try {
    writeFileSync(file, k, { mode: 0o600 });
  } catch {}
  return k;
}

/** The mounted bridge, as the adapter holds it. */
export interface McpBridge {
  base: string;
  key: string;
  /** Where `base` points: the bridge's own loopback listener under DSH Desktop, else the dsh web
   *  server route (also when the listener could not start). The CLI's `--mcp-config` URL is built
   *  off `base` either way. */
  via: "loopback" | "webserver";
  /** The tools `tools/list` will answer that session with, the bridge's own included, so the system
   *  prompt can name the ones that are really there. Undefined when the session has no live agent
   *  or dsh refuses the listing; the bridge has nothing for that session either. */
  toolsFor: (sessionId: string) => ToolSchema[] | undefined;
}

/** The loopback port remembered from the previous mount, else undefined. */
function readPortFile(file: string): number | undefined {
  try {
    const n = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
    if (Number.isInteger(n) && n > 0 && n <= 65535) return n;
  } catch {}
  return undefined;
}

/** Remember the loopback port for the next mount; failures only lose the reuse, never the mount. */
function writePortFile(file: string, port: number): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${port}\n`);
  } catch {}
}

/** One listen attempt against 127.0.0.1. */
function listenOnce(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  port: number,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

/**
 * The bridge's own listener on 127.0.0.1. The remembered port is tried first so a restart rebinds
 * the same port; when it is taken (a previous generation still holds it, or anything else does),
 * an ephemeral port is taken instead and remembered. Resolves undefined when nothing listens, in
 * which case the caller falls back to the dsh web server route.
 */
async function startLoopback(
  log: (level: string, msg: string) => void,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  portFile: string | undefined,
): Promise<{ url: string; close: () => void } | undefined> {
  const wanted = portFile ? readPortFile(portFile) : undefined;
  const attempts = wanted === undefined ? [0] : [wanted, 0];
  for (const port of attempts) {
    try {
      const server = await listenOnce(handler, port);
      // SAFETY: a TCP listener bound to 127.0.0.1 reports AddressInfo; string is Unix sockets only
      const address = server.address() as AddressInfo | string | null;
      const actual = typeof address === "object" && address !== null ? address.port : undefined;
      if (actual === undefined) {
        server.close();
        continue;
      }
      if (portFile) writePortFile(portFile, actual);
      server.on("error", (e) => log("warn", `mcp bridge loopback: ${errorText(e)}`));
      return { url: `http://127.0.0.1:${actual}`, close: () => server.close() };
    } catch (e) {
      log(
        "warn",
        `mcp bridge: loopback listen on ${port === 0 ? "an ephemeral port" : `port ${port}`} failed: ${errorText(e)}`,
      );
    }
  }
  return undefined;
}

/** Wires the MCP bridge up once the required services are injected, and keeps the bridge key
 *  stable across dsh restarts so a keeper-mode claude that outlived dsh still authenticates.
 *  Under DSH Desktop, new Claude processes are pointed at the bridge's own loopback listener,
 *  which answers on 127.0.0.1 regardless of the browser-access gate Desktop puts on web server
 *  routes. Everywhere else they get the web server route as before, and no listener is started:
 *  a process that outlives a restart can only reconnect to the URL it was started with, and the
 *  web port is the one address that is fixed by configuration. */
export function registerMcpBridge(
  ctx: PluginContext,
  { log, version, relay, keyFile, portFile }: BridgeOptions,
): Promise<McpBridge> {
  // SAFETY: the key symbol is this plugin's own key on globalThis, typed here once
  const g = globalThis as typeof globalThis & { [KEY_REGISTRY]?: string };
  // A key file keeps the bridge key stable across dsh restarts, so a Claude process that outlived
  // dsh (keeper mode) still authenticates against the new bridge.
  const key = (g[KEY_REGISTRY] ??= keyFile ? stableKey(keyFile) : randomUUID());
  const loopPortFile =
    portFile === null
      ? undefined
      : (portFile ?? (keyFile ? join(dirname(keyFile), "mcp-port") : undefined));
  return new Promise((resolve, reject) => {
    ctx.inject?.(
      ["webServer", "tools", "agents", "sessions", "sessionController", "workspaceRegistry"],
      // The body runs async (the loopback listen) but inject takes a sync callback.
      (host) =>
        void (async () => {
          const { webServer, tools, agents, sessions, sessionController, workspaceRegistry } = host;
          if (!webServer || !tools || !sessionController) return;
          const openHost: OpenHost = { sessions, workspaceRegistry, sessionController };
          const serve = async (req: IncomingMessage, res: ServerResponse) => {
            if (req.headers[KEY_HEADER] !== key) return send(res, 403, { error: "forbidden" });
            if (req.method !== "POST") return send(res, 405, { error: "POST only" });
            const sessionId = decodeURIComponent(
              (req.url ?? "").slice(MCP_PATH.length + 1).split("?")[0] ?? "",
            );
            const agent = agents.get(asSessionId(sessionId));
            if (!agent) return send(res, 404, { error: `no live agent for session ${sessionId}` });
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
                prompt: (args) => promptSession(openHost, agent, args, controller.signal),
                wait: (args) => waitSession(openHost, agent, args, controller.signal),
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
          };
          // Desktop provides this service from its launcher, before any profile plugin loads, and
          // gates on it per request; its presence is the gate. Read by name so a host without it
          // (every plain `dsh web`) answers undefined and runs exactly the path it always has.
          const gated = host.get?.("desktopBrowserAccess") !== undefined;
          // The loopback listener is what new Claude processes get there: it answers on 127.0.0.1
          // no matter what gate sits on the web server routes.
          const loopback = gated
            ? await startLoopback(
                log,
                (req, res) => {
                  serve(req, res).catch((e: unknown) =>
                    log("warn", `mcp bridge loopback: ${errorText(e)}`),
                  );
                },
                loopPortFile,
              )
            : undefined;
          if (loopback) log("info", `mcp bridge: loopback listener on ${loopback.url}`);
          else if (gated)
            log("warn", "mcp bridge: no loopback listener, falling back to the web server route");
          // The listen above is awaited, so the scope may be gone by now (a reload mid-mount). An
          // effect that cannot register would leave the listener holding the port with no owner.
          try {
            host.effect?.(() => {
              const off = webServer.register({ kind: "prefix", path: MCP_PATH, handler: serve });
              return () => {
                loopback?.close();
                if (typeof off === "function") off();
              };
            });
          } catch (e) {
            // Rejecting hands the caller its "bridge unavailable" path instead of a promise that
            // never settles.
            loopback?.close();
            reject(e instanceof Error ? e : new Error(errorText(e)));
            return;
          }
          resolve({
            base: loopback?.url ?? `http://127.0.0.1:${webServer.port}`,
            via: loopback ? "loopback" : "webserver",
            key,
            toolsFor: (sessionId) => {
              try {
                const agent = agents.get(asSessionId(sessionId));
                return agent ? [...bridgedSchemas(tools, agent), ...OWN_TOOLS] : undefined;
              } catch {
                return undefined;
              }
            },
          });
        })(),
    );
  });
}
