import { type FsBox } from "./remote-fs.js";
import type { JsonValue } from "./dsh.js";
/**
 * Truncate to a byte budget without splitting a character. Encode once and cut at a UTF-8 boundary:
 * this used to append a character at a time and measure `out + ch` on each one, which is quadratic
 * in the budget and ran on every tool result in a transcript. Folding a 49 MB session spent 1.2 s
 * of its 1.35 s here.
 */
export declare function truncateBytes(text: string, max: number): string;
/** One transcript in a listing: what the session browser shows before opening it. */
export interface TranscriptListItem {
    id: string;
    title: string;
    createdAt: number;
    modifiedAt: number;
    bytes: number;
    turns: number;
    turnsPartial: boolean;
    cwd?: string;
    /** Brought in from a file rather than written by a CLI run on this box. */
    imported?: boolean;
}
/**
 * Transcripts in one project dir, newest first. `exclude` holds Claude session ids that already
 * belong to dsh sessions the plugin started itself (their dsh side is the source of truth).
 */
export declare function listTranscripts(dir: string, exclude?: Set<string>): Promise<TranscriptListItem[]>;
/** The dsh content blocks a transcript turn becomes. */
export type SeedBlock = {
    type: "text";
    text: string;
} | {
    type: "reasoning";
    text: string;
} | {
    type: "tool-call";
    id: string;
    name: string;
    arguments: string;
};
/**
 * What a subagent said, from its own transcript: its assistant text, its tool calls left out.
 *
 * This is what the live view shows — the CLI forwards a subagent's messages as whole assistant
 * messages and the translator folds them into one reasoning row each (`↳ subagent`) — so a resumed
 * Task reads the way the same run did while it was running instead of a call with nothing between
 * it and its result.
 */
export declare function subagentText(text: string, limit?: number): string;
/**
 * Fold each subagent's own text into the step that called it, right behind the Task call, which is
 * where the live run put it. `texts` is keyed by Task call id; a subagent whose file could not be
 * read is simply not there, and its call resumes the way it does today.
 */
export declare function attachSubagents(folded: FoldedTranscript, texts: Map<string, string>): void;
/** One tool call's outcome inside a folded step. */
export interface FoldedResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError: boolean;
    time: number;
}
/** One assistant message of a turn: its blocks, its tool calls, and their results by call id. */
export interface FoldedStep {
    msgId: string | undefined;
    id: string;
    model: string | undefined;
    time: number;
    content: SeedBlock[];
    calls: Array<{
        id: string;
        name: string;
        arguments: Record<string, JsonValue>;
    }>;
    results: Map<string, FoldedResult>;
}
/** One user prompt and the assistant steps that answered it. */
export interface FoldedTurn {
    id: string;
    time: number;
    content: Array<{
        type: "text";
        text: string;
    }>;
    steps: FoldedStep[];
}
export interface FoldedTranscript {
    turns: FoldedTurn[];
    title: string | undefined;
    createdAt: number;
    /** Task call id to the subagent that answered it, for the records kept in a file of their own. */
    agents: Map<string, string>;
}
/**
 * Fold a transcript into turns: one user prompt, then assistant steps (one per Claude message id)
 * with their tool calls and results. Unfinished trailing prompts are dropped; the seed must end on
 * a completed turn.
 *
 * A subagent's own records are not folded here. On 2.1 they are not in this file at all — they live
 * in `<session>/subagents/agent-<id>.jsonl` and are attached by `attachSubagents` — and the inline
 * `isSidechain` records older transcripts carry are skipped, because the turn they belong to is the
 * Task call that spawned them rather than a prompt of the user's own.
 */
export declare function foldTranscript(text: string): FoldedTranscript;
/** One dsh session event as the seed writes it: the shapes dsh persists itself. */
export interface SeedEvent {
    type: string;
    seq: number;
    time: number;
    data: Record<string, JsonValue>;
    surfaceOp?: "append";
    sourceEventSeqs?: number[];
}
/** dsh session events for folded turns. Shapes follow what dsh writes itself; seqs are contiguous from 0. */
export declare function toSessionEvents(folded: FoldedTranscript): SeedEvent[];
/**
 * The bytes a transcript gained past `offset`, or "" when it has not grown. A file shorter than the
 * offset was replaced under us; it reads as nothing new until the next finished turn sets a fresh
 * baseline from its size.
 */
export declare function readTranscriptFrom(path: string, offset: number): Promise<string>;
/**
 * The completed turns some other entrypoint wrote into a session's transcript: a terminal that
 * picked the session up with `claude /resume` stamps every row `entrypoint: cli`, while this
 * plugin's child stamps `own`. Rows without the stamp (queue bookkeeping, summaries) never count.
 * Folding drops an unanswered trailing prompt, so a terminal turn still running is not reported.
 */
export declare function foreignTurns(text: string, own: string): FoldedTurn[];
/** Those turns as one markdown block for the top of the next dsh turn, each side cut at `limit` bytes. */
export declare function foreignTurnsBlock(turns: FoldedTurn[], limit: number): string;
/** Where 2.1 keeps a session's subagent transcripts: a directory beside the session's own file. */
export declare const subagentsDir: (path: string) => string;
/**
 * Reads and parses a Claude Code transcript into folded turns, subagents included, from the box the
 * session runs on. Answers undefined when there is no such file; a box that cannot be reached
 * throws, rather than reading as a session with no history.
 */
export declare function readTranscript(box: FsBox, path: string): Promise<FoldedTranscript | undefined>;
/** A Claude Code transcript copied under a new id, cut before the (keep+1)-th human prompt so a
 *  dsh fork at an earlier turn rewinds Claude too. keep <= 0 keeps everything. */
export declare function forkTranscriptText(text: string, fromId: string, toId: string, keep: number): string;
