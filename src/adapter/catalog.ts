// The model ladder, the baked-in model list, the on-disk catalog cache and how a model id resolves.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LlmModelInfo, LlmResolvedModelInfo, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { type FirstPartyProbe, probeFirstParty } from "../first-party.js";
import { serverText } from "../locale.js";
import type { CliModel } from "../process.js";
import type { PickerSettings } from "../sessions.js";
import { authHeaders, CLAUDE_HOME, STATE_DIR } from "../state.js";

/** The CLI's effort ladder, low to high; `readPickerSettings` validates `maxEffortLevel` against it. */
export const EFFORTS_ALL = ["low", "medium", "high", "xhigh", "max"] as const;
/** Trim an efforts list to those at or below `cap`. `"max"` and an absent cap keep everything.
 *  An id outside the ladder (a future level this build does not know) is left in, never hidden. */
function capEfforts(efforts: readonly string[], cap?: (typeof EFFORTS_ALL)[number]): string[] {
  if (cap === undefined || cap === "max") return [...efforts];
  const ceiling = EFFORTS_ALL.indexOf(cap);
  return efforts.filter((e) => {
    const i = EFFORTS_ALL.findIndex((level) => level === e);
    return i === -1 || i <= ceiling;
  });
}
/** One effort level's capability flag, as the Models API reports it. */
type EffortLevelCaps = { supported?: boolean };
/** The effort capability block: an overall flag plus one flag per level. */
type EffortCaps = { supported?: boolean } & Partial<
  Record<(typeof EFFORTS_ALL)[number], EffortLevelCaps>
>;
const EFFORTS_45 = ["low", "medium", "high"];
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
const M = (
  id: string,
  label: string,
  contextWindow: number,
  efforts: readonly string[],
  description?: string,
): CatalogModel => {
  const row: CatalogModel = { provider: "claude-code", id, name: label, contextWindow, efforts };
  if (description !== undefined) row.description = description;
  return row;
};

// The floor a brand-new box falls back to when the Models API is unreachable and no catalog has
// ever been cached to disk yet. Once a fetch succeeds its result is persisted and seeds later boots,
// so this list only matters on the first offline boot. Ids are what `claude --model` accepts.
//
// The window here is the one the CLI manages a session against on a first-party login, read off
// Claude Code 2.1.274's own model table (`context:{window:1e6,native_1m:!0}` for Fable 5.1, Fable 5,
// Opus 5, Opus 4.8, Opus 4.7 and Sonnet 5; `window:200000` for the rest). Behind a proxy the CLI
// demotes every 1M row to 200,000 (`dXn`: "declared 1M, believed 200k" unless the base URL is
// api.anthropic.com or `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` is set), and `contextUsage`
// reports that as `assumedBehind`. Any figure here is a guess until a session answers;
// `liveWindows` below replaces it with what the CLI reports.
export const KNOWN_MODELS = [
  M("claude-fable-5-1", "Claude Fable 5.1", 1_000_000, EFFORTS_ALL),
  M("claude-fable-5", "Claude Fable 5", 1_000_000, EFFORTS_ALL),
  M("claude-opus-5", "Claude Opus 5", 1_000_000, EFFORTS_ALL),
  M("claude-opus-4-8", "Claude Opus 4.8", 1_000_000, EFFORTS_ALL),
  M("claude-opus-4-7", "Claude Opus 4.7", 1_000_000, EFFORTS_ALL),
  M("claude-opus-4-6", "Claude Opus 4.6", 200_000, ["low", "medium", "high", "max"]),
  M("claude-sonnet-5", "Claude Sonnet 5", 1_000_000, EFFORTS_ALL),
  M("claude-sonnet-4-6", "Claude Sonnet 4.6", 200_000, ["low", "medium", "high", "max"]),
  M("claude-opus-4-5", "Claude Opus 4.5", 200_000, EFFORTS_45),
  M("claude-sonnet-4-5", "Claude Sonnet 4.5", 200_000, []),
  M("claude-haiku-4-5", "Claude Haiku 4.5", 200_000, []),
];

