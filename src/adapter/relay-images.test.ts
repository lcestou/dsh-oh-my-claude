// A relayed dsh tool result keeps its images: `toolResultFor` names them and the bridge answers
// them as MCP image content after the text.
import { strict as assert } from "node:assert";
import { handleRpc } from "../mcp.js";
import type { RpcEnv } from "../mcp.js";
import { fakeAgent, notFaked, rpcResult } from "../test-context.js";
import type { LooseMessage } from "./prompt.js";
import { loadRelayImages, toolResultFor } from "./turn.js";

const ref = { attachmentId: "a1", mediaType: "image/png", bytes: 3, width: 1, height: 1 };

const messages: Array<LooseMessage> = [
  {
    role: "tool",
    toolCallId: "c1",
    content: [
      { type: "text", text: "Read image a.png" },
      { type: "image", attachment: ref },
    ],
  },
  { role: "tool", toolCallId: "c2", content: [{ type: "text", text: "plain" }] },
];

assert.deepEqual(toolResultFor(messages, "c1"), {
  text: "Read image a.png",
  isError: false,
  refs: [ref],
});

assert.deepEqual(toolResultFor(messages, "c2"), { text: "plain", isError: false });

// The env carries what handleRpc reads for a relayed call: the relay answers, the tool never runs.
const env: RpcEnv = {
  tools: { schemas: () => [], get: () => ({ execute: notFaked("read_image.execute") }) },
  agent: fakeAgent(),
  signal: new AbortController().signal,
  version: "t",
  relay: async () => ({
    text: "Read image a.png",
    images: [{ mediaType: "image/png", data: "AAA" }],
  }),
};

const reply = await handleRpc(
  { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_image", arguments: {} } },
  env,
);

assert.deepEqual(rpcResult(reply).content, [
  { type: "text", text: "Read image a.png" },
  { type: "image", data: "AAA", mimeType: "image/png" },
]);

// Loading goes straight to the store, so a screenshot over 2000 px a side rides back too: the CLI
// scales an MCP image itself, unlike a stdin one. An image the store cannot read is skipped and
// reported, and the result keeps its text.
{
  const wide = { attachmentId: "w", mediaType: "image/png", bytes: 3, width: 2560, height: 1440 };
  const lost = { attachmentId: "x", mediaType: "image/png", bytes: 3, width: 10, height: 10 };

  const results: Parameters<typeof loadRelayImages>[0] = [
    { text: "Read image w.png", refs: [wide, lost] },
    { text: "plain" },
  ];

  const warned: Array<string> = [];

  // A store double with only the read this path makes.
  const store: Parameters<typeof loadRelayImages>[1] = {
    readImage: async (r) => {
      if (r.attachmentId === "x") {
        throw new Error("gone");
      }

      return { data: new Uint8Array([1, 2, 3]).buffer, ref: r };
    },
  };

  await loadRelayImages(results, store, undefined, (m) => void warned.push(m));
  assert.deepEqual(results, [
    { text: "Read image w.png", images: [{ mediaType: "image/png", data: "AQID" }] },
    { text: "plain" },
  ]);
  assert.deepEqual(warned, ["relayed image x not loaded: gone"]);
}

console.log("relay-images: ok");
