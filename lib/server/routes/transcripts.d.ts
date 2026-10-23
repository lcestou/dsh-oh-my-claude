import { type RouteHandler } from "./context.js";
import type { RouteCtx } from "../sessions.js";
/** The transcripts group of the session routes, built once per registration. Returns `UNHANDLED` when no
 *  block matched, so the dispatch tries the next group; any other return means a block answered. */
export declare function transcriptsRoutes(c: RouteCtx): RouteHandler;
