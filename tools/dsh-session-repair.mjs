#!/usr/bin/env node
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
//   node tools/dsh-session-repair.mjs --check  [--dsh <prefix>] [<log> | --all]
//   node tools/dsh-session-repair.mjs --apply  [--dsh <prefix>] [<log> | --all]
//   node tools/dsh-session-repair.mjs --self-check
//
// <prefix> is the npm prefix holding dsh 0.1.5+ (default: the one `dsh` on PATH lives in).
// --all walks $DSH_HOME/sessions (default ~/.dsh/sessions). Stop dsh-web before --apply. The
// original log is kept next to the repaired one as session.jsonl.zstd.bak-<timestamp>.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };

/** Drop unadvertised tool rows from a v0 event list and keep every seq reference consistent. */
export function repair(rows) {
  const advertised = new Set();
  const dropIds = new Set();
  const dropped = new Set();
  const kept = [];
  for (const e of rows) {
    if (e.type === "assistant/message")
      for (const b of e.data.message.content ?? []) if (b.type === "tool-call") advertised.add(b.id);
    if (e.type === "tool/call" && !advertised.has(e.data.callId)) {
      dropIds.add(e.data.callId);
      dropped.add(e.seq);
      continue;
    }
    if (e.type === "tool/result" && dropIds.has(e.data?.message?.source?.callId)) {
      dropped.add(e.seq);
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
      if (keep.length === 0) { dropped.add(e.seq); continue; }
      e.data.shadowedSeqs = keep;
      e.data.shadowedRange = { ...e.data.shadowedRange, start: Math.min(...keep), end: Math.max(...keep) };
    }
    if (e.type === "tool/result" && e.surfaceOp && typeof e.surfaceOp === "object" && "start" in e.surfaceOp) {
      const span = [];
      for (let x = e.surfaceOp.start; x <= e.surfaceOp.end; x++) if (alive(x)) span.push(x);
      if (span.length === 0) { dropped.add(e.seq); continue; }
      e.surfaceOp = { ...e.surfaceOp, start: span[0], end: span[span.length - 1] };
    }
    out.push(e);
  }
  // Every row owns one seq slot; a packed chunk run owns one per chunk. Renumber, then remap
  // every reference (ranges, lists, prune targets) onto the surviving seqs.
  const map = new Map();
  let k = 0;
  for (const e of out) {
    if ("seq0" in e) {
      const n = e.data.texts?.length ?? e.data.dt?.length ?? 1;
      for (let j = 0; j < n; j++) map.set(e.seq0 + j, k + j);
      e.seq0 = k;
      k += n;
    } else if ("seq" in e) {
      map.set(e.seq, k);
      e.seq = k++;
    }
  }
  const keys = [...map.keys()].sort((a, b) => a - b);
  const lo = (x) => { const key = keys.find((v) => v >= x); return key === undefined ? undefined : map.get(key); };
  const hi = (x) => { let r; for (const v of keys) { if (v > x) break; r = map.get(v); } return r; };
  const one = (x) => map.get(x);
  const list = (arr) => arr.map(one).filter((x) => x !== undefined);
  const refs = (arr) => arr.map((x) => {
    if (!Array.isArray(x)) return one(x);
    const s = lo(x[0]), e = hi(x[1]);
    return s !== undefined && e !== undefined && s <= e ? [s, e] : undefined;
  }).filter((x) => x !== undefined);
  const range = (r) => { const s = lo(r.start), e = hi(r.end); return s !== undefined && e !== undefined && s <= e ? { ...r, start: s, end: e } : r; };
  for (const e of out) {
    if (Array.isArray(e.sourceEventSeqs)) e.sourceEventSeqs = refs(e.sourceEventSeqs);
    if (e.surfaceOp && typeof e.surfaceOp === "object" && "start" in e.surfaceOp) e.surfaceOp = range(e.surfaceOp);
    if (Array.isArray(e.data?.messageSeqs)) e.data.messageSeqs = list(e.data.messageSeqs);
    if (Array.isArray(e.data?.shadowedSeqs)) e.data.shadowedSeqs = list(e.data.shadowedSeqs);
    if (e.data?.shadowedRange) e.data.shadowedRange = range(e.data.shadowedRange);
  }
  return { rows: out, droppedCalls: dropIds.size };
}

function readLog(file) {
  const text = execFileSync("zstd", ["-dc", "--", file], { maxBuffer: 1 << 30 }).toString("utf8");
  const rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { header: rows[0], rows: rows.slice(1) };
}

function writeLog(file, header, rows) {
  // dsh reads the header as its own zstd frame ("first frame is not exactly one header line"
  // otherwise), then the events; two frames back to back are one valid stream.
  const frame = (text) => execFileSync("zstd", ["-q", "-c"], { input: text, maxBuffer: 1 << 30 });
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const tmp = file + ".repair-tmp";
  writeFileSync(tmp, Buffer.concat([frame(JSON.stringify(header) + "\n"), frame(body)]));
  renameSync(file, `${file}.bak-${Date.now()}`);
  renameSync(tmp, file);
}

function dshPrefix() {
  const given = opt("--dsh");
  if (given) return resolve(given);
  const bin = execFileSync("sh", ["-c", "command -v dsh"]).toString().trim();
  const real = execFileSync("readlink", ["-f", bin]).toString().trim();
  // <prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
  return resolve(dirname(real), "..", "..", "..", "..", "..");
}

