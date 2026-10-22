// The caps, shapes and helpers behind the /btw aside ring, the selection-bar question and revive.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import z from "@deepseek-ai/schemastery";
import type { JsonValue } from "../dsh.js";

/** How many recent approval requests the Tune tab offers as rules. */
export const ASK_SUGGESTIONS = 10;
/** How many asked rpcIds to remember, so the dedupe set cannot grow without bound. */
export const ASIDE_ASKED_KEEP = 200;
/** How many `/btw` asides a session keeps; older ones drop off the ring. */
export const ASIDE_KEEP = 10;
/** How much of a selected passage the ring keeps for the card; the whole passage went to Claude. */
export const ASIDE_QUOTE_KEEP = 300;
/** What Claude is asked when the selection bar's question is left blank. Claude reads it: English only. */
export const SELECTION_EXPLAIN = "Explain the passage below from our conversation.";
/**
 * The side question's context for a selected passage: a lead line and the passage as a Markdown quote.
 * Kept here rather than shared with the client's `quoteMarkdown`, since server code does not import
 * from `src/client/`.
 */
export const selectionContext = (quote: string): string =>
  `The passage I selected in our conversation:\n\n${quote
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n")}`;
/** A side question is a full model turn, so it gets a longer wait than a control ping. */
export const ASIDE_TIMEOUT_MS = 120_000;
/** Sessions whose last turn options are kept for `revive`; past this the oldest is forgotten. */
export const REVIVE_KEEP = 32;
/** A side question on a session with no process and nothing to respawn one from. */
export const NO_PROCESS_FOR_ASIDE = "no live Claude process for this session; send a prompt first";
/** Cap on how many sessions keep asides in memory; the oldest session drops when a new one arrives.
 *  The adapter has no per-session teardown hook, so this bounds the map the way the ring bounds a session. */
export const ASIDE_MAX_SESSIONS = 200;

/** The two shapes a `side_question` control response can carry its answer in. */
const AsideWrapped = z.object({ response: z.string() });
const AsideBare = z.string();
/**
 * Pull the answer text out of a `side_question` control response. The CLI answers with
 * `{ response: string }` (or a bare string on some paths, or null when it declined), so both shapes
 * are parsed at this I/O boundary and blank or absent answers report as none.
 */
export function asideAnswerText(response: JsonValue | undefined): string | undefined {
  // Schemastery passes null and undefined through rather than throwing, so `?? ""` turns a declined
  // answer (`{ response: null }`) or a missing field into the empty string, which reports as none.
  let text: string;
  try {
    // SAFETY: schemastery validates at runtime and throws on a wrong concrete type; the cast only
    //   widens the static input type so an arbitrary control-response value reaches the validator.
    text = AsideWrapped(response as Parameters<typeof AsideWrapped>[0]).response ?? "";
  } catch {
    try {
      // SAFETY: same as above, for the bare-string shape.
      text = AsideBare(response as Parameters<typeof AsideBare>[0]) ?? "";
    } catch {
      return undefined;
    }
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
