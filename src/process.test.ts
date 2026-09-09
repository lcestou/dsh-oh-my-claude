// Offline self-check: bun src/process.test.ts. No CLI, no file, no network.
// These decoders read control-response payloads the CLI sends over stream-json. They rename fields
// on the way in (isDeferred -> deferred, autocompactSource -> autocompact, isBinary -> binary), so a
// silent rename or a dropped guard would let malformed CLI output through to the panel unnoticed.
import assert from "node:assert/strict";
import {
  controlErrorLine,
  controlRequestLine,
  decodeCliModels,
  decodeContextUsage,
  decodeMcpStatus,
  decodeRewindResult,
  decodeTitle,
  decodeWorkspaceDiff,
  interruptLine,
  toJsonValue,
  toolResultText,
} from "./process.js";

// A rewind answer: canRewind is true only for the literal true, and the string list drops non-strings.
{
  assert.deepEqual(decodeRewindResult(undefined), { canRewind: false });
  assert.deepEqual(decodeRewindResult(null), { canRewind: false });
  // A non-object (or an array) is not a rewind answer; the default stands rather than throwing.
  assert.deepEqual(decodeRewindResult([1, 2]), { canRewind: false });
  // A truthy non-boolean must not read as "yes": the CLI only ever sends a real boolean here.
  assert.deepEqual(decodeRewindResult({ canRewind: "yes" }), { canRewind: false });
  assert.deepEqual(
    decodeRewindResult({
      canRewind: true,
      error: "dirty tree",
      filesChanged: ["a.ts", 7, "b.ts", null],
      insertions: 3,
      deletions: 1,
    }),
    {
      canRewind: true,
      error: "dirty tree",
      filesChanged: ["a.ts", "b.ts"],
      insertions: 3,
      deletions: 1,
    },
  );
  // Counts that are not numbers are left off, not coerced to 0, so the panel can tell "absent" apart.
  assert.deepEqual(decodeRewindResult({ canRewind: true, insertions: "3" }), { canRewind: true });
}

// Context usage: the field renames are the whole point, and a category missing name or tokens is dropped.
{
  const out = decodeContextUsage({
    categories: [
      { name: "system", tokens: 100, isDeferred: true },
      { name: "tools", tokens: 50 },
      { name: "no-tokens" },
      { tokens: 5 },
      "junk",
    ],
    totalTokens: 150,
    maxTokens: 200000,
    percentage: 0.1,
    model: "claude-opus-4-8",
    autocompactSource: "threshold",
  });
  assert.deepEqual(out.categories, [
    { name: "system", tokens: 100, deferred: true },
    { name: "tools", tokens: 50, deferred: false },
  ]);
  assert.equal(out.totalTokens, 150);
  assert.equal(out.maxTokens, 200000);
  assert.equal(out.percentage, 0.1);
  assert.equal(out.model, "claude-opus-4-8");
  // The CLI names it autocompactSource; the panel reads out.autocompact. A rename breaks the badge.
  assert.equal(out.autocompact, "threshold");

  // Missing everything: totals fall back to 0, optional strings stay absent, categories is empty.
  const bare = decodeContextUsage({});
  assert.deepEqual(bare, { categories: [], totalTokens: 0, maxTokens: 0, percentage: 0 });
  assert.equal("model" in bare, false);
  assert.equal("autocompact" in bare, false);
}

