import { type FsBox } from "./remote-fs.js";
/**
 * The directory that stands for `cwd`'s repository: the checkout's root for a subdirectory, and
 * the main checkout's root for a linked worktree, so every worktree of one repository answers the
 * same. Outside a repository the answer is `cwd`. This is the key the CLI uses for auto-memory
 * and for the `projects` entry in `.claude.json`.
 */
export declare function repoRoot(box: FsBox, cwd: string): Promise<string>;
/**
 * `cwd` and its ancestors, nearest first, as far as the CLI looks for a project's own `.claude`
 * directories (skills): up to the root of the checkout `cwd` is in, which for a worktree is the
 * worktree and not the main checkout. Outside a repository the walk carries on to the filesystem
 * root. The home directory ends it either way and is left out, since its `.claude` is the user
 * scope: a session opened in the home directory has no project level at all. `home` is that box's
 * home directory, asked for when not given.
 */
export declare function projectLevels(box: FsBox, cwd: string, home?: string): Promise<string[]>;
/**
 * The directory whose `.claude/settings.local.json` the CLI reads first and writes to for a
 * session in `cwd`. That is the repository's root (`repoRoot`), but only when the CLI can vouch
 * for it: the root, its `.git` entry and its `.claude` directory (when there is one) all belong
 * to the current user, and the root is not the home directory. Otherwise, and always on Windows,
 * which has no user ids to check, it stays `cwd`.
 *
 * The CLI still reads `cwd`'s own file as well, below the root's, so a caller that merges
 * settings reads both; see `settingsTexts`.
 *
 * ponytail: ownership is not checked on an SSH box, which has no helper for it; a box where the
 * checkout belongs to another user answers the root while the CLI stays on `cwd`. Add a `stat`
 * to the remote helpers if that turns up.
 *
 * `home` is that box's home directory, asked for when not given.
 */
export declare function localSettingsRoot(box: FsBox, cwd: string, platform?: string, home?: string): Promise<string>;
/**
 * A directory as the CLI spells it for a key in `.claude.json`'s `projects`: forward slashes on a
 * Windows host, where the CLI rewrites the backslashes, and unchanged everywhere else, including
 * for a path on an SSH box.
 */
export declare const projectKey: (box: FsBox, dir: string, platform?: string) => string;
