import type { JsonReply } from "../sessions.js";
import type { IncomingMessage } from "node:http";
import type { JsonValue } from "../dsh.js";
import type { RouteHandler } from "./context.js";
/** What the group needs from the session routes. */
export interface TestGateRouteCtx {
    ROUTE_PREFIX: string;
    stateDir: string;
    json: JsonReply;
    readBody: (req: IncomingMessage) => Promise<{
        [key: string]: JsonValue;
    }>;
}
/** The test gate group. Returns `UNHANDLED` when no block matched, so the dispatch tries the next. */
export declare function testGateRoutes(c: TestGateRouteCtx): RouteHandler;
