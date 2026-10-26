import type { IncomingMessage, ServerResponse } from "node:http";
import { type FoldedTranscript } from "./transcript.js";
import { ClaudeUpdater } from "./claude-update.js";
import { type Reach } from "./reach.js";
import { type FsBox } from "./remote-fs.js";
import type { TranscriptListItem } from "./transcript.js";
import type { JsonValue, PluginContext, SessionPersistence, WorkspaceRegistry } from "./dsh.js";
import type { FallbackRecord, LiveTask } from "./translator.js";
import { type SteerAttachment } from "./process.js";
import { type HealHost, type RepairsSummary } from "./session-heal.js";
import type { ToolMode, ToolModeInfo } from "./rows-probe.js";
import { type PluginLoadError } from "./plugins.js";
import { EFFORTS_ALL } from "./adapter/catalog.js";
import type { LoginNeed, PermissionModeInfo, PermissionModeReply, PermissionModeState, RewindReply, ContextUsageReply, SkillDoctorReply, WorkspaceDiffReply, PermissionReadoutReply, McpStatusReply, AsideEntry, AsidesReply, IdleReply, LiveTurnReply } from "./adapter/types.js";
import type { TurnsReply, LiveTurn } from "./adapter/turn.js";
import { type EventHub, type OmcEvent } from "./events.js";
declare const ROUTE_PREFIX = "/dsh-oh-my-claude";
/** Longest selected passage `POST /side-questions` passes on; matches QUOTE_MAX in client/selection.ts. */
declare const SELECTION_QUOTE_MAX = 4000;
/** An imported transcript is a whole conversation, not a form field: megabytes, not kilobytes. */
declare const IMPORT_LIMIT: number;
/** A search hit, joined to its transcript's listing metadata for the title and modification time. */
export interface SearchHit {
    id: string;
    title: string;
    modifiedAt: number;
    cwd?: string;
    count: number;
    when: number;
    role: "user" | "assistant";
    snippet: string;
}
/** How many transcript files one scan reads and parses. grep already narrowed the list to files
 *  that mention the query, but a query can still match hundreds, and reading them all holds them
 *  all in memory at once; 400 keeps one scan well under the cost of reading every transcript. */
declare const SEARCH_MAX_FILES = 400;
/** Maximum hits returned per search; more matches are dropped and the reply flags this via `truncated`. */
declare const SEARCH_LIMIT = 100;
/** The basename of a path: everything after its last `/` or `\\`, so a Windows path splits too. A
 *  transcript id is the basename without `.jsonl`, and this joins a search hit to its listing. */
declare const baseName: (path: string) => string;
/**
 * The files among `files` that mention `word`, case-insensitively: what `grep -rilF` answers, for
 * a box that has no grep (a Windows host). A file that cannot be read is left out.
 *
 * ponytail: reads every listed transcript whole, one at a time, and the scan after it reads the
 * matches a second time. Fine for the hundreds of files a box holds; stream them if a Windows box
 * with thousands of transcripts makes search slow.
 */
declare function filesMentioning(files: readonly string[], word: string): Promise<string[]>;
/** Answer an HTTP request as JSON with a no-store cache header. Every route in this file replies
 *  through it, so no browser or proxy can hand back a stale answer for a state that changes under
 *  it, such as a session list or a login. */
declare const json: (res: ServerResponse, status: number, value: unknown) => void;
/** Any JSON object, as a request body or a stored file decodes to. */
type JsonObject = Record<string, JsonValue>;
/** Parse a JSON request body, capped at `limit` bytes. A non-object body reads as an empty object. */
export declare const readBody: (req: IncomingMessage, limit?: number) => Promise<JsonObject>;
/** Narrows an unknown value to a string only when it passes the memory-name rules; anything else
 *  stays unknown, so the caller refuses it rather than using a name it would later reject. */
declare const validMemoryName: (name: unknown) => name is string;
/** Narrows an unknown value to a string only when it is a 36-character lowercase-hex UUID; a
 *  malformed id fails closed and is refused rather than used as a session id. */
declare const validId: (id: unknown) => id is string;
/** A dsh session id as the repairs record keys it: the uuid, with dsh's `session-` prefix or
 *  without (a child agent's id has none). The reseed route takes this form, since its record is
 *  keyed by the dsh id rather than the transcript's. */
declare const validDshId: (id: unknown) => id is string;
/** What parseSettingsText hands back: the object, or why the text is not one. */
export type ParsedSettings = {
    value: JsonObject;
    error?: undefined;
} | {
    error: string;
    value?: undefined;
};
/** settings.json must be one JSON object; anything else Claude Code would reject or ignore. */
export declare function parseSettingsText(text: unknown): ParsedSettings;
/** Output of a probe command, or "" plus the failure text so the panel can show why. */
declare const run: (cmd: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string, timeout?: number) => Promise<{
    out: string;
    error?: string;
}>;
/** A file at the plugin's root. Source runs from src/, the tsc build from lib/server/, so the
 *  root is one or two levels up: try the nearer first and fall back to the farther. */
declare const readPluginFile: (name: string) => Promise<string>;
/** The lowest dsh this build runs on, off its own peer range; reported on `/status`. */
declare const DSH_FLOOR: string | undefined;
declare const PLUGIN_VERSION: string;
/** Mirrors bugs.url in package.json; the report's Open issue link. */
declare const ISSUES_URL = "https://github.com/lcestou/dsh-oh-my-claude/issues/new";
/** How many releases the Settings card lists; the rest is a link to the file on GitHub. The card's
 *  summary line in `src/client/index.tsx` says "five", so a change here changes that too. */
declare const CHANGELOG_RELEASES = 5;
/** The box-wide booleans and non-negative numbers under `hints.json`: one-time hints and the
 *  settings switches. Only `true` and finite non-negative numbers are kept, so a missing or
 *  unreadable file reads as every switch at its default. */
export declare function readHints(hintsPath: string): Promise<Record<string, boolean | number>>;
/**
 * Apply one patch to the hints store, serialized against every other patch.
 *
 * The store is read-modify-write, and two requests that overlap both read the file before either
 * writes it: the second write then puts back a map from before the first, and every key the first
 * added is gone. That is not theoretical. A run of rapid switch changes on 2026-09-17 left the
 * file holding one key out of eight. Requests queue here instead, and the write goes through
 * `writeJson` so a crash mid-write cannot truncate the file either.
 *
 * `true` and finite non-negative numbers are kept; `false` and `null` drop the key, which is how a
 * switch returning to its default clears itself. Anything else is ignored, key names included.
 */
export declare function updateHints(hintsPath: string, patch: Record<string, unknown>): Promise<Record<string, boolean | number>>;
/** A newer release on npm than the one running, with the command that brings it in. Only this box
 *  asks: a remote dsh box answers its own `/status` from its own copy. The Update notice switch
 *  (`updateCheckOff` in the hints store) turns the read off entirely, not just the pill. A release
 *  whose dsh floor this box's dsh does not reach is not offered: installing it would replace a
 *  working plugin with one that refuses to mount, and the box's dsh channel brings the newer dsh
 *  in its own time. */
