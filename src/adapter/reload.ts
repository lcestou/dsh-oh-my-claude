// A hot reload of this plugin (a profile edit to its row, a toggle, a code update) disposes the
// plugin's cordis scope and applies a fresh instance, but dsh does not abort a model call already
// streaming from the old instance: dsh-llm looks the adapter up once per call, and the old
// generator keeps running until its step ends. The Claude process it reads lives on globalThis and
// survives; what does not is the old scope's context, whose injected services (`sessions`,
// `agents`, `approval`, ...) throw "cannot get required service ... in inactive context" from then
// on. These helpers let that instance find the context of the one that replaced it.
import { ADAPTER_CURRENT } from "../dsh.js";

/** The slice of a cordis context read here. Mirrors: @deepseek-ai/cordis `Fiber.uid`, which is
 *  null once the fiber is disposed. The suites' fake contexts carry no fiber. */
export interface ScopedContext {
  fiber?: { readonly uid: number | null };
}

/** Whether a plugin context can still reach dsh's services. A context without a fiber (a test fake)
 *  counts as active. Reads `uid` rather than the fiber's state, which is not "active" yet while the
 *  plugin's own `apply` runs, so a check on it would send a fresh instance to its predecessor. */
export function contextActive(ctx: ScopedContext): boolean {
  return ctx.fiber === undefined || ctx.fiber.uid !== null;
}

/** The instance mounted for `providerId` right now, from the registry `apply` keeps on globalThis;
 *  undefined before the first mount. */
export function mountedInstance<T>(providerId: string): T | undefined {
  // SAFETY: the registry symbol is this plugin's own key on globalThis, filled only by `apply` and
  // the SSH-box mounts with adapter instances, which is the T every caller names
  const g = globalThis as typeof globalThis & { [ADAPTER_CURRENT]?: Map<string, T> };
  return g[ADAPTER_CURRENT]?.get(providerId);
}

/** How long a step that died on a replaced instance waits for an active one to resume it, and how
 *  often it looks. A toggle off and on again can take a while; past this the busy mark stays and
 *  the next boot's nudge picks the session up. */
export const RELOAD_RESUME_EVERY_MS = 2000;
export const RELOAD_RESUME_TRIES = 90;
