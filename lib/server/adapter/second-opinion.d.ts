import { type LooseMessage } from "./prompt.js";
import type { PluginContext } from "../dsh.js";
import type { WorkspaceDiff } from "../process.js";
import type { WorkspaceDiffReply } from "./types.js";
import type { OpinionFinding } from "../prompts.js";
/** The model that reviews, and whether it runs on its own after every turn that changed files.
 *  Without `auto` the card offers a button instead. No file, or one without a model, is off. */
export interface SecondOpinionSetting {
    provider: string;
    model: string;
    auto?: true;
}
/** One point the reviewer raised. `note` is a reply that did not follow the line format, shown
 *  whole so nothing it said is lost; `where` is empty for a note. Declared in prompts.ts, which the
 *  client imports too, so the card and the server read one shape. */
export type Finding = OpinionFinding;
/** Why a review did not finish: the picked model is no longer offered, it ran past the deadline,
 *  the provider failed (`detail` is its own message, shown as written), or it answered nothing. */
export type FailReason = "gone" | "timeout" | "error" | "empty";
/** What the card shows for a session's last turn. `files` are the paths the turn changed, in the
 *  CLI's diff order; `reviewed` is how many of them fit in the review. */
export type OpinionCard = {
    state: "ready";
    at: number;
    files: string[];
} | {
    state: "running";
    at: number;
    files: string[];
    model: string;
    startedAt: number;
} | {
    state: "done";
    at: number;
    files: string[];
    model: string;
    findings: Finding[];
    reviewed: number;
    ms: number;
} | {
    state: "failed";
    at: number;
    files: string[];
    model: string;
    reason: FailReason;
    detail?: string;
};
/** `GET /second-opinion` and the `second-opinion` event: the session's card, or null for none. */
export interface OpinionReply {
    card: OpinionCard | null;
}
/** Past this many characters the review stops adding files. The same budget the Changes tab's Ask
 *  sends Claude (`DIFF_CONTEXT_CAP` in turn.ts): about 8k tokens, a few minutes on a local model. */
export declare const REVIEW_CAP = 32000;
/** How much of the person's request goes with the diff; the diff is what is reviewed. */
export declare const REQUEST_CAP = 2000;
/** How much of one new file is read for the review. */
export declare const NEW_FILE_CAP = 16000;
/** New files read per turn; past this the rest are named without their text. */
export declare const NEW_FILES_READ = 20;
/** Findings kept from one reply; the prompt asks for at most this many. */
export declare const MAX_FINDINGS = 3;
/** A new file larger than this is named in the review but not read: a stray dump or an image that
 *  is not ignored would otherwise be read whole into dsh-web (or piped over SSH) twice per turn. */
export declare const NEW_FILE_MAX_BYTES = 256000;
/** How long one review may take. A local model on a shared GPU took 204 s and 259 s for two small
 *  diffs on 2026-11-25, so the deadline is generous; a hosted model answers far sooner. */
export declare const REVIEW_TIMEOUT_MS = 600000;
/** Output budget, reasoning included: the probes' replies spent 836 to 1,208 output tokens. */
export declare const REVIEW_MAX_TOKENS = 4000;
/** The reviewer's instructions, sent as the system prompt. English only: a model reads it. On a
 *  clean diff an earlier wording drew two confident non-defects; this one answered "No findings."
 *  there and still caught both planted bugs (grill probe, 2026-11-25, one run each). */
export declare const REVIEW_SYSTEM = "You review a code change that another assistant just made. You get the request it was working on and the diff of what it changed. You see only the diff, not the rest of each file.\n\nMost changes have no defect, and \"No findings.\" is the right answer for most diffs. A wrong finding costs the reader more than a missed one.\n\nReport a problem only when the diff itself shows it: a bug, an edge case that now gives a wrong result, a security hole, a caller or test the change forgot. Do not report anything that depends on code you cannot see, do not guess how unseen code behaves, do not praise or summarise, and do not suggest style, naming, comments or tests.\n\nWrite at most 3 findings, most serious first, one per line, in exactly this form:\n- [bug] path:line `the changed line, quoted` What is wrong, and the input that gives the wrong result.\n\nIf you find nothing that meets this bar, write exactly: No findings.\nWrite nothing else.";
/** A file's state as one comparable string: its hunks for a tracked file, its text for a new one.
 *  The CLI reports a new (untracked) file with no hunks and zero counts, so without its text two
 *  different versions of a new file would compare equal. */
export type TreeMarks = Map<string, string>;
/** The marks for every file in a diff. `texts` holds the new files that were read; one that was not
 *  read marks as unread, so it counts as changed only when it first appears. */
