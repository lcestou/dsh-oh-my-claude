// Host half of "open a Claude Code session in dsh": lists the transcripts of a workspace and turns
// one into a cold dsh session whose id is the Claude session id, so the adapter resumes it as-is.
// Served under /dsh-oh-my-claude/*, guarded by dsh's own request policy (trusted host + login cookie).
// This is an I/O boundary: HTTP bodies, probe output and JSON files are decoded here.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { hostname } from "node:os";
import { readdir, readFile, writeFile, rename, copyFile, stat, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  foldTranscript,
  listTranscripts,
  readTranscript,
  toSessionEvents,
  type FoldedTranscript,
} from "./transcript.js";
import { shq, sshArgs } from "./process.js";
import { isNewer, latestVersion, profileFromPath, updateCommand } from "./update.js";
import {
  classifyReach,
  loginUrlIn,
  reachScript,
  tailscalePeers,
  tailscaleStatus,
  validateTailnetJoin,
  wireguardPeers,
  type Reach,
} from "./reach.js";
import { spawn } from "node:child_process";
import {
  childPath,
  homeAt,
  isEnoent,
  listDirsAt,
  makeDirAt,
  readAt,
  writeAt,
  type FsBox,
} from "./remote-fs.js";
import type { TranscriptListItem } from "./transcript.js";
import { deleteMemory, isMemoryName, listMemory } from "./memory.js";
import { isWritableInstructions, listInstructions } from "./instructions.js";
import { listSkills } from "./skills.js";
import { listConfiguredMcp } from "./mcp-config.js";
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
import {
  deleteSshToken,
  readSshToken,
  THIS_BOX,
  startSshLogin,
  type LoginOutcome,
  pollSshLogin,
  submitSshLoginCode,
} from "./ssh-login.js";
import type {
  JsonValue,
  PluginContext,
  SessionPersistence,
  WorkspaceId,
  WorkspaceRegistry,
} from "./dsh.js";
import { errorText } from "./process.js";
import { featureSwitches } from "./switches.js";
import type { ToolMode, ToolModeInfo } from "./rows-probe.js";
import {
  isMarketplaceSource,
  isPluginId,
  isPluginScope,
  pluginRoster,
  pluginScopeNeedsCwd,
} from "./plugins.js";
import { CLAUDE_HOME, PERMISSION_MODES, isPermissionMode } from "./state.js";
import { projectDirName, type LoginNeed } from "./adapter.js";
import type {
  PermissionModeInfo,
  PermissionModeReply,
  RewindPrompt,
  RewindReply,
  ContextUsageReply,
  WorkspaceDiffReply,
  McpStatusReply,
  AsideEntry,
  LiveTurn,
} from "./adapter.js";

const ROUTE_PREFIX = "/dsh-oh-my-claude";
/** How long a thinking figure counts as current. The CLI sends one frame per delta while the model
 *  thinks, so anything older than a beat or two means it stopped and the status row should stop
 *  saying so. Generous enough to survive a slow delta, short enough that the word does not linger. */
const BODY_LIMIT = 64 * 1024;
/** An imported transcript is a whole conversation, not a form field: megabytes, not kilobytes. */
const IMPORT_LIMIT = 32 * 1024 * 1024;

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
  timeout = 8000,
): Promise<{ out: string; error?: string }> =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout, windowsHide: true, env, cwd }, (e, out, err) =>
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
const PLUGIN_NAME =
  isJsonObject(packageJson) && typeof packageJson.name === "string" ? packageJson.name : "";
/** The one `dsh plugin ... update` line for this install; the profile is read off this file's path. */
const UPDATE_COMMAND = updateCommand(PLUGIN_NAME, profileFromPath(import.meta.url));
/** The box-wide booleans under `hints.json`: one-time hints and the settings switches. Only `true`
 *  is kept, so a missing or unreadable file reads as every switch at its default. */
async function readHints(hintsPath: string): Promise<Record<string, boolean>> {
  const parsed: unknown = await readFile(hintsPath, "utf8")
    .then((t) => JSON.parse(t))
    .catch(() => null);
  const out: Record<string, boolean> = {};
  if (isJsonObject(parsed))
    for (const [k, v] of Object.entries(parsed)) if (v === true) out[k] = true;
  return out;
}

/** A newer release on npm than the one running, with the command that brings it in. Only this box
 *  asks: a remote dsh box answers its own `/status` from its own copy. The Update notice switch
 *  (`updateCheckOff` in the hints store) turns the read off entirely, not just the pill. */
async function pluginUpdate(
  hintsPath: string,
): Promise<{ latest: string; update: string } | undefined> {
  if (!PLUGIN_NAME || !PLUGIN_VERSION) return undefined;
  if ((await readHints(hintsPath)).updateCheckOff) return undefined;
  const latest = await latestVersion(PLUGIN_NAME);
  return latest && isNewer(PLUGIN_VERSION, latest) ? { latest, update: UPDATE_COMMAND } : undefined;
}

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
export function sshBoxProviderId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `claude-code-${slug}`;
}

/** What validateSshBoxes hands back: the cleaned list, or why the input is not one. */
export type ValidatedSshBoxes =
  | { boxes: SshBox[]; error?: undefined }
  | { error: string; boxes?: undefined };

export function validateSshBoxes(input: unknown): ValidatedSshBoxes {
  if (!Array.isArray(input)) return { error: "SSH boxes must be an array" };
  if (input.length > MAX_BOXES) return { error: `at most ${MAX_BOXES} SSH boxes` };
  const boxes: SshBox[] = [];
  const ids = new Set<string>();
  const hosts = new Set<string>();
  for (const raw of input) {
    const b = isJsonObject(raw) ? raw : {};
    const name = String(b.name ?? "").trim();
    const host = String(b.host ?? "").trim();
    if (!name || name.length > 40) return { error: "each SSH box needs a name (1-40 chars)" };
    // The name has to slug to a non-empty, unique provider id, else two boxes would collide on one
    // instance. `[user@]host[:port]` and config aliases only; no shell metacharacters near ssh.
    const id = sshBoxProviderId(name);
    if (id === "claude-code-") return { error: `"${name}": name needs a letter or digit` };
    if (ids.has(id)) return { error: `"${name}": another box already uses that name` };
    if (!host || host.length > 200) return { error: `"${name}": host is required (1-200 chars)` };
    if (!/^[A-Za-z0-9][A-Za-z0-9._@:%+-]*$/.test(host))
      return { error: `"${name}": host has invalid characters` };
    if (hosts.has(host)) return { error: `"${name}": duplicate host ${host}` };
    ids.add(id);
    hosts.add(host);
    const via = b.via === "tailscale" || b.via === "wireguard" ? b.via : undefined;
    boxes.push(via === undefined ? { name, host } : { name, host, via });
  }
  return { boxes };
}

export async function readSshBoxes(path: string): Promise<SshBox[]> {
  try {
    const v = validateSshBoxes(JSON.parse(await readFile(path, "utf8")));
    return v.boxes ?? [];
  } catch {
    return [];
  }
}

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
export const slugForDir = (s: string): string => {
  const base =
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "x";
  // Two long cwds sharing a 48-char prefix would collide onto one workspace dir; when the slug
  // was actually truncated, suffix a hash of the full string so distinct inputs stay distinct.
  if (base.length < 48) return base;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `${base}-${(h >>> 0).toString(36)}`;
};

/** What the add form sends; cleaned or rejected before a placeholder or workspace is made. */
export type ValidatedRemoteWorkspace =
  | { value: { name: string; host: string; remoteCwd: string }; error?: undefined }
  | { error: string; value?: undefined };

export function validateRemoteWorkspaceInput(input: unknown): ValidatedRemoteWorkspace {
  const b = isJsonObject(input) ? input : {};
  const name = String(b.name ?? "").trim();
  const host = String(b.host ?? "").trim();
  const remoteCwd = String(b.remoteCwd ?? "").trim();
  if (!name || name.length > 40) return { error: "name is required (1-40 chars)" };
  if (!host || host.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._@:%+-]*$/.test(host))
    return { error: "a valid ssh host is required" };
  // remoteCwd is single-quoted into a remote `cd`, so a newline or NUL is the only break-out risk;
  // require an absolute path since a quoted `~` does not expand.
  if (!remoteCwd || remoteCwd.length > 4096) return { error: "remote path is required" };
  if (/[\n\r\0]/.test(remoteCwd)) return { error: "remote path has invalid characters" };
  if (!remoteCwd.startsWith("/")) return { error: "remote path must be absolute (start with /)" };
  return { value: { name, host, remoteCwd } };
}

export async function readRemoteWorkspaces(path: string): Promise<RemoteWorkspace[]> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(raw)) return [];
    const out: RemoteWorkspace[] = [];
    for (const r of raw) {
      const b = isJsonObject(r) ? r : {};
      const name = String(b.name ?? "");
      const host = String(b.host ?? "");
      const remoteCwd = String(b.remoteCwd ?? "");
      const p = String(b.path ?? "");
      const workspaceId = String(b.workspaceId ?? "");
      if (name && host && remoteCwd && p && workspaceId)
        out.push({ name, host, remoteCwd, path: p, workspaceId });
    }
    return out;
  } catch {
    return [];
  }
}

/** The instance whose local spawns take this box's panel login. */
const DEFAULT_PROVIDER = "claude-code";
/** `authMethod` a status reports when the login is a token the panel minted, not the CLI's own. */
export const PANEL_TOKEN = "panel token";

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
  /** Claude processes still running on the box; they answer on the login they loaded at start. */
  running?: number;
}

/**
 * One ssh to the box, kept apart from `run` because the stage needs the exit code as well as the
 * text: 255 is ssh's own failure, anything else is the far shell's.
 */
