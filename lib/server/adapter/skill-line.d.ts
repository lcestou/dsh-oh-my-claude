/**
 * Where Claude Code looks for `/command`: the project's `.claude/skills` and `.claude/commands`,
 * then the user's. A `plugin:skill` name has no file of its own here, so it gets no paths.
 */
export declare function claudeCommandFiles(command: string, cwd: string | undefined, claudeHome: string): string[];
/**
 * The first of those files that reads, without its frontmatter and with `$ARGUMENTS` filled in.
 * Undefined when none reads or every one is blank after that, which the caller treats as a
 * command only Claude Code can run.
 */
export declare function claudeCommandText(command: string, rawInput: string, cwd: string | undefined, claudeHome: string): Promise<{
    path: string;
    body: string;
} | undefined>;
/**
 * The instructions in the `<skill_content>` shape dsh's own skill injection writes, so the model
 * reads a Claude Code skill the way it reads a dsh one. A SKILL.md gets its folder as the base
 * directory for relative paths; a custom command has no resources to point at.
 */
export declare function skillContent(name: string, path: string, body: string): string;
