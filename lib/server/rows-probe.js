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
/** The current-format log rows mode would write for one turn with one tool: shapes copied from a
 *  dsh 0.1.5 v3 log. The call and its result sit inside the step, ahead of the settled message. */
export const rawRowsLog = () => ({
    header: {
        type: "session",
        version: 3,
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
        ev(4, "tool/result", {
            turn: 1,
            step: 1,
            message: {
                source: { kind: "tool", callId: "raw" },
                content: [
                    {
                        type: "tool-result",
                        toolCallId: "raw",
                        content: [{ type: "text", text: "ok" }],
                        isError: false,
                    },
                ],
                role: "user",
                id: "r",
            },
        }, { sourceEventSeqs: [3], surfaceOp: "append" }),
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
        const { header, rows } = rawRowsLog();
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