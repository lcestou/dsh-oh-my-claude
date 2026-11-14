// A relayed dsh tool result keeps its images: `toolResultFor` names them and the bridge answers
// them as MCP image content after the text.
import { strict as assert } from "node:assert";
import { handleRpc } from "../mcp.js";
import type { LooseMessage } from "./prompt.js";
import { toolResultFor } from "./turn.js";

const ref = { attachmentId: "a1", mediaType: "image/png", bytes: 3, width: 1, height: 1 };
const messages = [
  {
    role: "tool",
    toolCallId: "c1",
    content: [
      { type: "text", text: "Read image a.png" },
      { type: "image", attachment: ref },
    ],
  },
  { role: "tool", toolCallId: "c2", content: [{ type: "text", text: "plain" }] },
] as unknown as LooseMessage[];
assert.deepEqual(toolResultFor(messages, "c1"), {
  text: "Read image a.png",
  isError: false,
  refs: [ref],
});
assert.deepEqual(toolResultFor(messages, "c2"), { text: "plain", isError: false });

// SAFETY: test double carries only what handleRpc reads for a relayed call
const env = {
  tools: { schemas: () => [], get: () => ({ name: "read_image" }) },
  agent: {},
  signal: new AbortController().signal,
  version: "t",
  relay: async () => ({
    text: "Read image a.png",
    images: [{ mediaType: "image/png", data: "AAA" }],
  }),
} as unknown as Parameters<typeof handleRpc>[1];
// SAFETY: tools/call always answers a result
const reply = (await handleRpc(
  { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_image", arguments: {} } },
  env,
)) as { result: { content: unknown[] } };
assert.deepEqual(reply.result.content, [
  { type: "text", text: "Read image a.png" },
  { type: "image", data: "AAA", mimeType: "image/png" },
]);

console.log("relay-images: ok");
