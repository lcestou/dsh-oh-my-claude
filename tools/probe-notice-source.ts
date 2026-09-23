#!/usr/bin/env bun
// Ask the installed dsh whether it still accepts every message source this plugin appends to a
// session log, by feeding a synthetic log through dsh's own restore, the way it loads a session.
//
// dsh moves its session format between prereleases, and the plugin builds against an older
// dsh-llm's types, so the compiler cannot see a new rule. 0.1.7 (format v4) refused the plugin's
// wake and restart notices at runtime with "format v4 message requires a producer-owned source
// kind" while `bun run validate` stayed green (2026-09-23). Run this after a dsh upgrade, before
// trusting a green gate:
//
//   bun tools/probe-notice-source.ts [--dsh <prefix>]
//
// Exit 0 when every shape is accepted, 1 with the refusing message otherwise.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { noticeSource, RESTART_TEXT, WAKE_TEXT } from "../src/adapter.js";
import { type RawRowsLog, rawRowsLog } from "../src/rows-probe.js";

/** A row of the synthetic log, the shape `rawRowsLog` builds. */
type Row = RawRowsLog["rows"][number];
/** A message source the plugin appends: a notice's, or the typed prompt's. */
type Source = ReturnType<typeof noticeSource> | { kind: "user" };

/** dsh's session-format catalog, as much of it as this check calls. */
interface Catalog {
  currentVersion?: number;
  createRestore(
    header: RawRowsLog["header"],
    options: { recovery: string; validation: string },
  ): { decodeRow(row: Row): void; finish(): void };
}

/** The value after `flag` on the command line, or undefined when the flag is absent. */
const opt = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

/** The npm prefix holding dsh, from `--dsh` or the `dsh` launcher on PATH. Same resolution as
 *  `tools/dsh-session-repair.ts`: a launcher script names the bin.js path inside it; a symlinked
 *  bin.js is that path itself. */
function dshPrefix(): string {
  const given = opt("--dsh");
  if (given) return resolve(given);
  const bin = execFileSync("sh", ["-c", "command -v dsh"]).toString().trim();
  const real = execFileSync("readlink", ["-f", bin]).toString().trim();
  const launcher = readFileSync(real, "utf8").slice(0, 4096);
  const named = /(\S+)\/lib\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js/.exec(launcher)?.[1];
  const prefix = named?.replace(/^"?\$HOME/, homedir()).replace(/"$/, "") ?? dirname(real);
  return named !== undefined ? resolve(prefix) : resolve(prefix, "..", "..", "..", "..", "..");
}

/** dsh's catalog module under `prefix`; throws with the path when dsh 0.1.5+ is not there. */
async function loadCatalog(prefix: string): Promise<Catalog> {
  const p = join(
    prefix,
    "lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js",
  );
  if (!existsSync(p)) throw new Error(`no session-format catalog under ${prefix} (use --dsh)`);
  // SAFETY: `p` is dsh's own catalog module, checked to exist above; a dsh that renames the export
  // fails on `createRestore` below, which is the loud failure this check exists to surface.
  return (await import(p)).sessionFormatCatalog as Catalog;
}

/** Restore a one-turn log plus a second turn opened by a user message carrying `source`, the way
 *  a wake notice reaches the log: an inbox splice, then the same message inside the turn. Returns
 *  the refusing message, or undefined when dsh accepts the whole log. */
function refusal(catalog: Catalog, version: number, source: Source): string | undefined {
  const base = rawRowsLog(version);
  // SAFETY: a JSON round trip of rows `rawRowsLog` just built keeps their shape; it only detaches
  // the copy so a restore consuming one run cannot touch the next.
  const rows = JSON.parse(JSON.stringify(base.rows)) as Row[];
  const n = rows.length;
  const msg = { content: [{ type: "text", text: "notice" }], source, role: "user", id: "n1" };
  const at = (i: number, seq: number, type: string, data: Row["data"]): Row => ({
    ...rows[i]!,
    seq,
    type,
    data,
  });
  const extra: Row[] = [
    at(0, n, "agent/inbox/spliced", {
      target: "next-turn",
      start: 0,
      removedCount: 0,
      inserted: [msg],
    }),
    at(0, n + 1, "turn/start", { turn: 2 }),
    at(1, n + 2, "step/start", { turn: 2, step: 1 }),
    at(2, n + 3, "user/message", msg),
    at(n - 2, n + 4, "step/end", { turn: 2, step: 1 }),
    at(n - 1, n + 5, "turn/end", { turn: 2, reason: "done" }),
  ];
  const restore = catalog.createRestore(base.header, {
    recovery: "strict",
    validation: version >= 4 ? "current" : "transformed",
  });
  try {
    for (const row of [...rows, ...extra]) restore.decodeRow(row);
    restore.finish();
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Run every source the plugin appends through the installed dsh and report each verdict. */
async function main(): Promise<number> {
  const catalog = await loadCatalog(dshPrefix());
  const version = catalog.currentVersion ?? 3;
  console.log(`dsh session format v${version}`);
  const sources: [string, Source][] = [
    ["wake notice", noticeSource(WAKE_TEXT, false, version)],
    ["restart notice, goal active", noticeSource(RESTART_TEXT, true, version)],
    ["restart notice, no goal", noticeSource(RESTART_TEXT, false, version)],
    ["typed prompt", { kind: "user" }],
  ];
  let bad = 0;
  for (const [label, source] of sources) {
    const why = refusal(catalog, version, source);
    console.log(`${why === undefined ? "ok     " : "REFUSED"} ${label}: ${JSON.stringify(source)}`);
    if (why !== undefined) {
      console.log(`        ${why}`);
      bad++;
    }
  }
  return bad === 0 ? 0 : 1;
}

process.exitCode = await main();
