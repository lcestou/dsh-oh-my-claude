import { strict as assert } from "node:assert";
import { capLines, formatToolCall, formatToolResult, HEADER_MARK } from "./translator.js";

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
  "▤\u2060 Read result\n```python\nprint(1)\n```",
);
assert.equal(formatToolResult("bash", "", "done", false), "❯\u2060 Bash result\n```\ndone\n```");

// error results are plain-fenced and labelled error
assert.equal(
  formatToolResult("read", "/a/b.py", "nope", true),
  "▤\u2060 Read error\n```\nnope\n```",
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

console.log("translator format ok");
