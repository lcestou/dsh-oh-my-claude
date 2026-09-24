// The repair of dsh session logs this plugin once shipped only as a dev tool, now run by the
// plugin itself: at start, on open, and when a wake finds a session dsh refuses.
//
// Before 2026-09-08 (toolsInline: false) this plugin appended raw `tool/call` and `tool/result`
// rows for Claude Code's own tools. dsh's v0 -> v3 session migration requires every `tool/call`
// to be advertised by an `assistant/message` tool-call block in the same step, so such logs fail
// with "failed to observe session ...: tool/call <id> does not match one advertised tool call".
// Advertising them after the fact breaks dsh's one-attempt-per-message rule, so the repair drops
// the unadvertised rows (and the prune/replacement rows that only pointed at them), keeps every
// seq reference consistent, and proves the result through dsh's own migration chain before it
// writes anything. The text of the conversation is untouched; only the tool cards of those old
// turns disappear from history.
//
// Before 2026-09-23 the Restore tab seeded a log with no `system/message` head. dsh's loader
// protects the first surface event as the system head and refuses a log where a `system/message`
// follows any other surface event ("system/message requires a protected first surface head");
// dsh's own loop writes one on the first live turn, so every restored session loaded until the
// next reload after that turn and was refused from then on. The repair inserts the head the seed
// now writes, ahead of the first surface row, and renumbers.
//
// A v4 step that ends over a `tool/call` with no `tool/result` is refused whole ("step/end leaves
// unresolved tool call"). The plugin wrote such a step when a user Stop landed while one of Claude
// Code's own tools was running (fixed in the adapter 2026-09-23). The repair closes each open call
// with the same placeholder result the adapter now writes, right before that step's `step/end`.
//
// `tools/dsh-session-repair.ts` is the command-line front over this module for a checkout.
import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
/** The slice of dsh's session-format catalog this uses: its migration chain, run in strict mode. */
/** Narrow `T | undefined` to `T` so a defined value can be passed where the type requires it,
 *  without an `as` assertion.
 */
const defined = (x) => x !== undefined;
/** The call id a `tool/result` row answers: v4 puts it at `message.toolCallId`, older formats only
 *  at `message.source.callId`. Undefined for any other row. */
const resultOf = (e) => {
    const onMessage = e.data?.message?.toolCallId;
    return typeof onMessage === "string" ? onMessage : e.data?.message?.source?.callId;
};
/** The text the adapter's own placeholder result carries; kept the same so a repaired log reads
 *  like one the fixed adapter wrote. */
const PENDING_TEXT = "(still running when dsh took over this step; the output shows in the next step)";
/** The event types dsh folds onto the conversation surface; the first of them is the system head. */
export const SURFACE = new Set([
    "system/message",
    "user/message",
    "assistant/message",
    "tool/result",
]);
/** The seq span a replacing `surfaceOp` names, or undefined for `"append"` and anything else. A
 *  physical row says `startSeq`/`endSeq` (what dsh writes to disk); the projected shape says
 *  `start`/`end`. Reading only the second is how a v4 system/message replacement kept pointing at
 *  its pre-renumber seq ("replacement range is not on the current surface"). */
const spanOf = (op) => {
    if (!op || typeof op !== "object")
        return undefined;
    const start = op["startSeq"] ?? op["start"];
    const end = op["endSeq"] ?? op["end"];
    return typeof start === "number" && typeof end === "number" ? { start, end } : undefined;
};
/** `op` with its span rewritten in whichever field pair it already uses. */
const withSpan = (op, span) => "startSeq" in op
    ? { ...op, startSeq: span.start, endSeq: span.end }
    : { ...op, start: span.start, end: span.end };
