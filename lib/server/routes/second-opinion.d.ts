import { type RouteHandler } from "./context.js";
import type { RouteCtx } from "../sessions.js";
/** The second-opinion group of the session routes. Returns `UNHANDLED` when no block matched. Takes
 *  only the four fields it reads, so its test builds them without a whole route context. */
export declare function secondOpinionRoutes(c: Pick<RouteCtx, "ROUTE_PREFIX" | "ctx" | "json" | "readBody">): RouteHandler;
