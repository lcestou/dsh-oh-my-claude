// dsh LLM adapter that drives the Claude Code CLI (`claude -p --input-format stream-json --output-format stream-json`).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { numberOf } from "./plugins.js";
import { LlmAdapter, LlmError, boundContextSummary, createToolResultMessage, createUserMessage, } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { atLeast } from "./update.js";
import { probeFirstParty, wantsFirstParty } from "./first-party.js";
import { CONTEXT_SIZE_KEYS, contextDrops, sourceBlockOf, } from "./context-sources.js";
import { accountIdentity, forgetIdentity, readHints, readPickerSettings, readSshBoxes, registerSessionRoutes, sshBoxProviderId, } from "./sessions.js";
import { hub } from "./events.js";
import { readUsage, registerUsageRoute, stillLimitedUntil } from "./usage.js";
import { KEY_HEADER, MCP_PATH, registerMcpBridge } from "./mcp.js";
import { ClaudeProcess, allowResult, answersFor, controlErrorLine, controlResponseLine, denyResult, parseQuestions, permissionReason, userTurnLine, interruptLine, controlRequestLine, decodeRewindResult, decodeCancelled, decodeContextUsage, turnDelta, decodeWorkspaceDiff, decodePermissionRules, decodeHooksListing, decodeMcpStatus, mcpAuthUrl, mcpAuthNeedsNothing, decodeCliModels, elicitationQuestions, elicitationResult, decodeTitle, toJsonValue, nodeSpawner, seamSpawner, sshSpawner, sshArgs, shq, attachKeeper, launchKeeper, lazyHandle, pidAlive, readKeeperInfo, readKeeperSpec, spawnKeeper, } from "./process.js";
import { ADAPTER_CURRENT, COMMAND_CATALOG, PERMISSION_MODE_OVERRIDES, RESUME_TIMER, WATCH_SWEEP, PROCESS_REGISTRY, TEMPORARY_SESSIONS, TURN_RECORDS, asSessionId, } from "./dsh.js";
import { authHeaders, auxCwd, buildRedactor, CLAUDE_HOME, hasPendingNotice, loadAsides, saveAsides, loadStarters, saveStarter, loadStarted, isPermissionMode, loadPermissionModes, loadToolMode, saveToolMode, lastSelectedProvider, loadLimitWaits, loadTurnRecords, saveLimitWait, markBusy, modesUpTo, noteBoot, PERMISSION_MODES, loadCommandCatalog, rememberStarted, resolveClaudeHome, saveCommandCatalog, savePermissionMode, saveTurnRecords, STATE_DIR, stateDir, takeInterrupted, trace, loadWatches, saveWatch, loadTerminalSync, saveTerminalSync, saveContextSizes, saveWorkspaceModel, } from "./state.js";
import { suggestRule } from "./permissions.js";
import { currentLogVersion, probeRawToolRows, } from "./rows-probe.js";
import { readSshToken, THIS_BOX } from "./ssh-login.js";
import { CHILD_ENV, childEnv, errorText, resolveCommand } from "./process.js";
import { bindServerLocale, serverText } from "./locale.js";
import { assistantMessageText, foreignTurns, mirrorReply, mirrorReplyBlocks, alreadyShown, } from "./transcript.js";
import { copyToAt, homeAt, readFromAt, sizeAt } from "./remote-fs.js";
import { READY as READY_MARK, asHoldRecord, holdCleanScript, holdHandle, holdName, holdStartScript, sshRunner, } from "./hold.js";
import { dropHold, loadHolds, saveHold } from "./state.js";
import { knownRefusal } from "./session-repair.js";
import { healLog, rawLogPath } from "./session-heal.js";
import { forkTranscriptText } from "./transcript.js";
import { buildMirror } from "./claude-home.js";
export { markBusy, takeInterrupted } from "./state.js";
export { forkTranscriptText } from "./transcript.js";
import { anthropicStatus, degradedNote, peekStatus } from "./anthropic-status.js";
import { Translator } from "./translator.js";
export { Translator } from "./translator.js";
import { versionOf } from "./report.js";
// dsh's own version for the bug report, read off the package this plugin is loaded beside.
// Unknown when the plugin runs from a checkout without dsh's tree in reach.
const DSH_VERSION = (() => {
    try {
        return versionOf(createRequire(import.meta.url)("@deepseek-ai/dsh-llm/package.json"));
    }
    catch {
        return null;
    }
})();
/** Live placeholder→remote map for remote workspaces, shared by every box's ssh spawner. Loaded at
 * boot and replaced whenever the panel edits the list, so a redirect applies without a dsh restart. */
let remoteWorkspaces = [];
/** Replace the redirect map: the boot read and every panel edit land here. Exported so the offline
 * suite can drive the two lookups below without a dsh mount. */
export function setRemoteWorkspaces(workspaces) {
    remoteWorkspaces = workspaces;
    remoteWorkspacesKnown = true;
}
/** Whether the map above has been fed at all: before the routes' first read lands, an empty map
 *  means "not read yet", not "no remote workspaces". */
let remoteWorkspacesKnown = false;
/** Where every remote workspace's stand-in folder lives. */
const STAND_INS = join(STATE_DIR, "remote-workspaces");
/**
 * Whether `cwd` is the stand-in of a remote workspace that no longer exists. Removing a box, or
 * deleting the workspace, drops its row and its stand-in folder, but dsh keeps the sessions and
 * lists them under Ungrouped with the stand-in as their cwd. A turn there has no box to run on:
 * spawned here it died on a missing directory as "claude exited -1: no output" (seen live
 * 2026-09-17), and on an ssh box's own provider it would have run in the far `$HOME` instead.
 */
export const isOrphanedStandIn = (cwd) => remoteWorkspacesKnown && cwd.startsWith(`${STAND_INS}/`) && remoteWorkspaceFor(cwd) === undefined;
/** The real remote path for a placeholder workspace on `host`, or `cwd` unchanged. */
export function remoteCwdFor(host, cwd) {
    return remoteWorkspaces.find((w) => w.host === host && w.path === cwd)?.remoteCwd ?? cwd;
}
/** The box a turn runs on: this instance's own host when it has one, else the box a remote-workspace
 * cwd belongs to. The choice is by truthiness because `sshHost` defaults to `""`, not undefined.
 * `??` treats that empty string as an answer, which is how a local provider's turn came to probe the
 * local binary for flags while its spawn ran on the box (2026-09-09: `--forward-subagent-text`, a
 * flag this box's CLI has and the box's 2.1.123 does not). */
export const boxFor = (sshHost, workspaceHost) => sshHost || workspaceHost || undefined;
/** The remote workspace whose local placeholder is `cwd`, if any. A session opened on this cwd must
 * run over SSH on that box regardless of the provider chosen, so a local provider does not sit in the
 * empty placeholder dir. */
export function remoteWorkspaceFor(cwd) {
    return remoteWorkspaces.find((w) => w.path === cwd);
}
/** Whether a step's end keeps the status row's live figures: only when the step parked the CLI
 *  mid-turn (on a dsh tool dsh is running, or on a steer), since dsh calls back within the same
 *  turn. Every other outcome is the turn ending. */
