import z from "@deepseek-ai/schemastery";
/**
 * Whether the box's `ANTHROPIC_BASE_URL` is a proxy that forwards to Anthropic.
 *
 * Claude Code assumes 200,000 tokens for its native-1M models whenever that variable names any
 * host but api.anthropic.com, and `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` is the CLI's own way
 * to say "it does reach Anthropic". The flag is Claude Code's, not any one proxy's, so the
 * question is about the endpoint rather than about which proxy is installed: headroom, a plain
 * reverse proxy and a company gateway all look the same from here, and only some of them forward.
 *
 * The answer is asked of the endpoint itself. An unauthenticated request to a proxy that forwards
 * is answered by Anthropic, so it comes back as Anthropic's own authentication error carrying an
 * Anthropic request id; a gateway that fronts another model provider answers in its own shape.
 * No key is sent, so this discloses nothing the base URL did not already know.
 */
/** Anthropic's request ids, in the body and in the header, for its errors and its answers alike. */
const ANTHROPIC_REQUEST_ID = /^req_[0-9A-Za-z]+$/;
/**
 * The slice of an error body this reads, as the API documents it:
 * `{ "type": "error", "error": { "type": "authentication_error", … }, "request_id": "req_…" }`.
 * Every field has a default, so an answer in any other shape parses to blanks and reads as "not
 * Anthropic" rather than throwing at the boundary.
 */
export const ProbeBody = z.object({
    type: z.string().default(""),
    request_id: z.string().default(""),
    error: z.object({ type: z.string().default("") }),
});
/**
 * Whether a parsed probe answer is Anthropic's: an Anthropic request id in the header or the body,
 * or failing both, the error shape the API documents. The id is asked for first because it is the
 * strong evidence: a gateway that fronts another provider mints its own error shape.
 */
export const readsAsAnthropic = (body, requestIdHeader) => {
    if (ANTHROPIC_REQUEST_ID.test(requestIdHeader))
        return true;
    if (ANTHROPIC_REQUEST_ID.test(body.request_id))
        return true;
    return body.type === "error" && body.error.type !== "";
};
/** `https://host/path/` and `https://host/path` both take one `/v1/messages`. */
export const messagesUrl = (baseUrl) => `${baseUrl.replace(/\/+$/, "")}/v1/messages`;
/**
 * Ask one base URL whether it reaches Anthropic.
 *
 * The request carries no key on purpose: the 401 that comes back is the evidence, and a proxy
 * that forwards passes Anthropic's own 401 through untouched. A timeout, a refused connection or
 * an unreadable answer is `undefined` rather than `false`. "Not asked" is not "not Anthropic",
 * and the caller leaves the flag off either way but can ask again later.
 */
export async function probeFirstParty(baseUrl, fetchImpl = fetch, timeoutMs = 4000) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
        const response = await fetchImpl(messagesUrl(baseUrl), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
            signal: abort.signal,
        });
        const raw = await response.json().catch(() => ({}));
        return readsAsAnthropic(ProbeBody(raw), response.headers.get("request-id") ?? "");
    }
    catch {
        return undefined;
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * The mode the hints store holds. Two flags rather than one tri-state value because the store
 * keeps booleans and numbers, and writing `false` clears a key: `proxyFirstParty` is an explicit
 * yes, `proxyFirstPartyOff` an explicit no, and neither is the default.
 */
export const firstPartyMode = (hints) => {
    if (hints.proxyFirstParty === true)
        return "on";
    if (hints.proxyFirstPartyOff === true)
        return "off";
    return "auto";
};
/**
 * Whether to set the flag for a local spawn.
 *
 * A choice someone made is kept whatever the endpoint says. Detection never turns a switch back
 * on that was turned off, which is the whole reason the third state exists. `auto` follows the
 * probe, and an unanswered probe leaves the flag off: the cost of missing it is a smaller context
 * window, the cost of claiming it wrongly is a session that believes a gateway can serve 1M.
 */
export const wantsFirstParty = (hints, detected) => {
    const mode = firstPartyMode(hints);
    if (mode === "on")
        return true;
    if (mode === "off")
        return false;
    return detected === true;
};
/** How long an answer stands before the endpoint is asked again. The software behind a URL
 *  rarely changes, but a router starts and stops, and something else can take its port. */
export const PROBE_TTL_MS = 60_000;
/** The answers kept per base URL and the requests in flight, on the process: dsh builds the
 *  adapter more than once at boot, and the question is about an endpoint, not an instance. */
const PROBES = Symbol.for("dsh-oh-my-claude.firstPartyProbes");
/** The process-wide store, made on first use. */
const probeStore = () => {
    // SAFETY: this plugin's own key on globalThis, typed here once
    const g = globalThis;
    return (g[PROBES] ??= { kept: new Map(), asking: new Map() });
};
/** Ask the endpoint now, one request per URL at a time, and keep what it says. An unanswered
 *  probe drops the kept answer: an endpoint that stopped answering is no longer known to be
 *  anything. */
const refreshFirstParty = (baseUrl, probe) => {
    const store = probeStore();
    const running = store.asking.get(baseUrl);
    if (running)
        return running;
    const asked = probe(baseUrl)
        .then((answer) => {
        if (answer === undefined)
            store.kept.delete(baseUrl);
        else
            store.kept.set(baseUrl, { at: Date.now(), answer });
        return answer;
    })
        .finally(() => store.asking.delete(baseUrl));
    store.asking.set(baseUrl, asked);
    return asked;
};
/**
 * Whether `baseUrl` reaches Anthropic, for a caller that can wait: a turn about to spawn a
 * process. A kept answer is returned at once, however old, and refreshed behind the caller when
 * it is past `PROBE_TTL_MS`, so only the first turn after a boot, or after the endpoint went
 * quiet, waits on the request. Unanswered is `undefined` and is asked again by the next caller.
 */
export async function firstPartyOf(baseUrl, probe = probeFirstParty, now = Date.now()) {
    const kept = probeStore().kept.get(baseUrl);
    if (kept && now - kept.at < PROBE_TTL_MS)
        return kept.answer;
    const asked = refreshFirstParty(baseUrl, probe);
    return kept ? kept.answer : asked;
}
/**
 * The same question for a caller that must not wait: a model listing, which the picker holds
 * open. Answers what is kept, `undefined` when nothing is, and asks the endpoint behind the
 * caller when the answer is missing or old. `changed` is called when that request comes back with
 * something other than what this call returned, so the caller can list again.
 */
export function firstPartyKnown(baseUrl, changed, probe = probeFirstParty, now = Date.now()) {
    const kept = probeStore().kept.get(baseUrl);
    if (kept && now - kept.at < PROBE_TTL_MS)
        return kept.answer;
    void refreshFirstParty(baseUrl, probe).then((answer) => {
        if (answer !== kept?.answer)
            changed();
    });
    return kept?.answer;
}
/** Forget every kept answer; tests start from an empty store. */
export const forgetFirstParty = () => {
    probeStore().kept.clear();
    probeStore().asking.clear();
};
//# sourceMappingURL=first-party.js.map