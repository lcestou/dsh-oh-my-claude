// How a dsh session's messages turn into the prompt text, its parts, its attachments and its images.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { basename } from "node:path";
import { LlmError } from "@deepseek-ai/dsh-llm";
import { sourceBlockOf, } from "../context-sources.js";
import { COMMAND_CATALOG } from "../dsh.js";
import { errorText } from "../process.js";
const MAX_IMAGES = 20;
/** The browser's IANA zone as dsh stamped it on the latest user prompt; undefined when no
 *  prompt carried one (an API caller, an old log), so clocks fall back to the box's zone. */
export function clientTimeZone(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const zone = messages[i]?.source?.clientTimeZone;
        if (zone)
            return zone;
    }
    return undefined;
}
/** Join a message's text blocks on newlines, or return a string content as-is; non-text blocks (images, tool calls) are dropped and undefined content becomes empty. */
export const textOf = (content) => {
    if (!Array.isArray(content))
        return content ?? "";
    return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
};
/** The file and image blocks of a message as the steer card names them, in block order. A block
 *  without its attachment reference (wire data from an older dsh) is skipped, as dsh's own queue
 *  dock does. Empty for a string content or a text-only message. */
export const attachmentsOf = (content) => Array.isArray(content)
    ? content.flatMap((b) => {
        if ((b.type !== "file" && b.type !== "image") || !b.attachment)
            return [];
        // SAFETY: both attachment refs carry `bytes`; only the file one always carries `name`
        const ref = b.attachment;
        const chip = { kind: b.type, bytes: ref.bytes ?? 0 };
        if (ref.name)
            chip.name = ref.name;
        return [chip];
    })
    : [];
/** The key a message dsh delivered mid-step is marked under once it went over stdin: the prompt's
 *  rpcId for a typed steer, the message id for anything dsh sends on its own behalf (a child's
 *  send_message, a settlement notice, a job's finish line). Undefined for what never goes over
 *  stdin on its own: an assistant turn, a tool result. */
export const steerKey = (m) => m.role === "user" && m.source?.kind !== "tool" ? (m.source?.rpcId ?? m.id) : undefined;
/** A message the prompt builder treats as conversation: a user message that is not a tool result,
 * and every assistant message. */
const isTurn = (m) => (m.role === "user" && m.source?.kind !== "tool") || m.role === "assistant";
/** A tool result, in either form dsh has written one (a `role: "tool"` message, or a user message
 *  from a tool), with the id of the call it answers. */
const resultCallId = (m) => m.role === "tool"
    ? m.toolCallId
    : m.role === "user" && m.source?.kind === "tool"
        ? m.source.callId
        : undefined;
/** The tool calls an assistant message made, by id and name. */
const toolCallsOf = (m) => m.role === "assistant" && Array.isArray(m.content)
    ? m.content.flatMap((b) => b.type === "tool-call" ? [{ id: b.id, name: b.name, input: b.arguments }] : [])
    : [];
/**
 * Pick the messages that go into this call. Fresh: the whole transcript, since `claude -p` is
 * stateless. Resuming: what came after Claude's own last reply (`own` names this route's
 * provider), so the turns another model made while the session ran elsewhere reach Claude too;
 * without that its transcript skipped from its own last reply to the new prompt. A tool result
 * rides along only when the call it answers is in the same slice: another model's tool use is
 * transcript Claude never saw, while Claude's own results already sit in its session.
 */
export function selectTurns(messages, resuming, own) {
    const all = messages ?? [];
    let start = 0;
    if (resuming) {
        let last = -1;
        let lastOwn = -1;
        all.forEach((m, i) => {
            if (m.role !== "assistant")
                return;
            last = i;
            if (own !== undefined && m.source?.provider === own)
                lastOwn = i;
        });
        start = (lastOwn >= 0 ? lastOwn : last) + 1;
    }
    const slice = all.slice(start);
    const calls = new Set(slice.flatMap((m) => toolCallsOf(m).map((c) => c.id)));
    return slice.filter((m) => {
        const callId = resultCallId(m);
        return callId === undefined ? isTurn(m) : calls.has(callId);
    });
}
/** The most of one tool's input or output another model's transcript carries into the prompt. */
export const TOOL_TEXT_CAP = 2000;
/** `text`, or its first TOOL_TEXT_CAP characters and how many more there were. */
const capped = (text) => text.length > TOOL_TEXT_CAP
    ? `${text.slice(0, TOOL_TEXT_CAP)}… (${text.length - TOOL_TEXT_CAP} more characters)`
    : text;
