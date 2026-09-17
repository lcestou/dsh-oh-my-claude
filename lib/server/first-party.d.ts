import z from "@deepseek-ai/schemastery";
/**
 * The slice of an error body this reads, as the API documents it:
 * `{ "type": "error", "error": { "type": "authentication_error", … }, "request_id": "req_…" }`.
 * Every field has a default, so an answer in any other shape parses to blanks and reads as "not
 * Anthropic" rather than throwing at the boundary.
 */
export declare const ProbeBody: z<Schemastery.ObjectS<{
    type: z<string, string>;
    request_id: z<string, string>;
    error: z<Schemastery.ObjectS<{
        type: z<string, string>;
    }>, Schemastery.ObjectT<{
        type: z<string, string>;
    }>>;
}>, Schemastery.ObjectT<{
    type: z<string, string>;
    request_id: z<string, string>;
    error: z<Schemastery.ObjectS<{
        type: z<string, string>;
    }>, Schemastery.ObjectT<{
        type: z<string, string>;
    }>>;
}>>;
export type ProbeBody = ReturnType<typeof ProbeBody>;
/** One reading of the endpoint. `undefined` means the question could not be answered. */
export type FirstPartyProbe = boolean | undefined;
/**
 * Whether a parsed probe answer is Anthropic's: an Anthropic request id in the header or the body,
 * or failing both, the error shape the API documents. The id is the strong evidence — a gateway
 * that fronts another provider mints its own — so it is asked for first.
 */
export declare const readsAsAnthropic: (body: ProbeBody, requestIdHeader: string) => boolean;
/**
 * Ask one base URL whether it reaches Anthropic.
 *
 * The request carries no key on purpose: the 401 that comes back is the evidence, and a proxy
 * that forwards passes Anthropic's own 401 through untouched. A timeout, a refused connection or
 * an unreadable answer is `undefined` rather than `false` — "not asked" is not "not Anthropic",
 * and the caller leaves the flag off either way but can ask again later.
 */
export declare function probeFirstParty(baseUrl: string, fetchImpl?: typeof fetch, timeoutMs?: number): Promise<FirstPartyProbe>;
/** What the Settings control is set to. Absent keys mean `auto`, which is the default. */
export type FirstPartyMode = "auto" | "on" | "off";
/**
 * The mode the hints store holds. Two flags rather than one tri-state value because the store
 * keeps booleans and numbers, and writing `false` clears a key: `proxyFirstParty` is an explicit
 * yes, `proxyFirstPartyOff` an explicit no, and neither is the default.
 */
export declare const firstPartyMode: (hints: Record<string, boolean | number>) => FirstPartyMode;
/**
 * Whether to set the flag for a local spawn.
 *
 * A choice someone made is kept whatever the endpoint says — detection never turns a switch back
 * on that was turned off, which is the whole reason the third state exists. `auto` follows the
 * probe, and an unanswered probe leaves the flag off: the cost of missing it is a smaller context
 * window, the cost of claiming it wrongly is a session that believes a gateway can serve 1M.
 */
export declare const wantsFirstParty: (hints: Record<string, boolean | number>, detected: FirstPartyProbe) => boolean;
