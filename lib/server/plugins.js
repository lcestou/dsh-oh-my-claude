import { parseSettings } from "./switches.js";
const object = (value) => {
    if (!(value instanceof Object) || Array.isArray(value))
        return null;
    // SAFETY: the guard above leaves only the object arm of JsonValue, whose values are JsonValue.
    return value;
};
/** What the panel shows for a value that is neither `true` nor `false`. */
const extended = (value) => {
    if (String(value) === value)
        return { enabled: true, detail: value };
    const fields = object(value);
    // An extended entry can still say it is off; anything else with a shape is on, which is what the
    // key means, and the raw value is shown so an unfamiliar spelling is readable rather than lost.
    const enabled = fields?.enabled !== false;
    const version = fields?.version;
    return { enabled, detail: String(version) === version ? version : JSON.stringify(value) };
};
/**
 * A marketplace source read back as one line: `github:owner/repo`, `directory:/path`, `skills-dir`.
 * The entry the CLI writes wraps the descriptor under a `source` key
 * (`{ source: { source: "github", repo: "..." } }`), so a `source` that is itself an object is
 * unwrapped one level before the kind and location are read off it.
 */
const sourceLine = (value) => {
    if (String(value) === value)
        return value;
    const outer = object(value);
    if (outer === null)
        return JSON.stringify(value);
    const descriptor = object(outer.source) ?? outer;
    const kind = descriptor.source;
    const where = descriptor.repo ?? descriptor.url ?? descriptor.path;
    const kindText = String(kind) === kind ? kind : JSON.stringify(descriptor);
    return String(where) === where ? `${kindText}:${where}` : kindText;
};
/**
 * Read the roster out of the merged scopes, highest precedence first.
 *
 * `enabledPlugins` is per key and first-wins, which is the CLI's own precedence for it
 * (user < project < local < policy, so the highest file naming a plugin decides it).
 * `additionalMarketplaces` is read as `extraKnownMarketplaces`, except in a file that spells both,
 * where the CLI ignores the alias with a warning.
 */
export function pluginRoster(scopes) {
    const plugins = new Map();
    const marketplaces = new Map();
    for (const { scope, text } of scopes) {
        const settings = parseSettings(text);
        const enabled = object(settings.enabledPlugins);
        for (const [key, value] of Object.entries(enabled ?? {})) {
            if (plugins.has(key))
                continue;
            if (value === true || value === false)
                plugins.set(key, { key, enabled: value, scope });
            else
                plugins.set(key, { key, ...extended(value), scope });
        }
        const named = object(settings.extraKnownMarketplaces);
        const aliased = named === null ? object(settings.additionalMarketplaces) : null;
        for (const [name, value] of Object.entries(named ?? aliased ?? {})) {
            if (marketplaces.has(name))
                continue;
            const row = { name, source: sourceLine(value), scope };
            if (aliased !== null)
                row.alias = true;
            marketplaces.set(name, row);
        }
    }
    return {
        plugins: [...plugins.values()].toSorted((a, b) => a.key.localeCompare(b.key)),
        marketplaces: [...marketplaces.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
    };
}
//# sourceMappingURL=plugins.js.map