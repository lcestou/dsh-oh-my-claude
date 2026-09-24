// The plugin heals a session log dsh refuses, on its own: the repair core in session-repair.ts
// run from three places (the sweep at start, the open route, a wake that finds the session
// refused), each proving the result through dsh's own load before and after it writes.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { errorText } from "./process.js";
import { knownRefusal, migrate, readLog, repair, restoreBak, SURFACE, writeLog, } from "./session-repair.js";
import { loadSessionRepairs, recordRepair, saveSessionRepairs, trace, } from "./state.js";
/** The plugin's own word for a log that loads today and is refused after its first live turn. */
export const HEADLESS = "headless";
/** The trace line for every verdict, in the same log the wake path writes. */
const note = (host, line) => trace(join(host.stateDir, "resume.log"), line);
/** The header out of either shape `list()` answers. */
const headerOf = (item) => "header" in item ? item.header : item;
/** Ask dsh to load the log the way a click would, without taking its write lock. Undefined when
 *  it loads with a system head; the sentinel `"headless"` when it loads but its first surface
 *  row (`SURFACE`) is not a `system/message`, the shape a restore seeded before #101 that has
 *  not had a live turn yet (it loads today and is refused from the first reload after that
 *  turn); otherwise the refusal text. The headless check reads the events the read-open already
 *  decoded, so it costs no second parse. A not-found error reads as undefined: nothing to heal. */
export async function probeLoad(host, id) {
    let handle;
    try {
        handle = await host.persistence.open(id, "read");
    }
    catch (e) {
        if (e instanceof Error && e.name === "SessionPersistenceNotFoundError")
            return undefined;
        return errorText(e);
    }
    try {
        const events = handle.read ? (await handle.read(0)).events : [];
        const first = events.find((e) => SURFACE.has(e.type));
        return first !== undefined && first.type !== "system/message" ? HEADLESS : undefined;
    }
    catch (e) {
        return errorText(e);
    }
    finally {
        await handle.close().catch(() => { });
    }
}
/** The path dsh named in a refusal, `(raw log: /abs/path)`, or undefined when the text has none. */
export function rawLogPath(message) {
    return /\(raw log: ([^)]+)\)/.exec(message)?.[1];
}
/** `stat` the log for the record's freshness pair; zeros when the file is gone. */
async function statPair(path) {
    try {
        const st = await stat(path);
        return { mtimeMs: st.mtimeMs, size: st.size };
    }
    catch {
        return { mtimeMs: 0, size: 0 };
    }
}
/** Heal one refused log in place: decode, `repair()`, prove with the catalog, write with a
 *  `.bak`, prove again through dsh's own load, roll back if that second proof fails. Records the
 *  verdict under the session id and returns it. Never throws for a refusal; a file that cannot
 *  be read at all is recorded as `unknown` with the read error as its reason. */
export async function healLog(host, id, path, reason) {
    const settle = async (record) => {
        await recordRepair(host.stateDir, id, record);
        const what = record.did
            ? `drops ${record.did.droppedCalls}, head ${record.did.addedHead}, closes ${record.did.closedCalls}`
            : (record.reason ?? "");
        await note(host, `heal ${id}: ${record.verdict} (${what}) ${path}`);
        if (record.verdict !== "fine")
            host.log(record.verdict === "healed" ? "info" : "warn", `session log ${record.verdict}: ${id} (${what})`);
        return record;
    };
    const unknown = async (why) => settle({
        path,
        ...(await statPair(path)),
        verdict: "unknown",
        reason: why.slice(0, 300),
        at: Date.now(),
    });
    let log;
    try {
        log = readLog(path);
    }
    catch (e) {
        return unknown(`read failed: ${errorText(e)}`);
    }
    const catalog = await host.catalog();
    if (catalog === undefined)
        return unknown("no session-format catalog");
    const fixed = repair(structuredClone(log.rows), log.header.version);
    const refused = migrate(catalog, log.header, structuredClone(fixed.rows));
    if (refused !== undefined)
        return unknown(refused);
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
export async function sweepRefusedLogs(host) {
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
    const seen = new Set();
    let fine = 0, healed = 0, unknown = 0, rolledBack = 0, unchanged = 0, older = 0;
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
        // A log that loaded, or was healed, is not probed again until it changes. One still refused
        // (`unknown`, `rolled-back`) is probed on every sweep: a later plugin may mend what this one
        // could not, and the file's stat says nothing about that. Those are few, and a probe is one
        // read-open.
        const settled = prior?.verdict === "fine" || prior?.verdict === "healed";
        if (prior && settled && prior.mtimeMs === pair.mtimeMs && prior.size === pair.size) {
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
            }
            else if (knownRefusal(verdict)) {
                const record = await healLog(host, header.id, path, verdict);
                if (record.verdict === "healed")
                    healed++;
                else if (record.verdict === "rolled-back")
                    rolledBack++;
                else
                    unknown++;
            }
            else {
                unknown++;
                await recordRepair(host.stateDir, header.id, {
                    path,
                    ...pair,
                    verdict: "unknown",
                    reason: verdict.slice(0, 300),
                    at: Date.now(),
                });
            }
        }
        catch (e) {
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
        if (pair.size === 0 && pair.mtimeMs === 0 && !seen.has(id))
            delete next.logs[id];
    }
    next.lastSweepAt = Date.now();
    await saveSessionRepairs(host.stateDir, next);
    host.log("info", `sweep: ${seen.size + older} logs, ${fine} fine, ${healed} healed, ${unknown} unknown, ${rolledBack} rolled back, ${unchanged} unchanged, ${older} older generation`);
    return { healed, unknown, rolledBack };
}
/** The summary the panel shows: entries newer than `seenAt`, counted by verdict, and the newest
 *  entry's time so a dismissal can name it. */
export function repairsSummary(file, seenAt) {
    const out = { healed: 0, unknown: 0, rolledBack: 0, at: 0 };
    for (const rec of Object.values(file.logs)) {
        if (rec.at <= seenAt)
            continue;
        if (rec.verdict === "healed")
            out.healed++;
        else if (rec.verdict === "unknown")
            out.unknown++;
        else if (rec.verdict === "rolled-back")
            out.rolledBack++;
        else
            continue;
        out.at = Math.max(out.at, rec.at);
    }
    return out;
}
//# sourceMappingURL=session-heal.js.map