// The second-opinion routes: the card's state, its Run and Close, and the Settings row's model list
// and save. sessions.ts calls this group before the boxes routes.
import type { IncomingMessage, ServerResponse } from "node:http";
import { type RouteHandler, UNHANDLED } from "./context.js";
import type { RouteCtx } from "../sessions.js";
import z from "@deepseek-ai/schemastery";
import { hub } from "../events.js";
import { opinions } from "../adapter/second-opinion.js";

/** The body of Run and Close. */
/** How long one provider gets to list its models before the Settings row goes on without it. */
const LIST_MS = 5000;
const SessionBody = z.object({ session: z.string().required() });
/** The Settings row's save; no model turns the feature off. */
const SettingBody = z.object({ provider: z.string(), model: z.string(), auto: z.boolean() });

/** One provider the Settings row offers and the models it lists. */
interface Choice {
  provider: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

/** The second-opinion group of the session routes. Returns `UNHANDLED` when no block matched. Takes
 *  only the four fields it reads, so its test builds them without a whole route context. */
export function secondOpinionRoutes(
  c: Pick<RouteCtx, "ROUTE_PREFIX" | "ctx" | "json" | "readBody">,
): RouteHandler {
  const { ROUTE_PREFIX, ctx, json, readBody } = c;
  /** Every dsh provider except this plugin's own Claude mounts, with the models each lists. Claude
   *  is what is being reviewed, and its adapter answers a turn, not a one-shot call. A provider whose
   *  list fails, or does not answer within LIST_MS, is left out rather than holding the row. The
   *  providers are asked at once, so one slow provider costs LIST_MS, not its share of a queue. */
  const choices = async (): Promise<Choice[]> => {
    const rows = await Promise.all(
      ctx.llm
        .listProviders()
        .filter((p) => !p.id.startsWith("claude-code"))
        .map(async (p) => {
          const models = await Promise.race([
            ctx.llm.listModels(p.id).catch(() => []),
            new Promise<[]>((resolve) => setTimeout(() => resolve([]), LIST_MS)),
          ]);
          return models.length === 0
            ? undefined
            : {
                provider: p.id,
                name: p.name ?? p.id,
                models: models.map((m) => ({ id: m.id, name: m.name ?? m.id })),
              };
        }),
    );
    return rows.filter((r): r is Choice => r !== undefined);
  };
  /** The `session` of a Run, Cancel or Close body; undefined when it is missing or not a string. */
  const sessionOf = async (req: IncomingMessage): Promise<string | undefined> => {
    try {
      return SessionBody(await readBody(req)).session;
    } catch {
      return undefined;
    }
  };
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const base = `${ROUTE_PREFIX}/second-opinion`;
    if (req.method === "GET" && url.pathname === base) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      return json(res, 200, opinions.reply(sid));
    }
    if (req.method === "POST" && url.pathname === `${base}/run`) {
      const session = await sessionOf(req);
      if (session === undefined) return json(res, 400, { error: "session required" });
      const card = opinions.reply(session).card;
      if (!opinions.current() || card === null || card.state === "running")
        return json(res, 409, { error: "nothing to review" });
      // Answered at once: the card follows the review on the event stream.
      void opinions.run(session);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === `${base}/cancel`) {
      const session = await sessionOf(req);
      if (session === undefined) return json(res, 400, { error: "session required" });
      opinions.cancel(session);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === `${base}/dismiss`) {
      const session = await sessionOf(req);
      if (session === undefined) return json(res, 400, { error: "session required" });
      opinions.dismiss(session);
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === `${base}/setting`)
      return json(res, 200, { setting: opinions.current() ?? null, choices: await choices() });
    if (req.method === "POST" && url.pathname === `${base}/setting`) {
      let body;
      try {
        body = SettingBody(await readBody(req));
      } catch {
        return json(res, 400, { error: "provider and model must be strings" });
      }
      const model = body.model ?? "";
      const provider = body.provider ?? "";
      if (!model) await opinions.save(undefined);
      else {
        // Checked at the door against what dsh lists now, so a stale tab cannot save a model that
        // is gone; one saved earlier and since removed shows on the card as unavailable instead.
        const offered = (await choices()).some(
          (ch) => ch.provider === provider && ch.models.some((m) => m.id === model),
        );
        if (!offered) return json(res, 400, { error: "model is not offered by dsh" });
        await opinions.save(
          body.auto === true ? { provider, model, auto: true } : { provider, model },
        );
      }
      // Every open Settings row follows a save made in another tab or browser.
      hub.publish({
        kind: "second-opinion-setting",
        session: null,
        data: { setting: opinions.current() ?? null },
      });
      return json(res, 200, { ok: true });
    }
    return UNHANDLED;
  };
}
