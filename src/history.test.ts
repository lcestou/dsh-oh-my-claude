// Offline self-check: bun src/history.test.ts. The fold's rules without a transcript: order,
// repeats kept at their newest, blanks and the plugin's own notices dropped.
import assert from "node:assert/strict";
import { PLUGIN_NOTICE, foldHistory } from "./history.js";

// Newest first, whatever order the transcripts handed them in.
assert.deepEqual(
  foldHistory([
    { text: "older", time: 1 },
    { text: "newest", time: 3 },
    { text: "middle", time: 2 },
  ]).map((e) => e.text),
  ["newest", "middle", "older"],
);

// A prompt sent twice keeps its newest sending only, even across a different trim.
assert.deepEqual(
  foldHistory([
    { text: "again", time: 1 },
    { text: "other", time: 2 },
    { text: "  again \n", time: 5 },
  ]),
  [
    { text: "again", time: 5 },
    { text: "other", time: 2 },
  ],
);

// Blanks and the plugin's notices never show.
assert.deepEqual(
  foldHistory([
    { text: "   ", time: 9 },
    { text: `${PLUGIN_NOTICE}dsh restarted`, time: 8 },
    { text: "kept", time: 1 },
  ]),
  [{ text: "kept", time: 1 }],
);

assert.deepEqual(foldHistory([]), []);
console.log("history: ok");
