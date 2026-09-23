#!/usr/bin/env bun
// Repair dsh session logs that dsh 0.1.5+ refuses to migrate, and v4 logs that 0.1.7 refuses to
// load because a rows-mode turn was cut short with a tool call open.
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
// next reload after that turn (a dsh-web restart, a second browser) and was refused from then on.
// The repair inserts the head the seed now writes, ahead of the first surface row, and renumbers.
//
// A v4 step that ends over a `tool/call` with no `tool/result` is refused whole ("step/end leaves
// unresolved tool call"). The plugin writes such a step when a user Stop lands while one of Claude
// Code's own tools is running (fixed in the adapter 2026-09-23; #100 had covered the other exits).
// The repair closes each open call with the same placeholder result the adapter now writes, right
// before that step's `step/end`, citing the call it closes.
//
// usage:
//   bun tools/dsh-session-repair.ts --check  [--dsh <prefix>] [<log> | --all]
//   bun tools/dsh-session-repair.ts --apply  [--dsh <prefix>] [<log> | --all]
//   bun tools/dsh-session-repair.ts --self-check
//
// <prefix> is the npm prefix holding dsh 0.1.5+ (default: the one `dsh` on PATH lives in).
// --all walks $DSH_HOME/sessions (default ~/.dsh/sessions). Stop dsh-web before --apply. The
// original log is kept next to the repaired one as session.jsonl.zstd.bak-<timestamp>.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";

