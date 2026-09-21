import { type FsBox } from "./remote-fs.js";
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
 * ponytail: one read per file, which on a box is one ssh round trip each — they share a control
 * socket and run at once, and a memory dir holds tens of files, not thousands. Fold them into a
 * single remote script the day a directory is big enough to feel it.
 */
export declare function listMemory(box: FsBox, dir: string): Promise<MemoryFile[]>;
/** Drops every index line that links `name`, so the index stays in step after a delete. */
export declare function dropIndexLine(index: string, name: string): string;
/** Remove one memory file and drop its line from the MEMORY.md index. Deleting MEMORY.md itself
 *  leaves no index to update. */
export declare function deleteMemory(box: FsBox, dir: string, name: string): Promise<void>;
