// dsh LLM adapter that drives the Claude Code CLI (`claude -p --input-format stream-json --output-format stream-json`).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { LlmAdapter, LlmError, boundContextSummary, createToolResultMessage, createUserMessage, } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { accountIdentity, readPickerSettings, readRemoteWorkspaces, readSshBoxes, registerSessionRoutes, sshBoxProviderId, } from "./sessions.js";
import { readUsage, registerUsageRoute, stillLimitedUntil } from "./usage.js";
import { KEY_HEADER, MCP_PATH, registerMcpBridge } from "./mcp.js";
import { ClaudeProcess, allowResult, answersFor, controlErrorLine, controlResponseLine, denyResult, parseQuestions, permissionReason, userTurnLine, interruptLine, controlRequestLine, decodeRewindResult, decodeContextUsage, decodeWorkspaceDiff, decodeMcpStatus, decodeCliModels, elicitationQuestions, elicitationResult, decodeTitle, toJsonValue, nodeSpawner, seamSpawner, sshSpawner, sshArgs, shq, attachKeeper, launchKeeper, lazyHandle, pidAlive, readKeeperInfo, readKeeperSpec, spawnKeeper, } from "./process.js";
import { ADAPTER_CURRENT, COMMAND_CATALOG, RESUME_TIMER, PROCESS_REGISTRY, TEMPORARY_SESSIONS, TURN_RECORDS, asSessionId, } from "./dsh.js";
import { authHeaders, auxCwd, buildRedactor, CLAUDE_HOME, hasPendingNotice, loadAsides, saveAsides, loadStarters, saveStarter, loadStarted, isPermissionMode, loadPermissionModes, lastSelectedProvider, loadLimitWaits, loadTurnRecords, saveLimitWait, markBusy, modesUpTo, noteBoot, PERMISSION_MODES, loadCommandCatalog, rememberStarted, resolveClaudeHome, saveCommandCatalog, savePermissionMode, saveTurnRecords, STATE_DIR, stateDir, takeInterrupted, trace, } from "./state.js";
import { suggestRule } from "./permissions.js";
import { readSshToken } from "./ssh-login.js";
import { childEnv, errorText } from "./process.js";
import { READY as READY_MARK, asHoldRecord, holdCleanScript, holdHandle, holdName, holdStartScript, sshRunner, } from "./hold.js";
import { dropHold, loadHolds, saveHold } from "./state.js";
import { forkTranscriptText } from "./transcript.js";
import { buildMirror } from "./claude-home.js";
export { markBusy, takeInterrupted } from "./state.js";
export { forkTranscriptText } from "./transcript.js";
import { Translator } from "./translator.js";
export { Translator } from "./translator.js";
/** Live placeholder→remote map for remote workspaces, shared by every box's ssh spawner. Loaded at
 * boot and replaced whenever the panel edits the list, so a redirect applies without a dsh restart. */
let remoteWorkspaces = [];
/** The real remote path for a placeholder workspace on `host`, or `cwd` unchanged. */
function remoteCwdFor(host, cwd) {
    return remoteWorkspaces.find((w) => w.host === host && w.path === cwd)?.remoteCwd ?? cwd;
}
/** The remote workspace whose local placeholder is `cwd`, if any. A session opened on this cwd must
 * run over SSH on that box regardless of the provider chosen, so a local provider does not sit in the
 * empty placeholder dir. */
