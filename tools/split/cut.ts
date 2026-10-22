#!/usr/bin/env bun
/**
 * Moves a line range from one file to another for the module split and prints two lists:
 * DECLARES, the top-level identifiers the range declares, and REFERENCES, the identifiers
 * the range uses that it does not declare, whose declarations sit at top level elsewhere in
 * the source file. The lists are what you write the new file's import lines from, so you
 * never have to open either file. With --dry it prints them and writes nothing.
 *
 *   bun tools/split/cut.ts <file> <from-line> <to-line> <new-file> [--dry]
 *
 * The range is 1-based and inclusive, moved verbatim; a blank line left after a declaration
 * is its blank line. A new <new-file> is created; an existing one gets the range appended
 * after a blank line. The name scan is a word-boundary search over top-level declarations,
 * so a name inside a string or a comment can match too. Dev tool, deleted when the split
 * is done.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const USAGE = "usage: bun tools/split/cut.ts <file> <from-line> <to-line> <new-file> [--dry]";

/** Only the top-level declaration shapes a split cut can carry, anchored at column 0 so a
 *  member inside a class or a closure never matches. */
const DECL_RE =
  /^(?:export\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

/** The names this tool's pattern finds at column 0 of the given lines. */
function topNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    const match = DECL_RE.exec(line);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

/** A captured name back into a form safe for word-boundary matching. */
function esc(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One line per name under its own header. */
function printList(header: string, names: string[]): void {
  console.log(header);
  for (const name of names) console.log(name);
}

const argv = process.argv.slice(2);
const dry = argv.at(-1) === "--dry";
const pos = dry ? argv.slice(0, -1) : argv;
const file = pos[0];
const newFile = pos[3];
const from = Number(pos[1]);
const to = Number(pos[2]);
if (pos.length !== 4 || !file || !newFile || !Number.isInteger(from) || !Number.isInteger(to)) {
  console.error(USAGE);
  process.exit(1);
}

const text = readFileSync(file, "utf8");
const endsNewline = text.endsWith("\n");
const lines = text.split("\n");
if (from < 1 || to < from || to > (endsNewline ? lines.length - 1 : lines.length)) {
  console.error(`bad range ${from}..${to} for ${file}`);
  process.exit(1);
}

const moved = lines.slice(from - 1, to);
const rest = [...lines.slice(0, from - 1), ...lines.slice(to)];
const body = moved.join("\n");

const declares = [...topNames(moved)].toSorted();
const declaredHere = new Set(declares);
const references = [...topNames(rest)]
  .filter((name) => !declaredHere.has(name) && new RegExp(`\\b${esc(name)}\\b`).test(body))
  .toSorted();

printList("DECLARES", declares);
printList("REFERENCES", references);

if (dry) process.exit(0);

if (existsSync(newFile)) {
  const existing = readFileSync(newFile, "utf8");
  const head = existing.endsWith("\n") ? `${existing}\n` : `${existing}\n\n`;
  writeFileSync(newFile, `${head}${body}\n`);
} else {
  writeFileSync(newFile, `${body}\n`);
}
writeFileSync(file, endsNewline ? `${rest.join("\n")}\n` : rest.join("\n"));
