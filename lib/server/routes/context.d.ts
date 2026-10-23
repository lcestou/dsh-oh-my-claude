import type { IncomingMessage, ServerResponse } from "node:http";
/** Returned by a route group when none of its blocks matched the request. Every other return,
 *  including the `undefined` that `json()` gives, means a block answered. */
export declare const UNHANDLED: unique symbol;
/** One group of session routes: its blocks, verbatim and in order, ending in `UNHANDLED`. */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<typeof UNHANDLED | void>;
