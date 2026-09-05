import type { RelayResult } from "./process.js";
import type { Agent, DshToolsRegistry, JsonValue, PluginContext } from "./dsh.js";
/** HTTP endpoint path for the MCP bridge handler. */
export declare const MCP_PATH = "/dsh-oh-my-claude/mcp";
/** HTTP header name for the MCP bridge authentication key. */
export declare const KEY_HEADER = "x-dsh-oh-my-claude-key";
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
}
/**
 * Mount `POST /dsh-oh-my-claude/mcp/<dsh session id>`. Resolves once the web server is up with the
 * base URL and key the adapter must hand to `claude --mcp-config`.
 */
export declare function registerMcpBridge(ctx: PluginContext, { log, version, relay }: BridgeOptions): Promise<{
    base: string;
    key: string;
}>;
export {};