/** dsh's instruction bundle repeats files Claude Code already loads on its own (`CLAUDE.md` in the
 *  workspace, `~/.claude/CLAUDE.md`), so those blocks are dropped from what goes to Claude. The
 *  bundle is one `<system-reminder>` with `Instructions from: <path>` headers; a block runs to
 *  the next header or the closing tag. Empty when nothing but the wrapper would remain. */
export function withoutNativeInstructions(text) {
    const header = /^Instructions from: (.+)$/m;
    if (!header.test(text))
        return text;
    const close = /\s*<\/system-reminder>\s*$/.exec(text);
    const body = close ? text.slice(0, close.index) : text;
    const pieces = body.split(/^(?=Instructions from: )/m);
    const kept = pieces.filter((p) => {
        const m = header.exec(p);
        return !m || !/(^|\/)CLAUDE\.md\s*$/.test((m[1] ?? "").trim());
    });
    if (kept.length === pieces.length)
        return text;
    if (!kept.some((p) => header.test(p)))
        return "";
    return kept.join("").trimEnd() + (close ? close[0] : "");
}
/** Which withheld block a message is, if any. The chat row mask classifies the same sources from
 *  the client side, so the rule itself lives in `context-sources.ts` and both read it there. */
export const contextSourceOf = (m) => sourceBlockOf(m.source);
/** What each dsh block cost this turn, in characters, measured before any switch removed it: a
 *  cleared checkbox still has to show its number or the owner cannot tell whether to put it back.
 *  `instructions` counts what survives the CLAUDE.md filter and `claudemd` counts what the filter
 *  took, so the two together are the bundle dsh handed over. A key is absent when this turn carried
 *  nothing of that kind, which is not the same as zero and must not be flattened into one. */
export function contextSizes(turns) {
    const sizes = {};
    const add = (key, n) => {
        sizes[key] = (sizes[key] ?? 0) + n;
    };
    for (const m of turns) {
        const source = contextSourceOf(m);
        if (source === undefined)
            continue;
        const text = textOf(m.content);
        if (source !== "instructions") {
            add(source, text.length);
            continue;
        }
        const kept = withoutNativeInstructions(text);
        add("instructions", kept.length);
        add("claudemd", text.length - kept.length);
    }
    return sizes;
}
/** The CLI's slash-command names, written by `bridgeCommands` into a `globalThis` slot. Both dsh and
 *  Claude Code can know one of these skills: dsh injects the skill body as a user message, and the
 *  CLI then matches its own `/name` in that prompt to inject the same body a second time. The CLI's
 *  copy cannot be stopped from here, so the plugin leaves dsh's behind for a listed skill (seen
 *  2026-09-18 in transcript 50525676: 4.3 KB from dsh, then 8.7 KB from the CLI, one row after the
 *  other); a skill the CLI does not list is dsh's only copy, so it stays. Undefined before the
 *  first init frame writes it. */
const cliCommands = () => 
// SAFETY: a plain slot on globalThis, written only in bridgeCommands
globalThis[COMMAND_CATALOG];
/** Prompt text of one dsh message: a withheld block answers empty, a skill-invocation the CLI also
 *  lists is dsh's duplicate of a body Claude Code injects itself (so it answers empty), and the
 *  instruction bundle keeps losing its CLAUDE.md sections whatever the switches say, since Claude
 *  Code loads those itself. */
export const promptTextOf = (m, drops = new Set()) => {
    const source = contextSourceOf(m);
    if (source !== undefined && drops.has(source))
        return "";
    if (m.source?.kind === "skill-invocation" && cliCommands()?.includes(m.source?.name ?? ""))
        return "";
    return m.source?.kind === "agent-instructions"
        ? withoutNativeInstructions(textOf(m.content))
        : textOf(m.content);
};
/** The turn's parts, with withheld blocks removed. An assistant message lists the tool calls it
 *  made and a tool result is labelled with the tool it came from, so a turn another model worked
 *  with tools reads as what happened, not as a bare reply. */
