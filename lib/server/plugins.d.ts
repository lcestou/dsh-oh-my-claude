import { type ScopeText } from "./switches.js";
/** One `enabledPlugins` entry, keyed `plugin-id@marketplace-id`. */
export interface PluginRow {
    key: string;
    enabled: boolean;
    /** A version constraint or another extended value, as written. Absent for a plain boolean. */
    detail?: string;
    /** The scope whose value decided it; a lower file naming the same key changed nothing. */
    scope: string;
}
/** One `extraKnownMarketplaces` entry: a name and the source it vouches for. */
export interface MarketplaceRow {
    name: string;
    source: string;
    scope: string;
    /** Written as `additionalMarketplaces`, the alias the CLI reads as this key. */
    alias?: boolean;
}
export interface PluginRoster {
    plugins: PluginRow[];
    marketplaces: MarketplaceRow[];
}
/** The scopes `claude plugin` writes to; same set the MCP tab uses, named for this surface. */
export declare const PLUGIN_SCOPES: readonly ["user", "project", "local"];
export type PluginScope = (typeof PLUGIN_SCOPES)[number];
export declare const isPluginScope: (value: unknown) => value is PluginScope;
/** `user` is global; `project` and `local` write into the session's directory. */
export declare const pluginScopeNeedsCwd: (scope: PluginScope) => boolean;
/**
 * A plugin id as the roster keys it (`name` or `name@marketplace`). The CLI takes it as one argv
 * word, so a leading dash would read as a flag and a space would be two words; the characters
 * allowed are what a plugin and marketplace id are spelled from.
 */
export declare const isPluginId: (value: unknown) => value is string;
/**
 * A marketplace source for `marketplace add`: a URL, a path, or a GitHub `owner/repo`. The CLI
 * resolves and validates it (a path that does not exist is refused there); this only stops a value
 * the shell would read as a flag or an empty one.
 */
export declare const isMarketplaceSource: (value: unknown) => value is string;
/**
 * Read the roster out of the merged scopes, highest precedence first.
 *
 * `enabledPlugins` is per key and first-wins, which is the CLI's own precedence for it
 * (user < project < local < policy, so the highest file naming a plugin decides it).
 * `additionalMarketplaces` is read as `extraKnownMarketplaces`, except in a file that spells both,
 * where the CLI ignores the alias with a warning.
 */
export declare function pluginRoster(scopes: readonly ScopeText[]): PluginRoster;