/**
 * Drop unadvertised tool rows and keep every seq reference consistent. A `tool/call` no
 * `assistant/message` tool-call block advertised is what rows mode wrote for Claude Code's own
 * tools; dsh 0.1.5's v0 migration refused it, and dsh 0.1.7 refuses it again in v4 logs at load,
 * as "has no advertised tool lifecycle". The v4 result rows are the same rows to drop, found
 * through the call id they carry on the message.
 *
 * Then, when the first surface row is not a `system/message`, insert the head the seed writes
 * since 2026-09-23 ahead of it, inside the same step, in the source shape `version` requires
 * (plugin source up to v3, system-prompt from v4). A log with no surface row at all is left as is.
 */
export function repair(rows, version = 4) {
    const advertised = new Set();
    const dropIds = new Set();
    const dropped = new Set();
    const drop = (e) => {
        if (e.seq !== undefined)
            dropped.add(e.seq);
    };
    const kept = [];
    for (const e of rows) {
        if (e.type === "assistant/message")
            for (const b of e.data?.message?.content ?? [])
                if (b.type === "tool-call" && b.id !== undefined)
                    advertised.add(b.id);
        if (e.type === "tool/call" && e.data?.callId !== undefined && !advertised.has(e.data.callId)) {
            dropIds.add(e.data.callId);
            drop(e);
            continue;
        }
        const answers = resultOf(e);
        if (e.type === "tool/result" && answers !== undefined && dropIds.has(answers)) {
            drop(e);
            continue;
        }
        kept.push(e);
    }
    // Rows that only pointed at dropped rows go too: compaction/prune and range-replacing results.
    const alive = (n) => !dropped.has(n);
    const out = [];
    for (const e of kept) {
        if (e.type === "compaction/prune" && Array.isArray(e.data?.shadowedSeqs)) {
            const keep = e.data.shadowedSeqs.filter(alive);
            if (keep.length === 0) {
                drop(e);
                continue;
            }
            e.data.shadowedSeqs = keep;
            e.data.shadowedRange = {
                ...e.data.shadowedRange,
                start: Math.min(...keep),
                end: Math.max(...keep),
            };
        }
        const replaced = e.type === "tool/result" ? spanOf(e.surfaceOp) : undefined;
        if (replaced && typeof e.surfaceOp === "object") {
            const span = [];
            for (let x = replaced.start; x <= replaced.end; x++)
                if (alive(x))
                    span.push(x);
            const first = span[0];
            const last = span[span.length - 1];
            if (first === undefined || last === undefined) {
                drop(e);
                continue;
            }
            e.surfaceOp = withSpan(e.surfaceOp, { start: first, end: last });
        }
        out.push(e);
    }
    // Close every call still open when its step ends, v4 only: the placeholder is dsh 0.1.7's
    // `role: "tool"` result message, and a v0 log never reaches here with an advertised call open
    // (rows mode wrote its calls unadvertised, and the pass above dropped them). A seq of -1 takes a
    // fresh slot in the renumbering below; `sourceEventSeqs` cites the call's seq, which the same
    // renumbering remaps.
    let closedCalls = 0;
    if (version >= 4) {
        const open = new Map();
        const closed = [];
        for (const e of out) {
            if (e.type === "tool/call" && e.data?.callId !== undefined && e.seq !== undefined)
                open.set(e.data.callId, e.seq);
            const answers = resultOf(e);
            if (e.type === "tool/result" && answers !== undefined)
                open.delete(answers);
            if (e.type === "step/end") {
                for (const [callId, callSeq] of open)
                    closed.push({
                        type: "tool/result",
                        seq: -1,
                        time: e.time,
                        data: {
                            turn: e.data?.turn,
                            step: e.data?.step,
                            message: {
                                id: `${callId}:result`,
                                role: "tool",
                                toolCallId: callId,
                                content: [{ type: "text", text: PENDING_TEXT }],
                                source: { kind: "tool", callId },
                            },
                        },
                        surfaceOp: "append",
                        sourceEventSeqs: [callSeq],
                    });
                closedCalls += open.size;
                open.clear();
            }
            closed.push(e);
        }
        out.splice(0, out.length, ...closed);
    }
    // The system head: a placeholder seq of -1 takes a fresh slot in the renumbering below, and
    // nothing in the log can reference it. The row goes where dsh's loop and the seed both put it,
    // right after the `step/start` that opens the first surface row's step.
    const first = out.findIndex((e) => SURFACE.has(e.type));
    const addedHead = first !== -1 && out[first]?.type !== "system/message";
    if (addedHead) {
        let step;
        for (const e of out.slice(0, first))
            if (e.type === "step/start")
                step = { turn: e.data?.turn, step: e.data?.step };
        // SAFETY: dsh opens a step before any surface row; a log without one fails the migration check
        // that follows this repair, which is the report this tool exists to give.
        out.splice(first, 0, {
            type: "system/message",
            seq: -1,
            time: out[first]?.time ?? 0,
            data: {
                ...step,
                message: {
                    id: "restored:system",
                    role: "system",
                    content: [
                        {
                            type: "text",
                            text: "No system prompt recorded: these turns were restored from a Claude Code transcript, and Claude Code ran them with its own prompt.",
                        },
                    ],
                    source: version >= 4 ? { kind: "system-prompt" } : { kind: "plugin", plugin: "claude-code" },
                },
            },
            surfaceOp: "append",
        });
    }
    // Every row owns one seq slot; a packed chunk run owns one per chunk. Renumber, then remap
    // every reference (ranges, lists, prune targets) onto the surviving seqs.
    const map = new Map();
    let k = 0;
    for (const e of out) {
        if (e.seq0 !== undefined) {
            const n = e.data?.texts?.length ?? e.data?.dt?.length ?? 1;
            for (let j = 0; j < n; j++)
                map.set(e.seq0 + j, k + j);
            e.seq0 = k;
            k += n;
        }
        else if (e.seq !== undefined) {
            map.set(e.seq, k);
            e.seq = k++;
        }
    }
    const keys = [...map.keys()].toSorted((a, b) => a - b);
    const lo = (x) => {
        const key = keys.find((v) => v >= x);
        return key === undefined ? undefined : map.get(key);
    };
    const hi = (x) => {
        let r;
        for (const v of keys) {
            if (v > x)
                break;
            r = map.get(v);
        }
        return r;
    };
    const one = (x) => map.get(x);
    const list = (arr) => arr.map(one).filter(defined);
    const refs = (arr) => arr
        .map((x) => {
        if (!Array.isArray(x))
            return one(x);
        const s = lo(x[0]), e = hi(x[1]);
        return s !== undefined && e !== undefined && s <= e ? [s, e] : undefined;
    })
        .filter(defined);
    const range = (r) => {
        const s = lo(r.start), e = hi(r.end);
        return s !== undefined && e !== undefined && s <= e ? { ...r, start: s, end: e } : r;
    };
    for (const e of out) {
        if (Array.isArray(e.sourceEventSeqs))
            e.sourceEventSeqs = refs(e.sourceEventSeqs);
        const span = spanOf(e.surfaceOp);
        if (span && typeof e.surfaceOp === "object")
            e.surfaceOp = withSpan(e.surfaceOp, range(span));
        if (Array.isArray(e.data?.messageSeqs))
            e.data.messageSeqs = list(e.data.messageSeqs);
        if (Array.isArray(e.data?.shadowedSeqs))
            e.data.shadowedSeqs = list(e.data.shadowedSeqs);
        if (e.data?.shadowedRange)
            e.data.shadowedRange = range(e.data.shadowedRange);
    }
    return { rows: out, droppedCalls: dropIds.size, addedHead, closedCalls };
}
/** Whether the log's first surface row is something other than a `system/message`: the shape the
 *  Restore tab seeded before 2026-09-23. A log with no surface row at all is not headless. */
