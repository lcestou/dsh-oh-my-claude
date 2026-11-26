// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d /tmp/omc-test.XXXXXX) bun src/notify-store.test.ts.
// The trust boundary for phone notices: what a Settings form and a browser may store, what the
// device list shows, and the cap on devices.
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDevice,
  deviceRows,
  DEVICES_MAX,
  readDevices,
  validateDevice,
  validateNotifyConfig,
  writeNotifyConfig,
} from "./notify-store.js";

{
  assert.deepEqual(
    validateNotifyConfig({ webhookUrl: "", openUrl: null }),
    {
      config: { webhookUrl: null, openUrl: null },
    },
    "an empty webhook clears it",
  );
  assert.deepEqual(validateNotifyConfig({ webhookUrl: "ftp://x/y" }), { error: "notifyBadUrl" });
  assert.deepEqual(validateNotifyConfig({ webhookUrl: "not a url" }), { error: "notifyBadUrl" });
  assert.deepEqual(validateNotifyConfig({ webhookUrl: `https://x/${"a".repeat(2000)}` }), {
    error: "notifyLongUrl",
  });
  assert.deepEqual(
    validateNotifyConfig({
      webhookUrl: " https://ntfy.sh/t?tpl=1 ",
      openUrl: "https://dsh.example/a?b",
    }),
    { config: { webhookUrl: "https://ntfy.sh/t?tpl=1", openUrl: "https://dsh.example" } },
    "the webhook is trimmed, the open address cut to its origin",
  );
}

{
  const rows = deviceRows([
    { endpoint: "https://web.push.apple.com/a", p256dh: "", auth: "", added: 1 },
    { endpoint: "https://fcm.googleapis.com/fcm/send/b", p256dh: "", auth: "", added: 2 },
    { endpoint: "https://updates.push.services.mozilla.com/c", p256dh: "", auth: "", added: 3 },
    { endpoint: "https://push.example.org/d", p256dh: "", auth: "", added: 4 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.service),
    ["Apple", "Chrome", "Firefox", "push.example.org"],
  );
  assert.ok(
    rows.every((r) => /^[0-9a-f]{16}$/.test(r.id)),
    "a 16-hex id, never the endpoint",
  );
}

{
  const dir = await mkdtemp(join(tmpdir(), "omc-store-"));
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const keys = { p256dh: ua.getPublicKey().toString("base64url"), auth: "AAAAAAAAAAAAAAAAAAAAAA" };
  for (let i = 0; i < DEVICES_MAX; i++) {
    const d = validateDevice({ endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys });
    assert.ok(d && (await addDevice(dir, d)));
  }
  assert.equal(
    validateDevice({ endpoint: "https://intranet.example/hook", keys }),
    null,
    "an endpoint outside the browser push services is refused",
  );
  assert.equal(
    validateDevice({ endpoint: "https://evilpush.apple.com/x", keys }),
    null,
    "a host that only ends in the same letters is refused",
  );
  const extra = validateDevice({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys });
  assert.ok(extra);
  assert.equal(await addDevice(dir, extra), false, "one past the cap is refused");
  const again = validateDevice({ endpoint: "https://fcm.googleapis.com/fcm/send/0", keys });
  assert.ok(again);
  assert.equal(await addDevice(dir, again), true, "the same endpoint refreshes, even at the cap");
  assert.equal((await readDevices(dir)).length, DEVICES_MAX);
  await writeNotifyConfig(dir, { webhookUrl: "https://hook.example/x", openUrl: null });
  assert.equal((await stat(join(dir, "notify.json"))).mode & 0o777, 0o600, "owner-only on disk");
  assert.equal((await stat(join(dir, "push-devices.json"))).mode & 0o777, 0o600);
  assert.ok((await readFile(join(dir, "push-devices.json"), "utf8")).startsWith('{\n  "devices"'));
}
{
  const dir = await mkdtemp(join(tmpdir(), "omc-store-race-"));
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const keys = { p256dh: ua.getPublicKey().toString("base64url"), auth: "AAAAAAAAAAAAAAAAAAAAAA" };
  const devices = [0, 1, 2, 3, 4].map((i) =>
    validateDevice({ endpoint: `https://web.push.apple.com/r${i}`, keys }),
  );
  await Promise.all(devices.map((d) => (d ? addDevice(dir, d) : false)));
  assert.equal((await readDevices(dir)).length, 5, "five subscriptions at once keep all five rows");
}
console.log("notify-store ok");