export const keepsLiveTurn = (outcome) => outcome === "relayed" || outcome === "parked";
/** A live process always carries the prep it was spawned with; acquire() sets it before use. */
/** A process parked on a relayed tool call or a steer is mid-turn, not idle. */
const isSettled = (p) => !p.busy && p.relays.size === 0 && !p.parked;
/** Throw rather than return a null prep: a process is assumed to carry the turn state acquire() set, so a missing one means it was used out of order. */
function requirePrep(proc) {
    if (!proc.prep)
        throw new LlmError("claude process has no turn state", "PROVIDER_ERROR");
    return proc.prep;
}
/** Plugin name identifier. */
export const name = "dsh-oh-my-claude";
/** Services injected into the plugin by the dsh runtime. */
export const inject = ["llm", "sessions", "attachments", "agents", "approval", "userQuestions"];
/** Configuration schema for Claude Code plugin settings. */
export const Config = z.object({
    command: z
        .string()
        .default("claude")
        .description("Claude Code binary: a name on PATH or an absolute path"),
    spawn: z
        .union(["keeper", "node", "dsh"])
        .default("keeper")
        .description("How the Claude Code process is started. 'keeper' (default): under a small keeper outside dsh's process tree (its own systemd user scope when available), so a dsh restart leaves Claude running and the new dsh reattaches. 'node': directly, as dsh's child. 'dsh': through dsh's subprocess seam (ctx.subprocess); with a remote provider mounted on that seam, a remote workspace then runs Claude Code on that machine. The seam scrubs credential-shaped env vars (KEY/TOKEN/SECRET/PASSWORD), so log in on the machine that runs it"),
    sshHost: z
        .string()
        .default("")
        .description("Run this instance's Claude Code on a remote host over SSH (e.g. 'user@box' or an ssh_config alias). Empty = local. This box's harness drives the far `claude` with `ssh -o BatchMode=yes`; nothing runs on the remote but the CLI, using the remote's own ~/.claude login. Needs a working SSH key to the host. With spawn: keeper (the default) the far claude is held in a session of its own on the box, so a dsh restart here reattaches to it; the dsh MCP bridge does not reach the remote"),
    permissionMode: z
        .union(["dsh", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto", "manual"])
        .default("dsh")
        .description("Claude Code permission mode for tools the child runs on its own. 'dsh' follows the session's access mode switch: read-only → plan, workspace-write → acceptEdits, danger-full-access → bypassPermissions"),
    allowedTools: z.array(z.string()).default([]).description("Extra --allowedTools entries"),
    disallowedTools: z.array(z.string()).default([]).description("--disallowedTools entries"),
    addDirs: z.array(z.string()).default([]).description("Extra --add-dir directories"),
    pluginDirs: z
        .array(z.string())
        .default([])
        .description("Load an uninstalled local plugin for this session only: each becomes --plugin-dir <path> (a directory or a .zip). A path the CLI's LocalPluginDirsAllowedByPolicy blocks is refused by the CLI at spawn"),
    pluginUrls: z
        .array(z.string())
        .default([])
        .description("Fetch a plugin .zip from a URL for this session only: each becomes --plugin-url <url>"),
    maxTurns: z
        .number()
        .step(1)
        .min(1)
        .description("--max-turns cap per request; unset = CLI default"),
    maxBudgetUsd: z.number().min(0).description("--max-budget-usd per request; unset = no cap"),
    titleModel: z.string().default("haiku").description("Model for session-title requests"),
    toolActivity: z
        .boolean()
        .default(true)
        .description("Show Claude Code tool calls and results as native tool rows"),
    toolsInline: z
        .boolean()
        .description("Render tool calls as inline text (true) or as dsh's native tool rows (false). Unset: rows on dsh 0.1.7 and later, where the text streams live between the cards and the rows survive a reload; inline before that. The switch in Settings > Oh My Claude overrides this per box."),
    hookRows: z
        .boolean()
        .default(true)
        .description("Show Claude Code hook starts and results as reasoning lines (adds --include-hook-events)"),
    resume: z
        .boolean()
        .default(true)
        .description("Keep one Claude Code session per dsh session via --session-id/--resume"),
    idleTimeoutMs: z
        .number()
        .step(1)
        .min(1000)
        .default(1_800_000)
        .description("Kill the child when no stream event arrives for this long (a running tool emits nothing until it ends)"),
    toolTextLimit: z
        .number()
        .step(1)
        .min(100)
        .default(600)
        .description("Characters of tool arguments/results shown in the activity blocks"),
    dshTools: z
        .boolean()
        .default(true)
        .description("Expose dsh tools (subagents, jobs, skills...) to Claude Code over MCP"),
    fastMode: z
        .boolean()
        .default(false)
        .description("Launch each Claude process with fast mode enabled (--settings fastMode); the bridged /fast then toggles it per session"),
    commandBridge: z
        .boolean()
        .default(true)
        .description("Register Claude Code's slash commands (skills, custom commands) as dsh /commands that send the line to Claude"),
    redactSecrets: z
        .boolean()
        .default(true)
        .description("Mask values of env vars named *KEY, *TOKEN, *SECRET, *PASSWORD or *CREDENTIAL in Claude's tool results before they reach dsh"),
    persistTodos: z
        .boolean()
        .default(true)
        .description("Keep the todo list on screen across messages and resume (dsh clears it each turn by default)"),
    continueAfterLimit: z
        .boolean()
        .default(true)
        .description("When a usage limit ends a turn, wait for the reset and continue the task on its own, as the CLI does"),
    debug: z.boolean().default(false).description("Log spawn arguments (minus the prompt) per call"),
    approvals: z
        .boolean()
        .default(true)
        .description("Route Claude Code permission prompts and AskUserQuestion to dsh dialogs (--permission-prompt-tool stdio)"),
    processIdleMs: z
        .number()
        .step(1)
        .min(10_000)
        .default(30 * 60 * 1000)
        .description("Kill a session's idle Claude Code process after this long without a turn"),
    maxProcesses: z
        .number()
        .step(1)
        .min(1)
        .default(4)
        .description("Cap on live Claude Code processes; the longest-idle one is evicted first"),
    configDir: z
        .string()
        .default("")
        .description("Claude Code config dir for this plugin instance (exported as CLAUDE_CONFIG_DIR); empty = CLAUDE_CONFIG_DIR env or ~/.claude"),
    ownTranscripts: z
        .boolean()
        .default(false)
        .description("Keep this instance's transcripts in the plugin's own state dir instead of ~/.claude/projects; the CLI runs against a config dir whose login, settings, commands and skills are symlinks back to the real one"),
    providerId: z
        .string()
        .default("claude-code")
        .description("Provider id; 'claude-code' is the default, anything starting with 'claude-code-' mounts a second instance"),
    providerName: z
        .string()
        .default("")
        .description("Display name for this instance in the model picker; empty = 'Oh My Claude' for the default id, else 'Oh My Claude (<suffix>)'"),
});
/** The text dsh's title provider sends: its one framed user message, joined when there are more. */
function titleInput(messages) {
    const parts = [];
    for (const m of messages)
        for (const b of m.content)
            if (b.type === "text" && b.text)
                parts.push(b.text);
    return parts.join("\n").trim();
}
/** What the steer card's route answers. `sent`: Claude already has it (or it was never waiting);
 *  `gone`: no live process; `error`: the CLI did not answer the cancel. */
/** Whether the CLI is inside a dsh tool right now: a live process with a relay pending. Reads the
 *  relay map as optional because the test fakes build processes field by field, and the ones that
 *  never relay carry no map. */
const inRelay = (proc) => proc?.alive === true && (proc.relays?.size ?? 0) > 0;
/** How long a hold waits for a poll before it goes back to Claude unchanged. The card polls every
 *  3 s while its tab is visible; a minute covers a tab switch mid-edit without leaving a closed
 *  tab's message stranded for long. */
const HOLD_IDLE_MS = 60_000;
/** The CLI's `result` frame (or its absence) as a reply. Pulled out of the spawn so the mapping is
 *  unit-tested without a process: a decline keeps its text for the card to show verbatim, a missing
 *  frame is a start failure, and `partial` marks a user-skills-only fallback run. */
export function skillDoctorReply(result, partial, failure) {
    if (result === null)
        return { ok: false, error: failure };
    const report = String(result.result ?? "");
    if (result.is_error)
        return { ok: false, declined: true, error: report };
    return partial ? { ok: true, report, partial: true } : { ok: true, report };
}
/** The key every live process is stored under, `providerId` then `sessionId`; a session id must not contain a colon or it would collide with this separator. */
export function registryKey(providerId, sessionId) {
    return `${providerId}:${sessionId}`;
}
/** The CLI's effort ladder, low to high; `readPickerSettings` validates `maxEffortLevel` against it. */
export const EFFORTS_ALL = ["low", "medium", "high", "xhigh", "max"];
/** Trim an efforts list to those at or below `cap`. `"max"` and an absent cap keep everything.
 *  An id outside the ladder (a future level this build does not know) is left in, never hidden. */
function capEfforts(efforts, cap) {
    if (cap === undefined || cap === "max")
        return [...efforts];
    const ceiling = EFFORTS_ALL.indexOf(cap);
    return efforts.filter((e) => {
        const i = EFFORTS_ALL.findIndex((level) => level === e);
        return i === -1 || i <= ceiling;
    });
}
const EFFORTS_45 = ["low", "medium", "high"];
/** Build one KNOWN_MODELS row: the provider is always claude-code, so callers pass only the id, label, context window and efforts, filling description when given. */
const M = (id, label, contextWindow, efforts, description) => {
    const row = { provider: "claude-code", id, name: label, contextWindow, efforts };
    if (description !== undefined)
        row.description = description;
    return row;
};
// The floor a brand-new box falls back to when the Models API is unreachable and no catalog has
// ever been cached to disk yet. Once a fetch succeeds its result is persisted and seeds later boots,
// so this list only matters on the first offline boot. Ids are what `claude --model` accepts.
//
// The window here is the one the CLI manages a session against on a first-party login, read off
// Claude Code 2.1.274's own model table (`context:{window:1e6,native_1m:!0}` for Fable 5.1, Fable 5,
// Opus 5, Opus 4.8, Opus 4.7 and Sonnet 5; `window:200000` for the rest). Behind a proxy the CLI
// demotes every 1M row to 200,000 (`dXn`: "declared 1M, believed 200k" unless the base URL is
// api.anthropic.com or `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` is set), and `contextUsage`
// reports that as `assumedBehind`. Any figure here is a guess until a session answers;
// `liveWindows` below replaces it with what the CLI reports.
export const KNOWN_MODELS = [
    M("claude-fable-5-1", "Claude Fable 5.1", 1_000_000, EFFORTS_ALL),
    M("claude-fable-5", "Claude Fable 5", 1_000_000, EFFORTS_ALL),
    M("claude-opus-5", "Claude Opus 5", 1_000_000, EFFORTS_ALL),
    M("claude-opus-4-8", "Claude Opus 4.8", 1_000_000, EFFORTS_ALL),
    M("claude-opus-4-7", "Claude Opus 4.7", 1_000_000, EFFORTS_ALL),
    M("claude-opus-4-6", "Claude Opus 4.6", 200_000, ["low", "medium", "high", "max"]),
    M("claude-sonnet-5", "Claude Sonnet 5", 1_000_000, EFFORTS_ALL),
    M("claude-sonnet-4-6", "Claude Sonnet 4.6", 200_000, ["low", "medium", "high", "max"]),
    M("claude-opus-4-5", "Claude Opus 4.5", 200_000, EFFORTS_45),
    M("claude-sonnet-4-5", "Claude Sonnet 4.5", 200_000, []),
    M("claude-haiku-4-5", "Claude Haiku 4.5", 200_000, []),
];
/**
 * The Models API dates some ids (`claude-haiku-4-5-20251001`) and leaves others alone
 * (`claude-opus-5`), while the list above and the CLI's own picker use the undated form. The CLI
 * takes either, but dsh keys a model by its id: a lineup that spells the same model one way from
 * the API and another from this list retires the enabled one and offers a fresh unselected copy
 * every time the source changes. So an API id whose undated form is one we know is advertised
 * undated, and an id we do not know keeps whatever the API called it.
 */
export const stableModelId = (id) => {
    const bare = id.replace(/-\d{8}$/, "");
    return bare !== id && KNOWN_MODELS.some((m) => m.id === bare) ? bare : id;
};
// No default effort is advertised: `--effort` is only sent when dsh picks one, so the CLI's own default rules.
const MAX_IMAGES = 20;
/** How many recent approval requests the Tune tab offers as rules. */
const ASK_SUGGESTIONS = 10;
/** How many asked rpcIds to remember, so the dedupe set cannot grow without bound. */
const ASIDE_ASKED_KEEP = 200;
/** How many `/btw` asides a session keeps; older ones drop off the ring. */
const ASIDE_KEEP = 10;
/** How much of a selected passage the ring keeps for the card; the whole passage went to Claude. */
const ASIDE_QUOTE_KEEP = 300;
/** What Claude is asked when the selection bar's question is left blank. Claude reads it: English only. */
const SELECTION_EXPLAIN = "Explain the passage below from our conversation.";
/**
 * The side question's context for a selected passage: a lead line and the passage as a Markdown quote.
 * Kept here rather than shared with the client's `quoteMarkdown`, since server code does not import
 * from `src/client/`.
 */
export const selectionContext = (quote) => `The passage I selected in our conversation:\n\n${quote
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n")}`;
/** A side question is a full model turn, so it gets a longer wait than a control ping. */
const ASIDE_TIMEOUT_MS = 120_000;
/** Cap on how many sessions keep asides in memory; the oldest session drops when a new one arrives.
 *  The adapter has no per-session teardown hook, so this bounds the map the way the ring bounds a session. */
const ASIDE_MAX_SESSIONS = 200;
/** The two shapes a `side_question` control response can carry its answer in. */
const AsideWrapped = z.object({ response: z.string() });
const AsideBare = z.string();
/**
 * Pull the answer text out of a `side_question` control response. The CLI answers with
 * `{ response: string }` (or a bare string on some paths, or null when it declined), so both shapes
 * are parsed at this I/O boundary and blank or absent answers report as none.
 */
export function asideAnswerText(response) {
    // Schemastery passes null and undefined through rather than throwing, so `?? ""` turns a declined
    // answer (`{ response: null }`) or a missing field into the empty string, which reports as none.
    let text;
    try {
        // SAFETY: schemastery validates at runtime and throws on a wrong concrete type; the cast only
        //   widens the static input type so an arbitrary control-response value reaches the validator.
        text = AsideWrapped(response).response ?? "";
    }
    catch {
        try {
            // SAFETY: same as above, for the bare-string shape.
            text = AsideBare(response) ?? "";
        }
        catch {
            return undefined;
        }
    }
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
// ---------------------------------------------------------------------------
// Model catalog
const CATALOG_TTL_MS = 10 * 60 * 1000;
let catalog = { at: 0, models: KNOWN_MODELS };
/** Where the last catalog the API gave us is kept, so a boot with the API down still lists the real
 *  models instead of the baked-in floor. Written on every successful fetch, read once per process. */
/** Path to the on-disk catalog cache. Honors DSH_OMC_STATE_DIR so a test can aim it at an empty
 *  dir and exercise the offline floor without depending on whatever this box has cached. */
const catalogCachePath = () => join(process.env.DSH_OMC_STATE_DIR ?? STATE_DIR, "models.json");
let diskSeeded = false;
/** The shape a cached row must still hold. The cache is our own write, but a truncated or hand-edited
 *  file must never slip a malformed row into the catalog dsh validates, so it is re-parsed on read. */
const CachedCatalog = z.array(z.object({
    provider: z.const("claude-code"),
    id: z.string(),
    name: z.string(),
    contextWindow: z.number(),
    efforts: z.array(z.string()),
}));
/** Parse a persisted catalog file. Anything malformed reads as empty, so the caller falls back. */
export function parseCatalogCache(text) {
    try {
        return CachedCatalog(JSON.parse(text))
            .filter((r) => r.id.length > 0 && r.name.length > 0)
            .map((r) => M(r.id, r.name, r.contextWindow, r.efforts));
    }
    catch {
        return [];
    }
}
/** Seed the in-memory catalog from disk once, unless a live fetch has already replaced it. `at`
 *  stays 0 so the next `getCatalog` still tries the API; the disk copy only survives a failed fetch. */
async function seedFromDisk() {
    if (diskSeeded)
        return;
    diskSeeded = true;
    if (catalog.at !== 0)
        return;
    try {
        const rows = parseCatalogCache(await readFile(catalogCachePath(), "utf8"));
        if (rows.length > 0 && catalog.at === 0)
            catalog = { at: 0, models: rows };
    }
    catch {
        /* no cache yet or unreadable: the KNOWN_MODELS floor stays */
    }
}
/** Persist a fetched catalog for later boots. Best effort: a write that fails just misses the seed. */
async function persistCatalog(models) {
    try {
        const path = catalogCachePath();
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(models));
    }
    catch {
        /* read-only state dir or full disk: fall through, the fetch still served this boot */
    }
}
/** One entry of the Anthropic Models API list, in the shape the picker uses. */
export function modelFromApi(m) {
    const eff = m.capabilities?.effort;
    const efforts = eff?.supported ? EFFORTS_ALL.filter((l) => eff[l]?.supported) : [];
    const id = stableModelId(m.id ?? "");
    return M(id, m.display_name ?? id, m.max_input_tokens ?? 200_000, efforts);
}
/**
 * The CLI's own picker (`list_models`, asked of the first live process each boot) goes first:
 * its values are what `claude --model` accepts for this login, aliases such as `default` and the
 * `[1m]` variants included. API and known models it does not already cover follow, so older
 * ids stored in dsh sessions keep resolving.
 *
 * Then settings.json gets the say the terminal gives it, in the CLI's own order: `modelPicker`
 * rows are appended after that lineup, `replaceBuiltInOptions` cuts the lineup back to Default,
 * and `availableModels` filters whatever is left. Default always survives, an absent allowlist
 * filters nothing and an empty one leaves Default alone.
 */
const strip = (id) => (id.endsWith("[1m]") ? id.slice(0, -4) : id);
/** An allowlist entry and a model id meet in one shape: no `claude-` prefix, no `[1m]` suffix. */
const bareId = (id) => {
    const s = strip(id);
    return s.startsWith("claude-") ? s.slice("claude-".length) : s;
};
/**
 * The window a live session reported, which outranks every guess this file makes.
 *
 * Both sources above answer a different question than the one dsh's context ring asks. The Models
 * API sends `max_input_tokens` and `KNOWN_MODELS` is a baked-in copy of the same figure: what the
 * model can hold. What the ring needs is what the CLI manages the session against, and the two part
 * company. Opus 5 holds a million and runs at 200,000 until 1M is turned on. Only a session knows
 * which it got, so the figure is taken from that session's own `get_context_usage` and kept per
 * model id for every later read.
 *
 * Not persisted: a dsh-web restart relearns on the first context read of each model, and until then
 * the table above answers. Write it next to the catalog cache the day that gap is worth a file.
 */
const liveWindows = new Map();
/** The liveWindows key: strip any ANSI codes and resolve to the stable id, so a window looked up by the CLI's raw model id matches the normalized one stored here. */
const windowKey = (id) => stableModelId(strip(id));
/** Claude Code's env flag for "the base URL is a proxy in front of Anthropic" (`Xo()` in 2.1.274). */
const FIRST_PARTY_FLAG = "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL";
/** The base URL when it names a host the CLI does not treat as first-party, else undefined. The
 *  test is the CLI's own (`av()` in 2.1.274: `new URL(e).host` against `["api.anthropic.com"]`),
 *  `host` with its port included, so this fires exactly when the CLI demotes. */
export const proxyBaseUrl = (raw) => {
    if (!raw)
        return undefined;
    try {
        return new URL(raw).host === "api.anthropic.com" ? undefined : raw;
    }
    catch {
        return raw;
    }
};
/**
 * Whether this box's base URL reaches Anthropic, asked once per dsh process.
 *
 * On the process rather than on the adapter: dsh builds the adapter more than once at boot, and
 * the question is about the box, not about an instance. The promise is memoised, not its answer,
 * so the turns that start while the first request is in flight all wait on that one request.
 * An unanswered probe is retried by the next turn, since a proxy that was still starting up is
 * the likeliest reason for it.
 */
const FIRST_PARTY_PROBE = Symbol.for("dsh-oh-my-claude.firstPartyProbe");
/** Ask once per dsh process whether this box is first-party, memoised on globalThis (the adapter is built more than once at boot) and retried while unanswered, so a proxy still starting does not fail the turn. */
const detectFirstParty = async () => {
    const baseUrl = proxyBaseUrl(process.env.ANTHROPIC_BASE_URL);
    if (!baseUrl)
        return false; // no proxy in front: the flag changes nothing either way
    // SAFETY: this plugin's own key on globalThis, typed here once, as the timers below are
    const store = globalThis;
    const asked = (store[FIRST_PARTY_PROBE] ??= probeFirstParty(baseUrl));
    const answer = await asked;
    if (answer === undefined)
        store[FIRST_PARTY_PROBE] = undefined;
    return answer;
};
/** Record what a session answered. A missing or nonsense figure leaves the last good one standing. */
export const noteLiveWindow = (modelId, maxTokens) => {
    if (modelId === undefined || maxTokens === undefined || !Number.isFinite(maxTokens))
        return;
    if (maxTokens <= 0)
        return;
    liveWindows.set(windowKey(modelId), maxTokens);
};
/** The context window a live session last reported for this model, which beats the catalog's
 *  figure because it is what this box's CLI actually runs with (a proxy can demote a 1M model to
 *  200k). Keyed by the stable id, so an alias and its dated spelling share one answer. Undefined
 *  until some session has reported it. */
export const liveWindowFor = (modelId) => liveWindows.get(windowKey(modelId));
/** The three forms an entry takes: a family alias, a version prefix, or the whole id. */
const allows = (entry, id) => {
    const want = bareId(entry);
    const have = bareId(id);
    return have === want || have.startsWith(`${want}-`);
};
/** Merges the CLI's model rows into the catalog, giving each known model a single stable id and
 *  name so the picker offers the same lineup whether or not the CLI has yet learned the model's
 *  short spelling. */
export function mergeCatalog(cli, base, picker) {
    if (cli.length === 0 && !picker)
        return base;
    // A CLI row is keyed by an alias (`opus`, `default`), so each row carries the id the allowlist reads.
    const fromCli = cli.map((c) => {
        const bare = strip(c.resolvedModel);
        const known = base.find((b) => bare === b.id || bare.startsWith(b.id));
        const window = c.resolvedModel.endsWith("[1m]") ? 1_000_000 : (known?.contextWindow ?? 200_000);
        // The CLI is asked for its picker once a process is live, so before that answer the lineup
        // spells a model `claude-haiku-4-5` and after it `haiku`. Anything holding an id across that
        // moment, a dsh subagent allowlist or a stored session model, reads the other spelling as a
        // model that is gone. A row landing on a model this catalog already knows takes that model's
        // id, so both states offer the same ids; `default` and a `[1m]` variant have none to take.
        const stable = c.value === "default" || c.resolvedModel.endsWith("[1m]") ? undefined : known?.id;
        // The CLI names its rows for a terminal picker that shows nothing else ("Opus (1M context)",
        // "Fable", "Sonnet"), and the known rows that follow here read "Claude Opus 5"; two spellings
        // in one menu read as two lineups (owner, 2026-09-16). A row landing on a known model takes
        // that model's name, with the window named the way the CLI names it; Default keeps its own.
        const label = c.value === "default" || known === undefined
            ? c.displayName
            : `${known.name}${c.resolvedModel.endsWith("[1m]") ? " (1M context)" : ""}`;
        return {
            row: M(stable ?? c.value, label, window, c.efforts, c.description),
            match: c.resolvedModel,
        };
    });
    // A known model follows unless a CLI row already carries its exact id. A `[1m]` variant or the
    // `default` alias resolving to it keeps its own id, so it does not cover the plain one: a session
    // bound to `claude-fable-5-1` must still find that row, or the picker shows the raw id and an
    // empty menu (seen 2026-09-10, when the CLI's lineup offered only `claude-fable-5-1[1m]`).
    const emitted = new Set(fromCli.map((r) => r.row.id));
    let rows = [
        ...fromCli,
        ...base.filter((b) => !emitted.has(b.id)).map((b) => ({ row: b, match: b.id })),
    ];
    if (picker) {
        const extra = picker.options.map((o) => {
            const known = base.find((b) => allows(o.model, b.id) || allows(b.id, o.model));
            const label = o.label ?? known?.name ?? o.model;
            return {
                row: M(o.model, label, known?.contextWindow ?? 200_000, known?.efforts ?? []),
                match: o.model,
            };
        });
        if (picker.replaceBuiltInOptions)
            rows = rows.filter((r) => r.row.id === "default");
        rows = [...rows, ...extra];
        const allow = picker.availableModels;
        if (allow)
            rows = rows.filter((r) => r.row.id === "default" || allow.some((e) => allows(e, r.match)));
    }
    // Two aliases can resolve to one model, and they now share its id; the first listed wins.
    return [...new Map(rows.map((r) => [r.row.id, r.row])).values()];
}
/** Serves the model catalog from cache, fetching Anthropic's API when the cache is stale, and
 *  keeps the last good catalog on any failure so the picker never goes empty. */
export async function getCatalog(fetchImpl = fetch, cli = [], picker) {
    await seedFromDisk();
    if (Date.now() - catalog.at < CATALOG_TTL_MS)
        return mergeCatalog(cli, catalog.models, picker);
    const headers = await authHeaders(CLAUDE_HOME);
    if (headers) {
        try {
            const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=100", {
                headers: {
                    ...headers,
                    "anthropic-version": "2023-06-01",
                },
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                const data = (await res.json()).data ?? [];
                // Two dated ids can land on one undated id; the first the API lists wins.
                const mapped = data.map(modelFromApi);
                const models = [...new Map(mapped.map((m) => [m.id, m])).values()];
                if (models.length > 0) {
                    catalog = { at: Date.now(), models };
                    void persistCatalog(models);
                }
                return mergeCatalog(cli, catalog.models, picker);
            }
        }
        catch {
            /* offline or rejected: keep previous catalog */
        }
    }
    catalog = { at: Date.now(), models: catalog.models }; // retry no sooner than the TTL
    return mergeCatalog(cli, catalog.models, picker);
}
/** The provider-scoped half of a model entry; every Claude model takes text and images. */
function modelInfo(provider, model) {
    const info = {
        provider,
        id: model.id ?? "",
        name: model.name ?? "",
        inputModalities: ["text", "image"],
    };
    if (model.description !== undefined)
        info.description = model.description;
    return info;
}
/** Exact model metadata. `id` must echo the requested id: dsh-llm normalizeModelInfo rejects mismatches. */
export function resolveModelInfo(provider, modelId, models = catalog.models, cap) {
    const pool = [...models, ...KNOWN_MODELS];
    // A session stored before the ids settled asks for the dated one; it still names a model we know.
    const found = pool.find((m) => m.id === modelId) ??
        pool.find((m) => m.id.startsWith(modelId)) ??
        pool.find((m) => m.id === stableModelId(modelId));
    const info = {
        ...modelInfo(provider, { id: modelId, name: found?.name ?? modelId }),
    };
    // A session's own answer first, whatever the tables say. It is the only figure that describes the
    // window the CLI compacts on, and it is right for a model released after this build.
    const live = liveWindowFor(modelId);
    if (!found) {
        if (live !== undefined)
            info.context = { contextWindow: live };
        return info;
    }
    info.context = { contextWindow: live ?? found.contextWindow };
    const efforts = capEfforts(found.efforts, cap);
    if (efforts.length > 0) {
        info.reasoning = {
            // SAFETY: effort ids come from the CLI's own catalog; the brand marks provenance only
            efforts: efforts.map((id) => ({ id: id, name: id })),
        };
    }
    return info;
}
/** What watch.json keeps for a session: the file, the byte its settled rows end at, the box. */
function watchRecord(path, seen, box, provider, claudeId) {
    const record = { path, seen, provider, claudeId };
    if (box.sshHost)
        record.host = box.sshHost;
    return record;
}
/** Turns a dsh session id into a Claude Code–style session id so the transcript path computed from
 *  it matches the one the CLI actually wrote. */
export function claudeSessionId(sessionId) {
    const h = createHash("sha256").update(`dsh-llm-claude:${sessionId}`).digest("hex");
    const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Claude Code stores transcripts under ~/.claude/projects/<cwd with non-alphanumerics as '-'>/<id>.jsonl */
export function projectDirName(cwd) {
    return cwd.replace(/[^A-Za-z0-9]/g, "-");
}
/**
 * Whether this session has a saved transcript on disk: true when the `.jsonl` file is there,
 * false when the read fails, so a caller can skip a session that never wrote one.
 */
async function claudeSessionExists(home, cwd, id) {
    try {
        await access(join(home, "projects", projectDirName(cwd), `${id}.jsonl`));
        return true;
    }
    catch {
        return false;
    }
}
/** The browser's IANA zone as dsh stamped it on the latest user prompt; undefined when no
 *  prompt carried one (an API caller, an old log), so clocks fall back to the box's zone. */
export function clientTimeZone(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const zone = messages[i]?.source?.clientTimeZone;
        if (zone)
            return zone;
    }
    return undefined;
}
/** Join a message's text blocks on newlines, or return a string content as-is; non-text blocks (images, tool calls) are dropped and undefined content becomes empty. */
const textOf = (content) => {
    if (!Array.isArray(content))
        return content ?? "";
    return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
};
/** The key a message dsh delivered mid-step is marked under once it went over stdin: the prompt's
 *  rpcId for a typed steer, the message id for anything dsh sends on its own behalf (a child's
 *  send_message, a settlement notice, a job's finish line). Undefined for what never goes over
 *  stdin on its own: an assistant turn, a tool result. */
export const steerKey = (m) => m.role === "user" && m.source?.kind !== "tool" ? (m.source?.rpcId ?? m.id) : undefined;
/** A message the prompt builder treats as conversation: a user message that is not a tool result,
 * and every assistant message. Tool-result rows are left out. */
const isTurn = (m) => (m.role === "user" && m.source?.kind !== "tool") || m.role === "assistant";
/**
 * Pick the messages that go into this call. Resuming: only what came after the last assistant turn
 * (the new prompt plus dsh's context injections). Fresh: the whole transcript, since `claude -p` is stateless.
 */
export function selectTurns(messages, resuming) {
    const turns = (messages ?? []).filter(isTurn);
    if (!resuming)
        return turns;
    let last = -1;
    for (let i = 0; i < turns.length; i++)
        if (turns[i]?.role === "assistant")
            last = i;
    return turns.slice(last + 1);
}
/** dsh's instruction bundle repeats files Claude Code already loads on its own (`CLAUDE.md` in the
 *  workspace, `~/.claude/CLAUDE.md`), so those blocks are dropped from what goes to Claude. The
 *  bundle is one `<system-reminder>` with `Instructions from: <path>` headers; a block runs to
 *  the next header or the closing tag. Empty when nothing but the wrapper would remain. */
export function withoutNativeInstructions(text) {
    const header = /^Instructions from: (.+)$/m;
    if (!header.test(text))
        return text;
    const close = /\s*<\/system-reminder>\s*$/.exec(text);
    const body = close ? text.slice(0, close.index) : text;
    const pieces = body.split(/^(?=Instructions from: )/m);
    const kept = pieces.filter((p) => {
        const m = header.exec(p);
        return !m || !/(^|\/)CLAUDE\.md\s*$/.test((m[1] ?? "").trim());
    });
    if (kept.length === pieces.length)
        return text;
    if (!kept.some((p) => header.test(p)))
        return "";
    return kept.join("").trimEnd() + (close ? close[0] : "");
}
/** Which withheld block a message is, if any. The chat row mask classifies the same sources from
 *  the client side, so the rule itself lives in `context-sources.ts` and both read it there. */
export const contextSourceOf = (m) => sourceBlockOf(m.source);
/** What each dsh block cost this turn, in characters, measured before any switch removed it: a
 *  cleared checkbox still has to show its number or the owner cannot tell whether to put it back.
 *  `instructions` counts what survives the CLAUDE.md filter and `claudemd` counts what the filter
 *  took, so the two together are the bundle dsh handed over. A key is absent when this turn carried
 *  nothing of that kind, which is not the same as zero and must not be flattened into one. */
export function contextSizes(turns) {
    const sizes = {};
    const add = (key, n) => {
        sizes[key] = (sizes[key] ?? 0) + n;
    };
    for (const m of turns) {
        const source = contextSourceOf(m);
        if (source === undefined)
            continue;
        const text = textOf(m.content);
        if (source !== "instructions") {
            add(source, text.length);
            continue;
        }
        const kept = withoutNativeInstructions(text);
        add("instructions", kept.length);
        add("claudemd", text.length - kept.length);
    }
    return sizes;
}
/** The CLI's slash-command names, written by `bridgeCommands` into a `globalThis` slot. Both dsh and
 *  Claude Code can know one of these skills: dsh injects the skill body as a user message, and the
 *  CLI then matches its own `/name` in that prompt to inject the same body a second time. The CLI's
 *  copy cannot be stopped from here, so the plugin leaves dsh's behind for a listed skill (seen
 *  2026-09-18 in transcript 50525676: 4.3 KB from dsh, then 8.7 KB from the CLI, one row after the
 *  other); a skill the CLI does not list is dsh's only copy, so it stays. Undefined before the
 *  first init frame writes it. */
const cliCommands = () => 
// SAFETY: a plain slot on globalThis, written only in bridgeCommands
globalThis[COMMAND_CATALOG];
/** Prompt text of one dsh message: a withheld block answers empty, a skill-invocation the CLI also
 *  lists is dsh's duplicate of a body Claude Code injects itself (so it answers empty), and the
 *  instruction bundle keeps losing its CLAUDE.md sections whatever the switches say, since Claude
 *  Code loads those itself. */
const promptTextOf = (m, drops = new Set()) => {
    const source = contextSourceOf(m);
    if (source !== undefined && drops.has(source))
        return "";
    if (m.source?.kind === "skill-invocation" && cliCommands()?.includes(m.source?.name ?? ""))
        return "";
    return m.source?.kind === "agent-instructions"
        ? withoutNativeInstructions(textOf(m.content))
        : textOf(m.content);
};
/** The turn's parts, with withheld blocks removed. */
const partsOf = (turns, drops) => turns.map((m) => ({ role: m.role, text: promptTextOf(m, drops) })).filter((t) => t.text !== "");
/**
 * The turn's text as one stdin prompt. A turn with assistant text in it is labelled by role so the
 * history stays legible; a plain user turn is sent as it was typed, with no label. A turn that
 * carries only an image has no text to send, so it becomes `(see attached)` and the image rides
 * along in `imageRefs`.
 */
export function buildPrompt(turns, drops = new Set()) {
    const filtered = partsOf(turns, drops);
    // A turn dsh opened with nothing but a withheld block would leave no prompt at all, and the CLI
    // needs one, so that turn goes out with an empty drop set: failing a turn is a worse answer than
    // sending the block it was about. The live case is the runtime snapshot, which re-sends itself
    // whenever the file or approval policy changes and can arrive as the only message of a turn.
    // `withoutNativeInstructions` still applies on this path, and should: dropping dsh's duplicate of
    // a CLAUDE.md the CLI loads itself is not one of the switches, it is what the adapter has always
    // done, and re-sending the copy here would double the file rather than rescue the turn.
    const parts = filtered.length > 0 ? filtered : partsOf(turns, new Set());
    if (!parts.some((t) => t.role === "user")) {
        // Attachment-only turn: the user sent an image (or other non-text block) with no typed
        // text. Images ride along separately via imageRefs, but Claude still needs a non-empty
        // prompt on stdin, so synthesize a minimal one rather than reject the whole turn.
        const hasUserAttachment = turns.some((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type !== "text"));
        if (hasUserAttachment)
            return "(see attached)";
        throw new LlmError("no user message", "INVALID_REQUEST");
    }
    const multi = parts.some((t) => t.role === "assistant");
    return parts.map((t) => (multi ? `[${t.role}]\n${t.text}` : t.text)).join("\n\n");
}
/** The most pixels a side may have for an image sent inline. The API allows 8000 on a request with
 *  few images and 2000 once the conversation holds more than twenty, and a long design session
 *  gets there: the request then fails with "image dimensions exceed max allowed size for
 *  many-image requests" and the CLI drops the image (2026-09-18, a 2884x156 screenshot as the
 *  forty-second image). The CLI caps everything it ingests itself at 2000, so this matches it;
 *  Node has nothing to scale an image with, so an oversize one goes by path and the Read tool,
 *  which scales, shows it a tool call later. */
const MAX_IMAGE_SIDE = 2000;
/** True when either side of an image exceeds `MAX_IMAGE_SIDE`, the most the API accepts inline
 *  once a conversation holds many images. Such an image is not sent inline at all. The prompt names
 *  its saved path instead, and Claude reads it with its file tool, which scales it down. */
const oversize = (ref) => (ref.width ?? 0) > MAX_IMAGE_SIDE || (ref.height ?? 0) > MAX_IMAGE_SIDE;
/** The file extension Claude Code's Read tool needs to treat a copy as an image. */
const IMAGE_EXT = new Map([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/gif", "gif"],
    ["image/webp", "webp"],
]);
/**
 * Where each image of the turn lives on disk, told to the model after the prompt. The image rides
 * inline on the stdin line, which lets Claude see it and nothing more: no path, so no Read, no
 * edit, no handing it to a subagent. dsh's own store names an image by hash with no extension, so
 * the note points at the copy `keepImageCopy` wrote. Files need nothing here: dsh replaces a file
 * block with a line naming its stored path before any provider sees the turn.
 */
export function attachmentNotes(turns, images) {
    const pathOf = new Map(images.filter((i) => i.attachmentId && i.path).map((i) => [i.attachmentId, i.path]));
    const notes = [];
    for (const m of turns) {
        if (m.role !== "user" || !Array.isArray(m.content))
            continue;
        for (const b of m.content) {
            if (b.type !== "image" || !b.attachment)
                continue;
            const ref = b.attachment;
            const path = pathOf.get(ref.attachmentId);
            if (!path)
                continue;
            const size = ref.width && ref.height ? `, ${ref.width}x${ref.height}px` : "";
            const label = `[Image ${ref.name ? `"${ref.name}" ` : ""}(${ref.attachmentId})`;
            notes.push(oversize(ref)
                ? `${label}: not shown inline, it is over ${MAX_IMAGE_SIDE}px on a side, the most the API takes once a conversation holds many images. Read the copy at "${path}" (${ref.mediaType}${size}) with your file tool, which scales it down, and copy it to a writable location before modifying it.]`
                : `${label}: the copy shown above is saved at "${path}" (${ref.mediaType}${size}). Read that path with your file tools when it is needed again, and copy it to a writable location before modifying it.]`);
        }
    }
    return notes.join("\n");
}
/** dsh's handle for an attached file, as `fileHandleText` writes it when the stored copy has a
 *  readable path (dsh-llm 0.1.6): the quoted name, the first eight hex of its sha256, the quoted
 *  path. The other form, "was uploaded, but … cannot access a readable path", has no path and
 *  does not match. */
const FILE_HANDLE = /(\[File ("(?:[^"\\]|\\.)*") \(\d+ bytes, sha256:([0-9a-f]{8})\): verbatim read-only copy saved at )("(?:[^"\\]|\\.)*")\./g;
/** How long one attachment may take to reach a box: before a prompt, and at a step boundary,
 *  where the CLI sits parked waiting for the line this holds up. */
const COPY_CAP_MS = 300_000;
const STEER_COPY_CAP_MS = 30_000;
/**
 * The text with every file handle pointed at the box's own copy. dsh saves an attachment on this
 * PC and names that path in the handle, which a `claude` running on another box cannot read, so
 * each file is handed to `copy` (local path and a far name in, far path out) and its handle takes
 * the path that comes back. A copy that fails leaves its handle as it was, and Claude then says
 * the path is unreadable, which is what happened to every handle before this.
 */
export async function relayFileHandles(text, copy, log = () => { }) {
    const farOf = new Map();
    for (const [, , quotedName, sha, quotedPath] of text.matchAll(FILE_HANDLE)) {
        if (!quotedName || !sha || !quotedPath || farOf.has(quotedPath))
            continue;
        try {
            // The sha keeps two files that share a name apart on the box.
            const farName = `${sha}-${basename(String(JSON.parse(quotedName))) || "file"}`;
            farOf.set(quotedPath, await copy(String(JSON.parse(quotedPath)), farName));
        }
        catch (error) {
            log("warn", `attachment ${quotedName} not copied to the box: ${errorText(error)}`);
        }
    }
    if (farOf.size === 0)
        return text;
    // Rebuilt from the handle's own head, not searched for inside it: a file name may hold any text.
    return text.replace(FILE_HANDLE, (whole, head, _name, _sha, quoted) => {
        const far = farOf.get(quoted);
        return far === undefined ? whole : `${head}${JSON.stringify(far)}.`;
    });
}
/** The images of a turn, newest MAX_IMAGES kept, for the stdin line that carries them. */
function imageRefs(turns) {
    const refs = [];
    for (const m of turns) {
        if (m.role !== "user" || !Array.isArray(m.content))
            continue;
        for (const b of m.content)
            if (b.type === "image" && b.attachment)
                refs.push(b.attachment);
    }
    return refs.slice(-MAX_IMAGES);
}
const MODE_FOR_ACCESS = {
    "read-only": "plan",
    "workspace-write": "acceptEdits",
    "danger-full-access": "bypassPermissions",
};
/** Claude permission mode for a dsh access mode, or undefined for one this table does not know. */
const modeForAccess = (accessMode) => 
// SAFETY: the key is checked against the table before it is used as its index
Object.hasOwn(MODE_FOR_ACCESS, accessMode)
    ? MODE_FOR_ACCESS[accessMode]
    : undefined;
/** dsh's access-mode switch arrives as text in the runtime-context injection; the last snapshot wins. */
export function accessModeOf(messages) {
    let mode;
    for (const m of messages ?? []) {
        if (m.role !== "user")
            continue;
        const found = textOf(m.content).match(/Current DSH file policy: ([a-z-]+)/);
        if (found)
            mode = found[1];
    }
    return mode;
}
/** dsh's approval-policy line rides in the same runtime-context injection as the file policy, and
 *  only while the policy is "never"; the last snapshot wins, so a switch back to "ask" clears it. */
export function approvalsDisabled(messages) {
    let disabled = false;
    for (const m of messages ?? []) {
        if (m.role !== "user")
            continue;
        const text = textOf(m.content);
        if (!text.includes("Current DSH file policy:"))
            continue;
        disabled = text.includes("Approval prompts are disabled in this session");
    }
    return disabled;
}
/** The CLI's permission mode for a turn: the configured one, or the one dsh's access mode maps to. */
export function permissionModeFor(config, accessMode) {
    if (config.permissionMode !== "dsh")
        return config.permissionMode;
    return modeForAccess(accessMode ?? "") ?? "acceptEdits";
}
// ---------------------------------------------------------------------------
// CLI probe: Claude Code auto-updates itself, so flags are checked against `claude --help` once per
// process and anything missing is left out. Unknown = assume supported (probe failed, older CLI).
const cliProbes = new Map();
/**
 * Whether the running dsh loads a log holding raw tool rows: one probe per process, on first ask.
 *
 * Per process is the right scope even with several mounts: the question is about the dsh that owns
 * the session log, and every session's log lives in this dsh whatever box its Claude runs on. A
 * remote box runs `claude`, never a second dsh, so there is nothing per-mount to ask.
 */
let rowsProbe;
/** Probe whether this target supports raw tool rows once and cache the answer, so repeated callers share one ssh probe instead of one per session. */
const rowsSupported = () => (rowsProbe ??= probeRawToolRows());
/** Flags a target's binary rejected at runtime, per probe key. A probe can be wrong. A box's CLI
 * updates under us, `--help` comes back empty over a stalled ssh and every flag then reads as
 * supported, and the CLI's answer to a flag it does not have is exit 1 before the first frame. What
 * it printed is better evidence than the probe, so it is remembered and the flag is never sent to
 * that binary again. */
const deniedFlags = new Map();
/** Forget what was probed on `host` ("" for this box): after `claude update` there, the flag set
 *  and the denials belong to a binary that is gone, and the next spawn probes the new one. */
export function forgetCliProbe(host) {
    for (const map of [cliProbes, deniedFlags])
        for (const key of map.keys())
            if (key.startsWith(`${host}::`))
                map.delete(key);
}
/** Every flag buildArgs guards with supports(). An unprobed binary is assumed to have all of them;
 * this list is what "all of them" means once one has to be taken away. */
const GUARDED_FLAGS = [
    "--input-format",
    "--include-partial-messages",
    "--forward-subagent-text",
    "--include-hook-events",
    "--effort",
    "--settings",
    "--append-system-prompt",
    "--no-session-persistence",
    "--permission-mode",
    "--permission-prompt-tool",
    "--tools",
    "--plugin-dir",
    "--plugin-url",
    "--max-budget-usd",
    "--session-id",
    "--resume",
    "--mcp-config",
];
/** The flag in `error: unknown option '--x'`, however the CLI wrapped the line. */
export function unknownFlagIn(text) {
    return /unknown option '(--[a-zA-Z][\w-]*)'/.exec(text)?.[1];
}
/** Record a flag the target's CLI refused. False when it was already known bad, which is what stops
 * a retry loop: the second refusal of the same flag is a real failure, not something to retry. */
export function denyCliFlag(command, host, flag) {
    const key = `${host ?? ""}::${command}`;
    const set = deniedFlags.get(key) ?? new Set();
    if (set.has(flag))
        return false;
    set.add(flag);
    deniedFlags.set(key, set);
    return true;
}
/** The target binary's version and the flags its `--help` lists, probed once per binary. */
// SAFETY: execFile's overloads include exactly this call shape; the alias only narrows them
export function probeCli(exec = execFile, command = "claude", host) {
    // One probe per target binary: the local `claude`, or a box's `claude` reached over ssh. A single
    // global cache used to let the first provider's flag set stand in for every box, so an older remote
    // claude was handed flags it does not have (e.g. --forward-subagent-text) and exited 1.
    const key = `${host ?? ""}::${command}`;
    let probe = cliProbes.get(key);
    if (!probe) {
        probe = (async () => {
            const run = (args) => new Promise((resolve) => {
                const cmd = host ? "ssh" : command;
                const cmdArgs = host ? sshArgs(host, [command, ...args].map(shq).join(" ")) : args;
                exec(cmd, cmdArgs, { timeout: host ? 15000 : 8000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
            });
            const [help, version] = await Promise.all([run(["--help"]), run(["--version"])]);
            const flags = new Set(help.match(/--[a-zA-Z-]+/g) ?? []);
            // A probe that answered nothing is not an answer. Dropping it from the cache costs one more
            // `--help` next turn and keeps a single stalled ssh from deciding this box's flags for the
            // life of the process.
            if (flags.size === 0)
                cliProbes.delete(key);
            return { flags: flags.size > 0 ? flags : null, version: version.trim() || "unknown" };
        })();
        cliProbes.set(key, probe);
    }
    return probe.then(({ flags, version }) => {
        const bad = deniedFlags.get(key);
        if (!bad?.size)
            return { flags, version };
        // Unknown flags mean "assume everything", so a denial has to be subtracted from the full list
        // rather than from nothing.
        const base = flags ?? new Set(GUARDED_FLAGS);
        return { flags: new Set([...base].filter((f) => !bad.has(f))), version };
    });
}
/**
 * Checks if a CLI flag is supported. Returns true if flags are unknown
 * (probe failed) to assume support.
 */
export const supports = (flags, flag) => !flags || flags.has(flag);
/** Text mode when the CLI lacks --input-format: prompt goes positional, images are dropped. */
export const usesStdin = (flags) => supports(flags, "--input-format");
/**
 * Constructs command-line arguments for spawning a Claude Code process.
 * Handles model, effort, permissions, MCP config, and other flags.
 */
/**
 * Appended to the system prompt whenever dsh tools are bridged. Claude Code's own Agent tool
 * spawns children dsh cannot see (no card, no header count, no notice), so subagents must go
 * through the bridged tools. Routes are box-specific, hence the pointer to list_subagent_models.
 */
const DSH_TOOLS_GUIDANCE = [
    "dsh tools are available as mcp__dsh__* over MCP. For any subagent, worker, helper or a",
    "specific model, use those and never the built-in Agent/Task tool: a native Agent child is",
    "invisible to dsh (no card, no header count, no completion notice, no transcript).",
    "mcp__dsh__subagent takes provider and model for a named route; mcp__dsh__list_subagent_models",
    "lists the allowed routes; omit both for the default. Other preset subagent tools",
    "(mcp__dsh__subagent_*, mcp__dsh__researcher_*) and mcp__dsh__subagent_fork are children",
    "too. run_in_background: false returns the answer inline; background returns an id and the",
    "notice arrives next turn. mcp__dsh__open_session makes a new top-level session, not a child.",
    "Long-running or background commands (test suites, builds, code reviews, watchers, anything you",
    "would run with `run_in_background`) go through `mcp__dsh__bash` with `run_in_background: true`;",
    "dsh registers the job, shows its card and panel entry, and the finish notice arrives next turn;",
    "read output with `mcp__dsh__job_output`, stop with `mcp__dsh__job_kill`. Short foreground",
    "commands stay on native `Bash`; do not use native `Bash` `run_in_background` because dsh cannot",
    "see it.",
].join(" ");
/**
 * The argument list for one `claude -p` spawn: every flag this plugin sends, in one place.
 *
 * Almost every flag is guarded by `supports`, which asks what this particular CLI binary
 * advertises, so an older Claude Code on a remote box is never handed a flag it would refuse and
 * die on; the feature quietly goes without instead. The one exception worth knowing is
 * `--tools default`, which looks redundant and is not: without it the CLI keeps
 * `AskUserQuestion` out of `-p` runs, so Claude could never ask the person anything.
 *
 * An auxiliary call, a title or a compaction, returns early with one turn, no tools and no session
 * of its own, and never carries a permission mode, allowed tools, budget or resume. Everything
 * after that early return applies only to a real conversation turn.
 */
export function buildArgs({ model, reasoningEffort, system, purpose, config, session, accessMode, flags, promptText, mcp, temporary = false, permissionMode, }) {
    const args = ["-p"];
    if (usesStdin(flags))
        args.push("--input-format", "stream-json");
    else
        args.push(promptText ?? "");
    args.push("--output-format", "stream-json", "--verbose");
    if (supports(flags, "--include-partial-messages"))
        args.push("--include-partial-messages");
    if (supports(flags, "--forward-subagent-text"))
        args.push("--forward-subagent-text");
    if (config.hookRows && supports(flags, "--include-hook-events"))
        args.push("--include-hook-events");
    if (model)
        args.push("--model", model);
    if (reasoningEffort && supports(flags, "--effort"))
        args.push("--effort", reasoningEffort);
    // In -p mode /fast only works in a session launched with fast mode in --settings (fast-mode docs).
    if (config.fastMode && supports(flags, "--settings"))
        args.push("--settings", JSON.stringify({ fastMode: true }));
    const appended = [system, mcp ? DSH_TOOLS_GUIDANCE : ""].filter(Boolean).join("\n\n");
    if (appended && supports(flags, "--append-system-prompt")) {
        args.push("--append-system-prompt", appended);
    }
    if (purpose) {
        // Auxiliary calls (title, compaction): one turn, no tools, no session of their own. Without
        // --no-session-persistence each one still leaves a transcript under the scratch project dir.
        args.push("--tools", "", "--max-turns", "1");
        if (supports(flags, "--no-session-persistence"))
            args.push("--no-session-persistence");
        return args;
    }
    if (temporary && supports(flags, "--no-session-persistence"))
        args.push("--no-session-persistence");
    if (supports(flags, "--permission-mode")) {
        const mode = permissionMode ?? permissionModeFor(config, accessMode);
        args.push("--permission-mode", mode);
    }
    if (config.approvals && usesStdin(flags) && supports(flags, "--permission-prompt-tool")) {
        args.push("--permission-prompt-tool", "stdio");
    }
    // "default" is what the Agent SDK passes; without it the CLI keeps AskUserQuestion out of -p runs.
    if (supports(flags, "--tools"))
        args.push("--tools", "default");
    if (config.allowedTools.length > 0)
        args.push("--allowedTools", ...config.allowedTools);
    if (config.disallowedTools.length > 0)
        args.push("--disallowedTools", ...config.disallowedTools);
    for (const d of config.addDirs)
        args.push("--add-dir", d);
    // Session-only plugins: a per-spawn flag, not a settings write, so they never touch the roster.
    if (supports(flags, "--plugin-dir"))
        for (const d of config.pluginDirs)
            args.push("--plugin-dir", d);
    if (supports(flags, "--plugin-url"))
        for (const u of config.pluginUrls)
            args.push("--plugin-url", u);
    if (config.maxTurns)
        args.push("--max-turns", String(config.maxTurns));
    if (config.maxBudgetUsd && supports(flags, "--max-budget-usd")) {
        args.push("--max-budget-usd", String(config.maxBudgetUsd));
    }
    if (session && supports(flags, "--session-id") && supports(flags, "--resume")) {
        args.push(session.resuming ? "--resume" : "--session-id", session.id);
    }
    if (mcp && supports(flags, "--mcp-config")) {
        const dsh = { type: "http", url: mcp.url, headers: { [KEY_HEADER]: mcp.key } };
        args.push("--mcp-config", JSON.stringify({ mcpServers: { dsh } }));
    }
    return args;
}
/** One stream-json input line: the user turn with text and inline images. `uuid` goes on the line so a later `cancel_async_message` can name it. */
export function buildInput(prompt, images, uuid) {
    const content = [{ type: "text", text: prompt }];
    for (const img of images) {
        if (!img.data)
            continue; // by path only; `attachmentNotes` says where
        content.push({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.data },
        });
    }
    return userTurnLine(content, uuid);
}
// ---------------------------------------------------------------------------
// stream-json → dsh chunks
/** Names from the CLI's init frame that dsh's command grammar accepts (lowercase, `[a-z0-9_-]`), deduped. */
export function commandNames(value) {
    if (!Array.isArray(value))
        return [];
    const out = new Set();
    for (const v of value)
        if (String(v) === v && /^[a-z0-9][a-z0-9_-]*$/.test(v))
            out.add(v);
    return [...out];
}
/**
 * The CLI flattens a server name into a tool id, so the id never carries a space, a dot or a
 * colon: compare a normalized form of both sides rather than the literal name.
 */
/** Replacing before lowercasing keeps this one code unit in, one code unit out: everything a
 *  case fold could change the length of has already become an underscore. */
function serverKey(text) {
    return text.replace(/[^A-Za-z0-9-]/g, "_").toLowerCase();
}
/**
 * Bare tool names per MCP server, from the init frame's `mcp__<server>__<tool>` ids. Every known
 * server gets an entry, empty when it contributes nothing; an id whose server is not in the list
 * is dropped rather than guessed at.
 */
export function mcpToolsByServer(serverNames, toolIds) {
    const keys = new Map();
    const out = new Map();
    for (const server of serverNames) {
        keys.set(serverKey(server), server);
        out.set(server, []);
    }
    for (const id of toolIds) {
        if (!id.startsWith(MCP_TOOL_PREFIX))
            continue;
        const rest = id.slice(MCP_TOOL_PREFIX.length);
        // Normalizing is character-for-character, so an offset into the normalized form is also an
        // offset into `rest` and the bare name keeps its original case. Longest key wins: one server
        // name can be a prefix of another, and the tool name itself may contain the separator.
        const normalized = serverKey(rest);
        let owner = "";
        let ownerKey = "";
        for (const [key, server] of keys)
            if (normalized.startsWith(`${key}__`) && key.length > ownerKey.length) {
                owner = server;
                ownerKey = key;
            }
        if (ownerKey === "")
            continue;
        out.get(owner)?.push(rest.slice(ownerKey.length + 2));
    }
    for (const bare of out.values())
        bare.sort();
    return out;
}
/** Every MCP-contributed tool id the CLI reports starts with this. */
const MCP_TOOL_PREFIX = "mcp__";
/** Bridged Claude commands are registered as `/claude-<name>` in dsh. */
const BRIDGE_PREFIX = "claude-";
/**
 * Names dsh's own client half owns, which the host registry cannot answer for. A host command of
 * one of these makes dsh's menu throw where it merges the two lists ("contribution /X collides with
 * a host command"), and the menu goes blank rather than losing one row. Read out of dsh's client
 * bundles, where a contribution is a `commandUi.register({ name })`; a host command dsh registers
 * normally needs no entry here, since its own registry throws on the duplicate and the bridge falls
 * back to the prefixed name.
 */
const CLIENT_COMMANDS = new Set(["model"]);
/** Claude's rename command, and the alias its catalog also offers. */
const RENAME_COMMANDS = new Set(["rename", "name"]);
/**
 * The dsh title a bridged command should set: the trimmed argument when this is Claude's rename
 * with one. An empty argument returns undefined so the line reaches Claude unchanged and the CLI
 * answers with its own usage message.
 */
export function renameTitle(cmd, rawInput) {
    if (!RENAME_COMMANDS.has(cmd))
        return undefined;
    const title = rawInput.trim();
    return title.length > 0 ? title : undefined;
}
// Claude Code tool names → dsh tool name that the client-ui-tool presenter recognises.
// Unknown names fall through to the generic "others" row.
export const NATIVE_TOOL_MAP = {
    Bash: "bash",
    Read: "read",
    Edit: "edit",
    Write: "write",
    Grep: "grep",
    Glob: "glob",
    WebFetch: "web_fetch",
    WebSearch: "web_search",
    // Same presenter as Edit: the client draws both from a diff, and the input shape only differs in
    // carrying several edits.
    MultiEdit: "edit",
    // The rest of Claude's own tools. They have no dsh row variant. dsh classifies anything outside
    // its own table as `others`, but the inline markdown path keys its icon, name and renderer off
    // this name, and without an entry each of these printed as a raw JSON dump under a sparkle.
    TodoWrite: "todo_write",
    Task: "task",
    NotebookEdit: "notebook_edit",
    BashOutput: "bash_output",
    KillShell: "kill_shell",
    ExitPlanMode: "exit_plan_mode",
    EnterPlanMode: "enter_plan_mode",
    SlashCommand: "slash_command",
};
/**
 * How much longer than the configured idle timeout a turn may be silent while a tool call is out.
 * A `Bash` step running a test suite is legitimately quiet for a long time; a call that never comes
 * back should still end rather than hold the session open until dsh restarts.
 */
const TOOL_IDLE_FACTOR = 2;
/** Per-session ring buffer (last 50 turns) keyed by dsh sessionId, on the adapter instance. */
const TURN_RING = 50;
/** `--resume` of a session Claude Code no longer has: a result whose errors name the missing conversation. */
export function isStaleResume(event) {
    if (event?.type !== "result" || !event.is_error)
        return false;
    return /No conversation found/i.test(JSON.stringify(event.errors ?? event.result ?? ""));
}
/** A logged-out CLI: the -p mode text, or the API's 401 once a stored token has expired. */
const NOT_LOGGED_IN_RE = /not logged in|authentication_error|failed to authenticate|oauth .*invalid/i;
/** The result's own words, for the error text and the login match. */
const resultMessage = (result) => {
    const errors = Array.isArray(result.errors) ? result.errors.join("; ") : "";
    return String(result.result ?? errors ?? result.subtype ?? "claude error");
};
/** A turn that failed because the box's Claude has no usable login: the CLI's own wording, or the
 *  API's 401 once a stored token has been revoked. The one test both the error text and the login
 *  card key on, so they cannot disagree about what counts. */
export function isLoginFailure(result) {
    return (result.is_error === true &&
        (result.api_error_status === 401 || NOT_LOGGED_IN_RE.test(resultMessage(result))));
}
/** On an error result it builds the message a person sees: it names the box the turn ran on and,
 *  for a 5xx, appends the incident the status page reports so the failure reads as the provider's. */
export function finishReason(result, hostLabel) {
    if (result.is_error) {
        let message = resultMessage(result);
        // Name the box the turn actually ran on: an SSH box or a remote workspace runs the far claude, so
        // the local hostname would point the user at the wrong machine to run `claude auth login` on.
        if (isLoginFailure(result))
            message = serverText("loginFailure", { host: hostLabel ?? hostname(), detail: message });
        // The retries before this result already asked the status page; a 5xx that gave up names
        // the incident the page reports, if any, so the failure reads as theirs rather than ours.
        if ((result.api_error_status ?? 0) >= 500)
            message += degradedNote(peekStatus());
        return { kind: "error", failure: { message, code: "PROVIDER_ERROR" } };
    }
    if (result.stop_reason === "max_tokens")
        return { kind: "max-tokens" };
    return { kind: "stop" };
}
/**
 * Incremental translator from Claude Code stream-json lines to dsh StreamChunks.
 * Prefers partial `stream_event`s; falls back to whole `assistant` messages when no partials arrived.
 * Tool calls and results are shown as reasoning blocks: the CLI runs its own tools, dsh only watches.
 */
/** The `kind` dsh's loop puts on an abort reason ("disposed" on shutdown), else undefined. */
/** The producer-owned source kind dsh's session format v4 gives this plugin's own messages. v4
 *  (`dsh-session-format-v3-to-v4`, `source()`) refuses any appended message whose `kind` is the
 *  retired `"plugin"` wrapper with "format v4 message requires a producer-owned source kind"; its
 *  migrator lifts `{ kind: "plugin", plugin: X }` to `{ kind: "plugin:X" }`, and a native v4 append
 *  must already carry that shape. */
export const OWN_SOURCE_KIND = "plugin:dsh-oh-my-claude";
/** Whether a logged source is one of this plugin's own, in either the v3 wrapper or the v4 kind. */
export const isOwnSource = (source) => source?.kind === OWN_SOURCE_KIND ||
    (source?.kind === "plugin" && source.plugin === "dsh-oh-my-claude");
/** The source a wake notice carries: user only when a restart notice must rearm an active goal.
 *  `logVersion` is the session log's `header.version`; from 4 up the notice carries the
 *  producer-owned kind, since the v3 wrapper fails the turn it is appended to (seen 2026-09-23 on
 *  dsh 0.1.7-alpha.2: the restart notice itself was the turn that died). */
export function noticeSource(text, goalActive, logVersion = 3) {
    const restart = text === RESTART_TEXT || text === RECONNECT_TEXT || text === LIMIT_TEXT;
    if (restart && goalActive)
        return { kind: "user" };
    const rest = { form: "notice", summary: boundContextSummary(text) };
    return logVersion >= 4
        ? { kind: OWN_SOURCE_KIND, ...rest }
        : { kind: "plugin", plugin: "dsh-oh-my-claude", ...rest };
}
/** After an interrupt, kill a process that did not finish in time: only when no keeper owns it. */
export const killAfterGrace = (spawn) => spawn !== "keeper";
/** What an interrupt does to the process's steer state: a steer forwarded before the Stop was
 *  already handed to the CLI, which runs it as a turn of its own once the interrupt lands (seen
 *  2026-09-18: `queue-operation dequeue` 7 ms after `[Request interrupted by user]`). Nothing is
 *  left to park on, and a park flag left set would read the CLI's interrupt echo (a `user` frame)
 *  as the tool-result boundary, exit the step as parked, and leave the interrupted turn's error
 *  `result` in the queue for the next prompt to die on. The waiting steers go too: the CLI dequeues them the moment the interrupt lands. */
export function noteInterrupt(proc) {
    proc.steerPending = false;
    forgetSteers(proc);
}
/** Forget the steers a process had waiting: the CLI has taken them or they went with the turn. Tolerates
 *  a process object without the map (the test fakes, a process from before this field existed). */
export function forgetSteers(proc) {
    proc.steers?.clear();
    if (proc.forwarded !== undefined)
        proc.forwarded = 0;
}
/** Whether an aborted stream should interrupt Claude: always, except a dsh shutdown under a keeper. */
export function interruptOnAbort(kind, spawn) {
    return !(kind === "disposed" && spawn === "keeper");
}
/** The `kind` in an abort signal's `{ kind }` reason, which is disposed, aborted or cancelled, or
 * undefined for a plain abort, so a caller can tell a dispose from a user cancel. */
function abortKind(signal) {
    if (!signal?.aborted)
        return undefined;
    const reason = signal.reason;
    if (reason instanceof Object && "kind" in reason && !Array.isArray(reason)) {
        const kind = reason.kind;
        return kind === "disposed" || kind === "aborted" || kind === "cancelled" ? kind : undefined;
    }
    return undefined;
}
/** dsh's tool-result for a relayed call, searched from the newest message back. */
export function toolResultFor(messages, id) {
    const list = messages ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (!m)
            continue;
        // dsh 0.1.7: the result is a message of its own, `role: "tool"`, with the call id on it and
        // the text in its blocks. `ToolResultBlock` is gone from that release's block map, so the
        // older read below can never match there.
        if (m.role === "tool" && m.toolCallId === id)
            return { text: textOf(m.content), isError: m.isError === true };
        // dsh 0.1.6 and earlier: a user message from the tool source holding a `tool-result` block.
        if (m.role !== "user" || m.source?.kind !== "tool" || !Array.isArray(m.content))
            continue;
        for (const b of m.content) {
            if (b.type === "tool-result" && b.toolCallId === id)
                return { text: textOf(b.content), isError: b.isError === true };
        }
    }
    return undefined;
}
/** Messages dsh delivered after the last assistant step. */
export function afterLastAssistant(messages) {
    const list = messages ?? [];
    let last = -1;
    for (let i = 0; i < list.length; i++)
        if (list[i]?.role === "assistant")
            last = i;
    return list.slice(last + 1);
}
/** The Agent inside what dsh's session controller answered for a cold resume. dsh 0.1.6 wraps it
 *  (`{ agent }`, or `{ error }` when the session cannot be resumed) where 0.1.5 handed back the
 *  Agent; read as the Agent, the wrapper has no `followup`, and every wake of an unloaded session
 *  failed on it from the day 0.1.6 was installed. The controller's error is thrown so the caller
 *  reports it like any other failed resume. */
export function resolvedAgent(found) {
    if ("error" in found)
        throw found.error instanceof Error ? found.error : new Error(String(found.error));
    return "agent" in found ? found.agent : found;
}
/** Notice this plugin drops into a session's inbox to open a turn after Claude replied on its own. */
export const WAKE_TEXT = "Claude Code finished a background task and replied.";
/** A mirror turn whose followup never opened a turn (the agent went away) is put back after this. */
const MIRROR_TURN_TIMEOUT_MS = 120_000;
/** How long the transcript must stay still before the watcher reads it: the CLI writes a reply as
 *  several rows, and a turn mirrored between two of them would show half of it. */
const TRANSCRIPT_SETTLE_MS = 250;
/** How often loaded sessions are checked for a transcript not yet under watch. */
const WATCH_SWEEP_MS = 30_000;
/** How far back a first watch looks for a terminal prompt still being answered. */
const WATCH_LOOKBACK_BYTES = 4 * 1024 * 1024;
/** How far back a watch starts when no baseline was ever saved for this transcript. Starting at the
 *  end of the file instead, which is what it did, meant every exchange already in it was skipped for
 *  good: turning the mirror on, or a transcript whose path changed under a new Claude id, left the
 *  tab holding only whatever landed next. Bounded rather than the whole file so enabling it on a long
 *  session does not replay a day of terminal work into the tab. */
const FIRST_WATCH_BYTES = 256 * 1024;
/** How long a terminal turn must run before it streams live rather than landing whole at its end:
 *  below this, the turn completes fast enough that one push reads cleaner than a live fill. */
const STREAM_THRESHOLD_MS = 1000;
/** The render loop re-reads the exchange at least this often even without a scan waking it, so a
 *  write the watcher's debounce has not delivered yet still reaches the open turn promptly. This is
 *  the interval for a transcript on this PC, where a read is a file handle and a parse of a few
 *  milliseconds: measured 2026-09-11, folding a 1 MB tail costs 5.4ms, and 64 KB costs 0.7ms, so
 *  reading often is far cheaper than the delay it saves. */
const STREAM_IDLE_MS = 500;
/** The same interval for a box reached over ssh, which pays a process per read and has no inotify to
 *  wake the render in between, so it trades a slower fill for a fraction of the round trips. */
const STREAM_IDLE_REMOTE_MS = 1500;
/** How long the stream waits idle before settling: longer for a remote box, where a blank costs a round trip, than for a local one. */
const idleFor = (box) => (box.sshHost ? STREAM_IDLE_REMOTE_MS : STREAM_IDLE_MS);
/** A terminal turn that never ends (an abandoned or crashed `claude`) would hold its dsh turn open
 *  forever; after this the render settles what it has and closes. */
const STREAM_MAX_MS = 10 * 60_000;
/** Sent as a real prompt after dsh restarts mid-turn: the process is gone, Claude must carry on. */
/** Sent when a restarted dsh reattaches to a Claude process that kept running meanwhile. */
export const RECONNECT_TEXT = "[Oh My Claude] dsh restarted and reattached to your still-running Claude Code process; what you did meanwhile is shown above. Continue where you are.";
/** Sent when a usage limit that ended a turn has reset, so Claude picks the task back up. */
export const LIMIT_TEXT = "[Oh My Claude] your usage limit has reset. Continue the task where the limit stopped you.";
export const RESTART_TEXT = "[Oh My Claude] dsh restarted while this turn was in progress and the Claude Code process was replaced. Pick up where the transcript stops and finish the task. If this session has an active goal, dsh disarmed it on resume: call get_goal, then update_goal with action resume, so the goal rounds keep driving the work without anyone typing.";
/** How long after boot to nudge interrupted sessions; dsh needs its sessions and agents loaded. */
const RESUME_DELAY_MS = 10_000;
/** Slack after a usage limit's reset instant before the continue notice goes out. */
const LIMIT_GRACE_MS = 5_000;
/** A message that is our own wake notice, a plugin user message whose text is exactly WAKE_TEXT,
 * so wakeOnlyTurn can treat it apart from a real user prompt. */
const isWake = (m) => m.role === "user" && isOwnSource(m.source) && textOf(m.content) === WAKE_TEXT;
/** A turn opened by our own wake notice, with no user prompt to send: only drain what Claude
 *  already wrote. A user prompt in the same batch takes precedence and is sent normally. */
export function wakeOnlyTurn(messages) {
    const fresh = afterLastAssistant(messages);
    return fresh.some(isWake) && !fresh.some((m) => m.source?.kind === "user");
}
/** Drop messages Claude already received live on stdin (matched by `steerKey`). */
export function dropSent(messages, sent) {
    if (!sent || sent.size === 0)
        return messages ?? [];
    return (messages ?? []).filter((m) => {
        const key = steerKey(m);
        return !(key && sent.has(key));
    });
}
/** What dsh delivered at this step boundary besides the tool result: steers the user sent while
 *  the tool ran, subagent notices, other injections. Claude only sees the tool result, so they
 *  ride along with it. Empty when there is nothing. A message already written live to stdin is
 *  skipped, so Claude reads it once. */
export function stepContextFor(messages, drops = new Set(), sent = new Set()) {
    const parts = [];
    for (const m of afterLastAssistant(messages)) {
        if (m.role !== "user")
            continue;
        if (m.source?.kind === "tool")
            continue;
        if (sent.has(steerKey(m) ?? ""))
            continue;
        const text = promptTextOf(m, drops);
        if (text)
            parts.push(text);
    }
    return parts.length === 0
        ? ""
        : `\n\n<user_messages_during_tool_call>\n${parts.join("\n\n")}\n</user_messages_during_tool_call>`;
}
/**
 * The `/btw` messages in a batch dsh is about to send as prose. The command works when it is typed
 * between turns: dsh dispatches it to the handler. Typed while a turn runs, dsh's composer queues
 * the raw text and delivers it as an ordinary message, the handler never runs, and the CLI answers
 * "/btw isn't available in this environment". Catching them here routes both paths to the same
 * place. Only a message that is the command and nothing else counts, so prose quoting `/btw` is
 * still prose.
 */
export function sideQuestionsIn(messages) {
    const found = [];
    for (const m of afterLastAssistant(messages)) {
        if (m.role !== "user" || m.source?.kind !== "user")
            continue;
        const question = /^\/btw[ \t]+([\s\S]+)$/.exec(textOf(m.content).trim())?.[1]?.trim();
        if (question)
            found.push({ message: m, question });
    }
    return found;
}
// Re-exported so tests that import from adapter.ts can reach it too.
export { ADAPTER_CURRENT };
/** How long to wait for the rest of a parallel dsh tool-call batch after the first one arrives. */
const RELAY_BATCH_MS = 1500;
/** How long a step handing dsh a relay waits for Claude's own tool results still in flight.
 *  Its Read, Grep and short Bash land in milliseconds; a longer Bash gets a placeholder row. */
const NATIVE_RESULT_WAIT_MS = 10_000;
/** After asking the CLI to interrupt, how long before falling back to killing the process. */
const INTERRUPT_GRACE_MS = 5000;
/**
 * Whether Claude's own tool calls may be appended as raw `tool/call`/`tool/result` rows. Only a
 * format-0 session (dsh before 0.1.5) takes them: from 0.1.5 the session format is versioned and
 * its migration refuses any `tool/call` no `assistant/message` advertised, so such rows would make
 * the whole log unloadable on the next upgrade. Inline rendering has no such row.
 */
export function nativeToolRows(config, formatVersion, rawRowsLoad = false) {
    const wanted = config.toolActivity && !config.toolsInline;
    // A format-0 log predates the rule; a later one takes rows only when the probe says its dsh does.
    const fits = formatVersion === 0 || rawRowsLoad;
    return { rows: wanted && fits, refused: wanted && !fits };
}
/** Count the human prompts dsh has in a transcript (context injections and tool results excluded). */
export function userPromptCount(messages) {
    return (messages ?? []).filter((m) => m.role === "user" && m.source?.kind === "user").length;
}
/** The stream chunks that make one relayed dsh tool call a native tool-call block. */
export function* relayBlocks(tr, call) {
    const index = tr.index++;
    const args = JSON.stringify(call.args ?? {});
    // SAFETY: ToolCallId is a branded string, cast from plain string
    yield { type: "block-start", index, blockType: "tool-call" };
    yield {
        type: "tool-call-delta",
        index,
        // SAFETY: relay ids are minted by this plugin (randomUUID); the brand marks provenance only
        id: call.id,
        name: call.name,
        argumentsDelta: args,
    };
    yield {
        type: "block-end",
        index,
        block: {
            type: "tool-call",
            // SAFETY: same minted id as the delta above
            id: call.id,
            name: call.name,
            arguments: args,
        },
    };
}
// ---------------------------------------------------------------------------
// Adapter
/** A process spec as a string, so two specs compare by content when deciding to reuse a process. */
const specKey = (spec) => JSON.stringify(spec);
/** Whether a todo list still has work on it. A list of nothing but completed items is finished,
 *  and a finished list is not worth painting over a fresh message. */
export function hasPendingTodo(todos) {
    return todos.some((todo) => {
        // The list is off dsh's event log, so an item of another shape counts as unfinished rather
        // than being read as done and dropped.
        if (todo === null || !(todo instanceof Object) || Array.isArray(todo))
            return true;
        return todo.status !== "completed";
    });
}
/** Past this the model reads the tree faster than it reads a paste, and the whole context goes out as
 *  one stdin write with no backpressure guard: `write` (`src/process.ts:1312`) returns true either
 *  way, so a 200-file tree would ship megabytes on one line and bill a call that overruns the window. */
const DIFF_CONTEXT_CAP = 32_000;
/** A `get_workspace_diff` answer as the text a side question carries. Hunk headers and raw lines,
 *  nothing invented; a file with no hunks is named with why, so the reply does not guess. Whole files
 *  only, in the CLI's own order, up to the cap; the first file always goes even if it alone is over,
 *  because a context with no diff in it is worse than a long one. */
export const diffContext = (diff, path) => {
    const files = path === "" ? diff.files : diff.files.filter((f) => f.path === path);
    const parts = [];
    let size = 0;
    for (const f of files) {
        const body = f.hunks.length === 0
            ? f.binary
                ? "binary file"
                : f.untracked
                    ? "untracked file"
                    : "no hunks"
            : f.hunks
                .map((h) => `@@ -${h.oldStart} +${h.newStart} @@\n${h.lines.join("\n")}`)
                .join("\n");
        const part = `--- ${f.path}\n${body}`;
        if (parts.length > 0 && size + part.length > DIFF_CONTEXT_CAP)
            break;
        parts.push(part);
        size += part.length + 2;
    }
    if (parts.length < files.length)
        parts.push(`… diff truncated (${parts.length} of ${files.length} files)`);
    return parts.join("\n\n");
};
/** The LlmAdapter that drives the logged-in Claude Code CLI: it owns the live `claude` processes, bridges dsh's commands and routes into them, and mirrors their transcript back into dsh. */
export class ClaudeCodeAdapter extends LlmAdapter {
    ctx;
    config;
    subprocess;
    /** dsh's permission preset service, when mounted: the shield's current preset per session. */
    permissionPresets;
    processes;
    /** Per session, the timer that continues the task once its usage limit resets. */
    limitTimers;
    mcp;
    warnedNoSeam = false;
    /** Set once a session read has thrown, so the line lands one time and not per routed message. */
    warnedNoSessionRead = false;
    loggedVersion = false;
    /** Probe targets already written to resume.log, so the line lands once per binary, not per turn. */
    probeTraced = new Set();
    sessionController;
    /** What a heal needs from dsh, handed over by the session routes; undefined until they load. */
    heal;
    /** Masks secret env values in tool results; undefined when `redactSecrets` is off. */
    redact;
    /** dsh sessions marked temporary with /temporary; on globalThis so a reload keeps them. */
    temporary;
    /** Per-session turn accounting buffer (last 50 turns); keyed by dsh sessionId. Lives on
     *  globalThis so the route registered at boot reads what a hot-reloaded adapter fills. */
    turnBuffer;
    /** What the running turn has done so far, per session, for the status row: output tokens across
     *  the finished assistant messages, plus the thinking estimate for the block the model is in now.
     *  The estimate is cleared when the next usage frame lands, since that frame counts the same
     *  tokens for real. Set by the live translator, cleared when the turn ends; a session with no entry
     *  has no turn running. */
    liveTurn = new Map();
    /** The model last written to workspace-models.json per cwd, so a turn on the same model writes nothing. */
    workspaceModelWritten = new Map();
    /** The sizes last written to context-sizes.json per cwd, as `key:value` pairs in a fixed order,
     *  so a workspace whose blocks did not change writes nothing. */
    contextSizesWritten = new Map();
    /** Per-session idle watchdog deadline in epoch ms; null means no active arm. */
    idleDeadlineMap = new Map();
    /** Per-session kill and warning timers, keyed by session id. */
    idleKillTimers = new Map();
    idleWarnTimers = new Map();
    /** What each armed key watches, so a route can re-arm it. */
    idleTargets = new Map();
    /** Per-session permission mode overrides; loaded from disk at init, saved on change. */
    permissionModes;
    /** dsh access mode seen on each session's last turn, so the effective mode can be reported. */
    accessModes;
    /** Sessions whose last runtime snapshot said dsh auto-denies every approval ask. */
    approvalsOff;
    /** Callers waiting for the CLI's `control_response` to a request this plugin sent, by request id. */
    controlWaiters;
    /** The rules recent approval requests suggest, newest last, per session. */
    permissionAsks = new Map();
    /** rpcIds of messages already routed to `askSideQuestion`, so a re-sent batch asks once. */
    asked = new Set();
    /** `/btw` side questions and their answers, newest last, per session; kept in memory only. */
    sideQuestions = new Map();
    /** Steers taken back for an edit, per session, keyed by the hold's first message id. */
    heldSteers = new Map();
    /** Sessions whose last turn failed for want of a login, and the box that turn ran on. The composer
     *  card reads this beside the asides; a turn that succeeds, or a panel login on that box, clears it.
     *  Memory only: after a restart the next failed turn writes it again. */
    loginNeeded = new Map();
    /** Saved opening prompts: one per session id, plus `default` for the one a session without its own
     *  is offered. Loaded from disk on construct and written through on every save. */
    starters = new Map();
    /** The live thinking budget this plugin last set per session (null = session default, 0 = off);
     *  memory only, since a respawn resets it and the CLI has no flag to carry it. */
    thinkingBudgets = new Map();
    /** Tool activity as the Settings switch set it; undefined = the config's `toolsInline`. Loaded from
     *  disk on construct, written through on every set, and read fresh at the start of each turn. */
    toolMode = undefined;
    cliModels = [];
    claudeHome;
    /** `~/.claude` itself, which stays the box's login and settings even when transcripts move. */
    realClaudeHome;
    /** The `command` as configured, before this box's path resolution. */
    configuredCommand;
    providerId;
    displayName;
    settingsNs;
    stateDir;
    /** Attach the mounted context and config, then load every persisted store (permission modes, tool modes, terminal sync, turn records, asides, starters and limit waits) so a resumed adapter reads as it left off. */
    constructor(ctx, config) {
        super();
        this.ctx = ctx;
        // The probe answers `ok: false` with a reason rather than throwing, and the catch keeps the
        // inline fallback on any dsh where that stops being true.
        if (DSH_VERSION !== null && atLeast(DSH_VERSION, "0.1.7-alpha.1"))
            void rowsSupported()
                .then((r) => {
                this.rowsByDefault = r.ok;
            })
                .catch(() => { });
        // Before `localConfig` turns a bare name into this box's absolute path: a turn that runs
        // somewhere else needs the name as configured. See `commandFor`.
        this.configuredCommand = config.command;
        config = localConfig(config);
        this.config = config;
        this.providerId = config.providerId;
        // SAFETY: regex only matches 'claude-code' or 'claude-code-…'; the string shape is enforced by the schema default
        if (!/^claude-code(-.+)?$/.test(this.providerId)) {
            throw new Error(`invalid providerId "${this.providerId}": must be 'claude-code' or start with 'claude-code-'`);
        }
        this.realClaudeHome = resolveClaudeHome(config.configDir);
        this.claudeHome = this.realClaudeHome;
        this.redact = config.redactSecrets ? buildRedactor(process.env) : undefined;
        this.displayName =
            config.providerName ||
                (this.providerId === "claude-code"
                    ? "Oh My Claude"
                    : `Oh My Claude (${this.providerId.slice("claude-code".length).slice(1)})`);
        this.settingsNs = `llm-${this.providerId}`;
        this.stateDir = stateDir(this.providerId);
        this.cliSeed = this.seedCliModels();
        // With the switch on the CLI runs against the mirror, so `claudeHome`, the path every read in
        // this plugin resolves against, is the mirror too: its settings and login are the real files,
        // read through their links, and only `projects/` is the plugin's own. It needs `stateDir`,
        // which is why it lands here rather than beside `realClaudeHome`.
        if (config.ownTranscripts)
            this.claudeHome = buildMirror(this.realClaudeHome, join(this.stateDir, "claude-home"), (level, msg) => this.log(level, msg));
        this.accessModes = new Map();
        this.approvalsOff = new Set();
        this.controlWaiters = new Map();
        loadPermissionModes(this.stateDir)
            .then((modes) => {
            // Merge rather than replace: another mount may have filled the shared map already.
            for (const [id, mode] of modes)
                if (!this.permissionModes.has(id))
                    this.permissionModes.set(id, mode);
        })
            .catch(() => { }); // state is an optimization only
        loadToolMode(this.stateDir)
            .then((mode) => {
            this.toolMode = mode;
        })
            .catch(() => { }); // state is an optimization only
        loadTerminalSync(this.stateDir)
            .then((on) => {
            if (on !== undefined)
                this.terminalSync = on;
        })
            .catch(() => { }); // unreadable state leaves the field's own default, which is off
        loadTurnRecords(this.stateDir)
            .then((saved) => {
            for (const [id, list] of saved)
                if (!this.turnBuffer.has(id))
                    this.turnBuffer.set(id, list);
        })
            .catch(() => { }); // state is an optimization only
        // `/btw` asides are memory-only per instance, so a restart or a hot reload would lose them;
        // reload the persisted ring so an answer survives to be re-read.
        loadAsides(this.stateDir)
            .then((saved) => {
            for (const [id, list] of saved)
                if (!this.sideQuestions.has(id))
                    this.sideQuestions.set(id, list);
        })
            .catch(() => { }); // state is an optimization only
        loadStarters(this.stateDir)
            .then((saved) => {
            for (const [id, text] of saved)
                if (!this.starters.has(id))
                    this.starters.set(id, text);
        })
            .catch(() => { }); // state is an optimization only
        this.limitTimers = new Map();
        // Waits armed before a restart: re-arm them, no earlier than the boot resume nudge.
        loadLimitWaits(this.stateDir)
            .then((waits) => {
            for (const [id, at] of waits)
                this.armLimitWait(id, at, RESUME_DELAY_MS + LIMIT_GRACE_MS);
        })
            .catch(() => { });
        this.warnedNoSeam = false;
        this.loggedVersion = false;
        // Kept on globalThis so a hot reload of this plugin adopts the running Claude processes
        // instead of orphaning them: their pipes belong to this node process, not to the plugin scope.
        // SAFETY: the registry symbol is this plugin's own key on globalThis, typed here once
        const registry = globalThis;
        this.processes = registry[PROCESS_REGISTRY] ??= new Map(); // providerId:sessionId → ClaudeProcess
        // Shared across mounts, like the processes above: the panel sets a session's permission mode
        // through the default instance's route, and the mount that spawns that session, an SSH box's,
        // for a session on that box's model, is the one that reads it back. A per-instance map left
        // the box spawning under the config default while the shield reported the chosen mode.
        this.permissionModes = registry[PERMISSION_MODE_OVERRIDES] ??= new Map();
        this.turnBuffer = registry[TURN_RECORDS] ??= new Map();
        this.temporary = registry[TEMPORARY_SESSIONS] ??= new Set();
        // Adopted processes still point their idle-reply callback at the previous (now dead) adapter.
        for (const [key, proc] of this.processes) {
            if (!key.startsWith(`${this.providerId}:`))
                continue; // another mount's process, not ours
            const sessionId = key.slice(this.providerId.length + 1);
            proc.onIdleResult = () => this.wake(sessionId, proc);
        }
        // Steers: dsh only delivers them at step boundaries, and a Claude turn has none of its own.
        // Forward them to Claude's stdin as they arrive; the CLI injects them at its next tool call.
        // Everything dsh splices mid-step goes the same way, whoever sent it: a typed steer, a child's
        // send_message, a settlement notice, a job's finish line. Left to the boundary, a step parked
        // on a typed steer forwards only what a person typed and the rest is lost (2026-09-16: three
        // child reports in one session, each spliced a few seconds after a typed steer). During a dsh
        // tool nothing is forwarded; a typed steer is recorded as relayed so the card can edit it in
        // dsh's inbox until the tool ends.
        ctx.on?.("session/event", (sessionArg, eventArg) => {
            // SAFETY: dsh's session/event carries (session, event); only the spliced-inbox fields are read
            const session = sessionArg;
            // SAFETY: same event object, narrowed to the agent/inbox/spliced shape this handler reads
            const event = eventArg;
            if (event?.type !== "agent/inbox/spliced" || event.data?.target !== "next-step")
                return;
            const proc = this.processes.get(registryKey(this.providerId, session?.id ?? ""));
            if (!proc?.alive)
                return;
            // A relay pending means the CLI is inside a dsh tool: dsh keeps the message and staples it to
            // the tool's result at the tool's end (stepContextFor in openTurn), so nothing goes to stdin
            // (written there, the CLI would inject it after the result too, and the park that follows
            // would end a step into an empty inbox: the 2026-09-16 case noted in openTurn). Record it so
            // the card can edit or remove it from dsh's inbox meanwhile. `busy` is not the signal: it
            // drops a few statements after the relay is registered.
            const toolPending = proc.relays.size > 0;
            if (!toolPending && !proc.busy)
                return;
            for (const m of event.data?.inserted ?? []) {
                const key = steerKey(m);
                if (!key)
                    continue;
                // A replace from the steer card re-inserts a message the route already wrote; writing it
                // again would hand Claude the edit twice.
                if (proc.sent.has(key))
                    continue;
                const text = textOf(m.content);
                if (!text)
                    continue;
                if (toolPending) {
                    // Only a text message a person typed is theirs to edit; the rest rides on the result as
                    // today. Nothing on `sent`, `forwarded` or `steerPending`: those drive the stdin park.
                    if (m.source?.kind === "user" &&
                        m.id &&
                        !(Array.isArray(m.content) && m.content.some((b) => b.type !== "text")))
                        proc.steers.set(m.id, { key, text, at: Date.now(), relayed: true });
                    continue;
                }
                // A file or image cannot go over stdin from here: dsh projects a file into its `[File …]`
                // handle only when it assembles the next request, and an image needs the attachment store.
                // Park the step at the CLI's next tool result instead, so dsh delivers the message whole
                // and openTurn writes it; a message that lands after the last tool result rides on the
                // next prompt, since it is never marked sent (found 2026-09-16: a 34 MB zip on a mid-turn
                // message arrived as its text alone, and `sent` then hid it from every later delivery).
                if (Array.isArray(m.content) && m.content.some((b) => b.type !== "text")) {
                    proc.steerPending = true;
                    proc.forwarded += 1;
                    continue;
                }
                const uuid = randomUUID();
                if (proc.write(buildInput(text, [], uuid))) {
                    proc.sent.add(key);
                    proc.steerPending = true;
                    proc.forwarded += 1;
                    // Only what a person typed is theirs to edit; a child's report or a job line is not.
                    if (m.source?.kind === "user" && m.id)
                        proc.steers.set(m.id, { uuid, key, text, at: Date.now() });
                }
            }
            // A splice that removes (a hold, a Stop's clear, dsh's claim at the tool's end) may have taken
            // a message this map still lists as relayed. Drop what dsh no longer holds: on a Stop during
            // a relay the abort listener is already gone, so this is the only signal.
            if ((event.data?.removedCount ?? 0) > 0) {
                let inbox;
                try {
                    inbox = this.ctx?.agents?.get?.(asSessionId(session?.id ?? ""))?.inbox;
                }
                catch {
                    inbox = undefined; // scope reloading: the next splice or the exit clears them
                }
                if (inbox)
                    for (const [id, st] of proc.steers)
                        if (st.relayed && !inbox.nextStep.some((m) => m.id === id))
                            proc.steers.delete(id);
            }
            if (session?.id)
                this.publishAsides(session.id);
        });
    }
    /** dsh's handle for this instance's route. `replace` re-reads `providerInfo`, which is how a
     *  name change reaches the picker without a restart. */
    registration;
    loggedOut = false;
    /** "(not logged in)" after the provider name while the box's claude has no login: dsh copies the
     *  name at registration, so the route is registered again under the new one. Fed by the mount-time
     *  probe and by every login probe the panel runs, so the picker names a dead box at a glance. */
    /**
     * The binary to name for work on `host`: the command as configured when a turn runs on another
     * box, this box's resolved absolute path when it runs here.
     *
     * `localConfig` resolves a bare `claude` against this box's PATH so a dsh started with a short
     * one still finds it. That path means nothing on a far box, and sending it there failed the turn
     * outright: `claude exited 127: env: '/home/lutechi/.local/bin/claude': No such file or
     * directory` on a remote workspace whose provider is the local mount (owner, 2026-09-22). An SSH
     * box mount was never affected, since `localConfig` leaves a box's command alone.
     */
    commandFor(host) {
        return host ? this.configuredCommand : this.config.command;
    }
    /** "(not logged in)" after the provider name while the box's claude has no login: dsh copies the
     *  name at registration, so the route is registered again under the new one. Fed by the mount-time
     *  probe and by every login probe the panel runs, so the picker names a dead box at a glance. */
    setLoggedIn(loggedIn) {
        if (this.loggedOut === !loggedIn)
            return;
        this.loggedOut = !loggedIn;
        try {
            this.registration?.replace([this.providerId]);
        }
        catch (e) {
            this.log("warn", `provider name update: ${errorText(e)}`);
        }
    }
    /** The provider's display name, suffixed "(not logged in)" while the adapter is logged out, so a settings dropdown shows login state. */
    providerInfo(provider) {
        return {
            id: provider,
            name: this.loggedOut
                ? `${this.displayName} (${serverText("notLoggedIn")})`
                : this.displayName,
        };
    }
    /** Read on every listing rather than cached: an edit to settings.json takes effect at once. */
    pickerSettings() {
        return readPickerSettings(join(this.claudeHome, "settings.json"));
    }
    /** A box without a login lists nothing: dsh's catalog drops a provider whose listing throws into
     *  its "could not load" row with a Retry, which is the honest picker for a box no turn can use.
     *  The row names the fix; Retry after the login brings the models back. */
    async listModels(provider) {
        // A box named logged out asks its CLI again before refusing: a login made in a terminal there
        // would otherwise stay hidden until Settings was opened or dsh restarted, and the picker's
        // Retry would keep answering from a stale flag. One `claude auth status` per open while out.
        if (this.loggedOut) {
            forgetIdentity();
            const who = await accountIdentity(this.config.command, this.claudeHome, this.config.sshHost).catch(() => ({ loggedIn: false }));
            if (who.loggedIn)
                this.setLoggedIn(true);
        }
        if (this.loggedOut)
            throw new Error(serverText("loggedOutError", { host: this.config.sshHost || hostname() }));
        await this.cliSeed;
        const models = await getCatalog(undefined, this.cliModels, await this.pickerSettings());
        return models.map((m) => modelInfo(provider, m));
    }
    /** After a `result` frame: remember a login failure for the card, and name the box's providers
     *  logged out so the picker stops offering them; a turn that succeeded clears both. */
    noteTurnLogin(sessionId, result) {
        if (!isLoginFailure(result)) {
            if (!result.is_error) {
                this.loginNeeded.delete(sessionId);
                this.publishAsides(sessionId);
            }
            return;
        }
        const label = this.hostLabelFor(sessionId);
        // This box is the empty string here and in loginDone/logoutBox, one spelling for the compare.
        const host = label ?? "";
        this.loginNeeded.set(sessionId, { host, label: label ?? hostname() });
        this.publishAsides(sessionId);
        // The process that failed carries no usable login in its environment, and it stays alive
        // between turns: reused, it fails again with the token the panel has since stored (seen
        // 2026-09-13: card login said done, the next message was still logged out). Marked stale, the
        // next prompt replaces it and the fresh spawn reads the token.
        const held = this.processes.get(registryKey(this.providerId, sessionId));
        if (held?.alive)
            held.staleContext = true;
        // Every provider whose turns run on that box: this box's own, or the box's saved instance. A
        // remote workspace's turn from a local provider says nothing about the local login.
        // ponytail: a panel token the box refused stays on disk until the owner logs out or in again;
        // deleting it here could drop a good newer token on a process spawned before it was written.
        for (const mount of ClaudeCodeAdapter.mounts(this))
            if ((mount.config.sshHost || "") === host)
                mount.setLoggedIn(false);
    }
    /** Log out on `host` (this box when empty) cuts the cord: every live Claude on that box is killed,
     *  so nothing keeps answering on a login that is gone. A process that loaded the login at start
     *  would otherwise carry it in memory until it exited. Each session resumes from its transcript on
     *  its next message, which then fails for want of a login and shows the card. */
    logoutBox(host) {
        for (const mount of ClaudeCodeAdapter.mounts(this)) {
            if ((mount.config.sshHost || "") !== host)
                continue;
            for (const [key, p] of mount.processes) {
                if (!key.startsWith(`${mount.providerId}:`))
                    continue;
                p.kill();
                mount.processes.delete(key);
            }
            mount.setLoggedIn(false);
        }
    }
    /** Live Claude processes on `host` (this box when empty), across every mount there. The row shows
     *  the count when the box reads logged out: those still answer on the login they loaded at start. */
    liveCount(host) {
        let n = 0;
        for (const mount of ClaudeCodeAdapter.mounts(this)) {
            if ((mount.config.sshHost || "") !== host)
                continue;
            for (const [key, p] of mount.processes)
                if (key.startsWith(`${mount.providerId}:`) && p.alive)
                    n++;
        }
        return n;
    }
    /** A panel login on `host` (this box when empty) succeeded: its providers list models again and
     *  the cards for sessions on that box read done. */
    loginDone(host) {
        for (const mount of ClaudeCodeAdapter.mounts(this))
            if ((mount.config.sshHost || "") === host)
                mount.setLoggedIn(true);
        for (const [sid, need] of this.loginNeeded)
            if (need.host === host) {
                this.loginNeeded.delete(sid);
                this.publishAsides(sid);
            }
    }
    /** Every mounted instance, this one included: at boot or in a test it may not be in the shared
     *  registry yet. */
    static mounts(self) {
        // SAFETY: the registry symbol is this plugin's own key on globalThis, typed here once
        const g = globalThis;
        return new Set([self, ...(g[ADAPTER_CURRENT]?.values() ?? [])]);
    }
    /** No picker filter here: the allowlist curates what the picker offers, and the CLI keeps a
     *  session's own model when the allowlist excludes it rather than failing to resolve it.
     *
     *  The missing `context` is deliberate; see `prepareCall` below for why.
     */
    async resolveModel(provider, model, _signal) {
        const { context: _capacity, ...info } = await this.fullModelInfo(provider, model);
        return info;
    }
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
    async prepareCall(provider, model, _signal) {
        return {
            model: await this.fullModelInfo(provider, model),
            stream: (options) => this.stream(options),
        };
    }
    /** Full metadata for one model, capacity included: the single source both methods above narrow. */
    async fullModelInfo(provider, model) {
        const models = await getCatalog(undefined, this.cliModels);
        const picker = await this.pickerSettings();
        const cap = picker?.modelEffortCaps?.[model] ?? picker?.maxEffortLevel;
        return resolveModelInfo(provider, model, models, cap);
    }
    /** Get the effective permission mode for a session, checking for an override first. */
    getPermissionMode(sessionId, accessMode) {
        const override = this.permissionModes.get(sessionId);
        if (override !== undefined && override !== null) {
            // An override that is no longer allowed under the current ceiling must not win.
            const ceiling = permissionModeFor(this.config, accessMode);
            // SAFETY: permissionModeFor returns a known PermissionMode value from its mapping table.
            const allowed = isPermissionMode(ceiling)
                ? modesUpTo(ceiling)
                : PERMISSION_MODES;
            // SAFETY: override came from the adapter's own permissionModes map which only stores valid modes.
            if (allowed.includes(override))
                return override;
        }
        return permissionModeFor(this.config, accessMode);
    }
    /** The working directory a session runs in, read from its header, or undefined when the session is unknown or its header throws (a detached session cannot be read). */
    sessionCwd(sessionId) {
        try {
            return this.ctx.sessions.get(asSessionId(sessionId))?.header?.cwd;
        }
        catch {
            return undefined;
        }
    }
    /** Emit a names-prefixed log line at the given level, swallowing the error cordis throws when the
     * logger is reached from an inactive scope. A log line is not worth crashing on. */
    log(level, message) {
        try {
            this.ctx.logger[level]?.(`dsh-oh-my-claude: ${message}`);
        }
        catch {
            // cordis throws on service access from an inactive scope; a log line is not worth that
        }
    }
    /** A copy of the image under the plugin's state dir, named by attachment id with the extension
     *  its media type calls for: dsh's own stored object has no extension, and Claude Code's Read
     *  decides image-or-text by the name. Written once per attachment; a failure just leaves the
     *  image inline-only, as before. */
    async keepImageCopy(ref, data) {
        // dsh's ids read `sha256:<hex>`; the hex alone is the file name, and anything else is refused
        // rather than written under a name the id could steer.
        const ext = IMAGE_EXT.get(ref.mediaType);
        const stem = ref.attachmentId.replace(/^sha256:/, "");
        if (!ext || !/^[A-Za-z0-9_-]+$/.test(stem))
            return undefined;
        const dir = join(process.env.DSH_OMC_STATE_DIR ?? STATE_DIR, "attachments");
        const path = join(dir, `${stem}.${ext}`);
        try {
            await access(path);
            return path;
        }
        catch {
            // not there yet
        }
        try {
            await mkdir(dir, { recursive: true });
            await writeFile(path, Buffer.from(data));
            return path;
        }
        catch (error) {
            this.log("warn", `image copy for ${ref.attachmentId} not written: ${String(error)}`);
            return undefined;
        }
    }
    /** The copy itself, as a field so the offline suite can stand in for the ssh. */
    copyToBox = (host, localPath, farName, capMs) => copyToAt({ sshHost: host }, localPath, farName, capMs);
    /** Far paths of what this process has already copied, by box and local path.
     *  ponytail: never forgotten, so a copy deleted on the box stays "there" until dsh restarts. */
    onBoxAlready = new Map();
    /** One attachment's path on `host`, copied there the first time it is asked for. */
    async onBox(host, localPath, farName, capMs) {
        const key = `${host}\n${localPath}`;
        const known = this.onBoxAlready.get(key);
        if (known !== undefined)
            return known;
        const far = await this.copyToBox(host, localPath, farName, capMs);
        this.onBoxAlready.set(key, far);
        return far;
    }
    /** `host` is the box the turn runs on, when it is not this PC: the saved copy the note names has
     *  to be on that box, so it is copied there, and an image that would not copy gets no note (it
     *  still rides inline) rather than one naming a path that box's claude cannot read. */
    async loadImages(refs, signal, host, capMs = COPY_CAP_MS) {
        const store = this.ctx.attachments;
        if (!store || refs.length === 0)
            return [];
        const out = [];
        for (const ref of refs) {
            try {
                const stored = await store.readImage(ref, signal);
                const kept = await this.keepImageCopy(ref, stored.data);
                let path = kept;
                if (kept && host)
                    try {
                        path = await this.onBox(host, kept, basename(kept), capMs);
                    }
                    catch (error) {
                        path = undefined;
                        this.log("warn", `image ${ref.attachmentId} not on ${host}: ${errorText(error)}`);
                    }
                const byPath = oversize(ref) && path !== undefined;
                if (byPath)
                    this.log("info", `image ${ref.attachmentId} is ${ref.width}x${ref.height}, over ${MAX_IMAGE_SIDE}px; sent by path, not inline`);
                out.push({
                    mediaType: ref.mediaType,
                    data: byPath ? "" : Buffer.from(stored.data).toString("base64"),
                    attachmentId: ref.attachmentId,
                    path,
                });
            }
            catch (error) {
                this.log("warn", `skipping image ${ref.attachmentId ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return out;
    }
    /** A dsh fork of a Claude session becomes a Claude fork: the parent's transcript is copied under
     *  the new id, cut at the forked turn. True when a copy was made. */
    async forkTranscript(options, cwd, id) {
        let header;
        try {
            header = options.sessionId ? this.ctx.sessions.get(options.sessionId)?.header : undefined;
        }
        catch {
            return false;
        }
        const parentId = header?.parentSession;
        if (!parentId || header?.origin === "subagent")
            return false;
        const parentCwd = this.sessionCwd(parentId) ?? cwd;
        const parentClaude = (await claudeSessionExists(this.claudeHome, parentCwd, parentId))
            ? parentId
            : claudeSessionId(parentId);
        let text;
        try {
            text = await readFile(join(this.claudeHome, "projects", projectDirName(parentCwd), `${parentClaude}.jsonl`), "utf8");
        }
        catch {
            return false;
        }
        // ponytail: prompt counting assumes one Claude prompt per dsh user turn; a turn dsh skipped
        // as already-forwarded (see dropSent) shifts the cut by one.
        const keep = userPromptCount(options.messages) - userPromptCount(afterLastAssistant(options.messages));
        const dest = join(this.claudeHome, "projects", projectDirName(cwd), `${id}.jsonl`);
        try {
            await mkdir(dirname(dest), { recursive: true });
            await writeFile(dest, forkTranscriptText(text, parentClaude, id, keep));
        }
        catch (error) {
            this.log("warn", `fork transcript copy failed: ${errorText(error)}`);
            return false;
        }
        await rememberStarted(id, true);
        this.log("info", `forked claude session ${parentClaude} -> ${id} (${keep} prompts kept)`);
        return true;
    }
    /** Everything one turn needs: spawn args + spec for the long-lived process, and the stdin line for this turn. */
    // SAFETY: options shape from dsh LlmAdapter.generate() contract
    async prepare(options, { forceFresh = false } = {}) {
        // Title/compaction one-shots run from a scratch dir so their transcripts never show up in a
        // workspace's Claude Code session list.
        const cwd = options.purpose
            ? await auxCwd()
            : (options.sessionId && this.sessionCwd(options.sessionId)) || process.cwd();
        // Probe the binary that will actually run: a box's own claude over ssh when this provider is an
        // SSH box, or when a remote-workspace cwd routes this local provider's session to a box; the local
        // claude otherwise. A one-shot (title/compaction) always runs locally, so it never probes remote.
        const targetHost = boxFor(this.config.sshHost, options.purpose ? undefined : remoteWorkspaceFor(cwd)?.host);
        if (!options.purpose && isOrphanedStandIn(cwd))
            throw new LlmError(`This session belongs to a remote workspace that was removed (${basename(cwd)}), so it has no box to run on. Add the same folder on the same box again from the sidebar's Add workspace, and the session continues there.`, "PROVIDER_ERROR");
        const cli = await probeCli(execFile, this.commandFor(targetHost), targetHost);
        if (!this.loggedVersion) {
            this.loggedVersion = true;
            this.log("info", `claude ${cli.version}, stdin input ${usesStdin(cli.flags) ? "on" : "off"}`);
        }
        // Which binary a turn was measured against, once per target. The plugin's logger goes to dsh's
        // console, which nothing on a box keeps; resume.log is the plugin's own file and is where a
        // "wrong flags for that box" report can be answered with evidence instead of a guess.
        if (!this.probeTraced.has(targetHost ?? "")) {
            this.probeTraced.add(targetHost ?? "");
            void trace(join(this.stateDir, "resume.log"), `probe ${targetHost ?? "local"}: claude ${cli.version}, ${cli.flags?.size ?? "unknown"} flags, cwd ${cwd}`);
        }
        let session;
        const temporary = Boolean(options.sessionId) && this.temporary.has(options.sessionId ?? "");
        if (!options.purpose && this.config.resume && options.sessionId && !temporary) {
            // A dsh session opened from a Claude Code transcript carries the Claude id itself.
            const own = await claudeSessionExists(this.claudeHome, cwd, options.sessionId);
            const id = own ? options.sessionId : claudeSessionId(options.sessionId);
            let known = own ||
                (await loadStarted()).has(id) ||
                (await claudeSessionExists(this.claudeHome, cwd, id));
            if (!known && !forceFresh)
                known = await this.forkTranscript(options, cwd, id);
            session = { id, resuming: known && !forceFresh };
        }
        // One small file read per turn, next to a process spawn. No cache: the Settings card writes
        // this file, and a stale set is a switch that visibly does nothing.
        const hints = await readHints(join(this.stateDir, "hints.json"));
        const drops = contextDrops(hints);
        this.proxyFirstParty = wantsFirstParty(hints, await detectFirstParty());
        const turns = selectTurns(options.messages, session?.resuming ?? false);
        let prompt = buildPrompt(turns, drops);
        // A turn on a box reads that box's disk, so what was attached here follows it there.
        if (targetHost)
            prompt = await relayFileHandles(prompt, (local, farName) => this.onBox(targetHost, local, farName, COPY_CAP_MS), (level, message) => this.log(level, message));
        const stdin = usesStdin(cli.flags);
        const images = stdin ? await this.loadImages(imageRefs(turns), options.signal, targetHost) : [];
        // Where each image lives on disk, after the prompt: the inline copy lets Claude see it, the
        // note lets it Read, edit or delegate it.
        const notes = attachmentNotes(turns, images);
        if (notes)
            prompt = `${prompt}\n\n${notes}`;
        const model = options.purpose === "session-title" ? this.config.titleModel : options.model;
        const accessMode = accessModeOf(options.messages);
        if (options.sessionId) {
            this.accessModes.set(options.sessionId, accessMode);
            if (approvalsDisabled(options.messages))
                this.approvalsOff.add(options.sessionId);
            else
                this.approvalsOff.delete(options.sessionId);
        }
        const effectivePermissionMode = options.sessionId
            ? this.getPermissionMode(options.sessionId, accessMode)
            : undefined;
        // Hoisted out of the buildArgs call: `buildArgs` appends the tools guidance to the system
        // prompt exactly when this bridge is passed, so the size readout has to ask the same question
        // rather than a similar-looking one. A turn that runs on a box gets no bridge: its URL is this
        // dsh's loopback port, which the far side cannot reach, and `dshTools` is per mount while a
        // remote workspace makes a session remote under the local mount (measured on a remote box 2026-09-15:
        // Claude spent its first reply asking for a tool server that was never reachable).
        const mcpBridge = this.mcp && options.sessionId && !options.purpose && this.config.dshTools && !targetHost
            ? { url: `${this.mcp.base}${MCP_PATH}/${options.sessionId}`, key: this.mcp.key }
            : undefined;
        // Side calls (title, compaction) carry no card and no workspace of their own, so they measure
        // nothing; leaving `sizes` undefined is what keeps them out of the store. The guidance also
        // rides on `--append-system-prompt`, so a CLI without that flag sends none of it and the row
        // has to read zero rather than the length of text that stayed home.
        const toolsSent = mcpBridge !== undefined && supports(cli.flags, "--append-system-prompt");
        const sizes = options.purpose
            ? undefined
            : { ...contextSizes(turns), tools: toolsSent ? DSH_TOOLS_GUIDANCE.length : 0 };
        const args = buildArgs({
            ...options,
            model,
            config: this.config,
            session,
            accessMode,
            flags: cli.flags,
            promptText: prompt,
            temporary,
            permissionMode: effectivePermissionMode,
            mcp: mcpBridge,
        });
        // Spec = what a running process was spawned with. `resuming` is deliberately left out: it flips
        // to true after the first turn and must not force a respawn.
        const spec = {
            cwd,
            model,
            effort: options.reasoningEffort ?? null,
            mode: effectivePermissionMode ?? permissionModeFor(this.config, accessMode),
            sessionId: session?.id ?? null,
            temporary,
        };
        // An environment is fixed at spawn, so the switch joins the spec: a session already running
        // when it flips is replaced on its next turn and resumes with the window the switch gives.
        // Local spawns only; the flag does not ride to a box, whose own environment decides.
        if (this.proxyFirstParty && !this.config.sshHost && !remoteWorkspaceFor(cwd))
            spec.firstParty = true;
        return {
            cwd,
            args,
            session,
            spec,
            accessMode,
            input: stdin ? buildInput(prompt, images) : null,
            drops,
            sizes,
        };
    }
    /** Claude slash commands already registered as dsh commands, name → disposer. */
    bridged = new Map();
    /** Sessions already warned that `toolsInline: false` is ignored on a versioned session format. */
    rowsRefused = new Set();
    /** Terminal exchanges the watcher found, by dsh session, each shown as one turn of its own. */
    mirrors = new Map();
    /** Terminal turns being streamed live into an open dsh turn, by dsh session. */
    streaming = new Map();
    /** Whether terminal exchanges are mirrored into dsh at all; the owner's switch, on by default. */
    terminalSync = false;
    /** One transcript watcher per dsh session that finished a turn on this box, by dsh session. */
    watchers = new Map();
    /**
     * This plugin's own commands, which share the `bridged` map so one disposer list covers all of
     * them. They are never Claude's, so the bridge must not register them as passthroughs and the
     * catalog file must not carry them: the catalog is the union of what it held and what was
     * bridged, so once they slipped in, every later boot bridged `/btw` to Claude first and the real
     * handler saw the name taken and stood down (2026-09-08: "/btw isn't available in this environment").
     */
    static OWN_COMMANDS = new Set(["temporary", "btw"]);
    /** dsh session id → the tool names its last init frame reported; absent until one arrives. */
    sessionTools = new Map();
    /** dsh session id → the plugins its last init frame said the CLI failed to load. Absent until an
     *  init frame arrives; a clean load clears it. A session adopted from the keeper after a dsh
     *  restart sees no new init frame, so it reads clean until its next fresh spawn.
     *  ponytail: one entry per live session, dropped by `forgetSession` when its process goes. */
    sessionPluginErrors = new Map();
    /** dsh session id → the plugins its last init frame warned about (loaded, but with a complaint:
     *  a shadowed default folder, a suppressed server. Absent until an init frame arrives; a clean
     *  load clears it. reload_plugins carries no warning_count, so unlike errors these refresh only at
     *  the next spawn's init frame, never on a reload.
     *  ponytail: one entry per live session, dropped by `forgetSession` when its process goes. */
    sessionPluginWarnings = new Map();
    /** dsh session id → the model switch its last turn reported (a safety refusal, a primary-model
     *  fallback, or the usage-credit gate), surfaced through `/side-questions` like `loginNeeded`. One
     *  entry per live session, overwritten on each switch; the client reads it at the stop transition.
     *  ponytail: one entry per live session, dropped by `forgetSession` when its process goes. */
    sessionFallbacks = new Map();
    /** dsh session id → the prompt this session is waiting on, so a background tab can be told. One
     *  entry per session, set when a prompt opens and cleared when it settles. In memory on purpose:
     *  a prompt is live state and a restart re-asks.
     *  ponytail: one entry per live session, dropped by `forgetSession` when its process goes. */
    awaitingInput = new Map();
    /**
     * Register Claude Code's slash commands (from the CLI's init frame) as dsh `/commands`. The
     * handler hands the line to Claude as the next prompt, where the CLI expands the skill or
     * custom command the way the terminal does; dsh keeps its own command of the same name.
     */
    bridgeCommands(names, agent) {
        // Optional service: cordis rejects `ctx.commands` unless it is in `inject`; `get` does not.
        const commands = this.ctx?.get("commands");
        if (!this.config.commandBridge || this.providerId !== "claude-code" || !commands)
            return;
        // SAFETY: a plain slot on globalThis, written only here
        globalThis[COMMAND_CATALOG] = names;
        const failed = [];
        for (const cmd of names) {
            if (ClaudeCodeAdapter.OWN_COMMANDS.has(cmd) || this.bridged.has(cmd))
                continue;
            // Claude's own name where dsh has no answer for it: `/llama` reads as the command it is,
            // where `/claude-llama` read as some other command entirely. The prefix is the fallback.
            //
            // Two ways a taken name hurts, so both are guarded. dsh's registry throws when a second host
            // owns a name, which the catch below turns into the prefixed registration. Its menu throws
            // and blanks, all 200 names at once (2026-09-05), when a host command shadows a client
            // contribution the registry cannot see, so those names never take the bare form at all.
            const prefixed = `${BRIDGE_PREFIX}${cmd}`;
            const dshName = CLIENT_COMMANDS.has(cmd) ? prefixed : cmd;
            if (agent && commands.find(agent, dshName) !== undefined)
                continue;
            const define = (dshCommand) => commands.register({
                name: dshCommand,
                description: `Claude Code /${cmd}`,
                // Attachments are admitted so a skill can be handed a file. They ride in the prompt's
                // content like a typed turn's; dsh-llm turns each file into a path line before any
                // provider sees it, and images reach Claude through imageRefs.
                input: { hint: "<arguments>", attachments: true },
                handler: ({ agent: target, rawInput, attachments }) => {
                    const line = `/${cmd}${rawInput}`;
                    const title = renameTitle(cmd, rawInput);
                    // dsh's title goes first: sending the line and then failing would leave Claude renamed
                    // and dsh not, which is the disagreement this bridge exists to close. A host with no
                    // title service is not that failure, and refusing there would leave the user no way to
                    // rename the Claude side at all, so the line still goes and the reply says what it did.
                    const session = target.session;
                    const titles = this.ctx?.get("sessionTitle");
                    const renamed = title !== undefined && session !== undefined && titles !== undefined;
                    if (renamed)
                        try {
                            titles.rename(session, title);
                        }
                        catch (error) {
                            return { kind: "error", text: `/${cmd}: ${errorText(error)}` };
                        }
                    // The line goes as a user turn, so the transcript shows `/name arguments` as the
                    // bubble the person sent. It went as a plugin-sourced notice before, which dsh draws
                    // as a collapsed context row; the owner found the prompt hard to find in the
                    // transcript that way (2026-09-18). The user form also carries attachment chips.
                    target.followup(createUserMessage({
                        content: [{ type: "text", text: line }, ...attachments],
                        source: { kind: "user" },
                    }));
                    return {
                        kind: "success",
                        text: renamed
                            ? `${line} sent to Claude Code; dsh session renamed to ${title}`
                            : `${line} sent to Claude Code`,
                    };
                },
            });
            try {
                this.bridged.set(cmd, define(dshName));
            }
            catch (error) {
                // The bare name was already someone's. The prefixed one is still worth having: it is what
                // this bridge shipped as, and it cannot collide with a name dsh registered under its own.
                if (dshName === prefixed) {
                    failed.push(`/${cmd}: ${errorText(error)}`);
                    continue;
                }
                try {
                    this.bridged.set(cmd, define(prefixed));
                }
                catch (second) {
                    failed.push(`/${cmd}: ${errorText(second)}`);
                }
            }
        }
        if (failed.length > 0)
            this.log("warn", `command bridge: ${failed.length} of ${names.length} not registered (first: ${failed[0]})`);
        // globalThis carries the catalog across a hot reload; the file carries it across a restart,
        // which adopts the running Claude and so never sees a second init frame.
        //
        // The file is the union of what it already held and what this instance bridged, never one
        // frame's own list. Two things write it: `commands_changed` re-sends the catalog mid-session,
        // and a temporary session's Claude carries a catalog of its own, either can name one command,
        // and dsh re-instantiates this plugin at boot, so a second instance starts with an empty
        // `bridged` map. Both wrote a menu of one over a menu of 152.
        void loadCommandCatalog(this.stateDir).then((saved) => saveCommandCatalog(this.stateDir, [...new Set([...saved, ...this.bridged.keys()])].filter((cmd) => !ClaudeCodeAdapter.OWN_COMMANDS.has(cmd))));
        this.registerTemporaryCommand(commands);
        this.registerAsideCommand(commands);
    }
    /** The effective mode for a session and the stored override, for the header chip. */
    /**
     * The session's dsh access mode right now: the shield's current preset from dsh's own service
     * when it is mounted (a pick there is live at once), else the last runtime-context snapshot.
     */
    currentAccessMode(sessionId) {
        try {
            const session = this.ctx.sessions.get(asSessionId(sessionId));
            const preset = session ? this.permissionPresets?.current(session) : undefined;
            if (preset && modeForAccess(preset) !== undefined)
                return preset;
        }
        catch {
            // no session yet, or the service is not mounted: fall through
        }
        return this.accessModes.get(sessionId) ?? null;
    }
    /** The permission mode a session may use now: its stored override on top of the shield's access mode, with the config default as the floor and every mode up to the ceiling allowed. */
    permissionModeInfo(sessionId) {
        const override = this.permissionModes.get(sessionId) ?? null;
        const accessMode = this.currentAccessMode(sessionId);
        // The shield's mapping is the ceiling; before the first prompt names an access mode the
        // config's own default applies, never the loosest mode.
        const ceiling = permissionModeFor(this.config, accessMode ?? undefined);
        const allowed = isPermissionMode(ceiling) ? modesUpTo(ceiling) : PERMISSION_MODES;
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        return {
            mode: this.getPermissionMode(sessionId, accessMode ?? undefined),
            override,
            accessMode,
            ceiling,
            allowed,
            liveMode: proc?.alive ? proc.liveMode : null,
        };
    }
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
    async setPermissionMode(sessionId, mode) {
        const reply = await this.applyPermissionMode(sessionId, mode);
        this.publishPermissionMode(sessionId);
        return reply;
    }
    /** The body of `setPermissionMode` without the publish: every return path, refused or applied,
     *  ends in the same event so the capsule reads the mode the process is really in. */
    async applyPermissionMode(sessionId, mode) {
        let info = this.permissionModeInfo(sessionId);
        if (mode !== null && !isPermissionMode(mode))
            return { ...info, live: false, error: `unknown mode "${mode}"` };
        if (mode !== null && !info.allowed.includes(mode))
            return {
                ...info,
                live: false,
                error: `${mode} is looser than dsh's ${info.accessMode ?? "current"} access (${info.ceiling}); change the shield first`,
            };
        await savePermissionMode(this.stateDir, sessionId, mode);
        if (mode === null)
            this.permissionModes.delete(sessionId);
        else
            this.permissionModes.set(sessionId, mode);
        info = this.permissionModeInfo(sessionId);
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ...info, live: false };
        if (info.mode === "bypassPermissions" && proc.spec.mode !== "bypassPermissions")
            return { ...info, live: false };
        // 5 s: the CLI answers at once when it reads stdin; a longer wait would only stall the chip.
        const reply = await this.control(proc, { subtype: "set_permission_mode", mode: info.mode }, 5000);
        if (!reply.ok)
            return { ...info, live: true, error: reply.error };
        proc.liveMode = info.mode;
        return { ...this.permissionModeInfo(sessionId), live: true };
    }
    /**
     * Remember the mode a transcript ran under as the session's override, with no ceiling check and
     * no live switch: the caller is opening a past CLI session in dsh, and `getPermissionMode` clamps
     * the override to dsh's access mode at every spawn, so a bypass transcript opened under a
     * workspace-write shield runs as acceptEdits. An unknown mode is ignored.
     */
    async restorePermissionMode(sessionId, mode) {
        if (!isPermissionMode(mode))
            return;
        await savePermissionMode(this.stateDir, sessionId, mode);
        this.permissionModes.set(sessionId, mode);
        this.publishPermissionMode(sessionId);
    }
    /**
     * A spec that differs from the live process only by model is switched in place with a
     * `set_model` control request, so a model flip keeps the process and its MCP bridge instead of
     * a kill and `--resume`. Anything else (cwd, effort, mode, session flags) still respawns: the CLI
     * has no live seam for `--effort`. On success the process carries the new spec and key.
     * ponytail: the keeper's spec.json keeps the old model; a reattach after a dsh restart sees a key
     * mismatch and respawns with --model, which is correct, only one spawn later than ideal.
     */
    async retarget(proc, spec) {
        if (specKey({ ...proc.spec, model: spec.model }) !== specKey(spec))
            return false;
        const reply = await this.control(proc, { subtype: "set_model", model: spec.model ?? null }, 5000);
        if (!reply.ok) {
            this.log("warn", `set_model ${spec.model ?? "default"} refused: ${reply.error}; respawning`);
            return false;
        }
        proc.spec = spec;
        proc.key = specKey(spec);
        return true;
    }
    /** Hand a `control_response` to whoever sent the request; true when someone was waiting. */
    resolveControl(event) {
        if (event.type !== "control_response")
            return false;
        const id = event.response?.request_id ?? event.request_id;
        const waiter = this.controlWaiters.get(id);
        if (!waiter)
            return false;
        this.controlWaiters.delete(id);
        if (event.response?.subtype === "error")
            waiter({ ok: false, error: errorText(event.response.error) });
        else
            waiter({ ok: true, response: toJsonValue(event.response?.response) });
        return true;
    }
    /**
     * Send one control request and wait for its answer. The process hands `control_response` lines
     * to `resolveControl` as they arrive, so this works between turns as well as inside one.
     */
    control(proc, request, timeoutMs = 15_000) {
        proc.controlListener ??= (event) => this.resolveControl(event);
        const requestId = `omc-${randomUUID()}`;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.controlWaiters.delete(requestId);
                resolve({
                    ok: false,
                    error: `no reply from claude within ${Math.round(timeoutMs / 1000)}s`,
                });
            }, timeoutMs);
            this.controlWaiters.set(requestId, (r) => {
                clearTimeout(timer);
                resolve(r);
            });
            if (!proc.write(controlRequestLine(requestId, request))) {
                clearTimeout(timer);
                this.controlWaiters.delete(requestId);
                resolve({ ok: false, error: "claude process is not accepting input" });
            }
        });
    }
    /** What the steer card shows: typed steers still in the CLI's queue, oldest first, and the ones
     *  taken back for an edit. A call from the card's own read (`touch`, the default) re-arms every
     *  hold's timer, so a hold nobody reads (a closed tab) goes back to Claude unchanged after
     *  `HOLD_IDLE_MS`; a publish passes `touch: false`, since the turn loop publishes at every tool
     *  boundary and would otherwise keep a closed tab's hold alive for the whole turn. `inTool` says
     *  the CLI is inside a dsh tool, which blocks Send now for every row. */
    steersFor(sessionId, touch = true) {
        const holds = this.heldSteers.get(sessionId);
        if (touch)
            for (const [holdId, hold] of holds ?? []) {
                clearTimeout(hold.timer);
                hold.timer = this.holdTimer(sessionId, holdId);
            }
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        const waiting = proc?.alive
            ? [...proc.steers]
                .map(([id, s]) => {
                // The key is absent, not false, for a stdin steer, so its JSON is what it was.
                const row = { id, text: s.text, at: s.at };
                if (s.relayed)
                    row.relayed = true;
                return row;
            })
                .toSorted((a, b) => a.at - b.at)
            : [];
        const state = {
            waiting,
            held: [...(holds ?? [])].map(([id, h]) => ({ id, text: h.text })),
        };
        // Present only while true: the JSON of a session with no relay pending is what it was.
        if (inRelay(proc))
            state.inTool = true;
        return state;
    }
    /** The timer that restores a hold its card stopped polling for. */
    holdTimer(sessionId, holdId) {
        const timer = setTimeout(() => {
            void this.releaseHold(sessionId, holdId, "restore").catch(() => { });
        }, HOLD_IDLE_MS);
        timer.unref?.();
        return timer;
    }
    /**
     * Take typed steers back from Claude so someone can edit them, several at once when asked (the
     * card's Edit all, the CLI's up-arrow). Each is cancelled in the CLI first; a relayed one (dsh
     * holds it, the CLI never saw it) skips the cancel and leaves the inbox directly; one the CLI already
     * took is skipped, and one dsh already drew as sent (the park won the race) goes straight back to
     * Claude. The rest leave dsh's inbox too, so nothing delivers them while the edit is open, and
     * wait in a hold until `releaseHold`. When nothing forwarded is left in the CLI's queue the park
     * flag drops, or the next tool result would end the step on an empty inbox.
     */
    async holdSteers(sessionId, ids) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: false, reason: "gone" };
        const order = ids
            .map((id) => ({ id, waiting: proc.steers.get(id) }))
            .filter((e) => e.waiting !== undefined)
            .toSorted((a, b) => a.waiting.at - b.waiting.at);
        if (order.length === 0)
            return { ok: false, reason: "sent" };
        const inbox = (await this.agentFor(sessionId))?.agent.inbox;
        const messages = [];
        const texts = [];
        let error;
        for (const { id, waiting } of order) {
            if (waiting.relayed) {
                // Never written to the CLI: dsh's inbox is the only copy. Out of it, or already claimed for
                // the relay result, in which case Claude reads it with the result and the card says sent.
                proc.steers.delete(id);
                this.publishAsides(sessionId);
                const message = inbox?.nextStep.find((m) => m.id === id);
                if (!message || !inbox?.remove(id))
                    continue;
                messages.push(message);
                texts.push(waiting.text);
                continue;
            }
            const reply = await this.control(proc, { subtype: "cancel_async_message", message_uuid: waiting.uuid }, 5_000);
            if (!reply.ok) {
                error = reply.error;
                break;
            }
            proc.steers.delete(id);
            this.publishAsides(sessionId);
            if (!decodeCancelled(reply.response))
                continue; // Claude has it now
            proc.forwarded = Math.max(0, proc.forwarded - 1);
            const message = inbox?.nextStep.find((m) => m.id === id);
            if (!message || !inbox?.remove(id)) {
                // dsh already drew it as sent: give Claude its copy back so chat and Claude agree. With the
                // turn over, stdin would start a turn of its own; out of `sent`, dsh's delivery carries it.
                if (proc.busy && proc.write(buildInput(waiting.text, [], randomUUID()))) {
                    proc.forwarded += 1;
                    proc.steerPending = true;
                }
                else
                    proc.sent.delete(waiting.key);
                continue;
            }
            proc.sent.delete(waiting.key);
            messages.push(message);
            texts.push(waiting.text);
        }
        if (proc.forwarded === 0)
            proc.steerPending = false;
        const first = messages[0];
        if (!first)
            return error ? { ok: false, reason: "error", error } : { ok: false, reason: "sent" };
        const text = texts.join("\n");
        const holds = this.heldSteers.get(sessionId) ?? new Map();
        this.heldSteers.set(sessionId, holds);
        holds.set(first.id, { messages, text, timer: this.holdTimer(sessionId, first.id) });
        this.publishAsides(sessionId);
        return { ok: true, holdId: first.id, text };
    }
    /**
     * End a hold. `restore` puts every held message back as it was, `drop` discards them, and a text
     * sends one message in their place (the first one's identity, the new words). Going back is dsh's
     * own steer, so a turn still running forwards it to Claude like any steer and an idle session
     * starts a turn for it. When the session cannot be reached the hold stays, for a retry.
     */
    async releaseHold(sessionId, holdId, how) {
        const holds = this.heldSteers.get(sessionId);
        const hold = holds?.get(holdId);
        if (!holds || !hold)
            return { ok: false, reason: "gone" };
        clearTimeout(hold.timer);
        holds.delete(holdId);
        if (holds.size === 0)
            this.heldSteers.delete(sessionId);
        this.publishAsides(sessionId);
        if (how === "drop")
            return { ok: true };
        const agent = (await this.agentFor(sessionId))?.agent;
        if (!agent?.steer) {
            const back = this.heldSteers.get(sessionId) ?? new Map();
            this.heldSteers.set(sessionId, back);
            back.set(holdId, { ...hold, timer: this.holdTimer(sessionId, holdId) });
            this.publishAsides(sessionId);
            return { ok: false, reason: "error", error: "session not reachable" };
        }
        const first = hold.messages[0];
        const out = how === "restore" || !first
            ? hold.messages
            : [{ ...first, content: [{ type: "text", text: how.text }] }];
        for (const m of out)
            agent.steer(m);
        return { ok: true };
    }
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
    async sendSteerNow(sessionId, ids) {
        // Inside a dsh tool the cut would abort the tool, reject the relay and kill the CLI on the next
        // turn (the abandon path). Refuse before taking anything back, for every row, since a steer the
        // CLI queued before the tool call is blocked by the same tool.
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (inRelay(proc))
            return { ok: false, reason: "relayed" };
        const held = await this.holdSteers(sessionId, ids);
        if (!held.ok)
            return held;
        const agent = (await this.agentFor(sessionId))?.agent;
        if (!agent?.cancel || !agent.whenIdle) {
            await this.releaseHold(sessionId, held.holdId, "restore");
            return { ok: false, reason: "error", error: "this dsh cannot cut a turn short" };
        }
        agent.cancel({ kind: "user" }, { keepInbox: true });
        // A CLI that ignores the interrupt is killed after INTERRUPT_GRACE_MS by the abort path; this
        // waits a little past that rather than for ever, then sends anyway.
        await Promise.race([
            agent.whenIdle(),
            new Promise((resolve) => setTimeout(resolve, INTERRUPT_GRACE_MS + 5_000).unref?.()),
        ]);
        return this.releaseHold(sessionId, held.holdId, "restore");
    }
    /**
     * Rewind a session to one of its user prompts: `rewind_files` (dry run first, from the UI) puts
     * the working tree back, then `rewind_conversation` drops Claude's context after that prompt.
     * dsh's own transcript is not touched.
     */
    async rewind(sessionId, uuid, dryRun) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return {
                ok: false,
                dryRun,
                error: "no live Claude process for this session; send a prompt first",
            };
        const files = await this.control(proc, {
            subtype: "rewind_files",
            user_message_id: uuid,
            dry_run: dryRun,
        });
        if (!files.ok)
            return { ok: false, dryRun, error: files.error };
        const r = decodeRewindResult(files.response);
        const reply = { ...r, ok: r.canRewind, dryRun };
        if (dryRun || !reply.ok)
            return reply;
        const conv = await this.control(proc, {
            subtype: "rewind_conversation",
            target_message_uuid: uuid,
        });
        if (!conv.ok)
            return { ...reply, ok: false, error: `files rewound, conversation not: ${conv.error}` };
        return reply;
    }
    /**
     * dsh's session-title request, served by the session's live Claude process through the
     * `generate_session_title` control request instead of a second one-shot spawn on `titleModel`.
     * `persist: true` also names Claude's own session, so `claude --resume` shows the same title.
     * Undefined when there is no live process or the CLI declines; the caller then falls back to
     * the one-shot path.
     */
    async titleFromCli(sessionId, description) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive || !description)
            return undefined;
        const reply = await this.control(proc, { subtype: "generate_session_title", description, persist: true }, 10_000);
        if (!reply.ok) {
            this.log("info", `generate_session_title declined: ${reply.error}; using ${this.config.titleModel}`);
            return undefined;
        }
        return decodeTitle(reply.response);
    }
    /**
     * Ask a freshly spawned process for the CLI's model picker once per boot and hand it to the
     * catalog; the answer arrives before the first prompt is even read. A failure leaves the API
     * and known models in place.
     */
    cliModelsAt = 0;
    /** The Settings control "Proxy reaches Anthropic" (the `proxyFirstParty` pair in the hints
     *  store) resolved against what the endpoint answered, read with the other hints before each
     *  spawn. On auto, which is the default, the endpoint decides; a chosen setting outranks it. */
    proxyFirstParty = false;
    /** The disk seed, awaited by the first listing so a boot never answers from the floor by a race. */
    cliSeed;
    /** Ask a live CLI for its model lineup once per TTL window and cache it, so the listing has rows before the next list_models answers; false when throttled, declined, or empty. */
    async refreshCliModels(proc) {
        if (Date.now() - this.cliModelsAt < CATALOG_TTL_MS)
            return false;
        this.cliModelsAt = Date.now();
        const reply = await this.control(proc, { subtype: "list_models" }, 10_000);
        if (!reply.ok) {
            this.log("info", `list_models declined: ${reply.error}`);
            return false;
        }
        const models = decodeCliModels(reply.response);
        if (models.length === 0)
            return false;
        this.cliModels = models;
        void this.persistCliModels(models);
        return true;
    }
    /**
     * The CLI's lineup is kept on disk, per box, so a fresh dsh-web lists the same rows before any
     * process has answered `list_models`. Without it the first listing lacks every `[1m]` alias, and
     * dsh loads one catalog per host generation: a session bound to `claude-fable-5-1[1m]` then shows
     * the raw id in the composer seat and stays that way until the page reloads.
     */
    cliModelsPath() {
        return join(this.stateDir, "cli-models.json");
    }
    /** Persist the CLI's model list to disk under the state dir; a read-only state dir or full disk is swallowed, since the live answer still serves this boot. */
    async persistCliModels(models) {
        try {
            await mkdir(this.stateDir, { recursive: true });
            await writeFile(this.cliModelsPath(), JSON.stringify(models));
        }
        catch {
            /* read-only state dir or full disk: the live answer still served this boot */
        }
    }
    /** Seed from the last answer, unless a process has already answered this boot. */
    async seedCliModels() {
        try {
            const rows = decodeCliModels({
                models: JSON.parse(await readFile(this.cliModelsPath(), "utf8")),
            });
            if (rows.length > 0 && this.cliModels.length === 0)
                this.cliModels = rows;
        }
        catch {
            /* no cache yet or unreadable: the API and known models answer until a process does */
        }
    }
    /** Get the current model catalog for advisor selection. */
    async getAdvisorModels() {
        const models = await getCatalog(fetch, this.cliModels);
        return models.map((m) => ({ id: m.id, name: m.name }));
    }
    /** The MCP servers of a session's live process (`mcp_status`). */
    async mcpStatus(sessionId) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: false, error: "no live Claude process for this session" };
        const reply = await this.control(proc, { subtype: "mcp_status" }, 10_000);
        if (!reply.ok)
            return { ok: false, error: reply.error };
        // `asking` is ours, not the CLI's: `mcp_status` reports connection, never the permission
        // override. Stamped on every row so the panel's button reads the process rather than the memory
        // of the tab that clicked it.
        const servers = decodeMcpStatus(reply.response).map((s) => ({
            ...s,
            asking: proc.mcpAsking.has(s.name),
        }));
        // `mcp_status` does not report tools; the init frame does. Without one the field stays absent,
        // which the panel reads as "unknown" rather than as "this server contributes nothing".
        const tools = this.sessionTools.get(sessionId);
        if (tools === undefined)
            return { ok: true, servers };
        const byServer = mcpToolsByServer(servers.map((s) => s.name), tools);
        return {
            ok: true,
            servers: servers.map((s) => ({ ...s, tools: byServer.get(s.name) ?? [] })),
        };
    }
    /** Ask a session's live process to reconnect one MCP server (`mcp_reconnect`). */
    async mcpReconnect(sessionId, serverName) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: false, error: "no live Claude process for this session" };
        const reply = await this.control(proc, { subtype: "mcp_reconnect", serverName }, 15_000);
        return reply.ok ? { ok: true } : { ok: false, error: reply.error };
    }
    /** Start an OAuth login for one MCP server (`mcp_authenticate`). The reply carries the page the
     *  browser must open; the CLI's own loopback catches the redirect and stores the token, so the
     *  plugin keeps nothing. The case this gets wrong if written naively: a server whose token is
     *  still good answers success with no page, which is a login that needed nothing rather than a
     *  failure. */
    async mcpAuthenticate(sessionId, serverName) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: false, error: "no live Claude process for this session" };
        const reply = await this.control(proc, { subtype: "mcp_authenticate", serverName }, 20_000);
        if (!reply.ok)
            return { ok: false, error: reply.error };
        const url = mcpAuthUrl(reply.response);
        if (url !== undefined)
            return { ok: true, authUrl: url };
        if (mcpAuthNeedsNothing(reply.response))
            return { ok: true };
        return { ok: false, error: "the CLI answered without a sign-in page" };
    }
    /** Pin one MCP server's tools back to asking, or clear the pin
     *  (`set_mcp_permission_mode_override`). Tighten-only over this channel: the CLI accepts
     *  `default`, `auto` and null and rejects the rest without changing state, so this offers the two
     *  ends. It lives in the process's own tool-permission context, so it dies with the process, and
     *  it is read only when the session's mode would otherwise auto-allow. */
    async setMcpAsk(sessionId, serverName, ask) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: false, error: "no live Claude process for this session" };
        const reply = await this.control(proc, { subtype: "set_mcp_permission_mode_override", serverName, mode: ask ? "default" : null }, 10_000);
        if (!reply.ok)
            return { ok: false, error: reply.error };
        // Recorded only once the process took it, so the panel never lights a button for an override
        // that was refused. This is what `mcpStatus` reads back: without it the lit state would live in
        // whichever tab did the clicking, and a refresh or a second browser would show the server as
        // auto-allowing while it is in fact asking.
        if (ask)
            proc.mcpAsking.add(serverName);
        else
            proc.mcpAsking.delete(serverName);
        return { ok: true };
    }
    /** Ask a session's live process to re-read plugins, commands, agents and their MCP servers from
     *  disk (`reload_plugins`), so an enable, uninstall or marketplace change the CLI just wrote to
     *  settings takes effect now instead of at the next spawn. No live process is not a failure: the
     *  write landed and the next spawn will read it, so `live` is false and there is nothing to say. */
    async reloadPlugins(sessionId) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: true, live: false };
        const reply = await this.control(proc, { subtype: "reload_plugins" }, 15_000);
        // reload_plugins returns a fresh error_count (probe 2026-09-19), not the detailed array and no
        // new init frame. Zero means every load error is gone, so clear the banner now; a non-zero
        // leaves the last init's detail standing until the next spawn carries fresh detail.
        if (reply.ok && numberOf(reply.response, "error_count") === 0)
            this.sessionPluginErrors.delete(sessionId);
        return reply.ok ? { ok: true, live: true } : { ok: false, live: true, error: reply.error };
    }
    /** Ask a session's live process to re-read skills from disk (`reload_skills`), so a skill just
     *  created, edited or removed applies now. The reply lists the skills and the process emits a
     *  `commands_changed` frame, which the init handler bridges into dsh's slash menu, so a new
     *  skill's `/name` registers live. A dead process is not a failure: the next spawn reads the
     *  file, so `live` is false and there is nothing to say. */
    async reloadSkills(sessionId) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: true, live: false };
        const reply = await this.control(proc, { subtype: "reload_skills" }, 15_000);
        return reply.ok ? { ok: true, live: true } : { ok: false, live: true, error: reply.error };
    }
    /** The plugin load errors this session's last init frame reported, for the panel. */
    pluginErrorsFor(sessionId) {
        return this.sessionPluginErrors.get(sessionId) ?? [];
    }
    /** The plugin warnings this session's last init frame reported, for the panel. */
    pluginWarningsFor(sessionId) {
        return this.sessionPluginWarnings.get(sessionId) ?? [];
    }
    /** The open prompts, keyed by dsh session id, for the browser's background notices. */
    awaitingSnapshot() {
        return Object.fromEntries(this.awaitingInput);
    }
    /** The open prompts across every mount, which is what `/awaiting` and the `awaiting` event
     *  serve: a box's session holds its prompt on the box's instance, so the root's own map alone
     *  would miss it. On a box with one mount this is `awaitingSnapshot()`. */
    awaitingAll() {
        return Object.fromEntries([...ClaudeCodeAdapter.mounts(this)].flatMap((m) => Object.entries(m.awaitingSnapshot())));
    }
    /** The running turn's figures for the status row, read from the session's mount, or the empty
     *  object when no turn is running (the adapter drops the record the moment a turn ends). The
     *  ages are relative to now; the tab adds the time since it received the body. `thinkingMs` is
     *  how long the open thinking burst has run, absent when none is open; `idleMs` is the time
     *  since the last frame of model output; `tool` says a call is in flight; `relayName` and
     *  `relayMs` name the dsh tool a parked turn waits on and for how long. */
    liveTurnReply(sessionId) {
        const live = this.ownerFor(sessionId).liveTurn.get(sessionId);
        if (!live)
            return {};
        const now = Date.now();
        const open = live.thinkingOpen === true && live.thinkingAt !== undefined;
        const r = {
            tokens: (live.output ?? 0) + (live.thinking ?? 0),
            // How long the turn has been running. dsh drew its own clock beside the status row up to
            // 0.1.6; 0.1.7 folded it into one sentence inside the turn-process button, which the status
            // line replaces, so the figure comes from the turn record instead of off the page.
            elapsedMs: now - live.at,
            tool: live.tool === true,
            mode: live.mode ?? "requesting",
        };
        if (open)
            r.thinkingMs = now - live.thinkingAt;
        if (live.frameAt !== undefined)
            r.idleMs = now - live.frameAt;
        if (live.thoughtMs !== undefined)
            r.thoughtMs = live.thoughtMs;
        if (live.thoughtAt !== undefined)
            r.thoughtAgoMs = now - live.thoughtAt;
        if (live.effort !== undefined)
            r.effort = live.effort;
        if (live.relay) {
            r.relayName = live.relay.name;
            r.relayMs = now - live.relay.at;
        }
        return r;
    }
    /** A session's turn records from its mount, oldest first, with their sums. An empty list is
     *  "no records to hand out right now", which the tab treats as nothing to replace: the buffer
     *  is empty for a moment after a restart until the saved records load. */
    turnsReply(sessionId) {
        const turns = this.ownerFor(sessionId).turnBuffer.get(sessionId) ?? [];
        const total = {
            costUsd: 0,
            durationMs: 0,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            count: 0,
        };
        for (const t of turns) {
            total.costUsd += t.costUsd;
            total.durationMs += t.durationMs;
            total.input += t.input;
            total.output += t.output;
            total.cacheRead += t.cacheRead;
            total.cacheWrite += t.cacheWrite;
            total.count += 1;
        }
        return { turns, total };
    }
    /** The aside ring, the login card, the fallback note and the steer card for one session, each
     *  read from the mount that holds it: the ring, the login need and the fallback live on the
     *  session's owner, the waiting steers on whichever mount has its live process (the root when
     *  none is live, since a held steer sits on the mount that took it). */
    asidesReply(sessionId, touch = true) {
        const o = this.ownerFor(sessionId);
        return {
            items: o.sideQuestions.get(sessionId) ?? [],
            loginNeeded: o.loginNeeded.get(sessionId) ?? null,
            fallback: o.sessionFallbacks.get(sessionId) ?? null,
            steers: (this.ownerIfLive(sessionId) ?? this).steersFor(sessionId, touch),
        };
    }
    /** When the idle watchdog would end the session's process (null: not armed), from the mount
     *  that runs it, with the configured timeout so the tab can draw the countdown. */
    idleReply(sessionId) {
        return {
            deadline: this.ownerFor(sessionId).idleDeadlineMap.get(sessionId) ?? null,
            timeoutMs: this.config.idleTimeoutMs,
        };
    }
    /** The permission mode info the capsule draws, from the session's mount, with the pickable modes
     *  under the `modes` name the client reads. */
    permissionModeReply(sessionId) {
        const info = this.ownerFor(sessionId).permissionModeInfo(sessionId);
        return { ...info, modes: info.allowed };
    }
    /** Everything a tab needs the moment its event stream opens: the tab-wide awaiting map always,
     *  and for the open session its live turn, asides, idle deadline, turn records and permission
     *  mode. Hints are not here: the tab reads them on mount already. A reconnect gets the same
     *  snapshot in place of a replay, since every kind is a current value. */
    snapshot(sessionId) {
        const out = [{ kind: "awaiting", session: null, data: this.awaitingAll() }];
        if (sessionId === null)
            return out;
        out.push({ kind: "live-turn", session: sessionId, data: this.liveTurnReply(sessionId) });
        out.push({ kind: "asides", session: sessionId, data: this.asidesReply(sessionId) });
        out.push({ kind: "idle", session: sessionId, data: this.idleReply(sessionId) });
        out.push({ kind: "turns", session: sessionId, data: this.turnsReply(sessionId) });
        out.push({
            kind: "permission-mode",
            session: sessionId,
            data: this.permissionModeReply(sessionId),
        });
        return out;
    }
    /** The tab-wide awaiting map to every stream, merged over every mount: a prompt opened or
     *  answered anywhere. A mount publishing only its own map would make a tab forget the root's
     *  prompts on the next box event. */
    publishAwaiting() {
        hub.publish({ kind: "awaiting", session: null, data: this.awaitingAll() });
    }
    /** The asides body for one session to its streams, read from the session's mount. A publish
     *  does not re-arm hold timers (`touch: false`); only the card's own read does. */
    publishAsides(sessionId) {
        hub.publish({ kind: "asides", session: sessionId, data: this.asidesReply(sessionId, false) });
    }
    /** The idle deadline for one session, coalesced to once a second: the turn loop re-arms the
     *  watchdog on every frame. `key` is the session id, except the aux decide stream's `aux-`
     *  keys, which share the map and reach no tab. */
    publishIdle(key) {
        if (key.startsWith("aux-"))
            return;
        hub.coalesce(`idle:${key}`, () => ({ kind: "idle", session: key, data: this.idleReply(key) }));
    }
    /** The permission mode state for one session to its streams: after a pick, a restore or a
     *  spawn, which is when `liveMode` changes. */
    publishPermissionMode(sessionId) {
        hub.publish({
            kind: "permission-mode",
            session: sessionId,
            data: this.permissionModeReply(sessionId),
        });
    }
    /** The CLI's working-tree diff (`get_workspace_diff`) for a session with a live process. */
    async workspaceDiff(sessionId) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: false, error: "no live Claude process for this session" };
        const reply = await this.control(proc, { subtype: "get_workspace_diff" }, 10_000);
        if (!reply.ok)
            return { ok: false, error: reply.error };
        return { ok: true, ...decodeWorkspaceDiff(reply.response) };
    }
    /** The permission rules and hooks a session's live process actually loaded
     *  (`list_permission_rules`, `get_hooks_listing`), read-only. Both or neither: the readout is one
     *  section pair and a half-answer would read as an empty half. */
    async permissionReadout(sessionId) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: false, error: "no live Claude process for this session" };
        const [rules, hooks] = await Promise.all([
            this.control(proc, { subtype: "list_permission_rules" }, 10_000),
            this.control(proc, { subtype: "get_hooks_listing" }, 10_000),
        ]);
        if (!rules.ok)
            return { ok: false, error: rules.error };
        if (!hooks.ok)
            return { ok: false, error: hooks.error };
        // Both decoders take `undefined` without throwing, so a payload the CLI reshapes reads as an
        // empty list rather than a 500. `// SAFETY:` is for assertions and there are none here.
        return {
            ok: true,
            ...decodePermissionRules(rules.response),
            ...decodeHooksListing(hooks.response),
        };
    }
    /**
     * The CLI's own context breakdown (`/context` in the TUI) for a session with a live process;
     * answered between turns as well as inside one. 5 s: the CLI replies at once when it reads stdin.
     */
    /** The CLI's own skill report (`/skill-doctor`, the same code path as `/plugin stats`): what each
     *  skill costs in context and how often it has run. A throwaway one-shot in the session's
     *  workspace cwd so project skills show, reading the raw `result` frame; it spends no model tokens
     *  (the command is synthetic, measured 2026-09-19 returning at 2.3 s with no model turn). Not a
     *  control request, and not `prepare`'s purpose branch, which forces a scratch cwd. */
    async skillDoctor(sessionId) {
        const cwd = this.sessionCwd(sessionId) ?? process.cwd();
        const host = boxFor(this.config.sshHost, remoteWorkspaceFor(cwd)?.host);
        const cli = await probeCli(execFile, this.commandFor(host), host);
        if (!cli.flags)
            return { ok: false, error: "skill report failed to start: no claude binary on this box" };
        // Without --no-session-persistence a one-shot leaves a transcript under the workspace's project
        // dir; on a CLI too old for the flag, run in a scratch dir instead (user skills only).
        const persist = supports(cli.flags, "--no-session-persistence");
        const runCwd = persist ? cwd : await auxCwd();
        const model = this.processes.get(registryKey(this.providerId, sessionId))?.spec?.model ??
            this.config.titleModel;
        // buildArgs' session-title purpose returns exactly the arg list a probe confirmed returns the
        // report (-p, stream-json in/out, --verbose, --model, --tools "" --max-turns 1, and
        // --no-session-persistence when supported); `session-title` is a valid purpose, so no new enum.
        const args = buildArgs({
            purpose: "session-title",
            model,
            config: this.config,
            flags: cli.flags,
        });
        const proc = new ClaudeProcess({
            args,
            cwd: runCwd,
            spec: {
                cwd: runCwd,
                model: model ?? "",
                effort: null,
                mode: "plan",
                sessionId: null,
                temporary: false,
            },
            command: this.config.command,
            spawner: this.spawner(),
            onExit: () => { },
        });
        proc.write(buildInput("/skill-doctor", []));
        proc.child.stdin.end();
        let timer;
        try {
            return await Promise.race([
                (async () => {
                    for (;;) {
                        const event = await proc.nextEvent();
                        if (event === null || event.type === "result")
                            return skillDoctorReply(event && event.type === "result" ? event : null, !persist, `skill report failed to start: ${(proc.stderr || proc.stray).trim() || `claude exited ${proc.exitCode}`}`);
                    }
                })(),
                new Promise((resolve) => {
                    timer = setTimeout(() => resolve({ ok: false, error: "the skill report timed out" }), 20000);
                }),
            ]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
            proc.kill();
        }
    }
    /** Ask the CLI how many tokens this session's context window holds, bank the figure for dsh's context ring under both the spec and CLI model names, and flag an assumed-behind window when this box runs behind a proxy. */
    async contextUsage(sessionId) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: false, error: "no live Claude process for this session" };
        const reply = await this.control(proc, { subtype: "get_context_usage", detail: "summary" }, 5000);
        if (!reply.ok)
            return { ok: false, error: reply.error };
        const usage = decodeContextUsage(reply.response);
        // What this session runs at, banked for dsh's context ring. Both spellings are recorded: dsh
        // asks for a window by the id it stored, which is the spec's, while the CLI answers with its
        // own name for the model. `retarget` writes the new spec on a `set_model`, so a model switched
        // mid-session banks under the model it switched to, and the ring follows on the next turn.
        noteLiveWindow(proc.spec?.model, usage.maxTokens);
        noteLiveWindow(usage.model, usage.maxTokens);
        // The CLI's guess, when it is one: below the table's window for this model, from one of the
        // two sources the demotion produces (`auto` for Fable, `model-default` for Opus 5 and Sonnet
        // 5; `settings` and `env` are a window the user chose), while this box's base URL is a proxy
        // and the CLI runs on this box: a session on an ssh box or a remote workspace runs under that
        // box's env, which this process cannot see. The popover names the switch that fixes it.
        const known = usage.model
            ? (KNOWN_MODELS.find((m) => m.id === windowKey(usage.model ?? ""))?.contextWindow ?? 0)
            : 0;
        const behind = proxyBaseUrl(process.env.ANTHROPIC_BASE_URL);
        const guessed = usage.autocompact === "auto" || usage.autocompact === "model-default";
        const local = !this.config.sshHost && !remoteWorkspaceFor(proc.cwd);
        if (behind && local && guessed && usage.maxTokens > 0 && usage.maxTokens < known) {
            usage.assumedBehind = behind;
            // The switch is already on and this process predates it: its next turn replaces it (the
            // spec's `firstParty`), so the note says that instead of naming a switch that is on. Read
            // here, not from `proxyFirstParty`, which only refreshes when some session starts a turn.
            const hints = await readHints(join(this.stateDir, "hints.json"));
            if (wantsFirstParty(hints, await detectFirstParty()))
                usage.followsNext = true;
        }
        return { ok: true, ...usage };
    }
    /**
     * `/temporary`: toggle "keep no Claude transcript" for the current dsh session. Registered here,
     * from the first init frame, because at apply() the commands service is not up yet and the
     * optional lookup returns nothing. The next process for the session starts with
     * --no-session-persistence; a live one is replaced by the spec change.
     */
    registerTemporaryCommand(commands) {
        if (this.bridged.has("temporary"))
            return;
        try {
            const dispose = commands.register({
                name: "temporary",
                description: serverText("temporaryCommand"),
                handler: ({ agent }) => {
                    const id = String(agent.id);
                    const on = !this.temporary.has(id);
                    if (on)
                        this.temporary.add(id);
                    else
                        this.temporary.delete(id);
                    return {
                        kind: "success",
                        text: on
                            ? "Temporary: on. Claude keeps no transcript for this session from the next turn; after a dsh restart the session continues from dsh's own log."
                            : "Temporary: off. The next turn starts a Claude session that is kept again.",
                    };
                },
            });
            this.bridged.set("temporary", dispose);
        }
        catch (error) {
            this.log("warn", `/temporary not registered: ${errorText(error)}`);
        }
    }
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
    asideOwner() {
        // SAFETY: the registry symbol is this plugin's own key on globalThis, typed here once
        const g = globalThis;
        return g[ADAPTER_CURRENT]?.get("claude-code") ?? this;
    }
    /** The live process for a session, by exact registry key, else by the `:sessionId` suffix so a session survives across mounts; undefined when none is alive. */
    processFor(sessionId) {
        const own = this.processes.get(registryKey(this.providerId, sessionId));
        if (own !== undefined)
            return own;
        for (const [key, proc] of this.processes)
            if (key.endsWith(`:${sessionId}`))
                return proc;
        return undefined;
    }
    /**
     * The mount holding a live process for this session, or undefined. The cheap half of
     * `ownerFor`: a map walk, no session read. For a poll that only reports on a live process (the
     * steer card, once a second per open session) it is the whole answer, and it spares the event-log
     * snapshot `ownerFor` falls back to for a session with nothing running.
     */
    ownerIfLive(sessionId) {
        // SAFETY: the registry symbol is this plugin's own key on globalThis, typed here once
        const g = globalThis;
        const mounts = g[ADAPTER_CURRENT];
        const suffix = `:${sessionId}`;
        for (const [key, proc] of this.processes) {
            if (!key.endsWith(suffix) || !proc.alive)
                continue;
            const mount = mounts?.get(key.slice(0, key.length - suffix.length));
            if (mount)
                return mount;
        }
        return undefined;
    }
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
    ownerFor(sessionId) {
        // SAFETY: the registry symbol is this plugin's own key on globalThis, typed here once
        const g = globalThis;
        const mounts = g[ADAPTER_CURRENT];
        const suffix = `:${sessionId}`;
        for (const [key, proc] of this.processes) {
            if (!key.endsWith(suffix) || !proc.alive)
                continue;
            const mount = mounts?.get(key.slice(0, key.length - suffix.length));
            if (mount)
                return mount;
        }
        return mounts?.get(this.sessionProvider(sessionId) ?? "") ?? this;
    }
    /** Record a side question in the session's aside ring (evicting the oldest session when the ring is full) and send it to the CLI through the mount that owns the process; the answer or error is written back onto the ring. A blank `question` with a `quote` asks Claude to explain the passage; the ring keeps the blank. */
    askSideQuestion(sessionId, question, context, quote) {
        const q = question.trim();
        const entry = {
            id: `omc-${randomUUID()}`,
            question: q,
            pending: true,
            at: Date.now(),
        };
        if (quote !== undefined && quote !== "")
            entry.quote = quote.slice(0, ASIDE_QUOTE_KEEP);
        const ring = this.sideQuestions.get(sessionId) ?? [];
        ring.push(entry);
        if (!this.sideQuestions.has(sessionId) && this.sideQuestions.size >= ASIDE_MAX_SESSIONS) {
            // Map keeps insertion order, so the first key is the oldest session; evict it.
            const oldest = this.sideQuestions.keys().next().value;
            if (oldest !== undefined)
                this.sideQuestions.delete(oldest);
        }
        this.sideQuestions.set(sessionId, ring.slice(-ASIDE_KEEP));
        this.publishAsides(sessionId);
        // The ring lives on the main mount, but the control request has to be written and awaited by
        // the mount whose stream loop reads that process, else the reply resolves nobody's waiter.
        const owner = this.ownerFor(sessionId);
        const proc = owner.processFor(sessionId);
        if (!proc?.alive) {
            entry.pending = false;
            entry.error = "no live Claude process for this session; send a prompt first";
            this.persistAsides(sessionId);
            return;
        }
        // The ring keeps `q`, which is what the bubble and the Asides tab show. `context` (a diff, today)
        // is sent to the CLI and dropped: a persisted ring is not the place for a copy of the tree.
        // A blank question only arrives with a selected passage: the bar's "explain this".
        const ask = q === "" ? SELECTION_EXPLAIN : q;
        const asked = context === undefined || context === "" ? ask : `${ask}\n\n${context}`;
        void owner
            .control(proc, { subtype: "side_question", question: asked, history: [] }, ASIDE_TIMEOUT_MS)
            .then((reply) => {
            entry.pending = false;
            if (!reply.ok) {
                entry.error = reply.error;
            }
            else {
                const text = asideAnswerText(reply.response);
                if (text === undefined)
                    entry.error = "Claude gave no answer to the side question";
                else
                    entry.answer = text;
            }
            this.persistAsides(sessionId);
        });
    }
    /** Save (or clear, when the text is blank) an opening prompt for a session or for `default`. */
    setStarter(key, text) {
        if (text === undefined || text.trim() === "")
            this.starters.delete(key);
        else
            this.starters.set(key, text);
        void saveStarter(this.stateDir, key, text);
    }
    /** Persist a session's aside ring to disk so an answer survives a restart, eviction or hot reload. */
    persistAsides(sessionId) {
        const ring = this.sideQuestions.get(sessionId);
        if (ring)
            void saveAsides(this.stateDir, sessionId, ring);
    }
    /** Inline tool text unless the Settings switch, or failing that the config, asks for rows. */
    toolsInline() {
        if (this.toolMode !== undefined)
            return this.toolMode === "inline";
        if (this.config.toolsInline !== undefined)
            return this.config.toolsInline;
        return !this.rowsByDefault;
    }
    /**
     * Whether rows are the default on this dsh, when neither the Settings switch nor the config says.
     * True on 0.1.7 and later once the probe has passed: there the text streams live between dsh's
     * cards and the announced rows survive a reload, so the plugin looks like every other provider
     * in dsh. False before 0.1.7, where a step's text lands only when it settles, and false until
     * the probe answers, so the first turns of a process never write rows a dsh cannot load. A
     * dsh that starts refusing the shape locks the probe and this falls back to inline on its own.
     */
    rowsByDefault = false;
    /** What the Settings switch shows: the mode in force, and whether rows are open to it at all. */
    async toolModeInfo() {
        return { mode: this.toolsInline() ? "inline" : "rows", rows: await rowsSupported() };
    }
    /** Set the mode on every mount at once, so a session on a box's model follows the same switch. */
    async setToolMode(mode) {
        // SAFETY: the registry symbol is this plugin's own key on globalThis, typed here once
        const g = globalThis;
        for (const mount of g[ADAPTER_CURRENT]?.values() ?? [this])
            mount.toolMode = mode;
        this.toolMode = mode;
        await saveToolMode(this.stateDir, mode);
        return this.toolModeInfo();
    }
    /** The terminal-sync flag for the info route, surfaced to the panel's status line. */
    terminalSyncInfo() {
        return { enabled: this.terminalSync };
    }
    /** Turn terminal sync on or off for every mount. Off stops each mount's watchers and drops any
     *  queued mirror; on lets the next sweep pick loaded sessions back up. */
    async setTerminalSync(enabled) {
        // SAFETY: the registry symbol is this plugin's own key on globalThis, typed here once
        const g = globalThis;
        // Always include this mount: at boot or in a test it may not be in the shared registry yet.
        const mounts = new Set([this, ...(g[ADAPTER_CURRENT]?.values() ?? [])]);
        for (const mount of mounts) {
            mount.terminalSync = enabled;
            if (!enabled) {
                for (const w of mount.watchers.values()) {
                    if (w.timer)
                        clearTimeout(w.timer);
                    w.fw?.close();
                }
                mount.watchers.clear();
                mount.mirrors.clear();
                for (const s of mount.streaming.values()) {
                    s.done = true;
                    s.wake?.();
                }
                mount.streaming.clear();
            }
        }
        await saveTerminalSync(this.stateDir, enabled);
        if (enabled)
            void this.watchLoadedSessions();
        return this.terminalSyncInfo();
    }
    /** What the /tune thinking selector shows: the budget this plugin last set for the session, or
     *  `undefined` when it has set none and the session runs on its own default. */
    thinkingInfo(sessionId) {
        return {
            tokens: this.thinkingBudgets.has(sessionId) ? this.thinkingBudgets.get(sessionId) : undefined,
        };
    }
    /**
     * Set a session's live thinking budget with a `set_max_thinking_tokens` control request: null keeps
     * the session default, 0 turns extended thinking off, any positive integer caps it. The CLI reads
     * stdin during a turn; between turns the line is queued and answered when the next turn opens. The
     * value is stored only after the process accepts it, since a dead process cannot apply it.
     */
    async setThinkingBudget(sessionId, tokens) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return {
                ok: false,
                tokens,
                live: false,
                error: "no live Claude process for this session; send a prompt first",
            };
        // 5 s: the CLI answers at once when it reads stdin; a longer wait would only stall the selector.
        const reply = await this.control(proc, { subtype: "set_max_thinking_tokens", max_thinking_tokens: tokens }, 5000);
        if (!reply.ok)
            return { ok: false, tokens, live: true, error: reply.error };
        this.thinkingBudgets.set(sessionId, tokens);
        return { ok: true, tokens, live: true };
    }
    /** Register the /btw command that asks Claude a quick side question without interrupting the turn; a no-op once that command is already bridged. */
    registerAsideCommand(commands) {
        if (this.bridged.has("btw"))
            return;
        try {
            const dispose = commands.register({
                name: "btw",
                description: serverText("btwCommand"),
                input: { hint: serverText("btwHint") },
                handler: ({ agent, rawInput }) => {
                    const question = rawInput.trim();
                    if (!question)
                        return { kind: "error", text: serverText("btwUsage") };
                    this.askSideQuestion(String(agent.id), question);
                    return {
                        kind: "success",
                        text: serverText("btwSent"),
                    };
                },
            });
            this.bridged.set("btw", dispose);
        }
        catch (error) {
            this.log("warn", `/btw not registered: ${errorText(error)}`);
        }
    }
    /** Two boots closer than this are a crash loop, not a restart. */
    static BOOT_BACKOFF_MS = 60_000;
    /**
     * After a dsh restart, sessions that had a turn running get a prompt to continue, so the user
     * does not have to come back and poke each one. Sessions with a live (adopted) process are a
     * hot reload, not a restart, and are left alone.
     */
    async resumeInterrupted(path = join(this.stateDir, "busy.json")) {
        const log = join(dirname(path), "resume.log"); // beside the busy file, so tests stay in tmp
        // Backoff: a boot within a minute of the previous one is a crash loop (14 in a row on
        // 2026-09-05, from a throw in the nudged turn). Leave the busy file alone so a later healthy
        // boot still resumes, and do not nudge now.
        const since = await noteBoot(join(dirname(path), "boot.json"));
        if (since !== undefined && since < ClaudeCodeAdapter.BOOT_BACKOFF_MS) {
            await trace(log, `boot: backoff, previous boot ${since}ms ago; nudge skipped`);
            return;
        }
        const ids = await takeInterrupted(path);
        await trace(log, `boot: interrupted=${JSON.stringify(ids)} live=${JSON.stringify([...this.processes.keys()])}`);
        for (const id of ids) {
            const proc = this.processes.get(registryKey(this.providerId, id));
            if (proc) {
                // A hot reload, or the user already typed since boot: the turn is live, keep it tracked.
                if (proc.busy)
                    await markBusy(id, true, path);
                await trace(log, `skip ${id}: process live (busy=${proc.busy})`);
                continue;
            }
            try {
                await this.wake(id, undefined, RESTART_TEXT);
                await trace(log, `nudged ${id}`);
            }
            catch (e) {
                await trace(log, `nudge ${id} failed: ${errorText(e)}`);
            }
        }
        return ids;
    }
    /** Node's spawn, or dsh's subprocess seam when configured and mounted. */
    /** Where a session's keeper lives: one directory per provider id and dsh session. */
    keeperDir(sessionId) {
        const h = createHash("sha256").update(registryKey(this.providerId, sessionId)).digest("hex");
        return join(this.stateDir, "keepers", h.slice(0, 16));
    }
    /**
     * What this instance adds to a local Claude's environment: its config dir when it has one, and
     * this box's panel login as CLAUDE_CODE_OAUTH_TOKEN for the default instance. A second instance
     * keeps its own login, which is what a second instance is for.
     */
    localEnvOverride(firstParty = this.proxyFirstParty) {
        const over = {};
        if (this.config.configDir || this.config.ownTranscripts)
            over.CLAUDE_CONFIG_DIR = this.claudeHome;
        const token = this.providerId === "claude-code" ? readSshToken(STATE_DIR, THIS_BOX) : undefined;
        if (token)
            over.CLAUDE_CODE_OAUTH_TOKEN = token;
        // Claude Code 2.1.274 believes a native-1M model holds 200,000 when ANTHROPIC_BASE_URL names
        // any host but api.anthropic.com, and with that guess it either caps the session there (Opus 5,
        // Sonnet 5) or stops compacting altogether (Fable). This is the CLI's own flag for "the proxy
        // is Anthropic"; it changes nothing when no base URL is set. A session's spawner passes its
        // spec's `firstParty`, so the env and the spec that keys the process are one snapshot: the
        // field alone could be flipped by another session's `prepare()` between the two reads, and a
        // process whose spec says one thing and whose env says the other never gets replaced.
        if (firstParty)
            over[FIRST_PARTY_FLAG] = "1";
        return Object.keys(over).length === 0 ? undefined : over;
    }
    /** The child env a keeper hands Claude: dsh's environment plus the plugin's additions. */
    keeperEnv(firstParty) {
        return childEnv(process.env, this.localEnvOverride(firstParty));
    }
    /** Spawner for one session: keeper mode needs the session to place and name the keeper. */
    spawnerFor(sessionId, spec) {
        const firstParty = spec.firstParty === true;
        if (this.config.spawn !== "keeper" || !sessionId)
            return this.spawner(firstParty);
        const boxHost = this.config.sshHost;
        if (boxHost)
            return (command, args, cwd) => this.holdOn(boxHost, remoteCwdFor(boxHost, cwd), sessionId, spec, command, args);
        return (command, args, cwd) => {
            // A remote-workspace session runs the far `claude` over SSH: held there, like an SSH box's,
            // rather than under a local keeper that would launch claude in the empty placeholder dir.
            const ws = remoteWorkspaceFor(cwd);
            // The far box runs its own `claude`: name it as configured, never this box's absolute path.
            if (ws)
                return this.holdOn(ws.host, ws.remoteCwd, sessionId, spec, this.configuredCommand, args);
            // One directory per spawn: a respawn must never share a socket, keeper.json or keeper.log
            // with the keeper it replaces (2026-09-06: a shared directory let a dying keeper answer the
            // new attach, and a boot read the wrong keeper.json and dropped the live one).
            const stamp = Date.now().toString(36);
            const dir = `${this.keeperDir(sessionId)}-${stamp}`;
            const unit = `omc-keeper-${basename(dir)}`;
            return lazyHandle(spawnKeeper(dir, { command, args, cwd, env: this.keeperEnv(firstParty), sessionId, procSpec: spec }, (argv) => launchKeeper(argv, unit)));
        };
    }
    /**
     * Start the far `claude` in a hold on `host` (see hold.ts) and attach to it. The record is what a
     * restart reattaches from, so it is written before the first byte is read; a failed start ends the
     * handle through its stderr and exit, as a local spawn error would.
     */
    holdOn(host, cwd, sessionId, spec, command, args) {
        const holdId = holdName(this.providerId, sessionId);
        const run = sshRunner(host);
        const record = {
            sessionId,
            host,
            name: holdId,
            command,
            args,
            cwd,
            procSpec: spec,
            offset: 0,
            startedAt: Date.now(),
        };
        const started = new Promise((resolve, reject) => {
            const s = run(holdStartScript(holdId, cwd, command, args, readSshToken(STATE_DIR, host)));
            let out = "";
            let err = "";
            s.stdin.end();
            s.stdout.on("data", (d) => (out += String(d)));
            s.stderr.on("data", (d) => (err += String(d)));
            void s.done.then((o) => {
                if (o.exitCode !== 0 || !out.includes(READY_MARK))
                    return reject(new Error(`hold start on ${host} failed (${o.exitCode}): ${err.trim() || out.trim()}`));
                void saveHold(this.stateDir, sessionId, record);
                resolve(this.attachHold(run, record));
            });
        });
        return lazyHandle(started);
    }
    /** Attach to a hold and keep its record's offset current (at most once a second). */
    attachHold(run, record) {
        let saveTimer;
        return holdHandle(run, record.name, record.offset, (offset) => {
            record.offset = offset;
            if (saveTimer)
                return;
            saveTimer = setTimeout(() => {
                saveTimer = undefined;
                void saveHold(this.stateDir, record.sessionId, record);
            }, 1000);
            saveTimer.unref();
        }, () => {
            if (saveTimer)
                clearTimeout(saveTimer);
            void dropHold(this.stateDir, record.sessionId, record.name);
            // Our own dir on the box, after the exit line: the log of a live cli is never touched.
            const c = run(holdCleanScript(record.name));
            c.stdin.end();
            c.stdout.on("data", () => { });
            c.stderr.on("data", () => { });
        });
    }
    /**
     * At boot, reattach to the holds this instance left on SSH boxes. A hold whose cli has ended
     * delivers its exit line at once and drops itself; one still running is registered like an
     * adopted keeper, with the same wake and bridge reconnect.
     */
    async adoptHolds() {
        if (this.config.spawn !== "keeper")
            return;
        const all = await loadHolds(this.stateDir);
        for (const [sessionId, raw] of Object.entries(all)) {
            const record = asHoldRecord(raw);
            if (!record || record.sessionId !== sessionId) {
                await trace(join(this.stateDir, "resume.log"), `dropping unreadable hold for ${sessionId}`);
                void dropHold(this.stateDir, sessionId);
                continue;
            }
            const key2 = registryKey(this.providerId, sessionId);
            if (this.processes.has(key2))
                continue; // a hot reload: the process is already ours
            const run = sshRunner(record.host);
            const proc = new ClaudeProcess({
                args: record.args,
                cwd: record.cwd,
                spec: record.procSpec,
                command: record.command,
                spawner: () => this.attachHold(run, record),
                onExit: (p) => {
                    if (this.processes.get(key2) === p)
                        this.processes.delete(key2);
                },
            });
            proc.key = specKey(record.procSpec);
            proc.resuming = true;
            proc.onIdleResult = () => this.wake(sessionId, proc);
            this.processes.set(key2, proc);
            await trace(join(this.stateDir, "resume.log"), `adopted hold ${record.name} for ${sessionId} on ${record.host} (offset ${record.offset})`);
            setTimeout(() => void this.reconnectBridge(proc, sessionId), 1500).unref();
            void this.drainAdopted(proc, sessionId);
        }
    }
    /**
     * At boot, reattach to keepers whose Claude process is still alive (a dsh restart left them
     * running) and register them as this instance's processes. One with output waiting gets a
     * drain turn so what Claude did during the gap shows up without anyone typing.
     */
    async adoptKeepers() {
        if (this.config.spawn !== "keeper")
            return;
        const root = join(this.stateDir, "keepers");
        let dirs = [];
        try {
            dirs = (await readdir(root)).map((d) => join(root, d));
        }
        catch {
            return;
        }
        // Newest keeper first, so when a session has more than one alive (a respawn raced a
        // shutdown) the current one is adopted and the older one is retired below.
        dirs.sort((a, b) => (readKeeperInfo(b)?.startedAt ?? 0) - (readKeeperInfo(a)?.startedAt ?? 0));
        for (const dir of dirs) {
            const info = readKeeperInfo(dir);
            const spec = readKeeperSpec(dir);
            if (!info ||
                !spec ||
                info.exit ||
                !pidAlive(info.pid) ||
                !pidAlive(info.claudePid) ||
                !spec.procSpec) {
                // Say why before the evidence goes: the 2026-09-06 00:00 restart lost a keeper that had
                // survived four, and nothing recorded whether Claude exited, was killed, or the keeper died.
                let orphanKilled = false;
                if (info && !pidAlive(info.pid) && pidAlive(info.claudePid)) {
                    try {
                        process.kill(info.claudePid, "SIGTERM");
                    }
                    catch { }
                    setTimeout(() => {
                        try {
                            process.kill(info.claudePid, "SIGKILL");
                        }
                        catch { }
                    }, 3000).unref();
                    orphanKilled = true;
                }
                await trace(join(this.stateDir, "resume.log"), `dropping keeper ${basename(dir)} for ${info?.sessionId ?? "?"}: exit=${JSON.stringify(info?.exit ?? null)} endedBy=${info?.endedBy ?? "?"} keeperAlive=${info ? pidAlive(info.pid) : "?"} claudeAlive=${info ? pidAlive(info.claudePid) : "?"} spec=${spec ? "ok" : "missing"} orphanKilled=${orphanKilled}`);
                // Tail the keeper's own log before we nuke its directory.
                try {
                    const logLines = (await readFile(join(dir, "keeper.log"), "utf8")).split("\n");
                    for (const l of logLines.slice(-20)) {
                        if (l)
                            await trace(join(this.stateDir, "resume.log"), `  keeper.log: ${l}`);
                    }
                }
                catch { }
                await rm(dir, { recursive: true, force: true }).catch(() => { });
                continue;
            }
            const procSpec = spec.procSpec;
            const key2 = registryKey(this.providerId, spec.sessionId);
            if (this.processes.has(key2)) {
                // An older keeper for a session already adopted: nobody will attach to it again.
                try {
                    process.kill(info.claudePid, "SIGKILL");
                }
                catch { }
                await trace(join(this.stateDir, "resume.log"), `retiring older keeper ${basename(dir)} for ${spec.sessionId} (claude pid ${info.claudePid} killed)`);
                await rm(dir, { recursive: true, force: true }).catch(() => { });
                continue;
            }
            const proc = new ClaudeProcess({
                args: spec.args,
                cwd: spec.cwd,
                spec: procSpec,
                command: spec.command,
                spawner: () => lazyHandle(attachKeeper(dir, 5000)),
                onExit: (p) => {
                    if (this.processes.get(key2) === p)
                        this.processes.delete(key2);
                },
            });
            proc.key = specKey(procSpec);
            proc.resuming = true;
            proc.onIdleResult = () => this.wake(spec.sessionId, proc);
            this.processes.set(key2, proc);
            await trace(join(this.stateDir, "resume.log"), `adopted keeper ${basename(dir)} for ${spec.sessionId} (claude pid ${info.claudePid})`);
            // Anything Claude wrote while dsh was away sits in the keeper's buffer and now in our queue;
            // a wake opens a dsh turn that reads it out. The bridge's MCP client session died with the
            // old dsh, so ask the CLI to reconnect its `dsh` server against the new one first.
            setTimeout(() => void this.reconnectBridge(proc, spec.sessionId), 1500).unref();
            // The first look at 1.5 s found dsh's agent scope still inactive (2026-09-05 23:53: the
            // reply Claude wrote during the restart sat in the queue until the next typed prompt), so
            // keep looking for a minute and stop at the first wake that opened a turn.
            void this.drainAdopted(proc, spec.sessionId);
        }
    }
    /** Every 2 s for a minute: a reply waiting in an adopted process's queue opens a dsh turn. */
    async drainAdopted(proc, sessionId, everyMs = 2000, tries = 30) {
        for (let i = 0; i < tries && proc.alive; i++) {
            await new Promise((r) => setTimeout(r, everyMs));
            if (proc.busy)
                return; // a prompt got there first; the turn drains the queue itself
            if (proc.queue.size === 0)
                continue;
            if (await this.wake(sessionId, proc, RECONNECT_TEXT))
                return;
        }
    }
    /**
     * After a reattach, the surviving Claude still holds an MCP session against the previous dsh's
     * bridge. `mcp_reconnect` for the `dsh` server makes it open a fresh one; without it the first
     * dsh tool call after a restart can fail once. No bridge mounted (non-default instance, or the
     * bridge not up yet) means nothing to reconnect to. Retries every retryMs for attempts tries, since the web server listens several seconds after adoption.
     */
    async reconnectBridge(proc, sessionId, retryMs = 5000, attempts = 12) {
        if (!this.mcp || !proc.alive)
            return false;
        // The web server listens several seconds after adoption (2026-09-05: 40:47 adopt, 40:56 up),
        // so the first tries answer "MCP endpoint not found"; keep asking for about a minute.
        let last = "";
        for (let i = 0; i < attempts && proc.alive; i++) {
            const reply = await this.control(proc, { subtype: "mcp_reconnect", serverName: "dsh" }, 10_000);
            if (reply.ok) {
                await trace(join(this.stateDir, "resume.log"), `mcp_reconnect dsh for ${sessionId}: ok (try ${i + 1})`);
                return true;
            }
            last = reply.error;
            await new Promise((r) => setTimeout(r, retryMs));
        }
        await trace(join(this.stateDir, "resume.log"), `mcp_reconnect dsh for ${sessionId}: gave up: ${last}`);
        // The usual reason: the session is not open in any tab, so dsh has no live agent for it and the
        // bridge answers "no live agent". A turn is the moment there is one.
        proc.bridgeStale = true;
        return false;
    }
    /** A stale bridge gets one more reconnect, at a turn boundary, when dsh does have the agent. */
    async reconnectIfStale(proc, sessionId) {
        if (!proc.bridgeStale)
            return;
        proc.bridgeStale = false;
        // One try, no wait: the web server is up (this request came through it) and a miss now is a
        // real miss, not the boot race the post-adoption retries cover.
        await this.reconnectBridge(proc, sessionId, 0, 1);
    }
    /** The box a session's turn runs on (an SSH box, or a remote workspace's host), or undefined for a
     * local turn. Mirrors prepare()'s targetHost so a logged-out error names the right machine: a
     * purpose one-shot (title/compaction) always runs on the local claude for the default provider. */
    hostLabelFor(sessionId, purpose) {
        const cwd = sessionId && !purpose ? this.sessionCwd(sessionId) : undefined;
        return boxFor(this.config.sshHost, cwd ? remoteWorkspaceFor(cwd)?.host : undefined);
    }
    /** The function that spawns a session's claude: over SSH for an ssh box, over SSH on the box for a remote-workspace cwd, else the local seam or node spawner with this box's login. */
    spawner(firstParty = this.proxyFirstParty) {
        // A remote instance drives the far `claude` over SSH; no keeper, no seam, its own remote login.
        // A remote-workspace cwd is a local placeholder here; redirect it to the box's real path.
        if (this.config.sshHost) {
            const host = this.config.sshHost;
            return sshSpawner(host, (cwd) => remoteCwdFor(host, cwd), readSshToken(STATE_DIR, host));
        }
        const base = this.config.spawn === "dsh" && this.subprocess ? seamSpawner(this.subprocess) : nodeSpawner;
        if (this.config.spawn === "dsh" && !this.subprocess && !this.warnedNoSeam) {
            this.warnedNoSeam = true;
            this.log("warn", "spawn: dsh requested but ctx.subprocess is not mounted; using node spawn");
        }
        // Read per spawn, not once: a login made in the panel applies to the next session started.
        const local = (command, args, cwd) => base(command, args, cwd, this.localEnvOverride(firstParty));
        // A remote-workspace cwd runs the far `claude` over SSH on its box, even when this provider is
        // local: otherwise the session sits in the empty local placeholder dir.
        return (command, args, cwd) => {
            const ws = remoteWorkspaceFor(cwd);
            if (ws)
                return sshSpawner(ws.host, () => ws.remoteCwd, readSshToken(STATE_DIR, ws.host))(
                // The far box's own binary, by the configured name: see `commandFor`.
                this.configuredCommand, args, cwd);
            return local(command, args, cwd);
        };
    }
    /** Kill this instance's live processes and drop them from the shared registry: called when an SSH
     * box is removed from the panel, so its remote `claude` sessions do not outlive the mount. */
    disposeProcesses() {
        for (const [key, proc] of this.processes) {
            if (!key.startsWith(`${this.providerId}:`))
                continue;
            proc.kill();
            this.processes.delete(key);
            this.forgetSession(this.ownSessionId(key));
        }
        for (const w of this.watchers.values()) {
            if (w.timer)
                clearTimeout(w.timer);
            w.fw?.close();
        }
        this.watchers.clear();
        this.mirrors.clear();
        for (const s of this.streaming.values()) {
            s.done = true;
            s.wake?.();
        }
        this.streaming.clear();
    }
    /** The stream entry point: answer a session-title request directly, run a one-shot when there is no resume path, otherwise delegate to the persistent turn loop. */
    async *stream(options) {
        if (options.purpose === "session-title" && options.sessionId) {
            const title = await this.titleFromCli(options.sessionId, titleInput(options.messages));
            if (title) {
                yield* new Translator({ toolActivity: false }).wholeBlock("text", title);
                yield { type: "finish", reason: { kind: "stop" } };
                return;
            }
        }
        if (options.purpose || !options.sessionId || !this.config.resume) {
            yield* this.oneShot(options);
            return;
        }
        // SAFETY: sessionId was checked just above; the persistent path always has one
        yield* this.turn(options, false);
    }
    // ── persistent path ──────────────────────────────────────────────────────
    /** Reuse the session's process when its spec still matches; otherwise replace it. */
    async acquire(options, forceFresh) {
        const prep = await this.prepare(options, { forceFresh });
        if (prep.input === null)
            return { prep, proc: null }; // text-mode CLI: fall back to one-shot semantics
        // The model this workspace last ran, so a new session there opens on it (the client applies
        // it). Keyed by the dsh session's own cwd, the path the client asks with; a temporary session
        // is a side call and does not count.
        const wsCwd = this.ctx?.sessions?.get?.(asSessionId(options.sessionId))?.header?.cwd ?? prep.cwd;
        if (prep.spec.model && !prep.spec.temporary) {
            // One file write per change, not per turn: a long session on one model writes once.
            // The mount goes with the model: a new session in this workspace opens on both, so a box's
            // Claude comes back as that box's, and a local one as local (dsh 0.1.7 makes its blank
            // sessions ahead of time on the deployment default, so nothing else carries a provider over).
            const written = `${this.providerId}\0${prep.spec.model}`;
            if (this.workspaceModelWritten.get(wsCwd) !== written) {
                this.workspaceModelWritten.set(wsCwd, written);
                void saveWorkspaceModel(STATE_DIR, wsCwd, prep.spec.model, Date.now(), this.providerId).catch(() => { });
            }
        }
        // What dsh's blocks cost on this turn, for the numbers on the Settings card. Same rule as the
        // model above: one write per change, so a workspace whose context is steady writes once rather
        // than once a turn. The key is built in a fixed order, since the measured keys arrive in
        // whatever order the turn's messages did.
        if (prep.sizes && !prep.spec.temporary) {
            const measured = CONTEXT_SIZE_KEYS.filter((k) => prep.sizes?.[k] !== undefined)
                .map((k) => `${k}:${prep.sizes?.[k]}`)
                .join(",");
            if (this.contextSizesWritten.get(wsCwd) !== measured) {
                this.contextSizesWritten.set(wsCwd, measured);
                void saveContextSizes(STATE_DIR, wsCwd, { ...prep.sizes }).catch(() => { });
            }
        }
        const key = specKey(prep.spec);
        const key2 = registryKey(this.providerId, options.sessionId);
        let proc = this.processes.get(key2);
        // A turn is in flight on this session and this caller is not its continuation. A mid-turn
        // relay or steer arrives with `cont.proc` and never reaches here. Killing the process would
        // end that running turn to make room for this one, so the second caller is refused instead;
        // `busy` is cleared in the turn loop's `finally`, so a failed turn does not wedge the session.
        if (proc?.alive && proc.busy)
            throw new LlmError("a turn is already running in this session", "PROVIDER_BUSY");
        // The watcher saw a terminal write turns into this session since the process last spoke: its
        // context stops where the transcript did not. Replace it, so the `--resume` below reads the
        // terminal turns back in. Not on a wake turn: that one exists to drain what the live process
        // already holds, and a kill here would lose it.
        if (proc?.alive && proc.staleContext && !wakeOnlyTurn(options.messages)) {
            proc.kill();
            proc = undefined;
        }
        if (proc?.alive && proc.key !== key)
            await this.retarget(proc, prep.spec);
        if (proc && (!proc.alive || proc.key !== key)) {
            proc.kill();
            proc = undefined;
        }
        if (!proc) {
            this.evict();
            proc = new ClaudeProcess({
                args: prep.args,
                cwd: prep.cwd,
                spec: prep.spec,
                command: this.config.command,
                spawner: this.spawnerFor(options.sessionId, prep.spec),
                onExit: (p) => {
                    if (this.processes.get(key2) === p) {
                        this.processes.delete(key2);
                        // A dead process has no waiting steers; the card clears now, not at the fallback.
                        this.publishAsides(options.sessionId);
                    }
                },
            });
            proc.key = key;
            proc.resuming = prep.session?.resuming ?? false;
            proc.onIdleResult = () => this.wake(options.sessionId, proc);
            this.processes.set(key2, proc);
            // The spawn is where `liveMode` changes without a pick.
            this.publishPermissionMode(options.sessionId);
            if (this.config.debug) {
                this.log("info", `spawn cwd=${prep.cwd} claude ${prep.args.join(" ")}`);
            }
            void this.refreshCliModels(proc);
        }
        return { prep, proc };
    }
    /** Where a session's Claude transcript is: on this box under `claudeHome`, or on the SSH box the
     *  turn runs on under that account's `~/.claude`, at the cwd the box really uses. Undefined
     *  without a Claude id or when the box's home cannot be read. */
    async transcriptLocation(cwd, id) {
        if (!id)
            return undefined;
        const host = boxFor(this.config.sshHost, remoteWorkspaceFor(cwd)?.host);
        if (!host) {
            return {
                box: {},
                path: join(this.claudeHome, "projects", projectDirName(cwd), `${id}.jsonl`),
            };
        }
        const box = { sshHost: host };
        let home;
        try {
            home = await homeAt(box);
        }
        catch (error) {
            this.log("warn", `transcript location on ${host}: ${errorText(error)}`);
            return undefined;
        }
        const dir = projectDirName(remoteCwdFor(host, cwd));
        return { box, path: `${home}/.claude/projects/${dir}/${id}.jsonl` };
    }
    /** Put every loaded session this instance has run under watch, and poll the ones already
     *  watched, so a session that sits in a tab is followed without having spoken in dsh since dsh
     *  started. The record a turn's end saved says which instance ran it: only that one watches, since
     *  the mirror turns it opens are recognised by that instance alone. A session with no record yet
     *  is watched from its first turn's end. The list is in memory; a watched session costs one
     *  `stat` per sweep, on an SSH box over the shared connection, which is how a box is followed at
     *  all, there being no inotify across ssh. */
    async watchLoadedSessions() {
        if (!this.terminalSync)
            return;
        let sessions;
        try {
            sessions = this.ctx.sessions.list();
        }
        catch {
            return; // inactive scope: the next sweep runs on the live adapter
        }
        const kept = await loadWatches(this.stateDir);
        for (const s of sessions) {
            const id = String(s.id);
            const cwd = s.header?.cwd;
            if (!cwd)
                continue;
            if (this.watchers.has(id)) {
                void this.pollTranscript(id);
                continue;
            }
            const record = kept.get(id);
            if (record?.provider !== this.providerId || !record.claudeId)
                continue;
            await this.watchTranscript(id, cwd, record.claudeId);
        }
    }
    /** One sweep's look at a watched transcript: scan when it grew past the baseline. This is the
     *  only way a remote one is read, and for a local one it catches what inotify could not deliver
     *  (a scan that stood down because the session was archived). */
    async pollTranscript(sessionId) {
        const w = this.watchers.get(sessionId);
        if (!w || w.scanning)
            return;
        try {
            const size = await sizeAt(w.box, w.path);
            if (size !== null && size > w.seen)
                await this.scanTranscript(sessionId);
        }
        catch (error) {
            this.log("warn", `transcript poll: ${errorText(error)}`);
        }
    }
    /** Watch the session's transcript from the end of this turn on, so a terminal that picks the
     *  session up (`claude /resume`) is noticed while dsh sits idle. One watcher per session; the
     *  baseline moves only by scans. */
    async watchTranscript(sessionId, cwd, claudeId) {
        if (!this.terminalSync)
            return;
        const loc = claudeId ? await this.transcriptLocation(cwd, claudeId) : undefined;
        if (!loc || !claudeId)
            return;
        const { box, path } = loc;
        let size;
        try {
            size = await sizeAt(box, path);
        }
        catch (error) {
            this.log("warn", `transcript watch: ${errorText(error)}`);
            return;
        }
        if (size === null)
            return; // no file yet (first turn still writing): the next turn's end starts the watch
        const held = this.watchers.get(sessionId);
        if (held && held.path === path) {
            // Rows may have landed in the settle window; the baseline only ever moves by a scan.
            void this.scanTranscript(sessionId);
            return;
        }
        if (held?.timer)
            clearTimeout(held.timer);
        held?.fw?.close();
        // Where to start: where the last watch of this file left off, else at the newest terminal
        // prompt still being answered, so a watch that starts mid-turn (dsh restarted while someone
        // typed in a terminal) still shows that turn, and never the ones before it.
        // Start at whichever is earliest: where the last watch left off, or the newest exchange's own
        // start. Backing up to the latest exchange means opening a session always re-reads it, so the
        // tab catches up to the latest even when the saved baseline has run past it; the dedup in
        // `scanOnce` drops any exchange the log already shows, so the re-read never doubles one up.
        const kept = (await loadWatches(this.stateDir)).get(sessionId);
        const base = kept?.path === path && kept.seen <= size ? kept.seen : Math.max(0, size - FIRST_WATCH_BYTES);
        const seen = Math.min(base, await this.latestExchangeStart(box, path, size));
        let fw;
        if (!box.sshHost) {
            try {
                fw = watch(path, { persistent: false }, () => {
                    const w = this.watchers.get(sessionId);
                    if (!w)
                        return;
                    if (w.timer)
                        clearTimeout(w.timer);
                    w.timer = setTimeout(() => void this.scanTranscript(sessionId), TRANSCRIPT_SETTLE_MS);
                    w.timer.unref?.();
                });
                fw.on("error", (error) => this.log("warn", `transcript watch: ${errorText(error)}`));
            }
            catch (error) {
                // inotify is a finite resource: a box that has spent its watch budget answers ENOSPC here,
                // and a transcript on a network filesystem may refuse to be watched at all. Carrying on
                // without a watcher leaves the session on the sweep's 30-second poll, which is how a session
                // on an SSH box runs anyway. Returning instead left the mirror silently dead on that machine.
                this.log("warn", `transcript watch failed, polling instead: ${errorText(error)}`);
            }
        }
        this.watchers.set(sessionId, { path, seen, claudeId, box, fw });
        void saveWatch(this.stateDir, sessionId, watchRecord(path, seen, box, this.providerId, claudeId));
        const where = box.sshHost ? `${box.sshHost}:${path}` : path;
        void trace(join(this.stateDir, "resume.log"), `watch ${sessionId}: ${where} from byte ${seen}`);
        if (seen < size)
            void this.scanTranscript(sessionId);
    }
    /** Byte offset where the newest foreign exchange begins (its prompt), or the end of the file when
     *  the tail holds no foreign prompt. Reading from here re-scans the latest exchange, which is how
     *  opening a session catches its tab up to the latest. */
    async latestExchangeStart(box, path, size) {
        const from = Math.max(0, size - WATCH_LOOKBACK_BYTES);
        let tail;
        try {
            tail = await readFromAt(box, path, from);
        }
        catch {
            return size;
        }
        const cut = from === 0 ? 0 : tail.indexOf("\n") + 1;
        const found = foreignTurns(tail.slice(cut), CHILD_ENV.CLAUDE_CODE_ENTRYPOINT);
        return from + Buffer.byteLength(tail.slice(0, cut)) + found.lastPromptAt;
    }
    /** The text of the last few assistant messages the dsh log holds, joined, so a mirror candidate
     *  whose signature is already in it is not shown twice. Only the tail is read: a re-shown exchange
     *  is always among the most recent, and scanning the whole log on every scan would not scale. */
    dshRecentText(sessionId) {
        try {
            const session = this.ctx.sessions.get(asSessionId(sessionId));
            if (!session)
                return "";
            const events = session.snapshotEvents();
            const parts = [];
            // Both kinds: a mirrored exchange lands as a user message holding the prompt and an assistant
            // message holding the rendered reply, and the dedup has to find each half where it actually is.
            // Reading only the assistant side left the prompt unfindable, so nothing was ever recognised as
            // already shown and every re-read mirrored the exchange again.
            for (let i = events.length - 1; i >= 0 && parts.length < 40; i--) {
                const e = events[i];
                if (e?.type !== "assistant/message" && e?.type !== "user/message")
                    continue;
                // SAFETY: dsh event data is JsonValue; the boundary decode reads the text blocks of either
                // shape, an assistant message nests them under `message`, a user message carries them flat.
                const data = e.data;
                const text = assistantMessageText(data.message?.content ?? data.content);
                if (text)
                    parts.push(text);
            }
            return parts.join("\n");
        }
        catch {
            return ""; // inactive scope or no session: nothing to dedup against, the scan proceeds
        }
    }
    /** The transcript settled after a write: read what landed past the baseline, and when a terminal
     *  finished a turn there, mark the live process stale and open a turn that shows the exchange.
     *  Measured 2026-09-10 on 2.1.268: `--resume` follows the chain the last row belongs to and drops
     *  the other, so once dsh respawns behind a terminal turn its own rows extend that chain; a
     *  terminal that keeps typing forks again, and the next dsh turn takes that fork as the truth. */
    async scanTranscript(sessionId) {
        const w = this.watchers.get(sessionId);
        if (!w)
            return;
        // Two scans at once (the settle timer and a turn's end) would both read from the same
        // baseline and both move it, so the second waits for the first and then runs once.
        if (w.scanning) {
            w.again = true;
            return;
        }
        w.scanning = true;
        try {
            await this.scanOnce(sessionId, w);
        }
        finally {
            w.scanning = false;
            if (w.again) {
                w.again = false;
                void this.scanTranscript(sessionId);
            }
        }
    }
    /** Scan a session's transcript once for new child turns and mirror them; while a turn streams, only wake the render until the exchange settles instead of re-posting what the render already showed. */
    async scanOnce(sessionId, w) {
        let found;
        try {
            found = foreignTurns(await readFromAt(w.box, w.path, w.seen), CHILD_ENV.CLAUDE_CODE_ENTRYPOINT);
        }
        catch (error) {
            this.log("warn", `transcript scan failed: ${errorText(error)}`);
            return;
        }
        // A turn is streaming from `w.seen`: its render loop owns showing it, so this scan only wakes the
        // render until that exchange settles, which it has once a completed turn stands at the baseline.
        // Asking instead for "nothing running any more" never came true while the owner kept working.
        // Their next prompt is itself a running turn, so the baseline froze, every later scan returned
        // here, and nothing they typed was mirrored until STREAM_MAX_MS forced the stream shut and the
        // completed path re-posted the exchange the stream had already shown.
        // The baseline moves by `firstEnd`, past the streamed exchange alone: `consumed` would jump any
        // exchange that landed behind it. The completed path below must not also queue what was shown.
        const stream = this.streaming.get(sessionId);
        if (stream) {
            if (found.turns.length > 0) {
                stream.done = true;
                w.seen += found.firstEnd;
                void saveWatch(this.stateDir, sessionId, watchRecord(w.path, w.seen, w.box, this.providerId, w.claudeId));
                stream.wake?.();
                // Whatever landed behind the streamed exchange is now ahead of the baseline; scan again so
                // the completed path mirrors it. scanTranscript's re-entry guard runs it after this one.
                void this.scanTranscript(sessionId);
                return;
            }
            stream.wake?.();
            return;
        }
        // An archived session is not opened for this: the baseline stays, and the exchange plays into
        // the tab when the owner opens the session (the sweep's poll finds the file past the baseline).
        if (found.turns.length > 0 && this.isArchived(sessionId))
            return;
        w.seen += found.consumed;
        // Drop any exchange the dsh log already shows: opening a session re-reads the latest exchange on
        // purpose, and this is what keeps that re-read from doubling it up.
        const shown = found.turns.length > 0 ? this.dshRecentText(sessionId) : "";
        found.turns = found.turns.filter((t) => !alreadyShown(t, shown, this.config.toolTextLimit));
        void saveWatch(this.stateDir, sessionId, watchRecord(w.path, w.seen, w.box, this.providerId, w.claudeId));
        if (found.turns.length > 0) {
            const m = this.mirrors.get(sessionId) ?? { queue: [] };
            m.queue.push(...found.turns);
            this.mirrors.set(sessionId, m);
            const proc = this.processes.get(registryKey(this.providerId, sessionId));
            if (proc?.alive)
                proc.staleContext = true;
            await this.pumpMirror(sessionId);
        }
        // A turn still running past the threshold streams live from here, into its own open dsh turn.
        if (found.running &&
            Date.now() - found.running.time >= STREAM_THRESHOLD_MS &&
            !this.isArchived(sessionId))
            await this.openStream(sessionId, w);
    }
    /** Open one dsh turn that streams a still-running terminal exchange live: the prompt goes out as a
     *  user message through the followup seam, and the turn loop's `streamMirror` fills its reply as
     *  the transcript grows. One stream per session; the running exchange begins at `w.seen`. */
    async openStream(sessionId, w) {
        if (this.streaming.has(sessionId))
            return;
        let running;
        try {
            running = foreignTurns(await readFromAt(w.box, w.path, w.seen), CHILD_ENV.CLAUDE_CODE_ENTRYPOINT).running;
        }
        catch (error) {
            this.log("warn", `stream open read failed: ${errorText(error)}`);
            return;
        }
        if (!running)
            return;
        const found = await this.agentFor(sessionId);
        if (!found)
            return;
        const message = createUserMessage({
            content: [{ type: "text", text: running.content.map((b) => b.text).join("\n") }],
            source: { kind: "user" },
        });
        this.streaming.set(sessionId, {
            id: String(message.id),
            path: w.path,
            box: w.box,
            start: w.seen,
            shown: 0,
            done: false,
            startedAt: Date.now(),
        });
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (proc?.alive)
            proc.staleContext = true;
        try {
            found.agent.followup(message);
        }
        catch (error) {
            this.streaming.delete(sessionId);
            this.log("warn", `stream followup failed: ${errorText(error)}`);
            return;
        }
        void trace(join(this.stateDir, "resume.log"), `stream ${sessionId}: opened (agent ${found.how})`);
    }
    /** The reply half of a streamed mirror turn: re-read the exchange, render its blocks, yield the
     *  ones past what has been shown, then wait for a scan to wake it. Ends when the exchange settles
     *  (`done`, set by `scanOnce`) or the hung-turn guard fires. */
    async *streamMirror(sessionId, stream) {
        const tr = new Translator({ toolActivity: false });
        try {
            for (;;) {
                let turn;
                try {
                    const ft = foreignTurns(await readFromAt(stream.box, stream.path, stream.start), CHILD_ENV.CLAUDE_CODE_ENTRYPOINT);
                    turn = ft.running ?? ft.turns[0];
                }
                catch (error) {
                    this.log("warn", `stream read failed: ${errorText(error)}`);
                }
                if (turn) {
                    const blocks = mirrorReplyBlocks(turn, this.config.toolTextLimit);
                    for (const block of blocks.slice(stream.shown))
                        yield* tr.wholeBlock("text", block);
                    stream.shown = blocks.length;
                }
                if (stream.done || Date.now() - stream.startedAt > STREAM_MAX_MS)
                    break;
                // Wait for the next scan to wake us, or re-read on our own after the idle window: a write the
                // watcher's debounce has not delivered yet still reaches the turn within the idle interval.
                // A box reached over ssh pays a process per read and has no inotify to wake it, so it waits
                // longer between reads than this PC, where the read is a file handle and a parse of a few ms.
                await new Promise((resolve) => {
                    stream.wake = resolve;
                    setTimeout(resolve, idleFor(stream.box)).unref?.();
                });
                stream.wake = undefined;
            }
        }
        finally {
            this.streaming.delete(sessionId);
        }
    }
    /** Whether dsh's workspace registry lists the session as archived; false when there is no such
     *  service, so a dsh without one behaves as before. Read through `ctx.get`: the service is not in
     *  `inject`, and a direct property read would throw. */
    isArchived(sessionId) {
        try {
            const registry = this.ctx.get?.("workspaceRegistry");
            return registry?.archivedSessionIds.includes(asSessionId(sessionId)) ?? false;
        }
        catch {
            return false;
        }
    }
    /** Open the next mirror turn of a session: one terminal exchange, its prompt as a user message of
     *  its own through the followup seam the wake uses, answered by the turn loop with the reply the
     *  terminal got. One at a time, so each turn is one prompt and one reply; the loop's `finally`
     *  pumps the next. While a turn runs, the exchange waits for that `finally`. */
    async pumpMirror(sessionId) {
        const m = this.mirrors.get(sessionId);
        if (!m)
            return;
        if (m.inFlight && Date.now() - m.inFlight.at < MIRROR_TURN_TIMEOUT_MS)
            return;
        if (m.inFlight) {
            m.queue.unshift(m.inFlight.turn);
            m.inFlight = undefined;
        }
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (proc?.busy)
            return;
        const turn = m.queue.shift();
        if (!turn)
            return;
        const found = await this.agentFor(sessionId);
        if (!found) {
            m.queue.unshift(turn);
            return;
        }
        const message = createUserMessage({
            content: [{ type: "text", text: turn.content.map((b) => b.text).join("\n") }],
            source: { kind: "user" },
        });
        m.inFlight = { id: String(message.id), turn, at: Date.now() };
        try {
            found.agent.followup(message);
        }
        catch (error) {
            m.queue.unshift(turn);
            m.inFlight = undefined;
            this.log("warn", `mirror followup failed: ${errorText(error)}`);
            return;
        }
        void trace(join(this.stateDir, "resume.log"), `mirror ${sessionId}: followup sent (agent ${found.how})`);
    }
    /** The session's Agent, live or resumed the way a typed prompt resumes it; undefined with a note
     *  in resume.log when neither is possible. */
    async agentFor(sessionId) {
        const note = (line) => trace(join(this.stateDir, "resume.log"), `wake ${sessionId}: ${line}`);
        let agent;
        try {
            agent = this.ctx?.agents?.get?.(asSessionId(sessionId));
        }
        catch (error) {
            // This adapter's cordis scope is gone (plugin hot-reloaded) or not active yet (boot); the
            // caller retries or the next idle reply wakes through the next instance.
            this.log("warn", `wake: adapter scope inactive (${errorText(error)}); skipped`);
            await note(`scope inactive: ${errorText(error)}`);
            return undefined;
        }
        let how = "live";
        if (agent === undefined && this.sessionController) {
            // Idle for minutes: dsh unloaded the Agent. Resume it the way a typed prompt would.
            try {
                agent = resolvedAgent(await this.sessionController.resolveAgent(sessionId));
                how = "resumed";
            }
            catch (error) {
                // dsh refused the stored log. The one session the boot sweep cannot reach is exactly this
                // one (takeInterrupted consumes its id at 10 s, the sweep runs at 15 s), so a refusal the
                // plugin mends is healed here and the resume tried once more.
                const text = errorText(error);
                const path = rawLogPath(text);
                if (path !== undefined && knownRefusal(text) && this.heal) {
                    const { verdict } = await healLog(this.heal, sessionId, path, text);
                    if (verdict !== "healed") {
                        this.log("warn", `wake: could not resume session ${sessionId}: ${text}`);
                        await note(`resume failed: ${text}`);
                        return undefined;
                    }
                    try {
                        agent = resolvedAgent(await this.sessionController.resolveAgent(sessionId));
                        how = "resumed after heal";
                    }
                    catch (again) {
                        await note(`resume failed after heal: ${errorText(again)}`);
                        return undefined;
                    }
                }
                else {
                    this.log("warn", `wake: could not resume session ${sessionId}: ${text}`);
                    await note(`resume failed: ${text}`);
                    return undefined;
                }
            }
        }
        if (!agent) {
            this.log("warn", `wake: no agent for session ${sessionId}; reply waits for the next prompt`);
            await note(`no agent (${how}, controller ${this.sessionController ? "up" : "missing"})`);
            return undefined;
        }
        return { agent, how };
    }
    /** Drop processes idle past processIdleMs, then keep the live count under maxProcesses by
     *  killing the longest-idle ones that are not mid-turn. Called before each spawn. */
    /** Live processes belonging to this mount; the registry is shared across mounts. */
    ownProcessCount() {
        let n = 0;
        for (const key of this.processes.keys())
            if (key.startsWith(`${this.providerId}:`))
                n++;
        return n;
    }
    /**
     * Forget everything this adapter remembers about one session, called wherever its process is
     * dropped. Each of these maps used to grow for the life of the process: a session id was added
     * and never removed, so a box that opens a few hundred sessions a week carried every one of them
     * until dsh restarted. Nothing was ever read wrongly, because a dsh session id is not reused, so
     * the cost was memory alone; it is still a leak, and a one-line forget is cheaper than a comment
     * admitting it. `liveTurn` and the idle watchdog are deliberately absent: both are cleared by
     * the turn that owns them, and clearing them from here could drop a turn that is still running.
     */
    forgetSession(sessionId) {
        this.sessionTools.delete(sessionId);
        this.sessionPluginErrors.delete(sessionId);
        this.sessionPluginWarnings.delete(sessionId);
        this.sessionFallbacks.delete(sessionId);
        this.permissionAsks.delete(sessionId);
        this.awaitingInput.delete(sessionId);
        this.publishAwaiting();
    }
    /** The session id inside a registry key this adapter owns. */
    ownSessionId(key) {
        return key.slice(`${this.providerId}:`.length);
    }
    /** Kill this adapter's own settled processes that have been idle past the threshold and forget their sessions, leaving the rest sorted last-used so an eviction can pick the oldest. */
    evict() {
        const now = Date.now();
        for (const [key, p] of this.processes) {
            if (!key.startsWith(`${this.providerId}:`))
                continue;
            if (!p.alive || (isSettled(p) && now - p.lastUsed > this.config.processIdleMs)) {
                p.kill();
                this.processes.delete(key);
                this.forgetSession(this.ownSessionId(key));
            }
        }
        const idle = [...this.processes.entries()]
            .filter(([k]) => k.startsWith(`${this.providerId}:`))
            .filter(([, p]) => isSettled(p))
            .toSorted((a, b) => a[1].lastUsed - b[1].lastUsed);
        while (this.ownProcessCount() >= this.config.maxProcesses && idle.length > 0) {
            const next = idle.shift();
            if (!next)
                break;
            const [key, p] = next;
            p.kill();
            this.processes.delete(key);
            this.forgetSession(this.ownSessionId(key));
        }
    }
    /**
     * How this dsh request continues the session's Claude process, if at all:
     * - `relay`: parked on relayed tool call(s) and dsh brought every result: answer them, keep going.
     * - `steer`: parked after a live steer reached Claude mid-turn, or everything dsh delivers now was
     *   already forwarded and the CLI answered it as a turn of its own: keep translating, write nothing
     *   new (or only the messages Claude has not seen).
     * - `abandon`: parked on relays but dsh moved on without their results: reject them, start over.
     * - `prompt`: a normal turn; steers Claude already got live are dropped from the prompt.
     */
    continuationFor(options, forceFresh) {
        const held = this.processes.get(registryKey(this.providerId, options.sessionId));
        const live = held?.alive && !forceFresh ? held : undefined;
        const fresh = afterLastAssistant(options.messages);
        const onlySent = (live?.sent.size ?? 0) > 0 && fresh.length > 0 && dropSent(fresh, live?.sent).length === 0;
        if (live && live.relays.size > 0) {
            const results = [...live.relays.keys()].map((id) => toolResultFor(options.messages, id));
            return results.some((r) => r === undefined)
                ? { mode: "abandon", proc: live, options }
                : {
                    mode: "relay",
                    proc: live,
                    options,
                    results: results.filter((r) => r !== undefined),
                };
        }
        if (live && (live.parked === "steer" || onlySent))
            return { mode: "steer", proc: live, options };
        const messages = (held?.sent.size ?? 0) > 0 ? dropSent(options.messages, held?.sent) : options.messages;
        // A fresh turn: a steer flag left by the last turn's final tool call would park this one at
        // its first tool result for nothing, and re-read the batch after the last assistant message.
        // A busy process owns its flag: it is mid-turn with a steer already on stdin, and this call
        // is about to be refused as "already running".
        if (held && !held.busy) {
            held.steerPending = false;
            forgetSteers(held);
            this.publishAsides(options.sessionId);
        }
        return { mode: "prompt", options: { ...options, messages } };
    }
    /** First write of a turn: relay results, unsent steers, or the prompt itself. */
    async openTurn(cont, proc, prep) {
        // dsh claims its whole next-step inbox before it opens a step, so by now everything spliced
        // earlier is drawn, and a park flag left from the step before has nothing left to do. Left set,
        // the CLI's next tool result parked the step into an empty inbox: dsh closed the turn as
        // completed and the CLI ran the rest of its turn with `busy` false, every dsh call declined
        // into the bridge, no card and no text until the next prompt resumed it (owner, 2026-09-16
        // 17:39 and 21:56, a message sent seconds before a dsh tool call both times). A fresh prompt
        // clears the flag in continuationFor; relay and steer mode clear it here.
        if (cont.mode !== "prompt") {
            proc.steerPending = false;
            forgetSteers(proc);
            this.publishAsides(cont.options.sessionId);
        }
        if (cont.mode === "relay") {
            const relays = [...proc.relays.values()];
            proc.relays.clear();
            this.publishAsides(cont.options.sessionId);
            const live = this.liveTurn.get(cont.options.sessionId);
            if (live)
                live.relay = undefined;
            const extra = stepContextFor(cont.options.messages, prep.drops, proc.sent); // steers and notices ride on the last result
            relays.forEach((relay, i) => {
                const result = cont.results[i];
                if (!result)
                    return; // cannot happen: results were built from relays.keys()
                relay.resolve(i === relays.length - 1 ? { ...result, text: result.text + extra } : result);
            });
            return;
        }
        if (cont.mode === "steer") {
            proc.parked = undefined;
            for (const m of afterLastAssistant(cont.options.messages)) {
                const key = steerKey(m);
                if (!key || proc.sent.has(key))
                    continue;
                const local = textOf(m.content);
                if (!local)
                    continue;
                // dsh has projected a file into its handle by now; an image is still a block. It is loaded
                // and noted the way a prompt's are (inline bytes, plus the saved-copy line so Claude can
                // read it again later), so a steer deferred by the live path arrives whole. On a box both
                // follow the turn there, under the short cap: the CLI is parked on this line.
                const host = this.hostLabelFor(cont.options.sessionId);
                const text = host
                    ? await relayFileHandles(local, (path, farName) => this.onBox(host, path, farName, STEER_COPY_CAP_MS), (level, message) => this.log(level, message))
                    : local;
                const images = await this.loadImages(imageRefs([m]), cont.options.signal, host, STEER_COPY_CAP_MS);
                const notes = attachmentNotes([m], images);
                const body = notes ? `${text}\n\n${notes}` : text;
                if (proc.write(buildInput(body, images)))
                    proc.sent.add(key);
            }
            return;
        }
        if (prep.input === null || !proc.write(prep.input))
            throw new LlmError("claude process is not running", "PROVIDER_ERROR");
        proc.promptSentAt = Date.now();
    }
    /**
     * Arm the idle watchdog for a stream: `proc` is killed after `timeoutMs` of silence, which
     * defaults to the configured one. Every event re-arms. Shortly before the kill (60 s, or half the
     * timeout when it is under 120 s) a warning event is queued on the process so the turn loop draws
     * a countdown row; `warn: false` skips that for the aux stream, whose loop has no reasoning lane.
     */
    armIdle(key, proc, warn = true, timeoutMs = this.config.idleTimeoutMs) {
        const warnMs = timeoutMs < 120_000 ? Math.round(timeoutMs / 2) : 60_000;
        this.clearIdle(key);
        const deadline = Date.now() + timeoutMs;
        this.idleDeadlineMap.set(key, deadline);
        this.publishIdle(key);
        this.idleTargets.set(key, { proc, warn, timeoutMs });
        this.idleKillTimers.set(key, setTimeout(() => {
            this.idleDeadlineMap.set(key, null);
            this.publishIdle(key);
            proc.idleKilled = true;
            proc.idleKilledAfterMs = timeoutMs;
            proc.kill();
        }, timeoutMs));
        if (!warn)
            return;
        this.idleWarnTimers.set(key, setTimeout(() => {
            proc.inject({
                type: "idle_warning",
                silentSeconds: Math.round((timeoutMs - warnMs) / 1000),
                leftSeconds: Math.round(warnMs / 1000),
            });
        }, timeoutMs - warnMs));
    }
    /** Stop the watchdog for a stream: the turn ended, or a tool is running and silence is expected. */
    clearIdle(key) {
        clearTimeout(this.idleKillTimers.get(key));
        clearTimeout(this.idleWarnTimers.get(key));
        this.idleKillTimers.delete(key);
        this.idleWarnTimers.delete(key);
        this.idleTargets.delete(key);
        this.idleDeadlineMap.set(key, null);
        this.publishIdle(key);
    }
    /** Push a stream's deadline out by one full timeout; false when nothing is armed under `key`. */
    extendIdle(key) {
        const target = this.idleTargets.get(key);
        if (!target || !this.idleDeadlineMap.get(key))
            return false;
        this.armIdle(key, target.proc, target.warn, target.timeoutMs);
        return true;
    }
    /** Take a flag the target's CLI rejected out of every later spawn for that binary. True when this
     * is the first refusal of that flag, which is the only time a retry can help: the box the turn
     * ran on is the one whose probe was wrong, so the denial is recorded against that box. */
    dropRejectedFlag(proc, options) {
        const flag = unknownFlagIn(`${proc.stderr}\n${proc.stray}`);
        if (!flag)
            return false;
        const host = this.hostLabelFor(options.sessionId);
        if (!denyCliFlag(this.config.command, host, flag))
            return false;
        this.log("warn", `claude on ${host ?? hostname()} rejected ${flag}; dropping it and retrying`);
        return true;
    }
    /** Why a turn that neither finished nor parked ended. */
    endReason(proc, options, idle) {
        if (options.signal?.aborted)
            return { kind: "aborted", failure: { message: "aborted", code: "ABORTED" } };
        if (idle)
            return {
                kind: "error",
                failure: {
                    message: serverText("idleStopped", {
                        s: String(Math.round((proc.idleKilledAfterMs ?? this.config.idleTimeoutMs) / 1000)),
                    }),
                    code: "IDLE_TIMEOUT",
                },
            };
        return {
            kind: "error",
            failure: {
                message: serverText("claudeExited", {
                    code: String(proc.exitCode),
                    detail: (proc.stderr || proc.stray).trim() || serverText("noOutput"),
                }),
                code: "PROVIDER_ERROR",
            },
        };
    }
    /** The persistent turn loop: drive one session's turn end to end. Stream the chunks, relay
     * tool calls, honor interrupts and usage limits, and yield the finish. */
    async *turn(options, forceFresh) {
        const asides = sideQuestionsIn(options.messages).filter((a) => a.message.source?.rpcId === undefined || !this.asked.has(a.message.source.rpcId));
        if (asides.length > 0) {
            const held = this.processes.get(registryKey(this.providerId, options.sessionId));
            for (const aside of asides) {
                const rpcId = aside.message.source?.rpcId;
                // dsh re-sends the same batch on every step of a turn; one ask per message.
                if (rpcId !== undefined)
                    this.asked.add(rpcId);
                // The main mount owns the ring the side-questions route reads, so an aside typed in a
                // session on an SSH box is asked there too, not on this box's own instance.
                this.asideOwner().askSideQuestion(options.sessionId, aside.question);
            }
            if (this.asked.size > ASIDE_ASKED_KEEP)
                for (const id of [...this.asked].slice(0, this.asked.size - ASIDE_ASKED_KEEP))
                    this.asked.delete(id);
            const taken = new Set(asides.map((a) => a.message));
            const messages = (options.messages ?? []).filter((m) => !taken.has(m));
            options = { ...options, messages };
            // Nothing else was typed and no step is waiting on us: the aside is the whole turn.
            const midTurn = held?.alive === true && (held.relays.size > 0 || held.parked !== undefined);
            if (!midTurn && !afterLastAssistant(messages).some((m) => m.source?.kind === "user")) {
                yield* new Translator({ toolActivity: false }).wholeBlock("text", `Asked as a side question. The answer opens in the ✻ aside bubble.`);
                yield { type: "finish", reason: { kind: "stop" } };
                return;
            }
        }
        // A streamed mirror turn: the followup openStream sent carries the running terminal exchange's
        // prompt; the reply fills live from the transcript as it grows. Nothing goes to Claude.
        const stream = this.streaming.get(options.sessionId);
        const streamMine = stream && afterLastAssistant(options.messages).find((m) => m.id === stream.id);
        if (stream && streamMine) {
            const messages = (options.messages ?? []).filter((m) => m !== streamMine);
            options = { ...options, messages };
            yield* this.streamMirror(options.sessionId, stream);
            if (!afterLastAssistant(messages).some((m) => m.source?.kind === "user")) {
                yield { type: "finish", reason: { kind: "stop" } };
                setTimeout(() => void this.pumpMirror(options.sessionId), 1000).unref?.();
                return;
            }
        }
        // A mirror turn: the followup pumpMirror sent is the terminal's prompt, shown as a user message
        // of its own; its answer is the reply the terminal already got. Nothing goes to Claude, whose
        // transcript holds both. A prompt typed into the same batch goes on as usual after it.
        const mirror = this.mirrors.get(options.sessionId);
        const flight = mirror?.inFlight;
        const mine = flight && afterLastAssistant(options.messages).find((m) => m.id === flight.id);
        if (mirror && flight && mine) {
            mirror.inFlight = undefined;
            const messages = (options.messages ?? []).filter((m) => m !== mine);
            options = { ...options, messages };
            yield* new Translator({ toolActivity: false }).wholeBlock("text", mirrorReply(flight.turn, this.config.toolTextLimit));
            if (!afterLastAssistant(messages).some((m) => m.source?.kind === "user")) {
                yield { type: "finish", reason: { kind: "stop" } };
                // The next exchange, once dsh has closed this turn: a followup sent while it closes would
                // ride in as a steer. ponytail: a fixed second stands in for a turn/end hook dsh does not
                // give a provider.
                setTimeout(() => void this.pumpMirror(options.sessionId), 1000).unref?.();
                return;
            }
        }
        const cont = this.continuationFor(options, forceFresh);
        options = cont.options;
        if (cont.mode === "abandon") {
            for (const r of cont.proc.relays.values())
                r.reject(new Error("dsh moved on without a result for this tool call"));
            cont.proc.relays.clear();
            cont.proc.kill();
            this.processes.delete(registryKey(this.providerId, options.sessionId));
            yield* this.turn(options, true);
            return;
        }
        const { prep, proc } = cont.proc
            ? { prep: requirePrep(cont.proc), proc: cont.proc }
            : await this.acquire(options, forceFresh);
        if (proc === null) {
            yield* this.oneShot(options);
            return;
        }
        proc.prep = prep;
        if (cont.mode !== "relay") {
            proc.dshIds = new Set(); // ids only need to survive a relay round trip
            proc.relayed = new Set();
            // dsh clears the todo panel at turn/start; re-append the last list now that the turn is
            // open (a todo/write outside an open turn is rejected by dsh's todo invariant).
            this.restoreTodos(options.sessionId);
        }
        // Compute turn/step once per stream from the open session; used by native tool callbacks.
        let turnStep;
        let formatVersion = 0; // session log format; 0 = dsh before 0.1.5
        let firstChunkAt = 0; // when the first stream chunk landed, for time-to-first-token
        const callSeqs = new Map(); // callId → tool/call seq the result must cite
        try {
            const session = this.ctx?.sessions?.get?.(asSessionId(options.sessionId));
            if (session) {
                // The open turn and step are the newest of each kind, so the scan runs from the tail and
                // stops at the first of each: a few events on a long session instead of all of them
                // (Opus audit, 2026-09-18: the forward walk cost two full passes per turn).
                let turn;
                let step;
                const events = session.snapshotEvents();
                for (let i = events.length - 1; i >= 0 && (turn === undefined || step === undefined); i--) {
                    const e = events[i];
                    if (turn === undefined && e.type === "turn/start")
                        // SAFETY: turn/start events carry turn as a number in data at runtime
                        turn = e.data.turn;
                    else if (step === undefined && e.type === "step/start")
                        // SAFETY: step/start events carry step as a number in data at runtime
                        step = e.data.step;
                }
                if (turn !== undefined && step !== undefined)
                    turnStep = { turn, step };
                formatVersion = session.header.version;
            }
        }
        catch {
            // session unavailable; native rows will fall back to old reasoning blocks
        }
        const rowMode = nativeToolRows({ toolActivity: this.config.toolActivity, toolsInline: this.toolsInline() }, formatVersion, (await rowsSupported()).ok);
        if (rowMode.refused && !this.rowsRefused.has(options.sessionId)) {
            this.rowsRefused.add(options.sessionId);
            this.log("warn", `toolsInline: false ignored: dsh session format v${formatVersion} refuses unadvertised tool rows (the log would not load after a migration); rendering tool activity inline`);
        }
        /** Append a native tool's result row citing its tool/call. Rows mode only; the closure is
         *  shared by the translator (a result frame) and the relay boundary (a placeholder for a call
         *  still running when the step must end). Deletes the call from `callSeqs` either way. */
        const appendNativeResult = turnStep && rowMode.rows
            ? (callId, text, isError, meta) => {
                try {
                    const session = this.ctx?.sessions?.get?.(asSessionId(options.sessionId));
                    if (!session)
                        return;
                    const callSeq = callSeqs.get(callId);
                    callSeqs.delete(callId);
                    // SAFETY: createToolResultMessage returns dsh's own tool-result message (a user
                    // message holding a tool-result block up to 0.1.6, a `role: "tool"` message from
                    // 0.1.7); session.append validates the shape at runtime either way
                    const message = createToolResultMessage({
                        callId: callId,
                        content: [{ type: "text", text }],
                        isError,
                    });
                    // SAFETY: message is ToolResultMessage (a user-role Message); session.append validates JSON at runtime
                    const resultData = { turn: turnStep.turn, step: turnStep.step, message };
                    if (meta)
                        Object.assign(resultData, { meta });
                    // SAFETY: resultData has the shape expected by session.append for tool/result; fields validated at runtime
                    session.append("tool/result", resultData, 
                    // SAFETY: sourceEventSeqs is optional when no call was recorded; invariant allows TOOL_NOT_STARTED as fallback
                    {
                        surfaceOp: "append",
                        sourceEventSeqs: callSeq !== undefined ? [callSeq] : [],
                    });
                }
                catch (err) {
                    this.log("warn", `native tool result append failed: ${err}`);
                }
            }
            : undefined;
        // Close every native call still open with a placeholder result. dsh refuses a log whose step
        // ends over a tool/call with no tool/result ("step/end leaves unresolved tool call", a session
        // lost 2026-09-23), and a step ends on every turn exit: a relay boundary, a normal finish, a
        // steer park, or the process dying mid-step (a dsh-web restart, a crash) with parallel native
        // calls in flight. Both exit paths call this: the relay wait below, and the main loop's tail.
        // A no-op on the happy path, where result frames already emptied callSeqs.
        const flushPending = () => {
            for (const callId of callSeqs.keys())
                appendNativeResult?.(callId, serverText("resultPending"), false);
        };
        const tr = new Translator({
            toolActivity: this.config.toolActivity,
            continueAfterLimit: this.config.continueAfterLimit,
            timeZone: clientTimeZone(options.messages),
            toolTextLimit: this.config.toolTextLimit,
            relay: this.mcp !== undefined && this.config.dshTools,
            dshIds: proc.dshIds,
            relayed: proc.relayed,
            hostLabel: this.hostLabelFor(options.sessionId),
            // A 5xx or 529 asks the status page once a minute; the note lands on the next retry line.
            statusNote: () => {
                const known = peekStatus();
                if (known === undefined)
                    void anthropicStatus();
                return degradedNote(known);
            },
            log: this.log.bind(this),
            onProgress: (p) => {
                const cur = this.liveTurn.get(options.sessionId) ?? {
                    at: Date.now(),
                    // The stall clock counts from the turn's start, as the CLI's does: a slow first byte
                    // tints the line past 10 s. The first stream frame moves it.
                    frameAt: Date.now(),
                    effort: options.reasoningEffort ?? undefined,
                };
                if (p.frame)
                    cur.frameAt = Date.now();
                if (p.tool !== undefined)
                    cur.tool = p.tool;
                const modeChanged = p.mode !== undefined && p.mode !== cur.mode;
                if (p.mode !== undefined)
                    cur.mode = p.mode;
                if (p.relay !== undefined)
                    cur.relay = { name: p.relay.name, at: Date.now() };
                if (p.thinking !== undefined)
                    cur.thinking = p.thinking;
                // When the burst began, kept here rather than in the tab: a tab opened mid-think must read
                // the true age of the burst, not the time since it first looked.
                if (p.thinkingOpen !== undefined) {
                    const now = Date.now();
                    if (!p.thinkingOpen && cur.thinkingAt !== undefined) {
                        cur.thoughtMs = now - cur.thinkingAt;
                        cur.thoughtAt = now;
                    }
                    cur.thinkingOpen = p.thinkingOpen;
                    cur.thinkingAt = p.thinkingOpen ? now : undefined;
                }
                // Never lower than what the row already showed: the CLI's own line takes the max of the
                // estimate and the usage figure (its responseLength reducer), so a block whose estimate ran
                // high does not make the count step backwards when the real number lands.
                if (p.output !== undefined) {
                    cur.output = Math.max(p.output, (cur.output ?? 0) + (cur.thinking ?? 0));
                    cur.thinking = undefined;
                }
                this.liveTurn.set(options.sessionId, cur);
                const body = () => ({
                    kind: "live-turn",
                    session: options.sessionId,
                    data: this.liveTurnReply(options.sessionId),
                });
                // A mode change is the sweep flipping direction; a second late it reads as noise. The
                // figures still ride the 1 s coalesce.
                if (modeChanged)
                    hub.flush(`live-turn:${options.sessionId}`, body());
                else
                    hub.coalesce(`live-turn:${options.sessionId}`, body);
            },
            onToolCall: turnStep && rowMode.rows
                ? (callId, toolName, args) => {
                    // SAFETY: NATIVE_TOOL_MAP is a readonly const object; keyof typeof narrows to known keys only
                    const mapped = NATIVE_TOOL_MAP[toolName] ?? toolName;
                    try {
                        const session = this.ctx?.sessions?.get?.(asSessionId(options.sessionId));
                        // dsh 0.1.7 loads a session only if every tool/call row was announced by a
                        // tool-call block in an assistant message before it, in the same step ("has no
                        // advertised tool lifecycle" otherwise, and the session is refused at the next
                        // restart). Claude runs the tool inside one step and the step's own message
                        // settles after, so the announcement is a message of its own: one tool-call
                        // block, no text, an empty stream like the Import seed writes. Shape checked
                        // against 0.1.7's strict loader on 2026-09-22; 0.1.5's migration wanted the same.
                        // SAFETY: the same row shape the Import seed appends; session.append validates
                        // it at runtime
                        session?.append("assistant/message", {
                            turn: turnStep.turn,
                            step: turnStep.step,
                            message: {
                                role: "assistant",
                                source: { kind: "model", provider: this.providerId, model: options.model },
                                id: `${callId}:call`,
                                content: [{ type: "tool-call", id: callId, name: mapped, arguments: args }],
                            },
                            stream: [],
                        }, { surfaceOp: "append" });
                        // SAFETY: append accepts plain-object data; seq is a number at runtime even though SessionSeq is branded
                        const seq = session?.append("tool/call", {
                            turn: turnStep.turn,
                            step: turnStep.step,
                            callId,
                            name: mapped,
                            arguments: args,
                        })?.seq;
                        if (seq !== undefined)
                            callSeqs.set(callId, seq);
                        return seq;
                    }
                    catch (err) {
                        this.log("warn", `native tool call append failed: ${err}`);
                        return undefined;
                    }
                }
                : undefined,
            redact: this.redact,
            onInit: (names, tools, pluginErrors, pluginWarnings) => {
                // commands_changed re-sends the command catalog alone, so an empty tool list means "not
                // told", not "no tools": overwriting would drop what the init frame established.
                if (options.sessionId && tools.length > 0)
                    this.sessionTools.set(options.sessionId, tools);
                // An init frame is authoritative for plugin errors (a clean load sends []), so write whenever
                // the array is defined; commands_changed passes undefined and is skipped.
                if (options.sessionId && pluginErrors !== undefined)
                    this.sessionPluginErrors.set(options.sessionId, pluginErrors);
                // reload_plugins carries no warning_count (probe 2026-09-19), so warnings refresh only from
                // a fresh init frame, never on a reload; a clean load sends [] and clears them.
                if (options.sessionId && pluginWarnings !== undefined)
                    this.sessionPluginWarnings.set(options.sessionId, pluginWarnings);
                if (names.length > 0)
                    this.bridgeCommands(names, this.ctx?.agents?.get?.(options.sessionId));
            },
            onModel: (rec) => {
                // Bank the switch for the session so the notice and the picker read it at the stop
                // transition. `rec` omits sessionId and at; fill them here (the translator has no clock).
                if (options.sessionId) {
                    this.sessionFallbacks.set(options.sessionId, {
                        ...rec,
                        sessionId: options.sessionId,
                        at: Date.now(),
                    });
                    this.publishAsides(options.sessionId);
                }
            },
            onResult: (summary) => {
                // ponytail: ring buffer capped at 50 entries per session; now also persisted to disk so it
                // survives a dsh restart. Upgrade only if per-turn granularity beyond 50 is needed.
                // Time-to-first-token: prompt write to first chunk. Guard against a wake-only turn (no
                // prompt sent) and a clock that ran backwards; reset so the next turn measures its own.
                if (firstChunkAt > 0 && proc.promptSentAt > 0 && firstChunkAt >= proc.promptSentAt)
                    summary.ttftMs = firstChunkAt - proc.promptSentAt;
                proc.promptSentAt = 0;
                // `total_cost_usd` and `duration_api_ms` arrive as running totals, not this turn's figures.
                // Every reader sums these records: the footer pill, the cost dialog, the /turns route. So
                // the difference is taken here, once, and what is stored is the turn's own.
                const costSoFar = summary.costUsd;
                const apiMsSoFar = summary.apiMs;
                summary.costUsd = turnDelta(costSoFar, proc.costSoFar);
                summary.apiMs = turnDelta(apiMsSoFar, proc.apiMsSoFar);
                proc.costSoFar = costSoFar;
                proc.apiMsSoFar = apiMsSoFar;
                const buf = this.turnBuffer.get(options.sessionId) ?? [];
                buf.push(summary);
                if (buf.length > TURN_RING)
                    buf.shift();
                this.turnBuffer.set(options.sessionId, buf);
                hub.publish({
                    kind: "turns",
                    session: options.sessionId,
                    data: this.turnsReply(options.sessionId),
                });
                void saveTurnRecords(this.stateDir, options.sessionId, buf);
                // The window this model actually runs at, asked once per model between turns so dsh's
                // context ring is right before anyone opens the breakdown. A model switched mid-session is
                // an id this process has not asked about, so the next result asks again for the model it
                // switched to. A session on the mount's default names no model, which is why the guard is
                // what this process asked rather than what the bank holds: nothing would ever ask for it.
                const asking = proc.spec.model ?? "";
                if (proc.windowAskedFor !== asking &&
                    (asking === "" || liveWindowFor(asking) === undefined)) {
                    proc.windowAskedFor = asking;
                    void this.contextUsage(options.sessionId).catch(() => { });
                }
            },
            onToolResult: appendNativeResult,
        });
        const pending = new Map(); // control request id → AbortController
        let outcome = "ended"; // ended | finished | relayed | parked | retry
        const wakeOnly = cont.mode === "prompt" && wakeOnlyTurn(options.messages);
        const onAbort = () => {
            // A dsh shutdown in keeper mode: leave Claude alone. It finishes the turn into the keeper's
            // buffer and the next boot drains it (2026-09-05: the interrupt here cancelled the reply that
            // followed a restart command, so the drain had nothing to show).
            const kind = abortKind(options.signal);
            const interrupt = interruptOnAbort(kind, this.config.spawn);
            // Evidence for the keeper deaths seen with a tool running at shutdown (2026-09-06): which
            // abort reached the turn and what it did about it.
            void trace(join(this.stateDir, "resume.log"), `abort ${options.sessionId}: kind=${kind ?? "none"} spawn=${this.config.spawn} interrupt=${interrupt} toolPending=${tr.toolPending}`);
            if (!interrupt)
                return;
            // Ask the CLI to stop; it answers with a result and stays alive for the next turn. Kill only
            // if it does not.
            tr.aborting = true;
            noteInterrupt(proc);
            if (!proc.write(interruptLine(`interrupt-${randomUUID()}`)))
                return proc.kill();
            // A process that ignores the interrupt is killed after a grace period, except under a keeper:
            // there the idle watchdog already ends a hung process, and a kill here cost a respawn on
            // every model switch (2026-09-06 21:08: abort kind=none, kill at +5 s, "claude exited 143").
            if (!killAfterGrace(this.config.spawn))
                return;
            const fallback = setTimeout(() => {
                if (!tr.finished)
                    proc.kill();
            }, INTERRUPT_GRACE_MS);
            fallback.unref?.();
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        proc.busy = true;
        proc.lastUsed = Date.now();
        this.clearLimitWait(options.sessionId); // a prompt (or our own notice) supersedes the wait
        markBusy(options.sessionId, true, join(this.stateDir, "busy.json")).catch((e) => this.log("warn", `busy.json: ${errorText(e)}`));
        const handleControl = this.handleControl.bind(this);
        // A tool call is silence the CLI owes us nothing during: a build, a test run or an MCP server
        // that thinks about it for a while. Clearing the watchdog for it left a call that never returns
        // with no deadline at all, so the turn sat there until someone noticed. It gets a longer
        // deadline instead, re-armed by every event the way the base one is.
        const armToolIdle = () => this.armIdle(options.sessionId, proc, true, this.config.idleTimeoutMs * TOOL_IDLE_FACTOR);
        const resolveControl = this.resolveControl.bind(this);
        /** One CLI event. Returns what the loop should do next. */
        // The generator below is a plain function, so the adapter is reached through this closure.
        const noteLogin = (r) => this.noteTurnLogin(options.sessionId, r);
        const publishAsidesFor = () => this.publishAsides(options.sessionId);
        const dispatch = async function* (event) {
            if (event.type === "idle_warning") {
                yield* tr.wholeBlock("reasoning", `⏳ Idle watchdog: no output for ${event.silentSeconds}s, stopping in ${event.leftSeconds}s`);
                return "continue";
            }
            if (event.type === "control_request") {
                yield* handleControl(event, options, prep, proc, pending, tr);
                return "continue";
            }
            if (event.type === "control_cancel_request") {
                pending.get(event.request_id)?.abort();
                return "continue";
            }
            if (event.type === "control_response") {
                resolveControl(event);
                return "continue";
            }
            if (event.type === "timeout")
                return "continue";
            if (isStaleResume(event) && proc.resuming && !forceFresh)
                return "retry";
            if (event.type === "result" && proc.staleResults > 0) {
                // End of a turn Claude ran on its own between prompts (see ClaudeProcess.countStaleResults).
                // Its text already streamed into this step. On a wake-only turn the last one ends the
                // turn; under a real prompt, draw a rule and keep reading for the real reply.
                proc.staleResults--;
                if (wakeOnly && proc.staleResults === 0) {
                    yield* tr.translate(event);
                    return "finished";
                }
                yield* tr.wholeBlock("text", "\n\n---\n\n");
                return "continue";
            }
            if (firstChunkAt === 0 && (event.type === "stream_event" || event.type === "assistant"))
                firstChunkAt = Date.now();
            yield* tr.translate(event);
            if (event.type === "result")
                noteLogin(event);
            if (tr.toolPending)
                armToolIdle(); // tool running: silence is expected, but not forever
            if (tr.finished) {
                forgetSteers(proc);
                publishAsidesFor();
                return "finished";
            }
            if (proc.steerPending && event.type === "user") {
                // Tool results are in; the CLI injects the forwarded steer next. End the dsh step here
                // so dsh draws the steer now, then resume this same Claude turn on the next call. The CLI
                // takes its whole queue at one tool result (probed 2026-09-22), so no steer stays editable.
                proc.steerPending = false;
                forgetSteers(proc);
                publishAsidesFor();
                proc.parked = "steer";
                return "parked";
            }
            return "continue";
        };
        /** Claude fires parallel dsh calls as separate MCP requests: gather the batch (one per
         *  outstanding dsh tool_use block), end this step with those tool-calls, keep Claude parked on
         *  its requests, and resolve them when dsh calls back. Returns the turn outcome: "relayed", or
         *  whatever ended the turn under us (its calls are then rejected). */
        const relayBatch = async function* (first) {
            const calls = [first];
            const abandon = (outcomeUnderUs) => {
                for (const c of calls)
                    c.reject(new Error("claude turn ended before dsh could run the tool"));
                return outcomeUnderUs;
            };
            while (calls.length < tr.dshIds.size) {
                const more = await proc.nextEvent(RELAY_BATCH_MS);
                if (more === null)
                    return abandon("ended");
                if (more.type === "timeout")
                    break;
                if (more.type === "dsh_relay") {
                    calls.push(more);
                    continue;
                }
                const what = yield* dispatch(more);
                if (what !== "continue")
                    return abandon(what);
            }
            // Claude's own Bash or Read fired beside the dsh call, and its result reaches us from the
            // CLI a moment after the relay. dsh refuses a log whose step ends with a tool/call and no
            // tool/result ("step/end leaves unresolved tool call", a session lost 2026-09-23), so wait
            // for those results here, bounded, and close any still running with a placeholder row so
            // the step ends valid. Wrong case: a Bash longer than the wait gets the placeholder, and
            // its real output shows in the next step as text under a "result" line.
            // Run flushPending on every exit from the wait below, including the two that end the turn
            // under us (pr-review #99): a step that ends with a tool/call and no tool/result is the
            // corruption this guards against whether the turn ended for a relay or because the process
            // died mid-step, and the session log outlives the process, so the append is valid either way.
            const waitUntil = Date.now() + NATIVE_RESULT_WAIT_MS;
            while (callSeqs.size > 0) {
                const left = waitUntil - Date.now();
                if (left <= 0)
                    break;
                const more = await proc.nextEvent(left);
                if (more === null) {
                    flushPending();
                    return abandon("ended");
                }
                if (more.type === "timeout")
                    break;
                if (more.type === "dsh_relay") {
                    calls.push(more);
                    continue;
                }
                const what = yield* dispatch(more);
                if (what !== "continue") {
                    flushPending();
                    return abandon(what);
                }
            }
            flushPending();
            // The oldest outstanding dsh tool_use blocks are the ones these calls came from.
            const ids = [...tr.dshIds];
            for (const [i, call] of calls.entries()) {
                if (ids[i] !== undefined)
                    tr.relayed.add(ids[i]);
                yield* relayBlocks(tr, call);
                proc.relays.set(call.id, call);
            }
            publishAsidesFor();
            tr.onProgress?.({ relay: { name: first.name } });
            return "relayed";
        };
        try {
            // A relay dsh never answered would otherwise hand its figures to the next turn.
            if (cont.mode === "prompt") {
                this.liveTurn.delete(options.sessionId);
                hub.flush(`live-turn:${options.sessionId}`, {
                    kind: "live-turn",
                    session: options.sessionId,
                    data: {},
                });
            }
            // A fresh prompt: anything already queued is output from a turn Claude ran while dsh was
            // idle (background task finished). Relay/steer modes are mid-turn; their queue is live.
            proc.staleResults = cont.mode === "prompt" ? (proc.countStaleResults?.() ?? 0) : 0;
            // Our own wake notice opened this turn: nothing to send, only that queued output to show.
            // If a user prompt already drained it, there is nothing to do at all.
            if (wakeOnly && proc.staleResults === 0) {
                outcome = "finished";
                yield { type: "finish", reason: { kind: "stop" } };
                return;
            }
            // Before the prompt, never inside a turn: a reconnect is a control request on the same stdin.
            if (cont.mode === "prompt" && !wakeOnly)
                await this.reconnectIfStale(proc, options.sessionId);
            if (!wakeOnly)
                await this.openTurn(cont, proc, prep);
            this.armIdle(options.sessionId, proc);
            for (;;) {
                const event = await proc.nextEvent();
                if (event === null)
                    break;
                if (event.type !== "idle_warning")
                    this.armIdle(options.sessionId, proc);
                if (event.type === "dsh_relay") {
                    outcome = yield* relayBatch(event);
                    break;
                }
                const what = yield* dispatch(event);
                if (what === "continue")
                    continue;
                outcome = what;
                break;
            }
            if (tr.limitResetAt !== undefined && this.config.continueAfterLimit)
                this.armLimitWait(options.sessionId, tr.limitResetAt);
            // What this step spent, once, just before the chunk that closes it. A step that streamed
            // nothing yields nothing here: dsh would rather show no pill than one it cannot prove.
            if (outcome !== "retry")
                yield* tr.takeStepUsage();
            if (outcome === "relayed")
                yield { type: "finish", reason: { kind: "tool-calls" } };
            else if (outcome === "parked")
                yield { type: "finish", reason: { kind: "stop" } };
            else if (outcome === "retry") {
                if (prep.session)
                    await rememberStarted(prep.session.id, false);
            }
            else if (outcome === "finished") {
                if (prep.session)
                    await rememberStarted(prep.session.id, true);
            }
            else if (this.dropRejectedFlag(proc, options)) {
                // Last branch of the chain: nothing above claimed the turn, so the process died under it.
                // The CLI refused a flag the probe credited it with, exiting on argv before its first
                // frame. Nothing streamed, so running the turn again without that flag is a recovery, not
                // a repeat. Placed here rather than under a test on `outcome` because "died under us" is
                // exactly what reaching this branch means.
                outcome = "retry";
                // Same bookkeeping the stale-resume retry does: the CLI died on argv, so the session it was
                // told to start does not exist and must not be remembered as started.
                if (prep.session)
                    await rememberStarted(prep.session.id, false);
            }
            else
                yield { type: "finish", reason: this.endReason(proc, options, proc.idleKilled) };
        }
        finally {
            // The step is over, whichever way it ended, and dsh writes step/end the moment this
            // generator settles. Close any native call the loop left open first, so that step/end never
            // lands over an unresolved tool/call. This runs in `finally`, not after the loop: a user
            // Stop makes dsh call return() on this generator at whatever yield it is parked on, and code
            // after the loop never runs (a session lost 2026-09-23 13:01 to exactly that, with #100's
            // after-the-loop flush in place). The relay path flushes its own exits, and this is a no-op
            // when result frames already emptied callSeqs.
            flushPending();
            // The turn is over, whichever way, unless the step only parked the CLI on a dsh tool or a
            // steer: dsh calls back within the same turn, and the row keeps its figures and names the
            // wait meanwhile. Every other outcome drops them.
            if (!keepsLiveTurn(outcome)) {
                this.liveTurn.delete(options.sessionId);
                hub.flush(`live-turn:${options.sessionId}`, {
                    kind: "live-turn",
                    session: options.sessionId,
                    data: {},
                });
            }
            this.clearIdle(options.sessionId);
            options.signal?.removeEventListener("abort", onAbort);
            for (const c of pending.values())
                c.abort();
            // Backstop: the clears above run when a decision settles, which needs the answerer to honour
            // the abort. A stranded controller is harmless; a stranded awaiting entry announces a prompt
            // that no longer exists, on every reload.
            this.awaitingInput.delete(options.sessionId);
            this.publishAwaiting();
            proc.busy = false;
            proc.lastUsed = Date.now();
            void this.watchTranscript(options.sessionId, prep.cwd, prep.session?.id);
            void this.pumpMirror(options.sessionId);
            // A dsh shutdown aborts the stream with a "disposed" reason. Clearing the busy mark then
            // leaves nothing for the boot resume to nudge (2026-09-05, third restart of the day), so the
            // mark stays for that one case and the next boot picks the session up.
            if (abortKind(options.signal) === "disposed") {
                void trace(`kept busy ${options.sessionId}: stream aborted by disposal`);
            }
            else {
                markBusy(options.sessionId, false, join(this.stateDir, "busy.json")).catch((e) => this.log("warn", `busy.json: ${errorText(e)}`));
            }
            if (outcome === "retry" || outcome === "ended") {
                // A dsh shutdown ends the stream with a "disposed" abort; in keeper mode the process must
                // outlive it (that is the point of the keeper), so leave it for the next boot to adopt.
                const disposing = abortKind(options.signal) === "disposed";
                if (this.config.spawn === "keeper" && disposing) {
                    void trace(join(this.stateDir, "resume.log"), `kept keeper process for ${options.sessionId}: dsh disposing`);
                }
                else {
                    proc.kill();
                    this.processes.delete(registryKey(this.providerId, options.sessionId));
                }
            }
        }
        if (outcome === "retry")
            yield* this.turn(options, true);
    }
    /** dsh's todo projection resets to null on every `turn/start`, so the panel empties each message.
     *  Called at the top of an open turn (dsh's invariant rejects a `todo/write` outside one), this
     *  re-appends the last todo list so it persists across messages and, because it reads persisted
     *  session events, across a restart too. Source-agnostic: works for dsh's own todo tool.
     *  Scans from the tail and stops at the newest list, so a long session pays a few events, not all. */
    restoreTodos(sessionId) {
        if (!this.config.persistTodos || !sessionId)
            return;
        try {
            const session = this.ctx?.sessions?.get?.(asSessionId(sessionId));
            if (!session)
                return;
            let todos;
            const events = session.snapshotEvents();
            for (let i = events.length - 1; i >= 0; i--) {
                const e = events[i];
                if (e.type === "todo/write") {
                    todos = e.data.todos;
                    break;
                }
            }
            if (!Array.isArray(todos) || todos.length === 0)
                return;
            // A list whose every item is done is, to the person reading the panel, no list at all:
            // re-appending it painted a finished plan onto each new message and dsh cleared it again a
            // moment later, which is the flicker. Only work still outstanding is worth restoring.
            if (!hasPendingTodo(todos))
                return;
            session.append("todo/write", { todos });
        }
        catch (error) {
            this.log("warn", `todo restore: ${errorText(error)}`);
        }
    }
    /** A usage limit ended the session's turn: once it resets (plus a grace), drop the continue
     *  notice through the same path a restart uses. Persisted so a restart re-arms it. */
    armLimitWait(sessionId, resetAt, atLeastMs = 0) {
        const log = join(this.stateDir, "resume.log");
        const delay = Math.max(resetAt - Date.now() + LIMIT_GRACE_MS, atLeastMs, 0);
        const old = this.limitTimers.get(sessionId);
        if (old)
            clearTimeout(old);
        const timer = setTimeout(() => {
            this.limitTimers.delete(sessionId);
            saveLimitWait(this.stateDir, sessionId, undefined).catch(() => { });
            this.continueAfterLimit(sessionId).catch((e) => trace(log, `limit wait ${sessionId}: ${errorText(e)}`));
        }, delay);
        timer.unref?.();
        this.limitTimers.set(sessionId, timer);
        saveLimitWait(this.stateDir, sessionId, resetAt).catch(() => { });
        void trace(log, `limit wait ${sessionId}: armed for ${new Date(resetAt).toISOString()} (+${Math.round(delay / 1000)}s)`);
    }
    /** The wait fired. Two things may have changed meanwhile: the session may have been rerouted
     *  to another provider (then the notice would reach a model the limit never touched), and the
     *  account may still be capped (another window, another login, a moved reset). Check both
     *  before the notice goes out; a probe that cannot answer lets the wake try. Extra usage turned
     *  on meanwhile needs no detection: a prompt cancels the wait, and once Claude runs, its own
     *  rate_limit_event says whether credits cover the overflow. */
    async continueAfterLimit(sessionId, probe = readUsage) {
        const log = join(this.stateDir, "resume.log");
        const provider = this.sessionProvider(sessionId);
        if (provider !== undefined && provider !== this.providerId) {
            await trace(log, `limit wait ${sessionId}: session now on ${provider}, notice dropped`);
            return;
        }
        const reply = await probe(fetch, this.config.configDir ? this.claudeHome : undefined);
        const until = stillLimitedUntil(reply);
        if (until !== undefined) {
            await trace(log, `limit wait ${sessionId}: still at the cap, re-armed`);
            this.armLimitWait(sessionId, until);
            return;
        }
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        const sent = await this.wake(sessionId, proc, LIMIT_TEXT);
        await trace(log, `limit wait ${sessionId}: fired, notice ${sent ? "sent" : "not sent"}`);
    }
    /** The provider a session last selected, from its own log; undefined when it never picked one
     *  (dsh's default applies) or the session cannot be read. The read is deprecated in dsh 0.1.6, and
     *  a dsh that drops it would answer undefined for every session, which routes remote workspaces to
     *  the local mount instead of failing. Too quiet to debug from the symptom, so it says so once. */
    sessionProvider(sessionId) {
        try {
            const session = this.ctx?.sessions?.get?.(asSessionId(sessionId));
            return session ? lastSelectedProvider(session.snapshotEvents()) : undefined;
        }
        catch (error) {
            if (!this.warnedNoSessionRead) {
                this.warnedNoSessionRead = true;
                this.log("warn", `session read unavailable, provider routing falls back: ${errorText(error)}`);
            }
            return undefined;
        }
    }
    /** Cancel and forget a session's limit-wait timer, if any, so a usage reset does not fire it twice. */
    clearLimitWait(sessionId) {
        const timer = this.limitTimers.get(sessionId);
        if (!timer)
            return;
        clearTimeout(timer);
        this.limitTimers.delete(sessionId);
        saveLimitWait(this.stateDir, sessionId, undefined).catch(() => { });
    }
    /** Claude finished a turn of its own (a background task it launched completed) while dsh was
     *  idle. Drop a notice into the session's inbox so dsh opens a turn now and the reply shows,
     *  instead of riding on top of the user's next prompt. */
    async wake(sessionId, proc, text = WAKE_TEXT) {
        if (proc?.busy)
            return false;
        // Not while the terminal mirror is on, whatever the notice would say. Every wake opens a real
        // turn, and a real turn runs the model against the session's context, which, for a mirrored
        // session, is a conversation someone is holding in a terminal. Measured here on 2026-09-11: a
        // restart nudged one, it read the terminal's discussion of a feature as its own instructions,
        // wrote the feature, committed it, and switched the branch of a checkout two other sessions were
        // working in. The background-task wake reaches the model by the same path, and the terminal is
        // already showing that reply anyway, so neither is dsh's to send here.
        if (this.terminalSync) {
            await trace(`wake ${sessionId}: terminal mirror on, leaving a terminal-owned session alone`);
            return false;
        }
        const note = (line) => trace(join(this.stateDir, "resume.log"), `wake ${sessionId}: ${line}`);
        if (text === RESTART_TEXT)
            await trace(`wake ${sessionId}: start`);
        const found = await this.agentFor(sessionId);
        if (!found)
            return false;
        const { agent, how } = found;
        // The session's log format decides the shape of the notice's source. When the session is not
        // readable here (an adopted agent, an inactive scope) the catalog's own version stands in: on
        // one install every loaded log is at that version, since dsh migrates on open (9 session dirs
        // held both a v3 and a v4 file on 2026-09-23). Only with neither does the v3 wrapper go out.
        let logVersion = 0;
        try {
            logVersion = this.ctx?.sessions?.get?.(asSessionId(sessionId))?.header?.version ?? 0;
        }
        catch {
            // sessions service unavailable in this scope: fall through to the catalog
        }
        if (logVersion === 0)
            logVersion = (await currentLogVersion()) ?? 0;
        if (text === RESTART_TEXT) {
            // A notice from a previous boot may still sit in the durable inbox: do not stack another.
            try {
                const session = this.ctx?.sessions?.get?.(asSessionId(sessionId));
                if (session &&
                    hasPendingNotice(session.snapshotEvents(), "dsh-oh-my-claude", [
                        RESTART_TEXT,
                        RECONNECT_TEXT,
                    ])) {
                    await trace(`wake ${sessionId}: restart notice already pending, not stacking another`);
                    return true;
                }
            }
            catch (error) {
                this.log("warn", `wake: pending-notice check failed: ${errorText(error)}`);
            }
            await trace(`wake ${sessionId}: agent ${how}, sending followup`);
        }
        try {
            this.log("info", `wake: idle reply in session ${sessionId} (agent ${how})`);
            // Restart and reconnect notices stand in for the owner who configured hands-free resume, so
            // when the session has an active goal they carry the user source: dsh accepts goal resume
            // only from a direct human turn, and the notice asks the model to rearm its goal. With no
            // goal there is nothing to rearm, and the plugin `notice` form draws as a collapsed context
            // row instead of a user bubble (owner, 2026-09-06).
            let goalActive = false;
            try {
                // SAFETY: `goals` is dsh's optional goal service; read defensively, absent in some profiles
                const goals = this.ctx.goals;
                goalActive = goals?.get?.(agent)?.phase === "active";
            }
            catch {
                // no goal service or inactive scope: plain notice
            }
            agent.followup(createUserMessage({
                content: [{ type: "text", text }],
                // SAFETY: the plugin builds against dsh-llm 0.1.6 types, whose MessageSource still spells
                // the v3 `{ kind: "plugin", plugin }` wrapper; dsh 0.1.7's v4 log refuses exactly that
                // shape at runtime and takes the producer-owned kind instead. The runtime is the
                // authority here, so the v4 shape goes through the stale type.
                source: noticeSource(text, goalActive, logVersion),
            }));
        }
        catch (error) {
            this.log("warn", `wake after idle reply failed: ${errorText(error)}`);
            await note(`followup failed: ${errorText(error)}`);
            return false;
        }
        await note(`followup sent (agent ${how})`);
        if (text === RESTART_TEXT) {
            // 2026-09-05: with no browser attached, the restart notice was spliced but no turn started
            // until the next typed prompt. Record the agent's phase after the followup so the next
            // occurrence says whether the loop was idle (driver never kicked) or busy (maintenance).
            // dsh's Agent exposes `status` as a getter ("idle" | "running"); some builds expose a
            // method. Read it defensively: a throw inside setTimeout would take the whole dsh process
            // down (2026-09-05: 14 crash-loop restarts from `a.status()` on a string).
            // SAFETY: only read, never called; any value stringifies, a getter that throws is caught
            const a = agent;
            const phase = () => {
                try {
                    const v = a.status;
                    return v === undefined ? "unknown" : String(v).slice(0, 40);
                }
                catch (error) {
                    return `error:${errorText(error)}`;
                }
            };
            for (const delayMs of [2000, 15000]) {
                setTimeout(() => {
                    void trace(`wake ${sessionId}: phase ${phase()} at +${delayMs}ms`);
                }, delayMs);
            }
        }
        return true;
    }
    /** Offer a dsh tool call from the MCP bridge to the session's live turn. Undefined when no turn
     *  can take it (idle process, a relay already pending); the bridge then executes it directly. */
    relay(sessionId, toolName, args, signal) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive || !proc.busy || proc.relays.size > 0) {
            // Why a dsh tool ran in the bridge instead of dsh's loop; goal tools refuse the bridge path.
            void trace(join(this.stateDir, "resume.log"), `relay ${toolName} for ${sessionId} declined: alive=${String(proc?.alive)} busy=${String(proc?.busy)} pending=${proc?.relays.size ?? 0}`);
            return undefined;
        }
        return new Promise((resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("relay aborted")), { once: true });
            proc.inject({ type: "dsh_relay", id: randomUUID(), name: toolName, args, resolve, reject });
        });
    }
    /** Answer a CLI control request. Permission prompts and questions become dsh dialogs; the answer is written back on stdin. */
    async *handleControl(event, options, prep, proc, pending, tr) {
        const request = event.request ?? {};
        const requestId = event.request_id;
        if (request.subtype === "elicitation") {
            yield* this.elicit(request, requestId, options, proc, pending, tr);
            return;
        }
        if (request.subtype !== "can_use_tool") {
            proc.write(controlErrorLine(requestId, `${request.subtype ?? "unknown"} is not supported by dsh-oh-my-claude`));
            return;
        }
        const toolName = request.tool_name ?? "tool";
        const input = request.input ?? {};
        const toolUseId = request.tool_use_id ?? requestId;
        const controller = new AbortController();
        pending.set(requestId, controller);
        const awaitKind = toolName === "AskUserQuestion"
            ? "question"
            : toolName === "ExitPlanMode"
                ? "plan"
                : "approval";
        this.awaitingInput.set(options.sessionId, {
            kind: awaitKind,
            id: requestId,
            since: Date.now(),
        });
        this.publishAwaiting();
        const signal = options.signal
            ? AbortSignal.any([options.signal, controller.signal])
            : controller.signal;
        const agent = this.ctx?.agents?.get?.(options.sessionId);
        const label = toolName === "AskUserQuestion" ? "❓ question" : `⚑ approval: ${toolName}`;
        yield* tr.wholeBlock("reasoning", `${label} ${permissionReason(toolName, input, request)}`);
        // Decide asynchronously so the stream keeps flowing while the user thinks; the CLI waits on stdin.
        const reply = (line) => {
            if (!proc.write(line))
                this.log("warn", `control response for ${toolName} dropped: claude process already exited`);
        };
        this.decide({ toolName, input, request, toolUseId, agent, signal, accessMode: prep.accessMode })
            .then((result) => reply(controlResponseLine(requestId, result)))
            .catch((error) => reply(controlErrorLine(requestId, errorText(error))))
            .finally(() => {
            pending.delete(requestId);
            const held = this.awaitingInput.get(options.sessionId);
            if (held?.id === requestId) {
                this.awaitingInput.delete(options.sessionId);
                this.publishAwaiting();
            }
        });
    }
    /**
     * An MCP server's elicitation, shown through dsh's question UI: one question per top-level
     * schema property, the answers sent back as the accept content. A `url` mode (the server wants
     * a browser) and a schema dsh cannot present are declined with a reasoning line saying so.
     */
    async *elicit(request, requestId, options, proc, pending, tr) {
        const who = request.display_name ?? request.mcp_server_name ?? "MCP server";
        const reply = (line) => {
            if (!proc.write(line))
                this.log("warn", `elicitation response for ${who} dropped: claude process already exited`);
        };
        if (request.mode === "url") {
            yield* tr.wholeBlock("reasoning", `❓ ${who} wants a browser step, declined: ${request.url ?? "(no url)"}`);
            reply(controlResponseLine(requestId, { action: "decline" }));
            return;
        }
        const questions = elicitationQuestions(request, requestId);
        const ask = this.ctx?.userQuestions?.ask;
        if (!questions || !ask) {
            yield* tr.wholeBlock("reasoning", `❓ ${serverText("inputDeclined", { who })}`);
            reply(controlResponseLine(requestId, { action: "decline" }));
            return;
        }
        yield* tr.wholeBlock("reasoning", `❓ ${who} asks: ${request.message ?? questions[0]?.question ?? ""}`);
        const controller = new AbortController();
        pending.set(requestId, controller);
        this.awaitingInput.set(options.sessionId, {
            kind: "question",
            id: requestId,
            since: Date.now(),
        });
        this.publishAwaiting();
        const signal = options.signal
            ? AbortSignal.any([options.signal, controller.signal])
            : controller.signal;
        const agent = this.ctx?.agents?.get?.(options.sessionId);
        ask({ questions, agent, signal })
            .then((response) => reply(controlResponseLine(requestId, elicitationResult(request, response, requestId))))
            .catch(() => reply(controlResponseLine(requestId, { action: "cancel" })))
            .finally(() => {
            pending.delete(requestId);
            const held = this.awaitingInput.get(options.sessionId);
            if (held?.id === requestId) {
                this.awaitingInput.delete(options.sessionId);
                this.publishAwaiting();
            }
        });
    }
    /** Answer one of Claude's tool permission requests. AskUserQuestion and ExitPlanMode go to dsh's
     *  question dialog, full access allows everything else, and the rest go to dsh's approval
     *  prompt. A dialog that cannot be shown, or is cancelled, answers deny with the reason. */
    async decide({ toolName, input, request, toolUseId, agent, signal, accessMode }) {
        if (toolName === "AskUserQuestion") {
            const questions = parseQuestions(input, toolUseId);
            const ask = this.ctx?.userQuestions?.ask;
            if (!questions || !ask)
                return denyResult(toolUseId, "dsh could not present this question");
            try {
                const response = await this.ctx.userQuestions.ask({ questions, agent, signal });
                return allowResult(toolUseId, { ...input, answers: answersFor(questions, response) });
            }
            catch (error) {
                return denyResult(toolUseId, `question cancelled: ${errorText(error)}`);
            }
        }
        if (toolName === "ExitPlanMode") {
            // Claude's plan arrives as a permission request with input.plan (markdown). Present it the
            // way dsh presents its own exit_plan_mode, so the native Plan review panel renders it.
            const plan = String(input.plan ?? "");
            if (plan !== "") {
                const id = `plan-review:${toolUseId}`;
                // One label for the button and the check below: the stored language may be Chinese.
                const approveLabel = serverText("planApprove");
                try {
                    const response = await this.ctx.userQuestions.ask({
                        questions: [
                            {
                                id,
                                header: serverText("planHeader"),
                                question: serverText("planQuestion"),
                                detail: plan,
                                options: [
                                    { label: approveLabel, description: serverText("planApproveDetail") },
                                    { label: serverText("planKeep"), description: serverText("planKeepDetail") },
                                ],
                                intent: { kind: "plan-review", approve: approveLabel },
                                multiSelect: false,
                            },
                        ],
                        agent,
                        signal,
                    });
                    const item = (response.answers ?? []).find((a) => a.id === id);
                    const feedback = item?.custom ?? "";
                    if (item?.selected?.length === 1 && item.selected[0] === approveLabel && feedback === "")
                        return allowResult(toolUseId, input);
                    return denyResult(toolUseId, feedback === ""
                        ? "The user chose to keep planning; revise the plan and present it again."
                        : `The user chose to keep planning; their feedback: ${feedback}`);
                }
                catch (error) {
                    return denyResult(toolUseId, `plan review cancelled: ${errorText(error)}`);
                }
            }
        }
        if (accessMode === "danger-full-access")
            return allowResult(toolUseId, input);
        const approval = this.ctx?.approval;
        if (!approval || !agent)
            return denyResult(toolUseId, "dsh approval is unavailable for this session");
        let outcome;
        try {
            outcome = await approval.request({
                agent,
                toolName,
                reason: permissionReason(toolName, input, request),
                signal,
            });
        }
        catch (error) {
            return denyResult(toolUseId, `approval failed: ${errorText(error)}`);
        }
        // What this request would have taken as a rule, for the Tune tab's chips. Kept in memory only:
        // it is a prompt, not a record, and a restart is allowed to forget it.
        const sessionId = agent.session?.id;
        if (sessionId !== undefined) {
            const rule = suggestRule(toolName, input);
            const asks = this.permissionAsks.get(sessionId)?.filter((r) => r !== rule) ?? [];
            asks.push(rule);
            this.permissionAsks.set(sessionId, asks.slice(-ASK_SUGGESTIONS));
        }
        if (outcome === "allowed-once")
            return allowResult(toolUseId, input);
        // Under dsh's "never" policy every ask comes back rejected without anyone seeing it, and "the
        // user denied" would send Claude arguing with a person who was never asked.
        if (outcome === "rejected" && sessionId !== undefined && this.approvalsOff.has(sessionId))
            return denyResult(toolUseId, "dsh auto-denied this action: approval prompts are disabled in this session, so nobody was asked. The user can re-enable approvals in dsh or pick the Bypass permission mode.");
        return denyResult(toolUseId, outcome === "rejected" ? "The user denied this action in dsh." : `approval ${outcome}`);
    }
    // ── one-shot path (aux calls, text-mode CLI, no session id) ──────────────
    /** Run one request on a fresh CLI process that exits after its answer, for side calls such as a
     *  session title. No tool activity is shown, and a permission or control request is refused
     *  rather than asked, since nobody is watching a side call. */
    async *oneShot(options) {
        const { cwd, args, session, input } = await this.prepare(options);
        const proc = new ClaudeProcess({
            args: args.filter((a, i) => !(a === "--permission-prompt-tool" || args[i - 1] === "--permission-prompt-tool")),
            cwd,
            spec: {
                cwd,
                model: options.model ?? "",
                effort: null,
                mode: "plan",
                sessionId: null,
                temporary: false,
            },
            command: this.config.command,
            spawner: this.spawner(),
            onExit: () => { },
        });
        if (this.config.debug)
            this.log("info", `one-shot cwd=${cwd} claude ${proc.args.join(" ")}`);
        if (input !== null) {
            proc.write(input);
            proc.child.stdin.end();
        }
        else {
            proc.child.stdin.end();
        }
        const tr = new Translator({
            toolActivity: false,
            timeZone: clientTimeZone(options.messages),
            toolTextLimit: this.config.toolTextLimit,
            hostLabel: this.hostLabelFor(options.sessionId, options.purpose),
            log: this.log.bind(this),
        });
        const onAbort = () => proc.kill();
        options.signal?.addEventListener("abort", onAbort, { once: true });
        const idleKey = `aux-${randomUUID()}`;
        this.armIdle(idleKey, proc, false);
        try {
            for (;;) {
                const event = await proc.nextEvent();
                if (event === null)
                    break;
                this.armIdle(idleKey, proc, false);
                if (event.type === "control_request") {
                    proc.write(controlErrorLine(event.request_id, "not supported in one-shot mode"));
                    continue;
                }
                yield* tr.translate(event);
                if (tr.finished)
                    break;
            }
            if (tr.finished) {
                if (session)
                    await rememberStarted(session.id, true);
                return;
            }
            const reason = options.signal?.aborted
                ? { kind: "aborted", failure: { message: "aborted", code: "ABORTED" } }
                : {
                    kind: "error",
                    failure: {
                        message: proc.idleKilled
                            ? `claude produced no output for ${Math.round((proc.idleKilledAfterMs ?? this.config.idleTimeoutMs) / 1000)}s and was stopped`
                            : `claude exited ${proc.exitCode}: ${(proc.stderr || proc.stray).trim() || "no output"}`,
                        code: proc.idleKilled ? "IDLE_TIMEOUT" : "PROVIDER_ERROR",
                    },
                };
            // SAFETY: reason matches FinishReason shape for error/aborted cases
            yield { type: "finish", reason: reason };
        }
        finally {
            this.clearIdle(idleKey);
            options.signal?.removeEventListener("abort", onAbort);
            proc.kill();
        }
    }
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
function reconcileSshBoxes(ctx, base, boxes, mounts, adapters, log) {
    const desired = new Map(boxes.map((b) => [sshBoxProviderId(b.name), b]));
    for (const [providerId, mount] of mounts) {
        if (desired.has(providerId))
            continue;
        mount.disposeAdapter();
        mount.disposeDirectory();
        mount.adapter.disposeProcesses();
        mounts.delete(providerId);
        adapters.delete(providerId);
        log("info", `ssh box ${providerId} withdrawn`);
    }
    for (const [providerId, box] of desired) {
        if (mounts.has(providerId))
            continue;
        // A hand-written mount or the default already owns this id: leave it, rather than throw
        // DUPLICATE_ADAPTER on the registration.
        if (adapters.has(providerId)) {
            log("warn", `ssh box "${box.name}" -> ${providerId} already mounted; skipped`);
            continue;
        }
        const adapter = new ClaudeCodeAdapter(ctx, {
            ...base,
            providerId,
            providerName: box.name,
            sshHost: box.host,
            // Inherits `spawn`: with the default keeper mode the far claude is held on the box (hold.ts)
            // and survives a restart here; `node` gives the plain ssh pipe.
            dshTools: false,
            configDir: "",
        });
        const disposeDirectory = ctx.llm.registerConfigurableProviders([
            {
                provider: adapter.providerId,
                displayName: adapter.displayName,
                settingsNs: adapter.settingsNs,
                settingsPath: [],
            },
        ]);
        const disposeAdapter = ctx.llm.registerAdapter([adapter.providerId], adapter);
        adapter.registration = disposeAdapter;
        probeLogin(adapter);
        mounts.set(providerId, { adapter, disposeAdapter, disposeDirectory });
        adapters.set(providerId, adapter);
        log("info", `ssh box "${box.name}" mounted as ${providerId} -> ${box.host}`);
        // The box's own holds: a restart mounts the box again from the file and must reattach to
        // the far claudes it left running (2026-09-08: the first restart after holds shipped left the
        // nova session's cli alive on the box with nothing attached, because only the main mount
        // adopted). A hot reload finds the processes already in the shared registry and skips them.
        void adapter.adoptHolds().catch((e) => log("warn", `hold adoption: ${errorText(e)}`));
    }
}
/** The config as this box runs it, as a copy. A bare local `command` becomes the absolute path
 *  `resolveCommand` finds, so a dsh started with a short PATH (DSH Desktop from the macOS Dock)
 *  still reaches the CLI; a remote one is left alone, the far box has its own PATH. On Windows the
 *  keeper gives way to a plain child: it needs a Unix socket and `systemd-run`, neither of which
 *  exists there, so a keeper spawn would fail every turn. */
