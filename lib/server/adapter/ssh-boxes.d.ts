import type { SshBox } from "../sessions.js";
import type { PluginContext } from "../dsh.js";
import type { Config } from "./config.js";
import { ClaudeCodeAdapter } from "./class.js";
/** The mark a mount this plugin made from its own state file (an SSH box, an account) carries in
 *  the shared registry. `Symbol.for`, so a module loaded again still reads it. An untagged entry is
 *  a hand-written mount or the default and is left alone; a tagged one is the previous scope's own
 *  mount after an in-process re-apply, whose registration went with that scope, so a reconcile
 *  mounts a fresh instance over it. */
export declare const PLUGIN_MOUNT: unique symbol;
/** Mark `adapter` as mounted by this plugin from its own state file. */
export declare function tagPluginMount(adapter: ClaudeCodeAdapter): void;
/** Whether the registry holds `providerId` for something other than this plugin's own mounts: a
 *  hand-written mount or the default, which a reconcile must not mount over. */
export declare function heldByOther(adapters: Map<string, ClaudeCodeAdapter>, providerId: string): boolean;
/**
 * Register `adapter` with dsh: its settings directory row, then the adapter itself. Undefined when
 * dsh refuses the adapter because a live mount of the other kind holds the id (an SSH box and an
 * account saved under one name from two tabs at once, or by hand): the directory row is taken back
 * and the refusal logged, so one bad pair never stops the rest of a reconcile. A previous scope's
 * mount, whose registration went with that scope, is not refused and is mounted over.
 */
export declare function registerMount(ctx: PluginContext, adapter: ClaudeCodeAdapter, log: (level: string, msg: string) => void): {
    disposeAdapter: () => void;
    disposeDirectory: () => void;
} | undefined;
export interface SshBoxMount {
    adapter: ClaudeCodeAdapter;
    disposeAdapter: () => void;
    disposeDirectory: () => void;
}
/**
 * Bring the mounted SSH-box instances in line with `boxes`: mount one per new box, withdraw the ones
 * no longer listed (and kill their sessions). Each box becomes an independent `claude-code-<slug>`
 * that drives `claude` on its host over ssh with its own remote login, the same shape a
 * hand-written mount would have, but built from the plugin's own state file so the panel owns
 * the list and no dsh config is edited.
 * The provider registrations are live handles, so a box appears in or leaves the
 * model picker without a dsh restart.
 *
 * `mounts` is scope-local, rebuilt on every `apply()`: cordis disposes a plugin scope's registrations
 * on a hot reload, so trusting a cross-reload map would leave a box gone from the picker but recorded
 * as present. `adapters` is the cross-process `ADAPTER_CURRENT` registry the resume timer walks.
 */
export declare function reconcileSshBoxes(ctx: PluginContext, base: Schemastery.TypeT<typeof Config>, boxes: Array<SshBox>, mounts: Map<string, SshBoxMount>, adapters: Map<string, ClaudeCodeAdapter>, log: (level: string, msg: string) => void): void;
/** One `claude auth status` at mount, so the picker names a logged-out box before its first turn.
 *  A panel token counts too: the CLI's own status cannot see one, and without this a restart named
 *  a box logged in only from the panel as logged out until someone opened Settings. */
export declare const probeLogin: (adapter: ClaudeCodeAdapter) => void;
