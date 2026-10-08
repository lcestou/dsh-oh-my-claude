// Stored turn records written before 2026-10-07 can hold a session's running total where one
// turn's cost belongs. The CLI carries `total_cost_usd` and `duration_api_ms` from one process to
// the next, and the plugin counted each new process from zero, so the first turn after a relaunch
// or a dsh restart was stored with everything the session had cost so far. This puts such a
// record back to its own share, from what the transcript and the neighbouring records still say.
import { access, copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { costStatesOf } from "./process.js";
/** API time this far past the turn's own wall time marks a record as a running total. A turn
 *  cannot spend longer waiting on the API than it took, give or take the clocks. */
const OVER_WALL = 1.05;
/** Whether a record looks like a running total: a cost, more API time than the turn lasted, and
 *  either no totals of its own on record or a cost equal to its own total. The second kind was
 *  written on 2026-10-07 by a handle attached before the records had loaded. */
const suspect = (t) => t.costUsd > 0 &&
    t.apiMs > t.durationMs * OVER_WALL &&
    (t.costTotal === undefined || t.costUsd >= t.costTotal - 1e-9);
/**
 * A session's records with each running total put back to that turn's own share.
 *
 * A suspect record's figures are taken as the session's totals at the end of that turn. What the
 * session stood at before it is the largest total known to be smaller: one the CLI wrote to the
 * transcript when a process exited (`exits`), or the total the records before it add up to. The
 * difference is the turn's own.
 *
 * That base can be too low (a process that died without writing its totals, records dropped off
 * the front of the ring) or missing, and then the difference still holds turns that are not this
 * one, which shows as API time longer than the turn. Such a record is cut to the turn's length at
 * the rate the figure itself implies: cost per second of API time, times the seconds the turn
 * lasted. That is an estimate, an upper one for a turn that ran one call at a time. The one record
 * left as stored is the first of a session whose records are all still here, where the total and
 * the turn are the same figure.
 *
 * Wrong in one case: a turn that really did spend longer on the API than it lasted, by running
 * subagents side by side, is read as a total and comes out too low.
 * @param exits totals from the transcript's `cost-state` rows, in any order
 * @param whole the session's first record is still among `turns` (the ring has not dropped any)
 * @returns the records, repaired ones as copies, and how many changed
 */
export function repairTurns(turns, exits, whole = true) {
    const out = [];
    let repaired = 0;
    // Where the session's totals stand after the record just read, when that can be told.
    let known;
    for (const [index, turn] of turns.entries()) {
        if (!suspect(turn) && turn.costTotal !== undefined && turn.apiTotal !== undefined) {
            known = { costUsd: turn.costTotal, apiMs: turn.apiTotal };
            out.push(turn);
            continue;
        }
        if (!suspect(turn)) {
            if (known)
                known = { costUsd: known.costUsd + turn.costUsd, apiMs: known.apiMs + turn.apiMs };
            out.push(turn);
            continue;
        }
        let base;
        for (const candidate of known ? [known, ...exits] : exits) {
            // Strictly below in cost: the row a process wrote when this very turn ended it is equal.
            if (candidate.costUsd >= turn.costUsd - 1e-9 || candidate.apiMs > turn.apiMs)
                continue;
            if (candidate.costUsd <= 0)
                continue;
            if (base === undefined || candidate.costUsd > base.costUsd)
                base = candidate;
        }
        known = { costUsd: turn.costUsd, apiMs: turn.apiMs };
        if (base === undefined && whole && index === 0) {
            out.push(turn);
            continue;
        }
        let costUsd = turn.costUsd - (base?.costUsd ?? 0);
        let apiMs = turn.apiMs - (base?.apiMs ?? 0);
        if (apiMs > turn.durationMs * OVER_WALL) {
            costUsd *= turn.durationMs / apiMs;
            apiMs = turn.durationMs;
        }
        repaired += 1;
        out.push({ ...turn, costUsd, apiMs });
    }
    return { turns: out, repaired };
}
/** The marker a finished pass leaves, so the next start does not run it again. */
export const REPAIR_MARKER = (stateDir) => join(stateDir, "turns-repaired.json");
/**
 * Repair every stored session once. Before anything is rewritten, `turns.json` is copied to
 * `turns.json.before-repair`, so the stored figures are one file move from back. A pass that
 * finds a marker does nothing and answers undefined. Transcripts are read from this box only: a
 * session that ran on an SSH box, or whose transcript is gone, is repaired from its own records
 * alone. A session that cannot be read or saved is skipped, and the marker is still written, so a
 * broken file does not make every start read every transcript again.
 */
export async function repairStoredTurns(host) {
    const marker = REPAIR_MARKER(host.stateDir);
    try {
        await access(marker);
        return undefined;
    }
    catch {
        // no marker: this is the first pass
    }
    const transcripts = new Map();
    const root = join(host.claudeHome, "projects");
    for (const dir of await readdir(root).catch(() => []))
        for (const name of await readdir(join(root, dir)).catch(() => []))
            if (name.endsWith(".jsonl"))
                transcripts.set(name.slice(0, -".jsonl".length), join(root, dir, name));
    const report = { at: Date.now(), sessions: 0, repaired: 0 };
    let copied = false;
    for (const id of host.ids) {
        if (!host.buffer.get(id)?.some(suspect))
            continue;
        const path = transcripts.get(host.claudeIdOf(id)) ?? transcripts.get(id);
        const text = path === undefined ? "" : await readFile(path, "utf8").catch(() => "");
        // Read again after the await and rewritten at once: a turn that ended meanwhile is in the list.
        const list = host.buffer.get(id);
        if (list === undefined)
            continue;
        const fixed = repairTurns(list, costStatesOf(text), list.length < host.ring);
        if (fixed.repaired === 0)
            continue;
        if (!copied) {
            const file = join(host.stateDir, "turns.json");
            await copyFile(file, `${file}.before-repair`).catch(() => { });
            copied = true;
        }
        list.splice(0, list.length, ...fixed.turns);
        report.sessions += 1;
        report.repaired += fixed.repaired;
        await host.save(id, list).catch(() => { });
    }
    await writeFile(marker, `${JSON.stringify(report)}\n`).catch(() => { });
    return report;
}
//# sourceMappingURL=turn-repair.js.map