const partsOf = (turns, drops) => {
    const names = new Map(turns.flatMap((m) => toolCallsOf(m).map((c) => [c.id, c.name])));
    return turns
        .map((m) => {
        const callId = resultCallId(m);
        if (callId !== undefined)
            return {
                role: "tool",
                text: `${names.get(callId) ?? "tool"} returned:\n${capped(textOf(m.content))}`,
            };
        const text = promptTextOf(m, drops);
        const calls = toolCallsOf(m).map((c) => `(called ${c.name} ${capped(c.input)})`);
        return { role: m.role, text: [text, ...calls].filter(Boolean).join("\n") };
    })
        .filter((t) => t.text !== "");
};
/**
 * The turn's text as one stdin prompt. A turn with assistant text in it is labelled by role so the
 * history stays legible; a plain user turn is sent as it was typed, with no label. A turn that
 * carries only an image has no text to send, so it becomes `(see attached)` and the image rides
 * along in `imageRefs`.
 */
export function buildPrompt(turns, drops = new Set()) {
    const filtered = partsOf(turns, drops);
    // A turn dsh opened with nothing but a withheld block would leave no prompt at all, and the CLI
    // needs one, so that turn goes out with an empty drop set: failing a turn is a worse answer than
    // sending the block it was about. The live case is the runtime snapshot, which re-sends itself
    // whenever the file or approval policy changes and can arrive as the only message of a turn.
    // `withoutNativeInstructions` still applies on this path, and should: dropping dsh's duplicate of
    // a CLAUDE.md the CLI loads itself is not one of the switches, it is what the adapter has always
    // done, and re-sending the copy here would double the file rather than rescue the turn.
    const parts = filtered.length > 0 ? filtered : partsOf(turns, new Set());
    if (!parts.some((t) => t.role === "user")) {
        // Attachment-only turn: the user sent an image (or other non-text block) with no typed
        // text. Images ride along separately via imageRefs, but Claude still needs a non-empty
        // prompt on stdin, so synthesize a minimal one rather than reject the whole turn.
        const hasUserAttachment = turns.some((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type !== "text"));
        if (hasUserAttachment)
            return "(see attached)";
        throw new LlmError("no user message", "INVALID_REQUEST");
    }
    const multi = parts.some((t) => t.role !== "user");
    return parts.map((t) => (multi ? `[${t.role}]\n${t.text}` : t.text)).join("\n\n");
}
/** The most pixels a side may have for an image sent inline. The API allows 8000 on a request with
 *  few images and 2000 once the conversation holds more than twenty, and a long design session
 *  gets there: the request then fails with "image dimensions exceed max allowed size for
 *  many-image requests" and the CLI drops the image (2026-09-18, a 2884x156 screenshot as the
 *  forty-second image). The CLI caps everything it ingests itself at 2000, so this matches it;
 *  Node has nothing to scale an image with, so an oversize one goes by path and the Read tool,
 *  which scales, shows it a tool call later. */
export const MAX_IMAGE_SIDE = 2000;
/** True when either side of an image exceeds `MAX_IMAGE_SIDE`, the most the API accepts inline
 *  once a conversation holds many images. Such an image is not sent inline at all. The prompt names
 *  its saved path instead, and Claude reads it with its file tool, which scales it down. */
export const oversize = (ref) => (ref.width ?? 0) > MAX_IMAGE_SIDE || (ref.height ?? 0) > MAX_IMAGE_SIDE;
/** The file extension Claude Code's Read tool needs to treat a copy as an image. */
export const IMAGE_EXT = new Map([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/gif", "gif"],
    ["image/webp", "webp"],
]);
/**
 * Where each image of the turn lives on disk, told to the model after the prompt. The image rides
 * inline on the stdin line, which lets Claude see it and nothing more: no path, so no Read, no
 * edit, no handing it to a subagent. dsh's own store names an image by hash with no extension, so
 * the note points at the copy `keepImageCopy` wrote. Files need nothing here: dsh replaces a file
 * block with a line naming its stored path before any provider sees the turn.
 */
