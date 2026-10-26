import { type ContentBlock } from "@deepseek-ai/dsh-llm";
import { type ContextSizes, type ContextSource } from "../context-sources.js";
import { type ImageAttachmentRef } from "../dsh.js";
import { type SteerAttachment } from "../process.js";
/** The slice of a dsh message this adapter reads; dsh's own Message type is wider. */
/** The slice of a dsh message this adapter reads; exported for test fixtures. */
export type LooseMessage = {
    id?: string;
    role?: string;
    source?: {
        kind?: string;
        /** The route that wrote an assistant message (`{kind: "model", provider, model}`). */
        provider?: string;
        model?: string;
        /** The call a tool result answers, on the older user-message form of a result. */
        callId?: string;
        plugin?: string;
        rpcId?: string;
        clientTimeZone?: string;
        name?: string;
    };
    content?: string | ContentBlock[];
    /** dsh 0.1.7 answers a tool result as its own `role: "tool"` message and carries the call id on
     *  the message; up to 0.1.6 it was a user message holding a `tool-result` block. */
    toolCallId?: string;
    isError?: boolean;
};
/** The browser's IANA zone as dsh stamped it on the latest user prompt; undefined when no
 *  prompt carried one (an API caller, an old log), so clocks fall back to the box's zone. */
export declare function clientTimeZone(messages: readonly LooseMessage[]): string | undefined;
/** Join a message's text blocks on newlines, or return a string content as-is; non-text blocks (images, tool calls) are dropped and undefined content becomes empty. */
export declare const textOf: (content: LooseMessage["content"]) => string;
/** The file and image blocks of a message as the steer card names them, in block order. A block
 *  without its attachment reference (wire data from an older dsh) is skipped, as dsh's own queue
 *  dock does. Empty for a string content or a text-only message. */
export declare const attachmentsOf: (content: LooseMessage["content"]) => SteerAttachment[];
/** The key a message dsh delivered mid-step is marked under once it went over stdin: the prompt's
 *  rpcId for a typed steer, the message id for anything dsh sends on its own behalf (a child's
 *  send_message, a settlement notice, a job's finish line). Undefined for what never goes over
 *  stdin on its own: an assistant turn, a tool result. */
export declare const steerKey: (m: LooseMessage) => string | undefined;
/**
 * Pick the messages that go into this call. Fresh: the whole transcript, since `claude -p` is
 * stateless. Resuming: what came after Claude's own last reply (`own` names this route's
 * provider), so the turns another model made while the session ran elsewhere reach Claude too;
 * without that its transcript skipped from its own last reply to the new prompt. A tool result
 * rides along only when the call it answers is in the same slice: another model's tool use is
 * transcript Claude never saw, while Claude's own results already sit in its session.
 */
export declare function selectTurns(messages: LooseMessage[] | undefined, resuming: boolean, own?: string): LooseMessage[];
/** The most of one tool's input or output another model's transcript carries into the prompt. */
export declare const TOOL_TEXT_CAP = 2000;
/** dsh's instruction bundle repeats files Claude Code already loads on its own (`CLAUDE.md` in the
 *  workspace, `~/.claude/CLAUDE.md`), so those blocks are dropped from what goes to Claude. The
 *  bundle is one `<system-reminder>` with `Instructions from: <path>` headers; a block runs to
 *  the next header or the closing tag. Empty when nothing but the wrapper would remain. */
export declare function withoutNativeInstructions(text: string): string;
/** Which withheld block a message is, if any. The chat row mask classifies the same sources from
 *  the client side, so the rule itself lives in `context-sources.ts` and both read it there. */
export declare const contextSourceOf: (m: LooseMessage) => ContextSource | undefined;
/** What each dsh block cost this turn, in characters, measured before any switch removed it: a
 *  cleared checkbox still has to show its number or the owner cannot tell whether to put it back.
 *  `instructions` counts what survives the CLAUDE.md filter and `claudemd` counts what the filter
 *  took, so the two together are the bundle dsh handed over. A key is absent when this turn carried
 *  nothing of that kind, which is not the same as zero and must not be flattened into one. */
