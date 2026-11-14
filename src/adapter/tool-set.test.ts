// `followToolSet`: the digest of the bridged tools follows names, schemas and deferral, not order
// or descriptions, and a changed digest is a changed process key.
import { strict as assert } from "node:assert";
import type { JsonValue } from "../dsh.js";
import type { ClaudeProcessSpec } from "../process.js";
import { Config } from "./config.js";
import { specKey, toolSetDigest } from "./turn.js";

const tool = (
  name: string,
  description = "",
  parameters: Record<string, JsonValue> = { type: "object" },
) => ({
  name,
  description,
  parameters,
});
const base = toolSetDigest([tool("bash"), tool("read")]);
assert.equal(toolSetDigest([tool("read"), tool("bash")]), base, "order does not matter");
assert.equal(toolSetDigest([tool("bash", "now says more"), tool("read")]), base, "nor wording");
assert.notEqual(toolSetDigest([tool("bash"), tool("read"), tool("ha_restart")]), base, "added");
assert.notEqual(toolSetDigest([tool("bash")]), base, "removed");
assert.notEqual(
  toolSetDigest([tool("bash", "", { type: "object", required: ["command"] }), tool("read")]),
  base,
  "schema changed",
);
assert.notEqual(toolSetDigest([{ ...tool("bash"), deferLoading: true }, tool("read")]), base);

const spec: ClaudeProcessSpec = {
  cwd: "/w",
  model: "m",
  effort: null,
  mode: "bypassPermissions",
  sessionId: "s",
  temporary: false,
};
assert.notEqual(specKey({ ...spec, tools: base }), specKey({ ...spec, tools: "other" }));
assert.equal(new Config({}).followToolSet, false, "off by default: specs key as before");

console.log("tool-set: ok");
