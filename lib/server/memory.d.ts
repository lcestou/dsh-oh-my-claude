import { type FsBox } from "./remote-fs.js";
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
export declare function memoryRoot(box: FsBox, cwd: string): Promise<string>;
export interface MemoryFile {
    name: string;
    size: number;
    mtime: number;
    /** `description:` from the frontmatter, or the first non-empty body line for MEMORY.md. */
    summary: string;
}
/** A bare `*.md` file name inside the memory dir, never a path. */
export declare const isMemoryName: (name: string) => boolean;
/** The `description:` line of the frontmatter, else "". */
export declare function memorySummary(text: string): string;
/**
 * The memory files with their size, age and summary.
 *
 * ponytail: one read per file, which on a box is one ssh round trip each. They share a control
 * socket and run at once, and a memory dir holds tens of files, not thousands. Fold them into a
 * single remote script the day a directory is big enough to feel it.
 */
export declare function listMemory(box: FsBox, dir: string): Promise<MemoryFile[]>;
/** Drops every index line that links `name`, so the index stays in step after a delete. */
export declare function dropIndexLine(index: string, name: string): string;
/** Remove one memory file and drop its line from the MEMORY.md index. Deleting MEMORY.md itself
 *  leaves no index to update. */
export declare function deleteMemory(box: FsBox, dir: string, name: string): Promise<void>;
