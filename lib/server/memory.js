// Claude Code's auto-memory for a workspace: `<project dir>/memory/*.md`, one fact per file,
// with `MEMORY.md` as the one-line index Claude loads each session.
//
// Every read and write goes through `remote-fs`, so a session running on an SSH box lists and edits
// that box's memories rather than this PC's. A box that is this PC still lands on `node:fs`.
import { join } from "node:path";
import { listNamesAt, readAt, readTextAt, removeAt, writeAt } from "./remote-fs.js";
/** A bare `*.md` file name inside the memory dir, never a path. */
export const isMemoryName = (name) => /^\w[\w.-]{0,127}\.md$/.test(name);
/** The `description:` line of the frontmatter, else "". */
export function memorySummary(text) {
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
export async function listMemory(box, dir) {
    const names = (await listNamesAt(box, dir).catch(() => [])).filter(isMemoryName);
    const files = await Promise.all(names.map(async (name) => {
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
    }));
    // Index first, then newest first.
    return files
        .filter((f) => f !== null)
        .toSorted((a, b) => a.name === "MEMORY.md" ? -1 : b.name === "MEMORY.md" ? 1 : b.mtime - a.mtime);
}
/** Drops every index line that links `name`, so the index stays in step after a delete. */
export function dropIndexLine(index, name) {
    return index
        .split("\n")
        .filter((line) => !line.includes(`](${name})`))
        .join("\n");
}
/** Remove one memory file and drop its line from the MEMORY.md index. Deleting MEMORY.md itself
 *  leaves no index to update. */
export async function deleteMemory(box, dir, name) {
    await removeAt(box, join(dir, name));
    if (name === "MEMORY.md")
        return;
    const indexPath = join(dir, "MEMORY.md");
    const index = await readTextAt(box, indexPath);
    if (index === null)
        return;
    const next = dropIndexLine(index, name);
    if (next !== index)
        await writeAt(box, indexPath, next);
}
//# sourceMappingURL=memory.js.map