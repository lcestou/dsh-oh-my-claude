// The second opinion: once a Claude turn has changed files, another dsh model reads that turn's part
// of the working-tree diff and the card above the composer lists what it found. Off until a model is
// picked in Settings → Oh My Claude, which writes `second-opinion.json` under the plugin's state.
// The pure half (marks, review text, parsing) is exported for the test; `opinions` is the runtime.
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import z from "@deepseek-ai/schemastery";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { hub } from "../events.js";
import { STATE_DIR, writeJson } from "../state.js";
import { textOf, type LooseMessage } from "./prompt.js";
import type { PluginContext } from "../dsh.js";
import type { WorkspaceDiff } from "../process.js";
import type { WorkspaceDiffReply } from "./types.js";
import type { OpinionFinding } from "../prompts.js";

/** The model that reviews, and whether it runs on its own after every turn that changed files.
 *  Without `auto` the card offers a button instead. No file, or one without a model, is off. */
export interface SecondOpinionSetting {
  provider: string;
  model: string;
  auto?: true;
}

/** One point the reviewer raised. `note` is a reply that did not follow the line format, shown
 *  whole so nothing it said is lost; `where` is empty for a note. Declared in prompts.ts, which the
 *  client imports too, so the card and the server read one shape. */
export type Finding = OpinionFinding;

/** Why a review did not finish: the picked model is no longer offered, it ran past the deadline,
 *  the provider failed (`detail` is its own message, shown as written), or it answered nothing. */
export type FailReason = "gone" | "timeout" | "error" | "empty";

/** What the card shows for a session's last turn. `files` are the paths the turn changed, in the
 *  CLI's diff order; `reviewed` is how many of them fit in the review. */
export type OpinionCard =
  | { state: "ready"; at: number; files: string[] }
  | { state: "running"; at: number; files: string[]; model: string; startedAt: number }
  | {
      state: "done";
      at: number;
      files: string[];
      model: string;
      findings: Finding[];
      reviewed: number;
      ms: number;
    }
  | {
      state: "failed";
      at: number;
      files: string[];
      model: string;
      reason: FailReason;
      detail?: string;
    };

/** `GET /second-opinion` and the `second-opinion` event: the session's card, or null for none. */
export interface OpinionReply {
  card: OpinionCard | null;
}

/** Past this many characters the review stops adding files. The same budget the Changes tab's Ask
 *  sends Claude (`DIFF_CONTEXT_CAP` in turn.ts): about 8k tokens, a few minutes on a local model. */
export const REVIEW_CAP = 32_000;
/** How much of the person's request goes with the diff; the diff is what is reviewed. */
export const REQUEST_CAP = 2_000;
/** How much of one new file is read for the review. */
export const NEW_FILE_CAP = 16_000;
/** New files read per turn; past this the rest are named without their text. */
export const NEW_FILES_READ = 20;
/** Findings kept from one reply; the prompt asks for at most this many. */
export const MAX_FINDINGS = 3;
/** A new file larger than this is named in the review but not read: a stray dump or an image that
 *  is not ignored would otherwise be read whole into dsh-web (or piped over SSH) twice per turn. */
export const NEW_FILE_MAX_BYTES = 256_000;
/** How long one review may take. A local model on a shared GPU took 204 s and 259 s for two small
 *  diffs on 2026-11-25, so the deadline is generous; a hosted model answers far sooner. */
export const REVIEW_TIMEOUT_MS = 600_000;
/** Output budget, reasoning included: the probes' replies spent 836 to 1,208 output tokens. */
export const REVIEW_MAX_TOKENS = 4_000;
/** Sessions whose last card is kept in memory; the oldest goes when a new one arrives. */
const MAX_SESSIONS = 200;

/** The reviewer's instructions, sent as the system prompt. English only: a model reads it. On a
 *  clean diff an earlier wording drew two confident non-defects; this one answered "No findings."
 *  there and still caught both planted bugs (grill probe, 2026-11-25, one run each). */
