// Settings and environment that switch off a feature this panel offers. Pure: the caller reads the
// files and the environment, this works out what the CLI would do with them.
import type { JsonValue } from "./dsh.js";

/** One scope's text, in the order the CLI merges them: highest precedence first. */
export interface ScopeText {
  scope: string;
  text: string;
}

/** The CLI's own retention when nothing sets one, from `cleanupPeriodDays`' schema. */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * What the panel would otherwise claim wrongly.
 *
 * - Retention is the CLI's transcript sweep. Rewind, Restore and the session browser all read
 *   those transcripts, so it empties them on a schedule without anything saying so. It runs on the
 *   30-day default too, so this is reported whether or not a file sets `cleanupPeriodDays`.
 * - `permissions.disableBypassPermissionsMode` makes a spawn refuse bypass mode while the shield
 *   still reads "Full access".
 * - `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING` beats the plugin's own
 *   `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`, leaving the file half of Rewind nothing to undo.
 */
export interface FeatureSwitches {
  /** `scope` is the file the number came from, or null when it is the CLI's default. */
  retention: { days: number; scope: string | null };
  bypassDisabled?: { scope: string };
  checkpointingDisabled: boolean;
  /**
   * Who continues a turn a usage limit ended. `plugin` is this plugin's `continueAfterLimit`, the
   * one that acts here. `cli` is Claude Code's `autoContinueAtUsageLimit`, null when no file sets
   * it: it is a settings row on the interactive path ("Continue automatically at usage limit",
   * whose own description offers the wait "as a choice" in the limit dialog), and the headless
   * stream this plugin runs has no dialog to offer it in.
   */
  usageLimit: { plugin: boolean; cli: boolean | null };
}

/** Only these two layers provide a retention: the CLI reads it from policy and user settings. */
const RETENTION_SCOPES = ["managed", "user"];

/** The CLI's own boolean rule for an environment variable: `"1"` or `"true"`, nothing else. A `"0"`
 *  does not disable anything, and neither does an empty string. */
const cliTrue = (value: string | undefined): boolean => value === "1" || value === "true";

/**
 * What Claude Code loads for a workspace, and who decided it. The count and the total are the files
 * themselves, so they are reported whether or not loading is on: they are what *would* load.
 */
export interface ClaudeMdState {
  files: number;
  chars: number;
  /** The settings scope that sets `CLAUDE_CODE_DISABLE_CLAUDE_MDS`, or `"env"` for the environment
   *  dsh itself runs in. Absent means the files load. No settings scope is called `env`. */
  disabledBy?: string;
}

/**
 * Whether anything turns CLAUDE.md loading off, and where it came from.
 *
 * Settings win over the inherited environment, because the CLI spreads a file's `env` block over the
 * environment it started with. So the highest scope that names the key decides: a `"0"` there keeps
 * the files loading even when dsh's own environment says otherwise, and a lower file naming the key
 * changes nothing. `scopes` has to arrive highest precedence first for that to hold, which is the
 * order `ScopeText` is documented in and the order `settingsTexts` builds; this reads the first
 * scope that names the key and stops, exactly as `featureSwitches` above resolves its own scalars.
 *
 * `local` is the last word on the environment half. A local child inherits dsh-web's environment, so
 * `process.env` is authoritative for it. A box across ssh runs its own shell, which cannot be read
 * from here, so the environment is not consulted for one at all.
 */
export function claudeMdDisabledBy(
  scopes: readonly ScopeText[],
  env: string | undefined,
  local: boolean,
): string | undefined {
  for (const { scope, text } of scopes) {
    const block = parseSettings(text).env;
    if (!(block instanceof Object) || Array.isArray(block)) continue;
    const value = block.CLAUDE_CODE_DISABLE_CLAUDE_MDS;
    if (value === undefined) continue;
    return cliTrue(String(value)) ? scope : undefined;
  }
  return local && cliTrue(env) ? "env" : undefined;
}

/** One settings file read back as an object, or an empty one when it is not JSON. */
export const parseSettings = (text: string): Record<string, JsonValue> => {
  try {
    const value: JsonValue = JSON.parse(text);
    // SAFETY: JSON.parse answers a JsonValue; the guard leaves only the object arm of that union.
    return value instanceof Object && !Array.isArray(value)
      ? (value as Record<string, JsonValue>)
      : {};
  } catch {
    // A file the CLI would refuse to start on says nothing about these keys; Diagnostics reports
    // the parse error separately.
    return {};
  }
};

/**
 * Read the three switches out of the merged scopes and the environment a Claude child inherits.
 * Precedence is per key and first-wins, which is how the CLI resolves one of these scalars: the
 * highest scope that names the key decides it, and a lower file naming it changes nothing.
 */
export function featureSwitches(
  scopes: readonly ScopeText[],
  env: { CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING?: string },
  continueAfterLimit = true,
): FeatureSwitches {
  const out: FeatureSwitches = {
    retention: { days: DEFAULT_RETENTION_DAYS, scope: null },
    // Any non-empty value is truthy to the CLI's own check, including "0" and "false".
    checkpointingDisabled: (env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING ?? "") !== "",
    usageLimit: { plugin: continueAfterLimit, cli: null },
  };
  let retentionSet = false;
  for (const { scope, text } of scopes) {
    const settings = parseSettings(text);
    const days = settings.cleanupPeriodDays;
    // The schema is a positive integer; anything else the CLI rejects, and the sweep falls back.
    if (
      !retentionSet &&
      RETENTION_SCOPES.some((s) => s === scope) &&
      Number(days) === days &&
      Number.isInteger(days) &&
      days > 0
    ) {
      out.retention = { days, scope };
      retentionSet = true;
    }
    const permissions = settings.permissions;
    if (
      out.bypassDisabled === undefined &&
      permissions instanceof Object &&
      !Array.isArray(permissions)
    ) {
      const disabled = permissions.disableBypassPermissionsMode;
      // The CLI's own check is `=== "disable"`, but a hand-written `true` means the same thing to
      // whoever wrote it, and warning on it costs nothing.
      if (disabled === "disable" || disabled === true) out.bypassDisabled = { scope };
    }
    const auto = settings.autoContinueAtUsageLimit;
    if (out.usageLimit.cli === null && (auto === true || auto === false)) out.usageLimit.cli = auto;
  }
  return out;
}
