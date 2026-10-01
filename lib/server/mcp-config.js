// The MCP servers Claude Code is configured with for a directory, and the scope each one lives in,
// read from the files the CLI writes rather than from `claude mcp list`, which health-checks every
// approved server (it connects to each one) and takes seconds. Three scopes: `user` and `local` in
// the CLI's `.claude.json` (top-level `mcpServers`, and `projects[<repository>].mcpServers`),
// `project` in the `.mcp.json` of the session's directory and of every directory above it. The MCP
// tab shows these beside the servers the running process has, so a server added a moment ago has a
// row before Claude next starts.
import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { readTextAt } from "./remote-fs.js";
import { projectKey, repoRoot } from "./repo.js";
// The slices of the CLI's files this listing reads; every field is optional, as the CLI leaves
// some out per transport, and a file that fails the schema reads as holding nothing.
const Entry = z.object({ command: z.string(), args: z.array(z.string()), url: z.string() });
const Servers = z.dict(Entry);
const ClaudeJson = z.object({
    mcpServers: Servers,
    projects: z.dict(z.object({ mcpServers: Servers })),
});
const McpJson = z.object({ mcpServers: Servers });
/** Rows for one `mcpServers` map under `scope`. */
const rowsOf = (servers, scope) => Object.entries(servers ?? {}).map(([name, e]) => ({
    name,
    scope,
    summary: e.url ?? `${e.command ?? ""} ${(e.args ?? []).join(" ")}`.trim(),
}));
/** A schema call that throws on an off-shape file reads as no file. */
const safe = (read) => {
    try {
        return read();
    }
    catch {
        return null;
    }
};
/**
 * Rows from the files' text. Pure, so the listing is checked without a filesystem: `claudeJson` is
 * `.claude.json`, and `mcpJsons` are the `.mcp.json` files from the session's directory upwards,
 * nearest first, any of them absent as null. `key` is the `projects` entry the CLI files the
 * session under, which is its repository and not its directory (see `listConfiguredMcp`). A
 * server two `.mcp.json` files both name is listed once, from the nearer one.
 */
export function configuredFrom(claudeJson, mcpJsons, key) {
    // JSON.parse feeds the schema call as it does elsewhere in this plugin; either throwing reads
    // as no file.
    const top = claudeJson === null ? null : safe(() => ClaudeJson(JSON.parse(claudeJson)));
    const project = new Map();
    for (const text of mcpJsons) {
        const file = text === null ? null : safe(() => McpJson(JSON.parse(text)));
        for (const row of rowsOf(file?.mcpServers, "project"))
            if (!project.has(row.name))
                project.set(row.name, row);
    }
    return [
        ...rowsOf(top?.mcpServers, "user"),
        ...rowsOf(top?.projects?.[key]?.mcpServers, "local"),
        ...project.values(),
    ];
}
/**
 * The configured servers for `cwd` on the box. `claudeJsonPath` is where that instance's CLI keeps
 * `.claude.json`: `~/.claude.json` by default, inside the config dir when one is exported.
 *
 * The CLI files local servers under the repository's root, the main checkout's for a worktree, so
 * a session in a subdirectory or a worktree is looked up there and not under its own directory.
 * It reads `.mcp.json` from the session's directory and from every directory above it, so the
 * walk here goes to the filesystem root, one read at a time: on an ssh box each is a channel on
 * the shared connection, and a deep path read all at once would run into sshd's session limit.
 */
export async function listConfiguredMcp(cwd, claudeJsonPath, box = {}) {
    const [claudeJson, root] = await Promise.all([
        readTextAt(box, claudeJsonPath).catch(() => null),
        repoRoot(box, cwd),
    ]);
    const mcpJsons = [];
    for (let dir = cwd;; dir = dirname(dir)) {
        mcpJsons.push(await readTextAt(box, join(dir, ".mcp.json")).catch(() => null));
        if (dir === dirname(dir))
            break;
    }
    return configuredFrom(claudeJson, mcpJsons, projectKey(box, root));
}
//# sourceMappingURL=mcp-config.js.map