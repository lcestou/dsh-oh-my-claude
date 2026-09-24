#!/usr/bin/env bun
// Command-line front over `src/session-repair.ts`, the repair the plugin runs on its own since
// 2026-09-23: at start, on open, and when a wake finds a session dsh refuses. This front is for a
// checkout: check or repair one log or every log under $DSH_HOME/sessions with dsh-web stopped.
// What each repair mends and why is in the module's header comment.
//
// usage:
//   bun tools/dsh-session-repair.ts --check  [--dsh <prefix>] [<log> | --all]
//   bun tools/dsh-session-repair.ts --apply  [--dsh <prefix>] [<log> | --all]
//
// <prefix> is the npm prefix holding dsh 0.1.5+ (default: the one `dsh` on PATH lives in).
// --all walks $DSH_HOME/sessions (default ~/.dsh/sessions). Stop dsh-web before --apply. The
// original log is kept next to the repaired one as session.jsonl.zstd.bak-<timestamp>. The
// module's own self-check is `bun src/session-repair.test.ts`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  headless,
  migrate,
  readLog,
  repair,
  writeLog,
  type Catalog,
} from "../src/session-repair.js";

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

/** Run the repair over one log or all of them, printing how many migrate as-is, are repairable, or
 *  stay refused, and applying changes only with `--apply`.
 */
async function main() {
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
