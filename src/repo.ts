// Where a directory sits in a git checkout, worked out from the files git writes and never by
// running git. Claude Code keys several things by the repository rather than by the directory a
// session runs in (auto-memory, local settings, local MCP servers, project skills), and a panel
// that keys them by the session's directory reads the wrong file as soon as a session opens in a
// subdirectory or a linked worktree. The rules here were read off the 2.1.287 binary and checked
// against a live CLI in a scratch repository with a subdirectory and a worktree.
//
// Every read goes through `remote-fs`, so a session on an SSH box is placed in that box's checkout.
import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { homeAt, isEnoent, readTextAt, type FsBox } from "./remote-fs.js";

/** `path` with its symlinks resolved on this PC. Left as given on an SSH box, which has no helper
 *  for it, and when it cannot be resolved. */
const real = (box: FsBox, path: string): Promise<string> =>
  box.sshHost ? Promise.resolve(path) : realpath(path).catch(() => path);

/** That box's home directory, or "" when it cannot be asked, which no path equals. */
const homeOf = (box: FsBox): Promise<string> =>
  box.sshHost ? homeAt(box).catch(() => "") : real(box, homedir());

/** `lstat` on this PC, or null when nothing is at `path`. Any other failure throws, so a
 *  directory that cannot be examined is not mistaken for one that is absent. */
async function lstatIfThere(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (e) {
    if (!isEnoent(e)) throw e;
    return null;
  }
}

/** The nearest directory with a `.git` entry, and that entry's text when it is a file. */
interface Checkout {
  root: string;
  /** Null for a `.git` directory, which is an ordinary checkout. */
  dotGit: string | null;
}

/**
 * The checkout `cwd` is inside, or null outside a repository.
 *
 * A `.git` that is there but will not read as a file is taken to be a checkout's `.git` directory.
 * That also covers an SSH box that cannot be reached, which then answers `cwd` as the root.
 *
 * ponytail: one read per ancestor until a `.git` turns up, each an ssh round trip on a box. A
 * session normally opens at the checkout root, which is one read; fold the walk into one remote
 * script if deep non-repository workspaces make a tab slow.
 */
async function checkoutOf(box: FsBox, cwd: string): Promise<Checkout | null> {
  for (let dir = cwd; ; dir = dirname(dir)) {
    let dotGit: string | null;
    try {
      dotGit = await readTextAt(box, join(dir, ".git"));
    } catch {
      return { root: dir, dotGit: null };
    }
    if (dotGit !== null) return { root: dir, dotGit };
    if (dir === dirname(dir)) return null;
  }
}

/**
 * The main checkout a linked worktree belongs to, from the text of the worktree's `.git` file.
 * Answers `dir` itself whenever the pointer is not a worktree's: a submodule (its git dir has no
 * `commondir`), a git dir outside `<common>/worktrees/`, or one whose `gitdir` back-link does not
 * name this `.git` file. The CLI makes the same three checks, so a checked-out `.git` file cannot
 * point a panel at another repository's memories or settings.
 *
 * ponytail: the back-link is compared without resolving symlinks on an SSH box, so a worktree
 * reached there through a symlinked path keeps its own key. Add a `realpath` to the remote
 * helpers if that turns up.
 */
async function mainCheckout(box: FsBox, dir: string, dotGit: string): Promise<string> {
  const pointer = /^gitdir:(.+)$/.exec(dotGit.trim())?.[1]?.trim();
  if (!pointer) return dir;
  const gitDir = resolve(dir, pointer);
  const read = (name: string) => readTextAt(box, join(gitDir, name)).catch(() => null);
  const [common, back] = await Promise.all([read("commondir"), read("gitdir")]);
  if (common === null || back === null) return dir;
  const commonDir = resolve(gitDir, common.trim());
  if (dirname(gitDir) !== join(commonDir, "worktrees")) return dir;
  const [backLink, own] = await Promise.all([
    real(box, resolve(gitDir, back.trim())),
    real(box, dir),
  ]);
  if (backLink !== join(own, ".git")) return dir;
  // A bare repository's common dir is the repository itself; otherwise it is `<checkout>/.git`.
  return basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
}

/**
 * The directory that stands for `cwd`'s repository: the checkout's root for a subdirectory, and
 * the main checkout's root for a linked worktree, so every worktree of one repository answers the
 * same. Outside a repository the answer is `cwd`. This is the key the CLI uses for auto-memory
 * and for the `projects` entry in `.claude.json`.
 */
export async function repoRoot(box: FsBox, cwd: string): Promise<string> {
  const found = await checkoutOf(box, cwd);
  if (found === null) return cwd;
  return found.dotGit === null ? found.root : mainCheckout(box, found.root, found.dotGit);
}

/**
 * `cwd` and its ancestors, nearest first, as far as the CLI looks for a project's own `.claude`
 * directories (skills): up to the root of the checkout `cwd` is in, which for a worktree is the
 * worktree and not the main checkout. Outside a repository the walk carries on to the filesystem
 * root. The home directory ends it either way and is left out, since its `.claude` is the user
 * scope: a session opened in the home directory has no project level at all. `home` is that box's
 * home directory, asked for when not given.
 */
export async function projectLevels(box: FsBox, cwd: string, home?: string): Promise<string[]> {
  const found = await checkoutOf(box, cwd);
  home ??= await homeOf(box);
  const levels: string[] = [];
  for (let dir = cwd; dir !== home; dir = dirname(dir)) {
    levels.push(dir);
    if (dir === found?.root || dir === dirname(dir)) break;
  }
  return levels;
}

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
export async function localSettingsRoot(
  box: FsBox,
  cwd: string,
  platform: string = process.platform,
  home?: string,
): Promise<string> {
  const root = await repoRoot(box, cwd);
  if (root === cwd || root === (home ?? (await homeOf(box)))) return cwd;
  if (box.sshHost) return root;
  const uid = process.geteuid?.();
  if (platform === "win32" || uid === undefined) return cwd;
  try {
    const [rootStat, gitStat, claudeStat] = await Promise.all([
      stat(root),
      lstat(join(root, ".git")),
      lstatIfThere(join(root, ".claude")),
    ]);
    const owned = [rootStat, gitStat, claudeStat].every((s) => s === null || s.uid === uid);
    return owned ? root : cwd;
  } catch {
    return cwd;
  }
}

/**
 * A directory as the CLI spells it for a key in `.claude.json`'s `projects`: forward slashes on a
 * Windows host, where the CLI rewrites the backslashes, and unchanged everywhere else, including
 * for a path on an SSH box.
 */
export const projectKey = (box: FsBox, dir: string, platform: string = process.platform): string =>
  !box.sshHost && platform === "win32" ? dir.replaceAll("\\", "/") : dir;
