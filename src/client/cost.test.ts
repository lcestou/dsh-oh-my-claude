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

const { newestOnly, subscriptionStatus } = await import("./cost.js");
const { BOXES_EVENT } = await import("./picker.js");

assert.equal(await subscriptionStatus(), true);

assert.equal(await subscriptionStatus(), true);

assert.equal(calls, 1, "read once while nothing changes");

method = "api-key";

win.dispatchEvent(new Event(BOXES_EVENT));

assert.equal(await subscriptionStatus(), false, "a login change is read again");

assert.equal(calls, 2);

// Two overlapping reads: the older one answers last and must not win.
{
  const seen: Array<string> = [];
  const show = newestOnly<string>((v) => seen.push(v));

  /** A promise and the function that settles it, so the test picks the order replies land in. */
  const deferred = () => {
    let settle!: (v: string) => void;
    const promise = new Promise<string>((r) => (settle = r));

    return { promise, settle };
  };

  const first = deferred();
  const second = deferred();
  show(first.promise);
  show(second.promise);
  second.settle("api-key");
  first.settle("claude.ai");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(seen, ["api-key"], "the stale reply is dropped");
}

console.log("cost ok");
