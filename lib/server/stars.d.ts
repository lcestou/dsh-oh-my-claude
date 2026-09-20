/** The repo whose stars the panel shows. One place, so the client's link and the server's read
 *  cannot drift apart. */
export declare const STAR_REPO = "lcestou/dsh-oh-my-claude";
export declare const REPO_URL = "https://github.com/lcestou/dsh-oh-my-claude";
/** `stargazers_count` from the repo JSON, or undefined when the field is missing or is not a
 *  finite count. A negative or fractional number is treated as missing rather than shown. */
export declare function stargazerCount(text: string): number | undefined;
type FetchFn = (url: string, init: {
    signal: AbortSignal;
    headers?: Record<string, string>;
}) => Promise<Response>;
/** The cached count, or undefined when GitHub did not answer in time. Memoised for an hour the way
 *  `latestRelease` is, and a failed read is retried after an hour rather than on every panel open:
 *  the unauthenticated API allows sixty calls an hour and a panel is opened far more often. */
export declare function stars(fetchFn?: FetchFn, now?: number, timeoutMs?: number): Promise<number | undefined>;
/** Test seam: forget what was read. */
export declare function forgetStars(): void;
export {};
