// The MCP servers Claude Code is configured with for a directory, and the scope each one lives in,
// read from the files the CLI writes rather than from `claude mcp list`, which health-checks every
// approved server (it connects to each one) and takes seconds. Three scopes: `user` and `local` in
// the CLI's `.claude.json` (top-level `mcpServers`, and `projects[<cwd>].mcpServers`), `project` in
// the workspace's `.mcp.json`. The MCP tab shows these beside the servers the running process has,
// so a server added a moment ago has a row before Claude next starts.
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { type FsBox, readTextAt } from "./remote-fs.js";

export interface ConfiguredMcp {
  name: string;
  scope: "user" | "local" | "project";
  /** The command line or URL, for the row. */
  summary: string;
}

// The slices of the CLI's files this listing reads; every field is optional, as the CLI leaves
// some out per transport, and a file that fails the schema reads as holding nothing.
const Entry = z.object({ command: z.string(), args: z.array(z.string()), url: z.string() });
const Servers = z.dict(Entry);
const ClaudeJson = z.object({
  mcpServers: Servers,
  projects: z.dict(z.object({ mcpServers: Servers })),
});
const McpJson = z.object({ mcpServers: Servers });
type ServerMap = ReturnType<typeof Servers>;

/** Rows for one `mcpServers` map under `scope`. */
const rowsOf = (servers: ServerMap | undefined, scope: ConfiguredMcp["scope"]): ConfiguredMcp[] =>
  Object.entries(servers ?? {}).map(([name, e]) => ({
    name,
    scope,
    summary: e.url ?? `${e.command ?? ""} ${(e.args ?? []).join(" ")}`.trim(),
  }));

/** A schema call that throws on an off-shape file reads as no file. */
const safe = <T>(read: () => T): T | null => {
  try {
    return read();
  } catch {
    return null;
  }
};
/**
 * Rows from the two files' text. Pure, so the listing is checked without a filesystem: `claudeJson`
 * is `.claude.json`, `mcpJson` is the workspace's `.mcp.json`, either absent as null.
 */
export function configuredFrom(
  claudeJson: string | null,
  mcpJson: string | null,
  cwd: string,
): ConfiguredMcp[] {
  // JSON.parse feeds the schema call as it does elsewhere in this plugin; either throwing reads
  // as no file.
  const top = claudeJson === null ? null : safe(() => ClaudeJson(JSON.parse(claudeJson)));
  const project = mcpJson === null ? null : safe(() => McpJson(JSON.parse(mcpJson)));
  return [
    ...rowsOf(top?.mcpServers, "user"),
    ...rowsOf(top?.projects?.[cwd]?.mcpServers, "local"),
    ...rowsOf(project?.mcpServers, "project"),
  ];
}

/**
 * The configured servers for `cwd` on the box. `claudeJsonPath` is where that instance's CLI keeps
 * `.claude.json`: `~/.claude.json` by default, inside the config dir when one is exported.
 */
export async function listConfiguredMcp(
  cwd: string,
  claudeJsonPath: string,
  box: FsBox = {},
): Promise<ConfiguredMcp[]> {
  const [claudeJson, mcpJson] = await Promise.all([
    readTextAt(box, claudeJsonPath).catch(() => null),
    readTextAt(box, join(cwd, ".mcp.json")).catch(() => null),
  ]);
  return configuredFrom(claudeJson, mcpJson, cwd);
}