declare function pluginUpdate(hintsPath: string, dsh: string | null | undefined): Promise<{
    latest: string;
    update: string;
} | undefined>;
/** The repo's star count for the nudge in Settings, this box only. The dismiss flag (`starOff` in
 *  the hints store) turns the read off, so a person who hid the line pays no GitHub call. */
declare function pluginStars(hintsPath: string): Promise<number | undefined>;
/** Another dsh server this panel can hop to; `token` is that box's dsh launch token. */
export interface Box {
    name: string;
    url: string;
    token?: string;
}
/** What validateBoxes hands back: the cleaned list, or why the input is not one. */
export type ValidatedBoxes = {
    boxes: Box[];
    error?: undefined;
} | {
    error: string;
    boxes?: undefined;
};
/**
 * The saved list of other dsh servers ("boxes"), each running this plugin with its own Claude
 * Code login. The browser hops between them; nothing is proxied. `token` is that box's dsh launch
 * token, kept so a browser without its cookie can still open it (same trick as the NPM proxy).
 */
export declare function validateBoxes(input: unknown): ValidatedBoxes;
/** A remote host this plugin drives Claude Code on over SSH. `name` labels it in the picker; `host`
 * is the ssh target (`[user@]host` or an `~/.ssh/config` alias). Stored in the plugin's own state,
 * so a box is added from the panel, never by hand-editing dsh config. */
export interface SshBox {
    name: string;
    host: string;
    /** How the host is reached, when it is a tunnel address rather than a plain ssh host. */
    via?: "tailscale" | "wireguard";
}
/** The provider id a box mounts under: `claude-code-<slug of name>`, so each box is an independent
 * instance with its own login, state and process registry, the way a hand-written mount would be. */
export declare function sshBoxProviderId(name: string): string;
/** What validateSshBoxes hands back: the cleaned list, or why the input is not one. */
export type ValidatedSshBoxes = {
    boxes: SshBox[];
    error?: undefined;
} | {
    error: string;
    boxes?: undefined;
};
/** Coerces each entry to a plain object and returns a structured error instead of throwing,
 *  enforcing the box-count cap and per-box name and host rules. */
export declare function validateSshBoxes(input: unknown): ValidatedSshBoxes;
/** Read the SSH-boxes file and return the validated list, or [] when it is missing or corrupt, so
 *  a box list never throws on a gone or malformed file. */
export declare function readSshBoxes(path: string): Promise<SshBox[]>;
/** A dsh workspace this plugin points at a directory on an SSH box. dsh stores and stat-checks local
 * paths only, so each remote workspace owns an empty local placeholder dir that dsh adopts as an
 * ordinary workspace (`path`); at spawn the ssh spawner swaps `path` for `remoteCwd` on `host`, so the
 * far `claude` runs in the real remote directory. No file mirror: the remote Claude reads the box's
 * own files. Stored in the plugin's own state, added from the panel. */
export interface RemoteWorkspace {
    name: string;
    host: string;
    remoteCwd: string;
    /** Canonical local placeholder path dsh stores as the workspace cwd; the spawner's match key. */
    path: string;
    workspaceId: string;
}
/** A slug safe as one path segment: lowercase alnum, other runs to one dash, bounded. */
export declare const slugForDir: (s: string) => string;
/** What the add form sends; cleaned or rejected before a placeholder or workspace is made. */
export type ValidatedRemoteWorkspace = {
    value: {
        name: string;
        host: string;
        remoteCwd: string;
    };
    error?: undefined;
} | {
    error: string;
    value?: undefined;
};
/** Clean an add-workspace form into a name, host and absolute remote path, or a structured error,
 *  so a bad name or relative path cannot seed a placeholder directory. */
export declare function validateRemoteWorkspaceInput(input: unknown): ValidatedRemoteWorkspace;
/** Read the placeholder-workspaces file and return its rows, or [] when it is missing, corrupt or
 *  not an array, so a reconcile never throws on a gone or malformed file. */
export declare function readRemoteWorkspaces(path: string): Promise<RemoteWorkspace[]>;
/** The file, minus every row whose dsh workspace is gone. dsh's registry owns which workspaces
 *  exist (the sidebar's trash deletes there and never here), so a row the registry no longer
 *  lists is a ghost: dropped, its placeholder removed, the file rewritten. Without a registry (a
 *  dsh that lacks the service, or a request before it mounts) the file is answered as it is. */
export declare function syncRemoteWorkspaces(path: string, reg: Pick<WorkspaceRegistry, "get"> | undefined, log?: (level: string, msg: string) => void): Promise<{
    workspaces: RemoteWorkspace[];
    dropped: RemoteWorkspace[];
}>;
/** The instance whose local spawns take this box's panel login. */
declare const DEFAULT_PROVIDER = "claude-code";
/** `authMethod` a status reports when the login is a token the panel minted, not the CLI's own. */
export declare const PANEL_TOKEN = "panel token";
/** What a box's `/status` reports; the panel shows these fields as pills. */
export interface RuntimeStatus {
    host: string;
    plugin: string;
    binary: string | null;
    version: string | null;
    error?: string;
    configDir: string;
    loggedIn: boolean;
    authMethod: string | null;
    email?: string | null;
    projectsDirectory?: string | null;
    /** For an SSH box: why it did not answer, sorted so the row can name the fix (reach.ts). */
    reach?: Reach;
    /** A newer plugin release on npm, and the command that installs it. This box only. */
    latest?: string;
    update?: string;
    /** GitHub stargazers_count for this repo; absent when offline, rate-limited or dismissed. This box only. */
    stars?: number;
    /** Session logs the plugin healed, could not heal, or rolled back since the last dismissal. */
    sessionRepairs?: RepairsSummary;
    /** Claude processes still running on the box; they answer on the login they loaded at start. */
    running?: number;
    /** The dsh this plugin is loaded beside, and the lowest dsh this build runs on. This box only. */
    dsh?: string | null;
    dshFloor?: string | null;
}
/** One probe's outcome: the decoded body, or why the box could not be reached. */
export type Probe<T> = {
    ok: true;
    status: T;
} | {
    ok: false;
    error: string;
};
/** The subset of fetch the probe uses, so tests can hand in a fake. */
export type FetchLike = (url: string, init: {
    headers?: Record<string, string>;
    redirect: "manual";
    signal: AbortSignal;
}) => Promise<{
    status: number;
    ok: boolean;
    headers: {
        get(name: string): string | null;
    };
    json(): Promise<unknown>;
    text(): Promise<string>;
}>;
/**
 * Log into a box like a browser would (dsh's `/?token=` sets the auth cookie; an NPM-style proxy
 * redirects to that URL by itself) and read its plugin status. Never throws: the panel shows why.
 */
