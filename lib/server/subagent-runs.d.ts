import { type FsBox } from "./remote-fs.js";
import { type FoldedTranscript } from "./transcript.js";
/** One finished subagent: the file's id, and what the parent's Task call said it was for. */
export interface SubagentRun {
    agentId: string;
    /** The Task call's `description`; the agent id when the parent transcript has no call for it. */
    description: string;
    subagentType?: string;
    /** When the parent's step that called it started; 0 for a file with no call in the parent. */
    time: number;
}
/** The runs behind a list of `subagents/` file names, described from the parent transcript's Task
 *  calls where it has them, newest first. A file the parent never names (another process wrote
 *  it, or its result row was lost) is still listed, under its own id. */
export declare function subagentRunsOf(folded: FoldedTranscript | undefined, names: string[]): SubagentRun[];
/** The session's finished subagents from the box: the first of `ids` with a transcript file is
 *  the session's. Empty when none has one, or none has a `subagents/` folder yet. */
export declare function listSubagentRuns(box: FsBox, dir: string, ids: string[]): Promise<SubagentRun[]>;
/** One finished subagent's transcript as Markdown, or null when no `ids` session has that file. */
export declare function readSubagentRun(box: FsBox, dir: string, ids: string[], agentId: string): Promise<string | null>;
