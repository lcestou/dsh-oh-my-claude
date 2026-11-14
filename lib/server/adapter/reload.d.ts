/** The slice of a cordis context read here. Mirrors: @deepseek-ai/cordis `Fiber.uid`, which is
 *  null once the fiber is disposed. The suites' fake contexts carry no fiber. */
export interface ScopedContext {
    fiber?: {
        readonly uid: number | null;
    };
}
/** Whether a plugin context can still reach dsh's services. A context without a fiber (a test fake)
 *  counts as active. Reads `uid` rather than the fiber's state, which is not "active" yet while the
 *  plugin's own `apply` runs, so a check on it would send a fresh instance to its predecessor. */
export declare function contextActive(ctx: ScopedContext): boolean;
/** The instance mounted for `providerId` right now, from the registry `apply` keeps on globalThis;
 *  undefined before the first mount. */
export declare function mountedInstance<T>(providerId: string): T | undefined;
/** How long a step that died on a replaced instance waits for an active one to resume it, and how
 *  often it looks. A toggle off and on again can take a while; past this the busy mark stays and
 *  the next boot's nudge picks the session up. */
export declare const RELOAD_RESUME_EVERY_MS = 2000;
export declare const RELOAD_RESUME_TRIES = 90;
