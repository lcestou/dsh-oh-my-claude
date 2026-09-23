import { strict as assert } from "node:assert";
import {
  Translator,
  capLines,
  formatToolCall,
  formatToolResult,
  HEADER_MARK,
} from "./translator.js";
import type { PluginLoadError } from "./plugins.js";
import type { FallbackRecord } from "./translator.js";

// Every header we write carries the mark right behind its glyph, and nothing else does: the client
// requires it before it claims a paragraph as a tool header, so prose that opens with one of these
// characters keeps it. Both sides go together — this is the contract between them.
for (const md of [
  formatToolCall("bash", JSON.stringify({ command: "ls" })),
  formatToolCall("read", JSON.stringify({ file_path: "/a/b.ts" })),
  formatToolCall("todowrite", '{"x":1}'),
  formatToolResult("bash", "", "done", false),
]) {
  assert.equal(md.charAt(1), HEADER_MARK, `header mark missing from ${JSON.stringify(md)}`);
  assert.equal(md.indexOf(HEADER_MARK, 2), -1, "the mark appears once, on the header");
}

// bash: icon + capitalized name lead the header (plain, not bold), command in a bash fence, a middot
// joins the description
{
  const md = formatToolCall("bash", JSON.stringify({ command: "ls -la", description: "list" }));
  assert.equal(md, "❯\u2060 Bash · list\n```bash\nls -la\n```");
}

// read: just the path, no fence
assert.equal(
  formatToolCall("read", JSON.stringify({ file_path: "/a/b.ts" })),
  "▤\u2060 Read `/a/b.ts`",
);

// edit: unified-ish diff with per-line +/- prefixes in a diff fence
{
  const md = formatToolCall(
    "edit",
    JSON.stringify({ file_path: "x.ts", old_string: "a\nb", new_string: "c" }),
  );
  assert.equal(md, "✎\u2060 Edit `x.ts`\n```diff\n- a\n- b\n+ c\n```");
}

// grep with path
assert.equal(
  formatToolCall("grep", JSON.stringify({ pattern: "foo", path: "src" })),
  "⌕\u2060 Grep `foo` in `src`",
);

// web_search: the web_ prefix becomes a "Web " label
assert.equal(
  formatToolCall("web_search", JSON.stringify({ query: "cats" })),
  "⌕\u2060 Web search `cats`",
);

// unknown tool falls back to a json fence of its input, name capitalized with a default icon. The
// input is pretty-printed: one line of JSON has nothing for the 18-line cap to cut, so a Task call
// used to print its whole subagent prompt in the header.
assert.equal(
  formatToolCall("todowrite", '{"x":1}'),
  '◆\u2060 Todowrite\n```json\n{\n  "x": 1\n}\n```',
);

