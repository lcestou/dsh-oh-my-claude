/** `a` and `b` as `[major, minor, patch]`; anything after a `-` (a prerelease tag) ranks below the
 *  same numbers without one, and a string that is not a version compares as nothing. */
export declare function parse(v: string): [number, number, number, boolean] | undefined;
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
/** What the registry said about `name`'s latest release: its version, and the lowest dsh it runs on. */
export type LatestRelease = {
    version: string;
    dshFloor: string | undefined;
};
/** The lowest dsh a package.json (or the registry's copy of it) accepts, read off its dsh-llm peer
 *  range. The range is one bound, `^0.1.6-alpha.2`; the caret, tilde or `>=` in front is dropped
 *  and what is left must parse as a version. Absent or unreadable: undefined. */
export declare function dshFloor(packageJsonText: string): string | undefined;
/** True when `version` is `floor` or later, prerelease tags included: `0.1.6-alpha.2` reaches a
 *  floor of `0.1.6-alpha.1` and not one of `0.1.6`; `0.1.5-rc.2` reaches neither. Identifiers
 *  after the `-` compare dot by dot, numerically when both sides are numbers, as semver orders
 *  them. Unparseable input on either side is "no". */
export declare function atLeast(version: string, floor: string): boolean;
/**
 * The newest published release of `name`, or undefined when the registry did not answer in time.
 * Memoised per name; `timeoutMs` bounds the one read so a slow registry cannot hold the status route.
 */
export declare function latestRelease(name: string, fetchFn?: FetchFn, now?: number, timeoutMs?: number): Promise<LatestRelease | undefined>;
/** The newest published version of `name`; see `latestRelease`. */
export declare function latestVersion(name: string, fetchFn?: FetchFn, now?: number, timeoutMs?: number): Promise<string | undefined>;
/** Test seam: forget what was read. */
export declare function forgetLatest(): void;
export {};