const probeReach = (host: string, command: string, timeout = 12_000): Promise<Reach> =>
  new Promise((resolve) =>
    execFile(
      "ssh",
      sshArgs(host, reachScript(command)),
      { timeout, windowsHide: true },
      (e, out, err) => {
        // SAFETY: execFile's error carries the child's exit code as `code` when it exited
        const code = e ? ((e as { code?: unknown }).code ?? null) : 0;
        resolve(classifyReach(typeof code === "number" ? code : null, String(err), String(out)));
      },
    ),
  );

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
  loggedIn: boolean;
}
/** Per config dir: a second plugin instance has its own login, so its own answer. */
const identityCache = new Map<string, { at: number; value: AccountIdentity }>();
/** A panel login or logout changed who a box is: the next ask reads the CLI again. */
export function forgetIdentity(): void {
  identityCache.clear();
}
export async function accountIdentity(
  command = "claude",
  configDir?: string,
  sshHost = "",
): Promise<AccountIdentity> {
  const key = `${sshHost}\0${configDir ?? ""}`;
  const hit = identityCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  // A remote box reports its own login over ssh (its own `~/.claude`); a local configDir would be
  // meaningless there, so it is never sent.
  const status = sshHost
    ? await run("ssh", sshArgs(sshHost, `${shq(command)} auth status`))
    : await run(command, ["auth", "status"], cliEnvFor(configDir));
  const auth = authFromStatus(status.out);
  const value = { host: sshHost || hostname(), email: auth.email ?? null, loggedIn: auth.loggedIn };
  identityCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * The environment for a `claude` call on this box. `CLAUDE_CONFIG_DIR` is exported only when the
 * instance's dir is not the CLI's own default: with the variable set, the CLI keeps its
 * `.claude.json` (local and user MCP servers, project trust) inside that dir instead of at
 * `~/.claude.json`, so an MCP server added from the panel with the default dir landed in a shadow
 * file no terminal and no plugin-started Claude ever read (found 2026-09-10). The spawn env
 * follows the same rule, so the routes and the process see one config.
 */
export function cliEnvFor(dir?: string): NodeJS.ProcessEnv {
  return dir && dir !== CLAUDE_HOME ? { ...process.env, CLAUDE_CONFIG_DIR: dir } : process.env;
}

/**
 * What the panel needs to answer "is this the right machine and account": which `claude` dsh
 * spawns, its version, the config dir it will read, and who is logged in. When `sshHost` is set the
 * instance drives Claude Code on that box, so every probe runs there over ssh and reports the remote
 * binary, version and login rather than this box's.
 */
async function runtimeStatus(
  configDir: string,
  command = "claude",
  sshHost = "",
): Promise<RuntimeStatus> {
  const remote = (args: string[]) =>
    run("ssh", sshArgs(sshHost, `${shq(command)} ${args.map(shq).join(" ")}`));
  const [which, version, status] = await Promise.all([
    sshHost
      ? run("ssh", sshArgs(sshHost, `command -v ${shq(command)}`))
      : run(
          process.platform === "win32" ? "where" : "sh",
          process.platform === "win32" ? [command] : ["-c", `command -v ${command}`],
        ),
    sshHost ? remote(["--version"]) : run(command, ["--version"]),
    sshHost ? remote(["auth", "status"]) : run(command, ["auth", "status"]),
  ]);
  const out: RuntimeStatus = {
    host: sshHost || hostname(),
    plugin: PLUGIN_VERSION,
    binary: which.out.trim().split(/\r?\n/)[0] || null,
    version: version.out.trim() || null,
    configDir: sshHost ? "(remote ~/.claude)" : configDir,
    ...authFromStatus(status.out),
  };
  if (version.error) out.error = version.error;
  // Only when something is wrong, and only over ssh: the stage names the fix the row shows.
  if (sshHost && (version.error || !out.binary)) out.reach = await probeReach(sshHost, command);
  return out;
}

/** Every transcript under the Claude projects dir, each with the cwd its records name. */
async function listAllTranscripts(
  projectsDirs: string[],
  hidden: Set<string>,
): Promise<TranscriptListItem[]> {
  const dirs: string[] = [];
  for (const root of projectsDirs)
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => []))
      if (entry.isDirectory()) dirs.push(join(root, entry.name));
  const lists = await Promise.all(dirs.map((dir) => listTranscripts(dir, hidden).catch(() => [])));
  return lists.flat();
}

// A self-contained lister that runs on an SSH box over `node -e`: walk `~/.claude/projects`, peek the
// head of each transcript (bounded to 256 KB so only metadata crosses the wire, never a whole pasted
// image) and emit `TranscriptListItem[]` as JSON — the same shape `listTranscripts` builds locally, so
// a box's rows read like this box's. Double quotes only, so `shq` wraps it in single quotes without
// escaping. Node is present wherever `claude` runs, so no extra install; a box without it just errors.
export const SSH_TRANSCRIPT_LISTER = `(function(){
const fs=require("fs"),os=require("os"),p=require("path");
const root=p.join(os.homedir(),".claude","projects");
let dirs=[];try{dirs=fs.readdirSync(root)}catch(e){process.stdout.write("[]");return}
const out=[];
for(const d of dirs){
 const dir=p.join(root,d);let names;
 try{names=fs.readdirSync(dir)}catch(e){continue}
 for(const n of names){
  const m=/^([0-9a-f-]{36})\\.jsonl$/.exec(n);if(!m)continue;
  const fp=p.join(dir,n);let st;
  try{st=fs.statSync(fp)}catch(e){continue}
  const readHead=function(cap){
   const buf=Buffer.alloc(cap);let bytes=0,fd;
   try{fd=fs.openSync(fp,"r");bytes=fs.readSync(fd,buf,0,cap,0);fs.closeSync(fd)}catch(e){return null}
   return {text:buf.slice(0,bytes).toString("utf8"),partial:bytes>=cap};
  };
  const scan=function(head){
   let cwd,summary,title="",turns=0;
   for(const line of head.split("\\n")){
    if(!line)continue;let r;
    try{r=JSON.parse(line)}catch(e){continue}
    if(cwd===undefined&&typeof r.cwd==="string")cwd=r.cwd;
    if(r.type==="summary"&&typeof r.summary==="string")summary=r.summary;
    if(r.type!=="user"||r.isSidechain||r.isMeta)continue;
    const c=r.message&&r.message.content;let t="";
    if(typeof c==="string")t=c;
    else if(Array.isArray(c)){const a=[];for(const b of c){if(b&&b.type==="text"&&typeof b.text==="string")a.push(b.text)}t=a.join("\\n")}
    if(!t)continue;
    if(turns===0&&t.indexOf("Generate the session title")===0)break;
    turns++;
    if(!title&&!/^\\s*<(command-|local-command|system-reminder)/.test(t))
     title=(t.replace(/<system-reminder>[\\s\\S]*?<\\/system-reminder>/g,"").trim().split("\\n")[0]||"").replace(/\\s+/g," ").slice(0,120);
   }
   return {cwd:cwd,summary:summary,title:title,turns:turns};
  };
  let h=readHead(262144);if(!h)continue;
  let f=scan(h.text);
  // Same second look as listTranscripts: one huge opening record can push the first real turn past
  // the head bound and make a live session read as empty. Only the files that found nothing pay it.
  if(f.turns===0&&h.partial){const d2=readHead(2097152);if(d2){h=d2;f=scan(h.text)}}
  if(f.turns===0)continue;
  const item={id:m[1],title:f.summary||f.title,createdAt:st.mtimeMs,modifiedAt:st.mtimeMs,bytes:st.size,turns:f.turns,turnsPartial:h.partial};
  if(f.cwd)item.cwd=f.cwd;
  out.push(item);
 }
}
out.sort(function(a,b){return b.modifiedAt-a.modifiedAt});
process.stdout.write(JSON.stringify(out));
})();`;

/** List an SSH box's Claude transcripts by running {@link SSH_TRANSCRIPT_LISTER} on it over ssh. */
async function sshTranscripts(
  host: string,
): Promise<{ ok: true; sessions: TranscriptListItem[] } | { ok: false; error: string }> {
  const r = await run(
    "ssh",
    sshArgs(host, `node -e ${shq(SSH_TRANSCRIPT_LISTER)}`),
    undefined,
    undefined,
    15000,
  );
  if (r.error) return { ok: false, error: r.error };
  try {
    const parsed: unknown = JSON.parse(r.out);
    if (!Array.isArray(parsed)) return { ok: false, error: "unexpected remote output" };
    // SAFETY: our own lister prints TranscriptListItem[]; the client re-reads each field defensively.
    return { ok: true, sessions: parsed as TranscriptListItem[] };
  } catch {
    return { ok: false, error: "unparseable remote output" };
  }
}

/** Claude Code's settings file as the editor reads it. */
export interface SettingsFile {
  path: string;
  exists: boolean;
  text: string;
  mtime: number;
}

/** Read Claude Code's settings file on the session's own box; a missing file reads as an empty object. */
async function readSettings(box: FsBox, path: string): Promise<SettingsFile> {
  const file = await readAt(box, path);
  return file === null
    ? { path, exists: false, text: "{}\n", mtime: 0 }
    : { path, exists: true, text: file.text, mtime: file.mtimeMs };
}

/**
 * Every settings file that exists for a cwd, highest precedence first, which is the order the
 * per-key merges in `switches.ts` and `plugins.ts` expect.
 */