export declare function treeMarks(diff: WorkspaceDiff, texts: ReadonlyMap<string, string>): TreeMarks;
/** The paths whose mark differs between the two snapshots, in `after`'s order. With no `before`
 *  there is nothing to compare against, so nothing counts as this turn's. Gets wrong: a file the
 *  turn committed or reverted is gone from `after` and is not reviewed, and a file the person edited
 *  by hand between the snapshot and the turn's end counts as the turn's. */
export declare function changedPaths(before: TreeMarks | undefined, after: TreeMarks): string[];
/** The user message the reviewer reads: the request, then each changed file whole, in diff order,
 *  until the cap. The first file always goes, cut at the cap if it alone is over, because a review
 *  with no diff in it is worthless. `reviewed` counts the files that went in. */
export declare function reviewInput(request: string, diff: WorkspaceDiff, paths: readonly string[], texts: ReadonlyMap<string, string>): {
    text: string;
    reviewed: number;
};
/** The reviewer's reply as findings. "No findings." is an empty list. A finding whose path (its
 *  `where` without the `:line`) is not one of `paths` is dropped: the reviewer saw only those files,
 *  so anything else is a guess about code it never read. A reply with text but no line in the
 *  format becomes one `note` holding the reply, cut to 1500 characters, so a model that ignored the
 *  format is still read. Keeps the first `MAX_FINDINGS`. */
export declare function parseFindings(reply: string, paths: readonly string[]): Finding[];
/** The saved setting, or undefined for none, a missing or unreadable file, or a row without a model. */
export declare function loadSecondOpinion(dir: string): Promise<SecondOpinionSetting | undefined>;
/** The text of the last user message in a turn's history: what the person asked this turn. Empty
 *  for a turn with none, and for options that carry no history at all, which the review says. */
export declare const requestText: (messages: readonly LooseMessage[] | undefined) => string;
/** What the adapter that owns a session hands over at each turn start: the CLI's diff, a reader for
 *  a repo-relative path on the session's box (null when absent), and dsh's model service. */
export interface TurnDeps {
    diff: () => Promise<WorkspaceDiffReply>;
    read: (path: string) => Promise<string | null>;
    llm: PluginContext["llm"];
}
/** The runtime: every adapter instance shares it, keyed by session id, like the event hub. */
declare class SecondOpinions {
    private setting;
    private rows;
    /** Reads the setting once at startup. Turn starts read the copy in memory, never the file, so the
     *  snapshot's control request goes out before the prompt with no await between them. */
    prime(dir?: string): Promise<void>;
    /** The setting in effect, or undefined when the feature is off. */
    current(): SecondOpinionSetting | undefined;
    /** Stores a new setting (undefined turns the feature off) and drops every card when it turns off,
     *  so no open tab keeps offering a review that can no longer run. */
    save(next: SecondOpinionSetting | undefined, dir?: string): Promise<void>;
    /** Called just before a turn's prompt is written. Starts the snapshot at once: `deps.diff()`
     *  writes its control request synchronously, so the CLI reads it ahead of the prompt (probe
     *  2026-11-25: the answer came 1 to 3 s before the turn's first Write). Clears last turn's card
     *  and stops a review still running for it. Does nothing while the feature is off. */
    turnStarting(sessionId: string, request: string, deps: TurnDeps): void;
    /** Called on a turn's result. Compares the tree with the turn-start snapshot and, when files
     *  changed, shows the card, then runs the review when `auto` is on. Drops its result when a newer
     *  turn started or the feature was turned off while it waited. Never throws: it runs detached. */
    turnEnded(sessionId: string): Promise<void>;
    /** Runs the review of the card's files. Answers false when there is nothing to review (no card,
     *  feature off) or one is already running or being prepared, so a double click or Run in two
     *  tabs starts one review. A newer turn, Cancel or Close aborts it and its answer is dropped. */
    run(sessionId: string): Promise<boolean>;
    /** Stops a running review and puts the card back to its button, so the same turn can still be
     *  reviewed later or after picking a faster model. No-op without a running review. */
    cancel(sessionId: string): void;
    /** Hides the card for every tab and stops its review. */
    dismiss(sessionId: string): void;
    /** The session's card as the route and the event carry it. */
    reply(sessionId: string): OpinionReply;
    /** Aborts a running review and clears the card, publishing only when there was one. */
    private stop;
    /** Stores the row as the newest, dropping the oldest session past `MAX_SESSIONS`. */
    private keep;
    /** The session's card to its open tabs. */
    private publish;
}
/** The one runtime every adapter instance and the routes share. */
export declare const opinions: SecondOpinions;
export {};