// …and long values are clipped: a Task prompt is one JSON string, so the line cap alone never cut
// it and the header printed the whole prompt.
{
  const md = formatToolCall(
    "task",
    JSON.stringify({ prompt: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") }),
  );
  assert.ok(md.includes("…"), md);
  assert.ok(md.length < 500, md);
}

// MultiEdit maps to the edit presenter but carries `edits[]`; every pair reaches the diff.
assert.equal(
  formatToolCall(
    "edit",
    JSON.stringify({
      file_path: "x.ts",
      edits: [
        { old_string: "a", new_string: "b" },
        { old_string: "c", new_string: "d" },
      ],
    }),
  ),
  "✎\u2060 Edit `x.ts`\n```diff\n- a\n+ b\n- c\n+ d\n```",
);

// malformed input never throws
assert.equal(formatToolCall("bash", "not json"), "❯\u2060 Bash\n```bash\n\n```");

// fence widens past a backtick run in the body so a Markdown fence never breaks
{
  const md = formatToolCall("bash", JSON.stringify({ command: "echo '```'" }));
  assert.ok(md.includes("````bash\n"), md);
}

// read result highlights by file extension; bash result stays plain
assert.equal(
  formatToolResult("read", "/a/b.py", "print(1)", false),
  "▤\u2060 Read · Result\n```python\nprint(1)\n```",
);
assert.equal(formatToolResult("bash", "", "done", false), "❯\u2060 Bash · Result\n```\ndone\n```");

// error results are plain-fenced and labelled error
assert.equal(
  formatToolResult("read", "/a/b.py", "nope", true),
  "▤\u2060 Read · Error\n```\nnope\n```",
);

// capLines: bodies at or under the cap pass through untouched
{
  const short = Array.from({ length: 18 }, (_, i) => `l${i}`).join("\n");
  assert.equal(capLines(short), short);
}

// capLines: an over-cap body keeps its head and gains a tail count of the elided lines
{
  const long = Array.from({ length: 25 }, (_, i) => `l${i}`).join("\n");
  const out = capLines(long);
  assert.equal(out.split("\n").length, 19); // 18 head + 1 tail
  assert.ok(out.startsWith("l0\n"), out);
  assert.ok(out.endsWith("… 7 more lines"), out);
}

// capLines flows into a fenced tool result: the tail count rides inside the fence
{
  const body = Array.from({ length: 20 }, (_, i) => `r${i}`).join("\n");
  const md = formatToolResult("bash", "", body, false);
  assert.ok(md.includes("\n… 2 more lines\n```"), md);
}

// todo_write: the list is the point — a JSON dump of it said nothing at a glance
{
  const md = formatToolCall(
    "todo_write",
    JSON.stringify({
      todos: [
        { content: "wire icons", status: "completed" },
        { content: "add tests", status: "in_progress" },
        { content: "open PR", status: "pending" },
      ],
    }),
  );
  assert.equal(
    md,
    "\u2611\u2060 Todo write 3 items\n```markdown\n- [x] wire icons\n- [~] add tests\n- [ ] open PR\n```",
  );
}

// task: which subagent, what it was told
assert.equal(
  formatToolCall(
    "task",
    JSON.stringify({ subagent_type: "Explore", description: "find callers", prompt: "grep it" }),
  ),
  "\u2699\u2060 Task `Explore` · find callers\n```markdown\ngrep it\n```",
);

// plan modes fence the plan, and stand alone without one
assert.equal(
  formatToolCall("exit_plan_mode", JSON.stringify({ plan: "1. do it" })),
  "\u2630\u2060 Exit plan mode\n```markdown\n1. do it\n```",
);
assert.equal(formatToolCall("enter_plan_mode", "{}"), "\u2630\u2060 Enter plan mode");

// slash_command, bash_output, kill_shell: one-liners naming what they touched
assert.equal(
  formatToolCall("slash_command", JSON.stringify({ command: "/unslop" })),
  "\u2318\u2060 Slash command `/unslop`",
);
assert.equal(
  formatToolCall("bash_output", JSON.stringify({ bash_id: "b12", filter: "error" })),
  "\u276f\u2060 Bash output `b12` matching `error`",
);
assert.equal(
  formatToolCall("kill_shell", JSON.stringify({ shell_id: "b12" })),
  "\u276f\u2060 Kill shell `b12`",
);
// the CLI names the handle `bash_id` on one tool and `shell_id` on the other; both read either
assert.equal(
  formatToolCall("bash_output", JSON.stringify({ shell_id: "b13" })),
  "\u276f\u2060 Bash output `b13`",
);
assert.equal(
  formatToolCall("kill_shell", JSON.stringify({ bash_id: "b13" })),
  "\u276f\u2060 Kill shell `b13`",
);

// notebook_edit reads like an edit: path, cell, then the new source
assert.equal(
  formatToolCall(
    "notebook_edit",
    JSON.stringify({ notebook_path: "n.ipynb", cell_id: "c3", new_source: "print(1)" }),
  ),
  "\u270e\u2060 Notebook edit `n.ipynb` cell `c3`\n```python\nprint(1)\n```",
);

// an MCP tool is named by its own server and verb, not by a tool called "Mcp"
{
  const md = formatToolCall("mcp__dsh__subagent", "{}");
  assert.ok(md.startsWith("\u25c6\u2060 dsh \u00b7 subagent"), md);
}

// api_retry with statusNote: 5xx gets the note appended, 429 does not; seen tracks which codes were asked
{
  const seen: number[] = [];
  // SAFETY: Translator constructor type lacks statusNote in the exported declaration but the field is set
  const t = new Translator({
    statusNote: (code) => {
      seen.push(code);
      return " · Anthropic reports Degraded performance";
    },
  }) as any;
  const degraded = t.translate({
    type: "system",
    subtype: "api_retry",
    attempt: 1,
    max_retries: 3,
    retry_delay_ms: 2000,
    error: { status: 529, message: "overloaded" },
  });
  assert.equal(degraded.at(-1).block.type, "reasoning");
  assert.equal(
    degraded.at(-1).block.text,
    "⚠ overloaded · Retrying in 2s · attempt 1/3 · Anthropic reports Degraded performance",
  );
  assert.deepEqual(seen, [529]);
  const rateLimited = t.translate({
    type: "system",
    subtype: "api_retry",
    attempt: 1,
    max_retries: 3,
    retry_delay_ms: 2000,
    error: { status: 429, message: "rate limit" },
  });
  assert.equal(rateLimited.at(-1).block.text, "⚠ rate limit · Retrying in 2s · attempt 1/3");
  assert.deepEqual(seen, [529]);
}

console.log("translator format ok");

// init.plugin_errors: the init frame's plugin_errors reach onInit as its third argument; a clean
// init (no key) clears with []; a commands_changed refresh passes undefined so stored errors are
// left alone.
{
  // SAFETY: the test reaches onInit, a private field, to observe what translate forwards
  const t = new Translator() as unknown as {
    onInit?: (c: string[], tools: string[], pe?: PluginLoadError[]) => void;
    translate: (e: unknown) => void;
  };
  let seen: { names: string[]; tools: string[]; pe: PluginLoadError[] | undefined } | undefined;
  t.onInit = (names, tools, pe) => {
    seen = { names, tools, pe };
  };
  t.translate({
    type: "system",
    subtype: "init",
    slash_commands: ["verify"],
    tools: [],
    plugin_errors: [{ plugin: "p", type: "generic-error", message: "boom" }],
  });
  assert.deepEqual(
    seen?.pe,
    [{ plugin: "p", type: "generic-error", message: "boom" }],
    "init forwards plugin_errors to onInit",
  );
  seen = { names: [], tools: [], pe: undefined };
  t.translate({ type: "system", subtype: "init", slash_commands: ["verify"], tools: [] });
  assert.deepEqual(seen?.pe, [], "a clean init forwards [] so a prior error is cleared");
  seen = { names: [], tools: [], pe: undefined };
  t.translate({ type: "system", subtype: "commands_changed", commands: ["verify"] });
  assert.equal(
    seen?.pe,
    undefined,
    "commands_changed forwards undefined, leaving errors untouched",
  );
}
console.log("translator plugin-errors ok");
// model_fallback / refusal / consent frames: each draws its reasoning line and fires onModel once
// with the fields the notice and picker read. Synthetic frames built from the 2.1.277 schemas
// (byte search, notes/design/2026-09-19-model-fallback.md); the model_fallback frame is the shape
// the Haiku probe produced live.
{
  // SAFETY: the test reaches onModel, a private field, to observe what translate forwards
  const t = new Translator() as unknown as {
    onModel?: (rec: Omit<FallbackRecord, "sessionId" | "at">) => void;
    translate: (e: unknown) => Array<{ block?: { type?: string; text?: string } }>;
  };
  const seen: Array<Omit<FallbackRecord, "sessionId" | "at">> = [];
  t.onModel = (rec) => {
    seen.push(rec);
  };

  const refusal = t.translate({
    type: "system",
    subtype: "model_refusal_fallback",
    direction: "sticky",
    scope: "session",
    original_model: "Fable 5.1",
    fallback_model: "Opus 4.8",
    api_refusal_category: "cyber",
  });
  assert.equal(refusal.at(-1)?.block?.type, "reasoning", "refusal line is a reasoning block");
  assert.equal(
    refusal.at(-1)?.block?.text,
    "⚠ Model switched: Fable 5.1 → Opus 4.8 (cyber safeguard)",
    "sticky refusal line names the category",
  );
  assert.equal(
    seen.at(-1)?.kind,
    "model_refusal_fallback",
    "onModel kind is model_refusal_fallback",
  );
  assert.equal(seen.at(-1)?.direction, "sticky", "onModel carries direction sticky");
  assert.equal(seen.at(-1)?.scope, "session", "onModel carries scope session");
  assert.equal(seen.at(-1)?.category, "cyber", "onModel carries category cyber");

  const noFallback = t.translate({
    type: "system",
    subtype: "model_refusal_no_fallback",
    original_model: "Fable 5.1",
    api_refusal_category: "cyber",
  });
  assert.equal(
    noFallback.at(-1)?.block?.text,
    "⛔ Request blocked on Fable 5.1 (cyber safeguard)",
    "no-fallback line blocks with the category",
  );
  assert.equal(
    seen.at(-1)?.kind,
    "model_refusal_no_fallback",
    "onModel kind is model_refusal_no_fallback",
  );
  assert.equal(seen.at(-1)?.to, "", "no-fallback record has empty to");

  const consent = t.translate({
    type: "system",
    subtype: "model_consent_fallback",
    original_model_name: "Fable 5",
    fallback_model: "Opus 5",
    persisted_as_default: true,
    content: "Switched to Opus 5 — now your default model",
  });
  assert.equal(
    consent.at(-1)?.block?.text,
    "⚠ Switched to Opus 5 — now your default model",
    "consent line uses the CLI content",
  );
  assert.equal(
    seen.at(-1)?.kind,
    "model_consent_fallback",
    "onModel kind is model_consent_fallback",
  );
  assert.equal(seen.at(-1)?.direction, "sticky", "persisted consent maps to sticky");

  const primary = t.translate({
    type: "system",
    subtype: "model_fallback",
    trigger: "model_not_found",
    original_model: "claude-nonexistent-9-9",
    fallback_model: "claude-haiku-4-5-20251001",
    content: "Switched to Haiku 4.5 because claude-nonexistent-9-9 is not available",
  });
  assert.equal(
    primary.at(-1)?.block?.text,
    "⚠ Switched to Haiku 4.5 because claude-nonexistent-9-9 is not available",
    "model_fallback line uses the CLI content",
  );
  assert.equal(seen.at(-1)?.kind, "model_fallback", "onModel kind is model_fallback");
}
console.log("translator model-fallback ok");
// init.plugin_warnings: the init frame's plugin_warnings reach onInit as its fourth argument,
// alongside plugin_errors; a clean init clears both with []; a commands_changed refresh passes
// undefined so stored warnings are left alone. reload carries no warning_count, so warnings refresh
// only from a fresh init frame.
{
  // SAFETY: the test reaches onInit, a private field, to observe what translate forwards
  const t = new Translator() as unknown as {
    onInit?: (c: string[], tools: string[], pe?: PluginLoadError[], pw?: PluginLoadError[]) => void;
    translate: (e: unknown) => void;
  };
  let seen: { pe: PluginLoadError[] | undefined; pw: PluginLoadError[] | undefined } | undefined;
  t.onInit = (_names, _tools, pe, pw) => {
    seen = { pe, pw };
  };
  t.translate({
    type: "system",
    subtype: "init",
    slash_commands: ["verify"],
    tools: [],
    plugin_errors: [{ plugin: "p", type: "generic-error", message: "boom" }],
    plugin_warnings: [
      { plugin: "w@inline", type: "folder-shadowed-by-manifest", message: "warned" },
    ],
  });
  assert.deepEqual(
    seen?.pw,
    [{ plugin: "w@inline", type: "folder-shadowed-by-manifest", message: "warned" }],
    "init forwards plugin_warnings to onInit",
  );
  assert.deepEqual(
    seen?.pe,
    [{ plugin: "p", type: "generic-error", message: "boom" }],
    "the same frame forwards plugin_errors independently",
  );
  seen = { pe: undefined, pw: undefined };
  t.translate({ type: "system", subtype: "init", slash_commands: ["verify"], tools: [] });
  assert.deepEqual(seen?.pw, [], "a clean init forwards [] so a prior warning is cleared");
  seen = { pe: undefined, pw: undefined };
  t.translate({ type: "system", subtype: "commands_changed", commands: ["verify"] });
  assert.equal(
    seen?.pw,
    undefined,
    "commands_changed forwards undefined, leaving warnings untouched",
  );
}
console.log("translator plugin-warnings ok");

// The line's mode, the way the CLI's own reducer sets it: requesting from the CLI's own status
// frame, thinking or responding at a block start, tool-use when a tool block closes and at
// message_stop; message_start sets nothing. `tool` drops on the echo that answers the last call,
// and that echo is a frame (the stall clock restarts at the tool's end).
{
  const modes: string[] = [];
  const tools: Array<{ tool: boolean; frame: boolean }> = [];
  // SAFETY: the test feeds hand-built frames, the way the blocks above do
  const t = new Translator({
    onProgress: (p) => {
      if (p.mode) modes.push(p.mode);
      if (p.tool !== undefined) tools.push({ tool: p.tool, frame: p.frame === true });
    },
  }) as any;
  const ev = (event: object, parent?: string) =>
    t.translate({ type: "stream_event", event, parent_tool_use_id: parent ?? null });
  const echo = (id: string, parent?: string) =>
    t.translate({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id }] },
      parent_tool_use_id: parent ?? null,
    });
  t.translate({ type: "system", subtype: "status", status: "requesting" });
  ev({ type: "message_start", message: { id: "m1" } });
  ev({ type: "content_block_start", index: 0, content_block: { type: "thinking" } });
  ev({ type: "content_block_stop", index: 0 });
  ev({ type: "content_block_start", index: 1, content_block: { type: "text" } });
  ev({ type: "content_block_stop", index: 1 });
  ev({
    type: "content_block_start",
    index: 2,
    content_block: { type: "tool_use", id: "c1", name: "Bash" },
  });
  ev({ type: "content_block_stop", index: 2 });
  ev({
    type: "content_block_start",
    index: 3,
    content_block: { type: "tool_use", id: "c2", name: "Read" },
  });
  ev({ type: "content_block_stop", index: 3 });
  ev({ type: "message_stop" });
  assert.deepEqual(
    modes,
    ["requesting", "thinking", "responding", "responding", "tool-use", "responding", "tool-use"],
    "message_start sets no mode; the tool block's stop and message_stop both say tool-use",
  );
  echo("c1");
  assert.deepEqual(tools, [{ tool: true, frame: false }], "first echo leaves the tool in flight");
  echo("c2");
  assert.deepEqual(
    tools.at(-1),
    { tool: false, frame: true },
    "the last echo ends it and moves the stall clock",
  );
  assert.equal(modes.at(-1), "tool-use", "no mode from an echo");
  t.translate({ type: "system", subtype: "status", status: "requesting" });
  assert.equal(modes.at(-1), "requesting", "the CLI's own frame requests");
  // A nested agent's frames (the CLI's Task tool) never drive the line: no mode, no tool flag,
  // no stall-clock frame, and its message_start leaves the parent's open calls alone.
  ev({
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "c9", name: "Task" },
  });
  ev({ type: "content_block_stop", index: 0 });
  const before = modes.length;
  const toolsBefore = tools.length;
  ev({ type: "message_start", message: { id: "m2" } }, "c9");
  t.translate({ type: "system", subtype: "status", status: "requesting" });
  ev({ type: "content_block_start", index: 0, content_block: { type: "text" } }, "c9");
  ev({ type: "message_stop" }, "c9");
  echo("c8", "c9");
  assert.equal(modes.length, before, "nested frames emit no mode");
  assert.equal(tools.length, toolsBefore, "a nested echo moves neither the flag nor the clock");
  echo("c9");
  assert.deepEqual(
    tools.at(-1),
    { tool: false, frame: true },
    "the Task's own echo ends it: the nested message_start did not clear the parent's set",
  );
  console.log("live-mode ok");
}
