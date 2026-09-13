// Is a newer release of this plugin on npm? One small read of the registry, cached in memory for a
// day, run beside the box's other status probes so it adds no wait of its own. dsh's plugin command
// is a pnpm wrapper over the profile, and neither npm nor dsh tells anyone a plugin has moved on, so
// the panel does: a pill on the This box row that names the version and copies the update command.

/** Registry answer for `<name>/latest`: only the version field is read. */
const REGISTRY = "https://registry.npmjs.org";

/** `a` and `b` as `[major, minor, patch]`; anything after a `-` (a prerelease tag) ranks below the
 *  same numbers without one, and a string that is not a version compares as nothing. */
function parse(v: string): [number, number, number, boolean] | undefined {
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
export function updateCommand(name: string, profile: string): string {
  return `dsh plugin --profile ${profile} update ${name}`;
}

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** A day between registry reads; an hour after a failed one, so a box that is offline does not
 *  retry on every panel open. */
const TTL_OK = 24 * 60 * 60_000;
const TTL_FAIL = 60 * 60_000;
const cache = new Map<string, { at: number; ttl: number; value: string | undefined }>();

/**
 * The newest published version of `name`, or undefined when the registry did not answer in time.
 * Memoised per name; `timeoutMs` bounds the one read so a slow registry cannot hold the status route.
 */
export async function latestVersion(
  name: string,
  fetchFn: FetchFn = fetch,
  now = Date.now(),
  timeoutMs = 2500,
): Promise<string | undefined> {
  const hit = cache.get(name);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  let value: string | undefined;
  try {
    const r = await fetchFn(`${REGISTRY}/${encodeURIComponent(name)}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) {
      // ponytail: the `/latest` document's top-level `version` is its first "version" key (the
      // nested maps hold ranges keyed by package name); a regex reads it without a JSON walk.
      // `parse` still has to accept it. Upgrade path: a typed decoder if the document grows one.
      const v = /"version"\s*:\s*"([^"]+)"/.exec(await r.text())?.[1];
      if (v && parse(v)) value = v;
    }
  } catch {
    // offline, blocked, or slow: the pill just does not show this time
  }
  cache.set(name, { at: now, ttl: value ? TTL_OK : TTL_FAIL, value });
  return value;
}

/** Test seam: forget what was read. */
export function forgetLatest(): void {
  cache.clear();
}
