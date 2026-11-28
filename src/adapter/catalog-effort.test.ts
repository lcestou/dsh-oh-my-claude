// The Models API's effort block is read one entry at a time: a value of a shape the plugin does
// not know is skipped, and the model keeps the efforts it reports.
import assert from "node:assert/strict";
import { effortCapsOf, modelFromApi } from "./catalog.js";

const known = effortCapsOf({
  effort: { supported: true, low: { supported: true }, high: { supported: true } },
});

assert.deepEqual(known, { supported: true, low: { supported: true }, high: { supported: true } });

// A field added later ("default": "high") does not cost the model its efforts.
const withExtra = effortCapsOf({
  effort: { supported: true, default: "high", low: { supported: true }, high: { supported: true } },
});

assert.deepEqual(withExtra, {
  supported: true,
  low: { supported: true },
  high: { supported: true },
});

assert.deepEqual(
  modelFromApi({ id: "claude-x", capabilities: { effort: withExtra } }).efforts,
  ["low", "high"],
  "efforts survive an unknown field",
);

// No block, or a block that is not an object, reads as none.
assert.equal(effortCapsOf({}), undefined);

assert.equal(effortCapsOf({ effort: "high" }), undefined);

console.log("catalog-effort ok");
