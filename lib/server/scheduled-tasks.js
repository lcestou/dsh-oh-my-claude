// Scheduled tasks and the CLI's goal, read for the panel's Tasks tab. Durable tasks come from the
// project's own `.claude/scheduled_tasks.json`; session-only ones are never written anywhere, so
// the only trace of them is the CronCreate call in the transcript. This is an I/O boundary: the
// file and the folded transcript are decoded here, and every field is defaulted.
import { join } from "node:path";
import { readTextAt } from "./remote-fs.js";
/** True only for a plain object, so a JSON array or null is not treated as a task record. */
const isRec = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** The first of these keys the record carries as a string, else undefined. */
const str = (rec, ...keys) => {
    for (const key of keys) {
        const value = rec[key];
        if (typeof value === "string" && value !== "")
            return value;
    }
    return undefined;
};
/** The first finite number among the keys, or the millisecond instant of an ISO string under one
 *  of them. */
const num = (rec, ...keys) => {
    for (const key of keys) {
        const value = rec[key];
        if (typeof value === "number" && Number.isFinite(value))
            return value;
        // A next run is as often an ISO string as a number of milliseconds.
        if (typeof value === "string") {
            const parsed = Date.parse(value);
            if (Number.isFinite(parsed))
                return parsed;
        }
    }
    return undefined;
};
/** The name of the file the CLI persists durable tasks to, for a project directory. */
export const durableTasksPath = (cwd) => join(cwd, ".claude", "scheduled_tasks.json");
/**
 * One record of the durable file. The CLI's own key names are not part of any published contract,
 * so each field is looked for under the few names it plausibly carries and defaults when absent.
 */
const taskFrom = (raw, durable) => {
    if (!isRec(raw))
        return undefined;
    const name = str(raw, "name", "id", "taskId");
    if (!name)
        return undefined;
    return {
        name,
        description: str(raw, "description", "prompt", "task", "label"),
        schedule: str(raw, "schedule", "cron", "expression", "interval"),
        nextRunAt: num(raw, "nextRunAt", "nextRun", "nextFireAt", "runAt"),
        durable,
    };
};
/**
 * The durable tasks of a project, read from the box the session runs on. A missing file is no
 * tasks, which is the ordinary case; a file that exists and does not parse is an error the tab must
 * show, because silently reading it as empty would say "nothing is scheduled" about a file nobody
 * could read, and a box that cannot be reached throws for the same reason.
 */
export async function readDurableTasks(box, cwd) {
    const text = await readTextAt(box, durableTasksPath(cwd));
    if (text === null)
        return [];
    let parsed;
    try {
        // SAFETY: the value is used only through taskFrom, which checks every field it reads.
        parsed = JSON.parse(text);
    }
    catch (error) {
        throw new Error(`${durableTasksPath(cwd)}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    // The file has been seen as a bare list and as an object holding one; accept either.
    const list = Array.isArray(parsed)
        ? parsed
        : isRec(parsed) && Array.isArray(parsed.tasks)
            ? parsed.tasks
            : [];
    const tasks = [];
    for (const raw of list) {
        const task = taskFrom(raw, true);
        if (task)
            tasks.push(task);
    }
    return tasks;
}
/**
 * The session-only tasks a transcript shows, which is the only place they appear: `durable: false`
 * is the CLI's default and those jobs live in the process's memory until it exits. A later
 * CronDelete for a name cancels the create before it, and a task created durable is left out
 * because the file above already lists it.
 */
export function sessionTasksFrom(folded) {
    const live = new Map();
    for (const turn of folded.turns)
        for (const step of turn.steps)
            for (const call of step.calls) {
                const input = call.arguments;
                if (call.name === "CronDelete") {
                    const name = str(input, "name", "id", "taskId");
                    if (name)
                        live.delete(name);
                    continue;
                }
                if (call.name !== "CronCreate")
                    continue;
                if (input.durable === true)
                    continue;
                const task = taskFrom(input, false);
                if (task)
                    live.set(task.name, task);
            }
    return [...live.values()];
}
/**
 * Fold a dsh session's `goal/change` records into one entry per goal, newest first. dsh writes a
 * full snapshot on every change (create, edit, pause, resume, complete, block) and a separate clear
 * record naming the goal it removed, which marks that goal `cleared` here. A record of another shape
 * is skipped rather than trusted, since the log is dsh's and its format can move.
 */
export function dshGoalsFrom(events) {
    const byId = new Map();
    for (const e of events) {
        if (e.type !== "goal/change" || !isRec(e.data))
            continue;
        const d = e.data;
        if (d.operation === "clear") {
            const ref = isRec(d.cleared) ? d.cleared : undefined;
            const held = typeof ref?.id === "string" ? byId.get(ref.id) : undefined;
            if (held) {
                held.phase = "cleared";
                if (typeof d.clearedAt === "number")
                    held.updatedAt = d.clearedAt;
            }
            continue;
        }
        const g = isRec(d.goal) ? d.goal : undefined;
        if (!g || typeof g.id !== "string" || typeof g.objective !== "string")
            continue;
        if (typeof g.phase !== "string")
            continue;
        const entry = {
            id: g.id,
            objective: g.objective,
            phase: g.phase,
            roundsStarted: typeof d.roundsStarted === "number" ? d.roundsStarted : 0,
            createdAt: typeof d.createdAt === "number" ? d.createdAt : 0,
            updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
        };
        if (typeof g.maxGoalRounds === "number")
            entry.maxGoalRounds = g.maxGoalRounds;
        if (typeof g.blockedReason === "string")
            entry.blockedReason = g.blockedReason;
        byId.set(g.id, entry);
    }
    return [...byId.values()].toSorted((a, b) => b.createdAt - a.createdAt);
}
/**
 * The goal the CLI is holding, which it keeps nowhere but the transcript: on resume it recovers one
 * by reading its own messages backwards. The last proposal wins, and its step's time is when it was
 * made. The tool's parameter names are not published, so the text is looked for under each name it
 * plausibly carries.
 */
export function goalFrom(folded) {
    let latest = null;
    for (const turn of folded.turns)
        for (const step of turn.steps)
            for (const call of step.calls) {
                if (!call.name.startsWith("Propose") || !call.name.endsWith("Goal"))
                    continue;
                const text = str(call.arguments, "goal", "goalText", "text", "description");
                if (text)
                    latest = { text, at: step.time };
            }
    return latest;
}
//# sourceMappingURL=scheduled-tasks.js.map