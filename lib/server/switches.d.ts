import type { JsonValue } from "./dsh.js";
/** One scope's text, in the order the CLI merges them: highest precedence first. */
export interface ScopeText {
    scope: string;
    text: string;
}
/** The CLI's own retention when nothing sets one, from `cleanupPeriodDays`' schema. */
export declare const DEFAULT_RETENTION_DAYS = 30;
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
    retention: {
        days: number;
        scope: string | null;
    };
    bypassDisabled?: {
        scope: string;
    };
    checkpointingDisabled: boolean;
    /**
     * Who continues a turn a usage limit ended. `plugin` is this plugin's `continueAfterLimit`, the
     * one that acts here. `cli` is Claude Code's `autoContinueAtUsageLimit`, null when no file sets
     * it: it is a settings row on the interactive path ("Continue automatically at usage limit",
     * whose own description offers the wait "as a choice" in the limit dialog), and the headless
     * stream this plugin runs has no dialog to offer it in.
     */
    usageLimit: {
        plugin: boolean;
        cli: boolean | null;
    };
}
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
 * changes nothing.
 *
 * `local` is the last word on the environment half. A local child inherits dsh-web's environment, so
 * `process.env` is authoritative for it. A box across ssh runs its own shell, which cannot be read
 * from here, so the environment is not consulted for one at all.
 */
export declare function claudeMdDisabledBy(scopes: readonly ScopeText[], env: string | undefined, local: boolean): string | undefined;
/** One settings file read back as an object, or an empty one when it is not JSON. */
export declare const parseSettings: (text: string) => Record<string, JsonValue>;
/**
 * Read the three switches out of the merged scopes and the environment a Claude child inherits.
 * Precedence is per key and first-wins, which is how the CLI resolves one of these scalars: the
 * highest scope that names the key decides it, and a lower file naming it changes nothing.
 */
export declare function featureSwitches(scopes: readonly ScopeText[], env: {
    CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING?: string;
}, continueAfterLimit?: boolean): FeatureSwitches;
