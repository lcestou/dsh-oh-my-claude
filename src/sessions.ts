// Host half of "open a Claude Code session in dsh": lists the transcripts of a workspace and turns
// one into a cold dsh session whose id is the Claude session id, so the adapter resumes it as-is.
// Served under /dsh-oh-my-claude/*, guarded by dsh's own request policy (trusted host + login cookie).
// This is an I/O boundary: HTTP bodies, probe output and JSON files are decoded here.
import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { hostname } from "node:os";
import { readdir, readFile, writeFile, rename, copyFile, stat, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listTranscripts, readTranscript, toSessionEvents } from "./transcript.js";
import type { TranscriptListItem } from "./transcript.js";
import { deleteMemory, isMemoryName, listMemory } from "./memory.js";
import { listInstructions } from "./instructions.js";
import {
  durableTasksPath,
  goalFrom,
  readDurableTasks,
  sessionTasksFrom,
  type ScheduledTasksReply,
  type ScheduledTasksError,
} from "./scheduled-tasks.js";
import { asSessionId } from "./dsh.js";
import { buildAddServer, isMcpName, scopeNeedsCwd } from "./mcp-add-remove.js";
import type { JsonValue, PluginContext, SessionPersistence, WorkspaceRegistry } from "./dsh.js";
import { errorText } from "./process.js";
import { PERMISSION_MODES, isPermissionMode } from "./state.js";
import type {
  PermissionModeInfo,
  PermissionModeReply,
  RewindPrompt,
  RewindReply,
  ContextUsageReply,
  WorkspaceDiffReply,
  McpStatusReply,
} from "./adapter.js";

const ROUTE_PREFIX = "/dsh-oh-my-claude";
const BODY_LIMIT = 64 * 1024;

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
};

/** Any JSON object, as a request body or a stored file decodes to. */
type JsonObject = Record<string, JsonValue>;

const isJsonObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse a JSON request body, capped at `limit` bytes. A non-object body reads as an empty object. */
export const readBody = (req: IncomingMessage, limit = BODY_LIMIT): Promise<JsonObject> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= limit) return chunks.push(c);
      reject(new Error("body too large"));
      req.destroy();
    });
    req.on("end", () => {
      try {
        const parsed: unknown = chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
          : {};
        resolve(isJsonObject(parsed) ? parsed : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });

const validMemoryName = (name: unknown): name is string =>
  typeof name === "string" && isMemoryName(name);
const validId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);

/** What parseSettingsText hands back: the object, or why the text is not one. */
export type ParsedSettings =
  | { value: JsonObject; error?: undefined }
  | { error: string; value?: undefined };

/** settings.json must be one JSON object; anything else Claude Code would reject or ignore. */
export function parseSettingsText(text: unknown): ParsedSettings {
  if (typeof text !== "string") return { error: "text must be a string" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid JSON" };
  }
  if (!isJsonObject(value)) return { error: "settings.json must be a JSON object" };
  return { value };
}

/** Output of a probe command, or "" plus the failure text so the panel can show why. */
const run = (
  cmd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<{ out: string; error?: string }> =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout: 8000, windowsHide: true, env, cwd }, (e, out, err) =>
      resolve(
        e
          ? {
              out: "",
              error: String(err || e.message)
                .trim()
                .slice(0, 300),
            }
          : { out: String(out) },
      ),
    ),
  );

// Source runs from src/, the tsc build from lib/server/: the plugin's package.json is one or
// two levels up, so try the nearer one first and fall back to the farther.
const packageJson: unknown = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8").catch(() =>
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ),
);
const PLUGIN_VERSION =
  isJsonObject(packageJson) && typeof packageJson.version === "string" ? packageJson.version : "";

const MAX_BOXES = 20;

/** Another dsh server this panel can hop to; `token` is that box's dsh launch token. */
export interface Box {
  name: string;
  url: string;
  token?: string;
}

/** What validateBoxes hands back: the cleaned list, or why the input is not one. */
export type ValidatedBoxes =
  | { boxes: Box[]; error?: undefined }
  | { error: string; boxes?: undefined };

/**
 * The saved list of other dsh servers ("boxes"), each running this plugin with its own Claude
 * Code login. The browser hops between them; nothing is proxied. `token` is that box's dsh launch
 * token, kept so a browser without its cookie can still open it (same trick as the NPM proxy).
 */
export function validateBoxes(input: unknown): ValidatedBoxes {
  if (!Array.isArray(input)) return { error: "boxes must be an array" };
  if (input.length > MAX_BOXES) return { error: `at most ${MAX_BOXES} boxes` };
  const boxes: Box[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const b = isJsonObject(raw) ? raw : {};
    const name = String(b.name ?? "").trim();
    const url = String(b.url ?? "")
      .trim()
      .replace(/\/+$/, "");
    const token = b.token === undefined || b.token === null ? "" : String(b.token).trim();
    if (!name || name.length > 40) return { error: "each box needs a name (1-40 chars)" };
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: `"${name}": url must be absolute http(s)` };
    }
    if (!/^https?:$/.test(parsed.protocol)) return { error: `"${name}": url must be http(s)` };
    if (token.length > 200) return { error: `"${name}": token too long` };
    if (seen.has(url)) return { error: `"${name}": duplicate url` };
    seen.add(url);
    const box: Box = { name, url };
    if (token) box.token = token;
    boxes.push(box);
  }
  return { boxes };
}

