import type { JsonValue } from "./dsh.js";
/** Truncate to a byte budget without splitting a character. */
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
}
/**
 * Fold a transcript into turns: one user prompt, then assistant steps (one per Claude message id)
 * with their tool calls and results. Sidechains (Claude's own subagents) and unfinished trailing
 * prompts are dropped; the seed must end on a completed turn.
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
/** Reads and parses a Claude Code transcript file into folded turns. */
export declare function readTranscript(path: string): Promise<FoldedTranscript>;
/** A Claude Code transcript copied under a new id, cut before the (keep+1)-th human prompt so a
 *  dsh fork at an earlier turn rewinds Claude too. keep <= 0 keeps everything. */
export declare function forkTranscriptText(text: string, fromId: string, toId: string, keep: number): string;
