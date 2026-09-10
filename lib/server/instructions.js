// The CLAUDE.md files a session loads, in the order Claude Code loads them, plus the files those
// pull in with `@`. Read-only: the routes in sessions.ts use this list as their allowlist. The
// walk and the import rules were read off the 2.1.263 binary; tested in instructions.test.ts.
import { dirname, join, resolve } from "node:path";
import { homeAt, listNamesAt, readAt } from "./remote-fs.js";
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
const resolveImport = (path, from, home) => path.startsWith("~/") ? join(home, path.slice(2)) : resolve(dirname(from), path);
/** The `.md` files directly in a rules directory, sorted; a directory that is not there reads empty. */
const rulesIn = async (box, dir) => {
    const names = await listNamesAt(box, dir).catch(() => []);
    return names
        .filter((n) => n.endsWith(".md"))
        .toSorted()
        .map((n) => join(dir, n));
};
/** The ancestors of `cwd`, root first: the order the CLI loads them in, nearest file last. */
const ancestors = (cwd) => {
    const chain = [];
    for (let dir = resolve(cwd);; dir = dirname(dir)) {
        chain.unshift(dir);
        if (dir === dirname(dir))
            break;
    }
    return chain;
};
/**
 * Every file the walk below asks for by name, in walk order. Only the fixed ones: a rules file is
 * named by a directory listing that has not happened yet, and an `@` import by a file that has not
 * been read yet, so both are found on the way through.
 */
export const instructionCandidates = (cwd, claudeHome) => [
    join(MANAGED_DIR, "CLAUDE.md"),
    join(claudeHome, "CLAUDE.md"),
    ...ancestors(cwd).flatMap((dir) => [
        join(dir, "CLAUDE.md"),
        join(dir, ".claude", "CLAUDE.md"),
        join(dir, "CLAUDE.local.md"),
    ]),
];
/** The rules directories the walk lists, in walk order. */
const ruleDirs = (cwd, claudeHome) => [
    join(MANAGED_DIR, ".claude", "rules"),
    join(claudeHome, "rules"),
    ...ancestors(cwd).map((dir) => join(dir, ".claude", "rules")),
];
/**
 * How many reads may be in flight at once.
 *
 * On an ssh box every read is a channel on the shared connection, and sshd's default MaxSessions is
 * 10 — open more and the extras are refused, which would read as a missing file. Six leaves room for
 * the session pipe and the status probe to keep working while a panel loads.
 * ponytail: a fixed cap, not a pool shared with the rest of the plugin's ssh; raise it only
 * alongside the box's MaxSessions.
 */
const READ_FANOUT = 6;
/** Run `job` over `items`, `limit` at a time. Results are discarded: each job caches its own. */
const inFlight = async (items, limit, job) => {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const item = items[next++];
            if (item !== undefined)
                await job(item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
};
/**
 * Whether a listed file may be written back. The list doubles as the write allowlist, and a `@`
 * line puts any absolute path a repo names on it — a cloned `CLAUDE.md` holding `@~/.ssh/authorized_keys`
 * would otherwise offer that file as an editable row. The CLI loads instructions as markdown, so a
 * path that is not a `.md` file is never one this panel should be rewriting.
 */
export const isWritableInstructions = (path) => path.endsWith(".md");
/**
 * Every CLAUDE.md the CLI would load for this directory, in load order: the managed files, the
 * user's, then each ancestor of the workspace from the root down, ending at the workspace itself.
 * A file pulled in by `@` follows the file that imported it and keeps its scope. Files that are
 * not there are skipped, and each path appears once however many times it is reached.
 */
export async function listInstructions(cwd, claudeHome, box = {}) {
    const files = [];
    const seen = new Set();
    // One read serves both the listing and the imports it pulls in, which is a round trip rather
    // than two for a box across ssh. Anything that will not read as a file — absent, a directory,
    // unreadable — is skipped: this walk is discovery, and the status panel is where a box that
    // cannot be reached is reported.
    const reads = new Map();
    const readOnce = (at) => {
        let job = reads.get(at);
        if (job === undefined) {
            job = readAt(box, at).catch(() => null);
            reads.set(at, job);
        }
        return job;
    };
    const lists = new Map();
    const listOnce = (dir) => {
        let job = lists.get(dir);
        if (job === undefined) {
            job = rulesIn(box, dir);
            lists.set(dir, job);
        }
        return job;
    };
    // The walk below is a chain of awaits, so on an ssh box it used to spend one full round trip per
    // ancestor file with the connection idle in between — about 25 of them in a row, 0.09s each on a
    // LAN even with the shared connection. The paths it will ask for are known before it starts, so
    // they go out together first and the walk reads their answers; it still visits them in load
    // order, and a path the prefetch did not know (a rules file, an `@` import) is fetched when it
    // is reached.
    // `~/` in an import is the home of the box the files live on, not this PC's. It is asked for
    // alongside the prefetch rather than after it: it is one more round trip on an ssh box, and
    // nothing before the first `@` line needs the answer.
    const homeJob = homeAt(box);
    // A box that cannot be reached rejects this, and the prefetch below is several awaits long: with
    // no handler attached yet that reaches the host as an unhandled rejection. The await further down
    // is what reports it, as before; this only says someone is coming for it.
    void homeJob.catch(() => { });
    const warm = inFlight(instructionCandidates(cwd, claudeHome), READ_FANOUT, readOnce);
    await inFlight(ruleDirs(cwd, claudeHome), READ_FANOUT, listOnce);
    await warm;
    const home = await homeJob;
    const add = async (path, kind, depth = 0, importedBy) => {
        const at = resolve(path);
        if (seen.has(at))
            return;
        seen.add(at);
        const found = await readOnce(at);
        if (found === null)
            return;
        const file = {
            path: at,
            kind,
            size: Buffer.byteLength(found.text, "utf8"),
            mtime: found.mtimeMs,
        };
        if (importedBy !== undefined)
            file.importedBy = importedBy;
        files.push(file);
        if (depth >= MAX_IMPORT_DEPTH || !found.text.includes("@"))
            return;
        for (const imported of importsIn(found.text))
            await add(resolveImport(imported, at, home), kind, depth + 1, at);
    };
    await add(join(MANAGED_DIR, "CLAUDE.md"), "Managed");
    for (const rule of await listOnce(join(MANAGED_DIR, ".claude", "rules")))
        await add(rule, "Managed");
    await add(join(claudeHome, "CLAUDE.md"), "User");
    for (const rule of await listOnce(join(claudeHome, "rules")))
        await add(rule, "User");
    // Root first, workspace last: the nearer file is loaded later and so has the last word.
    for (const dir of ancestors(cwd)) {
        await add(join(dir, "CLAUDE.md"), "Project");
        await add(join(dir, ".claude", "CLAUDE.md"), "Project");
        for (const rule of await listOnce(join(dir, ".claude", "rules")))
            await add(rule, "Project");
        await add(join(dir, "CLAUDE.local.md"), "Local");
    }
    return files;
}
//# sourceMappingURL=instructions.js.map