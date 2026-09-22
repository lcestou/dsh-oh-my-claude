// Whether the dsh this plugin runs inside loads a log holding a raw `tool/call` row that no settled
// `assistant/message` advertised. That is what native tool rows for Claude Code's own tools write:
// Claude runs the tool inside one dsh step, so the row lands before the message and the message
// never names it. dsh 0.1.5's format migration refuses such rows ("tool/call … does not match one
// advertised tool call"), which is what broke every rows-mode log at the v0 to v3 bump; its plain
// load of a current-format log does not check them (dsh-session-persistence-jsonl passes
// `validation: "transformed"`, and for the current version that validates nothing), measured on
// 0.1.5-rc.1 against a real log. A session that will not load is worse than inline tool text, so
// the Tune switch for rows unlocks only when this probe passes. It runs the restore dsh runs at
// load, in the mode dsh runs it, on a synthetic log in memory: nothing on disk is touched, and a
// dsh that starts checking at load locks the switch again without a plugin release.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
const T0 = 1_700_000_000_000;
/** One synthetic log row for the probe, timed at a base plus its sequence number so rows stay
 *  ordered. */
const ev = (seq, type, data, extra = {}) => ({
    type,
    seq,
    time: T0 + seq,
    ...extra,
    data,
});
/**
 * A tool's result as the log version stores it. Up to v3 (dsh 0.1.6) it is a user message from the
 * tool source holding one `tool-result` block; from v4 (dsh 0.1.7) it is a first-class message of
 * its own, `role: "tool"`, the call id on the message and the text as plain blocks, and v4's
 * loader refuses the wrapper block outright ("content must not contain a released tool-result
 * wrapper"). The live rows mode gets this right on its own by calling dsh's
 * `createToolResultMessage`; the probe and the Import seed build the message by hand and have to
 * pick the shape themselves.
 */
export function toolResultMessage(version, callId, id, text, isError = false) {
    const content = [{ type: "text", text }];
    if (version >= 4)
        return {
            id,
            role: "tool",
            toolCallId: callId,
            source: { kind: "tool", callId },
            content,
            isError,
        };
    return {
        id,
        role: "user",
        source: { kind: "tool", callId },
        content: [{ type: "tool-result", toolCallId: callId, content, isError }],
    };
}
/**
 * The current-format log rows mode would write for one turn with one tool: shapes copied from a
 * dsh 0.1.5 v3 log. The call and its result sit inside the step, ahead of the settled message.
 *
 * `version` is the log version the installed dsh writes, not a fixed 3. A fixture stamped below
 * that version is a log needing migration, and dsh 0.1.7's v3-to-v4 migration refuses to run at
 * all without a parent's historical child evidence bound to it ("V3 catalog migration requires
 * explicit historical child facts"). The probe then failed before reaching the row it exists to
 * ask about, and locked rows over a migration a live session never runs.
 */
export const rawRowsLog = (version = 3) => ({
    header: {
        type: "session",
        version,
        id: "session-00000000-0000-4000-8000-000000000000",
        createdAt: T0,
        cwd: "/",
        isSeeded: false,
        delegationDepth: 0,
        agentPreset: "probe",
    },
    rows: [
        ev(0, "turn/start", { turn: 1 }),
        ev(1, "step/start", { turn: 1, step: 1 }),
        ev(2, "user/message", { content: [{ type: "text", text: "hi" }], source: { kind: "user" }, role: "user", id: "u" }, { surfaceOp: "append" }),
        ev(3, "tool/call", { turn: 1, step: 1, callId: "raw", name: "bash", arguments: "{}" }),
        ev(4, "tool/result", { turn: 1, step: 1, message: toolResultMessage(version, "raw", "r", "ok") }, { sourceEventSeqs: [3], surfaceOp: "append" }),
        ev(5, "assistant/message", {
            turn: 1,
            step: 1,
            message: {
                role: "assistant",
                source: { kind: "model", provider: "claude-code", model: "probe" },
                id: "m",
                content: [{ type: "text", text: "ab" }],
            },
            stream: [
                { type: "chunk", time: T0, chunk: { type: "block-start", index: 0, blockType: "text" } },
                { type: "text-chunks", time0: T0, index: 0, dt: [], texts: ["ab"] },
                {
                    type: "chunk",
                    time: T0,
                    chunk: { type: "block-end", index: 0, block: { type: "text", text: "ab" } },
                },
            ],
        }, { surfaceOp: "append" }),
        ev(6, "step/end", { turn: 1, step: 1 }),
        ev(7, "turn/end", { turn: 1, reason: "done" }),
    ],
});
/** dsh's session-format catalog, found next to the dsh that is running this plugin. The plugin's
 *  own node_modules cannot answer: a copy pinned there would be probing a different dsh. */
const catalogPath = (entry = process.argv[1] ?? "") => {
    const rel = join("node_modules", "@deepseek-ai", "dsh-session-format-catalog", "lib", "index.js");
    for (let dir = dirname(resolve(entry));; dir = dirname(dir)) {
        const at = join(dir, rel);
        if (existsSync(at))
            return at;
        if (dir === dirname(dir))
            return undefined;
    }
};
/**
 * The log version the installed dsh writes: 3 up to 0.1.6, 4 from 0.1.7. Read off dsh's own
 * catalog, so a log this plugin writes carries the version the reader expects. Undefined when the
 * catalog cannot be found or read, which leaves the caller to keep its own default.
 */
export async function currentLogVersion(entry) {
    const at = catalogPath(entry);
    if (at === undefined)
        return undefined;
    try {
        // SAFETY: `at` is dsh's own catalog module, checked to exist above, and its export carries the
        // version it reads and writes. A dsh that renames either answers undefined through the catch.
        const { sessionFormatCatalog } = (await import(at));
        return sessionFormatCatalog.currentVersion;
    }
    catch {
        return undefined;
    }
}
/** Feed the synthetic log through dsh's own restore, with the options its load passes. */
export async function probeRawToolRows(entry) {
    const at = catalogPath(entry);
    if (at === undefined)
        return { ok: false, reason: "dsh session-format catalog not found" };
    try {
        // SAFETY: `at` is dsh's own catalog module, checked to exist above; the export name is the one
        // tools/dsh-session-repair.ts reads. A dsh that renames it fails on the call below, and the
        // catch answers "rows off" with the message, which is the safe side.
        const { sessionFormatCatalog } = (await import(at));
        const { header, rows } = rawRowsLog(sessionFormatCatalog.currentVersion);
        // The pair dsh-session-persistence-jsonl hands createRestore when it opens a log. "current"
        // would be stricter than dsh itself and lock rows that load fine.
        const restore = sessionFormatCatalog.createRestore(header, {
            recovery: "strict",
            validation: "transformed",
        });
        for (const row of rows)
            restore.decodeRow(row);
        restore.finish();
        return { ok: true, reason: "" };
    }
    catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
}
//# sourceMappingURL=rows-probe.js.map