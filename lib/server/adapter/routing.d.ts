import type { FirstPartyProbe } from "../first-party.js";
import type { ServerKey } from "../locale.js";
import { type AliasNames } from "../sessions.js";
/**
 * `direct`: the CLI talks to Anthropic, straight or through a proxy that forwards (headroom).
 * `routed`: its base URL is an endpoint that answers and is not Anthropic, a router such as CC
 * Switch or a gateway. `unknown`: this process cannot tell, so nothing is hidden: an ssh box,
 * whose loopback is not this one's; a Bedrock, Vertex or Foundry setup, where the CLI ignores
 * the base URL; an endpoint that does not answer.
 */
export type RouteState = "direct" | "routed" | "unknown";
/** A mount's state, with the endpoint's host when a base URL is in force (for the Settings line). */
export interface Route {
    state: RouteState;
    host?: string;
}
/** What the listing is filtered by: the state, and the Settings switch that keeps Claude's own
 *  rows listed while routed. */
export interface RouteFilter {
    state: RouteState;
    claudeToo: boolean;
}
/** The variables that decide a route, out of the env in force for a mount. */
export interface RouteEnv {
    /** `ANTHROPIC_BASE_URL` as written, blank left out. */
    baseUrl?: string;
    /** One of the CLI's cloud-provider switches is on, so the base URL is not what it calls. */
    cloud: boolean;
    /** `ANTHROPIC_DEFAULT_<ALIAS>_MODEL_NAME`, by alias: the names a router gives what it remaps. */
    aliasNames: AliasNames;
    /** `ANTHROPIC_DEFAULT_<ALIAS>_MODEL`, by alias: the id each alias is pointed at. CC Switch in
     *  its direct mode points them at the provider's own model and names only some. */
    aliasModels: AliasNames;
}
/** Pick the routing variables out of an env. The caller merges the layers first (this process's
 *  environment, then settings.json's `env`, then the managed file's), in the order the CLI lets
 *  each outrank the one before. */
export declare function routeEnvIn(env: Record<string, string | undefined>): RouteEnv;
/** A stable text for "the routing variables as last seen", compared to tell a real change from
 *  one more write to a settings file that left them alone. */
export declare const routeSignature: (env: RouteEnv) => string;
/**
 * The state of one mount. `known` answers whether a base URL reaches Anthropic from what is
 * already kept, without waiting (`firstPartyKnown`); `forwards` is the Settings control "Proxy
 * reaches Anthropic" set to on, which outranks the endpoint's own answer as it does for the
 * CLI's flag. An ssh mount and a cloud setup are `unknown` before any URL is looked at.
 */
export declare function routeOf(env: RouteEnv, mount: {
    ssh: boolean;
    forwards: boolean;
}, known: (baseUrl: string) => FirstPartyProbe): Route;
/** The text key for a scope name; one this file does not know reads as the box's own file. */
export declare const settingsScopeText: (scope: string) => ServerKey;
/** How long a burst of writes to a settings file is left to settle before it is read. */
export declare const SETTINGS_SETTLE_MS = 400;
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
export declare function watchSettingsIn(dir: string, key: string, changed: () => void): void;
/** Close every watch; tests leave none behind. */
export declare const unwatchSettings: () => void;
