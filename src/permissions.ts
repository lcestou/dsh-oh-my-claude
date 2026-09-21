// Permission rules as settings.json holds them, and the rule a tool call suggests. Pure: the
// adapter calls suggestRule on a request it is about to ask about, the Tune tab calls the rest on
// the file's text. Tested in permissions.test.ts.
import type { JsonValue } from "./dsh.js";

/** The three lists under `permissions` in settings.json. */
export const PERMISSION_KINDS = ["allow", "deny", "ask"] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];
export type PermissionRules = { [K in PermissionKind]: string[] };

/** A settings document as this module handles it: it edits one key and keeps the rest. */
type Settings = { [key: string]: JsonValue };

/**
 * The rule that would have answered this request without asking. A Bash command becomes its own
 * first word, plus the second when that is a subcommand rather than a flag, and the CLI's `:*` so
 * the rest of the line is free: `git status --short` reads as `Bash(git status:*)` and `ls -la` as
 * `Bash(ls:*)`. Anything carrying a file path becomes that path, which is exact. Everything else is
 * the bare tool name, which covers the tool. The chip is editable, so a rule that is too narrow or
 * too broad costs a keystroke, not a wrong grant.
 */
export function suggestRule(toolName: string, input: Record<string, JsonValue>): string {
  if (toolName === "Bash") {
    const words = String(input.command ?? "")
      .trim()
      .split(/\s+/);
    const head =
      words[1] !== undefined && !words[1].startsWith("-") ? words.slice(0, 2) : [words[0]];
    if (head[0]) return `Bash(${head.join(" ")}:*)`;
  }
  const path = input.file_path;
  if (typeof path === "string" && path !== "") return `${toolName}(${path})`;
  return toolName;
}

/**
 * The CLI's own shape for a rule: a tool name, optionally with a specifier in parentheses. Checked
 * before a write so a typo is refused here rather than ignored by the CLI at spawn.
 */
const RULE = /^[A-Za-z][\dA-Za-z_]*(\(.*\))?$/;

/** Parse settings JSON, or undefined when the text is not JSON or not a plain object. */
const settingsObject = (text: string): Settings | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!(parsed instanceof Object) || Array.isArray(parsed)) return undefined;
  // SAFETY: the value parsed as a plain object, which is the shape the settings route enforces too.
  return parsed as Settings;
};

/** The string rules under `kind`, or an empty list when `permissions` is missing, not an object,
 *  or not holding an array there. */
const ruleList = (settings: Settings | undefined, kind: PermissionKind): string[] => {
  const permissions = settings?.permissions;
  if (!(permissions instanceof Object) || Array.isArray(permissions)) return [];
  // SAFETY: a plain object; the value under each kind is checked before it is used.
  const list = (permissions as Settings)[kind];
  return Array.isArray(list) ? list.filter((rule) => typeof rule === "string") : [];
};

/** The three lists as they stand. A file that is not JSON, or a list of the wrong shape, reads empty. */
export function readPermissionRules(text: string): PermissionRules {
  const settings = settingsObject(text);
  return {
    allow: ruleList(settings, "allow"),
    deny: ruleList(settings, "deny"),
    ask: ruleList(settings, "ask"),
  };
}

/**
 * Add or remove one rule, leaving every other key where it was. Adding a rule already in the list
 * changes nothing, and removing the last rule of a kind takes the key with it, so the file does not
 * collect empty arrays.
 */
export function setPermissionRule(
  text: string,
  kind: PermissionKind,
  rule: string,
  action: "add" | "remove",
): { text: string; error?: undefined } | { error: string } {
  if (action === "add" && !RULE.test(rule.trim()))
    return { error: `a rule is a tool name, optionally with a specifier: Bash(npm run:*)` };
  const settings = settingsObject(text);
  if (settings === undefined) return { error: "settings.json must be a JSON object" };
  const current = ruleList(settings, kind);
  const next =
    action === "add" ? [...new Set([...current, rule.trim()])] : current.filter((r) => r !== rule);
  const permissions: Settings =
    settings.permissions instanceof Object && !Array.isArray(settings.permissions)
      ? // SAFETY: a plain object, the shape the CLI reads `permissions` as.
        { ...(settings.permissions as Settings) }
      : {};
  if (next.length === 0) delete permissions[kind];
  else permissions[kind] = next;
  if (Object.keys(permissions).length === 0) delete settings.permissions;
  else settings.permissions = permissions;
  // Two spaces and a trailing newline: how Claude Code writes the file itself.
  return { text: `${JSON.stringify(settings, null, 2)}\n` };
}