export declare function probeBox<T = RuntimeStatus>(box: Box, fetchImpl?: FetchLike, path?: string, init?: {
    method?: string;
    body?: string;
}): Promise<Probe<T>>;
/** The login half of `claude auth status` output. */
export interface AuthStatus {
    loggedIn: boolean;
    authMethod: string | null;
    email?: string | null;
    projectsDirectory?: string | null;
}
/** The login half of `claude auth status` output, tolerant of an older CLI printing prose. */
export declare function authFromStatus(text: string): AuthStatus;
/** Which box and which login the usage belongs to; the CLI call is cached ten minutes. */
export interface AccountIdentity {
    host: string;
    email: string | null;
    loggedIn: boolean;
}
/** A panel login or logout changed who a box is: the next ask reads the CLI again. */
export declare function forgetIdentity(): void;
/** Answers who is logged in on a box, shelling out to `claude auth status` (over ssh for a remote
 *  box, where a local configDir is meaningless) and caching the answer per config dir for ten
 *  minutes. */
export declare function accountIdentity(command?: string, configDir?: string, sshHost?: string): Promise<AccountIdentity>;
/**
 * The environment for a `claude` call on this box. `CLAUDE_CONFIG_DIR` is exported only when the
 * instance's dir is not the CLI's own default: with the variable set, the CLI keeps its
 * `.claude.json` (local and user MCP servers, project trust) inside that dir instead of at
 * `~/.claude.json`, so an MCP server added from the panel with the default dir landed in a shadow
 * file no terminal and no plugin-started Claude ever read (found 2026-09-10). The spawn env
 * follows the same rule, so the routes and the process see one config.
 */
export declare function cliEnvFor(dir?: string): NodeJS.ProcessEnv;
/**
 * What the panel needs to answer "is this the right machine and account": which `claude` dsh
 * spawns, its version, the config dir it will read, and who is logged in. When `sshHost` is set the
 * instance drives Claude Code on that box, so every probe runs there over ssh and reports the remote
 * binary, version and login rather than this box's.
 */
declare function runtimeStatus(configDir: string, command?: string, sshHost?: string): Promise<RuntimeStatus>;
/**
 * Whether a probe command names a file by path on a Windows host. `where` reads the colon of a
 * drive letter as `path:pattern` and exits 2 with "Invalid pattern", so asking it about
 * `C:\...\claude.exe` reported a working CLI as not on PATH; a path is its own answer.
 */
export declare const isWindowsPathCommand: (command: string, platform?: NodeJS.Platform) => boolean;
/** Every transcript under the Claude projects dir, each with the cwd its records name. */
declare function listAllTranscripts(projectsDirs: string[], hidden: Set<string>): Promise<TranscriptListItem[]>;
export declare const SSH_TRANSCRIPT_LISTER = "(function(){\nconst fs=require(\"fs\"),os=require(\"os\"),p=require(\"path\");\nconst root=p.join(os.homedir(),\".claude\",\"projects\");\nlet dirs=[];try{dirs=fs.readdirSync(root)}catch(e){process.stdout.write(\"[]\");return}\nconst out=[];\nfor(const d of dirs){\n const dir=p.join(root,d);let names;\n try{names=fs.readdirSync(dir)}catch(e){continue}\n for(const n of names){\n  const m=/^([0-9a-f-]{36})\\.jsonl$/.exec(n);if(!m)continue;\n  const fp=p.join(dir,n);let st;\n  try{st=fs.statSync(fp)}catch(e){continue}\n  const readHead=function(cap){\n   const buf=Buffer.alloc(cap);let bytes=0,fd;\n   try{fd=fs.openSync(fp,\"r\");bytes=fs.readSync(fd,buf,0,cap,0);fs.closeSync(fd)}catch(e){return null}\n   return {text:buf.slice(0,bytes).toString(\"utf8\"),partial:bytes>=cap};\n  };\n  const scan=function(head){\n   let cwd,summary,title=\"\",command=\"\",turns=0,answered=false,typed=false;\n   const first=function(x){return (x.replace(/<system-reminder>[\\s\\S]*?<\\/system-reminder>/g,\"\").replace(/\\[File \"((?:[^\"\\\\]|\\\\.)*)\" \\(\\d+ bytes[^\\n]*/g,\"$1\").trim().split(\"\\n\")[0]||\"\").replace(/\\s+/g,\" \").slice(0,120)};\n   for(const line of head.split(\"\\n\")){\n    if(!line)continue;let r;\n    try{r=JSON.parse(line)}catch(e){continue}\n    if(cwd===undefined&&typeof r.cwd===\"string\")cwd=r.cwd;\n    if(r.type===\"summary\"&&typeof r.summary===\"string\")summary=r.summary;\n    if(r.type===\"assistant\"&&!r.isSidechain)answered=true;\n    if(r.type!==\"user\"||r.isSidechain||r.isMeta)continue;\n    const c=r.message&&r.message.content;let t=\"\";\n    if(typeof c===\"string\")t=c;\n    else if(Array.isArray(c)){const a=[];for(const b of c){if(b&&b.type===\"text\"&&typeof b.text===\"string\")a.push(b.text)}t=a.join(\"\\n\")}\n    if(!t)continue;\n    if(turns===0&&t.indexOf(\"Generate the session title\")===0)break;\n    turns++;\n    const noise=/^\\s*<(command-|local-command|system-reminder)/.test(t);\n    if(!noise)typed=true;\n    if(title)continue;\n    let cmd=\"\";const n=/<command-name>\\s*([^<\\s]+)\\s*<\\/command-name>/.exec(t);\n    if(n){const a=/<command-args>([\\s\\S]*?)<\\/command-args>/.exec(t);\n     cmd=first((n[1]+\" \"+first((a?a[1]:\"\").replace(/(?:^|\\n\\n)Current runtime context\\.[\\s\\S]*$/,\"\"))).trim())}\n    if(cmd.indexOf(\" \")>=0)title=cmd;\n    else if(cmd){if(!command)command=cmd}\n    else if(!noise&&t.indexOf(\"[Request interrupted by user\")!==0)title=first(t);\n   }\n   return {cwd:cwd,summary:summary,title:title||command,turns:turns,dead:!typed&&!summary&&!answered};\n  };\n  let h=readHead(262144);if(!h)continue;\n  let f=scan(h.text);\n  // Same second look as listTranscripts: one huge opening record can push the first real turn past\n  // the head bound and make a live session read as empty. Only the files that found nothing pay it.\n  if(f.turns===0&&h.partial){const d2=readHead(2097152);if(d2){h=d2;f=scan(h.text)}}\n  if(f.turns===0)continue;\n  if(f.dead&&!h.partial)continue;\n  const item={id:m[1],title:f.summary||f.title,createdAt:st.mtimeMs,modifiedAt:st.mtimeMs,bytes:st.size,turns:f.turns,turnsPartial:h.partial};\n  if(f.cwd)item.cwd=f.cwd;\n  out.push(item);\n }\n}\nout.sort(function(a,b){return b.modifiedAt-a.modifiedAt});\nprocess.stdout.write(JSON.stringify(out));\n})();";
/** Claude Code's settings file as the editor reads it. */
export interface SettingsFile {
    path: string;
    exists: boolean;
    text: string;
    mtime: number;
}
/** Read Claude Code's settings file on the session's own box; a missing file reads as an empty object. */
declare function readSettings(box: FsBox, path: string): Promise<SettingsFile>;
/**
 * The file a scope names for a session in `cwd` on `box`. `settingsScopePath` with the two
 * directories only the box can answer: its managed directory, and where its CLI keeps the local
 * file, which is the repository root rather than `cwd` for a subdirectory or a worktree.
 */
