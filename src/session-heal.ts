// The plugin heals a session log dsh refuses, on its own: the repair core in session-repair.ts
// run from three places (the sweep at start, the open route, a wake that finds the session
// refused), each proving the result through dsh's own load before and after it writes.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { errorText } from "./process.js";
import {
  knownRefusal,
  migrate,
  readLog,
  repair,
  restoreBak,
  SURFACE,
  writeLog,
  type Catalog,
} from "./session-repair.js";
import {
  loadSessionRepairs,
  recordRepair,
  saveSessionRepairs,
  trace,
  type SessionRepairRecord,
  type SessionRepairsFile,
} from "./state.js";

/** A session log header as `list()` hands it: the id and cwd `locate` needs. */
export interface HealHeader {
  id: string;
  cwd?: string;
}

/** What the heal needs from dsh: the persistence service with the two calls the plugin's mirror
 *  type lacks today, and the catalog loader. `locate` is optional because dsh 0.1.5 and 0.1.6
 *  are not known to have it; without it the sweep has no path and skips, while the on-open and
 *  wake paths still work from the error text. */
export interface HealHost {
  persistence: {
    list(): Promise<Array<HealHeader | { header: HealHeader; sizeBytes?: number }>>;
    open(
      id: string,
      access: "read",
    ): Promise<{
      read?(offset: number): Promise<{ events: readonly { type: string }[] }>;
      close(): Promise<void>;
    }>;
    locate?(meta: { id: string; cwd?: string }): { kind: string; path: string };
  };
  /** dsh's catalog, or undefined when it cannot be found; then nothing is written. */
  catalog(): Promise<Catalog | undefined>;
  stateDir: string;
  log(level: "info" | "warn", message: string): void;
}

/** The plugin's own word for a log that loads today and is refused after its first live turn. */
export const HEADLESS = "headless";

/** The trace line for every verdict, in the same log the wake path writes. */
const note = (host: HealHost, line: string) => trace(join(host.stateDir, "resume.log"), line);

/** The header out of either shape `list()` answers. */
const headerOf = (item: HealHeader | { header: HealHeader }): HealHeader =>
  "header" in item ? item.header : item;

/** Ask dsh to load the log the way a click would, without taking its write lock. Undefined when
 *  it loads with a system head; the sentinel `"headless"` when it loads but its first surface
 *  row (`SURFACE`) is not a `system/message`, the shape a restore seeded before #101 that has
 *  not had a live turn yet (it loads today and is refused from the first reload after that
 *  turn); otherwise the refusal text. The headless check reads the events the read-open already
 *  decoded, so it costs no second parse. A not-found error reads as undefined: nothing to heal. */
export async function probeLoad(host: HealHost, id: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<HealHost["persistence"]["open"]>>;
  try {
    handle = await host.persistence.open(id, "read");
  } catch (e) {
    if (e instanceof Error && e.name === "SessionPersistenceNotFoundError") return undefined;
    return errorText(e);
  }
  try {
    const events = handle.read ? (await handle.read(0)).events : [];
    const first = events.find((e) => SURFACE.has(e.type));
    return first !== undefined && first.type !== "system/message" ? HEADLESS : undefined;
  } catch (e) {
    return errorText(e);
  } finally {
    await handle.close().catch(() => {});
  }
}

/** The path dsh named in a refusal, `(raw log: /abs/path)`, or undefined when the text has none. */
export function rawLogPath(message: string): string | undefined {
  return /\(raw log: ([^)]+)\)/.exec(message)?.[1];
}

/** `stat` the log for the record's freshness pair; zeros when the file is gone. */
async function statPair(path: string): Promise<{ mtimeMs: number; size: number }> {
  try {
    const st = await stat(path);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { mtimeMs: 0, size: 0 };
  }
}

/** Heal one refused log in place: decode, `repair()`, prove with the catalog, write with a
 *  `.bak`, prove again through dsh's own load, roll back if that second proof fails. Records the
 *  verdict under the session id and returns it. Never throws for a refusal; a file that cannot
 *  be read at all is recorded as `unknown` with the read error as its reason. */
export async function healLog(
  host: HealHost,
  id: string,
  path: string,
  reason: string,
): Promise<SessionRepairRecord> {
  const settle = async (record: SessionRepairRecord): Promise<SessionRepairRecord> => {
    await recordRepair(host.stateDir, id, record);
    const what = record.did
      ? `drops ${record.did.droppedCalls}, head ${record.did.addedHead}, closes ${record.did.closedCalls}`
      : (record.reason ?? "");
    await note(host, `heal ${id}: ${record.verdict} (${what}) ${path}`);
    if (record.verdict !== "fine")
      host.log(
        record.verdict === "healed" ? "info" : "warn",
        `session log ${record.verdict}: ${id} (${what})`,
      );
    return record;
  };
  const unknown = async (why: string): Promise<SessionRepairRecord> =>
    settle({
      path,
      ...(await statPair(path)),
      verdict: "unknown",
      reason: why.slice(0, 300),
      at: Date.now(),
    });
  let log: ReturnType<typeof readLog>;
  try {
    log = readLog(path);
  } catch (e) {
    return unknown(`read failed: ${errorText(e)}`);
  }
  const catalog = await host.catalog();
  if (catalog === undefined) return unknown("no session-format catalog");
  const fixed = repair(structuredClone(log.rows), log.header.version);
  const refused = migrate(catalog, log.header, structuredClone(fixed.rows));
  if (refused !== undefined) return unknown(refused);
  if (!fixed.addedHead && fixed.droppedCalls === 0 && fixed.closedCalls === 0)
    return unknown(`nothing to repair for: ${reason.slice(0, 200)}`);
  const bak = writeLog(path, log.header, fixed.rows);
  const did = {
    droppedCalls: fixed.droppedCalls,
    addedHead: fixed.addedHead,
    closedCalls: fixed.closedCalls,
  };
  const again = await probeLoad(host, id);
  if (again === undefined)
    return settle({ path, ...(await statPair(path)), verdict: "healed", bak, did, at: Date.now() });
  restoreBak(path, bak);
  return settle({
    path,
    ...(await statPair(path)),
    verdict: "rolled-back",
    reason: again.slice(0, 300),
    bak,
    at: Date.now(),
  });
}

