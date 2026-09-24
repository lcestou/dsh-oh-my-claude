import { type FsBox } from "./remote-fs.js";
import type { JsonValue } from "./dsh.js";
/**
 * What a person typed, out of a prompt as the CLI stored it. dsh sends its own text in the same
 * user message: an approval-policy notice ahead of the prompt when the access mode changed, and its
 * "Current runtime context." block after it. A Rewind row labelled with the raw text led with the
 * notice ("The approval policy changed from "never" to "ask" …") instead of the question asked.
 * Text without either part comes back trimmed and otherwise untouched.
 */
export declare const typedPrompt: (text: string) => string;
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
 * This is what the live view shows. The CLI forwards a subagent's messages as whole assistant
 * messages and the translator folds them into one reasoning row each (`↳ subagent`), so a resumed
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
    /** `permissionMode` of the last prompt row, the mode the CLI ran that session in; undefined on
     *  a transcript older than the field. */
    permissionMode: string | undefined;
}
/** Folds raw transcript lines into turns, dropping injected noise (slash-command echoes, hook
 *  output) but never a message the CLI removed: it keeps such a line and folds it at its own prompt
 *  arrival rather than showing a retraction. */
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
/** Where an appended fold continues from: the write handle's cursor and the log's last turn
 *  number. Zero for a fresh seed. With a nonzero turn the system head and the title row are
 *  not written, since the log has both. */
export interface SeedBase {
    seq: number;
    turn: number;
}
/** dsh session events for folded turns. Shapes follow what dsh writes itself; seqs are contiguous
 *  from `base.seq` and turns count on from `base.turn`, so a delta appends onto a stored log. */
export declare function toSessionEvents(folded: FoldedTranscript, logVersion?: number, base?: SeedBase): SeedEvent[];
/** The model the transcript's last answer ran on, undefined when no step names one. */
export declare const lastModelOf: (folded: FoldedTranscript) => string | undefined;
/**
 * The model and access a restored transcript ran under, as the events dsh writes when someone
 * picks them. Without them dsh fills a restored session with its fallbacks: the configured default
 * model and, because the log is seeded, the shell's sandbox with "ask" instead of the default
 * preset, which clamped a bypass transcript to acceptEdits. Appended after the turns; seqs run on
 * from `seq`. An unknown mode or an absent model writes nothing for that half.
 */
export declare function settingsEvents(pick: {
    provider: string | undefined;
    model: string | undefined;
    permissionMode?: string;
}, time: number, seq: number): SeedEvent[];
/** What another entrypoint wrote into a stretch of transcript: its completed turns, and how many
 *  bytes of the stretch are settled. A prompt still being answered is not settled: `consumed` stops
 *  at its row, so the next read starts there and reports the whole turn once. */
export interface ForeignTurns {
    turns: FoldedTurn[];
    consumed: number;
    /** Bytes through the end of the first completed turn, or `consumed` when there is none. A live
     *  stream owns one exchange: settling it moves the baseline by this much rather than by
     *  `consumed`, so an exchange that landed behind it is still ahead of the baseline for the next
     *  read to mirror instead of being jumped over and lost. */
    firstEnd: number;
    /** The entrypoint stamps seen on those rows: `cli` for a terminal, `sdk-cli` for a print run. */
    stamps: Set<string>;
    /** Byte offset of the newest foreign prompt in the read, open or answered; where the latest
     *  exchange begins. `consumed` when there is no foreign prompt. Used to re-read the latest
     *  exchange when a session is opened, so the tab always catches up to it. */
    lastPromptAt: number;
    /** The turn still being answered at the end of the read, folded up to its completed steps, or
     *  undefined when the read ends on a settled turn. Live streaming renders this as it grows. */
    running?: FoldedTurn;
}
/**
 * The turns some other entrypoint wrote into a stretch of a session's transcript: a terminal that
 * picked the session up with `claude /resume` stamps every row `entrypoint: cli`, while this
 * plugin's child stamps `own`. Rows without the stamp (queue bookkeeping, summaries) never count,
 * and neither do SDK stamps: another program driving the CLI is not a person to echo, and a CLI
 * too old to keep the stamp it was given (a remote box's 2.1.123 writes sdk-cli for this plugin's own
 * child) would otherwise see its own dsh turns come back as terminal ones.
 * A prompt is running until an assistant row with a terminal `stop_reason` lands; it and what
 * follows wait for the next read, so a reply that writes a sentence, calls a tool, then writes the
 * rest is mirrored whole, not cut at the sentence.
 */
export declare function foreignTurns(text: string, own: string): ForeignTurns;
/** A short, stable fingerprint of a turn for dedup: its prompt and the start of its final answer,
 *  both of which the mirrored dsh message also carries, so "has the dsh log already shown this
 *  exchange?" is a substring test against the log's recent messages. Empty only for an empty turn. */
/** The text blocks of a dsh assistant/message's content, joined; other block kinds are skipped.
 *  A boundary decode so callers outside this file need no `typeof` on event data. */
export declare function assistantMessageText(content: unknown): string;
/** Whether the dsh log already shows this exchange, so re-reading the latest one when a session opens
 *  does not mirror it twice. The prompt and the reply land in dsh as two separate messages, so one
 *  string spanning both can never be found in either: the fingerprint that did exactly that matched
 *  nothing at all, and every re-read mirrored the exchange again. Both halves are checked, and both
 *  must be present, because dropping an exchange that was not really shown is the worse mistake. A
 *  tool-heavy reply can open with the same rendered line as another, so the reply alone is not enough
 *  to tell two exchanges apart. `shown` must carry the text of recent user *and* assistant messages. */
export declare function alreadyShown(turn: FoldedTurn, shown: string, limit: number): boolean;
/** The reply a terminal got, as the markdown of one dsh assistant message: each step's blocks in
 *  order, tool calls and their results drawn the way the inline translator draws them in a live
 *  turn, text as it is. Thinking stays out, as it does live. Results are cut at `limit` bytes. */
export declare function mirrorReply(turn: FoldedTurn, limit: number): string;
/** The reply as one markdown chunk per rendered block, a text block or a tool call with its
 *  result, in order. Live streaming yields the chunks a running turn has gained since the last
 *  render, so a long turn fills into one dsh turn step by step instead of landing all at once. */
export declare function mirrorReplyBlocks(turn: FoldedTurn, limit: number): string[];
/**
 * A transcript as one Markdown document: title, date, then `## You` and `## Claude` per turn, the
 * reply rendered by the same blocks the terminal mirror draws (text, tool calls, results).
 */
export declare function toMarkdown(folded: FoldedTranscript, limit?: number): string;
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
