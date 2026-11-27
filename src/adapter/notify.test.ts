// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d /tmp/omc-test.XXXXXX) bun src/adapter/notify.test.ts.
// The notifier's supersede rules with a stand-in sender, then `deliver` against a stand-in fetch:
// the webhook body, the push headers, and a 410 dropping its device.
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickUrl, deliver, Notifier, notifyDelayIn } from "./notify.js";
import type { Note, NotifyRequest } from "./notify.js";
import { addDevice, readDevices, validateDevice, writeNotifyConfig } from "../notify-store.js";
import { hub } from "../events.js";
import type { ServerResponse } from "node:http";

/** Poll `cond` every 5 ms for up to 2 s; a fixed sleep flakes under a loaded suite. */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

const quiet = () => {};

/** A notifier at delay 0 whose sends land in `sent`. */
function rig(hints: Record<string, boolean | number>) {
  const sent: Array<Note> = [];

  const n = new Notifier({
    dir: "/nonexistent",
    hints: async () => hints,
    send: async (_dir, note) => {
      sent.push(note);

      return { webhook: "none", sent: 0, failed: 0, removed: 0 };
    },
  });

  return { n, sent };
}

const req = (over: Partial<NotifyRequest> = {}): NotifyRequest => ({
  sessionId: "s1",
  event: "finished",
  tool: undefined,
  still: () => true,
  title: () => "Fix the build",
  isChild: async () => false,
  log: quiet,
  ...over,
});

{
  assert.equal(notifyDelayIn(undefined), 60_000, "no stored delay: one minute");
  assert.equal(notifyDelayIn(30_000), 30_000, "a listed delay is kept");
  assert.equal(notifyDelayIn(45_000), 60_000, "an unlisted delay reads as the default");
  assert.equal(clickUrl(null, "s1"), null, "no saved origin: no link");
  assert.equal(clickUrl("https://dsh.example", "a b"), "https://dsh.example/?omc-open=a%20b");
}

{
  const { n, sent } = rig({ notifyOn: true, notifyDelayMs: 0 });
  n.schedule(req());
  await until(() => sent.length > 0);
  assert.equal(sent.length, 1, "switch on, nothing superseded: one notice");
  assert.equal(sent[0]?.title, "Fix the build");
  assert.equal(sent[0]?.message, "Claude finished its turn.");
}

{
  const { n, sent } = rig({ notifyDelayMs: 0 });
  n.schedule(req());
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 0, "switch off (absent): nothing is sent");
}

{
  const { n, sent } = rig({ notifyOn: true, notifyDelayMs: 0 });
  n.schedule(req());
  n.cancel("s1");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 0, "a prompt sent before the hints read lands cancels the notice");
}

{
  const { n, sent } = rig({ notifyOn: true, notifyDelayMs: 0 });
  n.schedule(req({ event: "approval", tool: "Bash", still: () => false }));
  n.schedule(req({ sessionId: "child", isChild: async () => true }));
  n.schedule(req({ sessionId: "s2", event: "question" }));
  await until(() => sent.length > 0);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(
    sent.map((s) => [s.session, s.event]),
    [["s2", "question"]],
    "an answered prompt and a subagent's finished turn send nothing; the open question does",
  );
}

{
  const { n, sent } = rig({ notifyOn: true, notifyDelayMs: 0 });
  n.schedule(
    req({ sessionId: "child", event: "approval", tool: "Bash", isChild: async () => true }),
  );
  await until(() => sent.length > 0);
  assert.deepEqual(
    sent.map((s) => [s.session, s.event]),
    [["child", "approval"]],
    "a subagent waiting on an approval does notify: its parent is blocked and raises nothing",
  );
}

{
  const { n, sent } = rig({ notifyOn: true, notifyDelayMs: 0 });
  n.schedule(req({ event: "approval", tool: "Bash" }));
  n.schedule(req({ event: "finished" }));
  await until(() => sent.length > 0);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(
    sent.map((s) => s.event),
    ["finished"],
    "a newer event for the session replaces the pending one",
  );
}

