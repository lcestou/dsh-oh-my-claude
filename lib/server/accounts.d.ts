/** One Claude Code login on this box beyond the default. `configDir` is saved as typed after
 *  normalising (`~/.claude-work`, no trailing slash): the CLI names a macOS Keychain entry after
 *  the exact string it gets, so the spelling has to be the same at login and at every spawn. */
export interface Account {
    name: string;
    configDir: string;
}
/** How many accounts one box may hold; the same cap the SSH box list has. */
export declare const ACCOUNTS_MAX = 20;
/** The lowercase-and-dashes form of a box or account name that its provider id ends in; empty
 *  when the name has no letter or digit. */
export declare function boxSlug(name: string): string;
/** The provider id an SSH box or an account mounts under. The two share one namespace on purpose:
 *  the id names the instance, its state dir and the sessions dsh keeps for it, so an SSH box and
 *  an account called "Work" cannot both exist. Matches the id a hand-written `providerId:
 *  claude-code-work` mount used, so moving such a mount into Settings keeps its sessions. */
export declare function boxProviderId(name: string): string;
/** The config dir the Add form offers for a name: `~/.claude-<slug>`, or "" for a name with no
 *  letter or digit. */
export declare function defaultAccountDir(name: string): string;
/**
 * A typed config dir in its saved form, or undefined when it is not one: it must start with `~/`
 * or `/` (the CLI resolves a relative CLAUDE_CONFIG_DIR against dsh's own working directory), and
 * may hold no `.` or `..` segment and no control character. Repeated and trailing slashes go.
 */
export declare function normalizeAccountDir(dir: string): string | undefined;
/** The absolute path a saved dir names, `~` expanded against `home`; the same string
 *  `resolveClaudeHome` in state.ts gives for it, which the spawn hands the CLI. */
export declare function accountHome(dir: string, home: string): string;
/** What validateAccounts checks a new list against: the user's home, this box's default config
 *  dir, the provider ids SSH boxes and hand-written mounts already hold (id → name), and the
 *  config dirs other local mounts use (absolute dir → name). */
export interface AccountRules {
    home: string;
    defaultHome: string;
    takenIds: Map<string, string>;
    takenHomes: Map<string, string>;
}
/** A validation refusal: the server text key and its parameters, so the route answers in the
 *  person's language. */
export interface AccountRefusal {
    key: "accountName" | "accountTaken" | "accountDir" | "accountDirHome" | "accountDirDefault" | "accountDirTaken" | "accountsMax";
    params?: Record<string, string>;
}
/**
 * The cleaned account list, or the first refusal; `input` is already parsed (the routes run the
 * schema), only its rules are checked here. A blank dir takes `defaultAccountDir(name)`.
 * Refuses a name of more than 40 characters or with no letter or digit, a name whose id another
 * account, an SSH box or a hand-written mount holds, a dir that is not absolute or `~`-rooted, the
 * home dir itself, this box's default config dir, and a dir another account or mount uses. Gets
 * wrong: two spellings of one folder through a symlink count as two folders.
 */
export declare function validateAccounts(input: readonly Account[], rules: AccountRules): {
    accounts: Account[];
} | {
    refusal: AccountRefusal;
};
