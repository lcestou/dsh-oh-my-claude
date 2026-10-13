import type { RelayResult } from "./process.js";
import type { Agent, DshToolsRegistry, JsonValue, PluginContext, ToolSchema } from "./dsh.js";
/** HTTP endpoint path for the MCP bridge handler. */
export declare const MCP_PATH = "/dsh-oh-my-claude/mcp";
/** HTTP header name for the MCP bridge authentication key. */
export declare const KEY_HEADER = "x-dsh-oh-my-claude-key";
/** dsh tools Claude Code already has natively; proxying them would only confuse the model.
 *  `str_replace_editor` is the file editor some presets offer in place of `edit`. */
export declare const HIDDEN: Set<string>;
/** The open_session arguments Claude sends, as far as the bridge reads them. */
interface OpenSessionArgs {
    prompt?: JsonValue;
    workspaceId?: JsonValue;
    provider?: JsonValue;
    model?: JsonValue;
    agentPreset?: JsonValue;
}
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
    relay?: (name: string, args: Record<string, JsonValue>, signal: AbortSignal) => Promise<RelayResult | undefined> | undefined;
    log?: (level: string, msg: string) => void;
}
/** One JSON-RPC request against the tools visible to `agent`. Returns null for notifications. */
export declare function handleRpc(msg: JsonRpcRequest, { tools, agent, signal, version, open, relay, log }: RpcEnv): Promise<JsonRpcReply | null>;
/** What the adapter hands the bridge. */
export interface BridgeOptions {
    log: (level: string, msg: string) => void;
    version: string;
    relay?: (sessionId: string, name: string, args: Record<string, JsonValue>, signal: AbortSignal) => Promise<RelayResult | undefined> | undefined;
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
    /** The tools `tools/list` will answer that session with, `open_session` included, so the system
     *  prompt can name the ones that are really there. Undefined when the session has no live agent
     *  or dsh refuses the listing; the bridge has nothing for that session either. */
    toolsFor: (sessionId: string) => ToolSchema[] | undefined;
}
/** Wires the MCP bridge up once the required services are injected, and keeps the bridge key
 *  stable across dsh restarts so a keeper-mode claude that outlived dsh still authenticates.
 *  Under DSH Desktop, new Claude processes are pointed at the bridge's own loopback listener,
 *  which answers on 127.0.0.1 regardless of the browser-access gate Desktop puts on web server
 *  routes. Everywhere else they get the web server route as before, and no listener is started:
 *  a process that outlives a restart can only reconnect to the URL it was started with, and the
 *  web port is the one address that is fixed by configuration. */
export declare function registerMcpBridge(ctx: PluginContext, { log, version, relay, keyFile, portFile }: BridgeOptions): Promise<McpBridge>;
export {};
