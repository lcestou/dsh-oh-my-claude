// What the session route groups share: the marker a group returns when no block matched, and the
// shape of one group. sessions.ts builds the groups and dispatches to them in the chain's order.
import type { IncomingMessage, ServerResponse } from "node:http";

/** Returned by a route group when none of its blocks matched the request. Every other return,
 *  including the `undefined` that `json()` gives, means a block answered. */
export const UNHANDLED: unique symbol = Symbol("unhandled");

/** One group of session routes: its blocks, verbatim and in order, ending in `UNHANDLED`. */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => Promise<typeof UNHANDLED | void>;