function remoteWorkspaceFor(cwd) {
    return remoteWorkspaces.find((w) => w.path === cwd);
}
/** A live process always carries the prep it was spawned with; acquire() sets it before use. */
/** A process parked on a relayed tool call or a steer is mid-turn, not idle. */
const isSettled = (p) => !p.busy && p.relays.size === 0 && !p.parked;
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
        .default(true)
        .description("Render tool calls inline in the reasoning stream (keeps live order); off = rich native rows that can render out of order until the next message"),
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
export function registryKey(providerId, sessionId) {
    return `${providerId}:${sessionId}`;
}
const EFFORTS_ALL = ["low", "medium", "high", "xhigh", "max"];
const EFFORTS_45 = ["low", "medium", "high"];
const M = (id, label, contextWindow, efforts) => ({
    provider: "claude-code",
    id,
    name: label,
    contextWindow,
    efforts,
});
// The floor a brand-new box falls back to when the Models API is unreachable and no catalog has
// ever been cached to disk yet. Once a fetch succeeds its result is persisted and seeds later boots,
// so this list only matters on the first offline boot. Ids are what `claude --model` accepts.
export const KNOWN_MODELS = [
    M("claude-fable-5-1", "Claude Fable 5.1", 1_000_000, EFFORTS_ALL),
    M("claude-fable-5", "Claude Fable 5", 1_000_000, EFFORTS_ALL),
    M("claude-opus-5", "Claude Opus 5", 1_000_000, EFFORTS_ALL),
    M("claude-opus-4-8", "Claude Opus 4.8", 1_000_000, EFFORTS_ALL),
    M("claude-opus-4-7", "Claude Opus 4.7", 1_000_000, EFFORTS_ALL),
    M("claude-opus-4-6", "Claude Opus 4.6", 1_000_000, ["low", "medium", "high", "max"]),
    M("claude-sonnet-5", "Claude Sonnet 5", 1_000_000, EFFORTS_ALL),
    M("claude-sonnet-4-6", "Claude Sonnet 4.6", 1_000_000, ["low", "medium", "high", "max"]),
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
/** The three forms an entry takes: a family alias, a version prefix, or the whole id. */
const allows = (entry, id) => {
    const want = bareId(entry);
    const have = bareId(id);
    return have === want || have.startsWith(`${want}-`);
};
export function mergeCatalog(cli, base, picker) {
    if (cli.length === 0 && !picker)
        return base;
    const covered = (id) => cli.some((c) => strip(c.resolvedModel).startsWith(id) || strip(c.value) === id);
    // A CLI row is keyed by an alias (`opus`, `default`), so each row carries the id the allowlist reads.
    const fromCli = cli.map((c) => {
        const bare = strip(c.resolvedModel);
        const known = base.find((b) => bare === b.id || bare.startsWith(b.id));
        const window = c.resolvedModel.endsWith("[1m]") ? 1_000_000 : (known?.contextWindow ?? 200_000);
        // The CLI is asked for its picker once a process is live, so before that answer the lineup
        // spells a model `claude-haiku-4-5` and after it `haiku`. Anything holding an id across that
        // moment — a dsh subagent allowlist, a stored session model — reads the other spelling as a
        // model that is gone. A row landing on a model this catalog already knows takes that model's
        // id, so both states offer the same ids; `default` and a `[1m]` variant have none to take.
        const stable = c.value === "default" || c.resolvedModel.endsWith("[1m]") ? undefined : known?.id;
        return { row: M(stable ?? c.value, c.displayName, window, c.efforts), match: c.resolvedModel };
    });
    let rows = [
        ...fromCli,
        ...base.filter((b) => !covered(b.id)).map((b) => ({ row: b, match: b.id })),
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
    return {
        provider,
        id: model.id ?? "",
        name: model.name ?? "",
        inputModalities: ["text", "image"],
    };
}
/** Exact model metadata. `id` must echo the requested id: dsh-llm normalizeModelInfo rejects mismatches. */
export function resolveModelInfo(provider, modelId, models = catalog.models) {
    const pool = [...models, ...KNOWN_MODELS];
    // A session stored before the ids settled asks for the dated one; it still names a model we know.
    const found = pool.find((m) => m.id === modelId) ??
        pool.find((m) => m.id.startsWith(modelId)) ??
        pool.find((m) => m.id === stableModelId(modelId));
    const info = {
        ...modelInfo(provider, { id: modelId, name: found?.name ?? modelId }),
    };
    if (!found)
        return info;
    info.context = { contextWindow: found.contextWindow };
    if (found.efforts.length > 0) {
        info.reasoning = {
            // SAFETY: effort ids come from the CLI's own catalog; the brand marks provenance only
            efforts: found.efforts.map((id) => ({ id: id, name: id })),
        };
    }
    return info;
}
// ---------------------------------------------------------------------------
// Session mapping: one Claude Code session per dsh session
/** Deterministic UUID for a dsh session id, so a reopened dsh session resumes the same Claude session. */
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
 * Checks if a Claude Code session transcript exists on disk.
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
const textOf = (content) => {
    if (!Array.isArray(content))
        return content ?? "";
    return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
};
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
/** Prompt text of one dsh message, with Claude-native instruction files filtered out. */
const promptTextOf = (m) => m.source?.kind === "agent-instructions"
    ? withoutNativeInstructions(textOf(m.content))
    : textOf(m.content);
/**
 * The turn's text as one stdin prompt. A turn with assistant text in it is labelled by role so the
 * history stays legible; a plain user turn is sent as it was typed, with no label. A turn that
 * carries only an image has no text to send, so it becomes `(see attached)` and the image rides
 * along in `imageRefs`.
 */
export function buildPrompt(turns) {
    const parts = turns
        .map((m) => ({ role: m.role, text: promptTextOf(m) }))
        .filter((t) => t.text !== "");
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
/** Flags a target's binary rejected at runtime, per probe key. A probe can be wrong — a box's CLI
 * updates under us, `--help` comes back empty over a stalled ssh and every flag then reads as
 * supported — and the CLI's answer to a flag it does not have is exit 1 before the first frame. What
 * it printed is better evidence than the probe, so it is remembered and the flag is never sent to
 * that binary again. */
const deniedFlags = new Map();
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
/** One stream-json input line: the user turn with text and inline images. */
export function buildInput(prompt, images) {
    const content = [{ type: "text", text: prompt }];
    for (const img of images) {
        content.push({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.data },
        });
    }
    return userTurnLine(content);
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
const PLAN_APPROVE = "Approve";
const PLAN_KEEP = "Keep planning";
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
    // The rest of Claude's own tools. They have no dsh row variant — dsh classifies anything outside
    // its own table as `others` — but the inline markdown path keys its icon, name and renderer off
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
export function finishReason(result, hostLabel) {
    if (result.is_error) {
        const errors = Array.isArray(result.errors) ? result.errors.join("; ") : "";
        let message = String(result.result ?? errors ?? result.subtype ?? "claude error");
        // Name the box the turn actually ran on: an SSH box or a remote workspace runs the far claude, so
        // the local hostname would point the user at the wrong machine to run `claude auth login` on.
        if (result.api_error_status === 401 || NOT_LOGGED_IN_RE.test(message))
            message = `Claude Code is not logged in on ${hostLabel ?? hostname()}. Run \`claude auth login\` in a terminal there, then send your message again. (${message})`;
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
/** The source a wake notice carries: user only when a restart notice must rearm an active goal. */
export function noticeSource(text, goalActive) {
    const restart = text === RESTART_TEXT || text === RECONNECT_TEXT || text === LIMIT_TEXT;
    return restart && goalActive
        ? { kind: "user" }
        : {
            kind: "plugin",
            plugin: "dsh-oh-my-claude",
            form: "notice",
            summary: boundContextSummary(text),
        };
}
/** After an interrupt, kill a process that did not finish in time: only when no keeper owns it. */
export const killAfterGrace = (spawn) => spawn !== "keeper";
/** Whether an aborted stream should interrupt Claude: always, except a dsh shutdown under a keeper. */
export function interruptOnAbort(kind, spawn) {
    return !(kind === "disposed" && spawn === "keeper");
}
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
        if (!m || m.role !== "user" || m.source?.kind !== "tool" || !Array.isArray(m.content))
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
/** Notice this plugin drops into a session's inbox to open a turn after Claude replied on its own. */
export const WAKE_TEXT = "Claude Code finished a background task and replied.";
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
const isWake = (m) => m.role === "user" &&
    m.source?.kind === "plugin" &&
    m.source.plugin === "dsh-oh-my-claude" &&
    textOf(m.content) === WAKE_TEXT;
/** A turn opened by our own wake notice, with no user prompt to send: only drain what Claude
 *  already wrote. A user prompt in the same batch takes precedence and is sent normally. */
export function wakeOnlyTurn(messages) {
    const fresh = afterLastAssistant(messages);
    return fresh.some(isWake) && !fresh.some((m) => m.source?.kind === "user");
}
/** Drop user messages Claude already received live on stdin (matched by the prompt's rpcId). */
export function dropSent(messages, sent) {
    if (!sent || sent.size === 0)
        return messages ?? [];
    return (messages ?? []).filter((m) => {
        const rpcId = m.source?.rpcId;
        return !(rpcId && sent.has(rpcId));
    });
}
/** What dsh delivered at this step boundary besides the tool result: steers the user sent while
 *  the tool ran, subagent notices, other injections. Claude only sees the tool result, so they
 *  ride along with it. Empty when there is nothing. */
export function stepContextFor(messages) {
    const parts = [];
    for (const m of afterLastAssistant(messages)) {
        if (m.role !== "user")
            continue;
        if (m.source?.kind === "tool")
            continue;
        const text = promptTextOf(m);
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
// Re-export symbols so tests that import from adapter.ts can access them too.
export { PROCESS_REGISTRY, ADAPTER_CURRENT, RESUME_TIMER };
/** How long to wait for the rest of a parallel dsh tool-call batch after the first one arrives. */
const RELAY_BATCH_MS = 1500;
/** After asking the CLI to interrupt, how long before falling back to killing the process. */
const INTERRUPT_GRACE_MS = 5000;
/**
 * Whether Claude's own tool calls may be appended as raw `tool/call`/`tool/result` rows. Only a
 * format-0 session (dsh before 0.1.5) takes them: from 0.1.5 the session format is versioned and
 * its migration refuses any `tool/call` no `assistant/message` advertised, so such rows would make
 * the whole log unloadable on the next upgrade. Inline rendering has no such row.
 */
export function nativeToolRows(config, formatVersion) {
    const wanted = config.toolActivity && !config.toolsInline;
    return { rows: wanted && formatVersion === 0, refused: wanted && formatVersion !== 0 };
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
/**
 * The provider dsh talks to. It owns one Claude Code process per session, converts a dsh turn
 * into stdin lines and the CLI's stream-json back into dsh events, and keeps the state — turn
 * records, permission modes, keepers — that has to survive a restart.
 */
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
    loggedVersion = false;
    /** Probe targets already written to resume.log, so the line lands once per binary, not per turn. */
    probeTraced = new Set();
    sessionController;
    /** Masks secret env values in tool results; undefined when `redactSecrets` is off. */
    redact;
    /** dsh sessions marked temporary with /temporary; on globalThis so a reload keeps them. */
    temporary;
    /** Per-session turn accounting buffer (last 50 turns); keyed by dsh sessionId. Lives on
     *  globalThis so the route registered at boot reads what a hot-reloaded adapter fills. */
    turnBuffer;
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
    /** Callers waiting for the CLI's `control_response` to a request this plugin sent, by request id. */
    controlWaiters;
    /** The rules recent approval requests suggest, newest last, per session. */
    permissionAsks = new Map();
    /** rpcIds of messages already routed to `askSideQuestion`, so a re-sent batch asks once. */
    asked = new Set();
    /** `/btw` side questions and their answers, newest last, per session; kept in memory only. */
    sideQuestions = new Map();
    /** Saved opening prompts: one per session id, plus `default` for the one a session without its own
     *  is offered. Loaded from disk on construct and written through on every save. */
    starters = new Map();
    /** The live thinking budget this plugin last set per session (null = session default, 0 = off);
     *  memory only, since a respawn resets it and the CLI has no flag to carry it. */
    thinkingBudgets = new Map();
    cliModels = [];
    claudeHome;
    /** `~/.claude` itself, which stays the box's login and settings even when transcripts move. */
    realClaudeHome;
    providerId;
    displayName;
    settingsNs;
    stateDir;
    constructor(ctx, config) {
        super();
        this.ctx = ctx;
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
        // With the switch on the CLI runs against the mirror, so `claudeHome` — the path every read in
        // this plugin resolves against — is the mirror too: its settings and login are the real files,
        // read through their links, and only `projects/` is the plugin's own. It needs `stateDir`,
        // which is why it lands here rather than beside `realClaudeHome`.
        if (config.ownTranscripts)
            this.claudeHome = buildMirror(this.realClaudeHome, join(this.stateDir, "claude-home"), (level, msg) => this.log(level, msg));
        this.permissionModes = new Map(); // loaded async below; fire-and-forget
        this.accessModes = new Map();
        this.controlWaiters = new Map();
        loadPermissionModes(this.stateDir)
            .then((modes) => {
            this.permissionModes = modes;
        })
            .catch(() => { }); // state is an optimization only
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
        ctx.on?.("session/event", (sessionArg, eventArg) => {
            // SAFETY: dsh's session/event carries (session, event); only the spliced-inbox fields are read
            const session = sessionArg;
            // SAFETY: same event object, narrowed to the agent/inbox/spliced shape this handler reads
            const event = eventArg;
            if (event?.type !== "agent/inbox/spliced" || event.data?.target !== "next-step")
                return;
            const proc = this.processes.get(registryKey(this.providerId, session?.id ?? ""));
            if (!proc?.alive || !proc.busy || proc.relays.size > 0)
                return;
            for (const m of event.data?.inserted ?? []) {
                const src = m.source;
                const rpcId = src?.rpcId;
                if (m.role !== "user" || src?.kind !== "user" || !rpcId)
                    continue;
                const text = textOf(m.content);
                if (!text)
                    continue;
                // ponytail: text only; a steer with images waits for the boundary like before.
                if (proc.write(buildInput(text, []))) {
                    proc.sent.add(rpcId);
                    proc.steerPending = true;
                }
            }
        });
    }
    /** dsh's handle for this instance's route. `replace` re-reads `providerInfo`, which is how a
     *  name change reaches the picker without a restart. */
    registration;
    loggedOut = false;
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
    providerInfo(provider) {
        return {
            id: provider,
            name: this.loggedOut ? `${this.displayName} (not logged in)` : this.displayName,
        };
    }
    /** Read on every listing rather than cached: an edit to settings.json takes effect at once. */
    pickerSettings() {
        return readPickerSettings(join(this.claudeHome, "settings.json"));
    }
    async listModels(provider) {
        const models = await getCatalog(undefined, this.cliModels, await this.pickerSettings());
        return models.map((m) => modelInfo(provider, m));
    }
    /** No picker filter here: the allowlist curates what the picker offers, and the CLI keeps a
     *  session's own model when the allowlist excludes it rather than failing to resolve it. */
    async resolveModel(provider, model, _signal) {
        const models = await getCatalog(undefined, this.cliModels);
        return resolveModelInfo(provider, model, models);
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
    sessionCwd(sessionId) {
        try {
            return this.ctx.sessions.get(asSessionId(sessionId))?.header?.cwd;
        }
        catch {
            return undefined;
        }
    }
    log(level, message) {
        try {
            this.ctx.logger[level]?.(`dsh-oh-my-claude: ${message}`);
        }
        catch {
            // cordis throws on service access from an inactive scope; a log line is not worth that
        }
    }
    async loadImages(refs, signal) {
        const store = this.ctx.attachments;
        if (!store || refs.length === 0)
            return [];
        const out = [];
        for (const ref of refs) {
            try {
                const stored = await store.readImage(ref, signal);
                out.push({
                    mediaType: ref.mediaType,
                    data: Buffer.from(stored.data).toString("base64"),
                    attachmentId: ref.attachmentId,
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
        const targetHost = this.config.sshHost ?? (options.purpose ? undefined : remoteWorkspaceFor(cwd)?.host);
        const cli = await probeCli(execFile, this.config.command, targetHost);
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
        const turns = selectTurns(options.messages, session?.resuming ?? false);
        const prompt = buildPrompt(turns);
        const stdin = usesStdin(cli.flags);
        const images = stdin ? await this.loadImages(imageRefs(turns), options.signal) : [];
        const model = options.purpose === "session-title" ? this.config.titleModel : options.model;
        const accessMode = accessModeOf(options.messages);
        if (options.sessionId)
            this.accessModes.set(options.sessionId, accessMode);
        const effectivePermissionMode = options.sessionId
            ? this.getPermissionMode(options.sessionId, accessMode)
            : undefined;
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
            mcp: this.mcp && options.sessionId && !options.purpose && this.config.dshTools
                ? { url: `${this.mcp.base}${MCP_PATH}/${options.sessionId}`, key: this.mcp.key }
                : undefined,
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
        return {
            cwd,
            args,
            session,
            spec,
            accessMode,
            input: stdin ? buildInput(prompt, images) : null,
        };
    }
    /** Claude slash commands already registered as dsh commands, name → disposer. */
    bridged = new Map();
    /** Sessions already warned that `toolsInline: false` is ignored on a versioned session format. */
    rowsRefused = new Set();
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
            // owns a name, which the catch below turns into the prefixed registration. Its menu throws —
            // and blanks, all 200 names at once (2026-09-05) — when a host command shadows a client
            // contribution the registry cannot see, so those names never take the bare form at all.
            const prefixed = `${BRIDGE_PREFIX}${cmd}`;
            const dshName = CLIENT_COMMANDS.has(cmd) ? prefixed : cmd;
            if (agent && commands.find(agent, dshName) !== undefined)
                continue;
            const define = (dshCommand) => commands.register({
                name: dshCommand,
                description: `Claude Code /${cmd}`,
                input: { hint: "<arguments>" },
                handler: ({ agent: target, rawInput }) => {
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
                    target.followup(createUserMessage({
                        content: [{ type: "text", text: line }],
                        source: {
                            kind: "plugin",
                            plugin: "dsh-oh-my-claude",
                            form: "notice",
                            summary: boundContextSummary(line),
                        },
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
        // and a temporary session's Claude carries a catalog of its own — either can name one command,
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
    permissionModeInfo(sessionId) {
        const override = this.permissionModes.get(sessionId) ?? null;
        const accessMode = this.currentAccessMode(sessionId);
        // The shield's mapping is the ceiling; before the first prompt names an access mode the
        // config's own default applies, never the loosest mode.
        const ceiling = permissionModeFor(this.config, accessMode ?? undefined);
        const allowed = isPermissionMode(ceiling) ? modesUpTo(ceiling) : PERMISSION_MODES;
        return {
            mode: this.getPermissionMode(sessionId, accessMode ?? undefined),
            override,
            accessMode,
            ceiling,
            allowed,
        };
    }
    /**
     * Store a session's permission mode override (null clears it) and, when that session's Claude
     * process is alive, switch it live with a `set_permission_mode` control request. The CLI reads
     * stdin during a turn; between turns the line is queued and answered when the next turn opens.
     */
    async setPermissionMode(sessionId, mode) {
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
        // 5 s: the CLI answers at once when it reads stdin; a longer wait would only stall the chip.
        const reply = await this.control(proc, { subtype: "set_permission_mode", mode: info.mode }, 5000);
        return reply.ok ? { ...info, live: true } : { ...info, live: true, error: reply.error };
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
        return true;
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
        const servers = decodeMcpStatus(reply.response);
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
    /** Ask a session's live process to re-read plugins, commands, agents and their MCP servers from
     *  disk (`reload_plugins`), so an enable, uninstall or marketplace change the CLI just wrote to
     *  settings takes effect now instead of at the next spawn. No live process is not a failure: the
     *  write landed and the next spawn will read it, so `live` is false and there is nothing to say. */
    async reloadPlugins(sessionId) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: true, live: false };
        const reply = await this.control(proc, { subtype: "reload_plugins" }, 15_000);
        return reply.ok ? { ok: true, live: true } : { ok: false, live: true, error: reply.error };
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
    /**
     * The CLI's own context breakdown (`/context` in the TUI) for a session with a live process;
     * answered between turns as well as inside one. 5 s: the CLI replies at once when it reads stdin.
     */
    async contextUsage(sessionId) {
        const proc = this.processes.get(registryKey(this.providerId, sessionId));
        if (!proc?.alive)
            return { ok: false, error: "no live Claude process for this session" };
        const reply = await this.control(proc, { subtype: "get_context_usage", detail: "summary" }, 5000);
        if (!reply.ok)
            return { ok: false, error: reply.error };
        return { ok: true, ...decodeContextUsage(reply.response) };
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
                description: "Oh My Claude: keep no Claude transcript for this session (toggle)",
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
    processFor(sessionId) {
        const own = this.processes.get(registryKey(this.providerId, sessionId));
        if (own !== undefined)
            return own;
        for (const [key, proc] of this.processes)
            if (key.endsWith(`:${sessionId}`))
                return proc;
        return undefined;
    }
    askSideQuestion(sessionId, question) {
        const q = question.trim();
        const entry = {
            id: `omc-${randomUUID()}`,
            question: q,
            pending: true,
            at: Date.now(),
        };
        const ring = this.sideQuestions.get(sessionId) ?? [];
        ring.push(entry);
        if (!this.sideQuestions.has(sessionId) && this.sideQuestions.size >= ASIDE_MAX_SESSIONS) {
            // Map keeps insertion order, so the first key is the oldest session; evict it.
            const oldest = this.sideQuestions.keys().next().value;
            if (oldest !== undefined)
                this.sideQuestions.delete(oldest);
        }
        this.sideQuestions.set(sessionId, ring.slice(-ASIDE_KEEP));
        const proc = this.processFor(sessionId);
        if (!proc?.alive) {
            entry.pending = false;
            entry.error = "no live Claude process for this session; send a prompt first";
            this.persistAsides(sessionId);
            return;
        }
        void this.control(proc, { subtype: "side_question", question: q, history: [] }, ASIDE_TIMEOUT_MS).then((reply) => {
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
    registerAsideCommand(commands) {
        if (this.bridged.has("btw"))
            return;
        try {
            const dispose = commands.register({
                name: "btw",
                description: "Oh My Claude: ask Claude a quick side question without interrupting the turn",
                input: { hint: "<your question>" },
                handler: ({ agent, rawInput }) => {
                    const question = rawInput.trim();
                    if (!question)
                        return { kind: "error", text: "Usage: /btw <your question>" };
                    this.askSideQuestion(String(agent.id), question);
                    return {
                        kind: "success",
                        text: "Side question sent. The answer opens in the ✻ aside bubble.",
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
    /** The child env a keeper hands Claude: dsh's environment plus the plugin's additions. */
    keeperEnv() {
        return childEnv(process.env, this.config.configDir || this.config.ownTranscripts
            ? { CLAUDE_CONFIG_DIR: this.claudeHome }
            : undefined);
    }
    /** Spawner for one session: keeper mode needs the session to place and name the keeper. */
    spawnerFor(sessionId, spec) {
        if (this.config.spawn !== "keeper" || !sessionId)
            return this.spawner();
        const boxHost = this.config.sshHost;
        if (boxHost)
            return (command, args, cwd) => this.holdOn(boxHost, remoteCwdFor(boxHost, cwd), sessionId, spec, command, args);
        return (command, args, cwd) => {
            // A remote-workspace session runs the far `claude` over SSH: held there, like an SSH box's,
            // rather than under a local keeper that would launch claude in the empty placeholder dir.
            const ws = remoteWorkspaceFor(cwd);
            if (ws)
                return this.holdOn(ws.host, ws.remoteCwd, sessionId, spec, command, args);
            // One directory per spawn: a respawn must never share a socket, keeper.json or keeper.log
            // with the keeper it replaces (2026-09-06: a shared directory let a dying keeper answer the
            // new attach, and a boot read the wrong keeper.json and dropped the live one).
            const stamp = Date.now().toString(36);
            const dir = `${this.keeperDir(sessionId)}-${stamp}`;
            const unit = `omc-keeper-${basename(dir)}`;
            return lazyHandle(spawnKeeper(dir, { command, args, cwd, env: this.keeperEnv(), sessionId, procSpec: spec }, (argv) => launchKeeper(argv, unit)));
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
        if (this.config.sshHost)
            return this.config.sshHost;
        if (purpose)
            return undefined;
        const cwd = sessionId ? this.sessionCwd(sessionId) : undefined;
        return cwd ? remoteWorkspaceFor(cwd)?.host : undefined;
    }
    spawner() {
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
        const local = !this.config.configDir && !this.config.ownTranscripts
            ? base
            : (command, args, cwd) => base(command, args, cwd, { CLAUDE_CONFIG_DIR: this.claudeHome });
        // A remote-workspace cwd runs the far `claude` over SSH on its box, even when this provider is
        // local: otherwise the session sits in the empty local placeholder dir.
        return (command, args, cwd) => {
            const ws = remoteWorkspaceFor(cwd);
            if (ws)
                return sshSpawner(ws.host, () => ws.remoteCwd, readSshToken(STATE_DIR, ws.host))(command, args, cwd);
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
        }
    }
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
    // SAFETY: options from dsh LlmAdapter.generate(); forceFresh is optional bool flag
    async acquire(options, forceFresh) {
        const prep = await this.prepare(options, { forceFresh });
        if (prep.input === null)
            return { prep, proc: null }; // text-mode CLI: fall back to one-shot semantics
        const key = specKey(prep.spec);
        const key2 = registryKey(this.providerId, options.sessionId);
        let proc = this.processes.get(key2);
        // A turn is in flight on this session and this caller is not its continuation — a mid-turn
        // relay or steer arrives with `cont.proc` and never reaches here. Killing the process would
        // end that running turn to make room for this one, so the second caller is refused instead;
        // `busy` is cleared in the turn loop's `finally`, so a failed turn does not wedge the session.
        if (proc?.alive && proc.busy)
            throw new LlmError("a turn is already running in this session", "PROVIDER_BUSY");
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
                    if (this.processes.get(key2) === p)
                        this.processes.delete(key2);
                },
            });
            proc.key = key;
            proc.resuming = prep.session?.resuming ?? false;
            proc.onIdleResult = () => this.wake(options.sessionId, proc);
            this.processes.set(key2, proc);
            if (this.config.debug) {
                this.log("info", `spawn cwd=${prep.cwd} claude ${prep.args.join(" ")}`);
            }
            void this.refreshCliModels(proc);
        }
        return { prep, proc };
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
    evict() {
        const now = Date.now();
        for (const [key, p] of this.processes) {
            if (!key.startsWith(`${this.providerId}:`))
                continue;
            if (!p.alive || (isSettled(p) && now - p.lastUsed > this.config.processIdleMs)) {
                p.kill();
                this.processes.delete(key);
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
    // SAFETY: mirrors acquire() shape for the turn loop
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
        return { mode: "prompt", options: { ...options, messages } };
    }
    /** First write of a turn: relay results, unsent steers, or the prompt itself. */
    openTurn(cont, proc, prep) {
        if (cont.mode === "relay") {
            const relays = [...proc.relays.values()];
            proc.relays.clear();
            const extra = stepContextFor(cont.options.messages); // steers and notices ride on the last result
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
                const rpcId = m.source?.rpcId;
                if (m.role !== "user" || m.source?.kind !== "user" || !rpcId || proc.sent.has(rpcId))
                    continue;
                const text = textOf(m.content);
                if (text && proc.write(buildInput(text, [])))
                    proc.sent.add(rpcId);
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
        this.idleTargets.set(key, { proc, warn, timeoutMs });
        this.idleKillTimers.set(key, setTimeout(() => {
            this.idleDeadlineMap.set(key, null);
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
    // SAFETY: returns FinishReason shape for the adapter loop
    endReason(proc, options, idle) {
        if (options.signal?.aborted)
            return { kind: "aborted", failure: { message: "aborted", code: "ABORTED" } };
        if (idle)
            return {
                kind: "error",
                failure: {
                    message: `claude produced no output for ${Math.round((proc.idleKilledAfterMs ?? this.config.idleTimeoutMs) / 1000)}s and was stopped`,
                    code: "IDLE_TIMEOUT",
                },
            };
        return {
            kind: "error",
            failure: {
                message: `claude exited ${proc.exitCode}: ${(proc.stderr || proc.stray).trim() || "no output"}`,
                code: "PROVIDER_ERROR",
            },
        };
    }
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
                // Inline scan to avoid type assertions; TypeScript narrows e.data after the type guard.
                let turn;
                let step;
                for (const e of session.snapshotEvents()) {
                    if (e.type === "turn/start")
                        // SAFETY: turn/start events carry turn as a number in data at runtime
                        turn = e.data.turn;
                    else if (e.type === "step/start")
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
        const rowMode = nativeToolRows(this.config, formatVersion);
        if (rowMode.refused && !this.rowsRefused.has(options.sessionId)) {
            this.rowsRefused.add(options.sessionId);
            this.log("warn", `toolsInline: false ignored: dsh session format v${formatVersion} refuses unadvertised tool rows (the log would not load after a migration); rendering tool activity inline`);
        }
        const tr = new Translator({
            toolActivity: this.config.toolActivity,
            continueAfterLimit: this.config.continueAfterLimit,
            timeZone: clientTimeZone(options.messages),
            toolTextLimit: this.config.toolTextLimit,
            relay: this.mcp !== undefined && this.config.dshTools,
            dshIds: proc.dshIds,
            relayed: proc.relayed,
            hostLabel: this.hostLabelFor(options.sessionId),
            log: this.log.bind(this),
            onToolCall: turnStep && rowMode.rows
                ? (callId, toolName, args) => {
                    // SAFETY: NATIVE_TOOL_MAP is a readonly const object; keyof typeof narrows to known keys only
                    const mapped = NATIVE_TOOL_MAP[toolName] ?? toolName;
                    try {
                        const session = this.ctx?.sessions?.get?.(asSessionId(options.sessionId));
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
            onInit: (names, tools) => {
                // commands_changed re-sends the command catalog alone, so an empty tool list means "not
                // told", not "no tools": overwriting would drop what the init frame established.
                if (options.sessionId && tools.length > 0)
                    this.sessionTools.set(options.sessionId, tools);
                if (names.length > 0)
                    this.bridgeCommands(names, this.ctx?.agents?.get?.(options.sessionId));
            },
            onResult: (summary) => {
                // ponytail: ring buffer capped at 50 entries per session; now also persisted to disk so it
                // survives a dsh restart — upgrade only if per-turn granularity beyond 50 is needed.
                // Time-to-first-token: prompt write to first chunk. Guard against a wake-only turn (no
                // prompt sent) and a clock that ran backwards; reset so the next turn measures its own.
                if (firstChunkAt > 0 && proc.promptSentAt > 0 && firstChunkAt >= proc.promptSentAt)
                    summary.ttftMs = firstChunkAt - proc.promptSentAt;
                proc.promptSentAt = 0;
                const buf = this.turnBuffer.get(options.sessionId) ?? [];
                buf.push(summary);
                if (buf.length > TURN_RING)
                    buf.shift();
                this.turnBuffer.set(options.sessionId, buf);
                void saveTurnRecords(this.stateDir, options.sessionId, buf);
            },
            onToolResult: turnStep && rowMode.rows
                ? (callId, text, isError, meta) => {
                    try {
                        const session = this.ctx?.sessions?.get?.(asSessionId(options.sessionId));
                        if (!session)
                            return;
                        const callSeq = callSeqs.get(callId);
                        callSeqs.delete(callId);
                        // SAFETY: createToolResultMessage returns a user-role message; session.append validates shape at runtime
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
                : undefined,
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
            if (tr.toolPending)
                armToolIdle(); // tool running: silence is expected, but not forever
            if (tr.finished)
                return "finished";
            if (proc.steerPending && event.type === "user") {
                // Tool results are in; the CLI injects the forwarded steer next. End the dsh step here
                // so dsh draws the steer now, then resume this same Claude turn on the next call.
                proc.steerPending = false;
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
            // The oldest outstanding dsh tool_use blocks are the ones these calls came from.
            const ids = [...tr.dshIds];
            for (const [i, call] of calls.entries()) {
                if (ids[i] !== undefined)
                    tr.relayed.add(ids[i]);
                yield* relayBlocks(tr, call);
                proc.relays.set(call.id, call);
            }
            return "relayed";
        };
        try {
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
                this.openTurn(cont, proc, prep);
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
                // frame — nothing streamed, so running the turn again without that flag is a recovery, not
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
            this.clearIdle(options.sessionId);
            options.signal?.removeEventListener("abort", onAbort);
            for (const c of pending.values())
                c.abort();
            proc.busy = false;
            proc.lastUsed = Date.now();
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
     *  ponytail: O(n) scan of session events per turn; cache the last list if long sessions lag. */
    restoreTodos(sessionId) {
        if (!this.config.persistTodos || !sessionId)
            return;
        try {
            const session = this.ctx?.sessions?.get?.(asSessionId(sessionId));
            if (!session)
                return;
            let todos;
            for (const e of session.snapshotEvents())
                if (e.type === "todo/write")
                    todos = e.data.todos;
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
     *  (dsh's default applies) or the session cannot be read. */
    sessionProvider(sessionId) {
        try {
            const session = this.ctx?.sessions?.get?.(asSessionId(sessionId));
            return session ? lastSelectedProvider(session.snapshotEvents()) : undefined;
        }
        catch {
            return undefined;
        }
    }
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
        const note = (line) => trace(join(this.stateDir, "resume.log"), `wake ${sessionId}: ${line}`);
        if (text === RESTART_TEXT)
            await trace(`wake ${sessionId}: start`);
        let agent;
        try {
            agent = this.ctx?.agents?.get?.(asSessionId(sessionId));
        }
        catch (error) {
            // This adapter's cordis scope is gone (plugin hot-reloaded) or not active yet (boot); the
            // caller retries or the next idle reply wakes through the next instance.
            this.log("warn", `wake: adapter scope inactive (${errorText(error)}); skipped`);
            await note(`scope inactive: ${errorText(error)}`);
            return false;
        }
        let how = "live";
        if (agent === undefined && this.sessionController) {
            // Idle for minutes: dsh unloaded the Agent. Resume it the way a typed prompt would.
            try {
                agent = await this.sessionController.resolveAgent(sessionId);
                how = "resumed";
            }
            catch (error) {
                this.log("warn", `wake: could not resume session ${sessionId}: ${errorText(error)}`);
                await note(`resume failed: ${errorText(error)}`);
                return false;
            }
        }
        if (!agent) {
            this.log("warn", `wake: no agent for session ${sessionId}; reply waits for the next prompt`);
            await note(`no agent (${how}, controller ${this.sessionController ? "up" : "missing"})`);
            return false;
        }
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
                source: noticeSource(text, goalActive),
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
            .finally(() => pending.delete(requestId));
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
            yield* tr.wholeBlock("reasoning", `❓ ${who} asked for input dsh cannot present, declined`);
            reply(controlResponseLine(requestId, { action: "decline" }));
            return;
        }
        yield* tr.wholeBlock("reasoning", `❓ ${who} asks: ${request.message ?? questions[0]?.question ?? ""}`);
        const controller = new AbortController();
        pending.set(requestId, controller);
        const signal = options.signal
            ? AbortSignal.any([options.signal, controller.signal])
            : controller.signal;
        const agent = this.ctx?.agents?.get?.(options.sessionId);
        ask({ questions, agent, signal })
            .then((response) => reply(controlResponseLine(requestId, elicitationResult(request, response, requestId))))
            .catch(() => reply(controlResponseLine(requestId, { action: "cancel" })))
            .finally(() => pending.delete(requestId));
    }
    // SAFETY: destructured from ClaudeCodeControlRequest shape in process.ts
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
                try {
                    const response = await this.ctx.userQuestions.ask({
                        questions: [
                            {
                                id,
                                header: "Plan review",
                                question: "Approve this plan and leave plan mode?",
                                detail: plan,
                                options: [
                                    { label: PLAN_APPROVE, description: "Leave plan mode and carry the plan out." },
                                    {
                                        label: PLAN_KEEP,
                                        description: "Stay in plan mode; your feedback goes to Claude.",
                                    },
                                ],
                                intent: { kind: "plan-review", approve: PLAN_APPROVE },
                                multiSelect: false,
                            },
                        ],
                        agent,
                        signal,
                    });
                    const item = (response.answers ?? []).find((a) => a.id === id);
                    const feedback = item?.custom ?? "";
                    if (item?.selected?.length === 1 && item.selected[0] === PLAN_APPROVE && feedback === "")
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
        return denyResult(toolUseId, outcome === "rejected" ? "The user denied this action in dsh." : `approval ${outcome}`);
    }
    // ── one-shot path (aux calls, text-mode CLI, no session id) ──────────────
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
 * that drives `claude` on its host over ssh with its own remote login — the same shape a hand-written
 * mount would have, but built from the plugin's own state file so the panel owns the list and no dsh
 * config is edited. The provider registrations are live handles, so a box appears in or leaves the
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
/** One `claude auth status` at mount, so the picker names a logged-out box before its first turn. */
const probeLogin = (adapter) => void accountIdentity(adapter.config.command, adapter.claudeHome, adapter.config.sshHost)
    .then((who) => adapter.setLoggedIn(who.loggedIn))
    .catch(() => { });
export function apply(ctx, config) {
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
            relay: (sessionId, toolName, args, signal) => adapter.relay(sessionId, toolName, args, signal),
        }).then((mcp) => {
            adapter.mcp = mcp;
        }, (e) => adapter.log("warn", `mcp bridge unavailable: ${errorText(e)}`));
        // Build a provider→home lookup from the registry so the usage route can resolve other instances.
        const homeFor = (providerId) => g[ADAPTER_CURRENT]?.get(providerId)?.claudeHome;
        // The same registry answers the session routes: a request that names its session's mount reads
        // that mount's box, so a session on an SSH box stops being reported as this one.
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
        registerUsageRoute(ctx, (level, msg) => adapter.log(level, msg), (home) => accountIdentity(adapter.config.command, home, adapter.config.sshHost), { home: claudeHome, homeFor });
        registerSessionRoutes(ctx, {
            log: (level, msg) => adapter.log(level, msg),
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
            onRemoteWorkspaces: (workspaces) => {
                remoteWorkspaces = workspaces;
            },
            command: adapter.config.command,
            sshHost: adapter.config.sshHost,
            instanceFor,
            onLoginStatus: (id, loggedIn) => g[ADAPTER_CURRENT]?.get(id ?? adapter.providerId)?.setLoggedIn(loggedIn),
            turnRecords: adapter.turnBuffer,
            idle: {
                deadlineFor: (session) => adapter.idleDeadlineMap.get(session) ?? null,
                extend: (session) => adapter.extendIdle(session),
                timeoutMs: adapter.config.idleTimeoutMs,
            },
            permissionModes: {
                info: (sessionId) => adapter.permissionModeInfo(sessionId),
                set: (sessionId, mode) => adapter.setPermissionMode(sessionId, mode),
            },
            contextUsage: (sessionId) => adapter.contextUsage(sessionId),
            workspaceDiff: (sessionId) => adapter.workspaceDiff(sessionId),
            mcp: {
                status: (sessionId) => adapter.mcpStatus(sessionId),
                reconnect: (sessionId, serverName) => adapter.mcpReconnect(sessionId, serverName),
            },
            rewind: (sessionId, uuid, dryRun) => adapter.rewind(sessionId, uuid, dryRun),
            permissionAsks: adapter.permissionAsks,
            sideQuestions: adapter.sideQuestions,
            persistAsides: (sessionId) => adapter.persistAsides(sessionId),
            starters: adapter.starters,
            setStarter: (key, text) => {
                adapter.setStarter(key, text);
            },
            thinking: {
                info: (sessionId) => adapter.thinkingInfo(sessionId),
                set: (sessionId, tokens) => adapter.setThinkingBudget(sessionId, tokens),
            },
            models: () => adapter.getAdvisorModels(),
            reloadPlugins: (sessionId) => adapter.reloadPlugins(sessionId),
            continueAfterLimit: adapter.config.continueAfterLimit,
        });
        // Mount the saved SSH boxes at boot; `sshMounts` is scope-local so a hot reload rebuilds them.
        void readSshBoxes(join(STATE_DIR, "ssh-boxes.json"))
            .then((boxes) => reconcileSshBoxes(ctx, config, boxes, sshMounts, sshAdapters, (l, m) => adapter.log(l, m)))
            .catch((e) => adapter.log("warn", `ssh boxes: ${errorText(e)}`));
        // Load the remote-workspace redirects so a box session lands in its real remote path at boot.
        void readRemoteWorkspaces(join(STATE_DIR, "remote-workspaces.json"))
            .then((ws) => {
            remoteWorkspaces = ws;
        })
            .catch((e) => adapter.log("warn", `remote workspaces: ${errorText(e)}`));
    }
}
//# sourceMappingURL=adapter.js.map