declare function scopePathAt(box: FsBox, scope: SettingsScope, userPath: string, cwd: string | null): Promise<string | undefined>;
/**
 * Every settings file that exists for a cwd, highest precedence first, which is the order the
 * per-key merges in `switches.ts` and `plugins.ts` expect.
 */
declare function settingsTexts(box: FsBox, userPath: string, cwd: string | null): Promise<Array<{
    scope: string;
    text: string;
}>>;
/** One `modelPicker.options` row, down to what a picker row shows. */
interface PickerOption {
    model: string;
    label?: string;
}
type EffortLevel = (typeof EFFORTS_ALL)[number];
/** The two settings.json keys that shape Claude Code's own `/model` picker. */
export interface PickerSettings {
    /** Allowlist entries: a family alias, a version prefix or a full id. Absent means no allowlist. */
    availableModels?: string[];
    /** Extra rows, in the order the CLI shows them after its built-in lineup. */
    options: PickerOption[];
    /** The CLI keeps only the Default row and those extra rows. */
    replaceBuiltInOptions: boolean;
    /** settings.json `maxEffortLevel`: the highest effort the pickers offer. Absent means no cap. */
    maxEffortLevel?: EffortLevel;
    /** Per-model `modelSettings.<id>.maxEffortLevel`, which overrides the top level for that model. */
    modelEffortCaps?: Record<string, EffortLevel>;
}
/**
 * Read what settings.json says about the picker. Anything the CLI would ignore is dropped here,
 * and a file that is missing, unreadable or silent on both keys reads as undefined, so a settings
 * file someone is halfway through editing can never empty the picker.
 */
export declare function readPickerSettings(path: string): Promise<PickerSettings | undefined>;
/** The mtime an editor sends back with its save; a body without one asks for no conflict check. */
declare const mtimeOf: (body: Record<string, unknown>) => number | undefined;
/**
 * Keep the previous copy as .bak, write to a temp file, rename over: never a half-written file.
 * `expect` is the mtime the editor read, when it sent one: a file that has moved since is someone
 * else's edit, and a whole-file write would put it back the way this tab last saw it. That edit
 * is the CLI rewriting settings.json while the tab sat open, or a second tab.
 */
declare function writeWithBackup(box: FsBox, path: string, text: string, expect?: number): Promise<{
    path: string;
    backup: string;
    mtime: number;
}>;
/**
 * A dsh subagent run lives inside its parent conversation; dsh refuses to open it standalone
 * ("subagent Sessions require their durable parent address"), so it has no working row in any
 * listing: not this cwd's, not every cwd's, not a box's.
 */
export declare const withoutSubagents: <T extends {
    id: string;
    dsh?: {
        subagent?: boolean;
    };
}>(rows: T[]) => T[];
/** A dsh session a transcript belongs to, and whether it is archived. */
export interface OwnedSession {
    id: string;
    archived: boolean;
    /** A dsh subagent run: it lives inside its parent conversation and cannot be opened standalone. */
    subagent?: boolean;
}
/**
 * Claude transcript id → the dsh session it belongs to, for the dsh sessions of one workspace.
 * A session this plugin started keeps its Claude transcript under `claudeIdOf(dsh id)`; one opened
 * from this panel shares the id. Archived sessions are included so the panel can bring them back
 * without any archive plugin.
 */
/** dsh 0.1.5's `sessionPersistence.list()` answers snapshots that wrap the header; before that the
 *  entries were the headers. Either way in, a header out. */
type StoredHeader = {
    id: string;
    cwd?: string;
    origin?: string;
};
/** Pull the bare session header out of a persistence entry, unwrapping dsh 0.1.5's wrapped shape so
 *  both the newest and the oldest entries answer the same header. */
declare const headerOf: (entry: StoredHeader | {
    header: StoredHeader;
}) => StoredHeader;
/** Builds a lookup that indexes each session under both its dsh id and its claude id, so a session
 *  is found by whichever id a caller has. */
export declare function dshSessionsFor(entries: readonly (StoredHeader | {
    header: StoredHeader;
})[], cwd: string | null, claudeIdOf: (id: string) => string, archived?: Set<string>): Map<string, OwnedSession>;
/** Narrows an unknown value to an absolute path string with no NUL; a relative or control-char path
 *  is refused rather than used as a directory. On a Windows host a drive path (`C:\…`, `C:/…`)
 *  counts too, since that is what dsh hands over there; a drive-relative `C:x`, a UNC share and a
 *  `\\?\` device path stay refused, so a request cannot point a read at another machine. */
export declare const validCwd: (cwd: unknown, platform?: string) => cwd is string;
/** What /open answers: the dsh session id to open, and whether it existed before. */
export interface Opened {
    id: string;
    existed: boolean;
    /** The stored log was refused and healed before this open handed it over. */
    healed?: boolean;
    /** Completed transcript turns the stored log did not hold yet, appended by this open. */
    turnsAdded?: number;
    turns?: number;
    events?: number;
    /** The permission mode the transcript's last prompt ran under; only on a freshly seeded open. */
    permissionMode?: string;
}
/** The host services the routes read; injected before the route mounts. */
export type RouteHost = Required<Pick<PluginContext, "webServer" | "connection" | "sessions" | "sessionPersistence">>;
/**
 * What a route group needs from this file's scope: the module helpers its blocks call, the closure
 * helpers of `registerSessionRoutes`, and the options it was handed. Built once per registration
 * beside `webServer.register`, so a group is a pure function of it. A group may import types from
 * here but never values (that would close the import cycle), so everything a block reaches for at
 * runtime comes through this object. `remoteWorkspaces`, `rwChain` and `injectedRegistry` stay out:
 * no block reads them directly, they only back the functions passed here, and a future direct read
 * should fail to compile rather than silently capture a snapshot.
 */
