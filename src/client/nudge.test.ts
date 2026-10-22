import assert from "node:assert/strict";
import { COMPACT_AT, compactThreshold, runDraft } from "./nudge.js";

// A stored percent wins; anything that is not a percent falls back to the default.
assert.equal(compactThreshold(60), 60);
assert.equal(compactThreshold(1), 1);
assert.equal(compactThreshold(100), 100);
assert.equal(compactThreshold(undefined), COMPACT_AT);
assert.equal(compactThreshold(true), COMPACT_AT);
assert.equal(compactThreshold(0), COMPACT_AT);
assert.equal(compactThreshold(250), COMPACT_AT);
assert.equal(compactThreshold(Number.NaN), COMPACT_AT);

// A plain snippet gets the usual three-backtick fence.
assert.equal(runDraft("bash", "ls -la"), "Run this:\n```bash\nls -la\n```");
// A snippet holding a fence of its own gets a longer one, so it stays one block.
const nested = "cat <<'EOF' > x.md\n```sh\necho hi\n```\nEOF";
assert.equal(runDraft("bash", nested), `Run this:\n\`\`\`\`bash\n${nested}\n\`\`\`\``);
// Four backticks inside push the fence to five.
assert.ok(runDraft("sh", "echo ````").startsWith("Run this:\n`````sh\n"));