export const REVIEW_SYSTEM = `You review a code change that another assistant just made. You get the request it was working on and the diff of what it changed. You see only the diff, not the rest of each file.

Most changes have no defect, and "No findings." is the right answer for most diffs. A wrong finding costs the reader more than a missed one.

Report a problem only when the diff itself shows it: a bug, an edge case that now gives a wrong result, a security hole, a caller or test the change forgot. Do not report anything that depends on code you cannot see, do not guess how unseen code behaves, do not praise or summarise, and do not suggest style, naming, comments or tests.

Write at most 3 findings, most serious first, one per line, in exactly this form:
- [bug] path:line \`the changed line, quoted\` What is wrong, and the input that gives the wrong result.

If you find nothing that meets this bar, write exactly: No findings.
Write nothing else.`;

/** A file's state as one comparable string: its hunks for a tracked file, its text for a new one.
 *  The CLI reports a new (untracked) file with no hunks and zero counts, so without its text two
 *  different versions of a new file would compare equal. */
export type TreeMarks = Map<string, string>;

/** The marks for every file in a diff. `texts` holds the new files that were read; one that was not
 *  read marks as unread, so it counts as changed only when it first appears. */
export function treeMarks(diff: WorkspaceDiff, texts: ReadonlyMap<string, string>): TreeMarks {
  const marks: TreeMarks = new Map();
  for (const f of diff.files) {
    if (f.untracked) marks.set(f.path, `new\n${texts.get(f.path) ?? "\u0000unread"}`);
    else if (f.binary) marks.set(f.path, `binary\n${f.added}\n${f.removed}`);
    else
      marks.set(
        f.path,
        f.hunks.map((h) => `@@ ${h.oldStart} ${h.newStart}\n${h.lines.join("\n")}`).join("\n"),
      );
  }
  return marks;
}

/** The paths whose mark differs between the two snapshots, in `after`'s order. With no `before`
 *  there is nothing to compare against, so nothing counts as this turn's. Gets wrong: a file the
 *  turn committed or reverted is gone from `after` and is not reviewed, and a file the person edited
 *  by hand between the snapshot and the turn's end counts as the turn's. */
export function changedPaths(before: TreeMarks | undefined, after: TreeMarks): string[] {
  if (before === undefined) return [];
  return [...after].filter(([path, mark]) => before.get(path) !== mark).map(([path]) => path);
}

/** The user message the reviewer reads: the request, then each changed file whole, in diff order,
 *  until the cap. The first file always goes, cut at the cap if it alone is over, because a review
 *  with no diff in it is worthless. `reviewed` counts the files that went in. */
export function reviewInput(
  request: string,
  diff: WorkspaceDiff,
  paths: readonly string[],
  texts: ReadonlyMap<string, string>,
) {
  const wanted = new Set(paths);
  const parts: string[] = [];
  let size = 0;
  for (const f of diff.files) {
    if (!wanted.has(f.path)) continue;
    let part: string;
    if (f.untracked) {
      const body = texts.get(f.path);
      part =
        body === undefined
          ? `--- ${f.path} (new file, not read)`
          : `--- ${f.path} (new file)\n${body
              .split("\n")
              .map((l) => `+${l}`)
              .join("\n")}`;
    } else if (f.binary) part = `--- ${f.path}\nbinary file`;
    else
      part = `--- ${f.path}\n${f.hunks
        .map((h) => `@@ -${h.oldStart} +${h.newStart} @@\n${h.lines.join("\n")}`)
        .join("\n")}`;
    if (parts.length > 0 && size + part.length > REVIEW_CAP) break;
    parts.push(part.slice(0, REVIEW_CAP));
    size += part.length + 2;
  }
  const reviewed = parts.length;
  if (reviewed < paths.length) parts.push(`(diff cut: ${reviewed} of ${paths.length} files shown)`);
  const req = request.trim().slice(0, REQUEST_CAP) || "(no request text)";
  return { text: `Request:\n${req}\n\nDiff:\n${parts.join("\n\n")}`, reviewed };
}

/** One finding line as the prompt asks for it; a leading `*` and any case are accepted. */
const FINDING_LINE = /^\s*[-*]\s*\[(bug|risk)\]\s+(\S+)\s+(.+?)\s*$/i;

