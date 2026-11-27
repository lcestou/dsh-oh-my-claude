// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d /tmp/omc-test.XXXXXX) bun src/routes/push-sw.test.ts.
// Runs the worker script in a VM with a stand-in `self`, since no browser runs in the suite: a push
// shows one notice tagged by session, a click with no dsh tab open opens /?omc-open=<id>, and a click
// with one open focuses it and posts the session to it.
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { PUSH_SW_SOURCE } from "./push-sw.js";

/** Load the worker against a fake `self` holding `tabs`; returns its handlers and what it did. */
function load(tabs: Array<{ focused: boolean; posted: Array<unknown> }>) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: Array<[string, Record<string, unknown>]> = [];
  const opened: Array<string> = [];
  const waits: Array<Promise<unknown>> = [];

  const self = {
    location: { origin: "https://dsh.example" },
    addEventListener: (name: string, fn: (e: unknown) => void) => (handlers[name] = fn),
    skipWaiting: () => undefined,
    registration: {
      showNotification: async (title: string, opts: Record<string, unknown>) =>
        shown.push([title, opts]),
    },
    clients: {
      matchAll: async () =>
        tabs.map((t) => ({
          focus: async () => (t.focused = true),
          postMessage: (m: unknown) => t.posted.push(m),
        })),
      openWindow: async (u: string) => opened.push(u),
    },
  };

  runInNewContext(PUSH_SW_SOURCE, { self, URL });

  const fire = async (name: string, e: Record<string, unknown>) => {
    handlers[name]?.({ ...e, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };

  return { fire, shown, opened };
}

{
  const sw = load([]);

  const data = {
    json: () => ({ title: "Fix the build", body: "Claude finished its turn.", session: "s1" }),
  };

  await sw.fire("push", { data });
  assert.equal(sw.shown.length, 1, "one push, one notice");
  assert.equal(sw.shown[0]?.[0], "Fix the build");
  assert.equal(sw.shown[0]?.[1].tag, "s1", "tagged by session, so a newer one replaces it");
  const notification = { data: { session: "s1" }, close: () => undefined };
  await sw.fire("notificationclick", { notification });
  assert.deepEqual(
    sw.opened,
    ["https://dsh.example/?omc-open=s1"],
    "no tab: open one on the session",
  );
}

{
  const tab = { focused: false, posted: [] as Array<unknown> };
  const sw = load([tab]);
  const notification = { data: { session: "s2" }, close: () => undefined };
  await sw.fire("notificationclick", { notification });
  assert.equal(tab.focused, true, "an open dsh tab is focused");
  // The message is built inside the VM, so its prototype is the VM's; compare it as JSON.
  assert.equal(
    JSON.stringify(tab.posted),
    JSON.stringify([{ omcOpen: "s2" }]),
    "and told which session to open",
  );
  assert.deepEqual(sw.opened, [], "rather than opening a second tab");
}

console.log("push-sw ok");
