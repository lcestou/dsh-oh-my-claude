// The cost pill's plan check: one /status read shared by every pill, asked again after a login
// change (BOXES_EVENT), so a switch between a plan and an API key shows without a refresh.
import { strict as assert } from "node:assert";

// cost.tsx registers its listener at import, so the window it sees has to exist first.
const win = new EventTarget();
Object.assign(globalThis, { window: win });
let calls = 0;
let method = "claude.ai";
Object.assign(globalThis, {
  fetch: async () => {
    calls++;
    return new Response(JSON.stringify({ authMethod: method }), {
      headers: { "content-type": "application/json" },
    });
  },
});
const { subscriptionStatus } = await import("./cost.js");
const { BOXES_EVENT } = await import("./picker.js");

assert.equal(await subscriptionStatus(), true);
assert.equal(await subscriptionStatus(), true);
assert.equal(calls, 1, "read once while nothing changes");
method = "api-key";
win.dispatchEvent(new Event(BOXES_EVENT));
assert.equal(await subscriptionStatus(), false, "a login change is read again");
assert.equal(calls, 2);
console.log("cost ok");
