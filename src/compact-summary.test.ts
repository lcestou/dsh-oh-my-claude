// compactSummaryOf: the summary after the boundary whose preTokens match, framing stripped.
import assert from "node:assert/strict";
import { compactSummaryOf } from "./compact-summary.js";

const boundary = (pre: number) =>
  JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    content: "Conversation compacted",
    compactMetadata: { trigger: "manual", preTokens: pre, postTokens: 10 },
  });
const summary = (body: string) =>
  JSON.stringify({
    type: "user",
    isCompactSummary: true,
    message: {
      role: "user",
      content: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n<system-reminder>\n<tools-used-before-summary>Bash, Read</tools-used-before-summary>\n\n${body}\n</system-reminder>`,
    },
  });
const tail = [
  '{"type":"assistant","message":{"content":[{"type":"text","text":"isCompactSummary\\":true in prose"}]}}',
  boundary(100),
  summary("# First\n\nold work"),
  '{"type":"user","message":{"content":"say ok"}}',
  boundary(200),
  summary("# Second\n\nnew work"),
  '{"type":"result","subtype":"success"}',
].join("\n");

assert.equal(
  compactSummaryOf(tail, 200),
  "# Second\n\nnew work",
  "the matching pair, framing gone",
);
assert.equal(
  compactSummaryOf(tail, 100),
  "# First\n\nold work",
  "an earlier pair by its preTokens",
);
assert.equal(compactSummaryOf(tail), "# Second\n\nnew work", "no preTokens: the last summary");
assert.equal(compactSummaryOf(tail, 300), undefined, "a boundary not in the tail: nothing");
assert.equal(
  compactSummaryOf(`half a row ${tail}`, 200),
  "# Second\n\nnew work",
  "a cut first line is skipped",
);
assert.equal(
  compactSummaryOf(
    JSON.stringify({
      type: "user",
      isCompactSummary: true,
      message: { content: [{ type: "text", text: "blocks\nform" }] },
    }),
  ),
  "blocks\nform",
  "content as blocks",
);
