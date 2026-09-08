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
/** The body of GET /scheduled-tasks. */
export interface ScheduledTasksReply {
    ok: true;
    durable: ScheduledTask[];
    session: ScheduledTask[];
    goal: {
        text: string;
        at: number;
    } | null;
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
 * could read — and a box that cannot be reached throws for the same reason.
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
 * The goal the CLI is holding, which it keeps nowhere but the transcript: on resume it recovers one
 * by reading its own messages backwards. The last proposal wins, and its step's time is when it was
 * made. The tool's parameter names are not published, so the text is looked for under each name it
 * plausibly carries.
 */
export declare function goalFrom(folded: FoldedTranscript): {
    text: string;
    at: number;
} | null;
