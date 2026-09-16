// Is a newer Claude Code out for a box, and can this dsh install it? A headless `claude -p`, which
// is what the plugin runs, never updates itself: the CLI's updater is a component of its terminal
// UI (measured on 2.1.273, 2026-09-16). So this module does what that component does. It reads the
// release pointer the CLI reads, compares it to `claude --version` on the box, and runs
// `claude update` there when asked, or on its own when the box's switch is on. One record per box
// under `claude-updates.json` in the plugin's state dir keeps the two choices and the history.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isNewer, parse } from "./update.js";

/** The CLI's three release channels; `latest` is its default for an absent key. */
export type Channel = "latest" | "stable" | "rc";

/** One run of `claude update`, as the history under Tune shows it. */
export interface ClaudeUpdateEntry {
  at: number;
  /** `claude --version` before the run, or null when the box did not answer. */
  from: string | null;
  /** `claude --version` after the run, or null when the box did not answer. */
  to: string | null;
  by: "button" | "auto";
  /** True when `to` is a release after `from`. */
  ok: boolean;
  /** The CLI's last output line, kept for a failure and for a run it declined. */
  note?: string;
}

/** The record of one box, and the two choices around it. */
export interface ClaudeUpdates {
  /** Install a newer release on the next timer tick without asking. */
  auto?: true;
  /** The release the card was dismissed for; a newer one shows the card again. */
  skipped?: string;
  /** Newest last; at most 50 kept. */
  log: ClaudeUpdateEntry[];
}

/** The file: one record per box, keyed "this-box" or the ssh host. */
export type ClaudeUpdatesFile = Record<string, ClaudeUpdates>;

/** What the routes answer: the box, the two versions, why checks are off, and the record. */
export interface ClaudeUpdateState {
  host: string;
  label: string;
  installed: string | null;
  latest?: string;
  channel: Channel;
  off?: "DISABLE_AUTOUPDATER" | "DISABLE_UPDATES";
  checkedAt?: number;
  busy: boolean;
  auto: boolean;
  skipped?: string;
  log: ClaudeUpdateEntry[];
}

/** What the card above the composer needs: only when a release after `installed` is out. */
export interface ClaudeUpdateCard {
  host: string;
  label: string;
  installed: string;
  latest: string;
}

export type Exec = (args: string[], timeoutMs: number) => Promise<{ out: string; error?: string }>;
type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** The pointer the CLI's own updater reads: a plain-text version per channel. */
const CHANNEL_BASE = "https://downloads.claude.ai/claude-code-releases";

/** Half an hour between pointer reads, the CLI's own cadence; an hour after a failed one. */
const TTL_OK = 30 * 60_000;
const TTL_FAIL = 60 * 60_000;
const latestCache = new Map<string, { at: number; ttl: number; value: string | undefined }>();

/**
 * The newest Claude Code release on `channel`, or undefined when the pointer did not answer in time.
 * Memoised per channel; `timeoutMs` bounds the one read so a slow downloads host cannot hold the
 * status route. A response that does not parse as a version is treated as "no new release this tick".
 */
