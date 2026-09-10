// The skills Claude Code can reach for a directory, with where each one comes from: the user's
// `~/.claude/skills`, the project's `.claude/skills`, and the skills of every installed plugin, read
// from the install paths the CLI records in `plugins/installed_plugins.json`. A skill is a directory
// holding a `SKILL.md` whose frontmatter names and describes it; the listing reads that head only.
// Box-aware through the same helpers the instructions list uses, so an ssh box lists its own.
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { listDirsAt, readTextAt } from "./remote-fs.js";
/**
 * Read `name:` and `description:` out of a SKILL.md's frontmatter. A quoted value loses its quotes;
 * a block value (`description: >` or `|`) takes its first indented line; anything else is the text
 * after the colon. Without a frontmatter fence there is nothing to read.
 */
export function parseSkillHead(text) {
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== "---")
        return {};
    const head = {};
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (line.trim() === "---")
            break;
        const m = /^(name|description):\s*(.*)$/.exec(line);
        if (m === null)
            continue;
        const key = m[1] === "name" ? "name" : "description";
        let value = (m[2] ?? "").trim();
        if (value === ">" || value === "|" || value === ">-" || value === "|-") {
            value = (lines[i + 1] ?? "").trim();
        }
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
            value = value.slice(1, -1);
        head[key] = value;
    }
    return head;
}
/**
 * Every `<dir>/<skill>/SKILL.md` under one skills directory, read and parsed; absent dir = none.
 * On an ssh box the heads are not read: a hundred skills would be a hundred round trips, so the
 * rows carry the directory names alone and the listing costs one round trip per directory.
 */
async function skillsUnder(box, dir, scope) {
    const level = await listDirsAt(box, dir).catch(() => null);
    if (level === null)
        return [];
    if (box.sshHost)
        return level.names.map((name) => ({
            name,
            scope,
            path: join(dir, name, "SKILL.md"),
            description: "",
        }));
    const reads = await Promise.all(level.names.map(async (name) => {
        const path = join(dir, name, "SKILL.md");
        const text = await readTextAt(box, path).catch(() => null);
        if (text === null)
            return null;
        const head = parseSkillHead(text);
        return {
            name: head.name || name,
            scope,
            path,
            description: (head.description ?? "").slice(0, 200),
        };
    }));
    return reads.filter((s) => s !== null);
}
/** The slice of `installed_plugins.json` this listing reads: each plugin's install records. */
const Installed = z.object({
    plugins: z.dict(z.array(z.object({ installPath: z.string() }))),
});
/**
 * The install path of every plugin the CLI has installed, keyed by `name@marketplace`. The file is
 * `{ version, plugins: { key: [{ installPath, scope, version, ... }] } }`; a box without the file,
 * or a file off that shape, has no plugin skills to list.
 */
async function installedPlugins(box, claudeHome) {
    const out = new Map();
    const text = await readTextAt(box, join(claudeHome, "plugins", "installed_plugins.json")).catch(() => null);
    if (text === null)
        return out;
    let parsed;
    try {
        parsed = Installed(JSON.parse(text));
    }
    catch {
        return out;
    }
    for (const [key, records] of Object.entries(parsed.plugins ?? {})) {
        const at = records.find((r) => r.installPath)?.installPath;
        if (at)
            out.set(key, at);
    }
    return out;
}
/** The skills the CLI can reach for `cwd` on the box: user, then project, then each plugin's. */
export async function listSkills(cwd, claudeHome, box = {}) {
    const installed = await installedPlugins(box, claudeHome);
    const groups = await Promise.all([
        skillsUnder(box, join(claudeHome, "skills"), "user"),
        skillsUnder(box, join(cwd, ".claude", "skills"), "project"),
        ...[...installed].map(([key, at]) => skillsUnder(box, join(at, "skills"), `plugin:${key.split("@")[0] ?? key}`)),
    ]);
    return groups.flat();
}
//# sourceMappingURL=skills.js.map