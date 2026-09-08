import type { IncomingMessage } from "node:http";
import type { JsonValue, PluginContext } from "./dsh.js";
import type { PermissionModeInfo, PermissionModeReply, RewindReply, ContextUsageReply, WorkspaceDiffReply, McpStatusReply, AsideEntry } from "./adapter.js";
/** Any JSON object, as a request body or a stored file decodes to. */
type JsonObject = Record<string, JsonValue>;
/** Parse a JSON request body, capped at `limit` bytes. A non-object body reads as an empty object. */
export declare const readBody: (req: IncomingMessage, limit?: number) => Promise<JsonObject>;
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
export declare function validateSshBoxes(input: unknown): ValidatedSshBoxes;
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
export declare function validateRemoteWorkspaceInput(input: unknown): ValidatedRemoteWorkspace;
export declare function readRemoteWorkspaces(path: string): Promise<RemoteWorkspace[]>;
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
}
export declare function accountIdentity(command?: string, configDir?: string, sshHost?: string): Promise<AccountIdentity>;
/** Claude Code's settings file as the editor reads it. */
export interface SettingsFile {
    path: string;
    exists: boolean;
    text: string;
    mtime: number;
}
/** One `modelPicker.options` row, down to what a picker row shows. */
interface PickerOption {
    model: string;
    label?: string;
}
/** The two settings.json keys that shape Claude Code's own `/model` picker. */
export interface PickerSettings {
    /** Allowlist entries: a family alias, a version prefix or a full id. Absent means no allowlist. */
    availableModels?: string[];
    /** Extra rows, in the order the CLI shows them after its built-in lineup. */
    options: PickerOption[];
    /** The CLI keeps only the Default row and those extra rows. */
    replaceBuiltInOptions: boolean;
}
/**
 * Read what settings.json says about the picker. Anything the CLI would ignore is dropped here,
 * and a file that is missing, unreadable or silent on both keys reads as undefined, so a settings
 * file someone is halfway through editing can never empty the picker.
 */
export declare function readPickerSettings(path: string): Promise<PickerSettings | undefined>;
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
export declare function dshSessionsFor(headers: readonly {
    id: string;
    cwd?: string;
    origin?: string;
}[], cwd: string | null, claudeIdOf: (id: string) => string, archived?: Set<string>): Map<string, OwnedSession>;
/** One mount's own box: which `claude` to run, where its config lives, and whether it is remote. */
export interface MountBox {
    configDir: string;
    command?: string;
    sshHost?: string;
}
/** Everything the routes need from the adapter. */
export interface SessionRouteOptions {
    log: (level: string, msg: string) => void;
    /** Claude Code project dir for a workspace path. */
    projectDir: (cwd: string) => string;
    /** The parent of every project dir. */
    projectsDir: string;
    /** Claude session ids the adapter started itself. */
    startedIds: () => Promise<Iterable<string>>;
    claudeIdOf: (id: string) => string;
    settingsPath?: string;
    configDir: string;
    boxesPath?: string;
    /** State file holding the SSH boxes the panel manages; the adapter mounts one instance per box. */
    sshBoxesPath?: string;
    /** Mount or withdraw provider instances so they match the saved SSH-box list, without a restart. */
    onSshBoxes?: (boxes: SshBox[]) => Promise<void> | void;
    /** State file mapping placeholder workspaces to their box + real remote path. */
    remoteWorkspacesPath?: string;
    /** Refresh the adapter's live placeholder→remote-cwd map after the list changes, without a restart. */
    onRemoteWorkspaces?: (workspaces: RemoteWorkspace[]) => Promise<void> | void;
    command?: string;
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
    /** Per-session turn accounting buffer from the adapter. */
    turnRecords?: Map<string, import("./adapter.js").TurnRecord[]>;
    /** Idle watchdog state from the adapter. */
    idle?: {
        deadlineFor(session: string): number | null;
        extend(session: string): boolean;
        timeoutMs: number;
    };
    /** Per-session permission mode: read the effective mode, set or clear the override. */
    permissionModes?: {
        info: (sessionId: string) => PermissionModeInfo;
        set: (sessionId: string, mode: string | null) => Promise<PermissionModeReply>;
    };
    /** Rewind a session's files (and, unless a dry run, Claude's conversation) to a user prompt. */
    rewind?: (sessionId: string, uuid: string, dryRun: boolean) => Promise<RewindReply>;
    /** The CLI's own context breakdown for a session with a live process. */
    contextUsage?: (sessionId: string) => Promise<ContextUsageReply>;
    /** The CLI's working-tree diff for a session with a live process. */
    workspaceDiff?: (sessionId: string) => Promise<WorkspaceDiffReply>;
    /** MCP servers of a session's live process, and a reconnect for one of them. */
    mcp?: {
        status: (sessionId: string) => Promise<McpStatusReply>;
        reconnect: (sessionId: string, name: string) => Promise<{
            ok: boolean;
            error?: string;
        }>;
    };
    /** The rules recent approval requests suggest, per session; the Tune tab offers them as chips. */
    permissionAsks?: Map<string, string[]>;
    /** `/btw` side questions and their answers, per session; the client bubble reads them. */
    sideQuestions?: Map<string, AsideEntry[]>;
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
    /** Re-read plugins into a session's live process after a plugin/marketplace mutation, so the
     *  change applies now instead of at the next spawn. `live` is false when there is no process. */
    reloadPlugins?: (sessionId: string) => Promise<{
        ok: boolean;
        live: boolean;
        error?: string;
    }>;
    /** Whether this plugin waits out a usage limit and continues the turn itself. */
    continueAfterLimit?: boolean;
}
/** `projectDir(cwd)` → Claude Code project dir; `startedIds()` → ids the adapter started itself. */
export declare function registerSessionRoutes(ctx: PluginContext, { log, projectDir, projectsDir, startedIds, claudeIdOf, settingsPath, configDir, boxesPath, sshBoxesPath, onSshBoxes, remoteWorkspacesPath, onRemoteWorkspaces, command, sshHost, turnRecords, idle, permissionModes, thinking, rewind, contextUsage, workspaceDiff, mcp, permissionAsks, sideQuestions, persistAsides, starters, setStarter, models, reloadPlugins, continueAfterLimit, instanceFor, }: SessionRouteOptions): void;
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
export declare function isSettingsScope(value: JsonValue | undefined): value is SettingsScope;
/**
 * The file a scope names. Paths are derived here and never taken from the client: the request
 * carries a scope and a directory, not a path. Project and local have no file without a
 * directory, and answer undefined so the caller can refuse the request.
 */
export declare function settingsScopePath(scope: SettingsScope, userPath: string, cwd: string | null): string | undefined;
export {};
