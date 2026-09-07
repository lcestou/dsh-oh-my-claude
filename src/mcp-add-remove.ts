// The one thing the MCP add form needs from the server side: turn a posted form into the JSON
// `claude mcp add-json` takes, or into the reason it is refused. Pure, tested in
// mcp-add-remove.test.ts.
import type { JsonValue } from "./dsh.js";

/**
 * Where the server lands. `user` is global; `local` is private to one project and `project` is
 * that project's `.mcp.json`, so both of those are read relative to a directory and the route has
 * to run the CLI in the session's own cwd.
 */
export const MCP_SCOPES = ["user", "local", "project"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** A scope other than `user` writes into a directory, so the route needs the session's cwd. */
export const scopeNeedsCwd = (scope: McpScope): boolean => scope !== "user";

export function isMcpScope(value: unknown): value is McpScope {
  return MCP_SCOPES.some((scope) => scope === value);
}

/**
 * The CLI's own name rule: `mcp remove` and `mcp add-json` take the name as one argv word, so a
 * name starting with a dash would be read as a flag and anything with a space would be two words.
 */
export const isMcpName = (name: unknown): name is string =>
  typeof name === "string" && /^[@\w][\w@/-]*$/.test(name);

/** One server as the CLI stores it. `env` and `headers` are left out when they are empty. */
export type McpServerJson =
  | { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { type: "sse" | "http"; url: string; headers?: Record<string, string> };

/** Whitespace-separated words, ignoring blank lines; the form takes one argument per line. */
const lines = (text: JsonValue | undefined): string[] =>
  typeof text === "string"
    ? text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

/**
 * `KEY=value` per line into an object, or the reason it is not one. The value keeps any `=` it
 * contains; an empty value is allowed, since an env var set to the empty string is a real setting.
 */
const pairs = (
  text: JsonValue | undefined,
  split: string,
  label: string,
  key: RegExp,
): Record<string, string> | { error: string } => {
  const out: Record<string, string> = {};
  for (const line of lines(text)) {
    const at = line.indexOf(split);
    const name = at === -1 ? "" : line.slice(0, at).trim();
    if (!key.test(name))
      return { error: `each ${label} line reads ${label === "env" ? "KEY=value" : "Name: value"}` };
    out[name] = line.slice(at + split.length).trim();
  }
  return out;
};

const isError = (value: object): value is { error: string } => "error" in value;

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
export function buildAddServer(
  form: AddServerForm,
): { scope: McpScope; name: string; json: McpServerJson } | { error: string } {
  const { name, scope, transport } = form;
  if (!isMcpName(name))
    return {
      error: "a name is letters, digits, dash, underscore, slash or @, and starts with one",
    };
  if (!isMcpScope(scope)) return { error: "scope is user, local or project" };

  if (transport === "stdio") {
    const command = typeof form.command === "string" ? form.command.trim() : "";
    if (!command) return { error: "a stdio server needs a command" };
    const env = pairs(form.env, "=", "env", /^[A-Za-z_]\w*$/);
    if (isError(env)) return env;
    const json: McpServerJson = { type: "stdio", command, args: lines(form.args) };
    if (Object.keys(env).length > 0) json.env = env;
    return { scope, name, json };
  }

  if (transport !== "sse" && transport !== "http")
    return { error: "transport is stdio, sse or http" };

  const url = typeof form.url === "string" ? form.url.trim() : "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "a url starts with http:// or https://" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return { error: "a url starts with http:// or https://" };
  const headers = pairs(form.headers, ":", "header", /^[\w-]+$/);
  if (isError(headers)) return headers;
  const json: McpServerJson = { type: transport, url };
  if (Object.keys(headers).length > 0) json.headers = headers;
  return { scope, name, json };
}