export function attachmentNotes(turns, images) {
    const pathOf = new Map(images.filter((i) => i.attachmentId && i.path).map((i) => [i.attachmentId, i.path]));
    const notes = [];
    for (const m of turns) {
        if (m.role !== "user" || !Array.isArray(m.content))
            continue;
        for (const b of m.content) {
            if (b.type !== "image" || !b.attachment)
                continue;
            const ref = b.attachment;
            const path = pathOf.get(ref.attachmentId);
            if (!path)
                continue;
            const size = ref.width && ref.height ? `, ${ref.width}x${ref.height}px` : "";
            const label = `[Image ${ref.name ? `"${ref.name}" ` : ""}(${ref.attachmentId})`;
            notes.push(oversize(ref)
                ? `${label}: not shown inline, it is over ${MAX_IMAGE_SIDE}px on a side, the most the API takes once a conversation holds many images. Read the copy at "${path}" (${ref.mediaType}${size}) with your file tool, which scales it down, and copy it to a writable location before modifying it.]`
                : `${label}: the copy shown above is saved at "${path}" (${ref.mediaType}${size}). Read that path with your file tools when it is needed again, and copy it to a writable location before modifying it.]`);
        }
    }
    return notes.join("\n");
}
/** dsh's handle for an attached file, as `fileHandleText` writes it when the stored copy has a
 *  readable path (dsh-llm 0.1.6): the quoted name, the first eight hex of its sha256, the quoted
 *  path. The other form, "was uploaded, but … cannot access a readable path", has no path and
 *  does not match. */
const FILE_HANDLE = /(\[File ("(?:[^"\\]|\\.)*") \(\d+ bytes, sha256:([0-9a-f]{8})\): verbatim read-only copy saved at )("(?:[^"\\]|\\.)*")\./g;
/** How long one attachment may take to reach a box: before a prompt, and at a step boundary,
 *  where the CLI sits parked waiting for the line this holds up. */
export const COPY_CAP_MS = 300_000;
export const STEER_COPY_CAP_MS = 30_000;
/**
 * The text with every file handle pointed at the box's own copy. dsh saves an attachment on this
 * PC and names that path in the handle, which a `claude` running on another box cannot read, so
 * each file is handed to `copy` (local path and a far name in, far path out) and its handle takes
 * the path that comes back. A copy that fails leaves its handle as it was, and Claude then says
 * the path is unreadable, which is what happened to every handle before this.
 */
export async function relayFileHandles(text, copy, log = () => { }) {
    const farOf = new Map();
    for (const [, , quotedName, sha, quotedPath] of text.matchAll(FILE_HANDLE)) {
        if (!quotedName || !sha || !quotedPath || farOf.has(quotedPath))
            continue;
        try {
            // The sha keeps two files that share a name apart on the box.
            const farName = `${sha}-${basename(String(JSON.parse(quotedName))) || "file"}`;
            farOf.set(quotedPath, await copy(String(JSON.parse(quotedPath)), farName));
        }
        catch (error) {
            log("warn", `attachment ${quotedName} not copied to the box: ${errorText(error)}`);
        }
    }
    if (farOf.size === 0)
        return text;
    // Rebuilt from the handle's own head, not searched for inside it: a file name may hold any text.
    return text.replace(FILE_HANDLE, (whole, head, _name, _sha, quoted) => {
        const far = farOf.get(quoted);
        return far === undefined ? whole : `${head}${JSON.stringify(far)}.`;
    });
}
/** The images of a turn, newest MAX_IMAGES kept, for the stdin line that carries them. */
export function imageRefs(turns) {
    const refs = [];
    for (const m of turns) {
        if (m.role !== "user" || !Array.isArray(m.content))
            continue;
        for (const b of m.content)
            if (b.type === "image" && b.attachment)
                refs.push(b.attachment);
    }
    return refs.slice(-MAX_IMAGES);
}
//# sourceMappingURL=prompt.js.map