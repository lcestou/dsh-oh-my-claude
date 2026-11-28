import assert from "node:assert/strict";
import z from "@deepseek-ai/schemastery";
import { fits, parsedWith } from "./schema-fits.js";

const Box = z.object({ name: z.string().required(), port: z.natural() });

// A value of the right shape fits, and the schema then builds it.
const good: unknown = JSON.parse('{"name":"nas","port":22}');

assert.equal(fits(Box, good), true);

if (fits(Box, good)) {
  assert.deepEqual(Box(good), { name: "nas", port: 22 });
}

// A wrong member type, a missing required member and a non-object do not.
for (const bad of ['{"name":"nas","port":"22"}', '{"port":22}', "42", "null"]) {
  const raw: unknown = JSON.parse(bad);
  assert.equal(fits(Box, raw), false, bad);
}

// Text that is JSON of the right shape is built; bad JSON and a wrong shape are undefined.
assert.deepEqual(parsedWith(Box, '{"name":"nas","port":22}'), { name: "nas", port: 22 });

assert.equal(parsedWith(Box, "{not json"), undefined);

assert.equal(parsedWith(Box, '{"port":22}'), undefined);