/**
 * The Models API dates some ids (`claude-haiku-4-5-20251001`) and leaves others alone
 * (`claude-opus-5`), while the list above and the CLI's own picker use the undated form. The CLI
 * takes either, but dsh keys a model by its id: a lineup that spells the same model one way from
 * the API and another from this list retires the enabled one and offers a fresh unselected copy
 * every time the source changes. So an API id whose undated form is one we know is advertised
 * undated, and an id we do not know keeps whatever the API called it.
 */
export const stableModelId = (id: string): string => {
  const bare = id.replace(/-\d{8}$/, "");
  return bare !== id && KNOWN_MODELS.some((m) => m.id === bare) ? bare : id;
};

// ---------------------------------------------------------------------------
// Model catalog

export const CATALOG_TTL_MS = 10 * 60 * 1000;
let catalog = { at: 0, models: KNOWN_MODELS };

/** Where the last catalog the API gave us is kept, so a boot with the API down still lists the real
 *  models instead of the baked-in floor. Written on every successful fetch, read once per process. */
/** Path to the on-disk catalog cache. Honors DSH_OMC_STATE_DIR so a test can aim it at an empty
 *  dir and exercise the offline floor without depending on whatever this box has cached. */
const catalogCachePath = () => join(process.env.DSH_OMC_STATE_DIR ?? STATE_DIR, "models.json");
let diskSeeded = false;
/** The shape a cached row must still hold. The cache is our own write, but a truncated or hand-edited
 *  file must never slip a malformed row into the catalog dsh validates, so it is re-parsed on read. */
const CachedCatalog = z.array(
  z.object({
    provider: z.const("claude-code"),
    id: z.string(),
    name: z.string(),
    contextWindow: z.number(),
    efforts: z.array(z.string()),
    createdAt: z.number(),
  }),
);
/** Parse a persisted catalog file. Anything malformed reads as empty, so the caller falls back. */
export function parseCatalogCache(text: string): ReturnType<typeof M>[] {
  try {
    return CachedCatalog(JSON.parse(text))
      .filter((r) => r.id.length > 0 && r.name.length > 0)
      .map((r) => {
        const row = M(r.id, r.name, r.contextWindow, r.efforts);
        if (r.createdAt !== undefined) row.createdAt = r.createdAt;
        return row;
      });
  } catch {
    return [];
  }
}
/** Seed the in-memory catalog from disk once, unless a live fetch has already replaced it. `at`
 *  stays 0 so the next `getCatalog` still tries the API; the disk copy only survives a failed fetch. */
async function seedFromDisk() {
  if (diskSeeded) return;
  diskSeeded = true;
  if (catalog.at !== 0) return;
  try {
    const rows = parseCatalogCache(await readFile(catalogCachePath(), "utf8"));
    if (rows.length > 0 && catalog.at === 0) catalog = { at: 0, models: rows };
  } catch {
    /* no cache yet or unreadable: the KNOWN_MODELS floor stays */
  }
}
/** Persist a fetched catalog for later boots. Best effort: a write that fails just misses the seed. */
async function persistCatalog(models: ReturnType<typeof M>[]) {
  try {
    const path = catalogCachePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(models));
  } catch {
    /* read-only state dir or full disk: fall through, the fetch still served this boot */
  }
}

/** One entry of the Anthropic Models API list, in the shape the picker uses. */
export function modelFromApi(m: {
  id?: string;
  display_name?: string;
  max_input_tokens?: number;
  capabilities?: { effort?: EffortCaps };
  created_at?: string;
}): CatalogModel {
  const eff = m.capabilities?.effort;
  const efforts: string[] = eff?.supported ? EFFORTS_ALL.filter((l) => eff[l]?.supported) : [];
  const id = stableModelId(m.id ?? "");
  const row = M(id, m.display_name ?? id, m.max_input_tokens ?? 200_000, efforts);
  const created = m.created_at ? Date.parse(m.created_at) : Number.NaN;
  if (!Number.isNaN(created)) row.createdAt = created;
  return row;
}

