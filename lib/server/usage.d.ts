import type { PluginContext } from "./dsh.js";
/** One rate-limit window as the panel shows it. */
export interface UsageWindow {
    label: string;
    usedPercent: number;
    /** Epoch ms, or null when the API did not say. */
    resetsAt: number | null;
    /** The API's own grade for the window (`normal`, `critical`, and whatever it adds), when sent. */
    severity?: string;
    /** For a window scoped to one model, that model's display name (`Fable`), as the API names it. */
    model?: string;
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
/** One driver of the plan-limit usage: the CLI's own name and its percent of the window. */
export interface UsageDriver {
    name: string;
    pct: number;
}
/** A "Top skills" / "Top MCP servers" / ... group under one window. */
export interface UsageDriverGroup {
    label: string;
    drivers: UsageDriver[];
}
/** One time window of the `/usage` breakdown (e.g. "Last 7d"). */
export interface UsageBreakdownWindow {
    label: string;
    requests: number;
    sessions: number;
    groups: UsageDriverGroup[];
    /** The CLI's own sentences about how the work was shaped, verbatim, in the order it prints them
     *  ("83% of your usage was at >150k context"). They are the most useful thing in the report and
     *  the parser used to drop them. Claude Code calls them independent characteristics rather than
     *  a breakdown, so they do not add to 100 and must never be summed or sorted with the groups. */
    behaviours: string[];
}
/** What the /breakdown route answers: the windows, or why there are none. */
export type UsageBreakdownReply = {
    ok: true;
    fetchedAt: number;
    windows: UsageBreakdownWindow[];
    host?: string;
    email?: string | null;
} | {
    ok: false;
    error: string;
    host?: string;
    email?: string | null;
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
/**
 * Parse the text `claude -p "/usage"` prints into its time windows, their driver groups and its
 * behaviour lines. The format is the CLI's own (2.1.x); a shape this does not recognise yields [],
 * which the caller degrades to an empty section rather than an error. A line under a window header
 * that is not a "Top …" group is kept verbatim as a behaviour ("91% of your usage was at >150k
 * context"): those sentences explain a bill that no named driver accounts for. English number
 * formatting and the CLI's `·` separator are assumed; a locale change would degrade the same way,
 * not throw.
 */
export declare function parseUsageBreakdown(text: string): UsageBreakdownWindow[];
/** Run `claude -p "/usage"` on a box and parse its breakdown. Never throws; the panel shows the
 *  reason. Local via execFile with the box's config dir; an ssh box over ssh with its own login.
 *  COLUMNS/TERM force a wide, dumb terminal so no "Top …" row wraps and loses its tail. */
export declare function readUsageBreakdown(command: string, realHome?: string, sshHost?: string): Promise<UsageBreakdownReply>;
/** The reset instant of a window still at its cap, or undefined when nothing blocks a request.
 *  A reply that could not be read answers undefined too: the wake then finds out by trying. */
export declare function stillLimitedUntil(reply: UsageReply, now?: number): number | undefined;
/** The persisted usage-breakdown cache, or undefined when the file is not the shape the reader
 *  needs: an older build's, a torn write, a hand edit. Undefined means "no cache", and the next
 *  open spawns and rewrites it, which is exactly the degradation a stale file should get. */
export declare function parseBreakdownCache(text: string): Record<string, {
    at: number;
    reply: UsageBreakdownReply;
}> | undefined;
/** Serve `/dsh-oh-my-claude/usage` (`?force=1` refreshes sooner) from a small cache. */
export declare function registerUsageRoute(ctx: PluginContext, log: (level: string, msg: string) => void, identity: (home?: string, sshHost?: string) => Promise<{
    host: string;
    email: string | null;
}>, options?: {
    home?: string;
    /** The account's real config dir for the default box: /usage reads its transcripts, not the mirror. */
    realHome?: string;
    /** The default box's `claude` command, for the /usage spawn. */
    command?: string;
    /** The box a provider runs on: its config dir, its real config dir, its `claude` command, or the ssh host whose own login it uses. */
    boxFor?: (providerId: string) => {
        home: string;
        sshHost?: string;
        realHome?: string;
        command?: string;
    } | undefined;
}): void;