async function loadCatalog(prefix) {
  const p = join(prefix, "lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js");
  if (!existsSync(p)) throw new Error(`no session-format catalog under ${prefix}; dsh 0.1.5+ is needed (use --dsh <prefix>)`);
  return (await import(p)).sessionFormatCatalog;
}

/** Feed rows through dsh's migration chain; returns undefined on success, the refusal otherwise. */
function migrate(catalog, header, rows) {
  try {
    const restore = catalog.createRestore(header, { recovery: "strict", validation: "transformed" });
    for (const e of rows) restore.decodeRow(e);
    restore.finish();
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function findLogs() {
  const root = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
  const logs = [];
  for (const ws of readdirSync(root, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    for (const sid of readdirSync(join(root, ws.name), { withFileTypes: true })) {
      if (!sid.isDirectory()) continue;
      const dir = join(root, ws.name, sid.name);
      const v0 = join(dir, "session.jsonl.zstd");
      if (existsSync(v0) && !readdirSync(dir).some((f) => /^session\.v\d+\.jsonl/.test(f))) logs.push(v0);
    }
  }
  return logs;
}

function selfCheck() {
  const ev = (seq, type, data, extra = {}) => ({ type, seq, time: seq, data, ...extra });
  const msg = (id, content) => ({ role: "assistant", id, source: { kind: "model", provider: "p", model: "m" }, content });
  const rows = [
    ev(0, "turn/start", { turn: 1 }),
    ev(1, "step/start", { turn: 1, step: 1 }),
    ev(2, "assistant/chunk", { turn: 1, step: 1, chunk: { type: "block-start", index: 0, blockType: "text" } }),
    ev(3, "tool/call", { turn: 1, step: 1, callId: "orphan", name: "bash", arguments: "{}" }),
    ev(4, "tool/result", { turn: 1, step: 1, message: { source: { kind: "tool", callId: "orphan" }, content: [], role: "user", id: "r" } }, { surfaceOp: "append", sourceEventSeqs: [3] }),
    { type: "text-chunks", seq0: 5, time0: 5, data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ["a", "b"] } },
    ev(7, "assistant/chunk", { turn: 1, step: 1, chunk: { type: "block-end", index: 0, block: { type: "text", text: "ab" } } }),
    ev(8, "assistant/message", { turn: 1, step: 1, message: msg("m1", [{ type: "text", text: "ab" }, { type: "tool-call", id: "adv", name: "x", arguments: "{}" }]) }, { surfaceOp: "append", sourceEventSeqs: [[2, 7]] }),
    ev(9, "tool/call", { turn: 1, step: 1, callId: "adv", name: "x", arguments: "{}" }),
    ev(10, "compaction/prune", { shadowedRange: { start: 3, end: 4 }, shadowedSeqs: [3, 4], shadowedTokenCount: 1 }),
    ev(11, "tool/result", { turn: 1, step: 1, message: { source: { kind: "tool", callId: "adv" }, content: [], role: "user", id: "r2" } }, { surfaceOp: "append", sourceEventSeqs: [9] }),
    ev(12, "step/end", { turn: 1, step: 1 }),
    ev(13, "turn/end", { turn: 1, reason: "done" }),
  ];
  const { rows: out, droppedCalls } = repair(structuredClone(rows));
  assert.equal(droppedCalls, 1, "one unadvertised call dropped");
  assert.deepEqual(out.map((e) => e.type), ["turn/start", "step/start", "assistant/chunk", "text-chunks", "assistant/chunk", "assistant/message", "tool/call", "tool/result", "step/end", "turn/end"], "orphan call, its result and the prune that shadowed only them are gone");
  // seq slots stay contiguous: 0,1,2 then the packed run owns 3-4, then 5..
  assert.deepEqual(out.filter((e) => "seq" in e).map((e) => e.seq), [0, 1, 2, 5, 6, 7, 8, 9, 10]);
  assert.equal(out[3].seq0, 3);
  assert.deepEqual(out[5].sourceEventSeqs, [[2, 5]], "message range follows the surviving chunk seqs");
  assert.deepEqual(out[7].sourceEventSeqs, [7], "advertised call's result still cites its call");
  console.log("dsh-session-repair self-check ok");
}

async function main() {
  if (flag("--self-check")) return selfCheck();
  const apply = flag("--apply");
  const catalog = await loadCatalog(dshPrefix());
  const targets = flag("--all") ? findLogs() : args.filter((a) => a.endsWith(".zstd"));
  if (targets.length === 0) throw new Error("nothing to check: give a session.jsonl.zstd path or --all");
  let repaired = 0, fine = 0, stuck = 0;
  for (const file of targets) {
    const { header, rows } = readLog(file);
    if (header.version !== 0) { console.log(`skip   ${file} (format v${header.version})`); continue; }
    if (migrate(catalog, header, structuredClone(rows)) === undefined) { fine++; continue; }
    const fixed = repair(structuredClone(rows));
    const verdict = migrate(catalog, header, structuredClone(fixed.rows));
    if (verdict !== undefined) { stuck++; console.log(`STUCK  ${file}: ${verdict.slice(0, 200)}`); continue; }
    repaired++;
    console.log(`${apply ? "fixed " : "needs "} ${file} (drops ${fixed.droppedCalls} tool rows)`);
    if (apply) writeLog(file, header, fixed.rows);
  }
  console.log(`${targets.length} logs: ${fine} migrate as-is, ${repaired} ${apply ? "repaired" : "repairable"}, ${stuck} still refused`);
  if (stuck > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
