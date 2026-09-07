import type { JsonValue } from "./dsh.js";
/** The three lists under `permissions` in settings.json. */
export declare const PERMISSION_KINDS: readonly ["allow", "deny", "ask"];
export type PermissionKind = (typeof PERMISSION_KINDS)[number];
export type PermissionRules = {
    [K in PermissionKind]: string[];
};
/**
 * The rule that would have answered this request without asking. A Bash command becomes its own
 * first word, plus the second when that is a subcommand rather than a flag, and the CLI's `:*` so
 * the rest of the line is free: `git status --short` reads as `Bash(git status:*)` and `ls -la` as
 * `Bash(ls:*)`. Anything carrying a file path becomes that path, which is exact. Everything else is
 * the bare tool name, which covers the tool. The chip is editable, so a rule that is too narrow or
 * too broad costs a keystroke, not a wrong grant.
 */
export declare function suggestRule(toolName: string, input: Record<string, JsonValue>): string;
/** The three lists as they stand. A file that is not JSON, or a list of the wrong shape, reads empty. */
export declare function readPermissionRules(text: string): PermissionRules;
/**
 * Add or remove one rule, leaving every other key where it was. Adding a rule already in the list
 * changes nothing, and removing the last rule of a kind takes the key with it, so the file does not
 * collect empty arrays.
 */
export declare function setPermissionRule(text: string, kind: PermissionKind, rule: string, action: "add" | "remove"): {
    text: string;
    error?: undefined;
} | {
    error: string;
};
