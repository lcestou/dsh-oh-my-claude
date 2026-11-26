// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d /tmp/omc-test.XXXXXX) bun src/client/phone-notices.test.ts.
// The two pure pieces of the Settings block, in the English t() falls back to without dsh's locale:
// the delay labels with the default named, and the test report as the sentence the status reads.
import assert from "node:assert/strict";
import { delayLabel, testSentence } from "./phone-notices.js";

{
  assert.equal(delayLabel(0), "Right away");
  assert.equal(delayLabel(30_000), "30 seconds");
  assert.match(delayLabel(60_000), /\(default\)$/, "one minute is named as the default");
  assert.doesNotMatch(delayLabel(300_000), /default/);
}

{
  const none = { webhook: "none", sent: 0, failed: 0, removed: 0 };
  assert.equal(testSentence(none), "Nothing to send to yet. Add this device or a webhook first.");
  assert.equal(
    testSentence({ webhook: "ok", sent: 1, failed: 1, removed: 1 }),
    "Sent to 1 of 3 devices. The webhook took it.",
    "a dropped device still counts in the total",
  );
  assert.equal(testSentence({ ...none, webhook: "HTTP 500" }), "The webhook failed: HTTP 500");
}
console.log("phone-notices ok");
