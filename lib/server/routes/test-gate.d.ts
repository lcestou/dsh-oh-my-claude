import type { IncomingMessage, ServerResponse } from "node:http";
import type { JsonValue } from "../dsh.js";
import { type RouteHandler } from "./context.js";
/** What the group needs from the session routes. */
export interface TestGateRouteCtx {
    ROUTE_PREFIX: string;
    stateDir: string;
    json: (res: ServerResponse, status: number, value: object) => void;
    readBody: (req: IncomingMessage) => Promise<{
        [key: string]: JsonValue;
    }>;
}
/** The test gate group. Returns `UNHANDLED` when no block matched, so the dispatch tries the next. */
export declare function testGateRoutes(c: TestGateRouteCtx): RouteHandler;
