// Host half of "open a Claude Code session in dsh": lists the transcripts of a workspace and turns
// one into a cold dsh session whose id is the Claude session id, so the adapter resumes it as-is.
// Served under /dsh-llm-claude/*, guarded by dsh's own request policy (trusted host + login cookie).
import { readFile, writeFile, rename, copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { listTranscripts, readTranscript, toSessionEvents } from "./transcript.js";

const ROUTE_PREFIX = "/dsh-llm-claude";
const BODY_LIMIT = 64 * 1024;

const json = (res, status, value) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
};

/** Parse a JSON request body, capped at `limit` bytes. */
export const readBody = (req, limit = BODY_LIMIT) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size <= limit) return chunks.push(c);
      reject(new Error("body too large"));
      req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });

const validId = (id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);

/** settings.json must be one JSON object; anything else Claude Code would reject or ignore. */
export function parseSettingsText(text) {
  if (typeof text !== "string") return { error: "text must be a string" };
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { error: e?.message ?? "invalid JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { error: "settings.json must be a JSON object" };
  return { value };
}

/** Read Claude Code's settings file; a missing file reads as an empty object. */
async function readSettings(path) {
  try {
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return { path, exists: true, text, mtime: info.mtimeMs };
  } catch (e) {
    if (e?.code === "ENOENT") return { path, exists: false, text: "{}\n", mtime: 0 };
    throw e;
  }
}

/** Keep the previous copy as .bak, write to a temp file, rename over: never a half-written file. */
async function writeSettings(path, text) {
  const backup = `${path}.bak`;
  await copyFile(path, backup).catch((e) => {
    if (e?.code !== "ENOENT") throw e;
  });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  await rename(tmp, path);
  return { path, backup, mtime: (await stat(path)).mtimeMs };
}

/**
 * Claude transcript id → the dsh session it belongs to, for the dsh sessions of one workspace.
 * A session this plugin started keeps its Claude transcript under `claudeIdOf(dsh id)`; one opened
 * from this panel shares the id. Archived sessions are included so the panel can bring them back
 * without any archive plugin.
 */
export function dshSessionsFor(headers, cwd, claudeIdOf, archived = new Set()) {
  const map = new Map();
  for (const h of headers) {
    if (h.cwd !== cwd) continue;
    const id = String(h.id);
    const entry = { id, archived: archived.has(id) };
    map.set(id, entry);
    map.set(claudeIdOf(id), entry);
  }
  return map;
}
const validCwd = (cwd) => typeof cwd === "string" && cwd.startsWith("/") && !cwd.includes("\0");

/**
 * Create the dsh session for one transcript: seed with the converted history, flush to disk,
 * leave. The client then adopts it through the normal `sessions.create({ sessionId })` path,
 * which attaches it to the workspace and makes it live.
 */
const opening = new Map();

/** Same id opened twice at once (double click, two tabs) shares one creation. */
function openTranscript(ctx, projectDir, cwd, id, claudeIdOf, registry) {
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
async function openTranscriptOnce(ctx, projectDir, cwd, id, claudeIdOf, registry) {
  if (ctx.sessions.get(id)) return { id, existed: true };
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
  const session = ctx.sessions.prepare(id, { seed, meta: { cwd, createdAt: folded.createdAt } });
  const leave = ctx.sessions.enter(session);
  try {
    ctx.sessions.announce(session);
    await ctx.sessions.flush(session);
  } finally {
    leave();
  }
  return { id, existed: false, turns: folded.turns.length, events: seed.length };
}

/** `projectDir(cwd)` → Claude Code project dir; `startedIds()` → ids the adapter started itself. */
export function registerSessionRoutes(
  ctx,
  { log, projectDir, startedIds, claudeIdOf, settingsPath },
) {
  // Optional: stock dsh has it; without it archived sessions list but cannot be restored.
  let registry;
  ctx.inject(["workspaceRegistry"], (host) => {
    registry = host.workspaceRegistry;
  });
  ctx.inject(["webServer", "connection", "sessions", "sessionPersistence"], (ctx) => {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: "prefix",
          path: ROUTE_PREFIX,
          handler: async (req, res) => {
            const rejection = ctx.connection.requestRejection(req);
            if (rejection !== undefined) return json(res, rejection, { error: "forbidden" });
            const url = new URL(req.url ?? "/", "http://dsh");
            try {
              if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/sessions`) {
                const cwd = url.searchParams.get("cwd") ?? "";
                if (!validCwd(cwd))
                  return json(res, 400, { error: "cwd must be an absolute path" });
                // Transcripts of dsh sessions (started here or opened from here) are listed with
                // their dsh id so the panel opens the existing session. Ones the adapter started
                // for a dsh session that no longer exists are hidden.
                const owned = dshSessionsFor(
                  await ctx.sessionPersistence.list(),
                  cwd,
                  claudeIdOf,
                  new Set(registry?.archivedSessionIds ?? []),
                );
                const hidden = new Set([...(await startedIds())].filter((id) => !owned.has(id)));
                const sessions = (await listTranscripts(projectDir(cwd), hidden)).map((s) => {
                  const d = owned.get(s.id);
                  return d ? { ...s, dsh: d } : s;
                });
                return json(res, 200, { sessions });
              }
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/open`) {
                const { cwd, id } = await readBody(req);
                if (!validCwd(cwd) || !validId(id))
                  return json(res, 400, { error: "cwd and id required" });
                return json(
                  res,
                  200,
                  await openTranscript(ctx, projectDir, cwd, id, claudeIdOf, registry),
                );
              }
              if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings`) {
                if (req.method === "GET") return json(res, 200, await readSettings(settingsPath));
                if (req.method === "PUT") {
                  const { text } = await readBody(req, 1024 * 1024);
                  const parsed = parseSettingsText(text);
                  if (parsed.error) return json(res, 400, { error: parsed.error });
                  const written = await writeSettings(settingsPath, text);
                  log("info", `settings.json saved (${text.length} chars)`);
                  return json(res, 200, written);
                }
              }
              return json(res, 404, { error: "not found" });
            } catch (e) {
              log("warn", `session route failed: ${e?.message ?? e}`);
              return json(res, 500, { error: String(e?.message ?? e) });
            }
          },
        }),
      "dsh-llm-claude session routes",
    );
  });
}