/** Walk every stored current-version log once, skipping the ones whose stat matches their
 *  record, probing the rest through dsh and healing the known refusals. Runs to completion on
 *  its own; a throw on one log is recorded as `unknown` for that log and the walk goes on. Yields
 *  to the event loop between logs so a first sweep does not stall requests. A log whose located
 *  path does not exist is an older generation dsh migrates itself on its next write-open, and is
 *  skipped with no record. */
export async function sweepRefusedLogs(
  host: HealHost,
): Promise<{ healed: number; unknown: number; rolledBack: number }> {
  const zeros = { healed: 0, unknown: 0, rolledBack: 0 };
  const catalog = await host.catalog();
  if (catalog?.currentVersion === undefined) {
    host.log("warn", "sweep skipped: no session-format catalog");
    return zeros;
  }
  const locate = host.persistence.locate;
  if (locate === undefined) {
    host.log("info", "sweep skipped: this dsh does not locate a session's log");
    return zeros;
  }
  const file = await loadSessionRepairs(host.stateDir);
  const seen = new Set<string>();
  let fine = 0,
    healed = 0,
    unknown = 0,
    rolledBack = 0,
    unchanged = 0,
    older = 0;
  for (const item of await host.persistence.list()) {
    const header = headerOf(item);
    const path = locate.call(host.persistence, { id: header.id, cwd: header.cwd }).path;
    const pair = await statPair(path);
    if (pair.size === 0 && pair.mtimeMs === 0) {
      older++;
      continue;
    }
    seen.add(header.id);
    const prior = file.logs[header.id];
    if (prior && prior.mtimeMs === pair.mtimeMs && prior.size === pair.size) {
      unchanged++;
      continue;
    }
    try {
      const verdict = await probeLoad(host, header.id);
      if (verdict === undefined) {
        fine++;
        await recordRepair(host.stateDir, header.id, {
          path,
          ...pair,
          verdict: "fine",
          at: Date.now(),
        });
      } else if (knownRefusal(verdict)) {
        const record = await healLog(host, header.id, path, verdict);
        if (record.verdict === "healed") healed++;
        else if (record.verdict === "rolled-back") rolledBack++;
        else unknown++;
      } else {
        unknown++;
        await recordRepair(host.stateDir, header.id, {
          path,
          ...pair,
          verdict: "unknown",
          reason: verdict.slice(0, 300),
          at: Date.now(),
        });
      }
    } catch (e) {
      unknown++;
      await recordRepair(host.stateDir, header.id, {
        path,
        ...pair,
        verdict: "unknown",
        reason: errorText(e).slice(0, 300),
        at: Date.now(),
      });
    }
    await new Promise((r) => setImmediate(r));
  }
  const next = await loadSessionRepairs(host.stateDir);
  for (const [id, rec] of Object.entries(next.logs)) {
    const pair = await statPair(rec.path);
    if (pair.size === 0 && pair.mtimeMs === 0 && !seen.has(id)) delete next.logs[id];
  }
  next.lastSweepAt = Date.now();
  await saveSessionRepairs(host.stateDir, next);
  host.log(
    "info",
    `sweep: ${seen.size + older} logs, ${fine} fine, ${healed} healed, ${unknown} unknown, ${rolledBack} rolled back, ${unchanged} unchanged, ${older} older generation`,
  );
  return { healed, unknown, rolledBack };
}

/** What the panel's notice counts: verdicts newer than the dismissal, and the newest one's time. */
export interface RepairsSummary {
  healed: number;
  unknown: number;
  rolledBack: number;
  /** The newest counted entry's `at`, 0 when nothing counted; a dismissal records it. */
  at: number;
}

/** The summary the panel shows: entries newer than `seenAt`, counted by verdict, and the newest
 *  entry's time so a dismissal can name it. */
export function repairsSummary(file: SessionRepairsFile, seenAt: number): RepairsSummary {
  const out: RepairsSummary = { healed: 0, unknown: 0, rolledBack: 0, at: 0 };
  for (const rec of Object.values(file.logs)) {
    if (rec.at <= seenAt) continue;
    if (rec.verdict === "healed") out.healed++;
    else if (rec.verdict === "unknown") out.unknown++;
    else if (rec.verdict === "rolled-back") out.rolledBack++;
    else continue;
    out.at = Math.max(out.at, rec.at);
  }
  return out;
}
