import type { JsonValue } from "../dsh.js";
/** How many recent approval requests the Tune tab offers as rules. */
export declare const ASK_SUGGESTIONS = 10;
/** How many asked rpcIds to remember, so the dedupe set cannot grow without bound. */
export declare const ASIDE_ASKED_KEEP = 200;
/** How many `/btw` asides a session keeps; older ones drop off the ring. */
export declare const ASIDE_KEEP = 10;
/** How much of a selected passage the ring keeps for the card; the whole passage went to Claude. */
export declare const ASIDE_QUOTE_KEEP = 300;
/** What Claude is asked when the selection bar's question is left blank. Claude reads it: English only. */
export declare const SELECTION_EXPLAIN = "Explain the passage below from our conversation.";
/**
 * The side question's context for a selected passage: a lead line and the passage as a Markdown quote.
 * Kept here rather than shared with the client's `quoteMarkdown`, since server code does not import
 * from `src/client/`.
 */
export declare const selectionContext: (quote: string) => string;
/** A side question is a full model turn, so it gets a longer wait than a control ping. */
export declare const ASIDE_TIMEOUT_MS = 120000;
/** Sessions whose last turn options are kept for `revive`; past this the oldest is forgotten. */
export declare const REVIVE_KEEP = 32;
/** A side question on a session with no process and nothing to respawn one from. */
export declare const NO_PROCESS_FOR_ASIDE = "no live Claude process for this session; send a prompt first";
/** Cap on how many sessions keep asides in memory; the oldest session drops when a new one arrives.
 *  The adapter has no per-session teardown hook, so this bounds the map the way the ring bounds a session. */
export declare const ASIDE_MAX_SESSIONS = 200;
/**
 * Pull the answer text out of a `side_question` control response. The CLI answers with
 * `{ response: string }` (or a bare string on some paths, or null when it declined), so both shapes
 * are parsed at this I/O boundary and blank or absent answers report as none.
 */
export declare function asideAnswerText(response: JsonValue | undefined): string | undefined;
