import { type VapidKeys } from "./adapter/web-push.js";
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
export declare const WEBHOOK_URL_MAX = 2000;
/** Devices kept per box. A twenty-first subscription is refused: each notice costs one request per
 *  device, and a list that long is stale subscriptions nobody removed. */
export declare const DEVICES_MAX = 20;
/** The saved config, each field null when absent or not a string. */
export declare function readNotifyConfig(dir: string): Promise<NotifyConfig>;
/**
 * Check a config the Settings form sent. Returns the cleaned config, or the server-text key of the
 * reason it is refused. The webhook takes `http:` as well as `https:` because a Home Assistant or
 * n8n on the LAN is usually plain HTTP; an empty string clears it. `openUrl` keeps only the origin.
 */
export declare function validateNotifyConfig(body: unknown): {
    config: NotifyConfig;
} | {
    error: "notifyBadUrl" | "notifyLongUrl";
};
/** Save the config owner-only: a webhook address often carries its own secret (an ntfy topic is
 *  the password to read it, a Home Assistant webhook id is the trigger). */
export declare function writeNotifyConfig(dir: string, config: NotifyConfig): Promise<void>;
/** The saved devices, `{ devices: [...] }` on disk, dropping any row that lost a field. */
export declare function readDevices(dir: string): Promise<PushDevice[]>;
/** A device's id: the first 16 hex of the endpoint's SHA-256, so the list can name a device
 *  without handing the endpoint to every tab. */
export declare const deviceId: (endpoint: string) => string;
/** The push service's name for the list, from the endpoint's host; null for a host outside
 *  PUSH_SERVICES or an endpoint that is not a URL. */
export declare function serviceOf(endpoint: string): string | null;
/** The list rows, oldest first. */
export declare const deviceRows: (devices: PushDevice[]) => DeviceRow[];
/**
 * Check a subscription a browser sent: an `https:` endpoint on one of PUSH_SERVICES and the two
 * keys at the sizes the
 * encryption needs (a 65-byte P-256 point, a 16-byte secret). Returns null when any part is off,
 * which the route answers with a 400.
 */
export declare function validateDevice(body: unknown, now?: number): PushDevice | null;
/** Add or refresh one device (same endpoint: the newer keys win). Resolves false, writing nothing,
 *  when the box already holds DEVICES_MAX other devices. */
export declare function addDevice(dir: string, device: PushDevice): Promise<boolean>;
/** Drop the devices whose id is in `ids`; a missing id is not an error. */
export declare function removeDevices(dir: string, ids: ReadonlySet<string>): Promise<void>;
/** The box's VAPID pair, made and saved owner-only the first time it is asked for. A failed write
 *  is forgotten so the next call tries again. */
export declare function vapidKeys(dir: string): Promise<VapidKeys>;