export declare function contextSizes(turns: LooseMessage[]): ContextSizes;
/** Prompt text of one dsh message: a withheld block answers empty, a skill-invocation the CLI also
 *  lists is dsh's duplicate of a body Claude Code injects itself (so it answers empty), and the
 *  instruction bundle keeps losing its CLAUDE.md sections whatever the switches say, since Claude
 *  Code loads those itself. */
export declare const promptTextOf: (m: LooseMessage, drops?: ReadonlySet<ContextSource>) => string;
/**
 * The turn's text as one stdin prompt. A turn with assistant text in it is labelled by role so the
 * history stays legible; a plain user turn is sent as it was typed, with no label. A turn that
 * carries only an image has no text to send, so it becomes `(see attached)` and the image rides
 * along in `imageRefs`.
 */
export declare function buildPrompt(turns: LooseMessage[], drops?: ReadonlySet<ContextSource>): string;
/** An image loaded from dsh's attachment store, ready for the stdin line, plus the path of the
 *  copy kept for Claude's tools when one could be written. */
/** An image of the turn. `data` is its base64 for the stdin line, or empty when the image rides by
 *  path only (see `oversize`); `path` is the copy `keepImageCopy` wrote, on the box that runs Claude. */
export type LoadedImage = {
    mediaType: string;
    data: string;
    attachmentId?: string;
    path?: string;
};
/** The most pixels a side may have for an image sent inline. The API allows 8000 on a request with
 *  few images and 2000 once the conversation holds more than twenty, and a long design session
 *  gets there: the request then fails with "image dimensions exceed max allowed size for
 *  many-image requests" and the CLI drops the image (2026-09-18, a 2884x156 screenshot as the
 *  forty-second image). The CLI caps everything it ingests itself at 2000, so this matches it;
 *  Node has nothing to scale an image with, so an oversize one goes by path and the Read tool,
 *  which scales, shows it a tool call later. */
export declare const MAX_IMAGE_SIDE = 2000;
/** True when either side of an image exceeds `MAX_IMAGE_SIDE`, the most the API accepts inline
 *  once a conversation holds many images. Such an image is not sent inline at all. The prompt names
 *  its saved path instead, and Claude reads it with its file tool, which scales it down. */
export declare const oversize: (ref: {
    width?: number;
    height?: number;
}) => boolean;
/** The file extension Claude Code's Read tool needs to treat a copy as an image. */
export declare const IMAGE_EXT: Map<string, string>;
/**
 * Where each image of the turn lives on disk, told to the model after the prompt. The image rides
 * inline on the stdin line, which lets Claude see it and nothing more: no path, so no Read, no
 * edit, no handing it to a subagent. dsh's own store names an image by hash with no extension, so
 * the note points at the copy `keepImageCopy` wrote. Files need nothing here: dsh replaces a file
 * block with a line naming its stored path before any provider sees the turn.
 */
export declare function attachmentNotes(turns: LooseMessage[], images: readonly LoadedImage[]): string;
/** How long one attachment may take to reach a box: before a prompt, and at a step boundary,
 *  where the CLI sits parked waiting for the line this holds up. */
export declare const COPY_CAP_MS = 300000;
export declare const STEER_COPY_CAP_MS = 30000;
/**
 * The text with every file handle pointed at the box's own copy. dsh saves an attachment on this
 * PC and names that path in the handle, which a `claude` running on another box cannot read, so
 * each file is handed to `copy` (local path and a far name in, far path out) and its handle takes
 * the path that comes back. A copy that fails leaves its handle as it was, and Claude then says
 * the path is unreadable, which is what happened to every handle before this.
 */
export declare function relayFileHandles(text: string, copy: (localPath: string, farName: string) => Promise<string>, log?: (level: string, message: string) => void): Promise<string>;
/** The images of a turn, newest MAX_IMAGES kept, for the stdin line that carries them. */
export declare function imageRefs(turns: LooseMessage[]): ImageAttachmentRef[];
