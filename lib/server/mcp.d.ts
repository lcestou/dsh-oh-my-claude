export { KEY_HEADER } from "./mcp-config.js";
import type { RelayResult } from "./process.js";
import type { Agent, DshToolsRegistry, JsonValue, PluginContext, ToolSchema, WebServer } from "./dsh.js";
/** The MCP tool `_meta` key Claude Code reads to load a tool up front instead of deferring it. */
export declare const ALWAYS_LOAD = "anthropic/alwaysLoad";
/** HTTP endpoint path for the MCP bridge handler. */
export declare const MCP_PATH = "/dsh-oh-my-claude/mcp";
/** dsh tools Claude Code already has natively; proxying them would only confuse the model.
 *  `str_replace_editor` is the file editor some presets offer in place of `edit`. */
export declare const HIDDEN: Set<string>;
/**
 * The dsh tools the bridge leaves out for a CLI started with these built-ins (the `--tools` list):
 * all of `HIDDEN` for `default`, and otherwise only the file tools whose Claude Code stand-in is on.
 * `run_code` stays out either way: it is dsh's executor transport, offered alone in code mode.
 */
export declare function hiddenFor(builtins: readonly string[]): ReadonlySet<string>;
/** dsh's code-mode tool: under a PTC preset it is the only tool the model may call directly. */
export declare const RUN_CODE = "run_code";
/** `run_code` when dsh offers the agent only that tool (a code-mode preset), else undefined. dsh's
 *  registry lists every registered tool either way; the request header holds what the model sees. */
export declare const codeModeTool: (agent: Agent) => ToolSchema | undefined;
/** The open_session arguments Claude sends, as far as the bridge reads them. */
interface OpenSessionArgs {
    prompt?: JsonValue;
    workspaceId?: JsonValue;
    provider?: JsonValue;
    model?: JsonValue;
    reasoningEffort?: JsonValue;
    agentPreset?: JsonValue;
}
/** The host services openSession needs; all are injected before the bridge mounts. */
type OpenHost = Required<Pick<PluginContext, "sessions" | "workspaceRegistry" | "sessionController">>;
/** The host services promptSession needs: the controller, and dsh's model list to check a switch. */
type PromptHost = Pick<OpenHost, "sessionController"> & Pick<PluginContext, "llm">;
/**
 * Creates and initializes a new top-level dsh session with an initial prompt.
 * Used by the MCP bridge to fan out sessions from Claude Code to dsh. A provider is applied only
 * with a model; either alone is ignored and the session opens on dsh's default route. A reasoning
 * effort rides on that route and is ignored without it; dsh does not check it against the model,
 * so an effort the model lacks shows up in the new session's first turn, like an unknown model.
 */
export declare function openSession(ctx: OpenHost, agent: Agent, args: OpenSessionArgs, signal: AbortSignal): Promise<string>;
/**
 * Sends a follow-up into an existing session (#255, from huananhuxu-debug's patch), under a line
 * naming the calling session as its sender. The cursor is read before the prompt, so replies past
 * it are this message's, plus any the session's running turn finishes meanwhile; reading it does
 * not wake a cold session, and an unknown id fails there with dsh's own "not found". dsh's `prompt`
 * resolves the session itself, so a cold one resumes only for a message that is really sent, and
 * keeps its route unless the call names one, which `switchRoute` sets first.
 */
export declare function promptSession(ctx: PromptHost, agent: Agent, args: Record<string, JsonValue>, signal: AbortSignal): Promise<string>;
/**
 * Waits on a session through dsh's own `sessionController.wait` and renders its text replies,
 * oldest first, under a status line that ends with the cursor to pass next time. The output is
 * bounded twice: dsh is asked for WAIT_MAX_REPLIES messages at most, and the newest of those are
 * kept up to WAIT_MAX_CHARS, the oldest kept one cut short; a line says when older replies were
 * left out, and nothing here can fetch them afterwards. An afterSeq or timeoutSeconds of the wrong
 * type is refused, since a wait that quietly ran without its cursor returned old replies as if they
 * answered the last message. A timeout outside 1..WAIT_MAX_S seconds is clamped rather than refused.
 */