/** A span of seqs a row shadows or replaces; dsh carries more fields on it than the repair reads. */
type Range = { start: number; end: number; [key: string]: unknown };
/** One seq, or an inclusive pair standing for a run of them. */
type Ref = number | [number, number];
/** A block of an assistant message; only `tool-call` blocks matter here. */
type Block = { type: string; id?: string; [key: string]: unknown };
/** The payload fields the repair reads. dsh's events carry plenty more, which pass through as-is. */
type Data = {
  callId?: string;
  message?: {
    content?: Block[];
    source?: { callId?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  shadowedSeqs?: number[];
  shadowedRange?: Range;
  messageSeqs?: number[];
  texts?: string[];
  dt?: number[];
  [key: string]: unknown;
};
/** A log row. Ordinary rows own one `seq`; a packed chunk run owns `seq0` plus one slot per chunk. */
type Row = {
  type: string;
  seq?: number;
  seq0?: number;
  data?: Data;
  surfaceOp?: string | Record<string, unknown>;
  sourceEventSeqs?: Ref[];
  [key: string]: unknown;
};
type Header = { version?: number; [key: string]: unknown };
/** The slice of dsh's session-format catalog this uses: its migration chain, run in strict mode. */
type Catalog = {
  createRestore(
    header: Header,
    options: { recovery: string; validation: string },
  ): {
    decodeRow(row: Row): void;
    finish(): void;
  };
};

const args = process.argv.slice(2);
/** Return true when a flag is present on the command line, the first of three tiny argument
 *  helpers.
 */
const flag = (name: string) => args.includes(name);
/** Return the value following an option flag, or undefined when it is absent, so `--dsh x` reads as
 *  `x`.
 */
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

/** Narrow `T | undefined` to `T` so a defined value can be passed where the type requires it,
 *  without an `as` assertion.
 */
const defined = <T>(x: T | undefined): x is T => x !== undefined;
/** The call id a `tool/result` row answers: v4 puts it at `message.toolCallId`, older formats only
 *  at `message.source.callId`. Undefined for any other row. */
const resultOf = (e: Row): string | undefined => {
  const onMessage = e.data?.message?.toolCallId;
  return typeof onMessage === "string" ? onMessage : e.data?.message?.source?.callId;
};
/** The text the adapter's own placeholder result carries; kept the same so a repaired log reads
 *  like one the fixed adapter wrote. */
const PENDING_TEXT =
  "(still running when dsh took over this step; the output shows in the next step)";
/** The event types dsh folds onto the conversation surface; the first of them is the system head. */
const SURFACE = new Set(["system/message", "user/message", "assistant/message", "tool/result"]);

/** The seq span a replacing `surfaceOp` names, or undefined for `"append"` and anything else. A
 *  physical row says `startSeq`/`endSeq` (what dsh writes to disk); the projected shape says
 *  `start`/`end`. Reading only the second is how a v4 system/message replacement kept pointing at
 *  its pre-renumber seq ("replacement range is not on the current surface"). */
const spanOf = (op: Row["surfaceOp"]): Range | undefined => {
  if (!op || typeof op !== "object") return undefined;
  const start = op["startSeq"] ?? op["start"];
  const end = op["endSeq"] ?? op["end"];
  return typeof start === "number" && typeof end === "number" ? { start, end } : undefined;
};
/** `op` with its span rewritten in whichever field pair it already uses. */
const withSpan = (op: Record<string, unknown>, span: Range): Record<string, unknown> =>
  "startSeq" in op
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
export function repair(
  rows: Row[],
  version = 4,
): { rows: Row[]; droppedCalls: number; addedHead: boolean; closedCalls: number } {
  const advertised = new Set<string>();
  const dropIds = new Set<string>();
  const dropped = new Set<number>();
  const drop = (e: Row) => {
    if (e.seq !== undefined) dropped.add(e.seq);
  };
  const kept: Row[] = [];
  for (const e of rows) {
    if (e.type === "assistant/message")
      for (const b of e.data?.message?.content ?? [])
        if (b.type === "tool-call" && b.id !== undefined) advertised.add(b.id);
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
  const alive = (n: number) => !dropped.has(n);
  const out: Row[] = [];
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
      const span: number[] = [];
      for (let x = replaced.start; x <= replaced.end; x++) if (alive(x)) span.push(x);
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
    const open = new Map<string, number>();
    const closed: Row[] = [];
    for (const e of out) {
      if (e.type === "tool/call" && e.data?.callId !== undefined && e.seq !== undefined)
        open.set(e.data.callId, e.seq);
      const answers = resultOf(e);
      if (e.type === "tool/result" && answers !== undefined) open.delete(answers);
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
    let step: { turn: unknown; step: unknown } | undefined;
    for (const e of out.slice(0, first))
      if (e.type === "step/start") step = { turn: e.data?.turn, step: e.data?.step };
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
          source:
            version >= 4 ? { kind: "system-prompt" } : { kind: "plugin", plugin: "claude-code" },
        },
      },
      surfaceOp: "append",
    });
  }
  // Every row owns one seq slot; a packed chunk run owns one per chunk. Renumber, then remap
  // every reference (ranges, lists, prune targets) onto the surviving seqs.
  const map = new Map<number, number>();
  let k = 0;
  for (const e of out) {
    if (e.seq0 !== undefined) {
      const n = e.data?.texts?.length ?? e.data?.dt?.length ?? 1;
      for (let j = 0; j < n; j++) map.set(e.seq0 + j, k + j);
      e.seq0 = k;
      k += n;
    } else if (e.seq !== undefined) {
      map.set(e.seq, k);
      e.seq = k++;
    }
  }
  const keys = [...map.keys()].toSorted((a, b) => a - b);
  const lo = (x: number) => {
    const key = keys.find((v) => v >= x);
    return key === undefined ? undefined : map.get(key);
  };
  const hi = (x: number) => {
    let r;
    for (const v of keys) {
      if (v > x) break;
      r = map.get(v);
    }
    return r;
  };
  const one = (x: number) => map.get(x);
  const list = (arr: number[]) => arr.map(one).filter(defined);
  const refs = (arr: Ref[]): Ref[] =>
    arr
      .map((x): Ref | undefined => {
        if (!Array.isArray(x)) return one(x);
        const s = lo(x[0]),
          e = hi(x[1]);
        return s !== undefined && e !== undefined && s <= e ? [s, e] : undefined;
      })
      .filter(defined);
  const range = (r: Range): Range => {
    const s = lo(r.start),
      e = hi(r.end);
    return s !== undefined && e !== undefined && s <= e ? { ...r, start: s, end: e } : r;
  };
  for (const e of out) {
    if (Array.isArray(e.sourceEventSeqs)) e.sourceEventSeqs = refs(e.sourceEventSeqs);
    const span = spanOf(e.surfaceOp);
    if (span && typeof e.surfaceOp === "object") e.surfaceOp = withSpan(e.surfaceOp, range(span));
    if (Array.isArray(e.data?.messageSeqs)) e.data.messageSeqs = list(e.data.messageSeqs);
    if (Array.isArray(e.data?.shadowedSeqs)) e.data.shadowedSeqs = list(e.data.shadowedSeqs);
    if (e.data?.shadowedRange) e.data.shadowedRange = range(e.data.shadowedRange);
  }
  return { rows: out, droppedCalls: dropIds.size, addedHead, closedCalls };
}