export interface RouteCtx {
    CHANGELOG_RELEASES: typeof CHANGELOG_RELEASES;
    DEFAULT_PROVIDER: typeof DEFAULT_PROVIDER;
    DSH_FLOOR: typeof DSH_FLOOR;
    IMPORT_LIMIT: typeof IMPORT_LIMIT;
    ISSUES_URL: typeof ISSUES_URL;
    PANEL_TOKEN: typeof PANEL_TOKEN;
    PLUGIN_VERSION: typeof PLUGIN_VERSION;
    ROUTE_PREFIX: typeof ROUTE_PREFIX;
    SEARCH_LIMIT: typeof SEARCH_LIMIT;
    SEARCH_MAX_FILES: typeof SEARCH_MAX_FILES;
    SELECTION_QUOTE_MAX: typeof SELECTION_QUOTE_MAX;
    SETTINGS_SCOPES: typeof SETTINGS_SCOPES;
    applyReload: (session: JsonValue | undefined) => Promise<boolean>;
    applyReloadSkills: (session: JsonValue | undefined) => Promise<boolean>;
    askAside: SessionRouteOptions["askAside"];
    awaiting: SessionRouteOptions["awaiting"];
    baseName: typeof baseName;
    boxOf: (url: URL) => MountBox;
    boxTranscripts: (ws: RemoteWorkspace, hidden: Set<string>) => Promise<TranscriptListItem[]>;
    cacheBoxTranscript: (ws: RemoteWorkspace, id: string) => Promise<void>;
    claudeHomeOf: typeof claudeHomeOf;
    claudeIdOf: SessionRouteOptions["claudeIdOf"];
    cliEnvFor: typeof cliEnvFor;
    command: SessionRouteOptions["command"];
    compactNow: SessionRouteOptions["compactNow"];
    configDir: SessionRouteOptions["configDir"];
    contextUsage: SessionRouteOptions["contextUsage"];
    continueAfterLimit: SessionRouteOptions["continueAfterLimit"];
    ctx: PluginContext;
    dshSessionsFor: typeof dshSessionsFor;
    dshVersion: SessionRouteOptions["dshVersion"];
    events: SessionRouteOptions["events"];
    filesMentioning: typeof filesMentioning;
    firstTranscript: typeof firstTranscript;
    headerOf: typeof headerOf;
    heal: HealHost;
    holdSteers: SessionRouteOptions["holdSteers"];
    idIn: typeof idIn;
    idle: SessionRouteOptions["idle"];
    idTaken: typeof idTaken;
    importedDir: SessionRouteOptions["importedDir"];
    isSettingsScope: typeof isSettingsScope;
    json: typeof json;
    knownCwd: typeof knownCwd;
    listAllTranscripts: typeof listAllTranscripts;
    liveCount: SessionRouteOptions["liveCount"];
    liveTasks: SessionRouteOptions["liveTasks"];
    liveTurn: SessionRouteOptions["liveTurn"];
    log: SessionRouteOptions["log"];
    loginNeeded: SessionRouteOptions["loginNeeded"];
    mcp: SessionRouteOptions["mcp"];
    memoryDirAt: (box: MountBox, cwd: string) => Promise<string>;
    models: SessionRouteOptions["models"];
    mtimeOf: typeof mtimeOf;
    notOnBox: (url: URL, what: string, cwd?: string | null) => string | undefined;
    onLoginStatus: SessionRouteOptions["onLoginStatus"];
    openTranscript: typeof openTranscript;
    openTranscriptOnce: typeof openTranscriptOnce;
    parseSettingsText: typeof parseSettingsText;
    permissionAsks: SessionRouteOptions["permissionAsks"];
    permissionModes: SessionRouteOptions["permissionModes"];
    permissionReadout: SessionRouteOptions["permissionReadout"];
    persistAsides: SessionRouteOptions["persistAsides"];
    pickFor: (cwd: string) => PickSettings;
    pluginErrors: SessionRouteOptions["pluginErrors"];
    pluginScopeCwd: (scope: unknown, session: JsonValue | undefined) => Promise<{
        cwd: string | undefined;
    } | {
        error: string;
    }>;
    pluginStars: typeof pluginStars;
    pluginUpdate: typeof pluginUpdate;
    pluginWarnings: SessionRouteOptions["pluginWarnings"];
    projectDir: SessionRouteOptions["projectDir"];
    projectDirAt: typeof projectDirAt;
    projectsDir: SessionRouteOptions["projectsDir"];
    readBody: typeof readBody;
    readHints: typeof readHints;
    readPluginFile: typeof readPluginFile;
    readSettings: typeof readSettings;
    readSshBoxes: typeof readSshBoxes;
    recapIsRepeat: typeof recapIsRepeat;
    releaseHold: SessionRouteOptions["releaseHold"];
    rewind: SessionRouteOptions["rewind"];
    routeHost: RouteHost;
    run: typeof run;
    runtimeStatus: typeof runtimeStatus;
    scopePathAt: typeof scopePathAt;
    sendSteerNow: SessionRouteOptions["sendSteerNow"];
    sessionCwd: typeof sessionCwd;
    sessionFallbacks: SessionRouteOptions["sessionFallbacks"];
    sessionPersistence: RouteHost["sessionPersistence"];
    sessionTranscript: typeof sessionTranscript;
    setStarter: SessionRouteOptions["setStarter"];
    settingsPath: SessionRouteOptions["settingsPath"];
    settingsTexts: typeof settingsTexts;
    sideQuestions: SessionRouteOptions["sideQuestions"];
    skillDoctor: SessionRouteOptions["skillDoctor"];
    sshBoxesPath: SessionRouteOptions["sshBoxesPath"];
    startedIds: SessionRouteOptions["startedIds"];
    starters: SessionRouteOptions["starters"];
    steersFor: SessionRouteOptions["steersFor"];
    stopTask: SessionRouteOptions["stopTask"];
    targetOf: <T extends string | null>(url: URL, cwd: T) => CwdTarget<T>;
    taskOutput: SessionRouteOptions["taskOutput"];
    terminalSync: SessionRouteOptions["terminalSync"];
    thinking: SessionRouteOptions["thinking"];
    toolMode: SessionRouteOptions["toolMode"];
    transcriptDirs: (cwd: string) => string[];
    turnRecords: SessionRouteOptions["turnRecords"];
    updateBoxOf: (url: URL, sessionId: string | null) => {
        host: string;
        label: string;
    };
    updateHints: typeof updateHints;
    updaterFor: (host: string, label: string) => ClaudeUpdater;
    updaters: Map<string, ClaudeUpdater>;
    updatesOff: () => Promise<boolean>;
    userSettingsPathOf: (box: MountBox) => Promise<string | undefined>;
    validCwd: typeof validCwd;
    validDshId: typeof validDshId;
    validId: typeof validId;
    validMemoryName: typeof validMemoryName;
    withoutSubagents: typeof withoutSubagents;
    workspaceAt: (cwd: string | null) => RemoteWorkspace | undefined;
    workspaceDiff: SessionRouteOptions["workspaceDiff"];
    workspaceRegistry: () => WorkspaceRegistry | undefined;
    writeWithBackup: typeof writeWithBackup;
}
/** The id the transcript's own records carry, which is what the CLI knew the session by. */
declare const idIn: (text: string) => string | undefined;
/**
 * Whether that id is already in use here: by a live dsh session, a transcript under any project
 * dir, or an earlier import. An import that reused one would shadow the real conversation, so it
 * takes a fresh id instead; the original still sits inside the file's own records.
 */