export declare function waitSession(ctx: Pick<OpenHost, "sessionController">, agent: Agent, args: Record<string, JsonValue>, signal: AbortSignal): Promise<string>;
/** One JSON-RPC request as the CLI sends it; only `id`, `method` and `params` are read. */
export interface JsonRpcRequest {
    jsonrpc?: string;
    id?: JsonValue;
    method?: string;
    params?: Record<string, JsonValue>;
}
/** A JSON-RPC reply: a result, or an error object. */
export interface JsonRpcReply {
    jsonrpc: "2.0";
    id: JsonValue | undefined;
    result?: object;
    error?: {
        code: number;
        message: string;
    };
}
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
    relay?: (name: string, args: Record<string, JsonValue>, signal: AbortSignal) => Promise<RelayResult | undefined> | undefined;
    /** The session CLI's permission mode right now, read once per tools/call so a switch made after
     *  spawn counts; undefined when unknown, which gates nothing. */
    mode?: () => string | undefined;
    /** The dsh tools left off for this session (`hiddenFor`); `HIDDEN` when not given. */
    hidden?: ReadonlySet<string>;
    /** Mark every dsh tool dsh itself loads up front as one Claude Code must load up front too
     *  (`toolLoading: dsh`); otherwise Claude Code defers all of them behind its ToolSearch. */
    alwaysLoad?: boolean;
    log?: (level: string, msg: string) => void;
}
/** One JSON-RPC request against the tools visible to `agent`. Returns null for notifications. */
export declare function handleRpc(msg: JsonRpcRequest, { tools, agent, signal, version, open, prompt, wait, relay, mode, hidden, alwaysLoad, log, }: RpcEnv): Promise<JsonRpcReply | null>;
/** What the adapter hands the bridge. */
export interface BridgeOptions {
    log: (level: string, msg: string) => void;
    version: string;
    relay?: (sessionId: string, name: string, args: Record<string, JsonValue>, signal: AbortSignal) => Promise<RelayResult | undefined> | undefined;
    /** The permission mode the session's CLI is in right now; feeds the plan-mode gate. */
    mode?: (sessionId: string) => string | undefined;
    /** The Claude Code built-ins a session's CLI is started with (`builtinTools`), which decide the
     *  dsh file tools the bridge leaves out (`hiddenFor`). Every one of them when not given. */
    builtins?: (sessionId: string) => readonly string[];
    /** Whether a session's tools follow dsh's own deferral (`toolLoading: dsh`). */
    dshLoading?: (sessionId: string) => boolean;
    /** Path of a file holding the bridge key; created once, reused across restarts. */
    keyFile?: string;
    /** Path of a file holding the loopback listener's port, so a restart rebinds the same port and
     *  keeper-mode Claude processes keep their URL. Defaults to `mcp-port` next to `keyFile`.
     *  Pass `null` to take a fresh ephemeral port on every mount. */
    portFile?: string | null;
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
/**
 * Where a local Claude reaches the web server route. A server bound to every interface (no host, or
 * a wildcard) answers on 127.0.0.1; one bound to a single address (`dsh web --host 172.25.0.3`, as
 * in a container behind a reverse proxy) answers only there, so 127.0.0.1 would refuse the bridge.
 */
export declare function webServerBase(webServer: Pick<WebServer, "port" | "host">): string;
/** Wires the MCP bridge up once the required services are injected, and keeps the bridge key
 *  stable across dsh restarts so a keeper-mode claude that outlived dsh still authenticates.
 *  Under DSH Desktop, new Claude processes are pointed at the bridge's own loopback listener,
 *  which answers on 127.0.0.1 regardless of the browser-access gate Desktop puts on web server
 *  routes. Everywhere else they get the web server route as before, and no listener is started:
 *  a process that outlives a restart can only reconnect to the URL it was started with, and the
 *  web port is the one address that is fixed by configuration. */
export declare function registerMcpBridge(ctx: PluginContext, { log, version, relay, mode, builtins, dshLoading, keyFile, portFile }: BridgeOptions): Promise<McpBridge>;
