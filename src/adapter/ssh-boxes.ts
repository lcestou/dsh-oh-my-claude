// The SSH-box mount bookkeeping: mount one adapter per box the panel lists, withdraw the ones it dropped.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { accountIdentity, sshBoxProviderId } from "../sessions.js";
import type { SshBox } from "../sessions.js";
import type { PluginContext } from "../dsh.js";
import { STATE_DIR } from "../state.js";
import { readSshToken, THIS_BOX } from "../ssh-login.js";
import { errorText } from "../process.js";
import type { Config } from "./config.js";
import { ClaudeCodeAdapter } from "./class.js";

/** The mark a mount this plugin made from its own state file (an SSH box, an account) carries in
 *  the shared registry. `Symbol.for`, so a module loaded again still reads it. An untagged entry is
 *  a hand-written mount or the default and is left alone; a tagged one is the previous scope's own
 *  mount after an in-process re-apply, whose registration went with that scope, so a reconcile
 *  mounts a fresh instance over it. */
export const PLUGIN_MOUNT = Symbol.for("dsh-oh-my-claude.plugin-mount");

/** An adapter as the registry may hold it, with or without the plugin's mark. */
type MaybeTagged = ClaudeCodeAdapter & { [PLUGIN_MOUNT]?: true };

/** Mark `adapter` as mounted by this plugin from its own state file. */
export function tagPluginMount(adapter: ClaudeCodeAdapter): void {
  const tagged: MaybeTagged = adapter;
  tagged[PLUGIN_MOUNT] = true;
}

/** Whether the registry holds `providerId` for something other than this plugin's own mounts: a
 *  hand-written mount or the default, which a reconcile must not mount over. */
export function heldByOther(adapters: Map<string, ClaudeCodeAdapter>, providerId: string): boolean {
  const held: MaybeTagged | undefined = adapters.get(providerId);

  return held !== undefined && held[PLUGIN_MOUNT] !== true;
}

/**
 * Register `adapter` with dsh: its settings directory row, then the adapter itself. Undefined when
 * dsh refuses the adapter because a live mount of the other kind holds the id (an SSH box and an
 * account saved under one name from two tabs at once, or by hand): the directory row is taken back
 * and the refusal logged, so one bad pair never stops the rest of a reconcile. A previous scope's
 * mount, whose registration went with that scope, is not refused and is mounted over.
 */
export function registerMount(
  ctx: PluginContext,
  adapter: ClaudeCodeAdapter,
  log: (level: string, msg: string) => void,
): { disposeAdapter: () => void; disposeDirectory: () => void } | undefined {
  const disposeDirectory = ctx.llm.registerConfigurableProviders([
    {
      provider: adapter.providerId,
      displayName: adapter.displayName,
      settingsNs: adapter.settingsNs,
      settingsPath: [],
    },
  ]);

  try {
    const disposeAdapter = ctx.llm.registerAdapter([adapter.providerId], adapter);
    adapter.registration = disposeAdapter;

    return { disposeAdapter, disposeDirectory };
  } catch (error) {
    disposeDirectory();
    log("warn", `${adapter.providerId} not mounted: ${errorText(error)}`);

    return undefined;
  }
}

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
export function reconcileSshBoxes(
  ctx: PluginContext,
  base: Schemastery.TypeT<typeof Config>,
  boxes: Array<SshBox>,
  mounts: Map<string, SshBoxMount>,
  adapters: Map<string, ClaudeCodeAdapter>,
  log: (level: string, msg: string) => void,
) {
  const desired = new Map(boxes.map((b) => [sshBoxProviderId(b.name), b] as const));

  for (const [providerId, mount] of mounts) {
    if (desired.has(providerId)) {
      continue;
    }

    mount.disposeAdapter();
    mount.disposeDirectory();
    mount.adapter.disposeProcesses();
    mounts.delete(providerId);
    adapters.delete(providerId);
    log("info", `ssh box ${providerId} withdrawn`);
  }

  for (const [providerId, box] of desired) {
    if (mounts.has(providerId)) {
      continue;
    }

    // A hand-written mount or the default already owns this id: leave it, rather than throw
    // DUPLICATE_ADAPTER on the registration. A previous scope's box (tagged) is mounted over.
    if (heldByOther(adapters, providerId)) {
      log("warn", `ssh box "${box.name}" -> ${providerId} already mounted; skipped`);
      continue;
    }

    const adapter = new ClaudeCodeAdapter(ctx, {
      ...base,
      providerId,
      providerName: box.name,
      sshHost: box.host,
      // Inherits `spawn`: unset or keeper follows the Settings switch (on holds the far claude on the
      // box, hold.ts; off runs a plain ssh pipe); node or dsh gives the plain ssh pipe.
      dshTools: false,
      configDir: "",
    });

    const registered = registerMount(ctx, adapter, log);

    if (!registered) {
      continue;
    }

    const { disposeAdapter, disposeDirectory } = registered;
    tagPluginMount(adapter);
    probeLogin(adapter);
    mounts.set(providerId, { adapter, disposeAdapter, disposeDirectory });
    adapters.set(providerId, adapter);
    log("info", `ssh box "${box.name}" mounted as ${providerId} -> ${box.host}`);
    // The box's own holds: a restart mounts the box again from the file and must reattach to
    // the far claudes it left running (2026-09-08: the first restart after holds shipped left the
    // nova session's cli alive on the box with nothing attached, because only the main mount
    // adopted). A hot reload finds the processes already in the shared registry and skips them.
    void adapter.adoptHolds().catch((error) => log("warn", `hold adoption: ${errorText(error)}`));
  }
}

/** One `claude auth status` at mount, so the picker names a logged-out box before its first turn.
 *  A panel token counts too: the CLI's own status cannot see one, and without this a restart named
 *  a box logged in only from the panel as logged out until someone opened Settings. */
export const probeLogin = (adapter: ClaudeCodeAdapter) => {
  const panelToken = adapter.config.sshHost
    ? readSshToken(STATE_DIR, adapter.config.sshHost)
    : adapter.providerId === "claude-code"
      ? readSshToken(STATE_DIR, THIS_BOX)
      : undefined;

  if (panelToken) {
    adapter.setLoggedIn(true);

    return;
  }

  void accountIdentity(adapter.config.command, adapter.claudeHome, adapter.config.sshHost)
    .then((who) => adapter.setLoggedIn(who.loggedIn))
    .catch(() => {});
};