declare function idTaken(live: (id: string) => boolean, projectsDirs: string[], importedDir: string, id: string): Promise<boolean>;
/** The transcript for `id` from the first of `dirs` that holds it, folded ready to seed a session. */
declare function firstTranscript(dirs: string[], id: string): Promise<FoldedTranscript | undefined>;
/** Whether a transcript prompt is one the stored log already holds: the stored text, alone or
 *  followed by a line break. The adapter sends a typed prompt to the CLI with more after it that
 *  dsh does not store: its context blocks after a blank line (the runtime snapshot, instructions,
 *  the skill catalog; measured 2026-09-23: 542 characters against 150 for the same prompt), and an
 *  attached file's handle on the very next line. Spacing is not compared: dsh stores what was typed,
 *  trailing space and all, and the CLI trims a slash command's args. Measured 2026-10-07 over 551
 *  stored logs with the exact comparison this replaces: 84 of 139 slash-command prompts and every
 *  prompt with an attachment read as missing, and would have been appended a second time. A short
 *  stored text can shadow a later prompt that begins with it and a line break; that reads as stored,
 *  the safe side. Narrowing it to a blank line or a file handle was tried and put back the same day:
 *  an attached image (`[image]`) and a subagent's finish notice also follow on the next line, and
 *  twelve stored prompts in those 551 logs read as missing again.
 *  @param texts stored user texts, each already through `spaced` */
export declare const storedHolds: (texts: ReadonlySet<string>, prompt: string) => boolean;
/** The model a restored transcript should open on, and the mount that serves it; undefined
 *  fields leave dsh's own fallback in place. */
export type PickSettings = (folded: FoldedTranscript) => Promise<{
    provider: string | undefined;
    model: string | undefined;
}>;
/** Same id opened twice at once (double click, two tabs) shares one creation. */
declare function openTranscript(ctx: RouteHost, dirs: string[], cwd: string, id: string, claudeIdOf: (id: string) => string, registry: WorkspaceRegistry | undefined, heal?: HealHost, pickSettings?: PickSettings): Promise<Opened>;
/**
 * Loads a Claude Code transcript and creates a dsh session from it, or
 * returns the existing session if one with this id is already live.
 */
export declare function openTranscriptOnce(ctx: RouteHost, dirs: string[], cwd: string, id: string, claudeIdOf: (id: string) => string, registry: WorkspaceRegistry | undefined, heal?: HealHost, reseedFrom?: string, pickSettings?: PickSettings): Promise<Opened>;
/** A cwd-scoped read's destination: the box it runs on, and the path to read there. */
export interface CwdTarget<T extends string | null> {
    box: MountBox;
    cwd: T;
}
/** One mount's own box: which `claude` to run, where its config lives, and whether it is remote. */
export interface MountBox {
    configDir: string;
    command?: string;
    sshHost?: string;
}
/**
 * That box's `~/.claude`, where its user-scope CLAUDE.md and settings both live. A mount's
 * `configDir` is resolved against this PC's home, so a remote box's path has to come from its own
 * `$HOME`, which `homeAt` asks once per host.
 */
declare const claudeHomeOf: (box: MountBox) => Promise<string>;
/**
 * Where that box keeps a directory's transcripts. The same directory the adapter's own
 * `projectDir` names for this PC, resolved against the box's `~/.claude` instead. The cwd is
 * already the remote path, since it is the directory the session runs in. Auto-memory sits under
 * the same kind of directory but is keyed by repository, not by cwd; see `memoryDirAt`.
 */
