// Plan usage for the context-meter popover: the OAuth usage endpoint behind Claude Code's /usage
// command, read with the login Claude Code stores, projected to the few fields the panel shows.
// This is an I/O boundary: the payload is undocumented and decoded here into a closed shape.
import type { IncomingMessage, ServerResponse } from "node:http";
import { authHeaders } from "./state.js";
import { errorText } from "./process.js";
import type { PluginContext } from "./dsh.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const ROUTE = "/dsh-llm-claude/usage";
/** Background answers are served from cache this long; a popover open may force a refresh sooner. */
const CACHE_MS = 5 * 60_000;
const FORCE_MIN_AGE_MS = 30_000;

/** One rate-limit window as the panel shows it. */
export interface UsageWindow {
  label: string;
  usedPercent: number;
  /** Epoch ms, or null when the API did not say. */
  resetsAt: number | null;
}

/** What the route answers: the windows in display order, or why there are none. */
export type UsageReply =
  | { ok: true; fetchedAt: number; windows: UsageWindow[]; host?: string; email?: string | null }
  | { ok: false; error: string; windows?: undefined; host?: string; email?: string | null };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const percentOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
const resetOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v >= 1e11 ? v : v * 1000;
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
};

/**
 * The usage payload lists `limits` (kind `session`, `weekly_all`, `weekly_scoped` with a model
 * scope, and whatever kinds get added later); older answers carried `five_hour` / `seven_day`
 * objects with `utilization`. All read; unknown kinds keep their API name as the label.
 */
export function usageWindows(payload: unknown): UsageWindow[] {
  const row = isRec(payload) ? payload : {};
  const out: UsageWindow[] = [];
  const legacy = (v: unknown, label: string) => {
    if (!isRec(v)) return;
    const usedPercent = percentOf(v.utilization);
    if (usedPercent !== null) out.push({ label, usedPercent, resetsAt: resetOf(v.resets_at) });
  };
  const limits = Array.isArray(row.limits) ? row.limits : [];
  let session: UsageWindow | undefined;
  let weekly: UsageWindow | undefined;
  const others: UsageWindow[] = [];
  for (const entry of limits) {
    if (!isRec(entry) || entry.is_active === false) continue;
    const usedPercent = percentOf(entry.percent);
    if (usedPercent === null) continue;
    const resetsAt = resetOf(entry.resets_at);
    if (entry.kind === "session") session ??= { label: "5-hour", usedPercent, resetsAt };
    else if (entry.kind === "weekly_all") weekly ??= { label: "Weekly", usedPercent, resetsAt };
    else if (entry.kind === "weekly_scoped") {
      const scope = isRec(entry.scope) ? entry.scope : {};
      const model = isRec(scope.model) ? scope.model : {};
      const name =
        typeof model.display_name === "string"
          ? model.display_name
          : typeof scope.surface === "string"
            ? scope.surface
            : "Model";
      others.push({ label: `${name} weekly`, usedPercent, resetsAt });
    } else if (typeof entry.kind === "string") {
      // A window kind this code has not met yet: show it under its own name rather than hide it.
      const label = entry.kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      others.push({ label, usedPercent, resetsAt });
    }
  }
  if (session) out.push(session);
  else legacy(row.five_hour, "5-hour");
  if (weekly) out.push(weekly);
  else legacy(row.seven_day, "Weekly");
  out.push(...others);
  return out;
}

/** The subset of fetch the reader uses, so tests can hand in a fake. */
export type UsageFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Read usage with the stored login; never throws, the panel shows the reason instead. */
export async function readUsage(fetchImpl: UsageFetch = fetch): Promise<UsageReply> {
  const headers = await authHeaders();
  if (!headers?.Authorization) return { ok: false, error: "needs a Claude Code login" };
  try {
    const r = await fetchImpl(USAGE_URL, {
      headers: { ...headers, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401) return { ok: false, error: "login expired: run claude auth login" };
    if (r.status === 429) return { ok: false, error: "usage endpoint rate limited" };
    if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, fetchedAt: Date.now(), windows: usageWindows(await r.json()) };
  } catch (e) {
    return { ok: false, error: errorText(e).slice(0, 200) };
  }
}

/** Serve `/dsh-llm-claude/usage` (`?force=1` refreshes sooner) from a small cache. */
export function registerUsageRoute(
  ctx: PluginContext,
  log: (level: string, msg: string) => void,
  identity: () => Promise<{ host: string; email: string | null }>,
) {
  let cached: { at: number; reply: UsageReply } | undefined;
  let inFlight: Promise<UsageReply> | undefined;
  const read = (force: boolean): Promise<UsageReply> => {
    const age = cached ? Date.now() - cached.at : Infinity;
    if (cached && age < (force ? FORCE_MIN_AGE_MS : CACHE_MS)) return Promise.resolve(cached.reply);
    inFlight ??= readUsage().then((reply) => {
      // One transient failure keeps the last good answer for its remaining cache life; the
      // fetch time is not refreshed, so a failure that persists surfaces once that life is over.
      if (reply.ok || !cached?.reply.ok || age >= CACHE_MS) cached = { at: Date.now(), reply };
      inFlight = undefined;
      return cached.reply;
    });
    return inFlight;
  };
  ctx.inject?.(["webServer", "connection"], (host) => {
    const { webServer, connection } = host;
    if (!webServer || !connection) return;
    host.effect?.(
      () =>
        webServer.register({
          kind: "prefix",
          path: ROUTE,
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            const rejection = connection.requestRejection(req);
            const send = (status: number, body: UsageReply | { error: string }) => {
              res.writeHead(status, {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
              });
              res.end(JSON.stringify(body));
            };
            if (rejection !== undefined) return send(rejection, { error: "forbidden" });
            if (req.method !== "GET") return send(405, { error: "GET only" });
            try {
              const force = new URL(req.url ?? "/", "http://dsh").searchParams.get("force") === "1";
              // The usage belongs to this box's login; say so, the browser hops between boxes.
              const [reply, who] = await Promise.all([read(force), identity()]);
              return send(200, { ...reply, ...who });
            } catch (e) {
              log("warn", `usage route failed: ${errorText(e)}`);
              return send(500, { error: errorText(e) });
            }
          },
        }),
      "dsh-llm-claude usage route",
    );
  });
}
