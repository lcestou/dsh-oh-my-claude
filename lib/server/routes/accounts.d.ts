import type { IncomingMessage, ServerResponse } from "node:http";
import type { JsonValue } from "../dsh.js";
import { type Account } from "../accounts.js";
import { type RouteHandler } from "./context.js";
/** A local mount other than the default with a login of its own: plugin-added or hand-written. */
export interface LocalMount {
    provider: string;
    name: string;
    /** The absolute config dir the mount hands the CLI. */
    home: string;
    /** `ClaudeCodeAdapter.loginKey`: what loginDone, logoutBox and liveCount compare. */
    loginKey: string;
}
/** One row of `GET /accounts`. `source` says who owns it: `plugin` rows come from accounts.json
 *  and can be removed here; `profile` rows are hand-written mounts, removed in cordis.patch.yml.
 *  `mounted` is false for a plugin row whose id a hand-written mount already holds. */
export interface AccountRow {
    name: string;
    configDir: string;
    provider: string;
    source: "plugin" | "profile";
    mounted: boolean;
}
/** What the accounts routes need from the session routes and the adapter, passed in so this
 *  module imports neither (sessions.ts imports this one). */
export interface AccountRouteCtx {
    ROUTE_PREFIX: string;
    /** `<STATE_DIR>/accounts.json`. */
    path: string;
    /** The user's home and this box's default config dir, for the dir rules. */
    home: string;
    defaultHome: string;
    /** This box's `claude`, as the default mount resolved it. */
    command: string;
    json: (res: ServerResponse, status: number, value: object) => void;
    readBody: (req: IncomingMessage) => Promise<{
        [key: string]: JsonValue;
    }>;
    run: (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<{
        out: string;
        error?: string;
    }>;
    cliEnvFor: (dir?: string) => NodeJS.ProcessEnv;
    /** `authFromStatus(out).loggedIn`: whether `claude auth status` output says logged in. */
    loggedIn: (statusOut: string) => boolean;
    /** `runtimeStatus(home, command, "")`: version, login and email for one config dir. */
    status: (home: string) => Promise<{
        loggedIn: boolean;
        running?: number;
    }>;
    forgetIdentity: () => void;
    /** Provider ids the saved SSH boxes mount under, so an account cannot take one. */
    sshIds: () => Promise<string[]>;
    localMounts: () => LocalMount[];
    /** Ids this plugin mounted from accounts.json. */
    mounted: () => Set<string>;
    onChange: (accounts: Account[]) => Promise<void> | void;
    liveCount: (loginKey: string) => number;
    loginDone: (loginKey: string) => void;
    logoutDone: (loginKey: string) => void;
    onLoginStatus: (provider: string, loggedIn: boolean) => void;
    /** Tell every open tab the box list changed (the `boxes` event). */
    publish: () => void;
    log: (level: string, msg: string) => void;
}
/** The saved accounts: [] when the file does not exist, undefined when it exists but does not
 *  parse or validate. The write routes refuse on undefined, so an unreadable file is never replaced
 *  by a list holding only the new row. Checked for shape only: which ids are free depends on what
 *  else is mounted, which only the add route knows. */
export declare function loadAccounts(path: string, home: string, defaultHome: string): Promise<Account[] | undefined>;
/** The saved accounts for a read: an unreadable file reads as none, so it never stops the plugin
 *  from loading or the list from answering. */
export declare function readAccounts(path: string, home: string, defaultHome: string): Promise<Account[]>;
/** The accounts group of the session routes. Returns `UNHANDLED` for any path it does not own. */
export declare function accountsRoutes(c: AccountRouteCtx): RouteHandler;