declare const projectDirAt: (box: MountBox, cwd: string) => Promise<string>;
/** What the event stream needs from the adapter; see `SessionRouteOptions.events`. */
export interface EventsDeps {
    hub: EventHub;
    snapshot: (session: string | null) => OmcEvent[];
    replies: {
        liveTurn: (sessionId: string) => LiveTurnReply | Record<string, never>;
        turns: (sessionId: string) => TurnsReply;
        asides: (sessionId: string) => AsidesReply;
        idle: (sessionId: string) => IdleReply;
        permissionMode: (sessionId: string) => PermissionModeState;
    };
}
/** Everything the routes need from the adapter. */
export interface SessionRouteOptions {
    log: (level: string, msg: string) => void;
    /** Hands the adapter the heal host the routes build, so a wake that finds a session refused
     *  can heal it too. */
    onHeal?: (heal: HealHost) => void;
    /**
     * Claude Code project dirs for a workspace path, in read order. Normally one; with the transcript
     * switch on it is the plugin's own store first and the real `~/.claude` second, so a session
     * started from a terminal is still listed and still opens.
     */
    projectDir: (cwd: string) => string[];
    /** The parents of every project dir, same order. */
    projectsDir: string[];
    /** Claude session ids the adapter started itself. */
    startedIds: () => Promise<Iterable<string>>;
    claudeIdOf: (id: string) => string;
    settingsPath?: string;
    configDir: string;
    boxesPath?: string;
    /** Where an imported transcript is kept: the plugin's own state dir, never Claude's `projects/`. */
    importedDir?: string;
    /** State file holding the SSH boxes the panel manages; the adapter mounts one instance per box. */
    sshBoxesPath?: string;
    /** Mount or withdraw provider instances so they match the saved SSH-box list, without a restart. */
    onSshBoxes?: (boxes: SshBox[]) => Promise<void> | void;
    /** State file mapping placeholder workspaces to their box + real remote path. */
    remoteWorkspacesPath?: string;
    /** Refresh the adapter's live placeholder→remote-cwd map after the list changes, without a restart. */
    onRemoteWorkspaces?: (workspaces: RemoteWorkspace[]) => Promise<void> | void;
    command?: string;
    /** The `command` as configured, before this box's PATH resolution. Work on another box is named
     *  this: an absolute path found here means nothing there, and probing a box with it left every
     *  box reading "no claude" and its Claude Code version unknown (owner, 2026-09-22). Defaults to
     *  `command`. */
    boxCommand?: string;
    /** Non-empty when this instance drives Claude Code on a remote host over ssh; the status and
     * identity probes run there so the panel reports the remote box, not this one. */
    sshHost?: string;
    /**
     * The box behind a provider id, for a request that names the session's own mount. Routes register
     * once, under whichever instance mounted first, so without this every session read the registering
     * instance's box: pick a box's model in the picker and the panel still reported this PC. The
     * client resolves the session's provider from dsh's model directory and sends it along; an id the
     * registry does not know (an instance withdrawn since the tab loaded) falls back to the
     * registering instance, which is what the request would have used anyway.
     */
    instanceFor?: (provider: string | null) => MountBox | undefined;
    /**
     * The box behind a hostname, for a read that is about a remote workspace rather than about a
     * provider the client named. A remote workspace's files live on its box whichever model the
     * session runs, the same way the turn itself does (adapter's `boxFor`), so the mount is looked up
     * by host here instead of by provider id. Falls back to a plain ssh box when no mount matches.
     */
    instanceForHost?: (host: string) => MountBox | undefined;
    /** What a login probe found for a mount (`null` = the default one), so the adapter can name a
     *  logged-out box in the picker. */
    onLoginStatus?: (provider: string | null, loggedIn: boolean) => void;
    /** Per-session turn accounting buffer from the adapter. */
    turnRecords?: Map<string, import("./adapter.js").TurnRecord[]>;
    /** dsh version read off the package this plugin loads beside; null when unavailable. */
    dshVersion?: string | null;
    /** The running turn's figures per session, for the status row; absent when no turn is running. */
    liveTurn?: Map<string, LiveTurn>;
    /** The event stream to open tabs (src/events.ts): the hub the `/events` route attaches to, the
     *  snapshot a tab gets on connect, and the reply builders the polled routes answer with so a
     *  route body and an event body are one function's output. Absent in tests that wire only the
     *  maps, in which case each route keeps its own body. */
    events?: EventsDeps;
    /** Idle watchdog state from the adapter. */
    idle?: {
        deadlineFor(session: string): number | null;
        extend(session: string): boolean;
        timeoutMs: number;
    };
    /** Tool activity as the Tune switch reads and sets it, with whether this dsh takes rows at all. */
    toolMode?: {
        info(): Promise<ToolModeInfo>;
        set(mode: ToolMode): Promise<ToolModeInfo>;
    };
    /** Terminal sync: whether terminal `/resume` exchanges mirror into the dsh session. */
    terminalSync?: {
        info(): {
            enabled: boolean;
        };
        set(enabled: boolean): Promise<{
            enabled: boolean;
        }>;
    };
    /** Per-session permission mode: read the effective mode, set or clear the override. */
    permissionModes?: {
        info: (sessionId: string) => PermissionModeInfo;
        set: (sessionId: string, mode: string | null) => Promise<PermissionModeReply>;
        /** Store the mode a restored transcript ran under, unchecked; dsh's shield clamps it at spawn. */
        restore: (sessionId: string, mode: string) => Promise<void>;
    };
    /** Rewind a session's files (and, unless a dry run, Claude's conversation) to a user prompt. */
    rewind?: (sessionId: string, uuid: string, dryRun: boolean) => Promise<RewindReply>;
    /** The CLI's own context breakdown for a session with a live process. */
    contextUsage?: (sessionId: string) => Promise<ContextUsageReply>;
    /** The CLI's own skill report (`/skill-doctor`) for a session, run as a throwaway one-shot. */
    skillDoctor?: (sessionId: string) => Promise<SkillDoctorReply>;
    /** The CLI's working-tree diff for a session with a live process. */
    workspaceDiff?: (sessionId: string) => Promise<WorkspaceDiffReply>;
    /** Permission rules and hooks for a session with a live process. */
    permissionReadout?: (sessionId: string) => Promise<PermissionReadoutReply>;
    /** MCP servers of a session's live process, and a reconnect for one of them. */
    mcp?: {
        status: (sessionId: string) => Promise<McpStatusReply>;
        reconnect: (sessionId: string, name: string) => Promise<{
            ok: boolean;
            error?: string;
        }>;
        /** Pin one MCP server's tools back to asking, or clear the pin. */
        ask: (sessionId: string, name: string, ask: boolean) => Promise<{
            ok: boolean;
            error?: string;
        }>;
        /** Start an OAuth login for one server; the reply carries the sign-in page to open. */
        authenticate: (sessionId: string, name: string) => Promise<{
            ok: boolean;
            authUrl?: string;
            error?: string;
        }>;
    };
    /** The rules recent approval requests suggest, per session; the Tune tab offers them as chips. */
    permissionAsks?: Map<string, string[]>;
    /** Ask a side question over HTTP, optionally seeded with the working-tree diff. The answer lands
     *  in the ring `sideQuestions` serves, so the caller gets only whether the question went out. */
    askAside?: (sessionId: string, question: string, seed: {
        withDiff: boolean;
        path: string;
        quote: string;
    }) => Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** `/btw` side questions and their answers, per session; the client bubble reads them. */
    sideQuestions?: Map<string, AsideEntry[]>;
    /** Claude's own live tasks for a session, for the Tasks tab. */
    liveTasks?: (sessionId: string) => LiveTask[];
    /** Ask the CLI to stop one of its tasks. */
    stopTask?: (sessionId: string, taskId: string) => Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** Send `/compact` to the session as its next prompt, for the context nudge's button. */
    compactNow?: (sessionId: string) => Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** The tail of one task's output, or the CLI's error. */
    taskOutput?: (sessionId: string, taskId: string) => Promise<{
        ok: boolean;
        output?: string;
        error?: string;
    }>;
    /** The steer card's poll: typed steers Claude has not read yet (in the CLI's queue, or in dsh's
     *  inbox while a dsh tool runs), and holds open for an edit. Calling it re-arms the holds' idle
     *  timers. */
    steersFor?: (sessionId: string) => {
        inTool?: true;
        waiting: Array<{
            id: string;
            text: string;
            at: number;
            relayed?: true;
            attachments?: SteerAttachment[];
        }>;
        held: Array<{
            id: string;
            text: string;
            attachments?: SteerAttachment[];
        }>;
    };
    /** Take waiting steers back from Claude for an edit; the answer names the hold and its text. */
    holdSteers?: (sessionId: string, ids: string[]) => Promise<{
        ok: true;
        holdId: string;
        text: string;
    } | {
        ok: false;
        reason: "sent" | "gone" | "error" | "relayed";
        error?: string;
    }>;
    /** Cut the running turn short and send these waiting steers as the next turn. */
    sendSteerNow?: (sessionId: string, ids: string[]) => Promise<import("./adapter.js").SteerEditReply>;
    /** End a hold: put it back as it was, drop it, or send one message with new text in its place. */
    releaseHold?: (sessionId: string, holdId: string, how: "restore" | "drop" | {
        text: string;
    }) => Promise<{
        ok: true;
    } | {
        ok: false;
        reason: "sent" | "gone" | "error" | "relayed";
        error?: string;
    }>;
    /** Sessions whose last turn failed for want of a login, read beside the asides for the card. */
    loginNeeded?: Map<string, LoginNeed>;
    /** dsh session id → the model switch its last turn reported, for the `fallback` field beside the
     *  card; the notices tick reads it at the stop transition. */
    sessionFallbacks?: Map<string, FallbackRecord>;
    /** The box a session runs on, for the update card and the Tune rows: this box when `host` is empty. */
    boxOfSession?: (sessionId: string) => {
        host: string;
        label: string;
    };
    /** A box's `claude` moved on: forget its flag probe so the next spawn reads the new binary. */
    claudeUpdated?: (host: string) => void;
    /** A panel login on a box (this box when empty) succeeded: clear its cards, relist its models. */
    loginDone?: (host: string) => void;
    /** Log out on a box: kill its live Claude processes so nothing keeps answering on a gone login. */
    logoutDone?: (host: string) => void;
    /** Live Claude processes on a box, for the row to name when the box reads logged out. */
    liveCount?: (host: string) => number;
    /** Persist a session's aside ring after the route mutates it (e.g. a dismiss), so the change survives a restart. */
    persistAsides?: (sessionId: string) => void;
    /** Saved opening prompts, keyed by session id plus `default`, and the writer the starter card uses. */
    starters?: Map<string, string>;
    setStarter?: (key: string, text: string | undefined) => void;
    /** The live thinking budget the Tune selector reads and sets per session. */
    thinking?: {
        info: (sessionId: string) => {
            tokens: number | null | undefined;
        };
        set: (sessionId: string, tokens: number | null) => Promise<{
            ok: boolean;
            tokens: number | null;
            live: boolean;
            error?: string;
        }>;
    };
    /** The model catalog for advisor model selection. */
    models?: () => Promise<Array<{
        id: string;
        name: string;
    }>>;
    /** The provider id this machine's Claude mounts under; a restored session is put on it. */
    providerId?: string;
    /** Re-read plugins into a session's live process after a plugin/marketplace mutation, so the
     *  change applies now instead of at the next spawn. `live` is false when there is no process. */
    reloadPlugins?: (sessionId: string) => Promise<{
        ok: boolean;
        live: boolean;
        error?: string;
    }>;
    /** Re-read skills into a session's live process after a create, edit or remove, so the change
     *  applies now instead of at the next spawn. `live` is false when there is no process. */
    reloadSkills?: (sessionId: string) => Promise<{
        ok: boolean;
        live: boolean;
        error?: string;
    }>;
    /** The plugins a session's live process failed to load, from its init frame. Empty when clean or
     *  when no process has run. */
    pluginErrors?: (sessionId: string) => PluginLoadError[];
    /** The plugins a session's live process loaded with a warning, from its init frame. Empty when
     *  clean or when no process has run. */
    pluginWarnings?: (sessionId: string) => PluginLoadError[];
    /** Every session holding an open prompt, for the browser's background notices. */
    awaiting?: () => Record<string, {
        kind: "approval" | "question" | "plan";
        id: string;
        since: number;
    }>;
    /** Whether this plugin waits out a usage limit and continues the turn itself. */
    continueAfterLimit?: boolean;
}
/** The transcript of a dsh session, read from the box it runs on: under its Claude id (sessions the
 *  adapter started) or its own id (sessions restored from a transcript), whichever exists. */