/** Decode a zstd-compressed session log into its header and rows, throwing on an empty file that
 *  has no header line.
 */
function readLog(file: string): { header: Header; rows: Row[] } {
  const text = execFileSync("zstd", ["-dc", "--", file], { maxBuffer: 1 << 30 }).toString("utf8");
  // SAFETY: every line of a dsh session log is one JSON object with a `type`; a row that is not one
  // fails the migration chain this tool feeds it to, which is the failure it exists to report.
  const rows = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);
  // SAFETY: dsh writes the header as the first line of the log; `undefined` covers an empty file,
  // which the next line rejects.
  const header = rows[0] as Header | undefined;
  if (!header) throw new Error(`${file} is empty: no header line`);
  return { header, rows: rows.slice(1) };
}

/** One zstd frame. dsh reads the header as its own frame ("first frame is not exactly one
 * header line" otherwise), then the events; two frames back to back are one valid stream. */
const frame = (text: string) =>
  execFileSync("zstd", ["-q", "-c"], { input: text, maxBuffer: 1 << 30 });

/** Write a repaired log as two zstd frames (header then rows), moving the original aside as a
 *  timestamped backup first.
 */
function writeLog(file: string, header: Header, rows: Row[]) {
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const tmp = file + ".repair-tmp";
  writeFileSync(tmp, Buffer.concat([frame(JSON.stringify(header) + "\n"), frame(body)]));
  renameSync(file, `${file}.bak-${Date.now()}`);
  renameSync(tmp, file);
}

/** Resolve the npm prefix holding dsh 0.1.5+, from `--dsh` or the `dsh` on PATH, so the catalog is
 *  found at dsh's own install layout.
 */
function dshPrefix(): string {
  const given = opt("--dsh");
  if (given) return resolve(given);
  const bin = execFileSync("sh", ["-c", "command -v dsh"]).toString().trim();
  const real = execFileSync("readlink", ["-f", bin]).toString().trim();
  // A launcher script that pins its own node names the bin.js path inside; a symlinked bin.js
  // is that path itself. Either way: <prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
  const launcher = readFileSync(real, "utf8").slice(0, 4096);
  const named = /(\S+)\/lib\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js/.exec(launcher)?.[1];
  const prefix = named?.replace(/^"?\$HOME/, homedir()).replace(/"$/, "") ?? dirname(real);
  return named !== undefined ? resolve(prefix) : resolve(prefix, "..", "..", "..", "..", "..");
}

/** Import dsh's session-format catalog module by path, failing with a clear message when dsh 0.1.5+
 *  is not installed at the prefix.
 */
async function loadCatalog(prefix: string): Promise<Catalog> {
  const p = join(
    prefix,
    "lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js",
  );
  if (!existsSync(p))
    throw new Error(
      `no session-format catalog under ${prefix}; dsh 0.1.5+ is needed (use --dsh <prefix>)`,
    );
  // SAFETY: `p` is dsh's own catalog module, checked to exist above. The path is dsh's install
  // layout, which this dev-only tool reads rather than owns; a dsh that moves it fails the
  // `existsSync` with the message above, and one that renames the export fails on the
  // `createRestore` call two lines down. Both are loud, and `--dsh <prefix>` retargets the first.
  return (await import(p)).sessionFormatCatalog as Catalog;
}

/** Whether the log's first surface row is something other than a `system/message`: the shape the
 *  Restore tab seeded before 2026-09-23. A log with no surface row at all is not headless. */
const headless = (rows: Row[]): boolean => {
  const first = rows.find((e) => SURFACE.has(e.type));
  return first !== undefined && first.type !== "system/message";
};

