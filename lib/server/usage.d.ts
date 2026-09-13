import type { PluginContext } from "./dsh.js";
/** One rate-limit window as the panel shows it. */
export interface UsageWindow {
    label: string;
    usedPercent: number;
    /** Epoch ms, or null when the API did not say. */
    resetsAt: number | null;
}
/** Usage credits ("extra usage") as the panel shows them; the money is already display text. */
export interface UsageCredits {
    enabled: boolean;
    /** The spend cap is reached, so credits no longer cover a full window. */
    capped: boolean;
    /** Spent so far; absent when the payload stated no amount. */
    used?: string;
    /** The monthly limit or the cap, whichever the payload set. */
    limit?: string;
    canPurchase: boolean;
    /** The API's own disclaimer, markdown with at most one link, relayed verbatim. */
    note?: string;
}
/** What the route answers: the windows in display order, or why there are none. */
export type UsageReply = {
    ok: true;
    fetchedAt: number;
    windows: UsageWindow[];
    /** Paid extra usage is on and its own cap not reached: a full window does not block. */
    extraUsage?: boolean;
    credits?: UsageCredits;
    host?: string;
    email?: string | null;
} | {
    ok: false;
    error: string;
    windows?: undefined;
    host?: string;
    email?: string | null;
    /** Set only on a 429: ms to wait before the endpoint is worth touching again. */
    retryAfterMs?: number;
};
/**
 * The usage payload lists `limits` (kind `session`, `weekly_all`, `weekly_scoped` with a model
 * scope, and whatever kinds get added later); older answers carried `five_hour` / `seven_day`
 * objects with `utilization`. All read; unknown kinds keep their API name as the label.
 */
export declare function usageWindows(payload: unknown): UsageWindow[];
/**
 * The payload states credits twice: `spend` is the modern block, `extra_usage` the older parallel
 * one, so `spend` leads and `extra_usage` answers for a payload that predates it. Only `spend`
 * carries amounts as money objects; the scale of the legacy `used_credits` is not documented and
 * guessing it would print a wrong price, so a legacy-only payload shows its state without one.
 */
export declare function usageCredits(payload: unknown): UsageCredits;
/** Credits are on and their own cap not reached: a full plan window does not block a request. */
export declare function extraUsageOn(payload: unknown): boolean;
/** The subset of fetch the reader uses, so tests can hand in a fake. */
export type UsageFetch = (url: string, init: {
    headers: Record<string, string>;
    signal: AbortSignal;
}) => Promise<{
    status: number;
    headers?: {
        get(name: string): string | null;
    };
    json(): Promise<unknown>;
}>;
/** Read usage with the stored login; never throws, the panel shows the reason instead. An SSH
 *  box's usage is its own account's: its credentials come over ssh, the endpoint is asked from here. */
export declare function readUsage(fetchImpl?: UsageFetch, home?: string, sshHost?: string): Promise<UsageReply>;
/** The reset instant of a window still at its cap, or undefined when nothing blocks a request.
 *  A reply that could not be read answers undefined too: the wake then finds out by trying. */
export declare function stillLimitedUntil(reply: UsageReply, now?: number): number | undefined;
/** Serve `/dsh-oh-my-claude/usage` (`?force=1` refreshes sooner) from a small cache. */
export declare function registerUsageRoute(ctx: PluginContext, log: (level: string, msg: string) => void, identity: (home?: string, sshHost?: string) => Promise<{
    host: string;
    email: string | null;
}>, options?: {
    home?: string;
    /** The box a provider runs on: its local config dir, or the ssh host whose own login it uses. */
    boxFor?: (providerId: string) => {
        home: string;
        sshHost?: string;
    } | undefined;
}): void;
