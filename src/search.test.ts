// Offline self-check: bun src/search.test.ts. No network, no files.
import assert from "node:assert/strict";
import { recordText, queryWords, searchTranscript } from "./search.js";

// 1. A user record holding both words matches: count 1, role "user", snippet holds the phrase.
{
  const transcript = JSON.stringify({
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    message: { content: "please deploy the staging server now" },
  });
  const hit = searchTranscript(transcript, queryWords("deploy staging"));
  assert(hit);
  assert.equal(hit!.count, 1);
  assert.equal(hit!.role, "user");
  assert(hit!.snippet.includes("deploy the staging"), "snippet contains the matched phrase");
}

// 2. Two words split across two records do not match: `every` is per record, `some` would pass.
{
  const transcript = [
    JSON.stringify({ type: "user", message: { content: "please roll it" } }),
    JSON.stringify({ type: "assistant", message: { content: "the build failed" } }),
  ].join("\n");
  assert.equal(searchTranscript(transcript, queryWords("roll build")), undefined);
}

// 3. Three records that all match give count 3 and the first record's snippet.
{
  const transcript = [
    JSON.stringify({ type: "user", message: { content: "fix the flaky integration test" } }),
    JSON.stringify({
      type: "assistant",
      message: { content: "reproduced the flaky integration test" },
    }),
    JSON.stringify({ type: "user", message: { content: "still flaky integration test here" } }),
  ].join("\n");
  const hit = searchTranscript(transcript, queryWords("flaky integration test"));
  assert(hit);
  assert.equal(hit!.count, 3);
  assert(hit!.snippet.includes("flaky integration test"), "snippet comes from the first record");
}

// 4. Case is ignored in both directions: upper query finds lower text, lower finds upper.
{
  const lower = JSON.stringify({
    type: "user",
    message: { content: "the typescript build is green" },
  });
  assert(searchTranscript(lower, queryWords("TYPESCRIPT BUILD")) !== undefined);
  const upper = JSON.stringify({
    type: "assistant",
    message: { content: "THE TYPESCRIPT BUILD IS GREEN" },
  });
  assert(searchTranscript(upper, queryWords("typescript build")) !== undefined);
}

// 5. A tool_result block is not text a reader sees, so a word only inside it does not match.
{
  const transcript = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", content: "needle in a haystack" }] },
  });
  assert.equal(searchTranscript(transcript, queryWords("needle")), undefined);
  assert.equal(recordText(transcript), undefined, "recordText agrees the tool_result is not text");
}

// 6. An image block reads as [image] and does not throw.
{
  const transcript = JSON.stringify({
    type: "user",
    message: {
      content: [
        { type: "text", text: "look at" },
        { type: "image" },
        { type: "text", text: "this" },
      ],
    },
  });
  const hit = searchTranscript(transcript, queryWords("[image]"));
  assert(hit);
  assert(hit!.snippet.includes("[image]"), "the image block reads as [image]");
  assert.equal(recordText(transcript)!.text, "look at\n[image]\nthis");
}

// 7. A non-JSON line and a truncated object line are skipped; a later valid line still matches.
{
  const transcript = [
    "this is not json at all",
    '{"type":"user","mess',
    JSON.stringify({ type: "assistant", message: { content: "recovered after the partial" } }),
  ].join("\n");
  const hit = searchTranscript(transcript, queryWords("recovered partial"));
  assert(hit);
  assert.equal(hit!.role, "assistant");
}

// 8. A 200,000-character record still yields a snippet of at most 400 bytes.
{
  const big = "word ".repeat(40_000); // 200,000 characters
  const transcript = JSON.stringify({ type: "user", message: { content: big } });
  const hit = searchTranscript(transcript, queryWords("word"), 5_000);
  assert(hit);
  assert(Buffer.byteLength(hit!.snippet) <= 400, "snippet capped at 400 bytes");
}

// 9. `when` is the matching record's parsed timestamp; a record with none gives 0.
{
  const stamped = JSON.stringify({
    type: "user",
    timestamp: "2026-01-02T03:04:05Z",
    message: { content: "ship it tomorrow" },
  });
  const hit9a = searchTranscript(stamped, queryWords("ship tomorrow"));
  assert(hit9a);
  assert.equal(hit9a!.when, Date.parse("2026-01-02T03:04:05Z"));

  const bare = JSON.stringify({ type: "assistant", message: { content: "ship it soon" } });
  const hit9b = searchTranscript(bare, queryWords("ship soon"));
  assert(hit9b);
  assert.equal(hit9b!.when, 0, "a record with no timestamp gives 0");
}

// 10. An empty query is an empty word list and matches nothing, not everything.
{
  assert.deepEqual(queryWords(""), []);
  assert.deepEqual(queryWords("   "), []);
  const transcript = JSON.stringify({ type: "user", message: { content: "anything at all" } });
  assert.equal(searchTranscript(transcript, []), undefined);
}

// 11. The snippet carries no newlines and no double space, whatever the record contained.
{
  const transcript = JSON.stringify({
    type: "user",
    message: { content: "one\ntwo\tthree  four\n\nfive    done" },
  });
  const hit = searchTranscript(transcript, queryWords("done"));
  assert(hit);
  assert(!/\n/.test(hit!.snippet), "no newline in the snippet");
  assert(!/  /.test(hit!.snippet), "no double space in the snippet");
}

console.log("ok search");
