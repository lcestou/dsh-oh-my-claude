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
/**
 * Read the roster out of the merged scopes, highest precedence first.
 *
 * `enabledPlugins` is per key and first-wins, which is the CLI's own precedence for it
 * (user < project < local < policy, so the highest file naming a plugin decides it).
 * `additionalMarketplaces` is read as `extraKnownMarketplaces`, except in a file that spells both,
 * where the CLI ignores the alias with a warning.
 */
export declare function pluginRoster(scopes: readonly ScopeText[]): PluginRoster;
