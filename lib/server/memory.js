// Claude Code's auto-memory for a workspace: `<project dir>/memory/*.md`, one fact per file,
// with `MEMORY.md` as the one-line index Claude loads each session.
import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
/** A bare `*.md` file name inside the memory dir, never a path. */
export const isMemoryName = (name) => /^\w[\w.-]{0,127}\.md$/.test(name);
/** The `description:` line of the frontmatter, else "". */
export function memorySummary(text) {
    const m = /^description:\s*(.+)$/m.exec(text.split(/^---\s*$/m)[1] ?? "");
    return m?.[1]?.trim() ?? "";
}
export async function listMemory(dir) {
    const names = (await readdir(dir).catch(() => [])).filter(isMemoryName);
    const files = await Promise.all(names.map(async (name) => {
        const path = join(dir, name);
        const [s, text] = await Promise.all([stat(path), readFile(path, "utf8")]);
        return { name, size: s.size, mtime: s.mtimeMs, summary: memorySummary(text) };
    }));
    // Index first, then newest first.
    return files.toSorted((a, b) => a.name === "MEMORY.md" ? -1 : b.name === "MEMORY.md" ? 1 : b.mtime - a.mtime);
}
/** Drops every index line that links `name`, so the index stays in step after a delete. */
export function dropIndexLine(index, name) {
    return index
        .split("\n")
        .filter((line) => !line.includes(`](${name})`))
        .join("\n");
}
export async function deleteMemory(dir, name) {
    await unlink(join(dir, name));
    if (name === "MEMORY.md")
        return;
    const indexPath = join(dir, "MEMORY.md");
    const index = await readFile(indexPath, "utf8").catch(() => null);
    if (index === null)
        return;
    const next = dropIndexLine(index, name);
    if (next !== index)
        await writeFile(indexPath, next, "utf8");
}
//# sourceMappingURL=memory.js.map