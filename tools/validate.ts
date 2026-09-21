#!/usr/bin/env bun
/**
 * ONE COMMAND FOR THE WHOLE GATE — `bun run validate`.
 *
 * `check` used to be a single `&&` chain: lint, format check, tests, build,
 * typecheck, in that order, one after another. Two problems with that shape.
 *
 * A format CHECK is the wrong tool. Formatting is not a finding, it is a fix,
 * and failing the run on it after nothing else has run means re-running the
 * whole gate to learn nothing. So formatting runs FIRST and it WRITES.
 *
 * The rest have an ordering constraint worth respecting rather than ignoring:
 * `tsc` reads `lib/server/*.d.ts`, which `build` emits, so typecheck has to come
 * AFTER the build — that is why the old chain put it last. But lint, the tests
 * and fallow share no state with each other and never write, so serialising
 * them only spends wall-clock. They run together.
 *
 * Phases:
 *   1. FORMAT — writes.
 *   2. LINT + TEST + DEAD CODE — read-only, in parallel.
 *   3. BUILD — the slowest step, and pointless if the above failed.
 *   4. TYPECHECK — after the build, against the declarations it just emitted.
 *   5. CONFLICT MARKERS — whole repo, cheap.
 *
 * Dead code is REPORT ONLY, never `fallow fix`: every suppression in
 * `.fallowrc.json` is a real blind spot with its reason written beside it, and
 * an auto-fix would delete the `tools/` scripts wholesale.
 *
 * NOT INCLUDED: the Playwright scripts under `tools/playwright/`. They need a
 * live dsh, a launch token and a borrowed Playwright install, so they stay
 * hand-run. `pr-review` is likewise its own step — it needs a PR to exist.
 */
import { spawn } from "node:child_process";

// `node:child_process` rather than Bun's `$`: this repo has `@types/node` and no
// `@types/bun`, and the gate type-checks itself like everything else under
// `tools/`. A dev-only script is not worth a dependency to get nicer quoting for
// six fixed commands.
const ROOT = new URL("..", import.meta.url).pathname;

const t0 = Date.now();
const results: { name: string; ok: boolean; ms: number }[] = [];

/** Run a command to completion with stdout and stderr merged; never throws. */
function run(argv: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0] ?? "", argv.slice(1), {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b: Buffer) => (out += b.toString()));
    child.stderr.on("data", (b: Buffer) => (out += b.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

/** Run one step, record it, and show its output only when it fails. */
async function step(name: string, ...argv: string[]): Promise<boolean> {
  const start = Date.now();
  const { code, out } = await run(argv);
  const ok = code === 0;
  results.push({ name, ok, ms: Date.now() - start });
  // Quiet on success, loud on failure — the point of a gate is the failure.
  if (!ok) console.error(`\n─── ${name} FAILED ───\n${out.trim().slice(-4000)}\n`);
  return ok;
}

// 1. FORMAT (writes)
await step("format", "bun", "run", "format");

// 2. THE READ-ONLY CHECKS, IN PARALLEL
await Promise.all([
  step("lint", "bun", "run", "lint"),
  step("test", "bun", "run", "test"),
  step("dead code", "bun", "run", "deadcode"),
]);

// 3. BUILD, then 4. TYPECHECK against what it emitted. Only worth paying for if
// the above passed, and the two are strictly ordered.
if (results.every((r) => r.ok) && (await step("build", "bun", "run", "build"))) {
  await step("typecheck", "bun", "run", "typecheck");
}

// 5. CONFLICT MARKERS, whole repo. `git grep` rather than `grep -r` so the search
// is over TRACKED files only: `node_modules`, `.cache` and every other ignored
// directory drop out for free, and a stray blob in one of them cannot fail the
// gate. `lib/` is excluded because it is generated from `src/`, where a real
// marker would already have been caught. `-I` skips binaries, which report
// "binary file matches" and still exit 0.
// GREP'S EXIT CODE IS INVERTED RELATIVE TO WHAT WE WANT: it exits 0 when it
// FINDS something and 1 when it finds nothing, and finding a conflict marker is
// the failure here. That is why this does not go through `step`, which treats a
// zero exit as a pass and would report every clean run as a failure.
{
  const start = Date.now();
  const { code, out } = await run(["git", "grep", "-nI", "-e", "^<<<<<<<", "--", ".", ":!lib"]);
  const found = code === 0;
  results.push({ name: "no conflict markers", ok: !found, ms: Date.now() - start });
  if (found) console.error(`\n─── conflict markers ───\n${out.slice(0, 2000)}\n`);
}

// 6. NO EM DASHES IN PUBLISHED PROSE. The house style bans them in anything a person reads, and a
// rule that lives only in a writing skill reaches only the writer who loaded it: on 2026-09-21 ten
// sat in the docs and changelog, written by workers and by a one-pass reconstruction from commit
// subjects, none of which had the skill. So the gate checks the published prose itself. Same
// inverted-exit reasoning as the conflict-marker step above. Code files are left to review for
// now: a comment is not published prose, and telling a comment from a string a person reads is
// more than a grep can do.
{
  const start = Date.now();
  const { code, out } = await run([
    "git",
    "grep",
    "-nI",
    "-e",
    "\u2014",
    "--",
    "README.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "docs/",
  ]);
  const found = code === 0;
  results.push({ name: "no em dashes in docs", ok: !found, ms: Date.now() - start });
  if (found) console.error(`\n─── em dashes in published prose ───\n${out.slice(0, 2000)}\n`);
}

const pad = Math.max(...results.map((r) => r.name.length));
console.log("");
for (const r of results)
  console.log(`  ${r.ok ? "✔" : "✘"} ${r.name.padEnd(pad)}  ${(r.ms / 1000).toFixed(1)}s`);
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length ? `✘ ${failed.length} FAILED: ${failed.map((f) => f.name).join(", ")}` : "✔ all green"}` +
    `  ·  ${((Date.now() - t0) / 1000).toFixed(1)}s total\n`,
);
process.exit(failed.length ? 1 : 0);