/** Feed rows through dsh's migration chain; returns undefined on success, the refusal otherwise. */
function migrate(catalog: Catalog, header: Header, rows: Row[]): string | undefined {
  try {
    // The pair dsh's own load passes: "transformed" up to v3, "current" from v4, whose relationship
    // check is what refuses a raw tool/call (see src/rows-probe.ts).
    const restore = catalog.createRestore(header, {
      recovery: "strict",
      validation: (header.version ?? 0) >= 4 ? "current" : "transformed",
    });
    for (const e of rows) restore.decodeRow(e);
    restore.finish();
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Every session log dsh would load: the v4 file where one exists, else a v0 file dsh has not
 *  migrated yet (a directory with a migrated v+ file keeps only that one).
 */
function findLogs(): string[] {
  const root = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
  const logs = [];
  for (const ws of readdirSync(root, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    for (const sid of readdirSync(join(root, ws.name), { withFileTypes: true })) {
      if (!sid.isDirectory()) continue;
      const dir = join(root, ws.name, sid.name);
      const v0 = join(dir, "session.jsonl.zstd");
      const v4 = join(dir, "session.v4.jsonl.zstd");
      if (existsSync(v4)) logs.push(v4);
      else if (existsSync(v0) && !readdirSync(dir).some((f) => /^session\.v\d+\.jsonl/.test(f)))
        logs.push(v0);
    }
  }
  return logs;
}

/** Build an event row with a seq, time and data for the self-check, the shape dsh's migration chain
 *  expects.
 */
const ev = (seq: number, type: string, data: Data, extra: Partial<Row> = {}): Row => ({
  type,
  seq,
  time: seq,
  data,
  ...extra,
});
/** Build an assistant message row for the self-check, tagged as a model with placeholder provider
 *  and model.
 */
const msg = (id: string, content: Block[]) => ({
  role: "assistant",
  id,
  source: { kind: "model", provider: "p", model: "m" },
  content,
});

/** Assert the repair drops exactly the orphaned call, its result and the prune that shadowed them,
 *  and keeps the seq slots contiguous.
 */
function selfCheck() {
  const rows: Row[] = [
    ev(0, "turn/start", { turn: 1 }),
    ev(1, "step/start", { turn: 1, step: 1 }),
    ev(2, "assistant/chunk", {
      turn: 1,
      step: 1,
      chunk: { type: "block-start", index: 0, blockType: "text" },
    }),
    ev(3, "tool/call", { turn: 1, step: 1, callId: "orphan", name: "bash", arguments: "{}" }),
    ev(
      4,
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: { source: { kind: "tool", callId: "orphan" }, content: [], role: "user", id: "r" },
      },
      { surfaceOp: "append", sourceEventSeqs: [3] },
    ),
    {
      type: "text-chunks",
      seq0: 5,
      time0: 5,
      data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ["a", "b"] },
    },
    ev(7, "assistant/chunk", {
      turn: 1,
      step: 1,
      chunk: { type: "block-end", index: 0, block: { type: "text", text: "ab" } },
    }),
    ev(
      8,
      "assistant/message",
      {
        turn: 1,
        step: 1,
        message: msg("m1", [
          { type: "text", text: "ab" },
          { type: "tool-call", id: "adv", name: "x", arguments: "{}" },
        ]),
      },
      { surfaceOp: "append", sourceEventSeqs: [[2, 7]] },
    ),
    ev(9, "tool/call", { turn: 1, step: 1, callId: "adv", name: "x", arguments: "{}" }),
    ev(10, "compaction/prune", {
      shadowedRange: { start: 3, end: 4 },
      shadowedSeqs: [3, 4],
      shadowedTokenCount: 1,
    }),
    ev(
      11,
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: { source: { kind: "tool", callId: "adv" }, content: [], role: "user", id: "r2" },
      },
      { surfaceOp: "append", sourceEventSeqs: [9] },
    ),
    ev(12, "step/end", { turn: 1, step: 1 }),
    ev(13, "turn/end", { turn: 1, reason: "done" }),
    // A second turn stopped by the user with a native call open: no tool/result before step/end.
    ev(14, "turn/start", { turn: 2 }),
    ev(15, "step/start", { turn: 2, step: 1 }),
    ev(
      16,
      "assistant/message",
      { turn: 2, step: 1, message: msg("m2", [{ type: "tool-call", id: "open", name: "bash" }]) },
      { surfaceOp: "append", sourceEventSeqs: [] },
    ),
    ev(17, "tool/call", { turn: 2, step: 1, callId: "open", name: "bash", arguments: "{}" }),
    ev(18, "step/end", { turn: 2, step: 1 }),
    ev(19, "turn/end", { turn: 2, reason: "aborted" }),
  ];
  const { rows: out, droppedCalls, addedHead, closedCalls } = repair(structuredClone(rows));
  assert.equal(droppedCalls, 1, "one unadvertised call dropped");
  assert.equal(closedCalls, 1, "one call still open at its step/end got a placeholder result");
  assert.equal(addedHead, true, "the first surface row was not a system/message");
  assert.deepEqual(
    out.map((e) => e.type),
    [
      "turn/start",
      "step/start",
      "assistant/chunk",
      "text-chunks",
      "assistant/chunk",
      "system/message",
      "assistant/message",
      "tool/call",
      "tool/result",
      "step/end",
      "turn/end",
      "turn/start",
      "step/start",
      "assistant/message",
      "tool/call",
      "tool/result",
      "step/end",
      "turn/end",
    ],
    "orphan call, its result and the prune that shadowed only them are gone; the head sits ahead of the first surface row; the open call is closed before its step/end",
  );
  // seq slots stay contiguous: 0,1,2 then the packed run owns 3-4, then 5..
  assert.deepEqual(
    out.filter((e) => e.seq !== undefined).map((e) => e.seq),
    [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  );
  const closing = out[15]!;
  assert.equal(closing.data?.message?.toolCallId, "open", "the placeholder answers the open call");
  assert.deepEqual(closing.sourceEventSeqs, [15], "and cites the call's renumbered seq");
  assert.equal(out[3]?.seq0, 3);
  assert.deepEqual(out[5]?.data, {
    turn: 1,
    step: 1,
    message: {
      id: "restored:system",
      role: "system",
      content: [{ type: "text", text: out[5]?.data?.message?.content?.[0]?.text }],
      source: { kind: "system-prompt" },
    },
  });
  assert.deepEqual(
    out[6]?.sourceEventSeqs,
    [[2, 5]],
    "message range follows the surviving chunk seqs",
  );
  assert.deepEqual(out[8]?.sourceEventSeqs, [8], "advertised call's result still cites its call");
  // A log whose first surface row already is a system/message is left alone.
  const headed = repair(structuredClone(out));
  assert.equal(headed.addedHead, false);
  assert.equal(headed.closedCalls, 0, "a closed call is not closed twice");
  assert.equal(headed.rows.length, out.length);
  console.log("dsh-session-repair self-check ok");
}

/** Run the repair over one log or all of them, printing how many migrate as-is, are repairable, or
 *  stay refused, and applying changes only with `--apply`.
 */
async function main() {
  if (flag("--self-check")) return selfCheck();
  const apply = flag("--apply");
  const catalog = await loadCatalog(dshPrefix());
  const targets = flag("--all") ? findLogs() : args.filter((a) => a.endsWith(".zstd"));
  if (targets.length === 0)
    throw new Error("nothing to check: give a session.jsonl.zstd path or --all");
  let repaired = 0,
    fine = 0,
    stuck = 0;
  for (const file of targets) {
    const { header, rows } = readLog(file);
    if (header.version !== 0 && header.version !== 4) {
      console.log(`skip   ${file} (format v${header.version})`);
      continue;
    }
    // A log that loads today but has no system head breaks on the first reload after its first
    // live turn (see the header comment), so it is repaired now rather than when it is refused.
    if (migrate(catalog, header, structuredClone(rows)) === undefined && !headless(rows)) {
      fine++;
      continue;
    }
    const fixed = repair(structuredClone(rows), header.version);
    const verdict = migrate(catalog, header, structuredClone(fixed.rows));
    if (verdict !== undefined) {
      stuck++;
      console.log(`STUCK  ${file}: ${verdict.slice(0, 200)}`);
      continue;
    }
    repaired++;
    const what = [
      fixed.droppedCalls > 0 ? `drops ${fixed.droppedCalls} tool rows` : "",
      fixed.addedHead ? "adds the system head" : "",
      fixed.closedCalls > 0 ? `closes ${fixed.closedCalls} open tool calls` : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`${apply ? "fixed " : "needs "} ${file} (${what})`);
    if (apply) writeLog(file, header, fixed.rows);
  }
  console.log(
    `${targets.length} logs: ${fine} migrate as-is, ${repaired} ${apply ? "repaired" : "repairable"}, ${stuck} still refused`,
  );
  if (stuck > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
