// Host half of "open a Claude Code session in dsh": lists the transcripts of a workspace and turns
// one into a cold dsh session whose id is the Claude session id, so the adapter resumes it as-is.
// Served under /dsh-llm-claude/*, guarded by dsh's own request policy (trusted host + login cookie).
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

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > BODY_LIMIT) reject(new Error("body too large"));
      else chunks.push(c);
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
const validCwd = (cwd) => typeof cwd === "string" && cwd.startsWith("/") && !cwd.includes("\0");

/**
 * Create the dsh session for one transcript: seed with the converted history, flush to disk,
 * leave. The client then adopts it through the normal `sessions.create({ sessionId })` path,
 * which attaches it to the workspace and makes it live.
 */
const opening = new Map();

/** Same id opened twice at once (double click, two tabs) shares one creation. */
function openTranscript(ctx, projectDir, cwd, id) {
  let job = opening.get(id);
  if (!job) {
    job = openTranscriptOnce(ctx, projectDir, cwd, id).finally(() => opening.delete(id));
    opening.set(id, job);
  }
  return job;
}

async function openTranscriptOnce(ctx, projectDir, cwd, id) {
  if (ctx.sessions.get(id)) return { id, existed: true };
  const persisted = await ctx.sessionPersistence.list();
  if (persisted.some((h) => String(h.id) === id)) return { id, existed: true };
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
export function registerSessionRoutes(ctx, { log, projectDir, startedIds }) {
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
                // Hide transcripts the adapter started for a dsh session of another id; ones opened
                // from here share the id with their dsh session and stay listed as "Show".
                const persisted = new Set(
                  (await ctx.sessionPersistence.list()).map((h) => String(h.id)),
                );
                const hidden = new Set(
                  [...(await startedIds())].filter((id) => !persisted.has(id)),
                );
                return json(res, 200, { sessions: await listTranscripts(projectDir(cwd), hidden) });
              }
              if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/open`) {
                const { cwd, id } = await readBody(req);
                if (!validCwd(cwd) || !validId(id))
                  return json(res, 400, { error: "cwd and id required" });
                return json(res, 200, await openTranscript(ctx, projectDir, cwd, id));
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
