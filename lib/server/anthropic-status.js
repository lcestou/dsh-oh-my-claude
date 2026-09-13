// Anthropic's public status page, read only after the CLI reports a server-side API failure
// (5xx or 529) and cached so a burst of retries costs one read. Statuspage's summary document:
// `{ status: { indicator: "none" | "minor" | "major" | "critical", description: string } }`.
const STATUS_URL = "https://status.anthropic.com/api/v2/status.json";
/** A minute while the page answers; five when it does not, so an outage is not re-asked per retry. */
const TTL_OK = 60_000;
const TTL_FAIL = 5 * 60_000;
let cache;
let inflight;
/** What the last read said, without reading: undefined when nothing is cached or it expired. */
export function peekStatus(now = Date.now()) {
    if (!cache)
        return undefined;
    if (now - cache.at >= cache.ttl)
        return undefined;
    return cache.value;
}
/** Statuspage's summary shape, checked field by field: the page is not ours and may change. */
function isStatusDoc(v) {
    if (typeof v !== "object" || v === null || !("status" in v))
        return false;
    const s = v.status;
    if (typeof s !== "object" || s === null)
        return false;
    return ("indicator" in s &&
        typeof s.indicator === "string" &&
        "description" in s &&
        typeof s.description === "string");
}
/** Read the page, or answer the cached value; never throws; one read in flight at a time. */
export async function anthropicStatus(fetchFn = fetch, now = Date.now(), timeoutMs = 2500) {
    const hit = cache;
    if (hit && now - hit.at < hit.ttl)
        return hit.value;
    if (inflight)
        return inflight;
    inflight = (async () => {
        let value;
        try {
            const r = await fetchFn(STATUS_URL, { signal: AbortSignal.timeout(timeoutMs) });
            if (r.ok) {
                const doc = await r.json();
                if (isStatusDoc(doc))
                    value = doc.status;
            }
        }
        catch {
            // network, timeout, bad JSON: read as undefined
        }
        cache = { at: now, ttl: value ? TTL_OK : TTL_FAIL, value };
        return value;
    })();
    const result = await inflight;
    inflight = undefined;
    return result;
}
/** The suffix for an error line: empty for `none` or unknown, else ` · Anthropic reports <description>`. */
export function degradedNote(status) {
    if (!status || status.indicator === "none")
        return "";
    return ` · Anthropic reports ${status.description}`;
}
/** Test seam: forget what was read. */
export function forgetStatus() {
    cache = undefined;
    inflight = undefined;
}
//# sourceMappingURL=anthropic-status.js.map