/** The reviewer's reply as findings. "No findings." is an empty list. A finding whose path (its
 *  `where` without the `:line`) is not one of `paths` is dropped: the reviewer saw only those files,
 *  so anything else is a guess about code it never read. A reply with text but no line in the
 *  format becomes one `note` holding the reply, cut to 1500 characters, so a model that ignored the
 *  format is still read. Keeps the first `MAX_FINDINGS`. */
export function parseFindings(reply: string, paths: readonly string[]): Finding[] {
  const out: Finding[] = [];
  for (const line of reply.split("\n")) {
    const m = FINDING_LINE.exec(line);
    const where = m?.[2] ?? "";
    if (m && paths.includes(where.replace(/^\.\//, "").replace(/:[\d-]+$/, "")))
      out.push({
        kind: m[1]?.toLowerCase() === "bug" ? "bug" : "risk",
        where,
        text: m[3] ?? "",
      });
    if (out.length === MAX_FINDINGS) break;
  }
  if (out.length > 0) return out;
  const whole = reply.trim();
  // Lines in the format that were all dropped mean the reply did follow it: nothing to show.
  if (reply.split("\n").some((l) => FINDING_LINE.test(l))) return [];
  if (whole === "" || /^no findings\.?$/i.test(whole)) return [];
  return [{ kind: "note", where: "", text: whole.slice(0, 1500) }];
}

/** Where the setting lives under the plugin's state dir. */
const SETTING_FILE = (dir: string) => join(dir, "second-opinion.json");

/** The file's shape. Schemastery lets a missing field through as undefined, so `{}` (off) parses. */
const SettingFile = z.object({ provider: z.string(), model: z.string(), auto: z.boolean() });

/** The saved setting, or undefined for none, a missing or unreadable file, or a row without a model. */
export async function loadSecondOpinion(dir: string): Promise<SecondOpinionSetting | undefined> {
  let row;
  try {
    row = SettingFile(JSON.parse(await readFile(SETTING_FILE(dir), "utf8")));
  } catch {
    return undefined;
  }
  if (!row.provider || !row.model?.trim()) return undefined;
  return row.auto === true
    ? { provider: row.provider, model: row.model, auto: true }
    : { provider: row.provider, model: row.model };
}

/** The text of the last user message in a turn's history: what the person asked this turn. Empty
 *  for a turn with none, and for options that carry no history at all, which the review says. */
export const requestText = (messages: readonly LooseMessage[] | undefined): string =>
  textOf((messages ?? []).findLast((m) => m.role === "user")?.content);

/** What the adapter that owns a session hands over at each turn start: the CLI's diff, a reader for
 *  a repo-relative path on the session's box (null when absent), and dsh's model service. */
export interface TurnDeps {
  diff: () => Promise<WorkspaceDiffReply>;
  read: (path: string) => Promise<string | null>;
  llm: PluginContext["llm"];
}

/** One session's state between turn start and the next one. */
interface Row {
  deps: TurnDeps;
  request: string;
  /** Bumped by every turn start; a turn end or review that sees a newer one drops its result. */
  gen: number;
  /** The snapshot taken as this turn's prompt went out; undefined once the turn's end took it. A
   *  turn that starts without a prompt write (a steer into an idle session, a background task
   *  waking Claude) has none, and its end shows no card. */
  base?: Promise<TreeMarks | undefined>;
  /** The diff and new-file texts at the last turn end: what a review reads. */
  end?: { diff: WorkspaceDiff; texts: Map<string, string> };
  card: OpinionCard | null;
  abort?: AbortController;
}

/** Reads the text of up to `NEW_FILES_READ` new files in the diff, each cut to `NEW_FILE_CAP`. A
 *  read that fails or finds nothing leaves the file out, and the review names it unread. */
async function readNewFiles(diff: WorkspaceDiff, read: TurnDeps["read"]) {
  const texts = new Map<string, string>();
  const fresh = diff.files.filter((f) => f.untracked && !f.binary).slice(0, NEW_FILES_READ);
  await Promise.all(
    fresh.map(async (f) => {
      const text = await read(f.path).catch(() => null);
      if (text !== null) texts.set(f.path, text.slice(0, NEW_FILE_CAP));
    }),
  );
  return texts;
}

/** The runtime: every adapter instance shares it, keyed by session id, like the event hub. */
class SecondOpinions {
  private setting: SecondOpinionSetting | undefined;
  private rows = new Map<string, Row>();

  /** Reads the setting once at startup. Turn starts read the copy in memory, never the file, so the
   *  snapshot's control request goes out before the prompt with no await between them. */
  async prime(dir: string = STATE_DIR): Promise<void> {
    this.setting = await loadSecondOpinion(dir);
  }

  /** The setting in effect, or undefined when the feature is off. */
  current(): SecondOpinionSetting | undefined {
    return this.setting;
  }

  /** Stores a new setting (undefined turns the feature off) and drops every card when it turns off,
   *  so no open tab keeps offering a review that can no longer run. */
  async save(next: SecondOpinionSetting | undefined, dir: string = STATE_DIR): Promise<void> {
    await writeJson(SETTING_FILE(dir), next ?? {});
    this.setting = next;
    if (next === undefined) for (const sid of this.rows.keys()) this.dismiss(sid);
  }

  /** Called just before a turn's prompt is written. Starts the snapshot at once: `deps.diff()`
   *  writes its control request synchronously, so the CLI reads it ahead of the prompt (probe
   *  2026-11-25: the answer came 1 to 3 s before the turn's first Write). Clears last turn's card
   *  and stops a review still running for it. Does nothing while the feature is off. */
  turnStarting(sessionId: string, request: string, deps: TurnDeps): void {
    if (this.setting === undefined) return;
    if (sessionId.startsWith("aux-") || sessionId.startsWith("compact-")) return;
    const row = this.rows.get(sessionId) ?? { deps, request, gen: 0, card: null };
    row.deps = deps;
    row.request = request;
    row.gen++;
    const snapshot = deps.diff();
    row.base = snapshot.then(async (d) =>
      d.ok ? treeMarks(d, await readNewFiles(d, deps.read)) : undefined,
    );
    this.stop(sessionId, row);
    this.keep(sessionId, row);
  }

  /** Called on a turn's result. Compares the tree with the turn-start snapshot and, when files
   *  changed, shows the card, then runs the review when `auto` is on. Drops its result when a newer
   *  turn started or the feature was turned off while it waited. Never throws: it runs detached. */
  async turnEnded(sessionId: string): Promise<void> {
    const row = this.rows.get(sessionId);
    const base = row?.base;
    if (this.setting === undefined || row === undefined || base === undefined) return;
    const gen = row.gen;
    row.base = undefined;
    /** Whether this turn end is still the latest word on the session. */
    const current = () => row.gen === gen && this.setting !== undefined;
    try {
      const before = await base;
      const now = await row.deps.diff();
      if (!current() || !now.ok) return;
      const texts = await readNewFiles(now, row.deps.read);
      if (!current()) return;
      row.end = { diff: now, texts };
      const files = changedPaths(before, treeMarks(now, texts));
      if (files.length === 0) return;
      row.card = { state: "ready", at: Date.now(), files };
      this.publish(sessionId);
      if (this.setting?.auto) await this.run(sessionId);
    } catch {
      // A failed snapshot leaves no card; the next turn takes a fresh one.
    }
  }

  /** Runs the review of the card's files. Answers false when there is nothing to review (no card,
   *  feature off) or one is already running or being prepared, so a double click or Run in two
   *  tabs starts one review. A newer turn, Cancel or Close aborts it and its answer is dropped. */
  async run(sessionId: string): Promise<boolean> {
    const row = this.rows.get(sessionId);
    const setting = this.setting;
    const card = row?.card;
    if (!row?.end || !setting || !card || card.state === "running" || row.abort) return false;
    const { files, at } = card;
    const model = setting.model;
    const end = row.end;
    // Claimed before the first await, so a second Run sees it.
    const ac = new AbortController();
    row.abort = ac;
    /** Shows the failure, unless the card has since moved on to another turn or was closed. */
    const fail = (reason: FailReason, detail?: string) => {
      if (row.card?.at !== at || row.abort !== ac) return;
      const failed: Extract<OpinionCard, { state: "failed" }> = {
        state: "failed",
        at,
        files,
        model,
        reason,
      };
      if (detail) failed.detail = detail;
      row.card = failed;
      this.publish(sessionId);
    };
    const timer = setTimeout(() => ac.abort(new Error("timeout")), REVIEW_TIMEOUT_MS);
    try {
      const { llm } = row.deps;
      const prepare = llm.prepareCall?.bind(llm);
      const offered =
        prepare !== undefined &&
        llm.listProviders().some((p) => p.id === setting.provider) &&
        (await llm.listModels(setting.provider).catch(() => [])).some((m) => m.id === model);
      if (!offered || prepare === undefined) {
        fail("gone");
        return true;
      }
      if (row.abort !== ac) return true;
      const startedAt = Date.now();
      row.card = { state: "running", at, files, model, startedAt };
      this.publish(sessionId);
      const input = reviewInput(row.request, end.diff, files, end.texts);
      const call = await prepare(
        { provider: setting.provider, model, maxTokens: REVIEW_MAX_TOKENS },
        ac.signal,
      );
      const assembler = new BlockAssembler();
      for await (const chunk of call.stream({
        ...call.config,
        messages: [
          createUserMessage({
            content: [{ type: "text", text: input.text }],
            source: { kind: "user" },
          }),
        ],
        system: REVIEW_SYSTEM,
        signal: ac.signal,
      }))
        assembler.push(chunk);
      if (row.abort !== ac || row.card?.at !== at) return true;
      const finish = assembler.finish;
      if (finish.kind === "aborted") fail("timeout");
      else if (finish.kind === "error")
        fail("error", finish.failure.message || finish.failure.code);
      else {
        const text = assembler
          .blocks()
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");
        if (text.trim() === "") fail("empty", finish.kind);
        else {
          row.card = {
            state: "done",
            at,
            files,
            model,
            findings: parseFindings(text, files),
            reviewed: input.reviewed,
            ms: Date.now() - startedAt,
          };
          this.publish(sessionId);
        }
      }
    } catch (error) {
      if (ac.signal.aborted) fail("timeout");
      else fail("error", error instanceof Error ? error.message || error.name : String(error));
    } finally {
      clearTimeout(timer);
      if (row.abort === ac) row.abort = undefined;
    }
    return true;
  }

  /** Stops a running review and puts the card back to its button, so the same turn can still be
   *  reviewed later or after picking a faster model. No-op without a running review. */
  cancel(sessionId: string): void {
    const row = this.rows.get(sessionId);
    const card = row?.card;
    if (!row?.abort || !card) return;
    row.abort.abort(new Error("cancelled"));
    row.abort = undefined;
    row.card = { state: "ready", at: card.at, files: card.files };
    this.publish(sessionId);
  }

  /** Hides the card for every tab and stops its review. */
  dismiss(sessionId: string): void {
    const row = this.rows.get(sessionId);
    if (!row) return;
    this.stop(sessionId, row);
  }

  /** The session's card as the route and the event carry it. */
  reply(sessionId: string): OpinionReply {
    return { card: this.rows.get(sessionId)?.card ?? null };
  }

  /** Aborts a running review and clears the card, publishing only when there was one. */
  private stop(sessionId: string, row: Row): void {
    row.abort?.abort(new Error("superseded"));
    row.abort = undefined;
    if (row.card === null) return;
    row.card = null;
    this.publish(sessionId);
  }

  /** Stores the row as the newest, dropping the oldest session past `MAX_SESSIONS`. */
  private keep(sessionId: string, row: Row): void {
    this.rows.delete(sessionId);
    this.rows.set(sessionId, row);
    if (this.rows.size > MAX_SESSIONS) {
      const oldest = this.rows.keys().next().value;
      if (oldest !== undefined) this.rows.delete(oldest);
    }
  }

  /** The session's card to its open tabs. */
  private publish(sessionId: string): void {
    hub.publish({ kind: "second-opinion", session: sessionId, data: this.reply(sessionId) });
  }
}

/** The one runtime every adapter instance and the routes share. */
export const opinions = new SecondOpinions();
