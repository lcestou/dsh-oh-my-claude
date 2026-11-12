// Where one mount's Claude Code traffic goes, read from what a router leaves in Claude Code's own
// config rather than from any router's files: a base URL, and names for the aliases it remaps.
// The model listing follows the answer (`mergeCatalog`), and so does the Settings card.
import { watch } from "node:fs";
import { aliasNamesIn } from "../sessions.js";
import { proxyBaseUrl } from "./catalog.js";
/** The CLI's switches for a cloud provider; with one on it never calls `ANTHROPIC_BASE_URL`. */
const CLOUD_FLAGS = [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
];
/** The CLI's own reading of a boolean variable: anything but blank, `0`, `false`, `no`, `off`. */
const envOn = (value) => value !== undefined && !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
/** Pick the routing variables out of an env. The caller merges the layers first (this process's
 *  environment, then settings.json's `env`, then the managed file's), in the order the CLI lets
 *  each outrank the one before. */
export function routeEnvIn(env) {
    const out = {
        cloud: CLOUD_FLAGS.some((flag) => envOn(env[flag])),
        aliasNames: aliasNamesIn(env),
        aliasModels: aliasNamesIn(env, ""),
    };
    const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
    if (baseUrl)
        out.baseUrl = baseUrl;
    return out;
}
/** A stable text for "the routing variables as last seen", compared to tell a real change from
 *  one more write to a settings file that left them alone. */
export const routeSignature = (env) => JSON.stringify([
    env.baseUrl ?? "",
    env.cloud,
    Object.entries(env.aliasNames).toSorted(([a], [b]) => a.localeCompare(b)),
    Object.entries(env.aliasModels).toSorted(([a], [b]) => a.localeCompare(b)),
]);
/**
 * The state of one mount. `known` answers whether a base URL reaches Anthropic from what is
 * already kept, without waiting (`firstPartyKnown`); `forwards` is the Settings control "Proxy
 * reaches Anthropic" set to on, which outranks the endpoint's own answer as it does for the
 * CLI's flag. A cloud setup is `unknown` before any URL is looked at. An ssh box passes its own
 * env and the answer its own probe gave (`boxRouteState`).
 */
export function routeOf(env, mount, known) {
    if (env.cloud)
        return { state: "unknown" };
    const baseUrl = proxyBaseUrl(env.baseUrl);
    if (!baseUrl)
        return { state: "direct" };
    let host = baseUrl;
    try {
        host = new URL(baseUrl).host;
    }
    catch {
        /* not a URL: the CLI will refuse it too, and the text as written is the honest host */
    }
    if (mount.forwards)
        return { state: "direct", host };
    const answer = known(baseUrl);
    if (answer === undefined)
        return { state: "unknown", host };
    return { state: answer ? "direct" : "routed", host };
}
/** How an error names the place a routing variable was set, by settings scope, plus
 *  `environment` for one dsh itself was started with. */
const SCOPE_TEXT = new Map([
    ["user", "settingsScopeUser"],
    ["project", "settingsScopeProject"],
    ["local", "settingsScopeLocal"],
    ["managed", "settingsScopeManaged"],
    ["environment", "settingsScopeEnvironment"],
]);
/** The text key for a scope name; one this file does not know reads as the box's own file. */
export const settingsScopeText = (scope) => SCOPE_TEXT.get(scope) ?? "settingsScopeUser";
/** The settings files whose `env` can route the CLI, by name: the user's and the managed one. */
const SETTINGS_FILES = new Set(["settings.json", "managed-settings.json"]);
/** How long a burst of writes to a settings file is left to settle before it is read. */
export const SETTINGS_SETTLE_MS = 400;
/** The watches kept per directory, on the process, each with one listener per mount. */
const WATCHES = Symbol.for("dsh-oh-my-claude.routeWatches");
/** The process-wide registry, made on first use. */
const watches = () => {
    // SAFETY: this plugin's own key on globalThis, typed here once
    const g = globalThis;
    return (g[WATCHES] ??= new Map());
};
/**
 * Call `changed` when a settings file in `dir` is written, once per burst. The directory is
 * watched, not the file: a tool that saves by writing a temp file and renaming it over leaves a
 * watch on the file holding the old inode. Every other name in the directory is ignored, which
 * matters in a Claude home, where the CLI writes its history, credentials and backups on every
 * start. `key` names the listener (a mount's provider id): a second call with the same key
 * replaces the first, so an adapter rebuilt by dsh does not leave its predecessor listening.
 * A directory that does not exist, or a watch that fails later, is dropped quietly and armed
 * again by the next call. Never keeps the process alive.
 */
export function watchSettingsIn(dir, key, changed) {
    const all = watches();
    const kept = all.get(dir);
    if (kept) {
        kept.listeners.set(key, changed);
        return;
    }
    try {
        const entry = {
            listeners: new Map([[key, changed]]),
            fw: watch(dir, { persistent: false }, (_event, name) => {
                if (name === null || !SETTINGS_FILES.has(name))
                    return;
                if (entry.timer)
                    clearTimeout(entry.timer);
                entry.timer = setTimeout(() => {
                    for (const listener of entry.listeners.values())
                        listener();
                }, SETTINGS_SETTLE_MS);
                entry.timer.unref();
            }),
        };
        entry.fw.on("error", () => {
            entry.fw.close();
            all.delete(dir);
        });
        all.set(dir, entry);
    }
    catch {
        /* no such directory (no managed settings on this box): nothing to watch */
    }
}
/** Close every watch; tests leave none behind. */
export const unwatchSettings = () => {
    for (const entry of watches().values()) {
        if (entry.timer)
            clearTimeout(entry.timer);
        entry.fw.close();
    }
    watches().clear();
};
//# sourceMappingURL=routing.js.map