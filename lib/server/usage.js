import { authHeaders } from "./state.js";
import { errorText } from "./process.js";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const ROUTE = "/dsh-oh-my-claude/usage";
/** Background answers are served from cache this long; a popover open may force a refresh sooner. */
const CACHE_MS = 5 * 60_000;
const FORCE_MIN_AGE_MS = 30_000;
/** After a 429 with no usable Retry-After, wait at least this long before touching the endpoint. */
const RATE_LIMIT_FLOOR_MS = 60_000;
/** Retry-After (seconds, or an HTTP-date) → ms; the floor when the header is missing or unparsable. */
function retryAfterMs(header) {
    if (!header)
        return RATE_LIMIT_FLOOR_MS;
    const secs = Number(header);
    if (Number.isFinite(secs))
        return Math.max(secs * 1000, RATE_LIMIT_FLOOR_MS);
    const at = Date.parse(header);
    return Number.isNaN(at) ? RATE_LIMIT_FLOOR_MS : Math.max(at - Date.now(), RATE_LIMIT_FLOOR_MS);
}
const isRec = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const percentOf = (v) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
const resetOf = (v) => {
    if (typeof v === "number" && Number.isFinite(v))
        return v >= 1e11 ? v : v * 1000;
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
export function usageWindows(payload) {
    const row = isRec(payload) ? payload : {};
    const out = [];
    const legacy = (v, label) => {
        if (!isRec(v))
            return;
        const usedPercent = percentOf(v.utilization);
        if (usedPercent !== null)
            out.push({ label, usedPercent, resetsAt: resetOf(v.resets_at) });
    };
    const limits = Array.isArray(row.limits) ? row.limits : [];
    let session;
    let weekly;
    const others = [];
    for (const entry of limits) {
        if (!isRec(entry) || entry.is_active === false)
            continue;
        const usedPercent = percentOf(entry.percent);
        if (usedPercent === null)
            continue;
        const resetsAt = resetOf(entry.resets_at);
        if (entry.kind === "session")
            session ??= { label: "5-hour", usedPercent, resetsAt };
        else if (entry.kind === "weekly_all")
            weekly ??= { label: "Weekly", usedPercent, resetsAt };
        else if (entry.kind === "weekly_scoped") {
            const scope = isRec(entry.scope) ? entry.scope : {};
            const model = isRec(scope.model) ? scope.model : {};
            const name = typeof model.display_name === "string"
                ? model.display_name
                : typeof scope.surface === "string"
                    ? scope.surface
                    : "Model";
            others.push({ label: `${name} weekly`, usedPercent, resetsAt });
        }
        else if (typeof entry.kind === "string") {
            // A window kind this code has not met yet: show it under its own name rather than hide it.
            const label = entry.kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
            others.push({ label, usedPercent, resetsAt });
        }
    }
    if (session)
        out.push(session);
    else
        legacy(row.five_hour, "5-hour");
    if (weekly)
        out.push(weekly);
    else
        legacy(row.seven_day, "Weekly");
    out.push(...others);
    return out;
}
/**
 * A money object in the payload (`{amount_minor, currency, exponent}`) read into both. The locale
 * is fixed because the string is built here, on the box, beside English panel copy; the unit the
 * user cares about is the payload's own currency, which is what varies.
 */
const money = (v) => {
    if (!isRec(v))
        return undefined;
    const minor = v.amount_minor;
    if (typeof minor !== "number" || !Number.isFinite(minor))
        return undefined;
    // Intl throws on a fraction count past 20 and on a code that is not three letters, and this
    // payload is undocumented enough that either could arrive.
    const exponent = typeof v.exponent === "number" && v.exponent >= 0 && v.exponent <= 20 ? v.exponent : 2;
    const currency = typeof v.currency === "string" && /^[A-Za-z]{3}$/.test(v.currency) ? v.currency : "USD";
    const value = minor / 10 ** exponent;
    const text = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: exponent,
        maximumFractionDigits: exponent,
    }).format(value);
    return { value, text };
};
/**
 * The payload states credits twice: `spend` is the modern block, `extra_usage` the older parallel
 * one, so `spend` leads and `extra_usage` answers for a payload that predates it. Only `spend`
 * carries amounts as money objects; the scale of the legacy `used_credits` is not documented and
 * guessing it would print a wrong price, so a legacy-only payload shows its state without one.
 */
