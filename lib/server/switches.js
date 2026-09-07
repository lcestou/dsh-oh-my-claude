/** The CLI's own retention when nothing sets one, from `cleanupPeriodDays`' schema. */
export const DEFAULT_RETENTION_DAYS = 30;
/** Only these two layers provide a retention: the CLI reads it from policy and user settings. */
const RETENTION_SCOPES = ["managed", "user"];
const parse = (text) => {
    try {
        const value = JSON.parse(text);
        // SAFETY: JSON.parse answers a JsonValue; the guard leaves only the object arm of that union.
        return value instanceof Object && !Array.isArray(value)
            ? value
            : {};
    }
    catch {
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
export function featureSwitches(scopes, env, continueAfterLimit = true) {
    const out = {
        retention: { days: DEFAULT_RETENTION_DAYS, scope: null },
        // Any non-empty value is truthy to the CLI's own check, including "0" and "false".
        checkpointingDisabled: (env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING ?? "") !== "",
        usageLimit: { plugin: continueAfterLimit, cli: null },
    };
    let retentionSet = false;
    for (const { scope, text } of scopes) {
        const settings = parse(text);
        const days = settings.cleanupPeriodDays;
        // The schema is a positive integer; anything else the CLI rejects, and the sweep falls back.
        if (!retentionSet &&
            RETENTION_SCOPES.some((s) => s === scope) &&
            Number(days) === days &&
            Number.isInteger(days) &&
            days > 0) {
            out.retention = { days, scope };
            retentionSet = true;
        }
        const permissions = settings.permissions;
        if (out.bypassDisabled === undefined &&
            permissions instanceof Object &&
            !Array.isArray(permissions)) {
            const disabled = permissions.disableBypassPermissionsMode;
            // The CLI's own check is `=== "disable"`, but a hand-written `true` means the same thing to
            // whoever wrote it, and warning on it costs nothing.
            if (disabled === "disable" || disabled === true)
                out.bypassDisabled = { scope };
        }
        const auto = settings.autoContinueAtUsageLimit;
        if (out.usageLimit.cli === null && (auto === true || auto === false))
            out.usageLimit.cli = auto;
    }
    return out;
}
//# sourceMappingURL=switches.js.map