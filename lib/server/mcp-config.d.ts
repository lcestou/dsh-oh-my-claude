import { type FsBox } from "./remote-fs.js";
export interface ConfiguredMcp {
    name: string;
    scope: "user" | "local" | "project";
    /** The command line or URL, for the row. */
    summary: string;
}
/**
 * Rows from the files' text. Pure, so the listing is checked without a filesystem: `claudeJson` is
 * `.claude.json`, and `mcpJsons` are the `.mcp.json` files from the session's directory upwards,
 * nearest first, any of them absent as null. `key` is the `projects` entry the CLI files the
 * session under, which is its repository and not its directory (see `listConfiguredMcp`). A
 * server two `.mcp.json` files both name is listed once, from the nearer one.
 */
export declare function configuredFrom(claudeJson: string | null, mcpJsons: readonly (string | null)[], key: string): ConfiguredMcp[];
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
export declare function listConfiguredMcp(cwd: string, claudeJsonPath: string, box?: FsBox): Promise<ConfiguredMcp[]>;
