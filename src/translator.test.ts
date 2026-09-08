import { strict as assert } from "node:assert";
import { capLines, formatToolCall, formatToolResult } from "./translator.js";

// bash: command goes in a bash fence, description rides the header
{
  const md = formatToolCall("bash", JSON.stringify({ command: "ls -la", description: "list" }));
  assert.equal(md, "**bash** — list\n```bash\nls -la\n```");
}

// read: just the path, no fence
assert.equal(
  formatToolCall("read", JSON.stringify({ file_path: "/a/b.ts" })),
  "**read** `/a/b.ts`",
);

// edit: unified-ish diff with per-line +/- prefixes in a diff fence
{
  const md = formatToolCall(
    "edit",
    JSON.stringify({ file_path: "x.ts", old_string: "a\nb", new_string: "c" }),
  );
  assert.equal(md, "**edit** `x.ts`\n```diff\n- a\n- b\n+ c\n```");
}

// grep with path
assert.equal(
  formatToolCall("grep", JSON.stringify({ pattern: "foo", path: "src" })),
  "**grep** `foo` in `src`",
);

// unknown tool falls back to a json fence of the raw input
assert.equal(formatToolCall("todowrite", '{"x":1}'), '**todowrite**\n```json\n{"x":1}\n```');

// malformed input never throws
assert.equal(formatToolCall("bash", "not json"), "**bash**\n```bash\n\n```");

// fence widens past a backtick run in the body so a Markdown fence never breaks
{
  const md = formatToolCall("bash", JSON.stringify({ command: "echo '```'" }));
  assert.ok(md.includes("````bash\n"), md);
}

// read result highlights by file extension; bash result stays plain
assert.equal(
  formatToolResult("read", "/a/b.py", "print(1)", false),
  "**read** result\n```python\nprint(1)\n```",
);
assert.equal(formatToolResult("bash", "", "done", false), "**bash** result\n```\ndone\n```");

// error results are plain-fenced and labelled error
assert.equal(formatToolResult("read", "/a/b.py", "nope", true), "**read** error\n```\nnope\n```");

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

console.log("translator format ok");
