// The CLAUDE.md files a session loads, in the order Claude Code loads them, plus the files those
// pull in with `@`. Read-only: the routes in sessions.ts use this list as their allowlist. The
// walk and the import rules were read off the 2.1.263 binary; tested in instructions.test.ts.
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
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
export function importsIn(text) {
    const prose = text
        .replaceAll(/^```[\S\s]*?^```/gm, "")
        .replaceAll(/`[^`\n]*`/g, "")
        .replaceAll(/<!--[\S\s]*?-->/g, "");
    const out = [];
    for (const match of prose.matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)) {
        const raw = match[1] ?? "";
        const path = raw.split("#")[0]?.replaceAll("\\ ", " ") ?? "";
        if (!path)
            continue;
        const absolute = path.startsWith("/") && path !== "/";
        const relative = path.startsWith("./") || path.startsWith("~/");
        const bare = !path.startsWith("@") && !/^[#%&*()^]/.test(path) && /^[\w.-]/.test(path);
        if (absolute || relative || bare)
            out.push(path);
    }
    return out;
}
/** A `@` path as the importing file sees it: `~` is home, anything relative hangs off its dir. */
const resolveImport = (path, from) => path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(dirname(from), path);
const statFile = async (path) => {
    try {
        const s = await stat(path);
        return s.isFile() ? { size: s.size, mtime: s.mtimeMs } : null;
    }
    catch {
        return null;
    }
};
/** The `.md` files directly in a rules directory, sorted; a directory that is not there reads empty. */
const rulesIn = async (dir) => {
    const names = await readdir(dir).catch(() => []);
    return names
        .filter((n) => n.endsWith(".md"))
        .toSorted()
        .map((n) => join(dir, n));
};
/**
 * Every CLAUDE.md the CLI would load for this directory, in load order: the managed files, the
 * user's, then each ancestor of the workspace from the root down, ending at the workspace itself.
 * A file pulled in by `@` follows the file that imported it and keeps its scope. Files that are
 * not there are skipped, and each path appears once however many times it is reached.
 */
export async function listInstructions(cwd, claudeHome) {
    const files = [];
    const seen = new Set();
    const add = async (path, kind, depth = 0, importedBy) => {
        const at = resolve(path);
        if (seen.has(at))
            return;
        seen.add(at);
        const found = await statFile(at);
        if (found === null)
            return;
        const file = { path: at, kind, size: found.size, mtime: found.mtime };
        if (importedBy !== undefined)
            file.importedBy = importedBy;
        files.push(file);
        if (depth >= MAX_IMPORT_DEPTH)
            return;
        const text = await readFile(at, "utf8").catch(() => "");
        if (!text.includes("@"))
            return;
        for (const imported of importsIn(text))
            await add(resolveImport(imported, at), kind, depth + 1, at);
    };
    await add(join(MANAGED_DIR, "CLAUDE.md"), "Managed");
    for (const rule of await rulesIn(join(MANAGED_DIR, ".claude", "rules")))
        await add(rule, "Managed");
    await add(join(claudeHome, "CLAUDE.md"), "User");
    for (const rule of await rulesIn(join(claudeHome, "rules")))
        await add(rule, "User");
    // Root first, workspace last: the nearer file is loaded later and so has the last word.
    const chain = [];
    for (let dir = resolve(cwd);; dir = dirname(dir)) {
        chain.unshift(dir);
        if (dir === dirname(dir))
            break;
    }
    for (const dir of chain) {
        await add(join(dir, "CLAUDE.md"), "Project");
        await add(join(dir, ".claude", "CLAUDE.md"), "Project");
        for (const rule of await rulesIn(join(dir, ".claude", "rules")))
            await add(rule, "Project");
        await add(join(dir, "CLAUDE.local.md"), "Local");
    }
    return files;
}
//# sourceMappingURL=instructions.js.map