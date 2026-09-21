import { execFile } from "node:child_process";
import { authHeaders, authHeadersFrom, STATE_DIR, writeJson } from "./state.js";
import { errorText, shq, sshArgs } from "./process.js";
import { cliEnvFor } from "./sessions.js";
import z from "@deepseek-ai/schemastery";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
/** True only for a plain object, so a JSON array or null is not treated as a record to read. */
const isRec = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** A percentage clamped into 0 to 100, or null for anything that is not a finite number. */
const percentOf = (v) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
/** A reset time in epoch milliseconds. A number from 1e11 up is already milliseconds and a
 *  smaller one is seconds; a string is parsed as a date. */
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
        // `is_active` is not read. The endpoint sends it false for windows that are plainly running —
        // the 5-hour and weekly rows of a live account both arrive false — and the CLI's own reader
        // ignores the field entirely, keying off `percent` and `resets_at`. Skipping on it dropped
        // every modern row; the two main ones survived only because the legacy blocks below repeat
        // them, and a per-model weekly, which has no legacy twin, vanished.
        if (!isRec(entry))
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
/** A box's credentials file over ssh: its own `~/.claude`, read with `cat` so no path of this box
 *  is assumed there. Null when the box has none or does not answer. */
const remoteCredentials = (sshHost) => new Promise((resolve) => {
    execFile("ssh", sshArgs(sshHost, "cat ~/.claude/.credentials.json"), { timeout: 15_000, maxBuffer: 64 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
});
/** Read usage with the stored login; never throws, the panel shows the reason instead. An SSH
 *  box's usage is its own account's: its credentials come over ssh, the endpoint is asked from here. */
export async function readUsage(fetchImpl = fetch, home, sshHost) {
    const headers = sshHost
        ? authHeadersFrom(await remoteCredentials(sshHost))
        : await authHeaders(home);
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
/**
 * Parse the text `claude -p "/usage"` prints into its time windows, their driver groups and its
 * behaviour lines. The format is the CLI's own (2.1.x); a shape this does not recognise yields [],
 * which the caller degrades to an empty section rather than an error. A line under a window header
 * that is not a "Top …" group is kept verbatim as a behaviour ("91% of your usage was at >150k
 * context"): those sentences explain a bill that no named driver accounts for. English number
 * formatting and the CLI's `·` separator are assumed; a locale change would degrade the same way,
 * not throw.
 */
export function parseUsageBreakdown(text) {
    const windows = [];
    let current;
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        const head = /^(Last \d+[hdw]) · ([\d,]+) requests · ([\d,]+) sessions$/.exec(line);
        if (head) {
            current = {
                label: head[1] ?? "",
                requests: Number((head[2] ?? "").replace(/,/g, "")),
                sessions: Number((head[3] ?? "").replace(/,/g, "")),
                groups: [],
                behaviours: [],
            };
            windows.push(current);
            continue;
        }
        const top = /^Top ([^:]+): (.+)$/.exec(line);
        if (top && current) {
            const label = (top[1] ?? "").replace(/^./, (c) => c.toUpperCase());
            const drivers = [];
            for (const entry of (top[2] ?? "").split(", ")) {
                const m = /^(.+) (\d+)%$/.exec(entry.trim());
                if (m)
                    drivers.push({ name: m[1] ?? "", pct: Number(m[2]) });
            }
            if (drivers.length > 0)
                current.groups.push({ label, drivers });
            continue;
        }
        // Anything else indented under a window header is one of the CLI's behaviour sentences. It has
        // to start with a percentage, so a legend or a stray blank cannot be mistaken for one.
        if (current && /^\d+% of your usage /.test(line))
            current.behaviours.push(line);
    }
    return windows.filter((w) => w.groups.length > 0 || w.behaviours.length > 0);
}
/** Run `claude -p "/usage"` on a box and parse its breakdown. Never throws; the panel shows the
 *  reason. Local via execFile with the box's config dir; an ssh box over ssh with its own login.
 *  COLUMNS/TERM force a wide, dumb terminal so no "Top …" row wraps and loses its tail. */
export function readUsageBreakdown(command, realHome, sshHost) {
    return new Promise((resolve) => {
        const done = (stdout) => resolve({ ok: true, fetchedAt: Date.now(), windows: parseUsageBreakdown(stdout) });
        const fail = () => resolve({ ok: false, error: "usage breakdown unavailable" });
        if (sshHost) {
            const remote = `COLUMNS=1000 TERM=dumb ${shq(command)} -p '/usage'`;
            execFile("ssh", sshArgs(sshHost, remote), { timeout: 15_000, maxBuffer: 256 * 1024 }, (err, stdout) => (err || !stdout.trim() ? fail() : done(stdout)));
            return;
        }
        const env = { ...cliEnvFor(realHome), COLUMNS: "1000", TERM: "dumb" };
        execFile(command, ["-p", "/usage"], { timeout: 15_000, maxBuffer: 256 * 1024, env }, (err, stdout) => (err || !stdout.trim() ? fail() : done(stdout)));
    });
}
/** The reset instant of a window still at its cap, or undefined when nothing blocks a request.
 *  A reply that could not be read answers undefined too: the wake then finds out by trying. */
export function stillLimitedUntil(reply, now = Date.now()) {
    if (!reply.ok || reply.extraUsage)
        return undefined;
    const resets = reply.windows.flatMap((w) => w.usedPercent >= 100 && w.resetsAt !== null && w.resetsAt > now ? [w.resetsAt] : []);
    return resets.length > 0 ? Math.max(...resets) : undefined;
}
// Every entry is re-parsed against the shape the reader needs, rather than trusted because a
// version number on the file says it should be fine. A persisted cache outlives the code that
// wrote it: this file already crashed the panel once, when a reply written before the parser
// learned to keep the behaviour sentences was read by code that expected them. A version marker
// catches that only if whoever adds a field remembers to bump it, which is discipline the
// compiler cannot check; a schema is checked on every read and needs nobody to remember. The
// model catalog's own disk cache is read the same way (`parseCatalogCache`).
const CachedBreakdown = z.object({
    entries: z.dict(z.object({
        at: z.number(),
        reply: z.object({
            ok: z.const(true),
            fetchedAt: z.number(),
            windows: z.array(z.object({
                label: z.string(),
                requests: z.number(),
                sessions: z.number(),
                behaviours: z.array(z.string()),
                groups: z.array(z.object({
                    label: z.string(),
                    drivers: z.array(z.object({ name: z.string(), pct: z.number() })),
                })),
            })),
        }),
    })),
});
/** The persisted usage-breakdown cache, or undefined when the file is not the shape the reader
 *  needs: an older build's, a torn write, a hand edit. Undefined means "no cache", and the next
 *  open spawns and rewrites it, which is exactly the degradation a stale file should get. */
export function parseBreakdownCache(text) {
    let parsed;
    try {
        parsed = CachedBreakdown(JSON.parse(text));
    }
    catch {
        return undefined;
    }
    // The validator fills a missing field in rather than rejecting it: a missing list comes back
    // empty, and a missing `reply` comes back as `{}`, with `ok: true` not enforced. Measured, not
    // assumed. The first half is what makes an old file safe, since the crash was `.map` on a list
    // that was not there and an empty list renders nothing. The second half would serve an entry
    // that is not a reply at all, so `ok` is checked here by hand.
    const out = {};
    for (const [key, entry] of Object.entries(parsed.entries))
        if (entry.reply.ok === true)
            out[key] = entry;
    return out;
}
/** Serve `/dsh-oh-my-claude/usage` (`?force=1` refreshes sooner) from a small cache. */
export function registerUsageRoute(ctx, log, identity, options) {
    const defaultHome = options?.home;
    const boxFor = options?.boxFor;
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
    // Keyed per box: an ssh box's login is its own, whichever local dir its mount names.
    const read = (force, home, sshHost) => {
        const key = sshHost ? `ssh:${sshHost}` : home;
        if (Date.now() < (rateLimitedUntil.get(key) ?? 0))
            return Promise.resolve(rateLimited(key));
        const entry = cached.get(key);
        const age = entry ? Date.now() - entry.at : Infinity;
        if (entry && age < (force ? FORCE_MIN_AGE_MS : CACHE_MS))
            return Promise.resolve(entry.reply);
        if (!inFlight.has(key)) {
            inFlight.set(key, readUsage(undefined, home, sshHost).then((reply) => {
                if (!reply.ok && reply.retryAfterMs)
                    rateLimitedUntil.set(key, Date.now() + Math.max(reply.retryAfterMs, RATE_LIMIT_FLOOR_MS));
                // One transient failure keeps the last good answer for its remaining cache life; the
                // fetch time is not refreshed, so a failure that persists surfaces once that life is over.
                if (reply.ok || !entry?.reply.ok || age >= CACHE_MS)
                    cached.set(key, { at: Date.now(), reply });
                inFlight.delete(key);
                return cached.get(key).reply;
            }));
        }
        return inFlight.get(key);
    };
    // Breakdown answers are cached per box, and unlike the plan windows this cache is also written
    // to disk. The read is a `claude -p "/usage"` spawn, measured at 3.6 s on the author's box, and
    // an in-memory cache alone meant every dsh restart threw the answer away and the next person to
    // open the meter paid the full wait. On disk, a restart costs nothing: the panel opens on the
    // last known figures and only an explicit Refresh spawns again.
    const bdFile = join(STATE_DIR, "usage-breakdown.json");
    const bdCached = new Map();
    const bdInFlight = new Map();
    let bdLoaded = false;
    /** Seed the memory cache from disk, once per process. A missing or unreadable file is a miss. */
    const bdLoad = async () => {
        if (bdLoaded)
            return;
        bdLoaded = true;
        const entries = await readFile(bdFile, "utf8")
            .then(parseBreakdownCache)
            .catch(() => undefined);
        if (entries === undefined)
            return;
        for (const [key, entry] of Object.entries(entries))
            if (!bdCached.has(key))
                bdCached.set(key, entry);
    };
    const bdSave = () => {
        void writeJson(bdFile, { entries: Object.fromEntries(bdCached) }).catch(() => {
            // A cache that cannot be written still works in memory; the next restart just pays again.
        });
    };
    const readBd = (force, realHome, command, sshHost) => {
        const key = sshHost ? `ssh:${sshHost}` : realHome;
        return bdLoad().then(() => {
            const entry = bdCached.get(key);
            // Any cached answer serves an ordinary open, however old: the figures cover 24 hours and
            // seven days, so a stale one is close enough, and spawning on open is the whole problem.
            // Only Refresh (`force`) spawns, and even then not twice within FORCE_MIN_AGE_MS.
            if (entry && (!force || Date.now() - entry.at < FORCE_MIN_AGE_MS))
                return entry.reply;
            if (!bdInFlight.has(key)) {
                bdInFlight.set(key, readUsageBreakdown(command, realHome, sshHost).then((reply) => {
                    if (reply.ok || !entry?.reply.ok) {
                        bdCached.set(key, { at: Date.now(), reply });
                        if (reply.ok)
                            bdSave();
                    }
                    bdInFlight.delete(key);
                    return bdCached.get(key).reply;
                }));
            }
            return bdInFlight.get(key);
        });
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
                    // Resolve the box for the requested provider; fall back to the default instance.
                    // An unknown provider id (instance gone after a reload) reads the default instance.
                    const provider = url.searchParams.get("provider");
                    const box = (provider && boxFor?.(provider)) || { home: defaultHome ?? "" };
                    if (url.pathname.endsWith("/breakdown")) {
                        const bdRealHome = box.realHome ?? options?.realHome ?? box.home;
                        const bdCommand = box.command ?? options?.command ?? "claude";
                        const [reply, who] = await Promise.all([
                            readBd(force, bdRealHome, bdCommand, box.sshHost),
                            identity(box.home, box.sshHost),
                        ]);
                        if (reply.ok && reply.windows.length === 0)
                            log("warn", "usage breakdown: no windows parsed (/usage text format may have changed)");
                        return send(200, { ...reply, ...who });
                    }
                    // The usage belongs to that box's login; say so, the browser hops between boxes.
                    const [reply, who] = await Promise.all([
                        read(force, box.home, box.sshHost),
                        identity(box.home, box.sshHost),
                    ]);
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