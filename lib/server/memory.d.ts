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
export declare function listMemory(dir: string): Promise<MemoryFile[]>;
/** Drops every index line that links `name`, so the index stays in step after a delete. */
export declare function dropIndexLine(index: string, name: string): string;
export declare function deleteMemory(dir: string, name: string): Promise<void>;
