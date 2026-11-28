// The account mount bookkeeping: mount one local adapter per saved account, withdraw the ones the
// list dropped. The SSH-box twin is ssh-boxes.ts; the two differ in what the instance runs on (this
// box, under its own CLAUDE_CONFIG_DIR) and in what it inherits from the default mount (the dsh
// tools bridge, which an SSH box cannot reach).
import { boxProviderId } from "../accounts.js";
import { errorText } from "../process.js";
import { ClaudeCodeAdapter } from "./class.js";
import { heldByOther, probeLogin, registerMount, tagPluginMount } from "./ssh-boxes.js";
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
export function reconcileAccounts(ctx, base, accounts, mounts, adapters, bridge, log) {
    const desired = new Map(accounts.map((a) => [boxProviderId(a.name), a]));
    for (const [providerId, mount] of mounts) {
        if (desired.has(providerId)) {
            continue;
        }
        mount.disposeAdapter();
        mount.disposeDirectory();
        mount.adapter.disposeProcesses();
        mounts.delete(providerId);
        adapters.delete(providerId);
        log("info", `account ${providerId} withdrawn`);
    }
    for (const [providerId, account] of desired) {
        if (mounts.has(providerId)) {
            continue;
        }
        if (heldByOther(adapters, providerId)) {
            log("warn", `account "${account.name}" -> ${providerId} already mounted; skipped`);
            continue;
        }
        const adapter = new ClaudeCodeAdapter(ctx, {
            ...base,
            providerId,
            providerName: account.name,
            configDir: account.configDir,
            sshHost: "",
            ownTranscripts: false,
        });
        // The bridge is registered once, by the default mount; a session on this account's model is
        // relayed to this instance through ownerFor, so sharing it gives the account dsh's tools.
        adapter.mcp = bridge.mcp();
        adapter.mcpMounting = bridge.mounting();
        const registered = registerMount(ctx, adapter, log);
        if (!registered) {
            continue;
        }
        const { disposeAdapter, disposeDirectory } = registered;
        tagPluginMount(adapter);
        probeLogin(adapter);
        mounts.set(providerId, { adapter, disposeAdapter, disposeDirectory });
        adapters.set(providerId, adapter);
        log("info", `account "${account.name}" mounted as ${providerId} -> ${account.configDir}`);
        // A restart mounts the account again from the file; its keepers are still running Claude for
        // its sessions and are adopted here, the way the default mount adopts its own at apply.
        void adapter
            .adoptKeepers()
            .catch((cause) => log("warn", `keeper adoption: ${errorText(cause)}`));
    }
}
/**
 * A reconcile that applies the saved list as it is when its turn comes. Calls run one at a time and
 * each re-reads, so a slow read started at boot cannot apply a list older than an add that was
 * saved while it ran: the add's own call queues behind it and reads the newer file. The list a
 * caller may pass is ignored for the same reason. A failed read or apply rejects that call only;
 * the next one still runs.
 */
export function serialAccounts(read, apply) {
    let chain = Promise.resolve();
    return () => {
        const next = chain.then(async () => apply(await read()));
        chain = next.catch(() => { });
        return next;
    };
}
/** Every local mount but the default, for the accounts routes: plugin accounts and hand-written
 *  mounts alike, with the dir they hand the CLI. SSH boxes are not accounts and are left out; a
 *  hand-written mount on the default dir comes back with loginKey "" and the routes skip it. */
export function localMountsOf(adapters) {
    return [...adapters].flatMap((m) => m.providerId === "claude-code" || m.config.sshHost
        ? []
        : [
            {
                provider: m.providerId,
                name: m.displayName,
                home: m.realClaudeHome,
                loginKey: m.loginKey,
                command: m.config.command,
            },
        ]);
}
//# sourceMappingURL=accounts.js.map