#!/usr/bin/env bun
// Dev-only check: reads a dsh session log and asserts the classifier matches what is really in it.
//
// A fixture that repeats known block strings cannot catch dsh renaming one, so this runs against
// the real log. It also prints an inventory of every distinct (kind, plugin, form) triple with its
// largest size and count, so a block nobody has classified shows up as a line rather than silence.
//
//   bun tools/context-blocks.ts                              # default: largest log in ~/.dsh/sessions/<encoded-cwd>
//   bun tools/context-blocks.ts /path/to/session.v3.jsonl.zstd
//
// TypeScript, imported from lib/server/ the way live-cli-check.ts imports, not from src/.
import { execFileSync } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import z from "@deepseek-ai/schemastery";
import { contextSourceOf } from "../lib/server/adapter.js";

/** dsh names a session directory after the workspace: every `/` becomes `-`, wrapped in dashes.
 *  Checked against ~/.dsh/sessions on 2026-09-14; the leading slash supplies one of the dashes. */
const sessionDirName = (cwd: string): string => `-${cwd.replaceAll("/", "-")}--`;

const SourceSchema = z.object({
  kind: z.string(),
  plugin: z.string(),
  form: z.string(),
});
const TextPartSchema = z.object({
  text: z.string(),
});
const DataSchema = z.object({
  source: SourceSchema,
  content: z.union([z.string(), z.array(TextPartSchema)]),
});
const EventSchema = z.object({
  type: z.string(),
  data: DataSchema,
});

/** Return the path to the largest session log under a session directory, so the check runs against
 *  the most complete log; null when there is none.
 */
async function largestIn(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  let best: string | null = null;
  let bestSize = -1;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = join(dir, e.name, "session.v3.jsonl.zstd");
    try {
      const s = await stat(candidate);
      if (s.size > bestSize) {
        best = candidate;
        bestSize = s.size;
      }
    } catch {
      // skip
    }
  }
  return best;
}

type Triple = { kind: string; plugin: string; form: string };
type Stats = { size: number; count: number; sample: string; triple: Triple };

/** Run the inventory: classify every (kind, plugin, form) block in the log and assert the
 *  classifier matches the expected labels, exiting 1 on any mismatch.
 */
async function main(): Promise<void> {
  const arg = process.argv[2];
  const sessionsRoot = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
  const dir = join(sessionsRoot, sessionDirName(process.cwd()));
  try {
    await access(dir);
  } catch {
    console.error("session directory not found:", dir);
    process.exit(1);
  }
  const file = arg ?? (await largestIn(dir));
  if (!file) {
    console.error("no session log found in", dir);
    process.exit(1);
  }
  console.log("session dir:", dir);
  console.log("log file:", file);
  const text = execFileSync("zstd", ["-dc", "--", file], { maxBuffer: 1 << 30 }).toString("utf8");
  const lines = text.split("\n").filter(Boolean);

  const map = new Map<string, Stats>();

  for (const line of lines) {
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    let event: ReturnType<typeof EventSchema>;
    try {
      // SAFETY: the schema's input type is narrower than `unknown`; a line that does not fit it
      // throws on the next line and is skipped, which is the only handling this check wants.
      event = EventSchema(ev as Parameters<typeof EventSchema>[0]);
    } catch {
      continue;
    }
    if (!event.data?.source) continue;
    const kind = event.data.source.kind ?? "-";
    const plugin = event.data.source.plugin ?? "-";
    const form = event.data.source.form ?? "-";

    const content = event.data.content;
    let textContent = "";
    if (Array.isArray(content)) {
      let parts: Array<{ text?: string }>;
      try {
        parts = z.array(TextPartSchema)(content);
      } catch {
        parts = [];
      }
      textContent = parts.map((p) => p.text ?? "").join("");
    } else {
      textContent = content ?? "";
    }

    const collapsed = textContent.replace(/\s+/g, " ").slice(0, 120);
    const key = `${kind} | ${plugin} | ${form}`;
    const triple: Triple = { kind, plugin, form };
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (textContent.length > existing.size) {
        existing.size = textContent.length;
        existing.sample = collapsed;
      }
    } else {
      map.set(key, { size: textContent.length, count: 1, sample: collapsed, triple });
    }
  }

  const rows = [...map.entries()].toSorted((a, b) => b[1].size - a[1].size);

  console.log("inventory (size, count, triple):");
  for (const [key, s] of rows) {
    const { kind: sourceKind, plugin: sourcePlugin } = s.triple;
    const classification = contextSourceOf({
      source: sourcePlugin ? { kind: sourceKind, plugin: sourcePlugin } : { kind: sourceKind },
      content: "",
    });
    const classStr = classification ?? "-";
    console.log(
      `  ${String(s.size).padStart(6)}  x${String(s.count).padStart(3)}  ${key}  [${classStr}]  ${s.sample}`,
    );
  }

  const requiredClassifications = new Map<string, string>([
    ["agent-instructions", "instructions"],
    ["skill-catalog", "skills"],
    ["@deepseek-ai/dsh-system-prompt", "runtime"],
  ]);

  const foundRequired = new Set<string>();

  for (const [key, s] of rows) {
    const { kind: sourceKind, plugin: sourcePlugin } = s.triple;

    const m = {
      source: sourcePlugin ? { kind: sourceKind, plugin: sourcePlugin } : { kind: sourceKind },
      content: "",
    };
    const classified = contextSourceOf(m);

    for (const [reqKind, expected] of requiredClassifications) {
      if (sourceKind === reqKind || sourcePlugin === reqKind) {
        foundRequired.add(reqKind);
        if (classified !== expected) {
          console.error(
            `FAIL: block ${key} classified as ${classified ?? "undefined"}, expected ${expected}`,
          );
          process.exit(1);
        }
      }
    }

    if (sourceKind === "plugin" && sourcePlugin === "tool-jobs" && classified !== undefined) {
      console.error(`FAIL: ${key} should be undefined, got ${classified}`);
      process.exit(1);
    }
    if (
      sourceKind === "plugin" &&
      sourcePlugin === "dsh-oh-my-claude" &&
      classified !== undefined
    ) {
      console.error(`FAIL: ${key} should be undefined, got ${classified}`);
      process.exit(1);
    }
  }

  if (foundRequired.size === 0) {
    console.error(
      "FAIL: log contains none of agent-instructions, skill-catalog, @deepseek-ai/dsh-system-prompt; cannot prove classification",
    );
    process.exit(1);
  }

  console.log("PASS: all classifications match");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
