// The CLAUDE.md files a session loads, in the order Claude Code loads them, plus the files those
// pull in with `@`. Read-only: the routes in sessions.ts use this list as their allowlist. The
// walk and the import rules were read off the 2.1.263 binary; tested in instructions.test.ts.
import { dirname, join, resolve } from "node:path";
import { homeAt, listNamesAt, readAt, type FsBox } from "./remote-fs.js";

/** Where a file sits in the hierarchy, named as the CLI names its own layers. */
export type InstructionKind = "Managed" | "User" | "Project" | "Local";

/** One loaded file. `importedBy` is set when a `@` line in another file pulled it in. */
export interface InstructionFile {
  path: string;
  kind: InstructionKind;
  size: number;
  mtime: number;
  importedBy?: string;
}

/** The CLI's managed directory on Linux; the same path the managed settings file sits in. */
const MANAGED_DIR = "/etc/claude-code";

/** The CLI's own limit on how deep `@` imports nest before it stops following them. */
const MAX_IMPORT_DEPTH = 5;

/**
 * The `@` lines the CLI reads as imports. Its own regex, with its own acceptance rules: the `@`
 * has to open the line or follow whitespace (so `you@example.com` is an address, not an import),
 * a `#` ends the path, `\ ` is an escaped space, and the path is a relative, home or absolute one.
 *
 * The CLI walks a markdown token tree and skips code and codespan tokens. Rather than pull a
 * markdown parser in for it, fenced blocks and inline spans are cut out of the text first, which
 * agrees with the CLI on everything but a fence opened and never closed.
 */
export function importsIn(text: string): string[] {
  const prose = text
    .replaceAll(/^```[\S\s]*?^```/gm, "")
    .replaceAll(/`[^`\n]*`/g, "")
    .replaceAll(/<!--[\S\s]*?-->/g, "");
  const out: string[] = [];
  for (const match of prose.matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)) {
    const raw = match[1] ?? "";
    const path = raw.split("#")[0]?.replaceAll("\\ ", " ") ?? "";
    if (!path) continue;
    const absolute = path.startsWith("/") && path !== "/";
    const relative = path.startsWith("./") || path.startsWith("~/");
    const bare = !path.startsWith("@") && !/^[#%&*()^]/.test(path) && /^[\w.-]/.test(path);
    if (absolute || relative || bare) out.push(path);
  }
  return out;
}

/** A `@` path as the importing file sees it: `~` is home, anything relative hangs off its dir. */
const resolveImport = (path: string, from: string, home: string): string =>
  path.startsWith("~/") ? join(home, path.slice(2)) : resolve(dirname(from), path);

/** The `.md` files directly in a rules directory, sorted; a directory that is not there reads empty. */
const rulesIn = async (box: FsBox, dir: string): Promise<string[]> => {
  const names = await listNamesAt(box, dir).catch(() => []);
  return names
    .filter((n) => n.endsWith(".md"))
    .toSorted()
    .map((n) => join(dir, n));
};

/**
 * Whether a listed file may be written back. The list doubles as the write allowlist, and a `@`
 * line puts any absolute path a repo names on it — a cloned `CLAUDE.md` holding `@~/.ssh/authorized_keys`
 * would otherwise offer that file as an editable row. The CLI loads instructions as markdown, so a
 * path that is not a `.md` file is never one this panel should be rewriting.
 */
export const isWritableInstructions = (path: string): boolean => path.endsWith(".md");

/**
 * Every CLAUDE.md the CLI would load for this directory, in load order: the managed files, the
 * user's, then each ancestor of the workspace from the root down, ending at the workspace itself.
 * A file pulled in by `@` follows the file that imported it and keeps its scope. Files that are
 * not there are skipped, and each path appears once however many times it is reached.
 */
export async function listInstructions(
  cwd: string,
  claudeHome: string,
  box: FsBox = {},
): Promise<InstructionFile[]> {
  const files: InstructionFile[] = [];
  const seen = new Set<string>();
  // `~/` in an import is the home of the box the files live on, not this PC's.
  const home = await homeAt(box);

  const add = async (path: string, kind: InstructionKind, depth = 0, importedBy?: string) => {
    const at = resolve(path);
    if (seen.has(at)) return;
    seen.add(at);
    // One read serves both the listing and the imports it pulls in, which is a round trip rather
    // than two for a box across ssh. Anything that will not read as a file — absent, a directory,
    // unreadable — is skipped: this walk is discovery, and the status panel is where a box that
    // cannot be reached is reported.
    const found = await readAt(box, at).catch(() => null);
    if (found === null) return;
    const file: InstructionFile = {
      path: at,
      kind,
      size: Buffer.byteLength(found.text, "utf8"),
      mtime: found.mtimeMs,
    };
    if (importedBy !== undefined) file.importedBy = importedBy;
    files.push(file);
    if (depth >= MAX_IMPORT_DEPTH || !found.text.includes("@")) return;
    for (const imported of importsIn(found.text))
      await add(resolveImport(imported, at, home), kind, depth + 1, at);
  };

  await add(join(MANAGED_DIR, "CLAUDE.md"), "Managed");
  for (const rule of await rulesIn(box, join(MANAGED_DIR, ".claude", "rules")))
    await add(rule, "Managed");

  await add(join(claudeHome, "CLAUDE.md"), "User");
  for (const rule of await rulesIn(box, join(claudeHome, "rules"))) await add(rule, "User");

  // Root first, workspace last: the nearer file is loaded later and so has the last word.
  const chain: string[] = [];
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    chain.unshift(dir);
    if (dir === dirname(dir)) break;
  }
  for (const dir of chain) {
    await add(join(dir, "CLAUDE.md"), "Project");
    await add(join(dir, ".claude", "CLAUDE.md"), "Project");
    for (const rule of await rulesIn(box, join(dir, ".claude", "rules")))
      await add(rule, "Project");
    await add(join(dir, "CLAUDE.local.md"), "Local");
  }
  return files;
}
