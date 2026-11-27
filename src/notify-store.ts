// The box's phone-notice stores under STATE_DIR: where the webhook points, which devices take Web
// Push, and the VAPID pair those devices subscribed with. Box-wide on purpose: the phone that
// subscribes and the desktop that sets the webhook are different browsers looking at one list.
// An I/O module like state.ts: it parses what a browser sent and what sits in hand-editable files,
// which is why `.oxlintrc.json` lists it with the other I/O modules.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJson } from "./state.js";
import { newVapidKeys } from "./adapter/web-push.js";
import type { VapidKeys } from "./adapter/web-push.js";

/** `notify.json`: the webhook and the address its links open at. `openUrl` is the origin of the
 *  browser that saved the form (the box only knows its own bind address, which a phone cannot
 *  reach through a proxy); null until a form is saved. */
export interface NotifyConfig {
  webhookUrl: string | null;
  openUrl: string | null;
}

/** One Web Push subscription as the browser handed it over, plus when it was added. */
export interface PushDevice {
  endpoint: string;
  p256dh: string;
  auth: string;
  added: number;
}

/** A device as the Settings list shows it: never the endpoint itself, which is a bearer address
 *  anyone holding it can push to, only a stable id, the push service's name and the date. */
export interface DeviceRow {
  id: string;
  service: string;
  added: number;
}

/** The longest webhook or endpoint address kept; a longer one is refused rather than cut. */
export const WEBHOOK_URL_MAX = 2000;

/** Devices kept per box. A twenty-first subscription is refused: each notice costs one request per
 *  device, and a list that long is stale subscriptions nobody removed. */
export const DEVICES_MAX = 20;

const CONFIG_FILE = "notify.json";
const DEVICES_FILE = "push-devices.json";
const VAPID_FILE = "push-vapid.json";

/** The own fields of a parsed JSON object; anything else (null, an array, a string) reads as no
 *  fields, which every reader below treats as "absent". */
const fieldsOf = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : {};

/** A JSON file's top-level fields, or none when it is missing or unparseable (the stores below
 *  treat both as empty, the rule every store in state.ts follows). */
async function readFields(path: string): Promise<Record<string, unknown>> {
  try {
    return fieldsOf(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return {};
  }
}

/** A non-empty string, else null. */
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** An `http:` or `https:` URL; null for absent or empty; "bad" for anything else. */
function httpUrl(v: unknown): URL | null | "bad" {
  if (v === null || v === undefined || v === "") {
    return null;
  }

  if (typeof v !== "string") {
    return "bad";
  }

  try {
    const u = new URL(v.trim());

    return u.protocol === "https:" || u.protocol === "http:" ? u : "bad";
  } catch {
    return "bad";
  }
}

/** How many bytes a base64url string decodes to; 0 for anything that is not a string. */
const decodedLength = (v: unknown): number =>
  typeof v === "string" ? Buffer.from(v, "base64url").length : 0;

/** The saved config, each field null when absent or not a string. */
export async function readNotifyConfig(dir: string): Promise<NotifyConfig> {
  const o = await readFields(join(dir, CONFIG_FILE));

  return { webhookUrl: textOrNull(o.webhookUrl), openUrl: textOrNull(o.openUrl) };
}

/**
 * Check a config the Settings form sent. Returns the cleaned config, or the server-text key of the
 * reason it is refused. The webhook takes `http:` as well as `https:` because a Home Assistant or
 * n8n on the LAN is usually plain HTTP; an empty string clears it. `openUrl` keeps only the origin.
 */
export function validateNotifyConfig(
  body: unknown,
): { config: NotifyConfig } | { error: "notifyBadUrl" | "notifyLongUrl" } {
  const o = fieldsOf(body);

  if (typeof o.webhookUrl === "string" && o.webhookUrl.length > WEBHOOK_URL_MAX) {
    return { error: "notifyLongUrl" };
  }

  const hook = httpUrl(o.webhookUrl);
  const open = httpUrl(o.openUrl);

  if (hook === "bad" || open === "bad") {
    return { error: "notifyBadUrl" };
  }

  return { config: { webhookUrl: hook?.href ?? null, openUrl: open?.origin ?? null } };
}

/** Save the config owner-only: a webhook address often carries its own secret (an ntfy topic is
 *  the password to read it, a Home Assistant webhook id is the trigger). */
export function writeNotifyConfig(dir: string, config: NotifyConfig): Promise<void> {
  return writeJson(join(dir, CONFIG_FILE), config, { pretty: true, mode: 0o600 });
}

/** One stored row as a device, or null when it lost a field to a hand edit. */
function deviceOf(v: unknown): PushDevice | null {
  const d = fieldsOf(v);

  return typeof d.endpoint === "string" &&
    typeof d.p256dh === "string" &&
    typeof d.auth === "string" &&
    typeof d.added === "number"
    ? { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth, added: d.added }
    : null;
}

/** The saved devices, `{ devices: [...] }` on disk, dropping any row that lost a field. */
export async function readDevices(dir: string): Promise<Array<PushDevice>> {
  const { devices } = await readFields(join(dir, DEVICES_FILE));

  if (!Array.isArray(devices)) {
    return [];
  }

  return devices.map(deviceOf).filter((d): d is PushDevice => d !== null);
}

/** A device's id: the first 16 hex of the endpoint's SHA-256, so the list can name a device
 *  without handing the endpoint to every tab. */
export const deviceId = (endpoint: string): string =>
  createHash("sha256").update(endpoint).digest("hex").slice(0, 16);

/** The browser push services a subscription may point at, by host suffix, with the name the list
 *  shows. Only these are accepted: an endpoint is an address the box POSTs to on every notice, and
 *  any other host would make the box an HTTPS client of whatever a signed-in caller named. */
const PUSH_SERVICES: ReadonlyArray<readonly [string, string]> = [
  [".push.apple.com", "Apple"],
  [".googleapis.com", "Chrome"],
  [".mozilla.com", "Firefox"],
  [".notify.windows.com", "Edge"],
];

/** The push service's name for the list, from the endpoint's host; null for a host outside
 *  PUSH_SERVICES or an endpoint that is not a URL. */
export function serviceOf(endpoint: string): string | null {
  let host = "";

  try {
    host = new URL(endpoint).hostname;
  } catch {
    return null;
  }

  return PUSH_SERVICES.find(([suffix]) => `.${host}`.endsWith(suffix))?.[1] ?? null;
}

/** The list rows, oldest first. */
export const deviceRows = (devices: Array<PushDevice>): Array<DeviceRow> =>
  devices.map((d) => ({
    id: deviceId(d.endpoint),
    // A hand-edited row with an unknown host still lists, by its host, so it can be deleted.
    service:
      serviceOf(d.endpoint) ??
      (httpUrl(d.endpoint) instanceof URL ? new URL(d.endpoint).host : "?"),
    added: d.added,
  }));

/**
 * Check a subscription a browser sent: an `https:` endpoint on one of PUSH_SERVICES and the two
 * keys at the sizes the
 * encryption needs (a 65-byte P-256 point, a 16-byte secret). Returns null when any part is off,
 * which the route answers with a 400.
 */
export function validateDevice(body: unknown, now = Date.now()): PushDevice | null {
  const o = fieldsOf(body);
  const keys = fieldsOf(o.keys);

  if (typeof o.endpoint !== "string" || o.endpoint.length > WEBHOOK_URL_MAX) {
    return null;
  }

  const url = httpUrl(o.endpoint);

  if (url === null || url === "bad" || url.protocol !== "https:") {
    return null;
  }

  if (serviceOf(o.endpoint) === null) {
    return null;
  }

  if (decodedLength(keys.p256dh) !== 65 || decodedLength(keys.auth) !== 16) {
    return null;
  }

  return { endpoint: o.endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth), added: now };
}

