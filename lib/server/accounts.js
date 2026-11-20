// The accounts this box runs beside its default Claude Code login: a name and a config dir each,
// kept in the plugin's own `accounts.json` and mounted as `claude-code-<slug>` instances, so a second
// login is added from Settings → Boxes and never by editing dsh's config. Pure: no node imports,
// because the client reads the slug and default dir from here too.
/** How many accounts one box may hold; the same cap the SSH box list has. */
export const ACCOUNTS_MAX = 20;
/** The lowercase-and-dashes form of a box or account name that its provider id ends in; empty
 *  when the name has no letter or digit. */
export function boxSlug(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
/** The provider id an SSH box or an account mounts under. The two share one namespace on purpose:
 *  the id names the instance, its state dir and the sessions dsh keeps for it, so an SSH box and
 *  an account called "Work" cannot both exist. Matches the id a hand-written `providerId:
 *  claude-code-work` mount used, so moving such a mount into Settings keeps its sessions. */
export function boxProviderId(name) {
    return `claude-code-${boxSlug(name)}`;
}
/** The config dir the Add form offers for a name: `~/.claude-<slug>`, or "" for a name with no
 *  letter or digit. */
export function defaultAccountDir(name) {
    const slug = boxSlug(name);
    return slug ? `~/.claude-${slug}` : "";
}
/**
 * A typed config dir in its saved form, or undefined when it is not one: it must start with `~/`
 * or `/` (the CLI resolves a relative CLAUDE_CONFIG_DIR against dsh's own working directory), and
 * may hold no `.` or `..` segment and no control character. Repeated and trailing slashes go.
 */
export function normalizeAccountDir(dir) {
    const trimmed = dir.trim();
    if (trimmed.length > 200 || [...trimmed].some((ch) => ch.charCodeAt(0) < 32))
        return undefined;
    const tilde = trimmed === "~" || trimmed.startsWith("~/");
    if (!tilde && !trimmed.startsWith("/"))
        return undefined;
    const parts = trimmed
        .slice(tilde ? 1 : 0)
        .split("/")
        .filter(Boolean);
    if (parts.some((p) => p === "." || p === ".."))
        return undefined;
    return `${tilde ? "~" : ""}/${parts.join("/")}`.replace(/^~\/$/, "~");
}
/** The absolute path a saved dir names, `~` expanded against `home`; the same string
 *  `resolveClaudeHome` in state.ts gives for it, which the spawn hands the CLI. */
export function accountHome(dir, home) {
    // `join(homedir(), …)` in resolveClaudeHome drops a trailing slash on $HOME; so does this.
    const h = home.replace(/\/+$/, "") || "/";
    return dir === "~" ? h : dir.startsWith("~/") ? `${h === "/" ? "" : h}${dir.slice(1)}` : dir;
}
/**
 * The cleaned account list, or the first refusal; `input` is already parsed (the routes run the
 * schema), only its rules are checked here. A blank dir takes `defaultAccountDir(name)`.
 * Refuses a name of more than 40 characters or with no letter or digit, a name whose id another
 * account, an SSH box or a hand-written mount holds, a dir that is not absolute or `~`-rooted, the
 * home dir itself, this box's default config dir, and a dir another account or mount uses. Gets
 * wrong: two spellings of one folder through a symlink count as two folders.
 */
export function validateAccounts(input, rules) {
    if (input.length > ACCOUNTS_MAX)
        return { refusal: { key: "accountsMax", params: { n: String(ACCOUNTS_MAX) } } };
    const accounts = [];
    const ids = new Map(rules.takenIds);
    const homes = new Map(rules.takenHomes);
    for (const row of input) {
        const name = row.name.trim();
        if (!name || name.length > 40 || !boxSlug(name))
            return { refusal: { key: "accountName" } };
        const id = boxProviderId(name);
        if (ids.has(id))
            return { refusal: { key: "accountTaken", params: { name } } };
        const typed = row.configDir.trim() || defaultAccountDir(name);
        const configDir = normalizeAccountDir(typed);
        if (configDir === undefined)
            return { refusal: { key: "accountDir", params: { dir: typed } } };
        const abs = accountHome(configDir, rules.home);
        if (abs === rules.home || abs === "/")
            return { refusal: { key: "accountDirHome", params: { dir: configDir } } };
        if (abs === rules.defaultHome)
            return { refusal: { key: "accountDirDefault", params: { dir: configDir } } };
        const holder = homes.get(abs);
        if (holder !== undefined)
            return { refusal: { key: "accountDirTaken", params: { dir: configDir, name: holder } } };
        ids.set(id, name);
        homes.set(abs, name);
        accounts.push({ name, configDir });
    }
    return { accounts };
}
//# sourceMappingURL=accounts.js.map