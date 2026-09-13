export interface AnthropicStatus {
    indicator: string;
    description: string;
}
type FetchFn = (url: string, init: {
    signal: AbortSignal;
}) => Promise<Response>;
/** What the last read said, without reading: undefined when nothing is cached or it expired. */
export declare function peekStatus(now?: number): AnthropicStatus | undefined;
/** Read the page, or answer the cached value; never throws; one read in flight at a time. */
export declare function anthropicStatus(fetchFn?: FetchFn, now?: number, timeoutMs?: number): Promise<AnthropicStatus | undefined>;
/** The suffix for an error line: empty for `none` or unknown, else ` · Anthropic reports <description>`. */
export declare function degradedNote(status: AnthropicStatus | undefined): string;
/** Test seam: forget what was read. */
export declare function forgetStatus(): void;
export {};
