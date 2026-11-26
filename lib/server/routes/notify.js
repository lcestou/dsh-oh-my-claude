import { UNHANDLED } from "./context.js";
import { hub } from "../events.js";
import { serverText } from "../locale.js";
import { STATE_DIR } from "../state.js";
import { deliver, noteFor } from "../adapter/notify.js";
import { addDevice, DEVICES_MAX, deviceRows, readDevices, readNotifyConfig, removeDevices, validateDevice, validateNotifyConfig, vapidKeys, writeNotifyConfig, } from "../notify-store.js";
import { PUSH_SW_SOURCE } from "./push-sw.js";
/** The worker's path. Its scope is its own folder, which covers no dsh page: push and
 *  notificationclick need no controlled page, so the worker never sits between dsh and its tabs. */
export const PUSH_SW_PATH = "/dsh-oh-my-claude/push/sw.js";
/** The current state for the Settings block. */
async function notifyState() {
    const config = await readNotifyConfig(STATE_DIR);
    return { ...config, devices: deviceRows(await readDevices(STATE_DIR)) };
}
/** Tell every open tab the list or the webhook moved; readers fetch `/notify` again. */
const published = async () => {
    hub.publish({ kind: "notify", session: null, data: {} });
    return notifyState();
};
/**
 * Serve the service worker script with no login: a worker script holds nothing secret, and the
 * browser's script fetch is not something a route should have to trust with a cookie. `no-cache`
 * makes each registration check for a newer plugin's worker.
 */
export async function servePushSw(_req, res) {
    res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
    });
    res.end(PUSH_SW_SOURCE);
}
/** The `/notify` blocks; state lives under STATE_DIR, the box's, whichever mount answers. */
export function notifyRoutes(c) {
    return async (req, res, url) => {
        const { ROUTE_PREFIX, json, readBody, log } = c;
        const base = `${ROUTE_PREFIX}/notify`;
        if (url.pathname === base) {
            if (req.method === "GET")
                return json(res, 200, await notifyState());
            if (req.method === "PUT") {
                const v = validateNotifyConfig(await readBody(req));
                if ("error" in v)
                    return json(res, 400, { error: serverText(v.error) });
                await writeNotifyConfig(STATE_DIR, v.config);
                return json(res, 200, await published());
            }
        }
        if (url.pathname === `${base}/push-key` && req.method === "GET")
            return json(res, 200, { publicKey: (await vapidKeys(STATE_DIR)).publicKey });
        if (url.pathname === `${base}/devices`) {
            if (req.method === "POST") {
                const device = validateDevice(await readBody(req));
                if (device === null)
                    return json(res, 400, { error: serverText("notifyBadDevice") });
                if (!(await addDevice(STATE_DIR, device)))
                    return json(res, 409, {
                        error: serverText("notifyTooManyDevices", { max: String(DEVICES_MAX) }),
                    });
                return json(res, 200, await published());
            }
            if (req.method === "DELETE") {
                const id = url.searchParams.get("id") ?? "";
                await removeDevices(STATE_DIR, new Set([id]));
                return json(res, 200, await published());
            }
        }
        if (url.pathname === `${base}/test` && req.method === "POST") {
            // The test ignores the switch and the delay: it is the person asking, right now.
            const report = await deliver(STATE_DIR, noteFor("test", null, undefined), log);
            return json(res, 200, report);
        }
        return UNHANDLED;
    };
}
//# sourceMappingURL=notify.js.map