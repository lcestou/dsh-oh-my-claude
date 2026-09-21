// Is a newer release of this plugin on npm? One small read of the registry, cached in memory for a
// day, run beside the box's other status probes so it adds no wait of its own. dsh's plugin command
// is a pnpm wrapper over the profile, and neither npm nor dsh tells anyone a plugin has moved on, so
// the panel does: a pill on the This box row that names the version and copies the update command.

/** Registry answer for `<name>/latest`: only the version field is read. */
const REGISTRY = "https://registry.npmjs.org";

/** `a` and `b` as `[major, minor, patch]`; anything after a `-` (a prerelease tag) ranks below the
 *  same numbers without one, and a string that is not a version compares as nothing. */
export function parse(v: string): [number, number, number, boolean] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined];
}

/** True when `latest` is a release after `current`. Unparseable input on either side is "no". */
export function isNewer(current: string, latest: string): boolean {
  const a = parse(current);
  const b = parse(latest);
  if (!a || !b) return false;
  const [aMaj, aMin, aPat, aPre] = a;
  const [bMaj, bMin, bPat, bPre] = b;
  if (bMaj !== aMaj) return bMaj > aMaj;
  if (bMin !== aMin) return bMin > aMin;
  if (bPat !== aPat) return bPat > aPat;
  // Same numbers: a release beats a prerelease of it; otherwise equal.
  return aPre && !bPre;
}

/** The profile the plugin is installed under, read off its own path: dsh installs plugins into
 *  `~/.dsh/profiles/<name>/node_modules/...`. A checkout linked from elsewhere has no such segment
 *  and gets the README's default. */
export function profileFromPath(path: string, fallback = "web"): string {
  const m = /\/profiles\/([^/]+)\/node_modules\//.exec(path);
  return m?.[1] ?? fallback;
}

/** The two lines that bring in a new version, as the README's Install section gives them. */
export function updateCommand(name: string, profile: string): string | undefined {
  // DSH Desktop owns the `desktop` profile and the dsh CLI refuses it, so a copied command would
  // only fail; Desktop users update from the app's own Plugin Manager instead.
  if (profile === "desktop") return undefined;
  return `dsh plugin --profile ${profile} update ${name}`;
}

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** A day between registry reads; an hour after a failed one, so a box that is offline does not
 *  retry on every panel open. */
const TTL_OK = 24 * 60 * 60_000;
const TTL_FAIL = 60 * 60_000;
/** What the registry said about `name`'s latest release: its version, and the lowest dsh it runs on. */
export type LatestRelease = { version: string; dshFloor: string | undefined };
const cache = new Map<string, { at: number; ttl: number; value: LatestRelease | undefined }>();

/** The dsh peer the plugin declares (`@deepseek-ai/dsh-llm`), and its lowest accepted version. */
const DSH_PEER = "@deepseek-ai/dsh-llm";
const PEER_RANGE = new RegExp(`"${DSH_PEER}"\\s*:\\s*"[\\^~>=\\s]*([^"\\s]+)"`);

/** The lowest dsh a package.json (or the registry's copy of it) accepts, read off its dsh-llm peer
 *  range. The range is one bound, `^0.1.6-alpha.2`; the caret, tilde or `>=` in front is dropped
 *  and what is left must parse as a version. Absent or unreadable: undefined. */
export function dshFloor(packageJsonText: string): string | undefined {
  const v = PEER_RANGE.exec(packageJsonText)?.[1];
  return v && parse(v) ? v : undefined;
}

/** The dot-separated identifiers after a version's `-`: `0.1.6-alpha.2` gives `["alpha", "2"]`. */
const prereleaseIds = (v: string) => v.trim().split("-").slice(1).join("-").split(".");

/** True when `version` is `floor` or later, prerelease tags included: `0.1.6-alpha.2` reaches a
 *  floor of `0.1.6-alpha.1` and not one of `0.1.6`; `0.1.5-rc.2` reaches neither. Identifiers
 *  after the `-` compare dot by dot, numerically when both sides are numbers, as semver orders
 *  them. Unparseable input on either side is "no". */
export function atLeast(version: string, floor: string): boolean {
  const a = parse(version);
  const b = parse(floor);
  if (!a || !b) return false;
  const [aMaj, aMin, aPat, aPre] = a;
  const [bMaj, bMin, bPat, bPre] = b;
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  if (aPat !== bPat) return aPat > bPat;
  if (!aPre) return true; // a release reaches any prerelease of its number
  if (!bPre) return false; // a prerelease never reaches its release
  const at = prereleaseIds(version);
  const bt = prereleaseIds(floor);
  for (let i = 0; i < Math.max(at.length, bt.length); i++) {
    const x = at[i];
    const y = bt[i];
    if (x === undefined) return false; // fewer identifiers ranks lower
    if (y === undefined) return true;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) > Number(y);
    if (xn !== yn) return yn; // numbers rank below words
    return x > y;
  }
  return true;
}

/**
 * The newest published release of `name`, or undefined when the registry did not answer in time.
 * Memoised per name; `timeoutMs` bounds the one read so a slow registry cannot hold the status route.
 */
export async function latestRelease(
  name: string,
  fetchFn: FetchFn = fetch,
  now = Date.now(),
  timeoutMs = 2500,
): Promise<LatestRelease | undefined> {
  const hit = cache.get(name);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  let value: LatestRelease | undefined;
  try {
    const r = await fetchFn(`${REGISTRY}/${encodeURIComponent(name)}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) {
      // ponytail: the `/latest` document's top-level `version` is its first "version" key (the
      // nested maps hold ranges keyed by package name); a regex reads it without a JSON walk.
      // `parse` still has to accept it. Upgrade path: a typed decoder if the document grows one.
      const text = await r.text();
      const v = /"version"\s*:\s*"([^"]+)"/.exec(text)?.[1];
      if (v && parse(v)) value = { version: v, dshFloor: dshFloor(text) };
    }
  } catch {
    // offline, blocked, or slow: the pill just does not show this time
  }
  cache.set(name, { at: now, ttl: value ? TTL_OK : TTL_FAIL, value });
  return value;
}

/** The newest published version of `name`; see `latestRelease`. */
export async function latestVersion(
  name: string,
  fetchFn: FetchFn = fetch,
  now = Date.now(),
  timeoutMs = 2500,
): Promise<string | undefined> {
  return (await latestRelease(name, fetchFn, now, timeoutMs))?.version;
}

/** Test seam: forget what was read. */
export function forgetLatest(): void {
  cache.clear();
}
