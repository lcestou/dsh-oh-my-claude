// The subagents a Claude Code session has already run, read from the transcripts the CLI keeps
// beside the session's own (`<session>/subagents/agent-<id>.jsonl`). The CLI shows a subagent's
// work while it runs and folds it away when it ends; the Tasks tab lists these so a finished run
// can be opened later.
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { listNamesAt, readAt, type FsBox } from "./remote-fs.js";
import { foldTranscript, subagentsDir, toMarkdown, type FoldedTranscript } from "./transcript.js";

/** One finished subagent: the file's id, and what the parent's Task call said it was for. */
export interface SubagentRun {
  agentId: string;
  /** The Task call's `description`; the agent id when the parent transcript has no call for it. */
  description: string;
  subagentType?: string;
  /** When the parent's step that called it started; 0 for a file with no call in the parent. */
  time: number;
}

const AGENT_FILE = /^agent-([\w-]+)\.jsonl$/;
/** The two Task call fields a run is described by; anything else on the call is ignored. */
const TASK_CALL = z.object({
  description: z.string().default(""),
  subagent_type: z.string().default(""),
});

/** The runs behind a list of `subagents/` file names, described from the parent transcript's Task
 *  calls where it has them, newest first. A file the parent never names (another process wrote
 *  it, or its result row was lost) is still listed, under its own id. */
export function subagentRunsOf(
  folded: FoldedTranscript | undefined,
  names: string[],
): SubagentRun[] {
  const byAgent = new Map<string, Omit<SubagentRun, "agentId">>();
  for (const turn of folded?.turns ?? [])
    for (const step of turn.steps)
      for (const call of step.calls) {
        const agentId = folded?.agents.get(call.id);
        if (agentId === undefined) continue;
        let a = { description: "", subagent_type: "" };
        try {
          a = TASK_CALL(call.arguments);
        } catch {
          // A call whose fields are not strings describes nothing; the id stands in below.
        }
        byAgent.set(agentId, {
          description: a.description || agentId,
          subagentType: a.subagent_type || undefined,
          time: step.time,
        });
      }
  const runs: SubagentRun[] = [];
  for (const name of names) {
    const agentId = AGENT_FILE.exec(name)?.[1];
    if (agentId === undefined) continue;
    runs.push({ agentId, ...(byAgent.get(agentId) ?? { description: agentId, time: 0 }) });
  }
  return runs.toSorted((a, b) => b.time - a.time);
}

/** The session's finished subagents from the box: the first of `ids` with a transcript file is
 *  the session's. Empty when none has one, or none has a `subagents/` folder yet. */
export async function listSubagentRuns(
  box: FsBox,
  dir: string,
  ids: string[],
): Promise<SubagentRun[]> {
  for (const id of ids) {
    const path = join(dir, `${id}.jsonl`);
    const file = await readAt(box, path);
    if (file === null) continue;
    // A session that never ran a subagent has no folder; over SSH that read fails, so it reads as none.
    const names = await listNamesAt(box, subagentsDir(path)).catch(() => []);
    return subagentRunsOf(foldTranscript(file.text), names);
  }
  return [];
}

/** One finished subagent's transcript as Markdown, or null when no `ids` session has that file. */
export async function readSubagentRun(
  box: FsBox,
  dir: string,
  ids: string[],
  agentId: string,
): Promise<string | null> {
  if (!/^[\w-]+$/.test(agentId)) return null;
  for (const id of ids) {
    const file = await readAt(
      box,
      join(subagentsDir(join(dir, `${id}.jsonl`)), `agent-${agentId}.jsonl`),
    );
    if (file !== null) return toMarkdown(foldTranscript(file.text));
  }
  return null;
}
