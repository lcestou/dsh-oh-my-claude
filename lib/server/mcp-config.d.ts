import { type FsBox } from "./remote-fs.js";
export interface ConfiguredMcp {
    name: string;
    scope: "user" | "local" | "project";
    /** The command line or URL, for the row. */
    summary: string;
}
/**
 * Rows from the two files' text. Pure, so the listing is checked without a filesystem: `claudeJson`
 * is `.claude.json`, `mcpJson` is the workspace's `.mcp.json`, either absent as null.
 */
export declare function configuredFrom(claudeJson: string | null, mcpJson: string | null, cwd: string): ConfiguredMcp[];
/**
 * The configured servers for `cwd` on the box. `claudeJsonPath` is where that instance's CLI keeps
 * `.claude.json`: `~/.claude.json` by default, inside the config dir when one is exported.
 */
export declare function listConfiguredMcp(cwd: string, claudeJsonPath: string, box?: FsBox): Promise<ConfiguredMcp[]>;
