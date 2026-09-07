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
 * Read the three switches out of the merged scopes and the environment a Claude child inherits.
 * Precedence is per key and first-wins, which is how the CLI resolves one of these scalars: the
 * highest scope that names the key decides it, and a lower file naming it changes nothing.
 */
export declare function featureSwitches(scopes: readonly ScopeText[], env: {
    CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING?: string;
}, continueAfterLimit?: boolean): FeatureSwitches;
