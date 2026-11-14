/** Hints-store key that turns engine mode on for one preset: `enginePreset:<preset id>`. */
export const ENGINE_PRESET_PREFIX = "enginePreset:";
/** Hints-store prefix of the keys that leave one engine option out for one preset. */
export const ENGINE_SKIP_PREFIX = "engineSkip:";
/** The hints-store key that leaves `option` out for `preset`: `engineSkip:<preset id>:<option>`.
 *  Each preset has its own set, and every option applies until skipped, so ticking a preset gives
 *  the whole bundle and its boxes take things away. */
export const engineSkipKey = (option, preset) => `${ENGINE_SKIP_PREFIX}${preset}:${option}`;
/** The config keys engine mode sets, in the order Settings lists them. */
export const ENGINE_OPTIONS = [
    "systemPrompt",
    "builtinTools",
    "toolLoading",
    "followToolSet",
    "verbatimPrompts",
    "isolate",
    "thinkingDisplay",
];
/** What each option is set to in engine mode. `builtinTools: ["ToolSearch"]` leaves Claude Code
 *  none of its own file or shell tools, so dsh's are served over the bridge in their place. */
const ENGINE_VALUES = {
    systemPrompt: "dsh",
    builtinTools: ["ToolSearch"],
    toolLoading: "dsh",
    followToolSet: true,
    verbatimPrompts: true,
    isolate: true,
    thinkingDisplay: "summarized",
};
/** The preset ids engine mode is on for, read off the hints store's `enginePreset:` keys. */
export function enginePresets(hints) {
    return Object.keys(hints)
        .filter((k) => k.startsWith(ENGINE_PRESET_PREFIX) && hints[k] === true)
        .map((k) => k.slice(ENGINE_PRESET_PREFIX.length));
}
/**
 * The config a session under `preset` runs on: the plugin's own `config` when engine mode is off
 * for that preset (or the session has none, or the preset service is missing), else a copy with
 * every option the preset's own skips leave in set to its engine value. The same object comes back when
 * nothing applies, so a caller can tell the two apart by identity.
 */
export function engineOverlay(config, hints, preset) {
    if (!preset || hints[ENGINE_PRESET_PREFIX + preset] !== true)
        return config;
    const skip = (k) => hints[engineSkipKey(k, preset)] === true;
    const out = { ...config };
    // Written through the engine-keys view of the copy: the copy is a T, and T's own key types may be
    // narrower than the values engine mode sets.
    const set = out;
    if (!skip("systemPrompt"))
        set.systemPrompt = ENGINE_VALUES.systemPrompt;
    if (!skip("builtinTools"))
        set.builtinTools = [...ENGINE_VALUES.builtinTools];
    if (!skip("toolLoading"))
        set.toolLoading = ENGINE_VALUES.toolLoading;
    if (!skip("followToolSet"))
        set.followToolSet = ENGINE_VALUES.followToolSet;
    if (!skip("verbatimPrompts"))
        set.verbatimPrompts = ENGINE_VALUES.verbatimPrompts;
    if (!skip("isolate"))
        set.isolate = ENGINE_VALUES.isolate;
    if (!skip("thinkingDisplay"))
        set.thinkingDisplay = ENGINE_VALUES.thinkingDisplay;
    return out;
}
//# sourceMappingURL=engine-mode.js.map