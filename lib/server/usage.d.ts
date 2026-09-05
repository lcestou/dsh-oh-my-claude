import type { PluginContext } from "./dsh.js";
/** One rate-limit window as the panel shows it. */
export interface UsageWindow {
    label: string;
    usedPercent: number;
    /** Epoch ms, or null when the API did not say. */
    resetsAt: number | null;
}
/** What the route answers: the windows in display order, or why there are none. */
export type UsageReply = {
    ok: true;
    fetchedAt: number;
    windows: UsageWindow[];
} | {
    ok: false;
    error: string;
    windows?: undefined;
};
/**
 * The usage payload lists `limits` (kind `session`, `weekly_all`, `weekly_scoped` with a model
 * scope); older answers carried `five_hour` / `seven_day` objects with `utilization`. Both read.
 */
export declare function usageWindows(payload: unknown): UsageWindow[];
/** The subset of fetch the reader uses, so tests can hand in a fake. */
export type UsageFetch = (url: string, init: {
    headers: Record<string, string>;
    signal: AbortSignal;
}) => Promise<{
    status: number;
    json(): Promise<unknown>;
}>;
/** Read usage with the stored login; never throws, the panel shows the reason instead. */
export declare function readUsage(fetchImpl?: UsageFetch): Promise<UsageReply>;
/** Serve `/dsh-llm-claude/usage` (`?force=1` refreshes sooner) from a small cache. */
export declare function registerUsageRoute(ctx: PluginContext, log: (level: string, msg: string) => void): void;
