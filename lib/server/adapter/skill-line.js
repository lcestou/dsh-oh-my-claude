// A bridged Claude Code command typed in a session that runs on another model. Claude Code would
// expand a skill or a custom command from its own files; that model never sees them, so the bridge
// reads the same file and hands its text to the model beside the line. dsh expands a skill it has
// itself (its `/name` gesture), so this is only for what Claude Code alone has.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
/**
 * Where Claude Code looks for `/command`: the project's `.claude/skills` and `.claude/commands`,
 * then the user's. A `plugin:skill` name has no file of its own here, so it gets no paths.
 */
export function claudeCommandFiles(command, cwd, claudeHome) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(command))
        return [];
    const roots = [...(cwd ? [join(cwd, ".claude")] : []), claudeHome];
    return roots.flatMap((root) => [
        join(root, "skills", command, "SKILL.md"),
        join(root, "commands", `${command}.md`),
    ]);
}
/**
 * The first of those files that reads, without its frontmatter and with `$ARGUMENTS` filled in.
 * Undefined when none reads or every one is blank after that, which the caller treats as a
 * command only Claude Code can run.
 */
export async function claudeCommandText(command, rawInput, cwd, claudeHome) {
    for (const path of claudeCommandFiles(command, cwd, claudeHome)) {
        let text;
        try {
            text = await readFile(path, "utf8");
        }
        catch {
            continue;
        }
        const body = text
            .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
            // A function, so a `$&` or `$'` typed as an argument is inserted as text, not as a pattern.
            .replaceAll("$ARGUMENTS", () => rawInput.trim())
            .trim();
        if (body !== "")
            return { path, body };
    }
    return undefined;
}
/**
 * The instructions in the `<skill_content>` shape dsh's own skill injection writes, so the model
 * reads a Claude Code skill the way it reads a dsh one. A SKILL.md gets its folder as the base
 * directory for relative paths; a custom command has no resources to point at.
 */
export function skillContent(name, path, body) {
    const base = path.endsWith("SKILL.md") ? path.slice(0, -"/SKILL.md".length) : undefined;
    return [
        `<skill_content name="${name.replace(/[&"<>]/g, "")}">`,
        "<skill_resources>",
        base === undefined
            ? "This is a Claude Code custom command; it has no resources of its own."
            : `Base directory for this skill: ${base}\nResolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.`,
        "</skill_resources>",
        "",
        "<skill_instructions>",
        body,
        "</skill_instructions>",
        "</skill_content>",
    ].join("\n");
}
//# sourceMappingURL=skill-line.js.map