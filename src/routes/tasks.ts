// The task routes: live tasks and their verbs, /compact and the scheduled tasks. sessions.ts calls
// this group after the inline boxes routes, as the chain did.
import type { IncomingMessage, ServerResponse } from "node:http";
import { type RouteHandler, UNHANDLED } from "./context.js";
import type { RouteCtx } from "../sessions.js";
import { errorText } from "../process.js";
import { asSessionId } from "../dsh.js";
import {
  dshGoalsFrom,
  durableTasksPath,
  goalFrom,
  readDurableTasks,
  sessionTasksFrom,
  type ScheduledTasksReply,
  type ScheduledTasksError,
} from "../scheduled-tasks.js";

/** The tasks group of the session routes, built once per registration. Returns `UNHANDLED` when no
 *  block matched, so the dispatch tries the next group; any other return means a block answered. */
export function tasksRoutes(c: RouteCtx): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const {
      ROUTE_PREFIX,
      claudeIdOf,
      compactNow,
      ctx,
      json,
      liveTasks,
      projectDirAt,
      readBody,
      sessionCwd,
      sessionPersistence,
      sessionTranscript,
      stopTask,
      targetOf,
      taskOutput,
    } = c;
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/live-tasks`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      return json(res, 200, { ok: true, tasks: liveTasks?.(sid) ?? [] });
    }
    if (
      req.method === "POST" &&
      (url.pathname === `${ROUTE_PREFIX}/live-tasks/stop` ||
        url.pathname === `${ROUTE_PREFIX}/live-tasks/output`)
    ) {
      const { session: sid, taskId } = await readBody(req);
      if (typeof sid !== "string" || sid === "" || typeof taskId !== "string" || taskId === "")
        return json(res, 400, { error: "session and taskId required" });
      const stop = url.pathname.endsWith("/stop");
      const fn = stop ? stopTask : taskOutput;
      if (!fn) return json(res, 501, { error: "not available" });
      // 200 either way: the CLI's refusal (a task it no longer has, a subagent asked for
      // output) is the answer the row shows, and the client's readJson throws on a 4xx.
      return json(res, 200, await fn(sid, taskId));
    }
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/compact`) {
      const { session: sid } = await readBody(req);
      if (typeof sid !== "string" || sid === "")
        return json(res, 400, { error: "session required" });
      if (!compactNow) return json(res, 501, { error: "not available" });
      // 200 either way, like the task routes: the refusal is the card's answer.
      return json(res, 200, await compactNow(sid));
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/scheduled-tasks`) {
      // dsh's goal lives in its own session log, not the transcript, as `goal/change`
      // records; a session not loaded here, or an inactive scope, has none to show.
      const dshGoalsOf = (id: string) => {
        try {
          return dshGoalsFrom(ctx.sessions.get(asSessionId(id))?.snapshotEvents() ?? []);
        } catch {
          return [];
        }
      };
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      const cwd = await sessionCwd(sid, sessionPersistence);
      if (!cwd) return json(res, 404, { error: "session not found" });
      try {
        // The durable file and the transcript answer different halves: the file holds
        // what survives a restart, the transcript is the only record of the rest.
        const { box, cwd: at } = targetOf(url, cwd);
        const durable = await readDurableTasks(box, at);
        const folded = await sessionTranscript(box, await projectDirAt(box, at), sid, claudeIdOf);
        const reply: ScheduledTasksReply = {
          ok: true,
          durable,
          session: folded ? sessionTasksFrom(folded) : [],
          goal: folded ? goalFrom(folded) : null,
          dshGoals: dshGoalsOf(sid),
          path: durableTasksPath(at),
        };
        return json(res, 200, reply);
      } catch (e) {
        const reply: ScheduledTasksError = { ok: false, error: errorText(e) };
        return json(res, 500, reply);
      }
    }
    return UNHANDLED;
  };
}