async function readBoxes(path: string): Promise<Box[]> {
  try {
    const v = validateBoxes(JSON.parse(await readFile(path, "utf8")));
    return v.boxes ?? [];
  } catch {
    return [];
  }
}

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

/** A box's `/sessions?all=1` answer. */
interface BoxSessions {
  host: string;
  sessions: TranscriptListItem[];
}

/** One probe's outcome: the decoded body, or why the box could not be reached. */
export type Probe<T> = { ok: true; status: T } | { ok: false; error: string };

/** The subset of fetch the probe uses, so tests can hand in a fake. */
export type FetchLike = (
  url: string,
  init: { headers?: Record<string, string>; redirect: "manual"; signal: AbortSignal },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Fetch options the probe builds, extended with optional method/body for proxy routes. */
interface ProbeFetchOpts {
  headers?: Record<string, string>;
  redirect: "manual";
  signal: AbortSignal;
  method?: string;
  body?: string;
}

const cookieOf = (r: { headers: { get(name: string): string | null } }) =>
  (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

/**
 * Log into a box like a browser would (dsh's `/?token=` sets the auth cookie; an NPM-style proxy
 * redirects to that URL by itself) and read its plugin status. Never throws: the panel shows why.
 */
export async function probeBox<T = RuntimeStatus>(
  box: Box,
  fetchImpl: FetchLike = fetch,
  path = "status",
  init?: { method?: string; body?: string },
): Promise<Probe<T>> {
  const { url, token } = box;
  const signal = AbortSignal.timeout(path === "status" ? 6000 : 12000);
  const status = (cookie: string) => {
    const fetchHeaders: Record<string, string> = {};
    if (cookie) fetchHeaders.cookie = cookie;
    if (init?.body !== undefined) fetchHeaders["content-type"] = "application/json";
    const opts: ProbeFetchOpts = { redirect: "manual", signal };
    if (Object.keys(fetchHeaders).length) opts.headers = fetchHeaders;
    if (init?.method !== undefined) opts.method = init.method;
    if (init?.body !== undefined) opts.body = init.body;
    return fetchImpl(`${url}/dsh-oh-my-claude/${path}`, opts);
  };
  try {
    let cookie = "";
    if (token) {
      cookie = cookieOf(
        await fetchImpl(`${url}/?token=${encodeURIComponent(token)}`, {
          redirect: "manual",
          signal,
        }),
      );
    }
    let r = await status(cookie);
    if (!cookie && (r.status === 401 || (r.status >= 300 && r.status < 400))) {
      // A token-injecting proxy answers the front page with a redirect or a tiny page whose
      // only job is to navigate to /?token=…; take the token from either and log in with it.
      const front = await fetchImpl(`${url}/`, { redirect: "manual", signal });
      const hint =
        (front.headers.get("location") ?? "") +
        (front.status === 200 ? (await front.text()).slice(0, 4000) : "");
      const found = /[?&]token=([A-Za-z0-9_.~-]+)/.exec(hint);
      if (found) {
        cookie = cookieOf(
          await fetchImpl(`${url}/?token=${found[1]}`, { redirect: "manual", signal }),
        );
        r = await status(cookie);
      }
    }
    if (r.status === 401 || r.status === 403)
      return { ok: false, error: "login required: add this box's dsh token" };
    if (r.status === 404)
      return { ok: false, error: "dsh-oh-my-claude missing or too old on this box" };
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    // SAFETY: the body is another instance of this plugin answering the same route; the caller
    // names which route it asked and only reads the fields that route publishes
    return { ok: true, status: (await r.json()) as T };
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : undefined;
    return { ok: false, error: String(cause ?? errorText(e)).slice(0, 200) };
  }
}

/** The login half of `claude auth status` output. */
export interface AuthStatus {
  loggedIn: boolean;
  authMethod: string | null;
  email?: string | null;
  projectsDirectory?: string | null;
}

/** The login half of `claude auth status` output, tolerant of an older CLI printing prose. */
export function authFromStatus(text: string): AuthStatus {
  try {
    const parsed: unknown = JSON.parse(text);
    const j = isJsonObject(parsed) ? parsed : {};
    return {
      loggedIn: j.loggedIn === true,
      authMethod: typeof j.authMethod === "string" ? j.authMethod : null,
      email: typeof j.email === "string" ? j.email : null,
      projectsDirectory: typeof j.projectsDirectory === "string" ? j.projectsDirectory : null,
    };
  } catch {
    return { loggedIn: /logged in/i.test(text) && !/not logged in/i.test(text), authMethod: null };
  }
}

/** Which box and which login the usage belongs to; the CLI call is cached ten minutes. */
export interface AccountIdentity {
  host: string;
  email: string | null;
}
/** Per config dir: a second plugin instance has its own login, so its own answer. */
const identityCache = new Map<string, { at: number; value: AccountIdentity }>();
export async function accountIdentity(
  command = "claude",
  configDir?: string,
): Promise<AccountIdentity> {
  const key = configDir ?? "";
  const hit = identityCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const env = configDir ? { ...process.env, CLAUDE_CONFIG_DIR: configDir } : undefined;
  const status = await run(command, ["auth", "status"], env);
  const value = { host: hostname(), email: authFromStatus(status.out).email ?? null };
  identityCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * What the panel needs to answer "is this the right machine and account": which `claude` dsh
 * spawns, its version, the config dir it will read, and who is logged in. Same-box by design:
 * the plugin runs Claude Code as a child process, never over ssh.
 */
async function runtimeStatus(configDir: string, command = "claude"): Promise<RuntimeStatus> {
  const [which, version, status] = await Promise.all([
    run(
      process.platform === "win32" ? "where" : "sh",
      process.platform === "win32" ? [command] : ["-c", `command -v ${command}`],
    ),
    run(command, ["--version"]),
    run(command, ["auth", "status"]),
  ]);
  const out: RuntimeStatus = {
    host: hostname(),
    plugin: PLUGIN_VERSION,
    binary: which.out.trim().split(/\r?\n/)[0] || null,
    version: version.out.trim() || null,
    configDir,
    ...authFromStatus(status.out),
  };
  if (version.error) out.error = version.error;
  return out;
}

/** Every transcript under the Claude projects dir, each with the cwd its records name. */
async function listAllTranscripts(
  projectsDir: string,
  hidden: Set<string>,
): Promise<TranscriptListItem[]> {
  let dirs: string[] = [];
  try {
    dirs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const lists = await Promise.all(
    dirs.map((name) => listTranscripts(join(projectsDir, name), hidden).catch(() => [])),
  );
  return lists.flat();
}

/** Claude Code's settings file as the editor reads it. */
export interface SettingsFile {
  path: string;
  exists: boolean;
  text: string;
  mtime: number;
}

const isEnoent = (e: unknown): boolean =>
  typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";

/** Read Claude Code's settings file; a missing file reads as an empty object. */
async function readSettings(path: string): Promise<SettingsFile> {
  try {
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return { path, exists: true, text, mtime: info.mtimeMs };
  } catch (e) {
    if (isEnoent(e)) return { path, exists: false, text: "{}\n", mtime: 0 };
    throw e;
  }
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
export async function readPickerSettings(path: string): Promise<PickerSettings | undefined> {
  const file = await readSettings(path).catch(() => undefined);
  if (!file?.exists) return undefined;
  const { value } = parseSettingsText(file.text);
  if (!value) return undefined;
  const picker = value.modelPicker;
  const allowed = value.availableModels;
  if (!Array.isArray(allowed) && !isJsonObject(picker)) return undefined;
  const out: PickerSettings = { options: [], replaceBuiltInOptions: false };
  if (Array.isArray(allowed))
    out.availableModels = allowed.filter((m): m is string => typeof m === "string");
  if (isJsonObject(picker)) {
    out.replaceBuiltInOptions = picker.replaceBuiltInOptions === true;
    if (Array.isArray(picker.options))
      for (const row of picker.options) {
        if (!isJsonObject(row) || typeof row.model !== "string") continue;
        const option: PickerOption = { model: row.model };
        if (typeof row.label === "string") option.label = row.label;
        out.options.push(option);
      }
  }
  return out;
}

/** Keep the previous copy as .bak, write to a temp file, rename over: never a half-written file. */
async function writeWithBackup(
  path: string,
  text: string,
): Promise<{ path: string; backup: string; mtime: number }> {
  // A project that has never had settings has no `.claude/` yet; every other target dir exists.
  await mkdir(dirname(path), { recursive: true });
  const backup = `${path}.bak`;
  await copyFile(path, backup).catch((e: unknown) => {
    if (!isEnoent(e)) throw e;
  });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  await rename(tmp, path);
  return { path, backup, mtime: (await stat(path)).mtimeMs };
}

/** A dsh session a transcript belongs to, and whether it is archived. */
export interface OwnedSession {
  id: string;
  archived: boolean;
}

/**
 * Claude transcript id → the dsh session it belongs to, for the dsh sessions of one workspace.
 * A session this plugin started keeps its Claude transcript under `claudeIdOf(dsh id)`; one opened
 * from this panel shares the id. Archived sessions are included so the panel can bring them back
 * without any archive plugin.
 */
export function dshSessionsFor(
  headers: readonly { id: string; cwd?: string }[],
  cwd: string | null,
  claudeIdOf: (id: string) => string,
  archived: Set<string> = new Set(),
): Map<string, OwnedSession> {
  const map = new Map<string, OwnedSession>();
  for (const h of headers) {
    if (cwd !== null && h.cwd !== cwd) continue;
    const id = String(h.id);
    const entry: OwnedSession = { id, archived: archived.has(id) };
    map.set(id, entry);
    map.set(claudeIdOf(id), entry);
  }
  return map;
}
const validCwd = (cwd: unknown): cwd is string =>
  typeof cwd === "string" && cwd.startsWith("/") && !cwd.includes("\0");

/** What /open answers: the dsh session id to open, and whether it existed before. */
interface Opened {
  id: string;
  existed: boolean;
  turns?: number;
  events?: number;
}

/** The host services the routes read; injected before the route mounts. */
type RouteHost = Required<
  Pick<PluginContext, "webServer" | "connection" | "sessions" | "sessionPersistence">
>;

/**
 * Create the dsh session for one transcript: seed with the converted history, flush to disk,
 * leave. The client then adopts it through the normal `sessions.create({ sessionId })` path,
 * which attaches it to the workspace and makes it live.
 */
const opening = new Map<string, Promise<Opened>>();

/** Same id opened twice at once (double click, two tabs) shares one creation. */
function openTranscript(
  ctx: RouteHost,
  projectDir: (cwd: string) => string,
  cwd: string,
  id: string,
  claudeIdOf: (id: string) => string,
  registry: WorkspaceRegistry | undefined,
): Promise<Opened> {
  let job = opening.get(id);
  if (!job) {
    job = openTranscriptOnce(ctx, projectDir, cwd, id, claudeIdOf, registry).finally(() =>
      opening.delete(id),
    );
    opening.set(id, job);
  }
  return job;
}

/**
 * Loads a Claude Code transcript and creates a dsh session from it, or
 * returns the existing session if one with this id is already live.
 */
async function openTranscriptOnce(
  ctx: RouteHost,
  projectDir: (cwd: string) => string,
  cwd: string,
  id: string,
  claudeIdOf: (id: string) => string,
  registry: WorkspaceRegistry | undefined,
): Promise<Opened> {
  if (ctx.sessions.get(asSessionId(id))) return { id, existed: true };
  const owned = dshSessionsFor(
    await ctx.sessionPersistence.list(),
    cwd,
    claudeIdOf,
    new Set(registry?.archivedSessionIds ?? []),
  ).get(id);
  if (owned) {
    // ponytail: unarchive through the registry's own operation queue; dsh core has archiveSession
    // but no inverse, and the another plugin plugin does exactly this.
    if (owned.archived && registry?.enqueueOperation)
      await registry.enqueueOperation(async () => {
        const state = registry.requireState();
        await registry.setState({
          ...state,
          archivedSessionIds: state.archivedSessionIds.filter((x) => x !== owned.id),
        });
      });
    return { id: owned.id, existed: true };
  }
  const folded = await readTranscript(join(projectDir(cwd), `${id}.jsonl`));
  if (folded.turns.length === 0) throw new Error("transcript has no completed turn");
  const seed = toSessionEvents(folded);
  const session = ctx.sessions.prepare(asSessionId(id), {
    seed,
    meta: { cwd, createdAt: folded.createdAt },
  });
  const leave = ctx.sessions.enter(session);
  try {
    ctx.sessions.announce(session);
    await ctx.sessions.flush(session);
  } finally {
    leave();
  }
  return { id, existed: false, turns: folded.turns.length, events: seed.length };
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
  command?: string;
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
    reconnect: (sessionId: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  };
  /** The rules recent approval requests suggest, per session; the Tune tab offers them as chips. */
  permissionAsks?: Map<string, string[]>;
  /** The model catalog for advisor model selection. */
  models?: () => Promise<Array<{ id: string; name: string }>>;
}

/** The transcript file of a dsh session: under its Claude id (sessions the adapter started) or
 *  its own id (sessions restored from a transcript), whichever exists. */
async function transcriptPathFor(
  dir: string,
  sessionId: string,
  claudeIdOf: (id: string) => string,
): Promise<string | undefined> {
  for (const id of [claudeIdOf(sessionId), sessionId]) {
    const path = join(dir, `${id}.jsonl`);
    if (
      await stat(path).then(
        () => true,
        () => false,
      )
    )
      return path;
  }
  return undefined;
}

/** `projectDir(cwd)` → Claude Code project dir; `startedIds()` → ids the adapter started itself. */
export function registerSessionRoutes(
  ctx: PluginContext,
  {
    log,
    projectDir,
    projectsDir,
    startedIds,
    claudeIdOf,
    settingsPath,
    configDir,
    boxesPath,
    command,
    turnRecords,
    idle,
    permissionModes,
    rewind,
    contextUsage,
    workspaceDiff,
    mcp,
    permissionAsks,
    models,
  }: SessionRouteOptions,
): void {
  // Optional: stock dsh has it; without it archived sessions list but cannot be restored.
  let registry: WorkspaceRegistry | undefined;
  ctx.inject?.(["workspaceRegistry"], (host) => {
    registry = host.workspaceRegistry;
  });
  ctx.inject?.(["webServer", "connection", "sessions", "sessionPersistence"], (host) => {
    const { webServer, connection, sessions, sessionPersistence } = host;
    if (!webServer || !connection || !sessionPersistence) return;
    const routeHost: RouteHost = { webServer, connection, sessions, sessionPersistence };
    host.effect?.(
      () =>
        webServer.register({
          kind: "prefix",
          path: ROUTE_PREFIX,
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            const rejection = connection.requestRejection(req);
            if (rejection !== undefined) return json(res, rejection, { error: "forbidden" });
            const url = new URL(req.url ?? "/", "http://dsh");
            try {
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/sessions`) {
                const cwd = url.searchParams.get("cwd") ?? "";
                const all = url.searchParams.get("all") === "1";
                if (!all && !validCwd(cwd))
                  return json(res, 400, { error: "cwd must be an absolute path" });
                if (all) {
                  const owned = dshSessionsFor(
                    await sessionPersistence.list(),
                    null,
                    claudeIdOf,
                    new Set(registry?.archivedSessionIds ?? []),
                  );
                  const hidden = new Set([...(await startedIds())].filter((id) => !owned.has(id)));
                  const items = (await listAllTranscripts(projectsDir, hidden)).map((s) => {
                    const d = owned.get(s.id);
                    return d ? { ...s, dsh: d } : s;
                  });
                  return json(res, 200, { host: hostname(), sessions: items });
                }
                // Transcripts of dsh sessions (started here or opened from here) are listed with
                // their dsh id so the panel opens the existing session. Ones the adapter started
                // for a dsh session that no longer exists are hidden.
                const owned = dshSessionsFor(
                  await sessionPersistence.list(),
                  cwd,
                  claudeIdOf,
                  new Set(registry?.archivedSessionIds ?? []),
                );
                const hidden = new Set([...(await startedIds())].filter((id) => !owned.has(id)));
                const items = (await listTranscripts(projectDir(cwd), hidden)).map((s) => {
                  const d = owned.get(s.id);
                  return d ? { ...s, dsh: d } : s;
                });
                return json(res, 200, { sessions: items });
              }
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/open`) {
                const { cwd, id } = await readBody(req);
                if (!validCwd(cwd) || !validId(id))
                  return json(res, 400, { error: "cwd and id required" });
                return json(
                  res,
                  200,
                  await openTranscript(routeHost, projectDir, cwd, id, claudeIdOf, registry),
                );
              }
              // Claude's auto-memory for a workspace: list, read, write, delete one file.
              if (url.pathname === `${ROUTE_PREFIX}/memory`) {
                const body = req.method === "GET" ? {} : await readBody(req, 1024 * 1024);
                const cwd = url.searchParams.get("cwd") ?? body.cwd;
                if (!validCwd(cwd))
                  return json(res, 400, { error: "cwd must be an absolute path" });
                const dir = join(projectDir(cwd), "memory");
                const name = url.searchParams.get("name") ?? body.name;
                if (req.method === "GET" && name === undefined)
                  return json(res, 200, { dir, files: await listMemory(dir) });
                if (!validMemoryName(name))
                  return json(res, 400, { error: "name must be a .md file" });
                const path = join(dir, name);
                if (req.method === "GET") {
                  const text = await readFile(path, "utf8").catch(() => null);
                  return text === null
                    ? json(res, 404, { error: "not found" })
                    : json(res, 200, { text });
                }
                if (req.method === "PUT") {
                  if (typeof body.text !== "string")
                    return json(res, 400, { error: "text required" });
                  await mkdir(dir, { recursive: true });
                  await writeFile(path, body.text, "utf8");
                  log("info", `memory ${name} saved (${body.text.length} chars)`);
                  return json(res, 200, { ok: true });
                }
                if (req.method === "DELETE") {
                  await deleteMemory(dir, name);
                  log("info", `memory ${name} deleted`);
                  return json(res, 200, { ok: true });
                }
                return json(res, 405, { error: "method not allowed" });
              }
              // Instructions: the CLAUDE.md files the CLI loads for this workspace. The list is
              // recomputed per request and is the allowlist: a path it does not name is refused,
              // so the browser cannot read or write a file outside the hierarchy.
              if (
                url.pathname === `${ROUTE_PREFIX}/instructions` ||
                url.pathname === `${ROUTE_PREFIX}/instructions/file`
              ) {
                const body = req.method === "GET" ? {} : await readBody(req);
                const cwd = await knownCwd(
                  url.searchParams.get("cwd") ?? body.cwd,
                  sessionPersistence,
                );
                if (cwd === null)
                  return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                  });
                const files = await listInstructions(cwd, configDir);
                if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/instructions`)
                  return json(res, 200, { files });

                const path = req.method === "GET" ? url.searchParams.get("path") : body.path;
                const file = files.find((f) => f.path === path);
                if (file === undefined)
                  return json(res, 400, { error: "not a loaded instructions file" });

                if (req.method === "GET") {
                  const text = await readFile(file.path, "utf8").catch(() => null);
                  return text === null
                    ? json(res, 404, { error: "not found" })
                    : json(res, 200, { path: file.path, text });
                }
                if (req.method === "PUT") {
                  if (file.kind === "Managed")
                    return json(res, 403, { error: "the managed file is read-only" });
                  if (typeof body.text !== "string")
                    return json(res, 400, { error: "text required" });
                  const written = await writeWithBackup(file.path, body.text);
                  log("info", `instructions ${file.path} saved (${body.text.length} chars)`);
                  return json(res, 200, written);
                }
                return json(res, 405, { error: "method not allowed" });
              }
              if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings`) {
                if (req.method === "GET") return json(res, 200, await readSettings(settingsPath));
                if (req.method === "PUT") {
                  const body = await readBody(req, 1024 * 1024);
                  const text = body.text;
                  const scope = body.scope ?? "user";
                  if (!isSettingsScope(scope))
                    return json(res, 400, { error: "unknown settings scope" });
                  if (scope === "managed")
                    return json(res, 400, { error: "managed settings are read-only" });
                  const cwd = await knownCwd(body.cwd, sessionPersistence);
                  const path = settingsScopePath(scope, settingsPath, cwd);
                  if (path === undefined)
                    return json(res, 400, {
                      error: "project and local settings need a directory a dsh session is open in",
                    });
                  const parsed = parseSettingsText(text);
                  if (parsed.error !== undefined) return json(res, 400, { error: parsed.error });
                  const settingsText = typeof text === "string" ? text : "";
                  const written = await writeWithBackup(path, settingsText);
                  log("info", `${scope} settings saved (${settingsText.length} chars)`);
                  return json(res, 200, written);
                }
              }
              // Every scope the CLI merges, in one payload: the editor picks which to show and
              // works out from the rest which keys a higher-precedence file overrides.
              if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings/scopes`) {
                if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
                const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
                const scopes: SettingsScopeInfo[] = [];
                for (const scope of SETTINGS_SCOPES) {
                  const path = settingsScopePath(scope, settingsPath, cwd);
                  if (path === undefined) continue;
                  // An unreadable managed file (root-owned, or a directory) reads as absent
                  // rather than failing the whole payload.
                  const file = await readSettings(path).catch(() => ({
                    path,
                    exists: false,
                    text: "{}\n",
                    mtime: 0,
                  }));
                  scopes.push({ ...file, scope, readOnly: scope === "managed" });
                }
                return json(res, 200, { scopes });
              }
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/status`)
                return json(res, 200, await runtimeStatus(configDir, command));
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/models`) {
                if (!models) return json(res, 404, { error: "models not available" });
                try {
                  const modelList = await models();
                  return json(res, 200, { models: modelList });
                } catch (e) {
                  return json(res, 500, { error: errorText(e) });
                }
              }
              // Diagnostics: how this instance is running, and which of the files the CLI merges
              // it would refuse to start on. The MCP servers and the denied calls are read from
              // the routes that already serve them, so nothing is answered twice.
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/diagnostics`) {
                const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
                const runtime = await runtimeStatus(configDir, command);
                const configFiles: DiagnosticFile[] = [];
                for (const scope of SETTINGS_SCOPES) {
                  const path = settingsPath
                    ? settingsScopePath(scope, settingsPath, cwd)
                    : undefined;
                  if (path === undefined) continue;
                  // A file that cannot be read at all reads as absent, the way the scopes route
                  // treats a root-owned managed file: the payload is a report, not a failure.
                  const file = await readSettings(path).catch(() => null);
                  const entry: DiagnosticFile = { scope, path, exists: file?.exists ?? false };
                  const parsed = file?.exists === true ? parseSettingsText(file.text) : undefined;
                  if (parsed?.error !== undefined) entry.parseError = parsed.error;
                  configFiles.push(entry);
                }
                return json(res, 200, { runtime, configFiles });
              }
              // `claude doctor` runs a process and takes a second, so it is its own route and
              // nothing runs it until the button is pressed.
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/diagnostics/doctor`)
                return json(
                  res,
                  200,
                  await run(command || "claude", ["doctor"], {
                    ...process.env,
                    CLAUDE_CONFIG_DIR: configDir,
                  }),
                );
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/turns`) {
                const sid = url.searchParams.get("session");
                if (!sid) return json(res, 400, { error: "session param required" });
                const turns = turnRecords?.get(sid) ?? [];
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
                return json(res, 200, { turns, total });
              }
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/context`) {
                const sid = url.searchParams.get("session");
                if (!sid) return json(res, 400, { error: "session param required" });
                if (!contextUsage) return json(res, 404, { error: "context usage not available" });
                const reply = await contextUsage(sid);
                return json(res, reply.ok ? 200 : 409, reply);
              }
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/diff`) {
                const sid = url.searchParams.get("session");
                if (!sid) return json(res, 400, { error: "session param required" });
                if (!workspaceDiff)
                  return json(res, 404, { error: "workspace diff not available" });
                const reply = await workspaceDiff(sid);
                return json(res, reply.ok ? 200 : 409, reply);
              }
              if (mcp && req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/mcp-servers`) {
                const sid = url.searchParams.get("session");
                if (!sid) return json(res, 400, { error: "session param required" });
                const reply = await mcp.status(sid);
                return json(res, reply.ok ? 200 : 409, reply);
              }
              if (
                mcp &&
                req.method === "POST" &&
                url.pathname === `${ROUTE_PREFIX}/mcp-servers/reconnect`
              ) {
                const { session, name } = await readBody(req);
                if (typeof session !== "string" || typeof name !== "string")
                  return json(res, 400, { error: "session and name required" });
                const reply = await mcp.reconnect(session, name);
                return json(res, reply.ok ? 200 : 409, reply);
              }
              // Add a server: `claude mcp add-json`, run in the session's own directory so a
              // `local` or `project` scope writes into the project on screen and nowhere else.
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/mcp-servers/add`) {
                const body = await readBody(req);
                const built = buildAddServer(body);
                if ("error" in built) return json(res, 400, { error: built.error });
                const cwd = await sessionCwd(body.session, sessionPersistence);
                if (scopeNeedsCwd(built.scope) && cwd === null)
                  return json(res, 400, {
                    error: `${built.scope} scope needs a session open in a directory`,
                  });
                const result = await run(
                  command || "claude",
                  ["mcp", "add-json", built.name, JSON.stringify(built.json), "-s", built.scope],
                  { ...process.env, CLAUDE_CONFIG_DIR: configDir },
                  cwd ?? undefined,
                );
                if (result.error) return json(res, 400, { error: result.error });
                log("info", `mcp server ${built.name} added (${built.scope})`);
                return json(res, 200, { ok: true });
              }
              // Remove a server. Without `-s` the CLI takes it out of whichever scope has it, and
              // the session's directory is what decides which project that is.
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/mcp-servers/remove`) {
                const body = await readBody(req);
                if (!isMcpName(body.name)) return json(res, 400, { error: "name required" });
                const cwd = await sessionCwd(body.session, sessionPersistence);
                if (cwd === null)
                  return json(res, 400, { error: "no session open in a directory" });
                const result = await run(
                  command || "claude",
                  ["mcp", "remove", body.name],
                  { ...process.env, CLAUDE_CONFIG_DIR: configDir },
                  cwd,
                );
                if (result.error) return json(res, 400, { error: result.error });
                log("info", `mcp server ${body.name} removed`);
                return json(res, 200, { ok: true });
              }
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/idle`) {
                const sid = url.searchParams.get("session");
                if (!sid) return json(res, 400, { error: "session param required" });
                if (!idle) return json(res, 404, { error: "idle tracking not available" });
                return json(res, 200, {
                  deadline: idle.deadlineFor(sid),
                  timeoutMs: idle.timeoutMs,
                });
              }
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/idle/extend`) {
                const { session } = await readBody(req);
                if (!session) return json(res, 400, { error: "session param required" });
                if (!idle) return json(res, 404, { error: "idle tracking not available" });
                const sid = typeof session === "string" ? session : "";
                const ok = sid ? idle.extend(sid) : false;
                return json(
                  res,
                  ok ? 200 : 404,
                  ok ? { extended: true } : { error: "unknown session" },
                );
              }
              // Rewind: the session's user prompts (from Claude's transcript), then the rewind itself.
              if (rewind && req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/rewind`) {
                const sid = url.searchParams.get("session");
                const cwd = url.searchParams.get("cwd") ?? "";
                if (!sid || !validCwd(cwd))
                  return json(res, 400, { error: "session and an absolute cwd required" });
                const path = await transcriptPathFor(projectDir(cwd), sid, claudeIdOf);
                if (!path) return json(res, 200, { prompts: [] });
                const folded = await readTranscript(path);
                const prompts: RewindPrompt[] = folded.turns
                  .map((t) => ({
                    id: t.id,
                    time: t.time,
                    text: t.content
                      .map((c) => c.text)
                      .join("\n")
                      .slice(0, 200),
                  }))
                  .toReversed()
                  .slice(0, 20);
                return json(res, 200, { prompts });
              }
              if (rewind && req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/rewind`) {
                const { session: sid, uuid, dryRun } = await readBody(req);
                if (typeof sid !== "string" || !sid || !validId(uuid))
                  return json(res, 400, { error: "session and uuid required" });
                return json(res, 200, await rewind(sid, uuid, dryRun === true));
              }
              if (permissionModes && url.pathname === `${ROUTE_PREFIX}/permission-mode`) {
                if (req.method === "GET") {
                  const sid = url.searchParams.get("session");
                  if (!sid) return json(res, 400, { error: "session param required" });
                  const info = permissionModes.info(sid);
                  return json(res, 200, { ...info, modes: info.allowed });
                }
                if (req.method === "PUT") {
                  const { session: sid, mode } = await readBody(req);
                  if (typeof sid !== "string" || !sid)
                    return json(res, 400, { error: "session required" });
                  if (mode !== null && (typeof mode !== "string" || !isPermissionMode(mode)))
                    return json(res, 400, {
                      error: `mode must be one of ${PERMISSION_MODES.join(", ")} or null`,
                    });
                  return json(res, 200, await permissionModes.set(sid, mode));
                }
                return json(res, 405, { error: "method not allowed" });
              }
              if (url.pathname === `${ROUTE_PREFIX}/permission-asks`) {
                if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
                const session = url.searchParams.get("session");
                if (!session) return json(res, 400, { error: "session required" });
                return json(res, 200, { asks: permissionAsks?.get(session) ?? [] });
              }
              if (boxesPath && url.pathname === `${ROUTE_PREFIX}/boxes`) {
                if (req.method === "GET")
                  return json(res, 200, { boxes: await readBoxes(boxesPath) });
                if (req.method === "PUT") {
                  const v = validateBoxes((await readBody(req)).boxes);
                  if (v.error !== undefined) return json(res, 400, { error: v.error });
                  await writeFile(boxesPath, `${JSON.stringify(v.boxes, null, 2)}\n`, "utf8");
                  return json(res, 200, { boxes: v.boxes });
                }
              }
              if (
                boxesPath &&
                req.method === "GET" &&
                url.pathname === `${ROUTE_PREFIX}/boxes/sessions`
              ) {
                const boxes = await readBoxes(boxesPath);
                const probed = await Promise.all(
                  boxes.map((b) => probeBox<BoxSessions>(b, fetch, "sessions?all=1")),
                );
                return json(res, 200, {
                  boxes: boxes.map((b, i) => {
                    const p = probed[i];
                    if (!p) return { name: b.name, url: b.url, ok: false, error: "not probed" };
                    return p.ok
                      ? {
                          name: b.name,
                          url: b.url,
                          ok: true,
                          host: p.status.host,
                          sessions: p.status.sessions ?? [],
                        }
                      : { name: b.name, url: b.url, ok: false, error: p.error };
                  }),
                });
              }
              if (
                boxesPath &&
                req.method === "GET" &&
                url.pathname === `${ROUTE_PREFIX}/boxes/status`
              ) {
                const boxes = await readBoxes(boxesPath);
                const probed = await Promise.all(boxes.map((b) => probeBox(b)));
                return json(res, 200, {
                  self: { plugin: PLUGIN_VERSION, host: hostname() },
                  boxes: boxes.map((b, i) => ({ name: b.name, url: b.url, ...probed[i] })),
                });
              }
              if (boxesPath && url.pathname === `${ROUTE_PREFIX}/boxes/settings`) {
                const urlParam = url.searchParams.get("url");
                if (!urlParam) return json(res, 400, { error: "url parameter required" });
                const boxes = await readBoxes(boxesPath);
                const box = boxes.find((b) => b.url === urlParam);
                if (!box) return json(res, 404, { error: "unknown box" });
                if (req.method === "GET") {
                  const p = await probeBox(box, fetch, "settings", { method: "GET" });
                  if (!p.ok) return json(res, 502, { error: p.error });
                  return json(res, 200, p.status);
                }
                if (req.method === "PUT") {
                  const { text } = await readBody(req, 1024 * 1024);
                  const parsed = parseSettingsText(text);
                  if (parsed.error !== undefined) return json(res, 400, { error: parsed.error });
                  const p = await probeBox(box, fetch, "settings", {
                    method: "PUT",
                    body: JSON.stringify({ text }),
                  });
                  if (!p.ok) return json(res, 502, { error: p.error });
                  return json(res, 200, p.status);
                }
                return json(res, 405, { error: "method not allowed" });
              }
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/scheduled-tasks`) {
                const sid = url.searchParams.get("session");
                if (!sid) return json(res, 400, { error: "session param required" });
                const cwd = await sessionCwd(sid, sessionPersistence);
                if (!cwd) return json(res, 404, { error: "session not found" });
                try {
                  // The durable file and the transcript answer different halves: the file holds
                  // what survives a restart, the transcript is the only record of the rest.
                  const durable = await readDurableTasks(cwd);
                  const path = await transcriptPathFor(projectDir(cwd), sid, claudeIdOf);
                  const folded = path ? await readTranscript(path) : undefined;
                  const reply: ScheduledTasksReply = {
                    ok: true,
                    durable,
                    session: folded ? sessionTasksFrom(folded) : [],
                    goal: folded ? goalFrom(folded) : null,
                    path: durableTasksPath(cwd),
                  };
                  return json(res, 200, reply);
                } catch (e) {
                  const reply: ScheduledTasksError = { ok: false, error: errorText(e) };
                  return json(res, 500, reply);
                }
              }
              return json(res, 404, { error: "not found" });
            } catch (e) {
              log("warn", `session route failed: ${errorText(e)}`);
              return json(res, 500, { error: errorText(e) });
            }
          },
        }),
      "dsh-oh-my-claude session routes",
    );
  });
}

