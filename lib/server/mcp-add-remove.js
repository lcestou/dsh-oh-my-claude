/**
 * Where the server lands. `user` is global; `local` is private to one project and `project` is
 * that project's `.mcp.json`, so both of those are read relative to a directory and the route has
 * to run the CLI in the session's own cwd.
 */
const MCP_SCOPES = ["user", "local", "project"];
/** A scope other than `user` writes into a directory, so the route needs the session's cwd. */
export const scopeNeedsCwd = (scope) => scope !== "user";
export function isMcpScope(value) {
    return MCP_SCOPES.some((scope) => scope === value);
}
/**
 * The CLI's own name rule: `mcp remove` and `mcp add-json` take the name as one argv word, so a
 * name starting with a dash would be read as a flag and anything with a space would be two words.
 */
export const isMcpName = (name) => typeof name === "string" && /^[@\w][\w@/-]*$/.test(name);
/** Whitespace-separated words, ignoring blank lines; the form takes one argument per line. */
const lines = (text) => typeof text === "string"
    ? text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
/**
 * `KEY=value` per line into an object, or the reason it is not one. The value keeps any `=` it
 * contains; an empty value is allowed, since an env var set to the empty string is a real setting.
 */
const pairs = (text, split, label, key) => {
    const out = {};
    for (const line of lines(text)) {
        const at = line.indexOf(split);
        const name = at === -1 ? "" : line.slice(0, at).trim();
        if (!key.test(name))
            return { error: `each ${label} line reads ${label === "env" ? "KEY=value" : "Name: value"}` };
        out[name] = line.slice(at + split.length).trim();
    }
    return out;
};
const isError = (value) => "error" in value;
/**
 * The posted form as a server the CLI would accept, or the first thing wrong with it. A URL is
 * parsed rather than pattern-matched so `javascript:` and a bare hostname are both refused.
 */
export function buildAddServer(form) {
    const { name, scope, transport } = form;
    if (!isMcpName(name))
        return {
            error: "a name is letters, digits, dash, underscore, slash or @, and starts with one",
        };
    if (!isMcpScope(scope))
        return { error: "scope is user, local or project" };
    if (transport === "stdio") {
        const command = typeof form.command === "string" ? form.command.trim() : "";
        if (!command)
            return { error: "a stdio server needs a command" };
        const env = pairs(form.env, "=", "env", /^[A-Za-z_]\w*$/);
        if (isError(env))
            return env;
        const json = { type: "stdio", command, args: lines(form.args) };
        if (Object.keys(env).length > 0)
            json.env = env;
        return { scope, name, json };
    }
    if (transport !== "sse" && transport !== "http")
        return { error: "transport is stdio, sse or http" };
    const url = typeof form.url === "string" ? form.url.trim() : "";
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return { error: "a url starts with http:// or https://" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return { error: "a url starts with http:// or https://" };
    const headers = pairs(form.headers, ":", "header", /^[\w-]+$/);
    if (isError(headers))
        return headers;
    const json = { type: transport, url };
    if (Object.keys(headers).length > 0)
        json.headers = headers;
    return { scope, name, json };
}
//# sourceMappingURL=mcp-add-remove.js.map