{
  const dir = await mkdtemp(join(tmpdir(), "omc-notify-"));
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const keys = { p256dh: ua.getPublicKey().toString("base64url"), auth: "AAAAAAAAAAAAAAAAAAAAAA" };
  const live = validateDevice({ endpoint: "https://fcm.googleapis.com/fcm/send/live", keys });
  const dead = validateDevice({ endpoint: "https://web.push.apple.com/dead", keys });
  assert.ok(live && dead, "a well-formed subscription is accepted");
  assert.equal(
    validateDevice({ endpoint: "http://x/y", keys }),
    null,
    "a plain-HTTP endpoint is refused",
  );
  await addDevice(dir, live);
  await addDevice(dir, dead);
  await writeNotifyConfig(dir, {
    webhookUrl: "https://hook.example/x",
    openUrl: "https://dsh.example",
  });

  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: unknown;
    redirect?: string;
  }> = [];

  const fake = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: Object.fromEntries(new Headers(init.headers)),
      body: init.body,
      redirect: init.redirect,
    });

    return new Response(null, { status: url.endsWith("/dead") ? 410 : 201 });
  }) as unknown as typeof fetch;

  const note: Note = { event: "approval", session: "s1", title: "T", message: "M", tool: "Bash" };
  // A stand-in stream on the hub, to see the removal reach open Settings tabs.
  const frames: Array<string> = [];

  const stream = {
    write: (t: string) => frames.push(t),
    writeHead: () => stream,
    on: () => stream,
    once: () => stream,
    end: () => undefined,
    writableNeedDrain: false,
  };

  hub.attach(stream as unknown as ServerResponse, null, []);
  const report = await deliver(dir, note, quiet, fake);
  assert.deepEqual(report, { webhook: "ok", sent: 1, failed: 0, removed: 1 });
  const hook = calls.find((c) => c.url === "https://hook.example/x");
  assert.equal(hook?.headers.click, "https://dsh.example/?omc-open=s1", "ntfy's Click header");
  const body = JSON.parse(String(hook?.body));
  assert.equal(body.source, "dsh-oh-my-claude");
  assert.equal(body.event, "approval");
  assert.equal(body.tool, "Bash");
  assert.equal(body.click, "https://dsh.example/?omc-open=s1");
  const push = calls.find((c) => c.url.endsWith("/live"));
  assert.equal(push?.headers["content-encoding"], "aes128gcm");
  assert.equal(push?.redirect, "manual", "a push never follows a redirect to another host");
  assert.equal(push?.headers.urgency, "high", "a waiting prompt is urgent");
  assert.match(push?.headers.authorization ?? "", /^vapid t=.+, k=.+$/);
  assert.deepEqual(
    (await readDevices(dir)).map((d) => d.endpoint),
    ["https://fcm.googleapis.com/fcm/send/live"],
    "the 410 device is dropped, the live one kept",
  );
  assert.ok(
    frames.some((f) => f.includes("event: notify")),
    "dropping a device tells every open tab",
  );
  // close() also stops the hub's heartbeat timer, which would keep this process alive.
  hub.close();
}

// A send that throws (a key file that cannot be written) is logged, never left unhandled.
{
  const logged: Array<string> = [];

  const n = new Notifier({
    dir: "/nonexistent",
    hints: async () => ({ notifyOn: true, notifyDelayMs: 0 }),
    send: async () => {
      throw new Error("EACCES push-vapid.json");
    },
  });

  let unhandled = false;

  /** Marks any rejection nothing listened to while this block runs. */
  const onUnhandled = () => {
    unhandled = true;
  };

  process.on("unhandledRejection", onUnhandled);
  n.schedule(req({ log: (_level, msg) => logged.push(msg) }));
  await until(() => logged.length > 0);
  await new Promise((r) => setTimeout(r, 20));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled, false, "a failed send is not an unhandled rejection");
  assert.match(logged[0] ?? "", /send failed: EACCES/);
}

console.log("notify ok");