export function localConfig(config, platform = process.platform, resolve = resolveCommand) {
    const out = { ...config };
    if (!out.sshHost)
        out.command = resolve(out.command);
    if (platform === "win32" && out.spawn === "keeper")
        out.spawn = "node";
    return out;
}
/** One `claude auth status` at mount, so the picker names a logged-out box before its first turn.
 *  A panel token counts too: the CLI's own status cannot see one, and without this a restart named
 *  a box logged in only from the panel as logged out until someone opened Settings. */
const probeLogin = (adapter) => {
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
        .catch(() => { });
};
/** The entry point dsh calls: build the adapter, register its provider and adapter, probe the login, and pin the instance on globalThis so a re-instantiation at boot shares the one already running. */
export function apply(ctx, config) {
    // Looked up on every read: `settings` is not in `inject`, so at apply it may not be mounted yet, and
    // a reference taken now stays undefined for the life of the process (every header wrote English).
    // Both reads are forwarded, and `serverIsChinese` takes whichever this dsh answers: 0.1.6 and
    // earlier have `get`, 0.1.7 replaced it with `describe`.
    bindServerLocale({
        get: (ns) => ctx.get("settings")?.get?.(ns),
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
                // Liveness is checked here, not left to askSideQuestion, which would write its own error into
                // the ring: a recap nobody typed must not leave an error bubble on a session whose process
                // died. The Ask control shows this text in its own note line instead. This narrows the window,
                // it does not close it: askSideQuestion pushes its ring entry (src/adapter.ts:2848) before its
                // own alive re-check, so a process that dies in between still leaves one error bubble.
                if (!owner.processFor(sessionId)?.alive)
                    return {
                        ok: false,
                        error: "no live Claude process for this session; send a prompt first",
                    };
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