// Workspace diff: stats live under an optional `diff` wrapper, and hunks join to files by path.
{
  const wrapped = decodeWorkspaceDiff({
    diff: {
      stats: { filesCount: 2, linesAdded: 10, linesRemoved: 4 },
      perFileStats: [
        { path: "a.ts", added: 8, removed: 4, isBinary: false, isUntracked: false },
        { path: "logo.png", isBinary: true, isUntracked: true },
      ],
      hunks: [
        {
          path: "a.ts",
          hunks: [{ oldStart: 1, newStart: 1, lines: ["-old", "+new", 42] }],
        },
      ],
    },
  });
  assert.equal(wrapped.filesCount, 2);
  assert.equal(wrapped.linesAdded, 10);
  assert.equal(wrapped.linesRemoved, 4);
  assert.equal(wrapped.files.length, 2);
  // isBinary/isUntracked are renamed, and missing numbers coerce to 0 rather than NaN or undefined.
  assert.deepEqual(wrapped.files[1], {
    path: "logo.png",
    added: 0,
    removed: 0,
    binary: true,
    untracked: true,
    hunks: [],
  });
  // A non-string line inside a hunk is dropped, keeping the rendered diff text clean.
  const first = wrapped.files[0];
  assert.ok(first);
  assert.deepEqual(first.hunks, [{ oldStart: 1, newStart: 1, lines: ["-old", "+new"] }]);

  // The same payload without the `diff` wrapper is read the same way: the CLI has sent both shapes.
  const flat = decodeWorkspaceDiff({
    stats: { filesCount: 1, linesAdded: 1, linesRemoved: 0 },
    perFileStats: [{ path: "x", added: 1, removed: 0 }],
  });
  assert.equal(flat.filesCount, 1);
  assert.deepEqual(flat.files[0], {
    path: "x",
    added: 1,
    removed: 0,
    binary: false,
    untracked: false,
    hunks: [],
  });

  // No stats at all: every count is 0 and the file list is empty, not undefined.
  assert.deepEqual(decodeWorkspaceDiff(undefined), {
    filesCount: 0,
    linesAdded: 0,
    linesRemoved: 0,
    files: [],
  });
}

// MCP status: name is required, status defaults, version comes from serverInfo, error beats message.
{
  const out = decodeMcpStatus({
    mcpServers: [
      { name: "fs", status: "connected", serverInfo: { version: "1.2.3" } },
      { name: "api" },
      { status: "connected" },
      { name: "broke", status: "failed", error: "boom", message: "ignored when error is present" },
      { name: "warned", message: "just a message" },
    ],
  });
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], { name: "fs", status: "connected", version: "1.2.3" });
  // A server with no status reads as "unknown", not the empty string.
  assert.deepEqual(out[1], { name: "api", status: "unknown" });
  // error takes precedence over message; when only message is present it fills error instead.
  const broke = out[2];
  const warned = out[3];
  assert.ok(broke);
  assert.ok(warned);
  assert.equal(broke.error, "boom");
  assert.equal(warned.error, "just a message");
}

// CLI models: value is required, resolvedModel and displayName fall back to value, efforts filters.
{
  const out = decodeCliModels({
    models: [
      {
        value: "opus",
        resolvedModel: "claude-opus-4-8",
        displayName: "Opus",
        supportedEffortLevels: ["low", 5, "high"],
      },
      { value: "sonnet" },
      { displayName: "no value" },
    ],
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    value: "opus",
    resolvedModel: "claude-opus-4-8",
    displayName: "Opus",
    efforts: ["low", "high"],
  });
  // A bare model shows its value in both slots so the picker never renders a blank row.
  assert.deepEqual(out[1], {
    value: "sonnet",
    resolvedModel: "sonnet",
    displayName: "sonnet",
    efforts: [],
  });
}

// The control-request wire line: the CLI matches on request_id, so the field names and the trailing
// newline are the contract, not cosmetics.
{
  const line = controlRequestLine("req-1", { subtype: "get_context_usage" });
  assert.ok(line.endsWith("\n"), "one framed line per request");
  const parsed = JSON.parse(line);
  assert.deepEqual(parsed, {
    type: "control_request",
    request_id: "req-1",
    request: { subtype: "get_context_usage" },
  });
}

// toolResultText renders a tool_result for the transcript. The CLI writes content as a bare string
// or as a block array, and a block it has no text for still has to render as something: a throw here
// would take out the whole turn's rows, and an empty string would silently drop an image result.
{
  assert.equal(toolResultText({ content: "plain text" }), "plain text");

  assert.equal(
    toolResultText({
      content: [
        { type: "text", text: "line 1" },
        { type: "text", text: "line 2" },
      ],
    }),
    "line 1\nline 2",
  );

  // A block that is not text keeps its type as a label, and a block with no type at all is named.
  assert.equal(
    toolResultText({
      content: [{ type: "text", text: "text" }, { type: "image" }, { foo: "bar" }],
    }),
    "text\n[image]\n[unknown]",
  );

  // Nothing usable is an empty string, never a throw.
  assert.equal(toolResultText({}), "");
  assert.equal(toolResultText({ content: undefined }), "");

  assert.equal(toolResultText({ content: null }), "");
  assert.equal(toolResultText({ content: 42 }), "");
  assert.equal(toolResultText({ content: {} }), "");

  // Real behaviour worth pinning: a text block with no text renders the word, not an empty line.
  assert.equal(toolResultText({ content: [{ type: "text" }] }), "undefined");

  assert.equal(toolResultText({ content: [{ type: 123 }] }), "[unknown]");
}