/** The settings files the CLI merges, highest precedence first. */
/** One settings file as the Diagnostics tab reports it: where it is, and why the CLI refuses it. */
interface DiagnosticFile {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  parseError?: string;
}

export const SETTINGS_SCOPES = ["managed", "local", "project", "user"] as const;

/** One of the four settings files. The CLI's own layer names, minus the `--settings` flag layer. */
export type SettingsScope = (typeof SETTINGS_SCOPES)[number];

/** One scope's file in the `GET /settings/scopes` payload. */
export interface SettingsScopeInfo extends SettingsFile {
  scope: SettingsScope;
  readOnly: boolean;
}

export function isSettingsScope(value: JsonValue | undefined): value is SettingsScope {
  // SAFETY: the includes() call narrows nothing on its own; the signature is the narrowing.
  return SETTINGS_SCOPES.includes(value as SettingsScope);
}

/** Where the CLI's policy layer lives on Linux; the plugin never writes it. */
const MANAGED_SETTINGS_PATH = "/etc/claude-code/managed-settings.json";

/**
 * The file a scope names. Paths are derived here and never taken from the client: the request
 * carries a scope and a directory, not a path. Project and local have no file without a
 * directory, and answer undefined so the caller can refuse the request.
 */
export function settingsScopePath(
  scope: SettingsScope,
  userPath: string,
  cwd: string | null,
): string | undefined {
  if (scope === "user") return userPath;
  if (scope === "managed") return MANAGED_SETTINGS_PATH;
  if (cwd === null) return undefined;
  return join(cwd, ".claude", scope === "local" ? "settings.local.json" : "settings.json");
}

/**
 * A directory only counts when a dsh session is open in it. Without this a browser could name
 * any directory on the box and have `.claude/settings.json` written into it.
 */
async function knownCwd(
  cwd: JsonValue | undefined | null,
  sessions: SessionPersistence,
): Promise<string | null> {
  if (!validCwd(cwd)) return null;
  const headers = await sessions.list().catch(() => []);
  return headers.some((h) => h.cwd === cwd) ? cwd : null;
}

/**
 * The directory a session is open in, from dsh's own record of it. The browser names the session,
 * never the directory, so nothing it posts can point the CLI at a project it has no session in.
 */
async function sessionCwd(
  session: JsonValue | undefined,
  sessions: SessionPersistence,
): Promise<string | null> {
  if (typeof session !== "string" || !session) return null;
  const headers = await sessions.list().catch(() => []);
  return headers.find((h) => h.id === session)?.cwd ?? null;
}