export const headless = (rows) => {
    const first = rows.find((e) => SURFACE.has(e.type));
    return first !== undefined && first.type !== "system/message";
};
/** The four refusal texts the repair mends, as dsh 0.1.5 to 0.1.7 word them, plus `headless`,
 *  the plugin's own word (never dsh's) for a log that loads today but has no system head and
 *  will be refused after its first live turn. A message holding none of them is a refusal the
 *  plugin does not understand and leaves alone. */
export const KNOWN_REFUSALS = [
    "does not match one advertised tool call",
    "has no advertised tool lifecycle",
    "protected first surface head",
    "leaves unresolved tool call",
    "headless",
];
/** Whether dsh's refusal is one `repair()` mends. False for any other text, including an empty
 *  one, so an unrecognised failure is reported rather than rewritten. */
export function knownRefusal(message) {
    return KNOWN_REFUSALS.some((s) => message.includes(s));
}
/** The four bytes every zstd frame opens with, as dsh's own log reader looks for them. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
/** Decode a zstd session log (one or more frames) into its header and rows. Throws on an empty
 *  file or a first line that is not JSON; a row that is not JSON also throws, which is the
 *  failure the caller records as unknown. Uses node's own zstd, so no `zstd` binary is needed.
 *  Node 22's `zstdDecompressSync` stops at the first frame (measured 2026-09-23 on the node that
 *  runs dsh-web; bun decodes the whole stream), and a real log is many frames, one per flush, so
 *  the frames are cut at their magic bytes and decoded one by one, the way dsh reads the log. */