/**
 * The CLI's own picker (`list_models`, asked of the first live process each boot) goes first:
 * its values are what `claude --model` accepts for this login, aliases such as `default` and the
 * `[1m]` variants included. API and known models it does not already cover follow, so older
 * ids stored in dsh sessions keep resolving.
 *
 * Then settings.json gets the say the terminal gives it, in the CLI's own order: `modelPicker`
 * rows are appended after that lineup, `replaceBuiltInOptions` cuts the lineup back to Default,
 * and `availableModels` filters whatever is left. Default always survives, an absent allowlist
 * filters nothing and an empty one leaves Default alone.
 */
const strip = (id: string) => (id.endsWith("[1m]") ? id.slice(0, -4) : id);
/** An allowlist entry and a model id meet in one shape: no `claude-` prefix, no `[1m]` suffix. */
const bareId = (id: string) => {
  const s = strip(id);
  return s.startsWith("claude-") ? s.slice("claude-".length) : s;
};

/**
 * The window a live session reported, which outranks every guess this file makes.
 *
 * Both sources above answer a different question than the one dsh's context ring asks. The Models
 * API sends `max_input_tokens` and `KNOWN_MODELS` is a baked-in copy of the same figure: what the
 * model can hold. What the ring needs is what the CLI manages the session against, and the two part
 * company. Opus 5 holds a million and runs at 200,000 until 1M is turned on. Only a session knows
 * which it got, so the figure is taken from that session's own `get_context_usage` and kept per
 * model id for every later read.
 *
 * Not persisted: a dsh-web restart relearns on the first context read of each model, and until then
 * the table above answers. Write it next to the catalog cache the day that gap is worth a file.
 */
const liveWindows = new Map<string, number>();

/** The liveWindows key: strip any ANSI codes and resolve to the stable id, so a window looked up by the CLI's raw model id matches the normalized one stored here. */
export const windowKey = (id: string) => stableModelId(strip(id));
/** Claude Code's env flag for "the base URL is a proxy in front of Anthropic" (`Xo()` in 2.1.274). */
export const FIRST_PARTY_FLAG = "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL";
/** The base URL when it names a host the CLI does not treat as first-party, else undefined. The
 *  test is the CLI's own (`av()` in 2.1.274: `new URL(e).host` against `["api.anthropic.com"]`),
 *  `host` with its port included, so this fires exactly when the CLI demotes. */
export const proxyBaseUrl = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  try {
    return new URL(raw).host === "api.anthropic.com" ? undefined : raw;
  } catch {
    return raw;
  }
};
/**
 * Whether this box's base URL reaches Anthropic, asked once per dsh process.
 *
 * On the process rather than on the adapter: dsh builds the adapter more than once at boot, and
 * the question is about the box, not about an instance. The promise is memoised, not its answer,
 * so the turns that start while the first request is in flight all wait on that one request.
 * An unanswered probe is retried by the next turn, since a proxy that was still starting up is
 * the likeliest reason for it.
 */
const FIRST_PARTY_PROBE = Symbol.for("dsh-oh-my-claude.firstPartyProbe");

/** Ask once per dsh process whether this box is first-party, memoised on globalThis (the adapter is built more than once at boot) and retried while unanswered, so a proxy still starting does not fail the turn. */
export const detectFirstParty = async (): Promise<FirstPartyProbe> => {
  const baseUrl = proxyBaseUrl(process.env.ANTHROPIC_BASE_URL);
  if (!baseUrl) return false; // no proxy in front: the flag changes nothing either way
  // SAFETY: this plugin's own key on globalThis, typed here once, as the timers below are
  const store = globalThis as typeof globalThis & {
    [FIRST_PARTY_PROBE]?: Promise<FirstPartyProbe>;
  };
  const asked = (store[FIRST_PARTY_PROBE] ??= probeFirstParty(baseUrl));
  const answer = await asked;
  if (answer === undefined) store[FIRST_PARTY_PROBE] = undefined;
  return answer;
};