export function usageCredits(payload) {
    const row = isRec(payload) ? payload : {};
    const extra = isRec(row.extra_usage) ? row.extra_usage : {};
    const spend = isRec(row.spend) ? row.spend : undefined;
    const used = money(spend?.used);
    const limit = money(spend?.limit) ?? money(spend?.cap);
    // Only the legacy block says "reached" outright; a spend that has met its own limit is the
    // same state said in numbers.
    const capped = extra.spend_limit_reached === true ||
        (used !== undefined && limit !== undefined && limit.value > 0 && used.value >= limit.value);
    const enabled = spend ? spend.enabled === true : extra.is_enabled === true;
    const out = { enabled, capped, canPurchase: spend?.can_purchase_credits === true };
    // Credits that are off spend nothing, and the endpoint says so with a zero rather than a blank;
    // a constant $0.00 in the row would be noise.
    if (enabled && used)
        out.used = used.text;
    if (enabled && limit)
        out.limit = limit.text;
    const note = spend?.disclaimer;
    if (typeof note === "string" && note.trim())
        out.note = note;
    return out;
}
/** Credits are on and their own cap not reached: a full plan window does not block a request. */
export function extraUsageOn(payload) {
    const credits = usageCredits(payload);
    return credits.enabled && !credits.capped;
}
/** Read usage with the stored login; never throws, the panel shows the reason instead. */
export async function readUsage(fetchImpl = fetch, home) {
    const headers = await authHeaders(home);
    if (!headers?.Authorization)
        return { ok: false, error: "needs a Claude Code login" };
    try {
        const r = await fetchImpl(USAGE_URL, {
            headers: { ...headers, Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
        });
        if (r.status === 401)
            return { ok: false, error: "login expired: run claude auth login" };
        if (r.status === 429)
            return {
                ok: false,
                error: "usage endpoint rate limited",
                retryAfterMs: retryAfterMs(r.headers?.get("retry-after")),
            };
        if (r.status !== 200)
            return { ok: false, error: `HTTP ${r.status}` };
        const payload = await r.json();
        return {
            ok: true,
            fetchedAt: Date.now(),
            windows: usageWindows(payload),
            extraUsage: extraUsageOn(payload),
            credits: usageCredits(payload),
        };
    }
    catch (e) {
        return { ok: false, error: errorText(e).slice(0, 200) };
    }
}
/** The reset instant of a window still at its cap, or undefined when nothing blocks a request.
 *  A reply that could not be read answers undefined too: the wake then finds out by trying. */
export function stillLimitedUntil(reply, now = Date.now()) {
    if (!reply.ok || reply.extraUsage)
        return undefined;
    const resets = reply.windows.flatMap((w) => w.usedPercent >= 100 && w.resetsAt !== null && w.resetsAt > now ? [w.resetsAt] : []);
    return resets.length > 0 ? Math.max(...resets) : undefined;
}
/** Serve `/dsh-oh-my-claude/usage` (`?force=1` refreshes sooner) from a small cache. */
export function registerUsageRoute(ctx, log, identity, options) {
    const defaultHome = options?.home;
    const homeFor = options?.homeFor;
    // Per-home caches so different instances keep their own answers.
    const cached = new Map();
    const inFlight = new Map();
    // A 429 backs the endpoint off until here, even when the client keeps forcing; serve cache meanwhile.
    // Per home: a 429 on one login must not silence another instance's reads.
    const rateLimitedUntil = new Map();
    // Only this home's last good answer: another instance's numbers are another account's.
    const rateLimited = (home) => cached.get(home)?.reply.ok
        ? cached.get(home).reply
        : { ok: false, error: "usage endpoint rate limited" };
    const read = (force, home) => {
        if (Date.now() < (rateLimitedUntil.get(home) ?? 0))
            return Promise.resolve(rateLimited(home));
        const entry = cached.get(home);
        const age = entry ? Date.now() - entry.at : Infinity;
        if (entry && age < (force ? FORCE_MIN_AGE_MS : CACHE_MS))
            return Promise.resolve(entry.reply);
        if (!inFlight.has(home)) {
            inFlight.set(home, readUsage(undefined, home).then((reply) => {
                if (!reply.ok && reply.retryAfterMs)
                    rateLimitedUntil.set(home, Date.now() + Math.max(reply.retryAfterMs, RATE_LIMIT_FLOOR_MS));
                // One transient failure keeps the last good answer for its remaining cache life; the
                // fetch time is not refreshed, so a failure that persists surfaces once that life is over.
                if (reply.ok || !entry?.reply.ok || age >= CACHE_MS)
                    cached.set(home, { at: Date.now(), reply });
                inFlight.delete(home);
                return cached.get(home).reply;
            }));
        }
        return inFlight.get(home);
    };
    ctx.inject?.(["webServer", "connection"], (host) => {
        const { webServer, connection } = host;
        if (!webServer || !connection)
            return;
        host.effect?.(() => webServer.register({
            kind: "prefix",
            path: ROUTE,
            handler: async (req, res) => {
                const rejection = connection.requestRejection(req);
                const send = (status, body) => {
                    res.writeHead(status, {
                        "content-type": "application/json; charset=utf-8",
                        "cache-control": "no-store",
                    });
                    res.end(JSON.stringify(body));
                };
                if (rejection !== undefined)
                    return send(rejection, { error: "forbidden" });
                if (req.method !== "GET")
                    return send(405, { error: "GET only" });
                try {
                    const url = new URL(req.url ?? "/", "http://dsh");
                    const force = url.searchParams.get("force") === "1";
                    // Resolve the home for the requested provider; fall back to the default instance.
                    const provider = url.searchParams.get("provider");
                    // An unknown provider id (instance gone after a reload) reads the default instance.
                    const home = (provider && homeFor?.(provider)) || defaultHome;
                    // The usage belongs to this box's login; say so, the browser hops between boxes.
                    const [reply, who] = await Promise.all([read(force, home ?? ""), identity(home)]);
                    return send(200, { ...reply, ...who });
                }
                catch (e) {
                    log("warn", `usage route failed: ${errorText(e)}`);
                    return send(500, { error: errorText(e) });
                }
            },
        }), "dsh-oh-my-claude usage route");
    });
}
//# sourceMappingURL=usage.js.map