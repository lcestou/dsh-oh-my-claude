import { type Account } from "../accounts.js";
import type { PluginContext } from "../dsh.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { type SshBoxMount } from "./ssh-boxes.js";
import type { LocalMount } from "../routes/accounts.js";
/** One mounted account: the same three handles an SSH box keeps. */
export type AccountMount = SshBoxMount;
/** The default mount's dsh tools bridge, read at mount time: `mcp` once it is up, and the promise
 *  that resolves when it is. adapter.ts also hands a late bridge to every mounted account. */
export interface SharedBridge {
    mcp: () => ClaudeCodeAdapter["mcp"];
    mounting: () => ClaudeCodeAdapter["mcpMounting"];
}
/**
 * Bring the mounted accounts in line with `accounts`: mount one `claude-code-<slug>` instance per
 * new account with its `configDir`, withdraw the ones no longer listed and stop their sessions.
 * The registrations are live handles, so the account appears in or leaves the model picker
 * without a dsh restart. An id the shared registry already holds (a hand-written mount, the
 * default) is left alone with a warning, as reconcileSshBoxes does; the routes refuse to save one.
 * An id held by this plugin's own mount from a previous scope (PLUGIN_MOUNT) is mounted over: that
 * scope's registration is gone, and the shared process registry hands the new instance its live
 * processes.
 * Withdrawing deletes nothing on disk: the config dir and its login, and the state dir with its
 * sessions, stay, so adding the same name back resumes where it was.
 *
 * An account never runs on the transcript mirror (`ownTranscripts` off): the session browser does
 * not list an account's transcripts, and a mirror built at mount misses a login made after it.
 */
export declare function reconcileAccounts(ctx: PluginContext, base: Schemastery.TypeT<typeof Config>, accounts: Account[], mounts: Map<string, AccountMount>, adapters: Map<string, ClaudeCodeAdapter>, bridge: SharedBridge, log: (level: string, msg: string) => void): void;
/** Every local mount but the default, for the accounts routes: plugin accounts and hand-written
 *  mounts alike, with the dir they hand the CLI. SSH boxes are not accounts and are left out; a
 *  hand-written mount on the default dir comes back with loginKey "" and the routes skip it. */
export declare function localMountsOf(adapters: Iterable<ClaudeCodeAdapter>): LocalMount[];
