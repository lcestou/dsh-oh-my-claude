// The settings scopes the editor in index.tsx switches between, and the note it shows when a
// higher-precedence file overrides what you are looking at. Pure: no fetch, no DOM.

/** The settings files the CLI merges, highest precedence first. */
export const SETTINGS_SCOPES = ["managed", "local", "project", "user"] as const;

/** One of the four settings files, named as the CLI's own layers are. */
export type SettingsScope = (typeof SETTINGS_SCOPES)[number];

/** One scope's file, as `GET /settings/scopes` reports it. */
export interface SettingsScopeInfo {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  text: string;
  mtime?: number;
  readOnly: boolean;
}

/** How each scope is named in the editor's own prose. */
export const SCOPE_LABELS = {
  managed: "the managed file",
  local: "settings.local.json",
  project: "the project's settings.json",
  user: "~/.claude/settings.json",
} satisfies { [K in SettingsScope]: string };

const topLevelKeys = (text: string): string[] => {
  try {
    const value: unknown = JSON.parse(text);
    return value instanceof Object && !Array.isArray(value) ? Object.keys(value) : [];
  } catch {
    return [];
  }
};

const listed = (words: readonly string[]): string =>
  words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/**
 * What the editor says under a scope some higher-precedence file also sets keys in: the CLI reads
 * that file's value, not the one on screen. Empty when nothing here is overridden. A file that is
 * not valid JSON contributes no keys rather than throwing, since the editor shows unsaved and
 * hand-edited text.
 */
export function overrideNote(scopes: readonly SettingsScopeInfo[], scope: SettingsScope): string {
  const mine = scopes.find((s) => s.scope === scope);
  if (!mine) return "";
  const rank = SETTINGS_SCOPES.indexOf(scope);
  const keys = new Set(topLevelKeys(mine.text));
  const clauses: string[] = [];
  for (const higher of SETTINGS_SCOPES.slice(0, rank)) {
    const file = scopes.find((s) => s.scope === higher);
    if (!file) continue;
    const taken = topLevelKeys(file.text).filter((k) => keys.has(k));
    if (taken.length === 0) continue;
    for (const key of taken) keys.delete(key);
    clauses.push(`${listed(taken)} by ${SCOPE_LABELS[higher]}`);
  }
  return clauses.length === 0 ? "" : `Overridden here: ${clauses.join("; ")}.`;
}