/** Save the device list owner-only: each endpoint is an address anyone holding it can push to. */
function writeDevices(dir: string, devices: Array<PushDevice>): Promise<void> {
  return writeJson(join(dir, DEVICES_FILE), { devices }, { pretty: true, mode: 0o600 });
}

/** Every read-modify-write of the device list runs through this chain, the way `markBusy` in
 *  state.ts does: two phones subscribing at once, or an add landing inside a prune, would
 *  otherwise each write the list it read and drop the other's row. */
let devicesChain: Promise<unknown> = Promise.resolve();

/** Run `job` after every earlier device write; a failed job does not stop the next. */
function inDevicesChain<R>(job: () => Promise<R>): Promise<R> {
  const next = devicesChain.then(job, job);
  devicesChain = next.catch(() => undefined);

  return next;
}

/** Add or refresh one device (same endpoint: the newer keys win). Resolves false, writing nothing,
 *  when the box already holds DEVICES_MAX other devices. */
export function addDevice(dir: string, device: PushDevice): Promise<boolean> {
  return inDevicesChain(async () => {
    const others = (await readDevices(dir)).filter((d) => d.endpoint !== device.endpoint);

    if (others.length >= DEVICES_MAX) {
      return false;
    }

    await writeDevices(dir, [...others, device]);

    return true;
  });
}

/** Drop the devices whose id is in `ids`; a missing id is not an error. */
export function removeDevices(dir: string, ids: ReadonlySet<string>): Promise<void> {
  return inDevicesChain(async () => {
    const all = await readDevices(dir);
    const kept = all.filter((d) => !ids.has(deviceId(d.endpoint)));

    if (kept.length !== all.length) {
      await writeDevices(dir, kept);
    }
  });
}

/** One read-or-make per state dir and process, so two first calls (a double click on Notify this
 *  device) share one pair instead of each writing its own and orphaning the other's subscription. */
const vapidMemo = new Map<string, Promise<VapidKeys>>();

/** The box's VAPID pair, made and saved owner-only the first time it is asked for. A failed write
 *  is forgotten so the next call tries again. */
export function vapidKeys(dir: string): Promise<VapidKeys> {
  let pending = vapidMemo.get(dir);

  if (pending === undefined) {
    pending = loadOrMakeVapid(dir);
    vapidMemo.set(dir, pending);
    pending.catch(() => vapidMemo.delete(dir));
  }

  return pending;
}

/** Read `push-vapid.json`, or make the pair and write it when the file is missing or broken. */
async function loadOrMakeVapid(dir: string): Promise<VapidKeys> {
  const o = await readFields(join(dir, VAPID_FILE));
  const jwk = fieldsOf(o.privateJwk);

  if (typeof o.publicKey === "string" && typeof jwk.d === "string")
  // SAFETY: the file is the JWK `newVapidKeys` exported; a hand-broken one that still has a `d`
  // fails `createPrivateKey` inside `deliver`'s per-device try, which counts and logs it.
  {
    return { publicKey: o.publicKey, privateJwk: jwk };
  }

  const keys = newVapidKeys();
  await writeJson(join(dir, VAPID_FILE), keys, { pretty: true, mode: 0o600 });

  return keys;
}