/** Record what a session answered. A missing or nonsense figure leaves the last good one standing. */
export const noteLiveWindow = (modelId: string | undefined, maxTokens: number | undefined) => {
  if (modelId === undefined || maxTokens === undefined || !Number.isFinite(maxTokens)) return;
  if (maxTokens <= 0) return;
  liveWindows.set(windowKey(modelId), maxTokens);
};
/** The context window a live session last reported for this model, which beats the catalog's
 *  figure because it is what this box's CLI actually runs with (a proxy can demote a 1M model to
 *  200k). Keyed by the stable id, so an alias and its dated spelling share one answer. Undefined
 *  until some session has reported it. */
export const liveWindowFor = (modelId: string): number | undefined =>
  liveWindows.get(windowKey(modelId));
/** The three forms an entry takes: a family alias, a version prefix, or the whole id. */
const allows = (entry: string, id: string) => {
  const want = bareId(entry);
  const have = bareId(id);
  return have === want || have.startsWith(`${want}-`);
};
/** Merges the CLI's model rows into the catalog, giving each known model a single stable id and
 *  name so the picker offers the same lineup whether or not the CLI has yet learned the model's
 *  short spelling. */
export function mergeCatalog(
  cli: CliModel[],
  base: ReturnType<typeof M>[],
  picker?: PickerSettings,
) {
  if (cli.length === 0 && !picker) return base;
  // A CLI row is keyed by an alias (`opus`, `default`), so each row carries the id the allowlist reads.
  const fromCli = cli.map((c) => {
    const bare = strip(c.resolvedModel);
    const known = base.find((b) => bare === b.id || bare.startsWith(b.id));
    const window = c.resolvedModel.endsWith("[1m]") ? 1_000_000 : (known?.contextWindow ?? 200_000);
    // The CLI is asked for its picker once a process is live, so before that answer the lineup
    // spells a model `claude-haiku-4-5` and after it `haiku`. Anything holding an id across that
    // moment, a dsh subagent allowlist or a stored session model, reads the other spelling as a
    // model that is gone. A row landing on a model this catalog already knows takes that model's
    // id, so both states offer the same ids; `default` and a `[1m]` variant have none to take.
    const stable =
      c.value === "default" || c.resolvedModel.endsWith("[1m]") ? undefined : known?.id;
    // The CLI names its rows for a terminal picker that shows nothing else ("Opus (1M context)",
    // "Fable", "Sonnet"), and the known rows that follow here read "Claude Opus 5"; two spellings
    // in one menu read as two lineups (owner, 2026-09-16). A row landing on a known model takes
    // that model's name, with the window named the way the CLI names it; Default keeps its own.
    const label =
      c.value === "default" || known === undefined
        ? c.displayName
        : `${known.name}${c.resolvedModel.endsWith("[1m]") ? " (1M context)" : ""}`;
    return {
      row: M(stable ?? c.value, label, window, c.efforts, c.description),
      match: c.resolvedModel,
    };
  });
  // A known model follows unless a CLI row already carries its exact id. A `[1m]` variant or the
  // `default` alias resolving to it keeps its own id, so it does not cover the plain one: a session
  // bound to `claude-fable-5-1` must still find that row, or the picker shows the raw id and an
  // empty menu (seen 2026-09-10, when the CLI's lineup offered only `claude-fable-5-1[1m]`).
  const emitted = new Set(fromCli.map((r) => r.row.id));
  // A model the API lists that the CLI's picker does not, released after every model the CLI
  // does offer, is one the installed CLI predates: its row says so, so a reader who picks it and
  // gets a refusal knows which update fixes it. Older leftovers (dated ids, retired models the
  // CLI dropped on purpose) say nothing. Nothing is hidden: the row still resolves a stored id.
  const newestCli = Math.max(
    0,
    ...cli.map((c) => base.find((b) => strip(c.resolvedModel).startsWith(b.id))?.createdAt ?? 0),
  );
  const leftover = (b: CatalogModel): CatalogModel =>
    cli.length > 0 && b.createdAt !== undefined && b.createdAt > newestCli
      ? { ...b, description: serverText("modelNeedsCliUpdate") }
      : b;
  let rows = [
    ...fromCli,
    ...base.filter((b) => !emitted.has(b.id)).map((b) => ({ row: leftover(b), match: b.id })),
  ];
  if (picker) {
    const extra = picker.options.map((o) => {
      const known = base.find((b) => allows(o.model, b.id) || allows(b.id, o.model));
      const label = o.label ?? known?.name ?? o.model;
      return {
        row: M(o.model, label, known?.contextWindow ?? 200_000, known?.efforts ?? []),
        match: o.model,
      };
    });
    if (picker.replaceBuiltInOptions) rows = rows.filter((r) => r.row.id === "default");
    rows = [...rows, ...extra];
    const allow = picker.availableModels;
    if (allow)
      rows = rows.filter((r) => r.row.id === "default" || allow.some((e) => allows(e, r.match)));
  }
  // Two aliases can resolve to one model, and they now share its id; the first listed wins.
  return [...new Map(rows.map((r) => [r.row.id, r.row])).values()];
}
/** Serves the model catalog from cache, fetching Anthropic's API when the cache is stale, and
 *  keeps the last good catalog on any failure so the picker never goes empty. */
