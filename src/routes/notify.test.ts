// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d /tmp/omc-test.XXXXXX) bun src/routes/notify.test.ts.
// The /notify blocks against a stand-in request: a bad webhook is refused with the server's
// sentence, a subscription is listed by id and service but never by endpoint, and a delete drops it.
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteCtx } from "../sessions.js";
import { UNHANDLED } from "./context.js";
import { notifyRoutes } from "./notify.js";

let status = 0;
let reply: Record<string, unknown> = {};

const ctx = {
  ROUTE_PREFIX: "/dsh-oh-my-claude",
  json: (_res: ServerResponse, s: number, v: Record<string, unknown>) => {
    status = s;
    reply = v;
  },
  readBody: async (req: IncomingMessage & { body?: unknown }) => req.body ?? {},
  log: () => {},
} as unknown as RouteCtx;

const routes = notifyRoutes(ctx);

/** Send one request through the group; returns what it answered, or UNHANDLED. */
async function send(method: string, path: string, body?: unknown) {
  const req = { method, body } as unknown as IncomingMessage;
  const url = new URL(path, "http://dsh");

  return routes(req, {} as ServerResponse, url);
}

{
  await send("PUT", "/dsh-oh-my-claude/notify", { webhookUrl: "ftp://x", openUrl: null });
  assert.equal(status, 400, "a non-http webhook is refused");
  assert.equal(reply.error, "A webhook address starts with http:// or https://.");
  await send("PUT", "/dsh-oh-my-claude/notify", {
    webhookUrl: "http://ha.lan:8123/api/webhook/x",
    openUrl: "https://dsh.example/some/page",
  });
  assert.equal(status, 200);
  assert.equal(
    reply.webhookUrl,
    "http://ha.lan:8123/api/webhook/x",
    "plain HTTP on the LAN is fine",
  );
  assert.equal(reply.openUrl, "https://dsh.example", "only the origin is kept");
}

{
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const endpoint = "https://web.push.apple.com/QGuQyavXutnMH";
  const keys = { p256dh: ua.getPublicKey().toString("base64url"), auth: "AAAAAAAAAAAAAAAAAAAAAA" };
  await send("POST", "/dsh-oh-my-claude/notify/devices", {
    endpoint,
    keys: { p256dh: "x", auth: "y" },
  });
  assert.equal(status, 400, "keys of the wrong size are refused");
  await send("POST", "/dsh-oh-my-claude/notify/devices", { endpoint, keys });
  assert.equal(status, 200);
  const devices = reply.devices as Array<Record<string, unknown>>;
  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.service, "Apple");
  assert.ok(!JSON.stringify(reply).includes("QGuQyavXutnMH"), "the endpoint never leaves the box");
  await send("DELETE", `/dsh-oh-my-claude/notify/devices?id=${String(devices[0]?.id)}`);
  assert.deepEqual(reply.devices, [], "a delete by id drops it");
}

{
  await send("GET", "/dsh-oh-my-claude/notify/push-key");
  const first = reply.publicKey;
  await send("GET", "/dsh-oh-my-claude/notify/push-key");
  assert.equal(reply.publicKey, first, "the box keeps one VAPID pair");
  assert.equal(await send("GET", "/dsh-oh-my-claude/other"), UNHANDLED, "other paths fall through");
}

console.log("notify routes ok");
