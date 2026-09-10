#!/usr/bin/env bun
// Repair dsh session logs that dsh 0.1.5+ refuses to migrate.
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
// usage:
//   bun tools/dsh-session-repair.ts --check  [--dsh <prefix>] [<log> | --all]
//   bun tools/dsh-session-repair.ts --apply  [--dsh <prefix>] [<log> | --all]
//   bun tools/dsh-session-repair.ts --self-check
//
// <prefix> is the npm prefix holding dsh 0.1.5+ (default: the one `dsh` on PATH lives in).
// --all walks $DSH_HOME/sessions (default ~/.dsh/sessions). Stop dsh-web before --apply. The
// original log is kept next to the repaired one as session.jsonl.zstd.bak-<timestamp>.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, writeFileSync } from "node:fs";
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
  surfaceOp?: string | Range;
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
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const defined = <T>(x: T | undefined): x is T => x !== undefined;

/** Drop unadvertised tool rows from a v0 event list and keep every seq reference consistent. */
export function repair(rows: Row[]): { rows: Row[]; droppedCalls: number } {
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
    const resultOf = e.data?.message?.source?.callId;
    if (e.type === "tool/result" && resultOf !== undefined && dropIds.has(resultOf)) {
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
    if (
      e.type === "tool/result" &&
      e.surfaceOp &&
      typeof e.surfaceOp === "object" &&
      "start" in e.surfaceOp
    ) {
      const span: number[] = [];
      for (let x = e.surfaceOp.start; x <= e.surfaceOp.end; x++) if (alive(x)) span.push(x);
      const first = span[0];
      const last = span[span.length - 1];
      if (first === undefined || last === undefined) {
        drop(e);
        continue;
      }
      e.surfaceOp = { ...e.surfaceOp, start: first, end: last };
    }
    out.push(e);
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
    if (e.surfaceOp && typeof e.surfaceOp === "object" && "start" in e.surfaceOp)
      e.surfaceOp = range(e.surfaceOp);
    if (Array.isArray(e.data?.messageSeqs)) e.data.messageSeqs = list(e.data.messageSeqs);
    if (Array.isArray(e.data?.shadowedSeqs)) e.data.shadowedSeqs = list(e.data.shadowedSeqs);
    if (e.data?.shadowedRange) e.data.shadowedRange = range(e.data.shadowedRange);
  }
  return { rows: out, droppedCalls: dropIds.size };
}

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

function writeLog(file: string, header: Header, rows: Row[]) {
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const tmp = file + ".repair-tmp";
  writeFileSync(tmp, Buffer.concat([frame(JSON.stringify(header) + "\n"), frame(body)]));
  renameSync(file, `${file}.bak-${Date.now()}`);
  renameSync(tmp, file);
}

function dshPrefix(): string {
  const given = opt("--dsh");
  if (given) return resolve(given);
  const bin = execFileSync("sh", ["-c", "command -v dsh"]).toString().trim();
  const real = execFileSync("readlink", ["-f", bin]).toString().trim();
  // <prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
  return resolve(dirname(real), "..", "..", "..", "..", "..");
}

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

/** Feed rows through dsh's migration chain; returns undefined on success, the refusal otherwise. */
function migrate(catalog: Catalog, header: Header, rows: Row[]): string | undefined {
  try {
    const restore = catalog.createRestore(header, {
      recovery: "strict",
      validation: "transformed",
    });
    for (const e of rows) restore.decodeRow(e);
    restore.finish();
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function findLogs(): string[] {
  const root = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
  const logs = [];
  for (const ws of readdirSync(root, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    for (const sid of readdirSync(join(root, ws.name), { withFileTypes: true })) {
      if (!sid.isDirectory()) continue;
      const dir = join(root, ws.name, sid.name);
      const v0 = join(dir, "session.jsonl.zstd");
      if (existsSync(v0) && !readdirSync(dir).some((f) => /^session\.v\d+\.jsonl/.test(f)))
        logs.push(v0);
    }
  }
  return logs;
}

const ev = (seq: number, type: string, data: Data, extra: Partial<Row> = {}): Row => ({
  type,
  seq,
  time: seq,
  data,
  ...extra,
});
const msg = (id: string, content: Block[]) => ({
  role: "assistant",
  id,
  source: { kind: "model", provider: "p", model: "m" },
  content,
});

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
  ];
  const { rows: out, droppedCalls } = repair(structuredClone(rows));
  assert.equal(droppedCalls, 1, "one unadvertised call dropped");
  assert.deepEqual(
    out.map((e) => e.type),
    [
      "turn/start",
      "step/start",
      "assistant/chunk",
      "text-chunks",
      "assistant/chunk",
      "assistant/message",
      "tool/call",
      "tool/result",
      "step/end",
      "turn/end",
    ],
    "orphan call, its result and the prune that shadowed only them are gone",
  );
  // seq slots stay contiguous: 0,1,2 then the packed run owns 3-4, then 5..
  assert.deepEqual(
    out.filter((e) => e.seq !== undefined).map((e) => e.seq),
    [0, 1, 2, 5, 6, 7, 8, 9, 10],
  );
  assert.equal(out[3]?.seq0, 3);
  assert.deepEqual(
    out[5]?.sourceEventSeqs,
    [[2, 5]],
    "message range follows the surviving chunk seqs",
  );
  assert.deepEqual(out[7]?.sourceEventSeqs, [7], "advertised call's result still cites its call");
  console.log("dsh-session-repair self-check ok");
}

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
    if (header.version !== 0) {
      console.log(`skip   ${file} (format v${header.version})`);
      continue;
    }
    if (migrate(catalog, header, structuredClone(rows)) === undefined) {
      fine++;
      continue;
    }
    const fixed = repair(structuredClone(rows));
    const verdict = migrate(catalog, header, structuredClone(fixed.rows));
    if (verdict !== undefined) {
      stuck++;
      console.log(`STUCK  ${file}: ${verdict.slice(0, 200)}`);
      continue;
    }
    repaired++;
    console.log(`${apply ? "fixed " : "needs "} ${file} (drops ${fixed.droppedCalls} tool rows)`);
    if (apply) writeLog(file, header, fixed.rows);
  }
  console.log(
    `${targets.length} logs: ${fine} migrate as-is, ${repaired} ${apply ? "repaired" : "repairable"}, ${stuck} still refused`,
  );
  if (stuck > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
