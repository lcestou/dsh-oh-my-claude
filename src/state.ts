// Files this plugin keeps on disk, and the one Claude Code file it reads: session ids it started,
// sessions with a turn in flight, the resume trace, the aux scratch dir, and the stored OAuth
// token for the Models API. This is an I/O boundary: JSON from disk is decoded here and typed
// values leave.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Claude Code's config dir: transcripts, settings.json. Honors CLAUDE_CONFIG_DIR like the CLI. */
export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

// Session state: which Claude sessions this plugin started, so resume does not depend on guessing
// where Claude Code keeps its transcripts. A wrong guess still degrades to a fresh full-transcript run.
export const STATE_DIR = join(homedir(), ".local", "state", "dsh-llm-claude");
export const STATE_FILE = join(STATE_DIR, "sessions.json");
/** Sessions with a turn in flight. Survives a dsh restart so those sessions can be nudged back. */
export const BUSY_FILE = join(STATE_DIR, "busy.json");
/** Plugin info logs never reach dsh's web.log; the resume path keeps its own trace file. */
export const RESUME_LOG = join(STATE_DIR, "resume.log");
let busyChain = Promise.resolve();

/** Append one line to the resume trace; best effort, never throws. */
export async function trace(line: string): Promise<void> {
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await appendFile(RESUME_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

/** Record (or clear) that a session's turn is running; serialized read-modify-write. */
export function markBusy(id: string, on: boolean, path = BUSY_FILE): Promise<void> {
  busyChain = busyChain.then(
    async () => {
      let ids: unknown[] = [];
      try {
        ids = JSON.parse(await readFile(path, "utf8"));
      } catch {}
      const set = new Set(Array.isArray(ids) ? ids : []);
      if (on ? set.has(id) : !set.has(id)) return;
      if (on) set.add(id);
      else set.delete(id);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify([...set]));
    },
    () => {},
  );
  return busyChain;
}

/** Sessions whose turn the previous dsh process left unfinished; cleared on read. */
export async function takeInterrupted(path = BUSY_FILE): Promise<string[]> {
  let ids: unknown[] = [];
  try {
    ids = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
  await writeFile(path, "[]").catch(() => {});
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

const AUX_DIR = join(STATE_DIR, "aux");
let auxReady: Promise<string> | undefined;
/** Scratch cwd for title and compaction one-shots, so their transcripts stay out of workspaces. */
export const auxCwd = (): Promise<string> =>
  (auxReady ??= mkdir(AUX_DIR, { recursive: true }).then(() => AUX_DIR));

let started: Set<string> | undefined; // Set of Claude session ids known to exist

/**
 * Loads the set of Claude session IDs that this plugin has started.
 * Cached after the first call.
 */
export async function loadStarted(): Promise<Set<string>> {
  if (started) return started;
  try {
    const ids: unknown = JSON.parse(await readFile(STATE_FILE, "utf8"));
    started = new Set(
      Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    started = new Set();
  }
  return started;
}

/**
 * Records or removes a Claude session ID from the known sessions list.
 */
export async function rememberStarted(id: string, keep = true): Promise<void> {
  const set = await loadStarted();
  if (keep ? set.has(id) : !set.has(id)) return;
  if (keep) set.add(id);
  else set.delete(id);
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify([...set]));
  } catch {
    /* state is an optimization only */
  }
}

/** Headers for the Anthropic Models API: an API key from the env, else Claude Code's stored OAuth token. */
export async function authHeaders(): Promise<Record<string, string> | null> {
  if (process.env.ANTHROPIC_API_KEY) return { "x-api-key": process.env.ANTHROPIC_API_KEY };
  try {
    const raw = await readFile(join(CLAUDE_HOME, ".credentials.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const oauth =
      typeof parsed === "object" && parsed !== null && "claudeAiOauth" in parsed
        ? parsed.claudeAiOauth
        : undefined;
    if (typeof oauth === "object" && oauth !== null && "accessToken" in oauth) {
      const token = oauth.accessToken;
      const expiresAt =
        "expiresAt" in oauth && typeof oauth.expiresAt === "number" ? oauth.expiresAt : 0;
      if (typeof token === "string" && token && expiresAt > Date.now()) {
        return { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" };
      }
    }
  } catch {
    /* no stored credential */
  }
  return null;
}
