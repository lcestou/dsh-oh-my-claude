/** The CLI's own retention when nothing sets one, from `cleanupPeriodDays`' schema. */
export const DEFAULT_RETENTION_DAYS = 30;
/** Only these two layers provide a retention: the CLI reads it from policy and user settings. */
const RETENTION_SCOPES = ["managed", "user"];
/** The CLI's own boolean rule for an environment variable: `"1"` or `"true"`, nothing else. A `"0"`
 *  does not disable anything, and neither does an empty string. */
const cliTrue = (value) => value === "1" || value === "true";
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
export function claudeMdDisabledBy(scopes, env, local) {
    for (const { scope, text } of scopes) {
        const block = parseSettings(text).env;
        if (!(block instanceof Object) || Array.isArray(block))
            continue;
        const value = block.CLAUDE_CODE_DISABLE_CLAUDE_MDS;
        if (value === undefined)
            continue;
        return cliTrue(String(value)) ? scope : undefined;
    }
    return local && cliTrue(env) ? "env" : undefined;
}
/** One settings file read back as an object, or an empty one when it is not JSON. */
export const parseSettings = (text) => {
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
        const settings = parseSettings(text);
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