// decodeTitle names a session in the sidebar. A blank or non-string answer has to come back as
// undefined so the caller keeps the title it already had, rather than renaming a session to "".
{
  assert.equal(decodeTitle({ title: "Session Title" }), "Session Title");
  assert.equal(decodeTitle({ title: "  Trimmed  " }), "Trimmed");

  assert.equal(decodeTitle({ title: "" }), undefined);
  assert.equal(decodeTitle({ title: "   " }), undefined);

  assert.equal(decodeTitle({}), undefined);
  assert.equal(decodeTitle(undefined), undefined);
  assert.equal(decodeTitle(null), undefined);

  assert.equal(decodeTitle([{ title: "ignored" }]), undefined);

  assert.equal(decodeTitle({ title: 123 }), undefined);
  assert.equal(decodeTitle({ title: true }), undefined);
  assert.equal(decodeTitle({ title: { nested: "object" } }), undefined);
}

// toJsonValue guards the wire: a control response carries whatever a tool handed back, and a value
// JSON cannot hold has to be dropped here rather than throwing inside the write.
{
  assert.equal(toJsonValue("text"), "text");
  assert.equal(toJsonValue(42), 42);
  assert.equal(toJsonValue(true), true);
  assert.deepEqual(toJsonValue({ key: "value" }), { key: "value" });
  assert.deepEqual(toJsonValue([1, 2, 3]), [1, 2, 3]);

  assert.equal(toJsonValue(undefined), undefined);

  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  assert.equal(toJsonValue(circular), undefined);

  assert.equal(
    toJsonValue(() => {}),
    undefined,
  );

  assert.equal(toJsonValue(Symbol("test")), undefined);

  assert.equal(toJsonValue(BigInt(9007199254740992)), undefined);
}

// interruptLine is what Stop writes to stdin. The CLI reads stdin line by line, so a missing
// newline would leave the request sitting in its buffer and the turn running.
{
  const line = interruptLine("req-123");
  assert.ok(line.endsWith("\n"), "wire line ends with newline");
  const parsed = JSON.parse(line);
  assert.equal(parsed.type, "control_request");
  assert.equal(parsed.request_id, "req-123");
  assert.equal(parsed.request.subtype, "interrupt");

  const emptyLine = interruptLine("");
  const emptyParsed = JSON.parse(emptyLine);
  assert.equal(emptyParsed.request_id, "");

  // The id is JSON-escaped, so a quote in it cannot split the line.
  const specialLine = interruptLine('req-"quote\\"end');
  const specialParsed = JSON.parse(specialLine);
  assert.equal(specialParsed.request_id, 'req-"quote\\"end');
}

// controlErrorLine answers a control request the plugin could not satisfy. The CLI waits for that
// answer, so the line has to be written even when the error itself is not representable.
{
  const line = controlErrorLine("req-1", "operation failed");
  assert.ok(line.endsWith("\n"), "wire line ends with newline");
  const parsed = JSON.parse(line);
  assert.equal(parsed.type, "control_response");
  assert.equal(parsed.response.subtype, "error");
  assert.equal(parsed.response.request_id, "req-1");
  assert.equal(parsed.response.error, "operation failed");

  const objLine = controlErrorLine("req-2", { code: "FAILED", message: "boom" });
  const objParsed = JSON.parse(objLine);
  assert.deepEqual(objParsed.response.error, { code: "FAILED", message: "boom" });

  const undefinedLine = controlErrorLine("req-3", undefined);
  const undefinedParsed = JSON.parse(undefinedLine);
  assert.equal(undefinedParsed.response.error, undefined);

  // A field JSON cannot hold is dropped; the rest of the error still reaches the CLI.
  const funcLine = controlErrorLine("req-4", { fn: () => {}, str: "text" });
  const funcParsed = JSON.parse(funcLine);
  assert.equal("fn" in funcParsed.response.error, false);
  assert.equal(funcParsed.response.error.str, "text");
}

console.log("process ok");