async function settingsTexts(
  box: FsBox,
  userPath: string,
  cwd: string | null,
): Promise<Array<{ scope: string; text: string }>> {
  const texts: Array<{ scope: string; text: string }> = [];
  for (const scope of SETTINGS_SCOPES) {
    const path = settingsScopePath(scope, userPath, cwd);
    if (path === undefined) continue;
    // A file the box cannot answer for is a fault, not an empty one: reading it as empty shows
    // every key it sets as unset, and the roster built from that says a plugin is off when it is
    // on. Only the managed file, which is root-owned by design, is allowed to drop out of the merge.
    const file = await readSettings(box, path).catch((e: unknown) => {
      if (scope !== "managed") throw e;
      return null;
    });
    if (file?.exists === true) texts.push({ scope, text: file.text });
  }
  return texts;
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
  const file = await readSettings({}, path).catch(() => undefined);
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

/** The mtime an editor sends back with its save; a body without one asks for no conflict check. */
const mtimeOf = (body: Record<string, unknown>): number | undefined =>
  typeof body.mtime === "number" && Number.isFinite(body.mtime) ? body.mtime : undefined;

/**
 * Keep the previous copy as .bak, write to a temp file, rename over: never a half-written file.
 * `expect` is the mtime the editor read, when it sent one: a file that has moved since is someone
 * else's edit — the CLI rewriting settings.json while the tab sat open, or a second tab — and a
 * whole-file write would put it back the way this tab last saw it.
 */
async function writeWithBackup(
  box: FsBox,
  path: string,
  text: string,
  expect?: number,
): Promise<{ path: string; backup: string; mtime: number }> {
  if (expect !== undefined) {
    // Compared exactly: the value the editor sends is the one a read answered, and it survives
    // JSON unchanged. Rounding it would only widen the window in which two writes look alike.
    const now = (await readAt(box, path))?.mtimeMs ?? 0;
    if (now !== expect)
      throw new Error(`${path} changed since it was opened; reopen it and redo the edit`);
  }
  // A box's file is written by the same script that reads it, backup and temp file included, so a
  // dropped connection cannot leave half a settings file behind.
  if (box.sshHost) return { path, backup: `${path}.bak`, mtime: await writeAt(box, path, text) };
  // A project that has never had settings has no `.claude/` yet; every other target dir exists.
  await mkdir(dirname(path), { recursive: true });
  const backup = `${path}.bak`;
  await copyFile(path, backup).catch((e: unknown) => {
    if (!isEnoent(e)) throw e;
  });
  // Two writes to one path race otherwise: both would use this name, the loser's rename finds it
  // gone, and its backup copy can land after the winner's rename and overwrite the pre-edit copy.
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  await rename(tmp, path);
  return { path, backup, mtime: (await stat(path)).mtimeMs };
}

/**
 * A dsh subagent run lives inside its parent conversation; dsh refuses to open it standalone
 * ("subagent Sessions require their durable parent address"), so it has no working row in any
 * listing — this cwd's, every cwd's, or a box's.
 */
export const withoutSubagents = <T extends { id: string; dsh?: { subagent?: boolean } }>(
  rows: T[],
): T[] => rows.filter((s) => !s.dsh?.subagent);

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
type StoredHeader = { id: string; cwd?: string; origin?: string };
const headerOf = (entry: StoredHeader | { header: StoredHeader }): StoredHeader => {
  if ("header" in entry && entry.header !== undefined) return entry.header;
  // SAFETY: no `header` member means the entry is the bare header shape of the union
  return entry as StoredHeader;
};

export function dshSessionsFor(
  entries: readonly (StoredHeader | { header: StoredHeader })[],
  cwd: string | null,
  claudeIdOf: (id: string) => string,
  archived: Set<string> = new Set(),
): Map<string, OwnedSession> {
  const map = new Map<string, OwnedSession>();
  for (const h of entries.map(headerOf)) {
    if (cwd !== null && h.cwd !== cwd) continue;
    const id = String(h.id);
    const entry: OwnedSession = { id, archived: archived.has(id) };
    if (h.origin === "subagent") entry.subagent = true;
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

/** The id the transcript's own records carry, which is what the CLI knew the session by. */
const idIn = (text: string): string | undefined =>
  /"sessionId"\s*:\s*"([0-9a-f-]{36})"/.exec(text.slice(0, 8192))?.[1];

/**
 * Whether that id is already in use here — a live dsh session, a transcript under any project dir,
 * or an earlier import. An import that reused one would shadow the real conversation, so it takes a
 * fresh id instead; the original still sits inside the file's own records.
 */
async function idTaken(
  live: (id: string) => boolean,
  projectsDirs: string[],
  importedDir: string,
  id: string,
): Promise<boolean> {
  if (live(id)) return true;
  const here = [importedDir];
  for (const root of projectsDirs)
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => []))
      if (entry.isDirectory()) here.push(join(root, entry.name));
  for (const dir of here)
    if ((await stat(join(dir, `${id}.jsonl`)).catch(() => null)) !== null) return true;
  return false;
}

/** The transcript for `id` from the first of `dirs` that holds it, folded ready to seed a session. */
async function firstTranscript(dirs: string[], id: string): Promise<FoldedTranscript | undefined> {
  for (const dir of dirs) {
    const folded = await readTranscript({}, join(dir, `${id}.jsonl`));
    if (folded !== undefined) return folded;
  }
  return undefined;
}

/** Same id opened twice at once (double click, two tabs) shares one creation. */
function openTranscript(
  ctx: RouteHost,
  dirs: string[],
  cwd: string,
  id: string,
  claudeIdOf: (id: string) => string,
  registry: WorkspaceRegistry | undefined,
): Promise<Opened> {
  let job = opening.get(id);
  if (!job) {
    job = openTranscriptOnce(ctx, dirs, cwd, id, claudeIdOf, registry).finally(() =>
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
export async function openTranscriptOnce(
  ctx: RouteHost,
  dirs: string[],
  cwd: string,
  id: string,
  claudeIdOf: (id: string) => string,
  registry: WorkspaceRegistry | undefined,
): Promise<Opened> {
  // dsh 0.1.5 lists a session under a workspace only once it is on that workspace's own
  // `sessionIds`; a session that merely exists (older dsh derived the workspace from its cwd)
  // shows "Show" in the archive but opens nowhere. Attach after the log is written, since dsh
  // validates the stored header's cwd against the workspace path. Idempotent, so an already-open
  // session from before this ran is attached on its next Open.
  // `sessionId` is dsh's id for the session. A row's `id` is the transcript's, which differs
  // for a session the plugin started (see `claudeIdOf`), and dsh knows only its own.
  const attach = async (sessionId: string) => {
    if (!registry) return;
    const ws = (await registry.resolveByPath(cwd)) ?? (await registry.create(cwd));
    await ws.attachSession(asSessionId(sessionId));
  };
  // ponytail: unarchive through the registry's own operation queue; dsh core has archiveSession
  // but no inverse, so the state edit goes through the queue that owns it. Every path that opens a
  // row runs it: an archived session the store still holds took the early return below and stayed
  // archived, and the client hides archived sessions, so Restore opened nothing.
  const unarchive = async (sessionId: string) => {
    if (
      !registry?.enqueueOperation ||
      !registry.archivedSessionIds.includes(asSessionId(sessionId))
    )
      return;
    await registry.enqueueOperation(async () => {
      const state = registry.requireState();
      await registry.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter((x) => x !== sessionId),
      });
    });
  };
  if (ctx.sessions.get(asSessionId(id))) {
    await unarchive(id);
    await attach(id);
    return { id, existed: true };
  }
  // Owned by id across every workspace, not just this `cwd`: an SSH-box session is stored under a
  // local placeholder cwd, not the transcript's own path, so filtering by `cwd` would miss it and
  // fall through to a local transcript read that ENOENTs (the body lives on the box). `cwd` is only
  // needed for the non-owned read below, where the transcript really is on this box's disk.
  const owned = dshSessionsFor(
    await ctx.sessionPersistence.list(),
    null,
    claudeIdOf,
    new Set(registry?.archivedSessionIds ?? []),
  ).get(id);
  if (owned) {
    await unarchive(owned.id);
    // Persisted but not in the store (a restart unloads it): the workspace list is the only way it
    // reaches the sidebar, and dsh reads its header from persistence, which lists it by now.
    await attach(owned.id);
    return { id: owned.id, existed: true };
  }
  // This PC: the archive lists only local transcripts, so an opened one is always here. An
  // imported one is not under `projects/` at all, which is why the caller passes both dirs.
  const folded = await firstTranscript(dirs, id);
  if (folded === undefined) throw new Error("transcript not found");
  if (folded.turns.length === 0) throw new Error("transcript has no completed turn");
  const seed = toSessionEvents(folded);
  // A session's log reaches disk only through the persistence write handle its creator opens
  // (dsh 0.1.5 does this in the agent-loop creation transaction). The store's own
  // prepare/enter/announce/flush owns no handle, so `session/flush` found no writer for this id and
  // answered nothing: the seed was dropped silently, and the client's adopting `sessions.create`
  // then found no stored session and made a blank one under the same id. Write the log here.
  const handle = await ctx.sessionPersistence.create({
    version: 3,
    id: asSessionId(id),
    createdAt: folded.createdAt,
    cwd,
    isSeeded: false,
  });
  try {
    await handle.append(seed);
    await handle.flush();
  } finally {
    await handle.close();
  }
  await attach(id);
  return { id, existed: false, turns: folded.turns.length, events: seed.length };
}

/** A cwd-scoped read's destination: the box it runs on, and the path to read there. */
interface CwdTarget<T extends string | null> {
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
const claudeHomeOf = async (box: MountBox): Promise<string> =>
  box.sshHost ? `${await homeAt(box)}/.claude` : box.configDir;

/**
 * Where that box keeps a workspace's transcripts and its auto-memory. The same directory the
 * adapter's own `projectDir` names for this PC, resolved against the box's `~/.claude` instead —
 * the cwd is already the remote path, since it is the directory the session runs in.
 */
const projectDirAt = async (box: MountBox, cwd: string): Promise<string> =>
  join(await claudeHomeOf(box), "projects", projectDirName(cwd));

/** Everything the routes need from the adapter. */
export interface SessionRouteOptions {
  log: (level: string, msg: string) => void;
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
  /** The running turn's figures per session, for the status row; absent when no turn is running. */
  liveTurn?: Map<string, LiveTurn>;
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
    info(): { enabled: boolean };
    set(enabled: boolean): Promise<{ enabled: boolean }>;
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
  /** `/btw` side questions and their answers, per session; the client bubble reads them. */
  sideQuestions?: Map<string, AsideEntry[]>;
  /** Sessions whose last turn failed for want of a login, read beside the asides for the card. */
  loginNeeded?: Map<string, LoginNeed>;
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
    info: (sessionId: string) => { tokens: number | null | undefined };
    set: (
      sessionId: string,
      tokens: number | null,
    ) => Promise<{ ok: boolean; tokens: number | null; live: boolean; error?: string }>;
  };
  /** The model catalog for advisor model selection. */
  models?: () => Promise<Array<{ id: string; name: string }>>;
  /** Re-read plugins into a session's live process after a plugin/marketplace mutation, so the
   *  change applies now instead of at the next spawn. `live` is false when there is no process. */
  reloadPlugins?: (sessionId: string) => Promise<{ ok: boolean; live: boolean; error?: string }>;
  /** Whether this plugin waits out a usage limit and continues the turn itself. */
  continueAfterLimit?: boolean;
}

/** The transcript of a dsh session, read from the box it runs on: under its Claude id (sessions the
 *  adapter started) or its own id (sessions restored from a transcript), whichever exists. */
async function sessionTranscript(
  box: MountBox,
  dir: string,
  sessionId: string,
  claudeIdOf: (id: string) => string,
): Promise<FoldedTranscript | undefined> {
  for (const id of [claudeIdOf(sessionId), sessionId]) {
    const folded = await readTranscript(box, join(dir, `${id}.jsonl`));
    if (folded !== undefined) return folded;
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
    importedDir,
    sshBoxesPath,
    onSshBoxes,
    remoteWorkspacesPath,
    onRemoteWorkspaces,
    command,
    sshHost,
    turnRecords,
    liveTurn,
    idle,
    toolMode,
    terminalSync,
    permissionModes,
    thinking,
    rewind,
    contextUsage,
    workspaceDiff,
    mcp,
    permissionAsks,
    sideQuestions,
    loginNeeded,
    loginDone,
    logoutDone,
    liveCount,
    persistAsides,
    starters,
    setStarter,
    models,
    reloadPlugins,
    continueAfterLimit,
    instanceFor,
    instanceForHost,
    onLoginStatus,
  }: SessionRouteOptions,
): void {
  /** The box a request is about: the session's own mount when it named one, else this instance. */
  const boxOf = (url: URL): MountBox =>
    instanceFor?.(url.searchParams.get("provider")) ?? { configDir, command, sshHost };
  /** The remote workspaces, as the routes below last wrote them; seeded from disk at registration. */
  let remoteWorkspaces: RemoteWorkspace[] = [];
  if (remoteWorkspacesPath !== undefined)
    void readRemoteWorkspaces(remoteWorkspacesPath)
      .then((ws) => {
        remoteWorkspaces = ws;
      })
      .catch((e: unknown) => log("warn", `remote workspaces: ${errorText(e)}`));
  /**
   * Where a cwd-scoped read has to run, and under which path.
   *
   * A remote workspace's dsh cwd is an empty local placeholder dir; its CLAUDE.md files, transcripts,
   * memory and project settings all live on its box, under the real remote path, which is also where
   * the turn runs whichever model is selected (adapter's `boxFor`). Reading them through the named
   * provider at the placeholder path answered about this PC and about a directory nothing uses: an
   * Instructions tab listing the owner's own `~/CLAUDE.md`, a Memory tab pointing at a project dir
   * slugged from the placeholder. Any other cwd is this request's own mount at its own path.
   */
  const workspaceAt = (cwd: string | null): RemoteWorkspace | undefined =>
    cwd === null ? undefined : remoteWorkspaces.find((w) => w.path === cwd);
  /** That workspace's own transcripts on its box, newest first; an unreachable box lists nothing. */
  const boxTranscripts = async (
    ws: RemoteWorkspace,
    hidden: Set<string>,
  ): Promise<TranscriptListItem[]> => {
    const r = await sshTranscripts(ws.host);
    if (!r.ok) {
      log("warn", `transcripts on ${ws.host}: ${r.error}`);
      return [];
    }
    return r.sessions.filter((t) => t.cwd === ws.remoteCwd && !hidden.has(t.id));
  };
  /**
   * Bring a remote workspace's transcript to this disk so `open` can seed a dsh session from it.
   * The body lives on the box, dsh reads the seed from here, and the plugin's import dir is already
   * one of the directories `open` looks in. A box that cannot be read leaves the open to fall
   * through to whatever is on this disk, which is what it did before.
   */
  const cacheBoxTranscript = async (ws: RemoteWorkspace, id: string): Promise<void> => {
    if (importedDir === undefined) return;
    const box = instanceForHost?.(ws.host) ?? { configDir, command, sshHost: ws.host };
    const path = join(await projectDirAt(box, ws.remoteCwd), `${id}.jsonl`);
    const read = await readAt(box, path).catch(() => null);
    if (read === null) return;
    await mkdir(importedDir, { recursive: true });
    await writeFile(join(importedDir, `${id}.jsonl`), read.text, "utf8");
  };
  const targetOf = <T extends string | null>(url: URL, cwd: T): CwdTarget<T> => {
    const ws = workspaceAt(cwd);
    if (ws === undefined) return { box: boxOf(url), cwd };
    const box = instanceForHost?.(ws.host) ?? { configDir, command, sshHost: ws.host };
    // SAFETY: a workspace is only ever found for a non-null cwd, so T is string on this branch.
    return { box, cwd: ws.remoteCwd as T };
  };
  /**
   * Where a transcript for this workspace can be: Claude's own project dir, then the plugin's
   * import dir. An imported file is deliberately not written into `projects/`, so every read that
   * takes an id has to look in both.
   */
  const transcriptDirs = (cwd: string): string[] =>
    importedDir === undefined ? projectDir(cwd) : [...projectDir(cwd), importedDir];
  /**
   * Where that box keeps the user-scope settings file. A mount's `configDir` is resolved against
   * this PC's home, so a remote box's path has to come from its own `$HOME` (asked once per host);
   * the project and local scopes hang off the session's cwd, which is already the remote path.
   */
  const userSettingsPathOf = async (box: MountBox): Promise<string | undefined> =>
    box.sshHost ? `${await claudeHomeOf(box)}/settings.json` : settingsPath;
  // Optional: stock dsh has it; without it archived sessions list but cannot be restored. The
  // routes can serve before it mounts — a request in the first seconds after a restart found no
  // registry and skipped the workspace attach silently, so the session it had just written was
  // nowhere in the sidebar — hence the live `get` alongside the injected handle.
  let injectedRegistry: WorkspaceRegistry | undefined;
  ctx.inject?.(["workspaceRegistry"], (host) => {
    injectedRegistry = host.workspaceRegistry;
  });
  const workspaceRegistry = (): WorkspaceRegistry | undefined =>
    injectedRegistry ?? ctx.get?.("workspaceRegistry");
  ctx.inject?.(["webServer", "connection", "sessions", "sessionPersistence"], (host) => {
    const { webServer, connection, sessions, sessionPersistence } = host;
    if (!webServer || !connection || !sessionPersistence) return;
    const routeHost: RouteHost = { webServer, connection, sessions, sessionPersistence };
    // Shared by the plugin-manager routes: check the scope and resolve the session's directory,
    // which is where a `project` or `local` write lands (a `user` write goes to configDir).
    const pluginScopeCwd = async (
      scope: unknown,
      session: JsonValue | undefined,
    ): Promise<{ cwd: string | undefined } | { error: string }> => {
      if (!isPluginScope(scope)) return { error: "scope is user, project or local" };
      const cwd = await sessionCwd(session, sessionPersistence);
      if (pluginScopeNeedsCwd(scope) && cwd === null)
        return { error: `${scope} scope needs a session open in a directory` };
      return { cwd: cwd ?? undefined };
    };
    // Every `claude plugin` and `claude mcp` mutation below runs this instance's binary against
    // this instance's config dir, while the rosters they act on are read from the session's own
    // box. On a session running over ssh that pairing writes this PC and leaves the box alone —
    // the roster then re-reads remote and still shows the old state, so the panel reports nothing
    // happened while the wrong machine changed. Refuse instead, until the verbs run over ssh.
    // The cwd matters as much as the named provider: a remote workspace's directory is on its box
    // whichever model the session runs, so a local mount would happily run the verb here, against a
    // placeholder dir, and report success for a box that never changed.
    const notOnBox = (url: URL, what: string, cwd: string | null = null): string | undefined =>
      targetOf(url, cwd).box.sshHost ? `${what} do not reach an SSH box yet` : undefined;
    // The CLI wrote the plugin change to settings; ask this session's live process to re-read it so
    // it applies now. Returns whether a live process took it — false (next spawn) when none is up.
    const applyReload = async (session: JsonValue | undefined): Promise<boolean> => {
      if (!reloadPlugins || typeof session !== "string") return false;
      return (await reloadPlugins(session)).live;
    };
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
                    new Set(workspaceRegistry()?.archivedSessionIds ?? []),
                  );
                  const hidden = new Set([...(await startedIds())].filter((id) => !owned.has(id)));
                  const found = [
                    ...(await listAllTranscripts(projectsDir, hidden)),
                    // Imported ones live outside `projects/`, and say so, so a row that came from
                    // another box is not mistaken for one this CLI ran.
                    ...(importedDir
                      ? (await listTranscripts(importedDir, hidden)).map((s) => ({
                          ...s,
                          imported: true,
                        }))
                      : []),
                  ];
                  const items = withoutSubagents(
                    found.map((s) => {
                      const d = owned.get(s.id);
                      return d ? { ...s, dsh: d } : s;
                    }),
                  );
                  return json(res, 200, { host: hostname(), sessions: items });
                }
                // Transcripts of dsh sessions (started here or opened from here) are listed with
                // their dsh id so the panel opens the existing session. Ones the adapter started
                // for a dsh session that no longer exists are hidden.
                const owned = dshSessionsFor(
                  await sessionPersistence.list(),
                  cwd,
                  claudeIdOf,
                  new Set(workspaceRegistry()?.archivedSessionIds ?? []),
                );
                const hidden = new Set([...(await startedIds())].filter((id) => !owned.has(id)));
                // A remote workspace ran its turns on its box, so that is where its transcripts are;
                // the box lister answers for the whole box and the real remote path picks this
                // workspace's out. Locally there is only the empty placeholder dir.
                const ws = workspaceAt(cwd);
                const seen = ws
                  ? [await boxTranscripts(ws, hidden)]
                  : await Promise.all(
                      projectDir(cwd).map((dir) => listTranscripts(dir, hidden).catch(() => [])),
                    );
                const items = withoutSubagents(
                  seen.flat().map((s) => {
                    const d = owned.get(s.id);
                    return d ? { ...s, dsh: d } : s;
                  }),
                );
                return json(res, 200, { sessions: items });
              }
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/open`) {
                const { cwd, id } = await readBody(req);
                if (!validCwd(cwd) || !validId(id))
                  return json(res, 400, { error: "cwd and id required" });
                const onBox = workspaceAt(cwd);
                if (onBox !== undefined) await cacheBoxTranscript(onBox, id);
                return json(
                  res,
                  200,
                  await openTranscript(
                    routeHost,
                    transcriptDirs(cwd),
                    cwd,
                    id,
                    claudeIdOf,
                    workspaceRegistry(),
                  ),
                );
              }
              // Export: the transcript exactly as it sits on disk, so a re-import is byte-identical.
              // It follows the session's own box, which is how a row from an SSH box downloads.
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/transcript`) {
                const id = url.searchParams.get("id");
                const cwd = url.searchParams.get("cwd") ?? "";
                if (!validId(id)) return json(res, 400, { error: "id required" });
                const { box, cwd: at } = targetOf(url, cwd);
                const dirs = box.sshHost
                  ? [join(await projectDirAt(box, at), `${id}.jsonl`)]
                  : transcriptDirs(at).map((d) => join(d, `${id}.jsonl`));
                for (const path of dirs) {
                  const read = await readAt(box, path);
                  if (read === null) continue;
                  res.writeHead(200, {
                    "content-type": "application/x-ndjson; charset=utf-8",
                    "content-disposition": `attachment; filename="${id}.jsonl"`,
                    "cache-control": "no-store",
                  });
                  res.end(read.text);
                  return;
                }
                return json(res, 404, { error: "transcript not found" });
              }
              // Import: a transcript file from anywhere lands in the plugin's own state dir under a
              // free id, and the merged list picks it up. `projects/` is left alone on purpose —
              // the CLI owns that directory, and a foreign session has no cwd it ever ran in.
              if (
                importedDir &&
                req.method === "POST" &&
                url.pathname === `${ROUTE_PREFIX}/import`
              ) {
                const body = await readBody(req, IMPORT_LIMIT);
                if (typeof body.text !== "string" || body.text.trim() === "")
                  return json(res, 400, { error: "text required" });
                const folded = foldTranscript(body.text);
                if (folded.turns.length === 0)
                  return json(res, 400, { error: "not a Claude Code transcript" });
                // An id that is already here would overwrite a live session's record, so a clash
                // takes a fresh one; the transcript's own records keep the original inside.
                const wanted = validId(body.id) ? body.id : idIn(body.text);
                const free =
                  wanted !== undefined &&
                  !(await idTaken(
                    (x) => routeHost.sessions.get(asSessionId(x)) !== undefined,
                    projectsDir,
                    importedDir,
                    wanted,
                  ))
                    ? wanted
                    : randomUUID();
                await mkdir(importedDir, { recursive: true });
                await writeFile(join(importedDir, `${free}.jsonl`), body.text, "utf8");
                log("info", `imported transcript ${free} (${folded.turns.length} turns)`);
                return json(res, 200, { ok: true, id: free, turns: folded.turns.length });
              }
              // Claude's auto-memory for a workspace: list, read, write, delete one file.
              if (url.pathname === `${ROUTE_PREFIX}/memory`) {
                const body = req.method === "GET" ? {} : await readBody(req, 1024 * 1024);
                const cwd = await knownCwd(
                  url.searchParams.get("cwd") ?? body.cwd,
                  sessionPersistence,
                );
                if (cwd === null)
                  return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                  });
                const { box, cwd: at } = targetOf(url, cwd);
                const dir = join(await projectDirAt(box, at), "memory");
                const name = url.searchParams.get("name") ?? body.name;
                if (req.method === "GET" && name === undefined)
                  return json(res, 200, { dir, files: await listMemory(box, dir) });
                if (!validMemoryName(name))
                  return json(res, 400, { error: "name must be a .md file" });
                const path = join(dir, name);
                if (req.method === "GET") {
                  // No catch: a box that cannot be reached is a 500 the tab shows, not a 404 that
                  // opens the memory blank for the next Save to write over.
                  const read = await readAt(box, path);
                  return read === null
                    ? json(res, 404, { error: "not found" })
                    : json(res, 200, { text: read.text });
                }
                if (req.method === "PUT") {
                  if (typeof body.text !== "string")
                    return json(res, 400, { error: "text required" });
                  await writeAt(box, path, body.text);
                  log("info", `memory ${name} saved (${body.text.length} chars)`);
                  return json(res, 200, { ok: true });
                }
                if (req.method === "DELETE") {
                  await deleteMemory(box, dir, name);
                  log("info", `memory ${name} deleted`);
                  return json(res, 200, { ok: true });
                }
                return json(res, 405, { error: "method not allowed" });
              }
              // Instructions: the CLAUDE.md files the CLI loads for this workspace. The list is
              // recomputed per request and is the allowlist: a path it does not name is refused,
              // so the browser cannot read or write a file outside the hierarchy.
              // The skills the CLI can reach for the session's directory, with their scope, read
              // from the box the session runs on. One listing per tab open; nothing polls.
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/skills`) {
                const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
                if (cwd === null)
                  return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                  });
                const { box, cwd: at } = targetOf(url, cwd);
                return json(res, 200, {
                  skills: await listSkills(at, await claudeHomeOf(box), box),
                });
              }
              // The servers the CLI is configured with for the session's directory, by scope, from
              // the config files rather than `claude mcp list` (which connects to each one).
              if (
                req.method === "GET" &&
                url.pathname === `${ROUTE_PREFIX}/mcp-servers/configured`
              ) {
                const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
                if (cwd === null)
                  return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                  });
                const { box, cwd: at } = targetOf(url, cwd);
                // Where that instance's CLI keeps .claude.json: inside an exported config dir,
                // else beside the home's .claude, the same rule cliEnvFor applies to the calls.
                const claudeJson = cliEnvFor(box.configDir).CLAUDE_CONFIG_DIR
                  ? join(box.configDir, ".claude.json")
                  : join(await homeAt(box), ".claude.json");
                return json(res, 200, { servers: await listConfiguredMcp(at, claudeJson, box) });
              }
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
                const { box, cwd: at } = targetOf(url, cwd);
                const files = await listInstructions(at, await claudeHomeOf(box), box);
                if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/instructions`)
                  return json(res, 200, { files });

                const path = req.method === "GET" ? url.searchParams.get("path") : body.path;
                const file = files.find((f) => f.path === path);
                if (file === undefined)
                  return json(res, 400, { error: "not a loaded instructions file" });

                if (req.method === "GET") {
                  // No catch: a box that cannot be reached is a 500 the editor shows, not a 404
                  // that opens the file blank for the next save to write over.
                  const read = await readAt(box, file.path);
                  return read === null
                    ? json(res, 404, { error: "not found" })
                    : json(res, 200, { path: file.path, text: read.text, mtime: read.mtimeMs });
                }
                if (req.method === "PUT") {
                  if (file.kind === "Managed")
                    return json(res, 403, { error: "the managed file is read-only" });
                  if (!isWritableInstructions(file.path))
                    return json(res, 403, {
                      error: "only markdown instructions files are editable",
                    });
                  if (typeof body.text !== "string")
                    return json(res, 400, { error: "text required" });
                  const written = await writeWithBackup(box, file.path, body.text, mtimeOf(body));
                  log("info", `instructions ${file.path} saved (${body.text.length} chars)`);
                  return json(res, 200, written);
                }
                return json(res, 405, { error: "method not allowed" });
              }
              if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings`) {
                const box = boxOf(url);
                const userPath = (await userSettingsPathOf(box)) ?? settingsPath;
                if (req.method === "GET") return json(res, 200, await readSettings(box, userPath));
                if (req.method === "PUT") {
                  const body = await readBody(req, 1024 * 1024);
                  const text = body.text;
                  const scope = body.scope ?? "user";
                  if (!isSettingsScope(scope))
                    return json(res, 400, { error: "unknown settings scope" });
                  if (scope === "managed")
                    return json(res, 400, { error: "managed settings are read-only" });
                  const cwd = await knownCwd(body.cwd, sessionPersistence);
                  // A project or local write lands in the session's own directory, so it goes to the
                  // box that directory is on: a remote workspace's path is real over there and the
                  // write is an ssh write like any other. Any other session on a box still has a
                  // local cwd that need not exist there, which is what this refuses.
                  const target = targetOf(url, cwd);
                  const onWorkspace = workspaceAt(cwd) !== undefined;
                  if (target.box.sshHost && scope !== "user" && !onWorkspace)
                    return json(res, 400, {
                      error: "project and local settings do not reach an SSH box yet",
                    });
                  const path = settingsScopePath(scope, userPath, target.cwd);
                  if (path === undefined)
                    return json(res, 400, {
                      error: "project and local settings need a directory a dsh session is open in",
                    });
                  const parsed = parseSettingsText(text);
                  if (parsed.error !== undefined) return json(res, 400, { error: parsed.error });
                  const settingsText = typeof text === "string" ? text : "";
                  const written = await writeWithBackup(
                    scope === "user" ? box : target.box,
                    path,
                    settingsText,
                    mtimeOf(body),
                  );
                  log("info", `${scope} settings saved (${settingsText.length} chars)`);
                  return json(res, 200, written);
                }
              }
              // Every scope the CLI merges, in one payload: the editor picks which to show and
              // works out from the rest which keys a higher-precedence file overrides.
              if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings/scopes`) {
                if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
                // Project and local scope hang off the session's directory, which for a remote
                // workspace is its real path on its box; user scope stays with the named mount.
                const { box, cwd } = targetOf(
                  url,
                  await knownCwd(url.searchParams.get("cwd"), sessionPersistence),
                );
                const userPath = (await userSettingsPathOf(box)) ?? settingsPath;
                const scopes: SettingsScopeInfo[] = [];
                for (const scope of SETTINGS_SCOPES) {
                  const path = settingsScopePath(scope, userPath, cwd);
                  if (path === undefined) continue;
                  // An unreadable managed file (root-owned, or a directory) reads as absent
                  // rather than failing the whole payload. Every other scope answers with the
                  // failure: an editor shown "not created yet" for a file that is merely out of
                  // reach saves an empty object over it the moment the box comes back.
                  const file = await readSettings(box, path).catch((e: unknown) => {
                    if (scope !== "managed") throw e;
                    return { path, exists: false, text: "{}\n", mtime: 0 };
                  });
                  scopes.push({ ...file, scope, readOnly: scope === "managed" });
                }
                return json(res, 200, { scopes });
              }
              // Which plugins and marketplaces the session's settings load. Beside Instructions in
              // the panel: same question as the CLAUDE.md list, a different set of files.
              if (settingsPath && url.pathname === `${ROUTE_PREFIX}/plugins`) {
                if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
                const { box, cwd } = targetOf(
                  url,
                  await knownCwd(url.searchParams.get("cwd"), sessionPersistence),
                );
                return json(res, 200, {
                  ok: true,
                  ...pluginRoster(
                    await settingsTexts(box, (await userSettingsPathOf(box)) ?? settingsPath, cwd),
                  ),
                });
              }
              // Turn the roster into a manager. The CLI owns the mutation end to end (it resolves
              // the marketplace, writes both the settings key and the install lock, and validates
              // the plugin), the same way the MCP tab shells out per session cwd with a scope. Each
              // write targets the scope the roster row named, then `applyReload` asks the session's
              // live process to re-read plugins so the change applies now instead of at next spawn.
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/plugins/toggle`) {
                const body = await readBody(req);
                if (!isPluginId(body.key)) return json(res, 400, { error: "plugin id required" });
                const target = await pluginScopeCwd(body.scope, body.session);
                if ("error" in target) return json(res, 400, { error: target.error });
                const remote = notOnBox(url, "plugin changes", target.cwd ?? null);
                if (remote) return json(res, 400, { error: remote });
                const verb = body.enable === false ? "disable" : "enable";
                const result = await run(
                  command || "claude",
                  ["plugin", verb, body.key, "--scope", String(body.scope)],
                  cliEnvFor(configDir),
                  target.cwd,
                );
                if (result.error) return json(res, 400, { error: result.error });
                log("info", `plugin ${body.key} ${verb}d (${String(body.scope)})`);
                return json(res, 200, { ok: true, live: await applyReload(body.session) });
              }
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/plugins/uninstall`) {
                const body = await readBody(req);
                if (!isPluginId(body.key)) return json(res, 400, { error: "plugin id required" });
                const target = await pluginScopeCwd(body.scope, body.session);
                if ("error" in target) return json(res, 400, { error: target.error });
                const remote = notOnBox(url, "plugin changes", target.cwd ?? null);
                if (remote) return json(res, 400, { error: remote });
                // -y is required when stdout is not a TTY, which it never is here.
                const result = await run(
                  command || "claude",
                  ["plugin", "uninstall", body.key, "--scope", String(body.scope), "-y"],
                  cliEnvFor(configDir),
                  target.cwd,
                );
                if (result.error) return json(res, 400, { error: result.error });
                log("info", `plugin ${body.key} uninstalled (${String(body.scope)})`);
                return json(res, 200, { ok: true, live: await applyReload(body.session) });
              }
              // Marketplace add resolves a URL, path or GitHub repo, which can clone over the
              // network, so it gets a longer timeout than the local settings writes.
              if (
                req.method === "POST" &&
                url.pathname === `${ROUTE_PREFIX}/plugins/marketplace/add`
              ) {
                const body = await readBody(req);
                if (!isMarketplaceSource(body.source))
                  return json(res, 400, {
                    error: "a source is a URL, a path or a GitHub owner/repo",
                  });
                const target = await pluginScopeCwd(body.scope, body.session);
                if ("error" in target) return json(res, 400, { error: target.error });
                const remote = notOnBox(url, "plugin changes", target.cwd ?? null);
                if (remote) return json(res, 400, { error: remote });
                const result = await run(
                  command || "claude",
                  [
                    "plugin",
                    "marketplace",
                    "add",
                    body.source.trim(),
                    "--scope",
                    String(body.scope),
                  ],
                  cliEnvFor(configDir),
                  target.cwd,
                  60000,
                );
                if (result.error) return json(res, 400, { error: result.error });
                log("info", `marketplace added (${String(body.scope)})`);
                return json(res, 200, { ok: true, live: await applyReload(body.session) });
              }
              if (
                req.method === "POST" &&
                url.pathname === `${ROUTE_PREFIX}/plugins/marketplace/remove`
              ) {
                const body = await readBody(req);
                if (!isPluginId(body.name))
                  return json(res, 400, { error: "marketplace name required" });
                const target = await pluginScopeCwd(body.scope, body.session);
                if ("error" in target) return json(res, 400, { error: target.error });
                const remote = notOnBox(url, "plugin changes", target.cwd ?? null);
                if (remote) return json(res, 400, { error: remote });
                const result = await run(
                  command || "claude",
                  ["plugin", "marketplace", "remove", body.name, "--scope", String(body.scope)],
                  cliEnvFor(configDir),
                  target.cwd,
                );
                if (result.error) return json(res, 400, { error: result.error });
                log("info", `marketplace ${body.name} removed (${String(body.scope)})`);
                return json(res, 200, { ok: true, live: await applyReload(body.session) });
              }
              // The settings and environment that turn off something the panel offers. Its own
              // route rather than a field on diagnostics: the shield and Rewind ask for it on
              // every open, and diagnostics runs the binary.
              if (settingsPath && url.pathname === `${ROUTE_PREFIX}/feature-switches`) {
                if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
                const { box, cwd } = targetOf(
                  url,
                  await knownCwd(url.searchParams.get("cwd"), sessionPersistence),
                );
                const texts = await settingsTexts(
                  box,
                  (await userSettingsPathOf(box)) ?? settingsPath,
                  cwd,
                );
                // The child inherits dsh's environment, so dsh's is where the disable would be.
                // An absent option means an adapter that did not pass one, so read the config
                // default rather than reporting the feature off.
                return json(res, 200, {
                  ok: true,
                  ...featureSwitches(texts, process.env, continueAfterLimit ?? true),
                });
              }
              /** A box's status as the panel shows it: the CLI probes, the npm read beside them
               *  (this box only; a remote box reports its own plugin from its own copy), and a
               *  panel token counted as a login, since the CLI's own `auth status` cannot see the
               *  token the default instance injects at spawn. */
              const boxStatus = async (box: MountBox, provider: string | null) => {
                const [status, upd] = await Promise.all([
                  runtimeStatus(box.configDir, box.command, box.sshHost),
                  box.sshHost || !sshBoxesPath
                    ? undefined
                    : pluginUpdate(join(dirname(sshBoxesPath), "hints.json")),
                ]);
                if (upd) Object.assign(status, upd);
                status.running = liveCount?.(box.sshHost ?? "") ?? 0;
                if (
                  !box.sshHost &&
                  (provider === null || provider === DEFAULT_PROVIDER) &&
                  sshBoxesPath &&
                  readSshToken(dirname(sshBoxesPath), THIS_BOX)
                ) {
                  status.loggedIn = true;
                  status.authMethod = PANEL_TOKEN;
                }
                return status;
              };
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/status`) {
                const box = boxOf(url);
                const provider = url.searchParams.get("provider");
                const status = await boxStatus(box, provider);
                onLoginStatus?.(provider, status.loggedIn);
                return json(res, 200, status);
              }
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
                const { box, cwd } = targetOf(
                  url,
                  await knownCwd(url.searchParams.get("cwd"), sessionPersistence),
                );
                const runtime = await boxStatus(box, url.searchParams.get("provider"));
                const configFiles: DiagnosticFile[] = [];
                const userPath = await userSettingsPathOf(box);
                for (const scope of SETTINGS_SCOPES) {
                  const path = userPath ? settingsScopePath(scope, userPath, cwd) : undefined;
                  if (path === undefined) continue;
                  // A file that cannot be read at all reads as absent, the way the scopes route
                  // treats a root-owned managed file: the payload is a report, not a failure.
                  const file = await readSettings(box, path).catch(() => null);
                  const entry: DiagnosticFile = { scope, path, exists: file?.exists ?? false };
                  const parsed = file?.exists === true ? parseSettingsText(file.text) : undefined;
                  if (parsed?.error !== undefined) entry.parseError = parsed.error;
                  configFiles.push(entry);
                }
                // `ok` is what the tab keys its render on; without it the reply reads as the
                // failure shape and the tab draws an empty error line instead of the report.
                return json(res, 200, { ok: true, runtime, configFiles });
              }
              // `claude doctor` runs a process and takes a second, so it is its own route and
              // nothing runs it until the button is pressed.
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/diagnostics/doctor`) {
                const box = boxOf(url);
                const bin = box.command || "claude";
                // The doctor belongs to the box the session runs on, the same as the status probe:
                // this PC's answer says nothing about a remote box's install.
                return json(
                  res,
                  200,
                  box.sshHost
                    ? await run("ssh", sshArgs(box.sshHost, `${shq(bin)} doctor`))
                    : await run(bin, ["doctor"], cliEnvFor(box.configDir)),
                );
              }
              // The running turn's figures for the status row; `{}` when no turn is running.
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/live-turn`) {
                const sid = url.searchParams.get("session");
                if (!sid) return json(res, 400, { error: "session param required" });
                // `tokens` is one climbing figure for the turn: finished messages plus the estimate for
                // the thinking block in progress, which the next usage frame folds in for real.
                const live = liveTurn?.get(sid);
                if (!live) return json(res, 200, {});
                // `thinkingMs` is how long the open thinking burst has run, absent when none is open;
                // `idleMs` is the time since the last frame of model output; `tool` says a call is
                // in flight. The client turns these into the CLI's own colour ramps.
                const now = Date.now();
                const open = live.thinkingOpen === true && live.thinkingAt !== undefined;
                return json(res, 200, {
                  tokens: (live.output ?? 0) + (live.thinking ?? 0),
                  thinkingMs: open ? now - live.thinkingAt! : undefined,
                  idleMs: live.frameAt !== undefined ? now - live.frameAt : undefined,
                  tool: live.tool === true,
                  thoughtMs: live.thoughtMs,
                  thoughtAgoMs: live.thoughtAt !== undefined ? now - live.thoughtAt : undefined,
                  effort: live.effort,
                });
              }
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
              // The starter card's store: a session's own opening prompt and the `default` one it
              // falls back to. A POST with blank text clears the key, which is how the card's
              // "forget" works.
              // One-time hints (the Restore pulse) and box-wide UI switches (`starterOff`): a flat
              // map of booleans under the plugin's state, so a hint shown once or a switch flipped on
              // this box holds for every browser and every update. `false` drops the key.
              if (sshBoxesPath && url.pathname === `${ROUTE_PREFIX}/hints`) {
                const hintsPath = join(dirname(sshBoxesPath), "hints.json");
                const current = await readHints(hintsPath);
                if (req.method === "GET") return json(res, 200, current);
                if (req.method === "POST") {
                  const body = await readBody(req);
                  const next = { ...current };
                  for (const [k, v] of Object.entries(body)) {
                    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k)) continue;
                    if (v === true) next[k] = true;
                    else if (v === false) delete next[k];
                  }
                  await writeFile(hintsPath, `${JSON.stringify(next, null, 2)}\n`);
                  return json(res, 200, next);
                }
              }
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/starter`) {
                const sid = url.searchParams.get("session");
                if (!sid) return json(res, 400, { error: "session param required" });
                return json(res, 200, {
                  session: starters?.get(sid) ?? "",
                  fallback: starters?.get("default") ?? "",
                });
              }
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/starter`) {
                const body = await readBody(req);
                const sid = String(body.session ?? "");
                if (!sid) return json(res, 400, { error: "session required" });
                const text = String(body.text ?? "");
                setStarter?.(sid, text);
                // A saved opener is also the default for the next new session; that is what makes a
                // brand-new tab, which has no key of its own yet, show anything at all.
                if (body.asDefault !== false) setStarter?.("default", text);
                return json(res, 200, { ok: true });
              }
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/side-questions`) {
                const sid = url.searchParams.get("session");
                if (!sid) return json(res, 400, { error: "session param required" });
                const items: AsideEntry[] = sideQuestions?.get(sid) ?? [];
                return json(res, 200, { items, loginNeeded: loginNeeded?.get(sid) ?? null });
              }
              // Dismiss is server-side so a closed card stays closed: a client-only hide is lost on the
              // next remount and the entry, still in the ring, would poll back into view. It marks
              // rather than deletes — the answer stays readable in the panel's Asides tab, which is
              // the point of persisting asides at all; the bubble is what the user closed, not the
              // record.
              if (
                req.method === "POST" &&
                url.pathname === `${ROUTE_PREFIX}/side-questions/dismiss`
              ) {
                const body = await readBody(req);
                const sid = String(body.session ?? "");
                const id = String(body.id ?? "");
                if (!sid || !id) return json(res, 400, { error: "session and id required" });
                const entry = sideQuestions?.get(sid)?.find((e) => e.id === id);
                if (entry) {
                  entry.dismissed = true;
                  persistAsides?.(sid);
                }
                return json(res, 200, { ok: true });
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
                const remote = notOnBox(url, "MCP server changes", cwd);
                if (remote) return json(res, 400, { error: remote });
                if (scopeNeedsCwd(built.scope) && cwd === null)
                  return json(res, 400, {
                    error: `${built.scope} scope needs a session open in a directory`,
                  });
                const result = await run(
                  command || "claude",
                  ["mcp", "add-json", built.name, JSON.stringify(built.json), "-s", built.scope],
                  cliEnvFor(configDir),
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
                const remote = notOnBox(url, "MCP server changes", cwd);
                if (remote) return json(res, 400, { error: remote });
                if (cwd === null)
                  return json(res, 400, { error: "no session open in a directory" });
                const result = await run(
                  command || "claude",
                  ["mcp", "remove", body.name],
                  cliEnvFor(configDir),
                  cwd,
                );
                if (result.error) return json(res, 400, { error: result.error });
                log("info", `mcp server ${body.name} removed`);
                return json(res, 200, { ok: true });
              }
              // Tool activity: inline text (the default) or dsh's native rows. The Tune tab reads
              // it on open; a PUT takes effect on the next turn, no restart. Rows stay refused while
              // the running dsh will not load a log holding them, and the reason rides along.
              if (toolMode && url.pathname === `${ROUTE_PREFIX}/tool-mode`) {
                if (req.method === "GET") return json(res, 200, await toolMode.info());
                if (req.method === "PUT") {
                  const { mode } = await readBody(req);
                  if (mode !== "inline" && mode !== "rows")
                    return json(res, 400, { error: "mode must be inline or rows" });
                  return json(res, 200, await toolMode.set(mode));
                }
                return json(res, 405, { error: "method not allowed" });
              }
              // Terminal sync: whether terminal /resume exchanges mirror into the dsh session. The
              // Tune tab reads it on open; a PUT takes effect at once, no restart.
              if (terminalSync && url.pathname === `${ROUTE_PREFIX}/terminal-sync`) {
                if (req.method === "GET") return json(res, 200, terminalSync.info());
                if (req.method === "PUT") {
                  const { enabled } = await readBody(req);
                  if (typeof enabled !== "boolean")
                    return json(res, 400, { error: "enabled must be a boolean" });
                  return json(res, 200, await terminalSync.set(enabled));
                }
                return json(res, 405, { error: "method not allowed" });
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
                const { box, cwd: at } = targetOf(url, cwd);
                const folded = await sessionTranscript(
                  box,
                  await projectDirAt(box, at),
                  sid,
                  claudeIdOf,
                );
                if (folded === undefined) return json(res, 200, { prompts: [] });
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
              if (thinking && url.pathname === `${ROUTE_PREFIX}/thinking`) {
                if (req.method === "GET") {
                  const sid = url.searchParams.get("session");
                  if (!sid) return json(res, 400, { error: "session param required" });
                  return json(res, 200, thinking.info(sid));
                }
                if (req.method === "PUT") {
                  const { session: sid, tokens } = await readBody(req);
                  if (typeof sid !== "string" || !sid)
                    return json(res, 400, { error: "session required" });
                  if (
                    tokens !== null &&
                    (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens < 0)
                  )
                    return json(res, 400, {
                      error: "tokens must be a non-negative integer or null",
                    });
                  return json(res, 200, await thinking.set(sid, tokens));
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
              if (sshBoxesPath && url.pathname === `${ROUTE_PREFIX}/ssh-boxes`) {
                if (req.method === "GET")
                  return json(res, 200, { boxes: await readSshBoxes(sshBoxesPath) });
                if (req.method === "PUT") {
                  const v = validateSshBoxes((await readBody(req)).boxes);
                  if (v.error !== undefined) return json(res, 400, { error: v.error });
                  await writeFile(sshBoxesPath, `${JSON.stringify(v.boxes, null, 2)}\n`, "utf8");
                  // Mount or withdraw the provider instances so the picker matches the saved list
                  // without a dsh restart; a mount failure is reported, the file already saved.
                  let live = true;
                  try {
                    await onSshBoxes?.(v.boxes);
                  } catch (e) {
                    live = false;
                    log("warn", `ssh-boxes reconcile: ${errorText(e)}`);
                  }
                  return json(res, 200, { boxes: v.boxes, live });
                }
              }
              // The Tailscale peers this box can see, for the add form: none when tailscale is not
              // installed or not running, which is not an error, just no picker.
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/tailscale/peers`) {
                const r = await run("tailscale", ["status", "--json"], undefined, undefined, 5000);
                return json(res, 200, { peers: r.error ? [] : tailscalePeers(r.out) });
              }
              // This node's tailnet state (or a box's, over ssh, with ?host=): installed, logged in,
              // who it is, and its peers. Not installed is a state, not an error.
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/tailscale/status`) {
                const boxHost = url.searchParams.get("host") ?? "";
                const r = boxHost
                  ? await run(
                      "ssh",
                      sshArgs(boxHost, "tailscale status --json"),
                      undefined,
                      undefined,
                      12_000,
                    )
                  : await run("tailscale", ["status", "--json"], undefined, undefined, 5000);
                const parsed = r.error ? undefined : tailscaleStatus(r.out);
                if (!parsed)
                  return json(res, 200, {
                    installed: !/not found|ENOENT|no such file/i.test(r.error ?? ""),
                    state: "NoState",
                    loggedIn: false,
                    peers: [],
                    error: r.error?.split(/\r?\n/).at(-1),
                  });
                return json(res, 200, { installed: true, ...parsed });
              }
              // Join the tailnet from here (or a box, with {host}): `tailscale login` prints an
              // approval link and waits; the link is answered as soon as it appears and the command
              // is left running until the browser approves. Prefs need root, so passwordless sudo
              // is tried first, then the operator path; a refusal names the terminal command.
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/tailscale/login`) {
                const body = await readBody(req);
                const boxHost = String(body.host ?? "").trim();
                // A self-hosted tailnet (Headscale) is the same client pointed at another server;
                // a pre-auth key from that server joins with no browser at all. Both are optional
                // and both are checked before they reach a shell.
                const joinInput = validateTailnetJoin(body);
                if (joinInput.error !== undefined || !joinInput.value)
                  return json(res, 400, { error: joinInput.error ?? "bad join" });
                const { loginServer, authKey } = joinInput.value;
                const flags = loginServer ? ` --login-server ${shq(loginServer)}` : "";
                if (authKey) {
                  // `up` with a key finishes on its own: answer the state it reached.
                  const up = `sudo -n tailscale up${flags} --auth-key ${shq(authKey)} --timeout 30s 2>&1 || tailscale up${flags} --auth-key ${shq(authKey)} --timeout 30s 2>&1`;
                  const r = boxHost
                    ? await run("ssh", sshArgs(boxHost, up), undefined, undefined, 45_000)
                    : await run("sh", ["-c", up], undefined, undefined, 45_000);
                  if (r.error) return json(res, 200, { error: r.error.split(/\r?\n/).at(-1) });
                  return json(res, 200, { joined: true });
                }
                const script = `sudo -n tailscale login${flags} 2>&1 || tailscale login${flags} 2>&1`;
                const child = boxHost
                  ? spawn("ssh", sshArgs(boxHost, script), { stdio: ["ignore", "pipe", "pipe"] })
                  : spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
                child.unref();
                const link = await new Promise<string | { error: string }>((resolve) => {
                  let text = "";
                  const look = (chunk: Buffer | string) => {
                    text += String(chunk);
                    const found = loginUrlIn(text);
                    if (found) resolve(found);
                  };
                  child.stdout?.on("data", look);
                  child.stderr?.on("data", look);
                  child.on("close", () =>
                    resolve({
                      error: text.trim().split(/\r?\n/).at(-1) ?? "tailscale login ended",
                    }),
                  );
                  child.on("error", (e) => resolve({ error: e.message }));
                  setTimeout(
                    () => resolve({ error: "no approval link within 15 s" }),
                    15_000,
                  ).unref();
                });
                if (typeof link === "string") return json(res, 200, { url: link });
                return json(res, 200, {
                  error: `${link.error}. Run \`sudo tailscale login\` in a terminal${boxHost ? ` on ${boxHost}` : ""}.`,
                });
              }
              // WireGuard peers this node can dial: `wg show all dump` needs root, so passwordless
              // sudo first, then plain (for a box where the user is in the wireguard group).
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/wireguard/status`) {
                const which = await run("sh", ["-c", "command -v wg"], undefined, undefined, 3000);
                if (which.error || !which.out.trim())
                  return json(res, 200, { installed: false, peers: [] });
                const r = await run(
                  "sh",
                  ["-c", "sudo -n wg show all dump 2>/dev/null || wg show all dump"],
                  undefined,
                  undefined,
                  5000,
                );
                return json(res, 200, {
                  installed: true,
                  peers: r.error ? [] : wireguardPeers(r.out),
                  error: r.error?.split(/\r?\n/).at(-1),
                });
              }
              // Probe each ssh box's `claude` over ssh so the panel shows its login without leaving.
              if (
                sshBoxesPath &&
                req.method === "GET" &&
                url.pathname === `${ROUTE_PREFIX}/ssh-boxes/status`
              ) {
                const boxes = await readSshBoxes(sshBoxesPath);
                const probed = await Promise.all(
                  boxes.map((b) => runtimeStatus("", command, b.host)),
                );
                // A panel login stores a CLAUDE_CODE_OAUTH_TOKEN the plugin injects at spawn; the box's
                // own `claude auth status` can't see it, so a stored token counts as logged in here.
                return json(res, 200, {
                  boxes: boxes.map((b, i) => {
                    const tokenLogin = !!readSshToken(dirname(sshBoxesPath), b.host);
                    const status = tokenLogin ? { ...probed[i], loggedIn: true } : probed[i];
                    if (status) status.running = liveCount?.(b.host) ?? 0;
                    if (status) onLoginStatus?.(sshBoxProviderId(b.name), status.loggedIn);
                    return { name: b.name, host: b.host, status };
                  }),
                });
              }
              // One directory level on an SSH box, for the Add workspace dialog's box dropdown. dsh's
              // own picker lists this PC only (its listing seam takes a path and nothing else), so a
              // level on a box comes from here instead. The host must be a saved box, which is what
              // keeps this from being an ssh-anywhere route.
              if (sshBoxesPath && url.pathname === `${ROUTE_PREFIX}/box-dirs`) {
                const dirsHost = url.searchParams.get("host") ?? "";
                if (!(await readSshBoxes(sshBoxesPath)).some((b) => b.host === dirsHost))
                  return json(res, 400, { error: `unknown box ${dirsHost}` });
                const box: FsBox = { sshHost: dirsHost };
                if (req.method === "GET") {
                  const dir = url.searchParams.get("path") ?? "";
                  const level = await listDirsAt(box, dir).catch((e: unknown) => errorText(e));
                  if (typeof level === "string") return json(res, 502, { error: level });
                  if (level === null)
                    return json(res, 404, {
                      error: `${dir || "~"}: no such directory on ${dirsHost}`,
                    });
                  // The same shape dsh's own listing answers in, so the dialog reads one type
                  // whichever box is picked (crumbs it builds from the path itself).
                  return json(res, 200, {
                    path: level.path,
                    home: level.home,
                    entries: level.names.map((name) => ({
                      name,
                      path: childPath(level.path, name),
                      hidden: name.startsWith("."),
                    })),
                  });
                }
                if (req.method === "POST") {
                  const body = await readBody(req);
                  const parent = String(body.path ?? "");
                  const name = String(body.name ?? "");
                  if (!parent.startsWith("/"))
                    return json(res, 400, { error: "path must be an absolute directory" });
                  // A name is one path segment: a slash or a control byte would write outside the
                  // level the dialog is showing.
                  const segment =
                    name !== "" &&
                    name !== "." &&
                    name !== ".." &&
                    ![...name].some((ch) => ch === "/" || ch < " ");
                  if (!segment) return json(res, 400, { error: `"${name}" is not a folder name` });
                  const dir = childPath(parent, name);
                  const failed = await makeDirAt(box, dir).then(
                    () => "",
                    (e: unknown) => errorText(e),
                  );
                  if (failed) return json(res, 502, { error: failed });
                  return json(res, 200, { path: dir });
                }
              }
              // A workspace pinned to a directory on an SSH box: dsh adopts a local placeholder, the
              // ssh spawner runs the far claude in the real remote path (see sshSpawner).
              if (remoteWorkspacesPath && url.pathname === `${ROUTE_PREFIX}/remote-workspaces`) {
                if (req.method === "GET")
                  return json(res, 200, {
                    workspaces: await readRemoteWorkspaces(remoteWorkspacesPath),
                  });
                if (req.method === "POST") {
                  const reg = workspaceRegistry();
                  if (!reg)
                    return json(res, 501, {
                      error: "workspaceRegistry is not available on this host",
                    });
                  const v = validateRemoteWorkspaceInput(await readBody(req));
                  if (v.error !== undefined) return json(res, 400, { error: v.error });
                  const { name, host: boxHost, remoteCwd } = v.value;
                  // Empty local placeholder dsh stat-checks and adopts; the far claude never sees it.
                  const base = join(dirname(remoteWorkspacesPath), "remote-workspaces");
                  const dir = join(base, `${slugForDir(boxHost)}__${slugForDir(remoteCwd)}`);
                  await mkdir(dir, { recursive: true });
                  let ws: { id: WorkspaceId; path: string };
                  try {
                    ws = await reg.create(dir, `${name} · ${boxHost}`);
                  } catch (e) {
                    return json(res, 500, { error: `create workspace: ${errorText(e)}` });
                  }
                  const existing = await readRemoteWorkspaces(remoteWorkspacesPath);
                  const entry: RemoteWorkspace = {
                    name,
                    host: boxHost,
                    remoteCwd,
                    path: ws.path,
                    workspaceId: ws.id,
                  };
                  const next = [...existing.filter((w) => w.path !== ws.path), entry];
                  await writeFile(
                    remoteWorkspacesPath,
                    `${JSON.stringify(next, null, 2)}\n`,
                    "utf8",
                  );
                  // Only after the file took it: a failed write must not leave the routes reading
                  // a workspace list that nothing on disk agrees with.
                  remoteWorkspaces = next;
                  await onRemoteWorkspaces?.(next);
                  return json(res, 200, { workspace: entry });
                }
                if (req.method === "DELETE") {
                  const target = String((await readBody(req)).path ?? "");
                  const existing = await readRemoteWorkspaces(remoteWorkspacesPath);
                  const entry = existing.find((w) => w.path === target);
                  if (entry) {
                    try {
                      // SAFETY: workspaceId was returned by registry.create as a WorkspaceId and
                      // stored verbatim; delete ignores an unknown id, so a stale value is harmless.
                      await workspaceRegistry()?.delete(entry.workspaceId as WorkspaceId);
                    } catch (e) {
                      log("warn", `remote-workspace delete: ${errorText(e)}`);
                    }
                    await rm(entry.path, { recursive: true, force: true }).catch(() => {});
                  }
                  const next = existing.filter((w) => w.path !== target);
                  await writeFile(
                    remoteWorkspacesPath,
                    `${JSON.stringify(next, null, 2)}\n`,
                    "utf8",
                  );
                  remoteWorkspaces = next;
                  await onRemoteWorkspaces?.(next);
                  return json(res, 200, { workspaces: next });
                }
              }
              // Log a box in from the panel: start runs `claude setup-token` there and returns the
              // OAuth URL it prints; code writes the pasted code back to the same process and
              // stores the minted token. The host must be a saved box, so this cannot ssh
              // elsewhere; an empty host is this box, run under a local PTY, and its token goes to
              // the default instance's local spawns.
              /** A finished login: store its token and flip the row's status, or hand back its error. */
              /** The box's own `claude auth status`, the proof a login took once its process exits. */
              const verifyLogin = (loginHost: string) => async () => {
                const cli = command ?? "claude";
                const st =
                  loginHost === THIS_BOX
                    ? await run(cli, ["auth", "status"], cliEnvFor(boxOf(url).configDir))
                    : await run("ssh", sshArgs(loginHost, `${shq(cli)} auth status`));
                return authFromStatus(st.out).loggedIn;
              };
              const storeLogin = (loginHost: string, loginBoxes: SshBox[], fin: LoginOutcome) => {
                if (!fin.done) return { done: false, error: fin.error };
                forgetIdentity();
                const loginName = loginBoxes.find((b) => b.host === loginHost)?.name;
                onLoginStatus?.(loginName === undefined ? null : sshBoxProviderId(loginName), true);
                loginDone?.(loginHost);
                return { done: true, loggedIn: true };
              };
              if (
                sshBoxesPath &&
                req.method === "POST" &&
                url.pathname === `${ROUTE_PREFIX}/ssh-boxes/login/start`
              ) {
                const loginHost = String((await readBody(req)).host ?? "");
                const loginBoxes = await readSshBoxes(sshBoxesPath);
                if (loginHost !== THIS_BOX && !loginBoxes.some((b) => b.host === loginHost))
                  return json(res, 400, { error: "unknown box" });
                return json(
                  res,
                  200,
                  await startSshLogin(loginHost, undefined, undefined, command),
                );
              }
              if (
                sshBoxesPath &&
                req.method === "POST" &&
                url.pathname === `${ROUTE_PREFIX}/ssh-boxes/login/code`
              ) {
                const body = await readBody(req);
                const loginHost = String(body.host ?? "");
                const loginBoxes = await readSshBoxes(sshBoxesPath);
                if (loginHost !== THIS_BOX && !loginBoxes.some((b) => b.host === loginHost))
                  return json(res, 400, { error: "unknown box" });
                const submit = await submitSshLoginCode(
                  loginHost,
                  String(body.code ?? ""),
                  verifyLogin(loginHost),
                );
                return json(res, 200, storeLogin(loginHost, loginBoxes, submit));
              }
              // The panel asks this after showing the link: setup-token on a box that already has
              // a login finishes on its own, no code, so the token is stored the moment it lands.
              if (
                sshBoxesPath &&
                req.method === "POST" &&
                url.pathname === `${ROUTE_PREFIX}/ssh-boxes/login/poll`
              ) {
                const loginHost = String((await readBody(req)).host ?? "");
                const loginBoxes = await readSshBoxes(sshBoxesPath);
                if (loginHost !== THIS_BOX && !loginBoxes.some((b) => b.host === loginHost))
                  return json(res, 400, { error: "unknown box" });
                const poll = await pollSshLogin(loginHost, verifyLogin(loginHost));
                if (poll.pending) return json(res, 200, { pending: true });
                return json(res, 200, storeLogin(loginHost, loginBoxes, poll));
              }
              // Drop a box's stored login token. Local only: the plugin forgets the token so it stops
              // injecting it; the token stays valid on Anthropic's side until revoked in the account.
              if (
                sshBoxesPath &&
                req.method === "POST" &&
                url.pathname === `${ROUTE_PREFIX}/ssh-boxes/login/logout`
              ) {
                const logoutHost = String((await readBody(req)).host ?? "");
                const logoutBoxes = await readSshBoxes(sshBoxesPath);
                if (logoutHost !== THIS_BOX && !logoutBoxes.some((b) => b.host === logoutHost))
                  return json(res, 400, { error: "unknown box" });
                deleteSshToken(dirname(sshBoxesPath), logoutHost);
                // The box's own CLI login goes too, so Log out means logged out: with only the
                // panel token forgotten, a terminal login kept the row logged in and the click read
                // as a no-op. `claude auth logout` is non-interactive and answers a box without a
                // login harmlessly.
                const logoutBox = boxOf(url);
                const cli = command ?? "claude";
                await (logoutHost === THIS_BOX
                  ? run(cli, ["auth", "logout"], cliEnvFor(logoutBox.configDir))
                  : run("ssh", sshArgs(logoutHost, `${shq(cli)} auth logout`)));
                forgetIdentity();
                logoutDone?.(logoutHost);
                const logoutName = logoutBoxes.find((b) => b.host === logoutHost)?.name;
                onLoginStatus?.(
                  logoutName === undefined ? null : sshBoxProviderId(logoutName),
                  false,
                );
                return json(res, 200, { loggedIn: false });
              }
              // SSH boxes list their transcripts over ssh, not HTTP: they run `claude` on their host
              // and their `~/.claude/projects` never reaches this box's disk. One group per box so
              // each appears as its own filter chip alongside the HTTP boxes.
              if (
                sshBoxesPath &&
                req.method === "GET" &&
                url.pathname === `${ROUTE_PREFIX}/boxes/ssh-sessions`
              ) {
                const boxes = await readSshBoxes(sshBoxesPath);
                const listed = await Promise.all(boxes.map((b) => sshTranscripts(b.host)));
                const owned = dshSessionsFor(
                  await sessionPersistence.list(),
                  null,
                  claudeIdOf,
                  new Set(workspaceRegistry()?.archivedSessionIds ?? []),
                );
                return json(res, 200, {
                  boxes: boxes.map((b, i) => {
                    const r = listed[i];
                    // The box's provider id lets the client bind a resumed transcript to this box's
                    // model directory, so opening one runs it back on the box, not the local claude.
                    const provider = sshBoxProviderId(b.name);
                    if (!r || !r.ok)
                      return {
                        name: b.name,
                        host: b.host,
                        provider,
                        ok: false,
                        error: r?.error ?? "no reply",
                      };
                    const items = withoutSubagents(
                      r.sessions.map((s) => {
                        const d = owned.get(s.id);
                        return d ? { ...s, dsh: d } : s;
                      }),
                    );
                    return { name: b.name, host: b.host, provider, ok: true, sessions: items };
                  }),
                });
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
              // A linked dsh box's login lives on that dsh: its own copy of this plugin runs the
              // same login routes for its own "this box", so these forward start, code, poll and
              // logout there with the box's token. The sign-in tab opens on that desktop, if any;
              // the link shows here, and a page that cannot reach that CLI shows the code to paste.
              const loginProxy = /^\/boxes\/login\/(start|code|poll|logout)$/.exec(
                url.pathname.slice(ROUTE_PREFIX.length),
              );
              if (boxesPath && req.method === "POST" && loginProxy) {
                const body = await readBody(req);
                const target = String(body.url ?? "");
                const box = (await readBoxes(boxesPath)).find((b) => b.url === target);
                if (!box) return json(res, 400, { error: "unknown box" });
                const p = await probeBox<Record<string, JsonValue>>(
                  box,
                  fetch,
                  `ssh-boxes/login/${loginProxy[1]}`,
                  { method: "POST", body: JSON.stringify({ host: "", code: body.code ?? "" }) },
                );
                return json(res, 200, p.ok ? p.status : { error: p.error });
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
                  const body = await readBody(req, 1024 * 1024);
                  const parsed = parseSettingsText(body.text);
                  if (parsed.error !== undefined) return json(res, 400, { error: parsed.error });
                  const p = await probeBox(box, fetch, "settings", {
                    method: "PUT",
                    // The mtime rides along: the box's own route is what checks the file there has
                    // not moved since this tab read it, and dropping it here would waive the check.
                    body: JSON.stringify({ text: body.text, mtime: mtimeOf(body) }),
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
                  const { box, cwd: at } = targetOf(url, cwd);
                  const durable = await readDurableTasks(box, at);
                  const folded = await sessionTranscript(
                    box,
                    await projectDirAt(box, at),
                    sid,
                    claudeIdOf,
                  );
                  const reply: ScheduledTasksReply = {
                    ok: true,
                    durable,
                    session: folded ? sessionTasksFrom(folded) : [],
                    goal: folded ? goalFrom(folded) : null,
                    path: durableTasksPath(at),
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

/**
 * The four files Claude Code merges for one session, highest precedence first. Duplicated in
 * `src/client/settings.ts`: the browser half cannot import server code, and the order is the
 * CLI's, not this plugin's, so both copies have to say the same thing.
 */
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
  const headers = (await sessions.list().catch(() => [])).map(headerOf);
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
  const headers = (await sessions.list().catch(() => [])).map(headerOf);
  return headers.find((h) => h.id === session)?.cwd ?? null;
}
