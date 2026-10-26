// dsh LLM adapter that drives the Claude Code CLI (`claude -p --input-format stream-json --output-format stream-json`).
import { hostname } from "node:os";
import { join } from "node:path";
import { accountIdentity, readSshBoxes, registerSessionRoutes } from "./sessions.js";
import { hub } from "./events.js";
import { registerUsageRoute } from "./usage.js";
import { registerMcpBridge } from "./mcp.js";
import { ADAPTER_CURRENT, COMMAND_CATALOG, RESUME_TIMER, WATCH_SWEEP } from "./dsh.js";
import { loadStarted, loadCommandCatalog, STATE_DIR, trace } from "./state.js";
import { errorText } from "./process.js";
import { bindServerLocale } from "./locale.js";
export { markBusy, takeInterrupted } from "./state.js";
export { forkTranscriptText } from "./transcript.js";
export { Translator } from "./translator.js";
import { DSH_VERSION, setRemoteWorkspaces } from "./adapter/config.js";
// The entry keeps its export list while the split runs.
export { boxFor, Config, isOrphanedStandIn, localConfig, remoteCwdFor, remoteWorkspaceFor, setRemoteWorkspaces, } from "./adapter/config.js";
// The entry keeps its export list while the split runs.
export { keepsLiveTurn, registryKey, skillDoctorReply, } from "./adapter/types.js";
// The entry keeps its export list while the split runs.
export { EFFORTS_ALL, getCatalog, KNOWN_MODELS, liveWindowFor, mergeCatalog, modelFromApi, noteLiveWindow, parseCatalogCache, proxyBaseUrl, resolveModelInfo, stableModelId, } from "./adapter/catalog.js";
import { NO_PROCESS_FOR_ASIDE, selectionContext } from "./adapter/asides.js";
// The entry keeps its export list while the split runs.
export { asideAnswerText, selectionContext } from "./adapter/asides.js";
import { claudeSessionId, projectDirName } from "./adapter/transcript-watch.js";
// The entry keeps its export list while the split runs.
export { claudeSessionId, projectDirName } from "./adapter/transcript-watch.js";
// The entry keeps its export list while the split runs.
export { attachmentNotes, attachmentsOf, buildPrompt, clientTimeZone, contextSizes, contextSourceOf, relayFileHandles, selectTurns, TOOL_TEXT_CAP, steerKey, withoutNativeInstructions, } from "./adapter/prompt.js";
import { forgetCliProbe } from "./adapter/cli.js";
// The entry keeps its export list while the split runs.
export { accessModeOf, approvalsDisabled, buildArgs, buildInput, commandNames, denyCliFlag, dshToolsGuidance, forgetCliProbe, mcpToolsByServer, NATIVE_TOOL_MAP, permissionModeFor, probeCli, renameTitle, supports, unknownFlagIn, usesStdin, } from "./adapter/cli.js";
import { diffContext, RESUME_DELAY_MS, WATCH_SWEEP_MS } from "./adapter/turn.js";
// The entry keeps its export list while the split runs.
export { afterLastAssistant, diffContext, dropSent, finishReason, forgetSteers, hasPendingTodo, interruptOnAbort, isLoginFailure, isOwnSource, isStaleResume, killAfterGrace, LIMIT_TEXT, nativeToolRows, noteInterrupt, noticeSource, OUTCOME_MESSAGE, OWN_SOURCE_KIND, RECONNECT_TEXT, relayBlocks, resolvedAgent, RESTART_TEXT, sideQuestionsIn, stepContextFor, toolResultFor, ultracodeStatus, userPromptCount, WAKE_TEXT, wakeOnlyTurn, wantedUltracode, } from "./adapter/turn.js";
import { probeLogin, reconcileSshBoxes } from "./adapter/ssh-boxes.js";
import { ClaudeCodeAdapter } from "./adapter/class.js";
// The entry keeps its export list while the split runs.
export { ClaudeCodeAdapter } from "./adapter/class.js";
/** Plugin name identifier. */
export const name = "dsh-oh-my-claude";
/** Services injected into the plugin by the dsh runtime. */
export const inject = ["llm", "sessions", "attachments", "agents", "approval", "userQuestions"];
// Re-exported so tests that import from adapter.ts can reach it too.
export { ADAPTER_CURRENT };
/** The entry point dsh calls: build the adapter, register its provider and adapter, probe the login, and pin the instance on globalThis so a re-instantiation at boot shares the one already running. */
export function apply(ctx, config) {
    // Looked up on every read: `settings` is not in `inject`, so at apply it may not be mounted yet, and
    // a reference taken now stays undefined for the life of the process (every header wrote English).
    bindServerLocale({
        describe: (options) => ctx.get("settings")?.describe?.(options) ?? [],
    });
    const adapter = new ClaudeCodeAdapter(ctx, config);
    const claudeHome = adapter.claudeHome;
    ctx.llm.registerConfigurableProviders([
        {
            provider: adapter.providerId,
            displayName: adapter.displayName,
            settingsNs: adapter.settingsNs,
            settingsPath: [],
        },
    ]);
    adapter.registration = ctx.llm.registerAdapter([adapter.providerId], adapter);
    probeLogin(adapter);
    // dsh drops a session's Agent out of `ctx.agents` after a few idle minutes; the controller's
    // resolveAgent() cold-resumes it, which is what a wake after a long idle needs.
    ctx.inject?.(["sessionController"], (host) => {
        // SAFETY: cordis hands services untyped; this key holds dsh's session controller
        adapter.sessionController = host.sessionController;
    });
    // One timer per dsh process, never tied to this cordis scope: dsh re-instantiates the plugin
    // when settings apply at boot, and a scope-bound timer was disposed before it fired.
    // SAFETY: the two symbols are this plugin's own keys on globalThis, typed here once
    const g = globalThis;
    (g[ADAPTER_CURRENT] ??= new Map()).set(adapter.providerId, adapter);
    // Transcripts of loaded sessions go under watch now and on a timer, one per process like the
    // resume timer, reading the newest adapters at each tick.
    const sweep = () => {
        for (const a of g[ADAPTER_CURRENT]?.values() ?? [])
            void a.watchLoadedSessions().catch((e) => a.log("warn", `watch sweep: ${errorText(e)}`));
    };
    setTimeout(sweep, 5000).unref?.();
    if (!g[WATCH_SWEEP]) {
        g[WATCH_SWEEP] = setInterval(sweep, WATCH_SWEEP_MS);
        g[WATCH_SWEEP].unref?.();
    }
    void adapter.adoptKeepers().catch((e) => adapter.log("warn", `keeper adoption: ${errorText(e)}`));
    void adapter.adoptHolds().catch((e) => adapter.log("warn", `hold adoption: ${errorText(e)}`));
    // A hot reload disposes the previous instance's command registrations with its scope and
    // brings no new init frame; re-bridge from the catalog the last one saw.
    if (g[COMMAND_CATALOG])
        adapter.bridgeCommands(g[COMMAND_CATALOG], undefined);
    // A restart has no globalThis to read and adopts the keeper it finds, so no init frame follows:
    // the last catalog on disk is the only thing that puts the bridged commands back in the menu.
    // It waits on the commands service: at plugin load that service is not mounted yet, and
    // bridgeCommands answers nothing at all without it, which left the menu empty after a restart.
    else
        ctx.inject?.(["commands"], () => {
            void loadCommandCatalog(adapter.stateDir).then((names) => {
                if (names.length > 0)
                    adapter.bridgeCommands(names, undefined);
            });
        });
    if (!g[RESUME_TIMER]) {
        g[RESUME_TIMER] = setTimeout(() => {
            // Resume every mounted instance over its own busy file.
            for (const inst of g[ADAPTER_CURRENT]?.values() ?? [])
                inst
                    .resumeInterrupted(join(inst.stateDir, "busy.json"))
                    .catch((e) => trace(`resume after restart failed: ${errorText(e)}`));
        }, RESUME_DELAY_MS);
        g[RESUME_TIMER].unref?.();
        void trace("timer armed");
    }
    // Optional: the subprocess seam (stock dsh mounts a local provider; a community one can be remote).
    ctx.inject?.(["subprocess"], (host) => {
        // SAFETY: cordis hands services untyped; dsh's subprocess seam is what this key holds
        adapter.subprocess = host.subprocess;
    });
    ctx.inject?.(["permissionPresets"], (host) => {
        // SAFETY: cordis hands services untyped and the host type lacks this optional one;
        // dsh-permission-presets exposes current(session) returning the preset name
        const services = host;
        adapter.permissionPresets = services.permissionPresets;
    });
    // Routes, MCP bridge, usage route and the client panel are registered once per process: only
    // the default instance owns them. A non-default mount logs an info line and skips registration.
    if (adapter.providerId !== "claude-code") {
        adapter.log("info", "panel/routes/usage belong to the default claude-code instance");
    }
    else {
        // The SSH boxes the default instance mounts. `sshMounts` is scope-local (rebuilt each apply, since
        // a hot reload disposes the registrations); `sshAdapters` is the shared registry the resume walks.
        const sshMounts = new Map();
        const sshAdapters = (g[ADAPTER_CURRENT] ??= new Map());
        registerMcpBridge(ctx, {
            keyFile: join(STATE_DIR, "mcp.key"),
            log: (level, msg) => adapter.log(level, msg),
            version: "0.9.0",
            // The bridge is mounted once; a session on a box's model runs under that box's instance, so
            // the offer has to reach that mount's live turn (see ownerFor).
            relay: (sessionId, toolName, args, signal) => adapter.ownerFor(sessionId).relay(sessionId, toolName, args, signal),
        }).then((mcp) => {
            adapter.mcp = mcp;
        }, (e) => adapter.log("warn", `mcp bridge unavailable: ${errorText(e)}`));
        // Build a provider→box lookup from the registry so the usage route reads the right login: a
        // second local instance's own dir, or an ssh box's own `~/.claude` over ssh.
        const usageBoxFor = (providerId) => {
            const other = g[ADAPTER_CURRENT]?.get(providerId);
            return other
                ? {
                    home: other.claudeHome,
                    sshHost: other.config.sshHost || undefined,
                    realHome: other.realClaudeHome,
                    command: other.config.command,
                }
                : undefined;
        };
        // The same registry answers the session routes: a request that names its session's mount reads
        // that mount's box, so a session on an SSH box stops being reported as this one.
        // The same registry by host, for a read about a remote workspace: its files are on its box
        // whichever model the session runs, so the box is found by hostname rather than by provider id.
        const instanceForHost = (host) => {
            for (const other of g[ADAPTER_CURRENT]?.values() ?? [])
                if (other.config.sshHost === host)
                    return { configDir: other.claudeHome, command: other.config.command, sshHost: host };
            return undefined;
        };
        const instanceFor = (providerId) => {
            const other = providerId === null ? undefined : g[ADAPTER_CURRENT]?.get(providerId);
            if (other === undefined)
                return undefined;
            return {
                configDir: other.claudeHome,
                command: other.config.command,
                sshHost: other.config.sshHost,
            };
        };
        registerUsageRoute(ctx, (level, msg) => adapter.log(level, msg), (home, sshHost) => accountIdentity(adapter.config.command, home, sshHost ?? adapter.config.sshHost), {
            home: claudeHome,
            realHome: adapter.realClaudeHome,
            command: adapter.config.command,
            boxFor: usageBoxFor,
        });
        registerSessionRoutes(ctx, {
            log: (level, msg) => adapter.log(level, msg),
            onHeal: (heal) => {
                adapter.heal = heal;
            },
            // With the transcript switch on, `claudeHome` is the plugin's own mirror: its `projects/` is
            // where dsh-started sessions land, and the real `~/.claude/projects` is read alongside it so
            // a session started from a terminal is still listed and still opens.
            projectDir: (cwd) => [...new Set([claudeHome, adapter.realClaudeHome])].map((home) => join(home, "projects", projectDirName(cwd))),
            projectsDir: [...new Set([claudeHome, adapter.realClaudeHome])].map((home) => join(home, "projects")),
            startedIds: loadStarted,
            claudeIdOf: claudeSessionId,
            settingsPath: join(claudeHome, "settings.json"),
            configDir: claudeHome,
            boxesPath: join(STATE_DIR, "boxes.json"),
            importedDir: join(STATE_DIR, "imported"),
            sshBoxesPath: join(STATE_DIR, "ssh-boxes.json"),
            onSshBoxes: (boxes) => reconcileSshBoxes(ctx, config, boxes, sshMounts, sshAdapters, (level, msg) => adapter.log(level, msg)),
            remoteWorkspacesPath: join(STATE_DIR, "remote-workspaces.json"),
            onRemoteWorkspaces: setRemoteWorkspaces,
            command: adapter.config.command,
            boxCommand: adapter.configuredCommand,
            sshHost: adapter.config.sshHost,
            instanceFor,
            instanceForHost,
            onLoginStatus: (id, loggedIn) => g[ADAPTER_CURRENT]?.get(id ?? adapter.providerId)?.setLoggedIn(loggedIn),
            turnRecords: adapter.turnBuffer,
            dshVersion: DSH_VERSION,
            liveTurn: adapter.liveTurn,
            events: {
                hub,
                snapshot: (session) => adapter.snapshot(session),
                replies: {
                    liveTurn: (sessionId) => adapter.liveTurnReply(sessionId),
                    turns: (sessionId) => adapter.turnsReply(sessionId),
                    asides: (sessionId) => adapter.asidesReply(sessionId),
                    idle: (sessionId) => adapter.idleReply(sessionId),
                    permissionMode: (sessionId) => adapter.permissionModeReply(sessionId),
                },
            },
            idle: {
                deadlineFor: (session) => adapter.ownerFor(session).idleDeadlineMap.get(session) ?? null,
                extend: (session) => adapter.ownerFor(session).extendIdle(session),
                timeoutMs: adapter.config.idleTimeoutMs,
            },
            toolMode: {
                info: () => adapter.toolModeInfo(),
                set: (mode) => adapter.setToolMode(mode),
            },
            terminalSync: {
                info: () => adapter.terminalSyncInfo(),
                set: (enabled) => adapter.setTerminalSync(enabled),
            },
            // Everything below is about one session's own process or its own state, so it runs on the
            // mount that owns that session rather than on this one: these routes are registered once,
            // by the default mount, and a session on a box's model lives under the box's instance.
            permissionModes: {
                info: (sessionId) => adapter.ownerFor(sessionId).permissionModeInfo(sessionId),
                set: (sessionId, mode) => adapter.ownerFor(sessionId).setPermissionMode(sessionId, mode),
                restore: (sessionId, mode) => adapter.ownerFor(sessionId).restorePermissionMode(sessionId, mode),
            },
            contextUsage: (sessionId) => adapter.ownerFor(sessionId).contextUsage(sessionId),
            skillDoctor: (sessionId) => adapter.ownerFor(sessionId).skillDoctor(sessionId),
            workspaceDiff: (sessionId) => adapter.ownerFor(sessionId).workspaceDiff(sessionId),
            permissionReadout: (sessionId) => adapter.ownerFor(sessionId).permissionReadout(sessionId),
            mcp: {
                status: (sessionId) => adapter.ownerFor(sessionId).mcpStatus(sessionId),
                reconnect: (sessionId, serverName) => adapter.ownerFor(sessionId).mcpReconnect(sessionId, serverName),
                ask: (sessionId, serverName, ask) => adapter.ownerFor(sessionId).setMcpAsk(sessionId, serverName, ask),
                authenticate: (sessionId, serverName) => adapter.ownerFor(sessionId).mcpAuthenticate(sessionId, serverName),
            },
            rewind: (sessionId, uuid, dryRun) => adapter.ownerFor(sessionId).rewind(sessionId, uuid, dryRun),
            permissionAsks: adapter.permissionAsks,
            // Once a second per open session: a live process names its mount; without one there are no
            // waiting steers, and a held one sits on the mount that took it, which is this one when
            // nothing else is live.
            steersFor: (sessionId) => (adapter.ownerIfLive(sessionId) ?? adapter).steersFor(sessionId),
            holdSteers: (sessionId, ids) => adapter.ownerFor(sessionId).holdSteers(sessionId, ids),
            sendSteerNow: (sessionId, ids) => adapter.ownerFor(sessionId).sendSteerNow(sessionId, ids),
            releaseHold: (sessionId, holdId, how) => adapter.ownerFor(sessionId).releaseHold(sessionId, holdId, how),
            askAside: async (sessionId, question, seed) => {
                const owner = adapter.ownerFor(sessionId);
                // Liveness is settled here, not left to askSideQuestion, which would write its own error into
                // the ring: a recap nobody typed must not leave an error bubble on a session with no process
                // and nothing to respawn one from. An evicted process is respawned now, so the diff below
                // has a process to ask. The Ask control shows the error in its own note line instead.
                if (!(await owner.revive(sessionId))?.alive)
                    return { ok: false, error: NO_PROCESS_FOR_ASIDE };
                let context;
                if (seed.withDiff) {
                    const diff = await owner.workspaceDiff(sessionId);
                    if (!diff.ok)
                        return { ok: false, error: diff.error };
                    context = diffContext(diff, seed.path);
                }
                else if (seed.quote !== "")
                    context = selectionContext(seed.quote);
                owner.askSideQuestion(sessionId, question, context, seed.quote);
                return { ok: true };
            },
            sideQuestions: adapter.sideQuestions,
            loginNeeded: adapter.loginNeeded,
            sessionFallbacks: adapter.sessionFallbacks,
            boxOfSession: (sid) => {
                const label = adapter.hostLabelFor(sid);
                return { host: label ?? "", label: label ?? hostname() };
            },
            claudeUpdated: forgetCliProbe,
            loginDone: (host) => adapter.loginDone(host),
            logoutDone: (host) => adapter.logoutBox(host),
            liveCount: (host) => adapter.liveCount(host),
            persistAsides: (sessionId) => adapter.persistAsides(sessionId),
            starters: adapter.starters,
            setStarter: (key, text) => {
                adapter.setStarter(key, text);
            },
            thinking: {
                info: (sessionId) => adapter.ownerFor(sessionId).thinkingInfo(sessionId),
                set: (sessionId, tokens) => adapter.ownerFor(sessionId).setThinkingBudget(sessionId, tokens),
            },
            models: () => adapter.getAdvisorModels(),
            providerId: adapter.providerId,
            reloadPlugins: (sessionId) => adapter.ownerFor(sessionId).reloadPlugins(sessionId),
            reloadSkills: (sessionId) => adapter.ownerFor(sessionId).reloadSkills(sessionId),
            pluginErrors: (sessionId) => adapter.ownerFor(sessionId).pluginErrorsFor(sessionId),
            pluginWarnings: (sessionId) => adapter.ownerFor(sessionId).pluginWarningsFor(sessionId),
            liveTasks: (sessionId) => adapter.ownerFor(sessionId).liveTasksFor(sessionId),
            stopTask: (sessionId, taskId) => adapter.ownerFor(sessionId).stopTask(sessionId, taskId),
            taskOutput: (sessionId, taskId) => adapter.ownerFor(sessionId).taskOutput(sessionId, taskId),
            compactNow: (sessionId) => adapter.ownerFor(sessionId).compactNow(sessionId),
            awaiting: () => adapter.awaitingAll(),
            continueAfterLimit: adapter.config.continueAfterLimit,
        });
        // Mount the saved SSH boxes at boot; `sshMounts` is scope-local so a hot reload rebuilds them.
        void readSshBoxes(join(STATE_DIR, "ssh-boxes.json"))
            .then((boxes) => reconcileSshBoxes(ctx, config, boxes, sshMounts, sshAdapters, (l, m) => adapter.log(l, m)))
            .catch((e) => adapter.log("warn", `ssh boxes: ${errorText(e)}`));
        // The remote-workspace redirects are fed by the routes above (`onRemoteWorkspaces`), seed read
        // included: one feed on one chain, so a row the reconcile dropped cannot be read back in here.
    }
}
//# sourceMappingURL=adapter.js.map