declare function sessionTranscript(box: MountBox, dir: string, sessionId: string, claudeIdOf: (id: string) => string): Promise<FoldedTranscript | undefined>;
/** True when this session already had one within the gap. Records the ask when it does not. */
declare function recapIsRepeat(sessionId: string, now: number): boolean;
/** `projectDir(cwd)` → Claude Code project dir; `startedIds()` → ids the adapter started itself. */
export declare function registerSessionRoutes(ctx: PluginContext, { log, onHeal, projectDir, projectsDir, startedIds, claudeIdOf, settingsPath, configDir, boxesPath, importedDir, sshBoxesPath, onSshBoxes, remoteWorkspacesPath, onRemoteWorkspaces, command, boxCommand, sshHost, turnRecords, dshVersion, liveTurn, events, idle, toolMode, terminalSync, permissionModes, thinking, rewind, contextUsage, skillDoctor, workspaceDiff, permissionReadout, askAside, mcp, permissionAsks, sideQuestions, liveTasks, stopTask, taskOutput, compactNow, steersFor, holdSteers, releaseHold, sendSteerNow, loginNeeded, sessionFallbacks, boxOfSession, claudeUpdated, loginDone, logoutDone, liveCount, persistAsides, starters, setStarter, models, providerId, reloadPlugins, reloadSkills, pluginErrors, pluginWarnings, awaiting, continueAfterLimit, instanceFor, instanceForHost, onLoginStatus, }: SessionRouteOptions): void;
/** One settings file as the Diagnostics tab reports it: where it is, and why the CLI refuses it. */
export interface DiagnosticFile {
    scope: SettingsScope;
    path: string;
    exists: boolean;
    parseError?: string;
}
/**
 * The four files Claude Code merges for one session, highest precedence first. Duplicated in
 * `src/client/settings.ts`: the browser half cannot import server code, and the order is the
 * CLI's, not this plugin's, so both copies have to say the same thing.
 */
export declare const SETTINGS_SCOPES: readonly ["managed", "local", "project", "user"];
/** One of the four settings files. The CLI's own layer names, minus the `--settings` flag layer. */
export type SettingsScope = (typeof SETTINGS_SCOPES)[number];
/** One scope's file in the `GET /settings/scopes` payload. */
export interface SettingsScopeInfo extends SettingsFile {
    scope: SettingsScope;
    readOnly: boolean;
}
/** True only when the value is one of the four settings scopes the CLI merges; anything else is an
 *  unknown scope and is refused rather than written. */
export declare function isSettingsScope(value: JsonValue | undefined): value is SettingsScope;
/**
 * The file a scope names. Paths are derived here and never taken from the client: the request
 * carries a scope and a directory, not a path. Project and local have no file without a
 * directory, and answer undefined so the caller can refuse the request. `managed` is the
 * directory the CLI's policy layer lives in on the box the file is read from (`managedDir(box)`);
 * the plugin never writes it. `localDir` is where the local file sits when that is not `cwd`
 * (`localSettingsRoot`); the project file is always `cwd`'s own.
 */
export declare function settingsScopePath(scope: SettingsScope, userPath: string, cwd: string | null, managed?: string, localDir?: string | null): string | undefined;
/**
 * A directory only counts when a dsh session is open in it. Without this a browser could name
 * any directory on the box and have `.claude/settings.json` written into it.
 */
declare function knownCwd(cwd: JsonValue | undefined | null, sessions: SessionPersistence): Promise<string | null>;
/**
 * The directory a session is open in, from dsh's own record of it. The browser names the session,
 * never the directory, so nothing it posts can point the CLI at a project it has no session in.
 */
declare function sessionCwd(session: JsonValue | undefined, sessions: SessionPersistence): Promise<string | null>;
export {};
