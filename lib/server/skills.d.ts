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
