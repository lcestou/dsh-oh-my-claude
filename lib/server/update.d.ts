/** True when `latest` is a release after `current`. Unparseable input on either side is "no". */
export declare function isNewer(current: string, latest: string): boolean;
/** The profile the plugin is installed under, read off its own path: dsh installs plugins into
 *  `~/.dsh/profiles/<name>/node_modules/...`. A checkout linked from elsewhere has no such segment
 *  and gets the README's default. */
export declare function profileFromPath(path: string, fallback?: string): string;
/** The two lines that bring in a new version, as the README's Install section gives them. */
export declare function updateCommand(name: string, profile: string): string;
type FetchFn = (url: string, init: {
    signal: AbortSignal;
}) => Promise<Response>;
/**
 * The newest published version of `name`, or undefined when the registry did not answer in time.
 * Memoised per name; `timeoutMs` bounds the one read so a slow registry cannot hold the status route.
 */
export declare function latestVersion(name: string, fetchFn?: FetchFn, now?: number, timeoutMs?: number): Promise<string | undefined>;
/** Test seam: forget what was read. */
export declare function forgetLatest(): void;
export {};
