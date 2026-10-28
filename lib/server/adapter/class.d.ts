import type { Spawner, SubprocessHandle, CliModel } from "../process.js";
import { type PluginLoadError } from "../plugins.js";
import { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { type OmcEvent } from "../events.js";
import { readUsage } from "../usage.js";
import { type McpBridge } from "../mcp.js";
import { type ClaudeEvent, ClaudeProcess } from "../process.js";
import type { Agent, ImageAttachmentRef, JsonValue, PluginContext, SessionController, SubprocessRuntime } from "../dsh.js";
import { type ToolMode, type ToolModeInfo } from "../rows-probe.js";
import { type FsBox } from "../remote-fs.js";
import { sshRunner, type HoldRecord } from "../hold.js";
import { type HealHost } from "../session-heal.js";
import { Translator, type FallbackRecord, type SuggestionRow, type LiveTask, type LiveTaskPatch } from "../translator.js";
import type { FinishReason } from "@deepseek-ai/dsh-llm";
import type { ClaudeProcessSpec, RelayResult, TurnPrep } from "../process.js";
import { Config } from "./config.js";
import { type AsideEntry, type AsidesReply, type AwaitingRow, Continuation, ControlRequestEvent, type ControlReply, type ContextUsageReply, type Decision, type HeldSteer, type HoldReply, type IdleReply, type LoginNeed, type LiveTurnReply, type McpAuthReply, type McpStatusReply, type PermissionModeInfo, type PermissionModeReply, type PermissionModeState, type PermissionReadoutReply, type RewindReply, type SessionOptions, type SkillDoctorReply, type SteerCardState, type SteerEditReply, type WorkspaceDiffReply } from "./types.js";
import { type MirrorQueue, type StreamState, type TranscriptWatch } from "./transcript-watch.js";
import { type LoadedImage } from "./prompt.js";
import { type IdleTarget, type LiveTurn, type ResultFrame, type TurnRecord, type TurnsReply, type UltracodeState } from "./turn.js";
/** The LlmAdapter that drives the logged-in Claude Code CLI: it owns the live `claude` processes, bridges dsh's commands and routes into them, and mirrors their transcript back into dsh. */
export declare class ClaudeCodeAdapter extends LlmAdapter {
    ctx: PluginContext;
    config: Schemastery.TypeT<typeof Config>;
    subprocess?: Pick<SubprocessRuntime, "spawn">;
    /** dsh's permission preset service, when mounted: the shield's current preset per session. */
    permissionPresets?: {
        current: (session: object) => string;
    };
    processes: Map<string, ClaudeProcess>;
    /** Per session, the timer that continues the task once its usage limit resets. */
    limitTimers: Map<string, ReturnType<typeof setTimeout>>;
    mcp?: McpBridge;
    warnedNoSeam: boolean;
    /** Set once a session read has thrown, so the line lands one time and not per routed message. */
    warnedNoSessionRead: boolean;
    loggedVersion: boolean;
    /** Probe targets already written to resume.log, so the line lands once per binary, not per turn. */
    probeTraced: Set<string>;
    sessionController?: SessionController;
    /** What a heal needs from dsh, handed over by the session routes; undefined until they load. */
    heal?: HealHost;
    /** Masks secret env values in tool results; undefined when `redactSecrets` is off. */
    readonly redact: ((s: string) => string) | undefined;
    /** dsh sessions marked temporary with /temporary; on globalThis so a reload keeps them. */
    readonly temporary: Set<string>;
    /** Per-session turn accounting buffer (last 50 turns); keyed by dsh sessionId. Lives on
     *  globalThis so the route registered at boot reads what a hot-reloaded adapter fills. */
    readonly turnBuffer: Map<string, TurnRecord[]>;
    /** Settles once the stored turn records are in `turnBuffer`, or could not be read. */
    private readonly turnsLoaded;
    /** What the running turn has done so far, per session, for the status row: output tokens across
     *  the finished assistant messages, plus the thinking estimate for the block the model is in now.
     *  The estimate is cleared when the next usage frame lands, since that frame counts the same
     *  tokens for real. Set by the live translator, cleared when the turn ends; a session with no entry
     *  has no turn running. */
    readonly liveTurn: Map<string, LiveTurn>;
    /** The model last written to workspace-models.json per cwd, so a turn on the same model writes nothing. */
    readonly workspaceModelWritten: Map<string, string>;
    /** The sizes last written to context-sizes.json per cwd, as `key:value` pairs in a fixed order,
     *  so a workspace whose blocks did not change writes nothing. */
    readonly contextSizesWritten: Map<string, string>;
    /** Per-session idle watchdog deadline in epoch ms; null means no active arm. */
    readonly idleDeadlineMap: Map<string, number | null>;
    /** Per-session kill and warning timers, keyed by session id. */
    readonly idleKillTimers: Map<string, NodeJS.Timeout>;
    readonly idleWarnTimers: Map<string, NodeJS.Timeout>;
    /** What each armed key watches, so a route can re-arm it. */
    readonly idleTargets: Map<string, {
        proc: IdleTarget;
        warn: boolean;
        timeoutMs: number;
    }>;
    /** Per-session permission mode overrides; loaded from disk at init, saved on change. */
    permissionModes: Map<string, string | null>;
    /** dsh access mode seen on each session's last turn, so the effective mode can be reported. */
    accessModes: Map<string, string | undefined>;
    /** Sessions whose last runtime snapshot said dsh auto-denies every approval ask. */
    approvalsOff: Set<string>;
    /** Callers waiting for the CLI's `control_response` to a request this plugin sent, by request id. */
    controlWaiters: Map<string, (reply: ControlReply) => void>;
    /** The rules recent approval requests suggest, newest last, per session. */
    readonly permissionAsks: Map<string, string[]>;
    /** rpcIds of messages already routed to `askSideQuestion`, so a re-sent batch asks once. */
    readonly asked: Set<string>;
    /** `/btw` side questions and their answers, newest last, per session; kept in memory only. */
    readonly sideQuestions: Map<string, AsideEntry[]>;
    /** The options of each session's last turn, newest last, so `revive` can respawn a process the
     *  idle eviction killed with the spec the next turn would use. Survives eviction on purpose;
     *  lost on a dsh restart, where the keeper normally keeps the process alive anyway. */
    readonly lastTurnOptions: Map<string, SessionOptions>;
    /** Steers taken back for an edit, per session, keyed by the hold's first message id. */
    readonly heldSteers: Map<string, Map<string, HeldSteer>>;
    /** Sessions whose last turn failed for want of a login, and the box that turn ran on. The composer
     *  card reads this beside the asides; a turn that succeeds, or a panel login on that box, clears it.
     *  Memory only: after a restart the next failed turn writes it again. */
    readonly loginNeeded: Map<string, LoginNeed>;
    /** Saved opening prompts: one per session id, plus `default` for the one a session without its own
     *  is offered. Loaded from disk on construct and written through on every save. */
    readonly starters: Map<string, string>;
    /** The live thinking budget this plugin last set per session (null = session default, 0 = off);
     *  memory only, since a respawn resets it and the CLI has no flag to carry it. */
    readonly thinkingBudgets: Map<string, number | null>;
    /** Tool activity as the Settings switch set it; undefined = the config's `toolsInline`. Loaded from
     *  disk on construct, written through on every set, and read fresh at the start of each turn. */
    toolMode: ToolMode | undefined;
    cliModels: CliModel[];
    claudeHome: string;
    /** `~/.claude` itself, which stays the box's login and settings even when transcripts move. */
    realClaudeHome: string;
    /** The `command` as configured, before this box's path resolution. */
    configuredCommand: string;
    providerId: string;
    displayName: string;
    settingsNs: string;
    stateDir: string;
    /** Attach the mounted context and config, then load every persisted store (permission modes, tool modes, terminal sync, turn records, asides, starters and limit waits) so a resumed adapter reads as it left off. */
    constructor(ctx: PluginContext, config: Schemastery.TypeT<typeof Config>);
    /** dsh's handle for this instance's route. `replace` re-reads `providerInfo`, which is how a
     *  name change reaches the picker without a restart. */
    registration?: {
        replace: (providers: string[]) => void;
    };
    private loggedOut;
    /** "(not logged in)" after the provider name while the box's claude has no login: dsh copies the
     *  name at registration, so the route is registered again under the new one. Fed by the mount-time
     *  probe and by every login probe the panel runs, so the picker names a dead box at a glance. */
    /**
     * The binary to name for work on `host`: the command as configured when a turn runs on another
     * box, this box's resolved absolute path when it runs here.
     *
     * `localConfig` resolves a bare `claude` against this box's PATH so a dsh started with a short
     * one still finds it. That path means nothing on a far box, and sending it there failed the turn
     * outright: `claude exited 127: env: '/home/<you>/.local/bin/claude': No such file or
     * directory` on a remote workspace whose provider is the local mount (owner, 2026-09-22). An SSH
     * box mount was never affected, since `localConfig` leaves a box's command alone.
     */
    commandFor(host: string | undefined): string;
    /** "(not logged in)" after the provider name while the box's claude has no login: dsh copies the
     *  name at registration, so the route is registered again under the new one. Fed by the mount-time
     *  probe and by every login probe the panel runs, so the picker names a dead box at a glance. */
    setLoggedIn(loggedIn: boolean): void;
    /** The provider's display name, suffixed "(not logged in)" while the adapter is logged out, so a settings dropdown shows login state. */
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    /** Read on every listing rather than cached: an edit to settings.json takes effect at once. */
    private pickerSettings;
    /** A box without a login lists nothing: dsh's catalog drops a provider whose listing throws into
     *  its "could not load" row with a Retry, which is the honest picker for a box no turn can use.
     *  The row names the fix; Retry after the login brings the models back. */
    listModels(provider: string): Promise<import("@deepseek-ai/dsh-llm").LlmModelInfo[]>;
    /** After a `result` frame: remember a login failure for the card, and name the box's providers
     *  logged out so the picker stops offering them; a turn that succeeded clears both. */
    noteTurnLogin(sessionId: string, result: ResultFrame): void;
    /** Log out on `host` (this box when empty) cuts the cord: every live Claude on that box is killed,
     *  so nothing keeps answering on a login that is gone. A process that loaded the login at start
     *  would otherwise carry it in memory until it exited. Each session resumes from its transcript on
     *  its next message, which then fails for want of a login and shows the card. */
    logoutBox(host: string): void;
    /** Live Claude processes on `host` (this box when empty), across every mount there. The row shows
     *  the count when the box reads logged out: those still answer on the login they loaded at start. */
    liveCount(host: string): number;
    /** A panel login on `host` (this box when empty) succeeded: its providers list models again and
     *  the cards for sessions on that box read done. */
    loginDone(host: string): void;
    /** Every mounted instance, this one included: at boot or in a test it may not be in the shared
     *  registry yet. */
    private static mounts;
    /** No picker filter here: the allowlist curates what the picker offers, and the CLI keeps a
     *  session's own model when the allowlist excludes it rather than failing to resolve it.
     *
     *  The missing `context` is deliberate; see `prepareCall` below for why.
     */
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<{
        provider: string;
        id: string;
        name: string;
        description?: string;
        inputModalities?: readonly import("@deepseek-ai/dsh-llm").ModelModality[];
        defaultMaxTokens?: number;
        reasoning?: import("@deepseek-ai/dsh-llm").LlmModelReasoningInfo;
        systemPromptUpdate?: import("@deepseek-ai/dsh-llm").SystemPromptUpdate;
    }>;
    /** Capacity, reported here and only here.
     *
     *  dsh reads a model's context window through two different methods and uses each answer for a
     *  different job. `prepareCall` feeds the context ring: `request/context` carries the window to
     *  the token meter, and this plugin's own readouts are injected into that ring. `resolveModel`
     *  feeds `llm.resolveModelInfo()`, which is what `@deepseek-ai/dsh-compaction-basic` multiplies
     *  by its threshold ratio to decide whether to compact before a step. Answering the first and
     *  staying quiet on the second turns dsh's automatic compaction off for this plugin's routes
     *  while the ring keeps working.
     *
     *  That is worth doing because dsh's pressure number is not measuring the thing it thinks it is.
     *  Claude Code compacts its own context (169,490 tokens before the boundary, in a session logged
     *  2026-09-14) and dsh cannot see it: dsh measures its own session surface, which keeps growing
     *  because `resume` sends the CLI only the tail after the last assistant message. Two sessions
     *  that day declared a 1,000,000-token window and dsh still compacted 22 times, spending ~100 s
     *  of Opus per trigger on a summary `selectTurns` slices off before the prompt is built. So the
     *  compaction runs on top of the CLI's own, off a number that does not describe the CLI's
     *  context, and throws the result away.
     *
     *  What this costs, measured against every reader of `resolveModelInfo(...).context` in installed
     *  dsh: `dsh-session-reference` falls back from a 160,000-byte reference budget to its 65,536-byte
     *  default on these routes, and automatic overflow recovery goes with automatic compaction, which
     *  is free here because this plugin never reports CONTEXT_WINDOW_EXCEEDED. `/compact` still works:
     *  `compactNow` never reads capacity. `dsh-acp` reads modalities and reasoning, not context, and
     *  `buildModelCatalog` does not read context at all, so the model picker is unaffected.
     *
     *  Compaction's own `agent/pre-step` handler catches the resulting `TargetPressureConfigError`,
     *  warns once per target and calls `next()`, so a turn is never failed by the silence.
     */
    prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<{
        model: LlmResolvedModelInfo;
        stream: (options: GenerateOptions) => AsyncGenerator<StreamChunk, any, any>;
    }>;
    /** Full metadata for one model, capacity included: the single source both methods above narrow. */
    private fullModelInfo;
    /** Get the effective permission mode for a session, checking for an override first. */
    getPermissionMode(sessionId: string, accessMode: string | undefined): string;
    /** The working directory a session runs in, read from its header, or undefined when the session is unknown or its header throws (a detached session cannot be read). */
    sessionCwd(sessionId: string): string | undefined;
    /** Emit a names-prefixed log line at the given level, swallowing the error cordis throws when the
     * logger is reached from an inactive scope. A log line is not worth crashing on. */
    log(level: string, message: string): void;
    /** A copy of the image under the plugin's state dir, named by attachment id with the extension
     *  its media type calls for: dsh's own stored object has no extension, and Claude Code's Read
     *  decides image-or-text by the name. Written once per attachment; a failure just leaves the
     *  image inline-only, as before. */
    keepImageCopy(ref: ImageAttachmentRef, data: ArrayBuffer): Promise<string | undefined>;
    /** The copy itself, as a field so the offline suite can stand in for the ssh. */
    copyToBox: (host: string, localPath: string, farName: string, capMs: number) => Promise<string>;
    /** Far paths of what this process has already copied, by box and local path.
     *  ponytail: never forgotten, so a copy deleted on the box stays "there" until dsh restarts. */
    private onBoxAlready;
    /** One attachment's path on `host`, copied there the first time it is asked for. */
    onBox(host: string, localPath: string, farName: string, capMs: number): Promise<string>;
    /** `host` is the box the turn runs on, when it is not this PC: the saved copy the note names has
     *  to be on that box, so it is copied there, and an image that would not copy gets no note (it
     *  still rides inline) rather than one naming a path that box's claude cannot read. */
    loadImages(refs: ImageAttachmentRef[], signal: AbortSignal | undefined, host?: string, capMs?: number): Promise<LoadedImage[]>;
    /** A dsh fork of a Claude session becomes a Claude fork: the parent's transcript is copied under
     *  the new id, cut at the forked turn. True when a copy was made. */
    forkTranscript(options: GenerateOptions, cwd: string, id: string): Promise<boolean>;
    /** Everything one turn needs: spawn args + spec for the long-lived process, and the stdin line for this turn. */
    prepare(options: GenerateOptions, { forceFresh }?: {
        forceFresh?: boolean;
    }): Promise<TurnPrep>;
    /** Claude slash commands already registered as dsh commands, name → disposer. */
    readonly bridged: Map<string, () => void>;
    /** Sessions already warned that `toolsInline: false` is ignored on a versioned session format. */
    readonly rowsRefused: Set<string>;
    /** Terminal exchanges the watcher found, by dsh session, each shown as one turn of its own. */
    readonly mirrors: Map<string, MirrorQueue>;
    /** Terminal turns being streamed live into an open dsh turn, by dsh session. */
    readonly streaming: Map<string, StreamState>;
    /** Whether terminal exchanges are mirrored into dsh at all; the owner's switch, on by default. */
    terminalSync: boolean;
    /** One transcript watcher per dsh session that finished a turn on this box, by dsh session. */
    readonly watchers: Map<string, TranscriptWatch>;
    /**
     * This plugin's own commands, which share the `bridged` map so one disposer list covers all of
     * them. They are never Claude's, so the bridge must not register them as passthroughs and the
     * catalog file must not carry them: the catalog is the union of what it held and what was
     * bridged, so once they slipped in, every later boot bridged `/btw` to Claude first and the real
     * handler saw the name taken and stood down (2026-09-08: "/btw isn't available in this environment").
     */
    static readonly OWN_COMMANDS: Set<string>;
    /** dsh session id → what `/ultracode` last asked for, and what the CLI last said about it.
     *  `confirmed` is absent until a read-back lands. Written to `ultracode.json` on every change, so
     *  a session keeps its setting across a dsh restart and a relaunch of its process. */
    readonly ultracode: Map<string, UltracodeState>;
    /** The last write of `ultracode.json`; the next one waits for it. */
    private ultracodeSaved;
    /** dsh session id → the tool names its last init frame reported; absent until one arrives. */
    readonly sessionTools: Map<string, string[]>;
    /** dsh session id → the plugins its last init frame said the CLI failed to load. Absent until an
     *  init frame arrives; a clean load clears it. A session adopted from the keeper after a dsh
     *  restart sees no new init frame, so it reads clean until its next fresh spawn.
     *  ponytail: one entry per live session, dropped by `forgetSession` when its process goes. */
    readonly sessionPluginErrors: Map<string, PluginLoadError[]>;
    /** dsh session id → the plugins its last init frame warned about (loaded, but with a complaint:
     *  a shadowed default folder, a suppressed server. Absent until an init frame arrives; a clean
     *  load clears it. reload_plugins carries no warning_count, so unlike errors these refresh only at
     *  the next spawn's init frame, never on a reload.
     *  ponytail: one entry per live session, dropped by `forgetSession` when its process goes. */
    readonly sessionPluginWarnings: Map<string, PluginLoadError[]>;
    /** Claude's own live tasks per dsh session (task id → row), from the translator's task frames;
     *  a terminal status removes the row, `forgetSession` and a process exit drop the map. A task
     *  that ends while no turn is reading stays until the next turn drains the queue; Stop on it
     *  then shows the CLI's error. */
    readonly sessionTasks: Map<string, Map<string, LiveTask>>;
    /** dsh session id → the model switch its last turn reported (a safety refusal, a primary-model
     *  fallback, or the usage-credit gate), surfaced through `/side-questions` like `loginNeeded`. One
     *  entry per live session, overwritten on each switch; the client reads it at the stop transition.
     *  ponytail: one entry per live session, dropped by `forgetSession` when its process goes. */
    readonly sessionFallbacks: Map<string, FallbackRecord>;
    /** dsh session id → the prompt this session is waiting on, so a background tab can be told. One
     *  entry per session, set when a prompt opens and cleared when it settles. In memory on purpose:
     *  a prompt is live state and a restart re-asks.
     *  ponytail: one entry per live session, dropped by `forgetSession` when its process goes. */
    readonly awaitingInput: Map<string, {
        kind: "approval" | "question" | "plan";
        id: string;
        since: number;
    }>;
    /** Whether dsh serves a user-invocable skill named `name` for this agent, user and project roots
     *  both. False when dsh has no skill service or the lookup fails, so the command refuses as before. */
    dshServesSkill(agent: Agent, name: string, signal?: AbortSignal): Promise<boolean>;
    /** The refusal a command this plugin owns answers with in a session on another provider. */
    notClaude(agent: Agent, command: string): {
        kind: "error";
        text: string;
    } | undefined;
    /**
     * Register Claude Code's slash commands (from the CLI's init frame) as dsh `/commands`. The
     * handler hands the line to Claude as the next prompt, where the CLI expands the skill or
     * custom command the way the terminal does; dsh keeps its own command of the same name.
     */
    bridgeCommands(names: string[], agent: Agent | undefined): void;
    /** The effective mode for a session and the stored override, for the header chip. */
    /**
     * The session's dsh access mode right now: the shield's current preset from dsh's own service
     * when it is mounted (a pick there is live at once), else the last runtime-context snapshot.
     */
    currentAccessMode(sessionId: string): string | null;
    /** The permission mode a session may use now: its stored override on top of the shield's access mode, with the config default as the floor and every mode up to the ceiling allowed. */
    permissionModeInfo(sessionId: string): PermissionModeInfo;
    /**
     * Store a session's permission mode override (null clears it) and, when that session's Claude
     * process is alive, switch it live with a `set_permission_mode` control request. The CLI reads
     * stdin during a turn; between turns the line is queued and answered when the next turn opens.
     *
     * Bypass is the exception: the CLI answers `Cannot set permission mode to bypassPermissions
     * because the session was not launched with --dangerously-skip-permissions` on any process that
     * did not start in bypass (probed on 2.1.280: a `--permission-mode bypassPermissions` launch
     * counts as the flag). That request is not sent; the stored mode joins the spec key, so the
     * session's next turn respawns in bypass, and the reply says so with `live: false` and a
     * `liveMode` that still names the old mode. Wrong case: a process that was switched out of
     * bypass live would take bypass back live, but its `spec.mode` says bypass so it does; a process
     * launched below bypass can never be switched up live, whatever it was set to since.
     */
    setPermissionMode(sessionId: string, mode: string | null): Promise<PermissionModeReply>;
    /** The body of `setPermissionMode` without the publish: every return path, refused or applied,
     *  ends in the same event so the capsule reads the mode the process is really in. */
    private applyPermissionMode;
    /**
     * Remember the mode a transcript ran under as the session's override, with no ceiling check and
     * no live switch: the caller is opening a past CLI session in dsh, and `getPermissionMode` clamps
     * the override to dsh's access mode at every spawn, so a bypass transcript opened under a
     * workspace-write shield runs as acceptEdits. An unknown mode is ignored.
     */
    restorePermissionMode(sessionId: string, mode: string): Promise<void>;
    /**
     * A spec that differs from the live process only by model, effort or both is switched in place,
     * so the change keeps the process and its MCP bridge instead of a kill and `--resume`: the model
     * with `set_model`, the effort with `apply_flag_settings`. Anything else (cwd, mode, session
     * flags) still respawns, and so does a switch the CLI did not make. On success the process
     * carries the new spec and key.
     *
     * The effort is read back with `get_settings` before it is believed: the CLI answers `success`
     * to a level it does not know and changes nothing (probed on 2.1.293 with `bogus`), and on a
     * model without effort levels the setting stays null. A change back to no effort at all
     * respawns: the CLI would take it, but the default it returns to cannot be checked.
     * A CLI older than the request answers with an error and is respawned, as before.
     * ponytail: the keeper's spec.json keeps the old spec; a reattach after a dsh restart sees a key
     * mismatch and respawns with the new flags, which is correct, only one spawn later than ideal.
     */
    retarget(proc: ClaudeProcess, spec: ClaudeProcessSpec): Promise<boolean>;
    /** Hand a `control_response` to whoever sent the request; true when someone was waiting. */
    resolveControl(event: ClaudeEvent): boolean;
    /**
     * Send one control request and wait for its answer. The process hands `control_response` lines
     * to `resolveControl` as they arrive, so this works between turns as well as inside one.
     */
    control(proc: ClaudeProcess, request: Record<string, JsonValue>, timeoutMs?: number): Promise<ControlReply>;
    /** What the steer card shows: typed steers still in the CLI's queue, oldest first, and the ones
     *  taken back for an edit. A call from the card's own read (`touch`, the default) re-arms every
     *  hold's timer, so a hold nobody reads (a closed tab) goes back to Claude unchanged after
     *  `HOLD_IDLE_MS`; a publish passes `touch: false`, since the turn loop publishes at every tool
     *  boundary and would otherwise keep a closed tab's hold alive for the whole turn. `inTool` says
     *  the CLI is inside a dsh tool, which blocks Send now for every row. */
    steersFor(sessionId: string, touch?: boolean): SteerCardState;
    /** The timer that restores a hold its card stopped polling for. */
    private holdTimer;
    /**
     * Take typed steers back from Claude so someone can edit them, several at once when asked (the
     * card's Edit all, the CLI's up-arrow). Each is cancelled in the CLI first; one the CLI never
     * saw (relayed, or held back for its file or image) skips the cancel and leaves the inbox
     * directly; one the CLI already took is skipped, and one dsh already drew as sent (the park won
     * the race) goes straight back to Claude. The rest leave dsh's inbox too, so nothing delivers
     * them while the edit is open, and wait in a hold until `releaseHold`. When nothing forwarded is
     * left in the CLI's queue the park flag drops, or the next tool result would end the step on an
     * empty inbox.
     */
    holdSteers(sessionId: string, ids: string[]): Promise<HoldReply>;
    /**
     * End a hold. `restore` puts every held message back as it was, `drop` discards them, and a text
     * sends one message in their place (the first one's identity, the new words, and every file and
     * image the held messages carried; blank words only while one is left). Going back is dsh's
     * own steer, so a turn still running forwards it to Claude like any steer and an idle session
     * starts a turn for it. When the session cannot be reached the hold stays, for a retry.
     */
    releaseHold(sessionId: string, holdId: string, how: "restore" | "drop" | {
        text: string;
    }): Promise<SteerEditReply>;
    /**
     * Send waiting steers now, the way Claude Code's own send-now key does: take them back from the
     * CLI, cut the running turn short, and put them to the idle agent, which starts a turn for them.
     *
     * The CLI's key (`chat:sendNow`, 2.1.275) interrupts the running turn and lets its queue drain
     * into the next one; nothing about the messages changes, they stop waiting. dsh's
     * `agent.cancel({ keepInbox: true })` is the same cut, and it is what makes the plugin send the
     * CLI its interrupt. The hold comes first so the messages are not in the CLI's own pending list
     * when the interrupt lands, and they go back through `agent.steer` once the agent is idle, which
     * the mirror documents as starting a turn. A dsh without `cancel` (0.1.6 and earlier) gets the
     * steers put back untouched and a refusal that says so. A relay pending refuses with `relayed`:
     * the tool cannot be cut short without killing the CLI.
     */
    sendSteerNow(sessionId: string, ids: string[]): Promise<SteerEditReply>;
    /**
     * Rewind a session to one of its user prompts: `rewind_files` (dry run first, from the UI) puts
     * the working tree back, then `rewind_conversation` drops Claude's context after that prompt.
     * dsh's own transcript is not touched.
     */
    rewind(sessionId: string, uuid: string, dryRun: boolean): Promise<RewindReply>;
    /**
     * dsh's session-title request, served by the session's live Claude process through the
     * `generate_session_title` control request instead of a second one-shot spawn on `titleModel`.
     * `persist: true` also names Claude's own session, so `claude --resume` shows the same title.
     * Undefined when there is no live process or the CLI declines; the caller then falls back to
     * the one-shot path.
     */
    titleFromCli(sessionId: string, description: string): Promise<string | undefined>;
    /**
     * Ask a freshly spawned process for the CLI's model picker once per boot and hand it to the
     * catalog; the answer arrives before the first prompt is even read. A failure leaves the API
     * and known models in place.
     */
    cliModelsAt: number;
    /** The Settings control "Proxy reaches Anthropic" (the `proxyFirstParty` pair in the hints
     *  store) resolved against what the endpoint answered, read with the other hints before each
     *  spawn. On auto, which is the default, the endpoint decides; a chosen setting outranks it. */
    proxyFirstParty: boolean;
    /** The disk seed, awaited by the first listing so a boot never answers from the floor by a race. */
    private cliSeed;
    /** Ask a live CLI for its model lineup once per TTL window and cache it, so the listing has rows before the next list_models answers; false when throttled, declined, or empty. */
    refreshCliModels(proc: ClaudeProcess): Promise<boolean>;
    /**
     * The CLI's lineup is kept on disk, per box, so a fresh dsh-web lists the same rows before any
     * process has answered `list_models`. Without it the first listing lacks every `[1m]` alias, and
     * dsh loads one catalog per host generation: a session bound to `claude-fable-5-1[1m]` then shows
     * the raw id in the composer seat and stays that way until the page reloads.
     */
    private cliModelsPath;
    /** Persist the CLI's model list to disk under the state dir; a read-only state dir or full disk is swallowed, since the live answer still serves this boot. */
    private persistCliModels;
    /** This boot's one lineup probe, shared by every listing that waits on it. */
    private lineupProbe;
    /**
     * Ask the local CLI for its model picker before any session has spawned a process, so a box with
     * no `cli-models.json` yet does not list the built-in floor: without a seed the listing has only
     * that floor and the Models API, and the API read can find no live token (a config dir other than
     * the default `~/.claude` on macOS, whose Keychain login is not read, or a token the CLI has not
     * refreshed lately). One short-lived `claude -p` per boot is sent
     * `list_models` and nothing else, so no model is called and nothing is spent; its answer goes
     * through `refreshCliModels`, so it is decoded, cached and written to disk like a session's.
     * Never on an ssh box, whose first session process is asked as before. Waits at most
     * `LINEUP_PROBE_WAIT_MS`; a CLI that is missing, logged out or slow leaves the listing as it was.
     */
    probeCliModels(): Promise<void>;
    /** Run the probe's process to its answer and end it; resolves whatever happens and never throws,
     *  logging at info why no lineup came back (the CLI's stderr tail, when it wrote one). A probe
     *  that got no lineup leaves the TTL stamp clear, so the first session still asks. */
    private askLineup;
    /** Seed from the last answer, unless a process has already answered this boot. */
    seedCliModels(): Promise<void>;
    /** Get the current model catalog for advisor selection. */
    getAdvisorModels(): Promise<Array<{
        id: string;
        name: string;
    }>>;
    /** The MCP servers of a session's live process (`mcp_status`). */
    mcpStatus(sessionId: string): Promise<McpStatusReply>;
    /** Ask a session's live process to reconnect one MCP server (`mcp_reconnect`). */
    mcpReconnect(sessionId: string, serverName: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** Start an OAuth login for one MCP server (`mcp_authenticate`). The reply carries the page the
     *  browser must open; the CLI's own loopback catches the redirect and stores the token, so the
     *  plugin keeps nothing. The case this gets wrong if written naively: a server whose token is
     *  still good answers success with no page, which is a login that needed nothing rather than a
     *  failure. */
    mcpAuthenticate(sessionId: string, serverName: string): Promise<McpAuthReply>;
    /** Pin one MCP server's tools back to asking, or clear the pin
     *  (`set_mcp_permission_mode_override`). Tighten-only over this channel: the CLI accepts
     *  `default`, `auto` and null and rejects the rest without changing state, so this offers the two
     *  ends. It lives in the process's own tool-permission context, so it dies with the process, and
     *  it is read only when the session's mode would otherwise auto-allow. */
    setMcpAsk(sessionId: string, serverName: string, ask: boolean): Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** Ask a session's live process to re-read plugins, commands, agents and their MCP servers from
     *  disk (`reload_plugins`), so an enable, uninstall or marketplace change the CLI just wrote to
     *  settings takes effect now instead of at the next spawn. No live process is not a failure: the
     *  write landed and the next spawn will read it, so `live` is false and there is nothing to say. */
    reloadPlugins(sessionId: string): Promise<{
        ok: boolean;
        live: boolean;
        error?: string;
    }>;
    /** Ask a session's live process to re-read skills from disk (`reload_skills`), so a skill just
     *  created, edited or removed applies now. The reply lists the skills and the process emits a
     *  `commands_changed` frame, which the init handler bridges into dsh's slash menu, so a new
     *  skill's `/name` registers live. A dead process is not a failure: the next spawn reads the
     *  file, so `live` is false and there is nothing to say. */
    reloadSkills(sessionId: string): Promise<{
        ok: boolean;
        live: boolean;
        error?: string;
    }>;
    /** One task frame into the session's live list (`applyTaskPatch` holds the rules); the map is
     *  created on the first frame so a session with no tasks owns no entry. */
    noteTask(sessionId: string, taskId: string, patch: LiveTaskPatch): void;
    /** The session's live tasks, oldest first, for the Tasks tab. Empty without a process. */
    liveTasksFor(sessionId: string): LiveTask[];
    /** Ask the CLI to stop one task. The reply is the CLI's: an error for a task it no longer has.
     *  On success the row goes at once: the `killed` and `stopped` frames that follow reach the
     *  translator only inside a turn, and a Stop clicked between turns would otherwise show a row
     *  the CLI has already ended until the next prompt. */
    stopTask(sessionId: string, taskId: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** The tail of one background shell or Monitor task's output (the CLI caps it at 8 KiB). On a
     *  subagent task the CLI answers an error, which is returned as the text. */
    taskOutput(sessionId: string, taskId: string): Promise<{
        ok: boolean;
        output?: string;
        error?: string;
    }>;
    /** The plugin load errors this session's last init frame reported, for the panel. */
    pluginErrorsFor(sessionId: string): PluginLoadError[];
    /** The plugin warnings this session's last init frame reported, for the panel. */
    pluginWarningsFor(sessionId: string): PluginLoadError[];
    /** The open prompts, keyed by dsh session id, for the browser's background notices. */
    awaitingSnapshot(): Record<string, AwaitingRow>;
    /** The open prompts across every mount, which is what `/awaiting` and the `awaiting` event
     *  serve: a box's session holds its prompt on the box's instance, so the root's own map alone
     *  would miss it. On a box with one mount this is `awaitingSnapshot()`. */
    awaitingAll(): Record<string, AwaitingRow>;
    /** The running turn's figures for the status row, read from the session's mount, or the empty
     *  object when no turn is running (the adapter drops the record the moment a turn ends). The
     *  ages are relative to now; the tab adds the time since it received the body. `thinkingMs` is
     *  how long the open thinking burst has run, absent when none is open; `idleMs` is the time
     *  since the last frame of model output; `tool` says a call is in flight; `relayName` and
     *  `relayMs` name the dsh tool a parked turn waits on and for how long. */
    liveTurnReply(sessionId: string): LiveTurnReply | Record<string, never>;
    /** A session's turn records from its mount, oldest first, with their sums. An empty list is
     *  "no records to hand out right now", which the tab treats as nothing to replace: the buffer
     *  is empty for a moment after a restart until the saved records load. */
    turnsReply(sessionId: string): TurnsReply;
    /** The aside ring, the login card, the fallback note and the steer card for one session, each
     *  read from the mount that holds it: the ring, the login need and the fallback live on the
     *  session's owner, the waiting steers on whichever mount has its live process (the root when
     *  none is live, since a held steer sits on the mount that took it). */
    asidesReply(sessionId: string, touch?: boolean): AsidesReply;
    /** The next prompt the CLI predicted after this session's last turn, from the mount that runs
     *  its process; null when there is none, the process is gone, or a prompt went out since. */
    suggestionFor(sessionId: string): SuggestionRow | null;
    /** When the idle watchdog would end the session's process (null: not armed), from the mount
     *  that runs it, with the configured timeout so the tab can draw the countdown. */
    idleReply(sessionId: string): IdleReply;
    /** The permission mode info the capsule draws, from the session's mount, with the pickable modes
     *  under the `modes` name the client reads. */
    permissionModeReply(sessionId: string): PermissionModeState;
    /** Everything a tab needs the moment its event stream opens: the tab-wide awaiting map always,
     *  and for the open session its live turn, asides, idle deadline, turn records and permission
     *  mode. Hints are not here: the tab reads them on mount already. A reconnect gets the same
     *  snapshot in place of a replay, since every kind is a current value. */
    snapshot(sessionId: string | null): OmcEvent[];
    /** The tab-wide awaiting map to every stream, merged over every mount: a prompt opened or
     *  answered anywhere. A mount publishing only its own map would make a tab forget the root's
     *  prompts on the next box event. */
    private publishAwaiting;
    /** The asides body for one session to its streams, read from the session's mount. A publish
     *  does not re-arm hold timers (`touch: false`); only the card's own read does. */
    private publishAsides;
    /** The idle deadline for one session, coalesced to once a second: the turn loop re-arms the
     *  watchdog on every frame. `key` is the session id, except the aux decide stream's `aux-`
     *  keys, which share the map and reach no tab. */
    private publishIdle;
    /** The permission mode state for one session to its streams: after a pick, a restore or a
     *  spawn, which is when `liveMode` changes. */
    private publishPermissionMode;
    /** The CLI's working-tree diff (`get_workspace_diff`) for a session with a live process. */
    workspaceDiff(sessionId: string): Promise<WorkspaceDiffReply>;
    /** The permission rules and hooks a session's live process actually loaded
     *  (`list_permission_rules`, `get_hooks_listing`), read-only. Both or neither: the readout is one
     *  section pair and a half-answer would read as an empty half. */
    permissionReadout(sessionId: string): Promise<PermissionReadoutReply>;
    /**
     * The CLI's own context breakdown (`/context` in the TUI) for a session with a live process;
     * answered between turns as well as inside one. 5 s: the CLI replies at once when it reads stdin.
     */
    /** The CLI's own skill report (`/skill-doctor`, the same code path as `/plugin stats`): what each
     *  skill costs in context and how often it has run. A throwaway one-shot in the session's
     *  workspace cwd so project skills show, reading the raw `result` frame; it spends no model tokens
     *  (the command is synthetic, measured 2026-09-19 returning at 2.3 s with no model turn). Not a
     *  control request, and not `prepare`'s purpose branch, which forces a scratch cwd. */
    skillDoctor(sessionId: string): Promise<SkillDoctorReply>;
    /** The SDK's `initialize` request, once per process this adapter starts or adopts: asks the CLI
     *  to write a one-line progress summary into each subagent's `task_progress`, and, unless the
     *  `promptSuggestionsOff` hint is set, to predict the next prompt after each turn
     *  (`prompt_suggestion` frames, one small cached model call per turn). The reply (the command
     *  catalog the init frame already carries) is not used; a failure is logged and the session
     *  runs as before. Sent after the hints read, so the first prompt may go out first; probed both
     *  orders on 2.1.304 (2026-10-20) and the CLI applies the preference either way, and again on a
     *  second request. A slow boot can outlast the reply timeout and log a warning for a request the
     *  CLI did apply; harmless. A suggestion still arrives only on the CLI's own terms (see
     *  `ClaudeProcess.suggestion`). */
    sendInitialize(proc: ClaudeProcess): Promise<void>;
    /**
     * Wire the per-process hooks that outlive any one turn: the suggestion traces and the CLI's
     * session name following into dsh. One place for the spawn, adopt and reattach sites, which
     * carried three copies of the suggestion pair before the title hook made it three triples.
     */
    hookProcess(proc: ClaudeProcess, sessionId: string): void;
    /**
     * dsh's session takes the name the CLI reported, unless it already has it. Without a title
     * service (a dsh without the bundle) or a live session nothing happens; a rename the service
     * refuses (the session closing under it) is logged, not thrown, since this runs off a readline
     * hook with no caller to answer.
     */
    renameDshSession(sessionId: string, title: string): void;
    /**
     * The other direction, checked at each prompt: a name someone typed into dsh (source `user`,
     * never dsh's generated or fallback title, which would overwrite the CLI's own auto title with
     * the first prompt's words) goes to the CLI as `rename_session` when it differs from the last
     * name this process reported or was sent. `proc.title` is set once the CLI has answered,
     * accepted or refused (a refusal of this name is not worth repeating at every prompt); a
     * request that never gets an answer leaves it unset, so the next prompt tries again. The
     * `session_title_changed` echo that can land before the answer is harmless either way:
     * `renameDshSession` finds dsh already holding that name and changes nothing.
     */
    syncTitleToCli(proc: ClaudeProcess, sessionId: string): void;
    /**
     * Send Claude's own `/compact` as the session's next prompt, the way the bridged
     * `/claude-compact` command does: a user message through the agent, so dsh opens a turn and the
     * transcript shows `/compact` as the bubble you sent. The CLI expands it as the terminal would.
     * Fails when the session cannot be reached (dsh unloaded it and refused the resume).
     */
    compactNow(sessionId: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** Ask the CLI how many tokens this session's context window holds, bank the figure for dsh's context ring under both the spec and CLI model names, and flag an assumed-behind window when this box runs behind a proxy. */
    contextUsage(sessionId: string): Promise<ContextUsageReply>;
    /**
     * `/temporary`: toggle "keep no Claude transcript" for the current dsh session. Registered here,
     * from the first init frame, because at apply() the commands service is not up yet and the
     * optional lookup returns nothing. The next process for the session starts with
     * --no-session-persistence; a live one is replaced by the spec change.
     */
    registerTemporaryCommand(commands: NonNullable<PluginContext["commands"]>): void;
    /**
     * `/ultracode [on|off|status]`: Claude Code's ultracode for this session, switched inside the
     * running process with `apply_flag_settings` and remembered for the next one. With no argument
     * it flips. dsh's command handler answers at once and cannot wait for the CLI, so the reply
     * says the request went out and `status` reports what the CLI read back: on, off, or that the
     * model does not offer it (the CLI answers `success` there too and changes nothing, probed on
     * 2.1.293 with haiku).
     */
    registerUltracodeCommand(commands: NonNullable<PluginContext["commands"]>): void;
    /**
     * Send a session's ultracode setting to its process and record what the CLI reads back. A
     * session nobody has set is left alone, so a process keeps whatever its own settings gave it.
     * Never throws: a refusal or a silent CLI leaves the setting unconfirmed, which `status` says.
     */
    applyUltracode(proc: ClaudeProcess, sessionId: string): Promise<void>;
    /**
     * `/btw <question>` asks Claude a side question over the `side_question` control request, which is
     * answered off the transcript. The pending entry lands in the ring at once so the client bubble
     * can show the question with a spinner; the answer or error fills in when the control response
     * arrives. Fire and forget: the command returns before Claude answers.
     */
    /**
     * The live process behind a dsh session, whichever mount spawned it. The registry is shared by
     * every instance and keyed by provider, and `/btw` is registered once, on the main mount: a
     * session on an SSH box lives under that box's provider id, so the main mount's own key misses it.
     */
    /** The instance whose aside ring the route and the bubble read: the main mount, else this one. */
    asideOwner(): ClaudeCodeAdapter;
    /**
     * The session's live process, spawned again with `--resume` from its last turn's options when
     * the idle eviction (or a crash) took it, so a side question does not need a turn first. No
     * prompt is written: the process waits on stdin like any settled one. Undefined when this
     * mount never ran a turn for the session since dsh started, when a turn is running (the live
     * process answers then), or when the spawn fails; the failure is logged.
     */
    revive(sessionId: string): Promise<ClaudeProcess | undefined>;
    /** The live process for a session, by exact registry key, else by the `:sessionId` suffix so a session survives across mounts; undefined when none is alive. */
    processFor(sessionId: string): ClaudeProcess | undefined;
    /**
     * The mount holding a live process for this session, or undefined. The cheap half of
     * `ownerFor`: a map walk, no session read. For a poll that only reports on a live process (the
     * steer card, once a second per open session) it is the whole answer, and it spares the event-log
     * snapshot `ownerFor` falls back to for a session with nothing running.
     */
    ownerIfLive(sessionId: string): ClaudeCodeAdapter | undefined;
    /**
     * The mount a session belongs to: the one whose live process it is, else the one its selected
     * model names, else this one.
     *
     * The panel's routes are registered once, by the default mount, but a session on an SSH box's
     * model runs under that box's instance. A control request written from the wrong instance is
     * never answered. `resolveControl` only knows the waiters of the adapter whose stream loop reads
     * that process, so every route that asks a session's process something has to be dispatched
     * here first, or the panel reports "no live Claude process" for a session that has one.
     */
    ownerFor(sessionId: string): ClaudeCodeAdapter;
    /** Record a side question in the session's aside ring (evicting the oldest session when the ring is full) and send it to the CLI through the mount that owns the process; the answer or error is written back onto the ring. A blank `question` with a `quote` asks Claude to explain the passage; the ring keeps the blank. */
    askSideQuestion(sessionId: string, question: string, context?: string, quote?: string): void;
    /** Save (or clear, when the text is blank) an opening prompt for a session or for `default`. */
    setStarter(key: string, text: string | undefined): void;
    /** Persist a session's aside ring to disk so an answer survives a restart, eviction or hot reload. */
    persistAsides(sessionId: string): void;
    /** Inline tool text unless the Settings switch, or failing that the config, asks for rows. */
    toolsInline(): boolean;
    /**
     * Whether rows are the default on this dsh, when neither the Settings switch nor the config says.
     * True once the probe has passed: the text streams live between dsh's cards and the announced
     * rows survive a reload, so the plugin looks like every other provider in dsh. False until the
     * probe answers, so the first turns of a process never write rows a dsh cannot load. A
     * dsh that starts refusing the shape locks the probe and this falls back to inline on its own.
     */
    private rowsByDefault;
    /** What the Settings switch shows: the mode in force, and whether rows are open to it at all. */
    toolModeInfo(): Promise<ToolModeInfo>;
    /** Set the mode on every mount at once, so a session on a box's model follows the same switch. */
    setToolMode(mode: ToolMode): Promise<ToolModeInfo>;
    /** The terminal-sync flag for the info route, surfaced to the panel's status line. */
    terminalSyncInfo(): {
        enabled: boolean;
    };
    /** Turn terminal sync on or off for every mount. Off stops each mount's watchers and drops any
     *  queued mirror; on lets the next sweep pick loaded sessions back up. */
    setTerminalSync(enabled: boolean): Promise<{
        enabled: boolean;
    }>;
    /** What the /tune thinking selector shows: the budget this plugin last set for the session, or
     *  `undefined` when it has set none and the session runs on its own default. */
    thinkingInfo(sessionId: string): {
        tokens: number | null | undefined;
    };
    /**
     * Set a session's live thinking budget with a `set_max_thinking_tokens` control request: null keeps
     * the session default, 0 turns extended thinking off, any positive integer caps it. The CLI reads
     * stdin during a turn; between turns the line is queued and answered when the next turn opens. The
     * value is stored only after the process accepts it, since a dead process cannot apply it.
     */
    setThinkingBudget(sessionId: string, tokens: number | null): Promise<{
        ok: boolean;
        tokens: number | null;
        live: boolean;
        error?: string;
    }>;
    /** Register the /btw command that asks Claude a quick side question without interrupting the turn; a no-op once that command is already bridged. */
    registerAsideCommand(commands: NonNullable<PluginContext["commands"]>): void;
    /** Two boots closer than this are a crash loop, not a restart. */
    static readonly BOOT_BACKOFF_MS = 60000;
    /**
     * After a dsh restart, sessions that had a turn running get a prompt to continue, so the user
     * does not have to come back and poke each one. Sessions with a live (adopted) process are a
     * hot reload, not a restart, and are left alone.
     */
    resumeInterrupted(path?: string): Promise<string[] | undefined>;
    /** Node's spawn, or dsh's subprocess seam when configured and mounted. */
    /** Where a session's keeper lives: one directory per provider id and dsh session. */
    keeperDir(sessionId: string): string;
    /**
     * What this instance adds to a local Claude's environment: its config dir when it has one, and
     * this box's panel login as CLAUDE_CODE_OAUTH_TOKEN for the default instance. A second instance
     * keeps its own login, which is what a second instance is for.
     */
    localEnvOverride(firstParty?: boolean): Record<string, string> | undefined;
    /** The child env a keeper hands Claude: dsh's environment plus the plugin's additions. */
    keeperEnv(firstParty?: boolean): Record<string, string>;
    /** Spawner for one session: keeper mode needs the session to place and name the keeper. */
    spawnerFor(sessionId: string | undefined, spec: ClaudeProcessSpec): Spawner;
    /**
     * Start the far `claude` in a hold on `host` (see hold.ts) and attach to it. The record is what a
     * restart reattaches from, so it is written before the first byte is read; a failed start ends the
     * handle through its stderr and exit, as a local spawn error would.
     */
    holdOn(host: string, cwd: string, sessionId: string, spec: ClaudeProcessSpec, command: string, args: string[]): SubprocessHandle;
    /** Attach to a hold and keep its record's offset current (at most once a second). */
    attachHold(run: ReturnType<typeof sshRunner>, record: HoldRecord): SubprocessHandle;
    /**
     * At boot, reattach to the holds this instance left on SSH boxes. A hold whose cli has ended
     * delivers its exit line at once and drops itself; one still running is registered like an
     * adopted keeper, with the same wake and bridge reconnect.
     */
    adoptHolds(): Promise<void>;
    /**
     * At boot, reattach to keepers whose Claude process is still alive (a dsh restart left them
     * running) and register them as this instance's processes. One with output waiting gets a
     * drain turn so what Claude did during the gap shows up without anyone typing.
     */
    adoptKeepers(): Promise<void>;
    /** Every 2 s for a minute: a reply waiting in an adopted process's queue opens a dsh turn. */
    drainAdopted(proc: ClaudeProcess, sessionId: string, everyMs?: number, tries?: number): Promise<void>;
    /**
     * After a reattach, the surviving Claude still holds an MCP session against the previous dsh's
     * bridge. `mcp_reconnect` for the `dsh` server makes it open a fresh one; without it the first
     * dsh tool call after a restart can fail once. No bridge mounted (non-default instance, or the
     * bridge not up yet) means nothing to reconnect to. Retries every retryMs for attempts tries, since the web server listens several seconds after adoption.
     */
    reconnectBridge(proc: ClaudeProcess, sessionId: string, retryMs?: number, attempts?: number): Promise<boolean>;
    /** A stale bridge gets one more reconnect, at a turn boundary, when dsh does have the agent. */
    reconnectIfStale(proc: ClaudeProcess, sessionId: string): Promise<void>;
    /** The box a session's turn runs on (an SSH box, or a remote workspace's host), or undefined for a
     * local turn. Mirrors prepare()'s targetHost so a logged-out error names the right machine: a
     * purpose one-shot (title/compaction) always runs on the local claude for the default provider. */
    hostLabelFor(sessionId: string | undefined, purpose?: string): string | undefined;
    /** The function that spawns a session's claude: over SSH for an ssh box, over SSH on the box for a remote-workspace cwd, else the local seam or node spawner with this box's login. */
    spawner(firstParty?: boolean): Spawner;
    /** Kill this instance's live processes and drop them from the shared registry: called when an SSH
     * box is removed from the panel, so its remote `claude` sessions do not outlive the mount. */
    disposeProcesses(): void;
    /** The stream entry point: answer a session-title request directly, run a one-shot when there is no resume path, otherwise delegate to the persistent turn loop. */
    stream(options: GenerateOptions): AsyncGenerator<StreamChunk>;
    /** Reuse the session's process when its spec still matches; otherwise replace it. */
    acquire(options: SessionOptions, forceFresh?: boolean): Promise<{
        prep: TurnPrep;
        proc: null;
    } | {
        prep: TurnPrep;
        proc: ClaudeProcess;
    }>;
    /**
     * Start a handle on a CLI process that is already running from the totals its last recorded turn
     * reported. The process kept counting while dsh restarted; a handle that starts from zero reads
     * its next result, the session so far, as one turn. A session with turns on record but none
     * carrying totals (written before they were kept) is marked unknown instead. Settles once the
     * stored records are loaded, not on return.
     */
    private carryTotals;
    /**
     * Start a newly spawned, resumed process from the totals the CLI reads back: the transcript's
     * last `cost-state` row (see `costStateOf`). Until that is read, and on an SSH box always, the
     * last recorded turn's totals stand in, which is the same figure whenever the previous process
     * exited cleanly. Never throws. The caller awaits it before the process is handed a prompt.
     */
    private seedTotals;
    /** Where a session's Claude transcript is: on this box under `claudeHome`, or on the SSH box the
     *  turn runs on under that account's `~/.claude`, at the cwd the box really uses. Undefined
     *  without a Claude id or when the box's home cannot be read. */
    transcriptLocation(cwd: string, id: string | undefined): Promise<{
        box: FsBox;
        path: string;
    } | undefined>;
    /** Put every loaded session this instance has run under watch, and poll the ones already
     *  watched, so a session that sits in a tab is followed without having spoken in dsh since dsh
     *  started. The record a turn's end saved says which instance ran it: only that one watches, since
     *  the mirror turns it opens are recognised by that instance alone. A session with no record yet
     *  is watched from its first turn's end. The list is in memory; a watched session costs one
     *  `stat` per sweep, on an SSH box over the shared connection, which is how a box is followed at
     *  all, there being no inotify across ssh. */
    watchLoadedSessions(): Promise<void>;
    /** One sweep's look at a watched transcript: scan when it grew past the baseline. This is the
     *  only way a remote one is read, and for a local one it catches what inotify could not deliver
     *  (a scan that stood down because the session was archived). */
    pollTranscript(sessionId: string): Promise<void>;
    /** Watch the session's transcript from the end of this turn on, so a terminal that picks the
     *  session up (`claude /resume`) is noticed while dsh sits idle. One watcher per session; the
     *  baseline moves only by scans. */
    watchTranscript(sessionId: string, cwd: string, claudeId: string | undefined): Promise<void>;
    /** Byte offset where the newest foreign exchange begins (its prompt), or the end of the file when
     *  the tail holds no foreign prompt. Reading from here re-scans the latest exchange, which is how
     *  opening a session catches its tab up to the latest. */
    latestExchangeStart(box: FsBox, path: string, size: number): Promise<number>;
    /** The text of the last few assistant messages the dsh log holds, joined, so a mirror candidate
     *  whose signature is already in it is not shown twice. Only the tail is read: a re-shown exchange
     *  is always among the most recent, and scanning the whole log on every scan would not scale. */
    dshRecentText(sessionId: string): string;
    /** The transcript settled after a write: read what landed past the baseline, and when a terminal
     *  finished a turn there, mark the live process stale and open a turn that shows the exchange.
     *  Measured 2026-09-10 on 2.1.268: `--resume` follows the chain the last row belongs to and drops
     *  the other, so once dsh respawns behind a terminal turn its own rows extend that chain; a
     *  terminal that keeps typing forks again, and the next dsh turn takes that fork as the truth. */
    scanTranscript(sessionId: string): Promise<void>;
    /** Scan a session's transcript once for new child turns and mirror them; while a turn streams, only wake the render until the exchange settles instead of re-posting what the render already showed. */
    scanOnce(sessionId: string, w: TranscriptWatch): Promise<void>;
    /** Open one dsh turn that streams a still-running terminal exchange live: the prompt goes out as a
     *  user message through the followup seam, and the turn loop's `streamMirror` fills its reply as
     *  the transcript grows. One stream per session; the running exchange begins at `w.seen`. */
    openStream(sessionId: string, w: TranscriptWatch): Promise<void>;
    /** The reply half of a streamed mirror turn: re-read the exchange, render its blocks, yield the
     *  ones past what has been shown, then wait for a scan to wake it. Ends when the exchange settles
     *  (`done`, set by `scanOnce`) or the hung-turn guard fires. */
    streamMirror(sessionId: string, stream: StreamState): AsyncGenerator<StreamChunk>;
    /** Whether dsh's workspace registry lists the session as archived; false when there is no such
     *  service, so a dsh without one behaves as before. Read through `ctx.get`: the service is not in
     *  `inject`, and a direct property read would throw. */
    isArchived(sessionId: string): boolean;
    /** Open the next mirror turn of a session: one terminal exchange, its prompt as a user message of
     *  its own through the followup seam the wake uses, answered by the turn loop with the reply the
     *  terminal got. One at a time, so each turn is one prompt and one reply; the loop's `finally`
     *  pumps the next. While a turn runs, the exchange waits for that `finally`. */
    pumpMirror(sessionId: string): Promise<void>;
    /** The session's Agent, live or resumed the way a typed prompt resumes it; undefined with a note
     *  in resume.log when neither is possible. */
    agentFor(sessionId: string): Promise<{
        agent: Agent;
        how: string;
    } | undefined>;
    /** Drop processes idle past processIdleMs, then keep the live count under maxProcesses by
     *  killing the longest-idle ones that are not mid-turn. Called before each spawn. */
    /** Live processes belonging to this mount; the registry is shared across mounts. */
    ownProcessCount(): number;
    /**
     * Forget everything this adapter remembers about one session, called wherever its process is
     * dropped. Each of these maps used to grow for the life of the process: a session id was added
     * and never removed, so a box that opens a few hundred sessions a week carried every one of them
     * until dsh restarted. Nothing was ever read wrongly, because a dsh session id is not reused, so
     * the cost was memory alone; it is still a leak, and a one-line forget is cheaper than a comment
     * admitting it. `liveTurn` and the idle watchdog are deliberately absent: both are cleared by
     * the turn that owns them, and clearing them from here could drop a turn that is still running.
     */
    forgetSession(sessionId: string): void;
    /** The session id inside a registry key this adapter owns. */
    private ownSessionId;
    /** Kill this adapter's own settled processes that have been idle past the threshold and forget their sessions, leaving the rest sorted last-used so an eviction can pick the oldest. */
    evict(): void;
    /**
     * How this dsh request continues the session's Claude process, if at all:
     * - `relay`: parked on relayed tool call(s) and dsh brought every result: answer them, keep going.
     * - `steer`: parked after a live steer reached Claude mid-turn, or everything dsh delivers now was
     *   already forwarded and the CLI answered it as a turn of its own: keep translating, write nothing
     *   new (or only the messages Claude has not seen).
     * - `abandon`: parked on relays but dsh moved on without their results: reject them, start over.
     * - `prompt`: a normal turn; steers Claude already got live are dropped from the prompt.
     */
    continuationFor(options: SessionOptions, forceFresh?: boolean): Continuation;
    /** Write one mid-turn message to the CLI's stdin whole, marking it sent on a good write so no
     *  later delivery repeats it; `uuid` names the line for `cancel_async_message`. Answers whether
     *  it was written: false for a message with neither text nor image, and for a dead process. */
    private writeSteerMessage;
    /** A copy of a mid-turn message with each file block replaced by the `[File …]` text dsh would
     *  send for it, so the message can go over stdin before dsh assembles a request. Undefined when
     *  it cannot: a file on a dsh without `fileRequestText`, or an image with no attachment store to
     *  load it from; that message waits for the boundary instead. */
    private withFileHandles;
    /** First write of a turn: relay results, unsent steers, or the prompt itself. */
    openTurn(cont: Continuation, proc: ClaudeProcess, prep: TurnPrep): Promise<void>;
    /**
     * Arm the idle watchdog for a stream: `proc` is killed after `timeoutMs` of silence, which
     * defaults to the configured one. Every event re-arms. Shortly before the kill (60 s, or half the
     * timeout when it is under 120 s) a warning event is queued on the process so the turn loop draws
     * a countdown row; `warn: false` skips that for the aux stream, whose loop has no reasoning lane.
     */
    armIdle(key: string, proc: IdleTarget, warn?: boolean, timeoutMs?: number): void;
    /** Stop the watchdog for a stream: the turn ended, or a tool is running and silence is expected. */
    clearIdle(key: string): void;
    /** Push a stream's deadline out by one full timeout; false when nothing is armed under `key`. */
    extendIdle(key: string): boolean;
    /** Take a flag the target's CLI rejected out of every later spawn for that binary. True when this
     * is the first refusal of that flag, which is the only time a retry can help: the box the turn
     * ran on is the one whose probe was wrong, so the denial is recorded against that box. */
    dropRejectedFlag(proc: ClaudeProcess, options: SessionOptions): boolean;
    /** Why a turn that neither finished nor parked ended. */
    endReason(proc: ClaudeProcess, options: SessionOptions, idle: boolean): FinishReason;
    /** The persistent turn loop: drive one session's turn end to end. Stream the chunks, relay
     * tool calls, honor interrupts and usage limits, and yield the finish. */
    turn(options: SessionOptions, forceFresh?: boolean): AsyncGenerator<StreamChunk>;
    /** dsh's todo projection resets to null on every `turn/start`, so the panel empties each message.
     *  Called at the top of an open turn (dsh's invariant rejects a `todo/write` outside one), this
     *  re-appends the last todo list so it persists across messages and, because it reads persisted
     *  session events, across a restart too. Source-agnostic: works for dsh's own todo tool.
     *  Scans from the tail and stops at the newest list, so a long session pays a few events, not all. */
    restoreTodos(sessionId: string): void;
    /** A usage limit ended the session's turn: once it resets (plus a grace), drop the continue
     *  notice through the same path a restart uses. Persisted so a restart re-arms it. */
    armLimitWait(sessionId: string, resetAt: number, atLeastMs?: number): void;
    /** The wait fired. Two things may have changed meanwhile: the session may have been rerouted
     *  to another provider (then the notice would reach a model the limit never touched), and the
     *  account may still be capped (another window, another login, a moved reset). Check both
     *  before the notice goes out; a probe that cannot answer lets the wake try. Extra usage turned
     *  on meanwhile needs no detection: a prompt cancels the wait, and once Claude runs, its own
     *  rate_limit_event says whether credits cover the overflow. */
    continueAfterLimit(sessionId: string, probe?: typeof readUsage): Promise<void>;
    /** The provider a session runs on, resolved the way dsh's session controller does: the newest
     *  pick in its log, else the provider its last request ran on, else the box's default model.
     *  Undefined when the session cannot be read; the default is not guessed then, because
     *  `continueAfterLimit` would drop every limit notice on a dsh without the read. The log read is
     *  deprecated in dsh 0.1.6, and a dsh that drops it would answer undefined for every session,
     *  which routes remote workspaces to the local mount instead of failing. Too quiet to debug from
     *  the symptom, so it says so once. */
    sessionProvider(sessionId: string): string | undefined;
    /** Cancel and forget a session's limit-wait timer, if any, so a usage reset does not fire it twice. */
    clearLimitWait(sessionId: string): void;
    /** Claude finished a turn of its own (a background task it launched completed) while dsh was
     *  idle. Drop a notice into the session's inbox so dsh opens a turn now and the reply shows,
     *  instead of riding on top of the user's next prompt. */
    wake(sessionId: string, proc: ClaudeProcess | undefined, text?: string): Promise<boolean>;
    /** Offer a dsh tool call from the MCP bridge to the session's live turn. Undefined when no turn
     *  can take it (idle process, a relay already pending); the bridge then executes it directly. */
    relay(sessionId: string, toolName: string, args: Record<string, JsonValue>, signal: AbortSignal): Promise<RelayResult> | undefined;
    /** Answer a CLI control request. Permission prompts and questions become dsh dialogs; the answer is written back on stdin. */
    handleControl(event: ControlRequestEvent, options: SessionOptions, prep: TurnPrep, proc: ClaudeProcess, pending: Map<string, AbortController>, tr: Translator): AsyncGenerator<StreamChunk, void, unknown>;
    /**
     * An MCP server's elicitation, shown through dsh's question UI: one question per top-level
     * schema property, the answers sent back as the accept content. A `url` mode (the server wants
     * a browser) and a schema dsh cannot present are declined with a reasoning line saying so.
     */
    elicit(request: NonNullable<ControlRequestEvent["request"]>, requestId: string, options: SessionOptions, proc: ClaudeProcess, pending: Map<string, AbortController>, tr: Translator): AsyncGenerator<StreamChunk, void, unknown>;
    /** Answer one of Claude's tool permission requests. AskUserQuestion and ExitPlanMode go to dsh's
     *  question dialog, full access allows everything else, and the rest go to dsh's approval
     *  prompt. A dialog that cannot be shown, or is cancelled, answers deny with the reason. */
    decide({ toolName, input, request, toolUseId, agent, signal, accessMode }: Decision): Promise<{
        behavior: "allow";
        updatedInput: unknown;
        toolUseID: string;
        decisionClassification: "user_temporary";
    } | {
        behavior: "deny";
        message: string;
        toolUseID: string;
        decisionClassification: "user_reject";
    }>;
    /** Run one request on a fresh CLI process that exits after its answer, for side calls such as a
     *  session title. No tool activity is shown, and a permission or control request is refused
     *  rather than asked, since nobody is watching a side call. */
    oneShot(options: GenerateOptions): AsyncGenerator<StreamChunk>;
}
