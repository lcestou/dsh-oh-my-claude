import { type SshBox } from "../sessions.js";
import type { PluginContext } from "../dsh.js";
import { Config } from "./config.js";
import { ClaudeCodeAdapter } from "./class.js";
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
export declare function reconcileSshBoxes(ctx: PluginContext, base: Schemastery.TypeT<typeof Config>, boxes: SshBox[], mounts: Map<string, SshBoxMount>, adapters: Map<string, ClaudeCodeAdapter>, log: (level: string, msg: string) => void): void;
/** One `claude auth status` at mount, so the picker names a logged-out box before its first turn.
 *  A panel token counts too: the CLI's own status cannot see one, and without this a restart named
 *  a box logged in only from the panel as logged out until someone opened Settings. */
export declare const probeLogin: (adapter: ClaudeCodeAdapter) => void;
