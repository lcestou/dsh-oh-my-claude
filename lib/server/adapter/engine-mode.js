// Engine mode per agent preset: sessions started under a preset the owner picked in Settings run
// Claude Code as dsh's model engine (dsh's prompt and tools, none of the user's Claude settings),
// and every other session keeps the plugin's config as it is. The choice is box-wide state in the
// hints store, read each turn. dsh fixes a session's preset once it has a message, so a session
// moves in or out of engine mode only when its preset's tick changes, at its next turn. From
// @soffits's engine options (#286, #287).
import { asSessionId } from "../dsh.js";
/** Hints-store key of the card's master switch. Off (absent), no session runs in engine mode, and
 *  the presets ticked under it are kept for when it is turned back on. */
export const ENGINE_ON_KEY = "engineOn";
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
/** Whether engine mode is on for a session under `preset`: the master switch and that preset's tick
 *  both set. False for no preset, so a dsh without the preset service never runs engine mode. */
function engineOn(hints, preset) {
    return !!preset && hints[ENGINE_ON_KEY] === true && hints[ENGINE_PRESET_PREFIX + preset] === true;
}
/** Whether engine mode sends dsh's system prompt for a session under `preset`: on for the preset,
 *  and its `systemPrompt` box not cleared. The chat's row mask asks this, beside the mount's own
 *  `systemPrompt`, to tell whether dsh's "System prompt" row reached Claude. */
export function engineSendsDshPrompt(hints, preset) {
    return engineOn(hints, preset) && hints[engineSkipKey("systemPrompt", preset)] !== true;
}
/** The agent preset `sessionId` runs under, from dsh's preset service; null when the session is not
 *  loaded, this dsh mounts no preset service, or the lookup throws. */
export function presetOfSession(ctx, sessionId) {
    try {
        const session = ctx?.sessions?.get?.(asSessionId(sessionId));
        return session ? (ctx?.get?.("agentPresets")?.presetForSession(session) ?? null) : null;
    }
    catch {
        return null;
    }
}
/** The preset ids engine mode is on for, read off the hints store's `enginePreset:` keys. */
export function enginePresets(hints) {
    return Object.keys(hints)
        .filter((k) => k.startsWith(ENGINE_PRESET_PREFIX) && hints[k] === true)
        .map((k) => k.slice(ENGINE_PRESET_PREFIX.length));
}
/**
 * The config a session under `preset` runs on: the plugin's own `config` when the master switch
 * is off, when engine mode is off for that preset, or when the session has none (or the preset
 * service is missing); else a copy with
 * every option the preset's own skips leave in set to its engine value. The same object comes back when
 * nothing applies, so a caller can tell the two apart by identity.
 */
export function engineOverlay(config, hints, preset) {
    if (!engineOn(hints, preset))
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