export function readLog(file) {
    const buf = readFileSync(file);
    let off = 0;
    let text = "";
    while (off < buf.length) {
        const found = buf.indexOf(ZSTD_MAGIC, off + 4);
        const next = found === -1 ? buf.length : found;
        text += zstdDecompressSync(buf.subarray(off, next)).toString("utf8");
        off = next;
    }
    // SAFETY: every line of a dsh session log is one JSON object with a `type`; a row that is not one
    // fails the migration chain this is fed to, which is the failure the caller records as unknown.
    const rows = text
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    // SAFETY: dsh writes the header as the first line of the log; `undefined` covers an empty file,
    // which the next line rejects.
    const header = rows[0];
    if (!header)
        throw new Error(`${file} is empty: no header line`);
    return { header, rows: rows.slice(1) };
}
/** One zstd frame. dsh reads the header as its own frame ("first frame is not exactly one header
 *  line" otherwise), then the rows; two frames back to back are one valid stream. */
export const frame = (text) => zstdCompressSync(Buffer.from(text, "utf8"));
/** Write a repaired log as two frames next to the original, copy the original to
 *  `<file>.bak-<ms>`, rename the new file into place, and return the backup path. The path is
 *  never absent: the rename is atomic on one filesystem, and a crash between the copy and the
 *  rename leaves the original in place and a `.bak` beside it. */
export function writeLog(file, header, rows) {
    const body = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const tmp = file + ".repair-tmp";
    const bak = `${file}.bak-${Date.now()}`;
    writeFileSync(tmp, Buffer.concat([frame(JSON.stringify(header) + "\n"), frame(body)]));
    copyFileSync(file, bak);
    renameSync(tmp, file);
    return bak;
}
/** Copy a backup back over the log it was taken from. Idempotent when the backup is already
 *  gone: nothing to restore, nothing thrown. */
export function restoreBak(file, bak) {
    try {
        copyFileSync(bak, file);
    }
    catch {
        // the backup is gone: the log stands as it is
    }
}
/** Feed rows through dsh's restore with the options its own load uses; undefined on success,
 *  the refusal message otherwise. Mirrors what dsh does at load, so a log this answers undefined
 *  for is one dsh loads. */
export function migrate(catalog, header, rows) {
    try {
        // The pair dsh's own load passes: "transformed" up to v3, "current" from v4, whose relationship
        // check is what refuses a raw tool/call (see rows-probe.ts).
        const restore = catalog.createRestore(header, {
            recovery: "strict",
            validation: (header.version ?? 0) >= 4 ? "current" : "transformed",
        });
        for (const e of rows)
            restore.decodeRow(e);
        restore.finish();
        return undefined;
    }
    catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}
//# sourceMappingURL=session-repair.js.map