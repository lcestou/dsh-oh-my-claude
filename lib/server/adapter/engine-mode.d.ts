import type { Config } from "./config.js";
/** Hints-store key of the card's master switch. Off (absent), no session runs in engine mode, and
 *  the presets ticked under it are kept for when it is turned back on. */
export declare const ENGINE_ON_KEY = "engineOn";
/** Hints-store key that turns engine mode on for one preset: `enginePreset:<preset id>`. */
export declare const ENGINE_PRESET_PREFIX = "enginePreset:";
/** Hints-store prefix of the keys that leave one engine option out for one preset. */
export declare const ENGINE_SKIP_PREFIX = "engineSkip:";
/** The hints-store key that leaves `option` out for `preset`: `engineSkip:<preset id>:<option>`.
 *  Each preset has its own set, and every option applies until skipped, so ticking a preset gives
 *  the whole bundle and its boxes take things away. */
export declare const engineSkipKey: (option: EngineOption, preset: string) => string;
/** The config keys engine mode sets, in the order Settings lists them. */
export declare const ENGINE_OPTIONS: readonly ["systemPrompt", "builtinTools", "toolLoading", "followToolSet", "verbatimPrompts", "isolate", "thinkingDisplay"];
/** One of the config keys engine mode sets. */
export type EngineOption = (typeof ENGINE_OPTIONS)[number];
/** The part of the plugin's config engine mode reads and writes. */
type EngineKeys = Pick<Config, EngineOption>;
/** The preset ids engine mode is on for, read off the hints store's `enginePreset:` keys. */
export declare function enginePresets(hints: Readonly<Record<string, boolean | number>>): string[];
/**
 * The config a session under `preset` runs on: the plugin's own `config` when the master switch
 * is off, when engine mode is off for that preset, or when the session has none (or the preset
 * service is missing); else a copy with
 * every option the preset's own skips leave in set to its engine value. The same object comes back when
 * nothing applies, so a caller can tell the two apart by identity.
 */
export declare function engineOverlay<T extends EngineKeys>(config: T, hints: Readonly<Record<string, boolean | number>>, preset: string | null | undefined): T;
export {};
