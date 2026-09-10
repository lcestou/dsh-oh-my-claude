// Offline self-check: bun src/rows-probe.test.ts. The live probe needs a dsh install and runs in
// the plugin at startup; here the log it sends is checked, and the answer when no dsh is around.
import assert from "node:assert/strict";
import { probeRawToolRows, rawRowsLog } from "./rows-probe.js";

{
  const { header, rows } = rawRowsLog();
  assert.equal(header.version, 3, "the current format, not one dsh would migrate");
  assert.deepEqual(
    rows.map((r) => r.type),
    [
      "turn/start",
      "step/start",
      "user/message",
      "tool/call",
      "tool/result",
      "assistant/message",
      "step/end",
      "turn/end",
    ],
  );
  const call = rows.findIndex((r) => r.type === "tool/call");
  const settled = rows.findIndex((r) => r.type === "assistant/message");
  assert(call < settled, "the raw call sits ahead of the settled message, as rows mode writes it");
}

{
  // No dsh above this path: rows are off, and the reason says what was missing rather than throwing.
  const off = await probeRawToolRows("/nonexistent/omc-probe/lib/bin.js");
  assert.equal(off.ok, false);
  assert.match(off.reason, /catalog not found/);
}

console.log("rows-probe.test: ok");
