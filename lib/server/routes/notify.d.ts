import type { IncomingMessage, ServerResponse } from "node:http";
import { type RouteHandler } from "./context.js";
import type { RouteCtx } from "../sessions.js";
import { deviceRows } from "../notify-store.js";
/** The worker's path. Its scope is its own folder, which covers no dsh page: push and
 *  notificationclick need no controlled page, so the worker never sits between dsh and its tabs. */
export declare const PUSH_SW_PATH = "/dsh-oh-my-claude/push/sw.js";
/** What `GET /notify` answers and every write answers with. */
export interface NotifyState {
    webhookUrl: string | null;
    openUrl: string | null;
    devices: ReturnType<typeof deviceRows>;
}
/**
 * Serve the service worker script with no login: a worker script holds nothing secret, and the
 * browser's script fetch is not something a route should have to trust with a cookie. `no-cache`
 * makes each registration check for a newer plugin's worker.
 */
export declare function servePushSw(_req: IncomingMessage, res: ServerResponse): Promise<void>;
/** The `/notify` blocks; state lives under STATE_DIR, the box's, whichever mount answers. */
export declare function notifyRoutes(c: RouteCtx): RouteHandler;
