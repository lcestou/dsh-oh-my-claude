// Claude Code's auto-memory for a workspace: `<project dir>/memory/*.md`, one fact per file,
// with `MEMORY.md` as the one-line index Claude loads each session.
//
// Every read and write goes through `remote-fs`, so a session running on an SSH box lists and edits
// that box's memories rather than this PC's. A box that is this PC still lands on `node:fs`.
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { listNamesAt, readAt, readTextAt, removeAt, writeAt, type FsBox } from "./remote-fs.js";

/** `path` with its symlinks resolved on this PC. Left as given on an SSH box, which has no helper
 *  for it, and when it cannot be resolved. */
const real = (box: FsBox, path: string): Promise<string> =>
  box.sshHost ? Promise.resolve(path) : realpath(path).catch(() => path);

/**
 * The main checkout a linked worktree belongs to, from the text of the worktree's `.git` file.
 * Answers `dir` itself whenever the pointer is not a worktree's: a submodule (its git dir has no
 * `commondir`), a git dir outside `<common>/worktrees/`, or one whose `gitdir` back-link does not
 * name this `.git` file. The CLI makes the same three checks (read off the 2.1.287 binary), so a
 * checked-out `.git` file cannot point the memory tab at another repository's memories.
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
 * The directory whose name keys a workspace's auto-memory. Claude Code keys memory by repository,
 * not by cwd the way it keys transcripts: a subdirectory uses the checkout's root, and a linked
 * worktree uses its main checkout's, so every worktree of one repository shares one memory.
 * Outside a repository the answer is `cwd`.
 *
 * A `.git` that is there but will not read as a file is taken to be a checkout's `.git` directory.
 * That also covers an SSH box that cannot be reached, which then answers `cwd`, the key used
 * before this function existed.
 *
 * ponytail: one read per ancestor until a `.git` turns up, each an ssh round trip on a box. A
 * session normally opens at the checkout root, which is one read; fold the walk into one remote
 * script if deep non-repository workspaces make the tab slow.
 */
export async function memoryRoot(box: FsBox, cwd: string): Promise<string> {
  for (let dir = cwd; ; dir = dirname(dir)) {
    let dotGit: string | null;
    try {
      dotGit = await readTextAt(box, join(dir, ".git"));
    } catch {
      return dir;
    }
    if (dotGit !== null) return mainCheckout(box, dir, dotGit);
    if (dir === dirname(dir)) return cwd;
  }
}

export interface MemoryFile {
  name: string;
  size: number;
  mtime: number;
  /** `description:` from the frontmatter, or the first non-empty body line for MEMORY.md. */
  summary: string;
}

/** A bare `*.md` file name inside the memory dir, never a path. */
export const isMemoryName = (name: string): boolean => /^\w[\w.-]{0,127}\.md$/.test(name);

/** The `description:` line of the frontmatter, else "". */
export function memorySummary(text: string): string {
  const m = /^description:\s*(.+)$/m.exec(text.split(/^---\s*$/m)[1] ?? "");
  return m?.[1]?.trim() ?? "";
}

/**
 * The memory files with their size, age and summary.
 *
 * ponytail: one read per file, which on a box is one ssh round trip each. They share a control
 * socket and run at once, and a memory dir holds tens of files, not thousands. Fold them into a
 * single remote script the day a directory is big enough to feel it.
 */
export async function listMemory(box: FsBox, dir: string): Promise<MemoryFile[]> {
  const names = (await listNamesAt(box, dir).catch((): string[] => [])).filter(isMemoryName);
  const files = await Promise.all(
    names.map(async (name) => {
      // A file listed a moment ago can be gone by the time it is read; it drops out of the list
      // rather than failing the whole tab.
      const read = await readAt(box, join(dir, name));
      return read === null
        ? null
        : {
            name,
            size: Buffer.byteLength(read.text, "utf8"),
            mtime: read.mtimeMs,
            summary: memorySummary(read.text),
          };
    }),
  );
  // Index first, then newest first.
  return files
    .filter((f): f is MemoryFile => f !== null)
    .toSorted((a, b) =>
      a.name === "MEMORY.md" ? -1 : b.name === "MEMORY.md" ? 1 : b.mtime - a.mtime,
    );
}

/** Drops every index line that links `name`, so the index stays in step after a delete. */
export function dropIndexLine(index: string, name: string): string {
  return index
    .split("\n")
    .filter((line) => !line.includes(`](${name})`))
    .join("\n");
}

/** Remove one memory file and drop its line from the MEMORY.md index. Deleting MEMORY.md itself
 *  leaves no index to update. */
export async function deleteMemory(box: FsBox, dir: string, name: string): Promise<void> {
  await removeAt(box, join(dir, name));
  if (name === "MEMORY.md") return;
  const indexPath = join(dir, "MEMORY.md");
  const index = await readTextAt(box, indexPath);
  if (index === null) return;
  const next = dropIndexLine(index, name);
  if (next !== index) await writeAt(box, indexPath, next);
}
