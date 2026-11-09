// dsh's Plugins page as somewhere the plugin can send a person: its page for this plugin carries
// dsh's own Update button, which installs a newer release with dsh's checks and rollback. dsh's
// plugin manager provides the `pluginNavigation` service that opens it; a dsh without that plugin
// has none, so the opener is undefined then and callers fall back to what they did before.
import { useSyncExternalStore } from "react";
import type { ClientCtx, PluginNavigation } from "./shared.js";

/** The npm name dsh lists this plugin under, which is what `openBundle` looks it up by. */
export const PACKAGE_NAME = "dsh-oh-my-claude";

/** Opens this plugin's page in dsh's Plugins panel, or undefined while dsh offers no navigation. */
type Opener = (() => void) | undefined;
let opener: Opener;
const listeners = new Set<() => void>();
/** Tells every mounted pill the opener came or went. */
const changed = () => {
  for (const l of listeners) l();
};

/** Follow the `pluginNavigation` service for the life of this context: the opener exists exactly
 *  while dsh provides the service, so a pill drawn before the plugin manager loads (or after it is
 *  turned off) offers what it can do then. A ctx without `inject` (a test fake) never gets one. */
export function watchPluginsPage(ctx: ClientCtx): void {
  ctx.inject?.(["pluginNavigation"], (scope) => {
    scope.effect(() => {
      // Read at click time, not captured: a hot reload of the plugin manager swaps the service.
      opener = () => ctx.get?.<PluginNavigation>("pluginNavigation")?.openBundle(PACKAGE_NAME);
      changed();
      return () => {
        opener = undefined;
        changed();
      };
    });
  });
}

/** The opener right now: the snapshot `usePluginsPage` renders from. */
export const pluginsPageOpener = (): Opener => opener;

/** Calls `fn` whenever the opener comes or goes; returns the unsubscribe. */
export function onPluginsPageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The opener as React state, so a pill re-renders when dsh's navigation appears or goes. */
export function usePluginsPage(): Opener {
  return useSyncExternalStore(onPluginsPageChange, pluginsPageOpener);
}
