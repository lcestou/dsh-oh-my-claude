import { type FsBox } from "./remote-fs.js";
import type { FoldedTranscript } from "./transcript.js";
/** One scheduled task, from either the durable file or the session transcript. */
export interface ScheduledTask {
    name: string;
    description?: string;
    schedule?: string;
    nextRunAt?: number;
    durable?: boolean;
}
/** One dsh goal as its latest `goal/change` record left it. dsh's own phases are active, paused,
 *  complete and blocked; `cleared` is this fold's name for a goal a clear record removed. */
export interface DshGoal {
    id: string;
    objective: string;
    phase: string;
    roundsStarted: number;
    maxGoalRounds?: number;
    blockedReason?: string;
    createdAt: number;
    updatedAt: number;
}
/** The body of GET /scheduled-tasks. */
export interface ScheduledTasksReply {
    ok: true;
    durable: ScheduledTask[];
    session: ScheduledTask[];
    goal: {
        text: string;
        at: number;
    } | null;
    /** dsh's own goals for the session, newest first; the first is current unless it has ended. */
    dshGoals: DshGoal[];
    path: string;
}
/** The same route when it could not answer. */
export interface ScheduledTasksError {
    ok: false;
    error: string;
}
/** The name of the file the CLI persists durable tasks to, for a project directory. */
export declare const durableTasksPath: (cwd: string) => string;
/**
 * The durable tasks of a project, read from the box the session runs on. A missing file is no
 * tasks, which is the ordinary case; a file that exists and does not parse is an error the tab must
 * show, because silently reading it as empty would say "nothing is scheduled" about a file nobody
 * could read, and a box that cannot be reached throws for the same reason.
 */
export declare function readDurableTasks(box: FsBox, cwd: string): Promise<ScheduledTask[]>;
/**
 * The session-only tasks a transcript shows, which is the only place they appear: `durable: false`
 * is the CLI's default and those jobs live in the process's memory until it exits. A later
 * CronDelete for a name cancels the create before it, and a task created durable is left out
 * because the file above already lists it.
 */
export declare function sessionTasksFrom(folded: FoldedTranscript): ScheduledTask[];
/**
 * Fold a dsh session's `goal/change` records into one entry per goal, newest first. dsh writes a
 * full snapshot on every change (create, edit, pause, resume, complete, block) and a separate clear
 * record naming the goal it removed, which marks that goal `cleared` here. A record of another shape
 * is skipped rather than trusted, since the log is dsh's and its format can move.
 */
export declare function dshGoalsFrom(events: readonly {
    type: string;
    data?: unknown;
}[]): DshGoal[];
/**
 * The goal the CLI is holding, which it keeps nowhere but the transcript: on resume it recovers one
 * by reading its own messages backwards. The last proposal wins, and its step's time is when it was
 * made. The tool's parameter names are not published, so the text is looked for under each name it
 * plausibly carries.
 */
export declare function goalFrom(folded: FoldedTranscript): {
    text: string;
    at: number;
} | null;