export async function latestClaude(
  channel: Channel,
  fetchFn: FetchFn = fetch,
  now = Date.now(),
  timeoutMs = 2500,
): Promise<string | undefined> {
  const hit = latestCache.get(channel);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  let value: string | undefined;
  try {
    const r = await fetchFn(`${CHANNEL_BASE}/${channel}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) {
      const v = (await r.text()).trim();
      if (parse(v)) value = v;
    }
  } catch {
    // offline, blocked, or slow: no card this time
  }
  latestCache.set(channel, { at: now, ttl: value ? TTL_OK : TTL_FAIL, value });
  return value;
}

/** Test seam: forget what was read. */
export function forgetLatestClaude(): void {
  latestCache.clear();
}

/**
 * The version the box reports from `claude --version`, or null when the binary is not on the path
 * or does not answer in time. Only the leading `<major>.<minor>.<patch>` segment matters.
 */
export async function installedClaude(exec: Exec): Promise<string | null> {
  const r = await exec(["--version"], 8000);
  const m = /^\d+\.\d+\.\d+/.exec(r.out.trim());
  return m?.[0] ?? null;
}

/** A parsed JSON document when it is a plain object, else undefined. */
const jsonObject = (text: string | undefined): Record<string, unknown> | undefined => {
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  // SAFETY: a non-null, non-array object parsed from JSON has only string keys.
  return value as Record<string, unknown>;
};

/** The user's release channel from settings, or `"latest"` when there is no key or it is unrecognised. */
export function channelFrom(settingsText: string | undefined): Channel {
  const c = jsonObject(settingsText)?.autoUpdatesChannel;
  if (c === "latest" || c === "stable" || c === "rc") return c;
  return "latest";
}

/** A value that counts as "on" when lower-cased and trimmed is one of the listed strings. */
const ON_VALUES = new Set(["1", "true", "yes", "on"]);

/** Check whether a single env string is an affirmative disable value. */
const isOn = (v: string | undefined): boolean =>
  v !== undefined && ON_VALUES.has(v.trim().toLowerCase());
/** A settings `env` value when it is a string; the file may hold anything. */
const asString = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * Which of the two disable knobs are set, if any: `DISABLE_UPDATES` before `DISABLE_AUTOUPDATER`,
 * or undefined when both are off and the settings file does not override them.
 */
export function offBy(
  env: NodeJS.ProcessEnv,
  settingsText: string | undefined,
): "DISABLE_AUTOUPDATER" | "DISABLE_UPDATES" | undefined {
  if (isOn(env.DISABLE_UPDATES)) return "DISABLE_UPDATES";
  if (isOn(env.DISABLE_AUTOUPDATER)) return "DISABLE_AUTOUPDATER";
  const rawEnv = jsonObject(settingsText)?.env;
  if (typeof rawEnv !== "object" || rawEnv === null || Array.isArray(rawEnv)) return undefined;
  // SAFETY: a non-null, non-array object from JSON; each value is re-checked by `asString`.
  const nested = rawEnv as Record<string, unknown>;
  if (isOn(asString(nested.DISABLE_UPDATES))) return "DISABLE_UPDATES";
  if (isOn(asString(nested.DISABLE_AUTOUPDATER))) return "DISABLE_AUTOUPDATER";
  return undefined;
}

/**
 * The last non-empty line of `out`, else the last non-empty line of `error ?? ""`, trimmed and
 * capped at 200 characters. Returns undefined when both strings are empty after trimming.
 */
export function lastLine(out: string, error: string | undefined): string | undefined {
  const lines = [out, error ?? ""].flatMap((s) => s.split("\n"));
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = (lines[i] ?? "").trim();
    if (t.length > 0) return t.slice(0, 200);
  }
  return undefined;
}

/** A log entry as it may appear in untrusted JSON. */
type RawEntry = {
  at?: unknown;
  by?: unknown;
  ok?: unknown;
  from?: unknown;
  to?: unknown;
  note?: unknown;
};

/** True when `e` has the shape of a ClaudeUpdateEntry; used to filter bad history rows. */
const isValidEntry = (e: RawEntry): e is ClaudeUpdateEntry => {
  if (typeof e.at !== "number" || !Number.isFinite(e.at)) return false;
  if (e.by !== "button" && e.by !== "auto") return false;
  if (typeof e.ok !== "boolean") return false;
  if (e.from !== null && typeof e.from !== "string") return false;
  if (e.to !== null && typeof e.to !== "string") return false;
  if (e.note !== undefined && typeof e.note !== "string") return false;
  return true;
};

/** The file as one read of it: the whole map, or nothing when it is missing or not an object. */
const readFileMap = async (dir: string): Promise<Record<string, unknown> | undefined> =>
  jsonObject(await readFile(join(dir, "claude-updates.json"), "utf8").catch(() => undefined));

/**
 * Load one box's record from `dir/claude-updates.json`, answering `{ log: [] }` when the file is
 * missing, unreadable, not an object, or the key has no `log` array. A malformed entry is dropped
 * on its own; the rest of the history stays.
 */
export async function readUpdates(dir: string, key: string): Promise<ClaudeUpdates> {
  const rec = (await readFileMap(dir))?.[key];
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return { log: [] };
  // SAFETY: a non-null, non-array object from JSON; every field is checked before use below.
  const raw = rec as Record<string, unknown>;
  if (!Array.isArray(raw.log)) return { log: [] };
  const result: ClaudeUpdates = {
    // SAFETY: `isValidEntry` checked every field of `e`; the filter keeps only those that passed.
    log: raw.log.filter((e): e is ClaudeUpdateEntry => isValidEntry(e as RawEntry)),
  };
  if (raw.auto === true) result.auto = true;
  if (typeof raw.skipped === "string" && parse(raw.skipped)) result.skipped = raw.skipped;
  return result;
}

let updatesChain = Promise.resolve();

/**
 * Persist one box's record under `dir/claude-updates.json`, serialised against other writers by a
 * module-level chain. Re-reads the whole file first so a concurrent save cannot lose an entry from
 * another box; truncates `log` to the newest 50 on every write. The directory is created with
 * `recursive: true` when it does not exist yet.
 */
export function writeUpdates(dir: string, key: string, data: ClaudeUpdates): Promise<void> {
  // The caller sees a failed write; the chain does not, or one full disk would fail every write
  // after it (the `holdsChain` idiom in state.ts).
  const write = updatesChain.then(async () => {
    const file: ClaudeUpdatesFile = {};
    // Other boxes' records are carried across unread; `readUpdates` checks a record when it is
    // asked for, so a malformed one costs its own box, not the file.
    for (const [k, v] of Object.entries((await readFileMap(dir)) ?? {})) {
      if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
      // SAFETY: a non-null, non-array object from the plugin's own file; re-checked on read.
      file[k] = v as ClaudeUpdates;
    }
    const rec: ClaudeUpdates = { log: data.log.slice(-50) };
    if (data.auto) rec.auto = true;
    if (data.skipped !== undefined) rec.skipped = data.skipped;
    file[key] = rec;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "claude-updates.json"), JSON.stringify(file, null, 2) + "\n");
  });
  updatesChain = write.catch(() => {});
  return write;
}

/** True when `state` has a newer release available and neither disable knob is on. */
export function newer(state: ClaudeUpdateState | undefined): boolean {
  return (
    state !== undefined &&
    state.off === undefined &&
    state.latest !== undefined &&
    state.installed !== null &&
    isNewer(state.installed, state.latest)
  );
}

/** A card to show the user when a newer release is out and auto-update is off and not dismissed. */
export function cardFor(state: ClaudeUpdateState | undefined): ClaudeUpdateCard | null {
  if (state === undefined || !newer(state)) return null;
  if (state.skipped === state.latest || state.auto) return null;
  // `newer` proved `installed` and `latest`; TypeScript cannot see through the call, so read
  // them again with the same checks rather than assert.
  if (state.installed === null || state.latest === undefined) return null;
  return { host: state.host, label: state.label, installed: state.installed, latest: state.latest };
}

export interface ClaudeUpdaterOptions {
  dir: string;
  host: string;
  label: string;
  /** Path of the box's user settings.json; undefined for a box whose file is not readable from here. */
  settingsPath?: string;
  env: NodeJS.ProcessEnv;
  exec: Exec;
  /** Called with `host` after a run that installed a new version. */
  onUpdated?: (host: string) => void;
  fetchFn?: FetchFn;
  now?: () => number;
  readSettings?: (path: string) => Promise<string | undefined>;
}

export class ClaudeUpdater {
  private readonly opts: ClaudeUpdaterOptions;
  private readonly key: string;
  private stateValue: ClaudeUpdateState;
  private loadPromise: Promise<void>;
  /** The run in flight, handed to every caller that asks while it lasts. */
  private running?: Promise<ClaudeUpdateEntry>;

  constructor(opts: ClaudeUpdaterOptions) {
    this.opts = {
      readSettings: (path) => readFile(path, "utf8").catch(() => undefined),
      now: Date.now,
      ...opts,
    };
    this.key = opts.host || "this-box";
    this.stateValue = {
      host: opts.host,
      label: opts.label,
      installed: null,
      channel: "latest",
      busy: false,
      auto: false,
      log: [],
    };
    this.loadPromise = this.load();
  }

  /** Read the persisted record into `auto`, `skipped` and `log`. */
  private async load(): Promise<void> {
    const rec = await readUpdates(this.opts.dir, this.key);
    this.stateValue = {
      ...this.stateValue,
      auto: rec.auto === true,
      skipped: rec.skipped,
      log: rec.log,
    };
  }

  /** The three fields the file keeps, out of the state. */
  private record(): ClaudeUpdates {
    const rec: ClaudeUpdates = { log: this.stateValue.log };
    if (this.stateValue.auto) rec.auto = true;
    if (this.stateValue.skipped !== undefined) rec.skipped = this.stateValue.skipped;
    return rec;
  }

  private tick(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** The last answer, no I/O. */
  state(): ClaudeUpdateState {
    return { ...this.stateValue, log: [...this.stateValue.log] };
  }

  /** Refresh installed, channel, off and latest. Never installs. */
  async check(): Promise<ClaudeUpdateState> {
    await this.loadPromise;
    const settings = this.opts.settingsPath
      ? await this.opts.readSettings?.(this.opts.settingsPath)
      : undefined;
    const off = offBy(this.opts.env, settings);
    const channel = channelFrom(settings);
    const installed = await installedClaude(this.opts.exec);
    const latest = off ? undefined : await latestClaude(channel, this.opts.fetchFn, this.tick());
    this.stateValue = {
      ...this.stateValue,
      channel,
      installed,
      latest,
      off,
      checkedAt: this.tick(),
    };
    return this.state();
  }

  /** Run `claude update` on the box; a second caller while one runs gets the same promise. */
  runUpdate(by: "button" | "auto"): Promise<ClaudeUpdateEntry> {
    if (this.running) return this.running;
    // `busy` flips before the first await: the POST route answers `state()` right after calling
    // this, and the card's first GET must not read the previous entry as this run's outcome.
    this.stateValue = { ...this.stateValue, busy: true };
    this.running = this.runOnce(by).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async runOnce(by: "button" | "auto"): Promise<ClaudeUpdateEntry> {
    await this.loadPromise;
    try {
      const from = this.stateValue.installed;
      const r = await this.opts.exec(["update"], 180_000);
      const to = await installedClaude(this.opts.exec);
      // Success is the version moving, not the CLI's wording: a later CLI may say it differently.
      const ok = to !== null && from !== null && isNewer(from, to);
      const note = lastLine(r.out, r.error);
      const entry: ClaudeUpdateEntry = { at: this.tick(), from, to, by, ok };
      if (note !== undefined) entry.note = note;
      const next = { ...this.stateValue, log: [...this.stateValue.log, entry], installed: to };
      // The CLI declined, was capped, or is on a slower channel than the pointer: do not offer
      // this release again; the entry's note says why in the CLI's words.
      if (!ok && next.latest !== undefined && (to === null || isNewer(to, next.latest)))
        next.skipped = next.latest;
      this.stateValue = next;
      await writeUpdates(this.opts.dir, this.key, this.record());
      if (ok) this.opts.onUpdated?.(this.opts.host);
      return entry;
    } finally {
      this.stateValue = { ...this.stateValue, busy: false };
    }
  }

  /** Toggle auto-update on or off and persist the change. */
  async setAuto(on: boolean): Promise<ClaudeUpdateState> {
    await this.loadPromise;
    this.stateValue = { ...this.stateValue, auto: on };
    await writeUpdates(this.opts.dir, this.key, this.record());
    return this.state();
  }

  /** Dismiss the card for `version`; refuse when it is not a parseable version. */
  async skip(version: string): Promise<ClaudeUpdateState> {
    await this.loadPromise;
    if (parse(version) === undefined) return this.state();
    this.stateValue = { ...this.stateValue, skipped: version };
    await writeUpdates(this.opts.dir, this.key, this.record());
    return this.state();
  }
}
