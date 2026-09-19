import { type FsBox } from "./remote-fs.js";
export interface SkillEntry {
    /** The name the frontmatter gives, else the directory's. */
    name: string;
    /** `user`, `project`, or `plugin:<name>` for a plugin's skill. */
    scope: string;
    /** The SKILL.md on the box. */
    path: string;
    description: string;
}
/** The frontmatter head of a SKILL.md: `name` and the first line of `description`. */
export interface SkillHead {
    name?: string;
    description?: string;
}
/**
 * Read `name:` and `description:` out of a SKILL.md's frontmatter. A quoted value loses its quotes;
 * a block value (`description: >` or `|`) takes its first indented line; anything else is the text
 * after the colon. Without a frontmatter fence there is nothing to read.
 */
export declare function parseSkillHead(text: string): SkillHead;
/** The skills the CLI can reach for `cwd` on the box: user, then project, then each plugin's. */
export declare function listSkills(cwd: string, claudeHome: string, box?: FsBox): Promise<SkillEntry[]>;
/** A skill directory name the routes accept: lowercase letters, digits and hyphens, starting on a
 *  letter or digit, 1 to 64 characters. Refuses "", uppercase, a leading hyphen, "..", and a slash,
 *  so a create can never write outside its skills root. */
export declare const validSkillName: (name: string) => boolean;
/** The two scopes a person can write. A plugin's skills are edited where the plugin ships them. */
export declare const isWritableSkillScope: (scope: string) => scope is "user" | "project";
/** The SKILL.md a fresh skill starts as. The frontmatter is what the CLI loads; the body is a lean
 *  prompt for the person to replace. An empty description falls back to a placeholder line. */
export declare function skillTemplate(name: string, description: string): string;
/** Where a new skill's SKILL.md goes, or null for a scope with no writable directory (a project
 *  scope with no workspace, or a plugin scope, or an invalid name). */
export declare function skillTargetPath(scope: string, name: string, claudeHome: string, cwd: string | undefined): string | null;
