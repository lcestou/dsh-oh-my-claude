import type { LlmModelInfo, LlmResolvedModelInfo } from "@deepseek-ai/dsh-llm";
import { type FirstPartyProbe } from "../first-party.js";
import type { CliModel } from "../process.js";
import type { PickerSettings } from "../sessions.js";
/** The CLI's effort ladder, low to high; `readPickerSettings` validates `maxEffortLevel` against it. */
export declare const EFFORTS_ALL: readonly ["low", "medium", "high", "xhigh", "max"];
/** One effort level's capability flag, as the Models API reports it. */
type EffortLevelCaps = {
    supported?: boolean;
};
/** The effort capability block: an overall flag plus one flag per level. */
type EffortCaps = {
    supported?: boolean;
} & Partial<Record<(typeof EFFORTS_ALL)[number], EffortLevelCaps>>;
/** One picker row. `description` is dsh's own optional field, drawn under the name; only the CLI's
 *  rows carry one, and a row without one has no key, since dsh validates the shape it is given. */
interface CatalogModel {
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    efforts: readonly string[];
    description?: string;
    /** The Models API's `created_at`, as epoch ms; absent on a known or CLI row. Read by
     *  `mergeCatalog` to tell a model newer than the installed CLI from an old id it dropped. */
    createdAt?: number;
}
/** Build one KNOWN_MODELS row: the provider is always claude-code, so callers pass only the id, label, context window and efforts, filling description when given. */
declare const M: (id: string, label: string, contextWindow: number, efforts: readonly string[], description?: string) => CatalogModel;
export declare const KNOWN_MODELS: CatalogModel[];
/**
 * The Models API dates some ids (`claude-haiku-4-5-20251001`) and leaves others alone
 * (`claude-opus-5`), while the list above and the CLI's own picker use the undated form. The CLI
 * takes either, but dsh keys a model by its id: a lineup that spells the same model one way from
 * the API and another from this list retires the enabled one and offers a fresh unselected copy
 * every time the source changes. So an API id whose undated form is one we know is advertised
 * undated, and an id we do not know keeps whatever the API called it.
 */
export declare const stableModelId: (id: string) => string;
export declare const CATALOG_TTL_MS: number;
/** How long the first listing of a boot waits for the lineup probe (`probeCliModels`) before it
 *  answers from what it has. A cold `claude -p` answered `list_models` in about 1.3 s on 2.1.309
 *  (2026-10-23); the probe itself keeps going past this, and its answer serves the next listing. */
export declare const LINEUP_PROBE_WAIT_MS = 5000;
/** The lineup probe's command line: stream-json both ways, so a control request can be written and
 *  its answer read, and no transcript, since no prompt is ever sent to it. */
export declare const LINEUP_PROBE_ARGS: string[];
/** Parse a persisted catalog file. Anything malformed reads as empty, so the caller falls back. */
export declare function parseCatalogCache(text: string): ReturnType<typeof M>[];
/** One entry of the Anthropic Models API list, in the shape the picker uses. */
export declare function modelFromApi(m: {
    id?: string;
    display_name?: string;
    max_input_tokens?: number;
    capabilities?: {
        effort?: EffortCaps;
    };
    created_at?: string;
}): CatalogModel;
/** Load the stored windows once per process. A figure a session already reported this boot wins
 *  over the stored one; a malformed file is ignored and a non-positive figure skipped, never thrown. */
export declare const seedLiveWindows: () => Promise<void>;
/** Resolves once every window write asked for so far has landed; tests await it. Waits for the seed
 *  first, because a note queues its write only after the seed, in a callback that runs before this. */
export declare const flushLiveWindows: () => Promise<void>;
/** Whether a session reported this model's window since this process started. */
export declare const windowReportedThisBoot: (modelId: string) => boolean;
/** The liveWindows key: strip any ANSI codes and resolve to the stable id, so a window looked up by the CLI's raw model id matches the normalized one stored here. */
export declare const windowKey: (id: string) => string;
/** Claude Code's env flag for "the base URL is a proxy in front of Anthropic" (`Xo()` in 2.1.274). */
export declare const FIRST_PARTY_FLAG = "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL";
/** The base URL when it names a host the CLI does not treat as first-party, else undefined. The
 *  test is the CLI's own (`av()` in 2.1.274: `new URL(e).host` against `["api.anthropic.com"]`),
 *  `host` with its port included, so this fires exactly when the CLI demotes. */
export declare const proxyBaseUrl: (raw: string | undefined) => string | undefined;
/** Ask once per dsh process whether this box is first-party, memoised on globalThis (the adapter is built more than once at boot) and retried while unanswered, so a proxy still starting does not fail the turn. */
export declare const detectFirstParty: () => Promise<FirstPartyProbe>;
/** Record what a session answered. A missing or nonsense figure leaves the last good one standing. */
export declare const noteLiveWindow: (modelId: string | undefined, maxTokens: number | undefined) => void;
/** The context window a live session last reported for this model, which beats the catalog's
 *  figure because it is what this box's CLI actually runs with (a proxy can demote a 1M model to
 *  200k). Keyed by the stable id, so an alias and its dated spelling share one answer. Undefined
 *  until some session has reported it. */
export declare const liveWindowFor: (modelId: string) => number | undefined;
/**
 * The name a model gets when no API row or table row names it: `claude-opus-5-5` reads
 * "Claude Opus 5.5", in the spelling the API gives its own rows, so a model newer than this build
 * does not stand in the picker as the CLI's bare "Opus" beside "Claude Opus 5". Undefined for an id
 * outside the `claude-<family>-<version>` shape, which keeps the CLI's label. Wrong for a family
 * the API spells with more than one capital: none today.
 */
export declare const nameFromId: (id: string) => string | undefined;
/**
 * Drops the rows a `hiddenModels` entry names. An entry matches a row's id exactly or with a date
 * stamp after it (`claude-haiku-4-5` hides `claude-haiku-4-5-20251001`), never a longer version:
 * `claude-opus-5` leaves `claude-opus-5-5` in the picker. `default` is never hidden, and only the
 * picker changes: a session already on a hidden model keeps running.
 */
export declare const withoutHiddenModels: <T extends {
    id: string;
}>(rows: readonly T[], hidden: readonly string[]) => T[];
/** Merges the CLI's model rows into the catalog, giving each known model a single stable id and
 *  name so the picker offers the same lineup whether or not the CLI has yet learned the model's
 *  short spelling. */
export declare function mergeCatalog(cli: CliModel[], base: ReturnType<typeof M>[], picker?: PickerSettings): CatalogModel[];
/** Serves the model catalog from cache, fetching Anthropic's API when the cache is stale, and
 *  keeps the last good catalog on any failure so the picker never goes empty. */
export declare function getCatalog(fetchImpl?: typeof fetch, cli?: CliModel[], picker?: PickerSettings): Promise<CatalogModel[]>;
/** The provider-scoped half of a model entry; every Claude model takes text and images. */
export declare function modelInfo(provider: string, model: {
    id?: string;
    name?: string;
    description?: string;
}): LlmModelInfo;
/** Exact model metadata. `id` must echo the requested id: dsh-llm normalizeModelInfo rejects mismatches. */
export declare function resolveModelInfo(provider: string, modelId: string, models?: ReturnType<typeof M>[], cap?: (typeof EFFORTS_ALL)[number]): LlmResolvedModelInfo;
export {};