export async function getCatalog(fetchImpl = fetch, cli: CliModel[] = [], picker?: PickerSettings) {
  await seedFromDisk();
  if (Date.now() - catalog.at < CATALOG_TTL_MS) return mergeCatalog(cli, catalog.models, picker);
  const headers = await authHeaders(CLAUDE_HOME);
  if (headers) {
    try {
      const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          ...headers,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()).data ?? [];
        // Two dated ids can land on one undated id; the first the API lists wins.
        const mapped: ReturnType<typeof M>[] = data.map(modelFromApi);
        const models = [...new Map(mapped.map((m) => [m.id, m])).values()];
        if (models.length > 0) {
          catalog = { at: Date.now(), models };
          void persistCatalog(models);
        }
        return mergeCatalog(cli, catalog.models, picker);
      }
    } catch {
      /* offline or rejected: keep previous catalog */
    }
  }
  catalog = { at: Date.now(), models: catalog.models }; // retry no sooner than the TTL
  return mergeCatalog(cli, catalog.models, picker);
}

/** The provider-scoped half of a model entry; every Claude model takes text and images. */
export function modelInfo(
  provider: string,
  model: { id?: string; name?: string; description?: string },
) {
  const info: LlmModelInfo = {
    provider,
    id: model.id ?? "",
    name: model.name ?? "",
    inputModalities: ["text", "image"] as const,
  };
  if (model.description !== undefined) info.description = model.description;
  return info;
}

/** Exact model metadata. `id` must echo the requested id: dsh-llm normalizeModelInfo rejects mismatches. */
export function resolveModelInfo(
  provider: string,
  modelId: string,
  models: ReturnType<typeof M>[] = catalog.models,
  cap?: (typeof EFFORTS_ALL)[number],
): LlmResolvedModelInfo {
  const pool = [...models, ...KNOWN_MODELS];
  // A session stored before the ids settled asks for the dated one; it still names a model we know.
  const found =
    pool.find((m) => m.id === modelId) ??
    pool.find((m) => m.id.startsWith(modelId)) ??
    pool.find((m) => m.id === stableModelId(modelId));
  const info: LlmResolvedModelInfo = {
    ...modelInfo(provider, { id: modelId, name: found?.name ?? modelId }),
  };
  // A session's own answer first, whatever the tables say. It is the only figure that describes the
  // window the CLI compacts on, and it is right for a model released after this build.
  const live = liveWindowFor(modelId);
  if (!found) {
    if (live !== undefined) info.context = { contextWindow: live };
    return info;
  }
  info.context = { contextWindow: live ?? found.contextWindow };
  const efforts = capEfforts(found.efforts, cap);
  if (efforts.length > 0) {
    info.reasoning = {
      // SAFETY: effort ids come from the CLI's own catalog; the brand marks provenance only
      efforts: efforts.map((id) => ({ id: id as ReasoningEffortId, name: id })),
    };
  }
  return info;
}
