import type { JsonValue } from "./dsh.js";
/**
 * Where the server lands. `user` is global; `local` is private to one project and `project` is
 * that project's `.mcp.json`, so both of those are read relative to a directory and the route has
 * to run the CLI in the session's own cwd.
 */
export declare const MCP_SCOPES: readonly ["user", "local", "project"];
export type McpScope = (typeof MCP_SCOPES)[number];
/** A scope other than `user` writes into a directory, so the route needs the session's cwd. */
export declare const scopeNeedsCwd: (scope: McpScope) => boolean;
export declare function isMcpScope(value: unknown): value is McpScope;
/**
 * The CLI's own name rule: `mcp remove` and `mcp add-json` take the name as one argv word, so a
 * name starting with a dash would be read as a flag and anything with a space would be two words.
 */
export declare const isMcpName: (name: unknown) => name is string;
/** One server as the CLI stores it. `env` and `headers` are left out when they are empty. */
export type McpServerJson = {
    type: "stdio";
    command: string;
    args: string[];
    env?: Record<string, string>;
} | {
    type: "sse" | "http";
    url: string;
    headers?: Record<string, string>;
};
/** The form the browser posts. Every field arrives as text; nothing here is trusted. */
export interface AddServerForm {
    name?: JsonValue;
    scope?: JsonValue;
    transport?: JsonValue;
    command?: JsonValue;
    args?: JsonValue;
    env?: JsonValue;
    url?: JsonValue;
    headers?: JsonValue;
}
/**
 * The posted form as a server the CLI would accept, or the first thing wrong with it. A URL is
 * parsed rather than pattern-matched so `javascript:` and a bare hostname are both refused.
 */
export declare function buildAddServer(form: AddServerForm): {
    scope: McpScope;
    name: string;
    json: McpServerJson;
} | {
    error: string;
};
