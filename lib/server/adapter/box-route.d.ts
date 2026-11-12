import { type FirstPartyProbe } from "../first-party.js";
import { type Route, type RouteEnv } from "./routing.js";
/** What one box answered. */
export interface BoxRoute {
    /** The routing variables in force for a `claude` started there over ssh. */
    env: RouteEnv;
    /** The box states a context window of its own (a settings key or either CLI variable), which
     *  the plugin must not overrule with one of its own. */
    ownWindow: boolean;
    /** Whether the base URL reaches Anthropic, asked from the box. `undefined` when there is no
     *  proxy address to ask, the box has no `curl`, or the endpoint did not answer. */
    answer: FirstPartyProbe;
}
/** Runs `script` on `host` and answers its stdout, or `undefined` when the ssh or the script failed. */
export type BoxRunner = (host: string, script: string) => Promise<string | undefined>;
/**
 * The script that prints the three layers the far CLI merges, lowest first: the shell's own
 * variables, the user's settings.json, the managed file. Each part ends with a mark, so a
 * missing file is an empty part and a cut-off answer has too few marks to be read.
 */
export declare const boxEnvScript: (host: string) => string;
/** The script that asks `baseUrl` the first-party question from the box: no key, headers kept. */
export declare const boxProbeScript: (baseUrl: string) => string;
/**
 * Read `boxEnvScript`'s output. `undefined` when it is not whole (the ssh died halfway), so a
 * half answer is never taken for "no router". A settings file that does not parse counts as
 * silent, as it does for the CLI.
 */
export declare function parseBoxEnv(out: string): Pick<BoxRoute, "env" | "ownWindow"> | undefined;
/**
 * Read `boxProbeScript`'s output: header blocks, then the body. `undefined` for an empty answer
 * (no `curl`, a refused connection, a timeout), which is "not asked" rather than "not Anthropic".
 */
export declare function parseBoxProbe(out: string | undefined): FirstPartyProbe;
/** Ask `host` both questions now. `undefined` when the box could not be read at all. */
export declare function askBoxRoute(host: string, run?: BoxRunner): Promise<BoxRoute | undefined>;
/** The state of a box that answered, by the same rules as this box's own (`routeOf`). The
 *  "proxy reaches Anthropic" switch is not applied: it vouches for this box's proxy. */
export declare const boxRouteState: (box: BoxRoute) => Route;
/**
 * A box's answer for a caller that can wait: a turn about to start there. A kept answer is
 * returned at once, however old, and refreshed behind the caller once it is past
 * `PROBE_TTL_MS`, so only the first turn after a boot waits on the ssh. A router switched on
 * there is therefore seen by the turn after the next one at the latest.
 */
export declare function boxRouteOf(host: string, run?: BoxRunner, now?: number): Promise<BoxRoute | undefined>;
/**
 * The same for a caller that must not wait: a model listing. Answers what is kept, `undefined`
 * when nothing is, and asks behind the caller when that is missing or old; `changed` is called
 * when the box then says something else, so the caller can list again.
 */
export declare function boxRouteKnown(host: string, changed: () => void, run?: BoxRunner, now?: number): BoxRoute | undefined;
/** Forget every kept answer; tests start from an empty store. */
export declare const forgetBoxRoutes: () => void;
