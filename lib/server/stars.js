// Does this repo have more stars today than the panel shows? One small read of GitHub's repo JSON,
// cached in memory for a day, run beside the box's other status probes so it adds no wait of its
// own. The count rides the /status route as a one-line nudge in Settings: a line that says how many
// people have starred the repo. The repo and its URL live here in one place, so the server's read
// and the link the client later shows cannot drift apart.
/** The repo whose stars the panel shows. One place, so the client's link and the server's read
 *  cannot drift apart. */
export const STAR_REPO = "lcestou/dsh-oh-my-claude";
export const REPO_URL = "https://github.com/lcestou/dsh-oh-my-claude";
/** `stargazers_count` from the repo JSON, or undefined when the field is missing or is not a
 *  finite count. A negative or fractional number is treated as missing rather than shown. */
export function stargazerCount(text) {
    // `JSON.parse` is typed loosely enough to land in this shape without an assertion, and every
    // other shape the endpoint could send (an error object, an array, a bare number) reads as an
    // absent field below rather than throwing here.
    let body;
    try {
        body = JSON.parse(text);
    }
    catch {
        return undefined; // not JSON at all: an error page, or a body cut short
    }
    const raw = body?.stargazers_count;
    // Zero is a real answer, so this tests the type and the range and never truthiness.
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0)
        return undefined;
    return raw;
}
/** A day between successful reads; an hour after a failed one, so a box that is rate-limited or
 *  offline does not retry on every panel open. */
const TTL_OK = 24 * 60 * 60_000;
const TTL_FAIL = 60 * 60_000;
const cache = new Map();
/** The cached count, or undefined when GitHub did not answer in time. Memoised for an hour the way
 *  `latestRelease` is, and a failed read is retried after an hour rather than on every panel open:
 *  the unauthenticated API allows sixty calls an hour and a panel is opened far more often. */
export async function stars(fetchFn = fetch, now = Date.now(), timeoutMs = 2500) {
    const hit = cache.get(STAR_REPO);
    if (hit && now - hit.at < hit.ttl)
        return hit.value;
    let value;
    try {
        const r = await fetchFn(`https://api.github.com/repos/${STAR_REPO}`, {
            headers: { Accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (r.ok) {
            // A 403 from the rate limiter or a 404 after a rename still carries a body; only read it
            // when GitHub actually answered, so an error page is never parsed as a count.
            value = stargazerCount(await r.text());
        }
    }
    catch {
        // offline, rate-limited, or slow: the nudge just does not show this time
    }
    // `value !== undefined`, not a truthy test: a repo with no stars yet answers 0, and treating
    // that as a failed read would retry GitHub every hour forever.
    cache.set(STAR_REPO, { at: now, ttl: value !== undefined ? TTL_OK : TTL_FAIL, value });
    return value;
}
/** Test seam: forget what was read. */
export function forgetStars() {
    cache.clear();
}
//# sourceMappingURL=stars.js.map