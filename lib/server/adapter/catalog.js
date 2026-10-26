// The model ladder, the baked-in model list, the on-disk catalog cache and how a model id resolves.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { probeFirstParty } from "../first-party.js";
import { serverText } from "../locale.js";
import { authHeaders, CLAUDE_HOME, STATE_DIR, writeJson } from "../state.js";
// No default effort is advertised: `--effort` is only sent when dsh picks one, so the CLI's own default rules.
/** The CLI's effort ladder, low to high; `readPickerSettings` validates `maxEffortLevel` against it. */
export const EFFORTS_ALL = ["low", "medium", "high", "xhigh", "max"];
/** Trim an efforts list to those at or below `cap`. `"max"` and an absent cap keep everything.
 *  An id outside the ladder (a future level this build does not know) is left in, never hidden. */
function capEfforts(efforts, cap) {
    if (cap === undefined || cap === "max")
        return [...efforts];
    const ceiling = EFFORTS_ALL.indexOf(cap);
    return efforts.filter((e) => {
        const i = EFFORTS_ALL.findIndex((level) => level === e);
        return i === -1 || i <= ceiling;
    });
}
const EFFORTS_45 = ["low", "medium", "high"];
/** Build one KNOWN_MODELS row: the provider is always claude-code, so callers pass only the id, label, context window and efforts, filling description when given. */
const M = (id, label, contextWindow, efforts, description) => {
    const row = { provider: "claude-code", id, name: label, contextWindow, efforts };
    if (description !== undefined)
        row.description = description;
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
export const stableModelId = (id) => {
    const bare = id.replace(/-\d{8}$/, "");
    return bare !== id && KNOWN_MODELS.some((m) => m.id === bare) ? bare : id;
};
// ---------------------------------------------------------------------------
// Model catalog
export const CATALOG_TTL_MS = 10 * 60 * 1000;
/** How long the first listing of a boot waits for the lineup probe (`probeCliModels`) before it
 *  answers from what it has. A cold `claude -p` answered `list_models` in about 1.3 s on 2.1.309
 *  (2026-10-23); the probe itself keeps going past this, and its answer serves the next listing. */
export const LINEUP_PROBE_WAIT_MS = 5000;
/** The lineup probe's command line: stream-json both ways, so a control request can be written and
 *  its answer read, and no transcript, since no prompt is ever sent to it. */
export const LINEUP_PROBE_ARGS = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
];
let catalog = { at: 0, models: KNOWN_MODELS };
/** Where the last catalog the API gave us is kept, so a boot with the API down still lists the real
 *  models instead of the baked-in floor. Written on every successful fetch, read once per process. */
/** Path to the on-disk catalog cache. Honors DSH_OMC_STATE_DIR so a test can aim it at an empty
 *  dir and exercise the offline floor without depending on whatever this box has cached. */
const catalogCachePath = () => join(process.env.DSH_OMC_STATE_DIR ?? STATE_DIR, "models.json");
let diskSeeded = false;
/** The shape a cached row must still hold. The cache is our own write, but a truncated or hand-edited
 *  file must never slip a malformed row into the catalog dsh validates, so it is re-parsed on read. */
const CachedCatalog = z.array(z.object({
    provider: z.const("claude-code"),
    id: z.string(),
    name: z.string(),
    contextWindow: z.number(),
    efforts: z.array(z.string()),
    createdAt: z.number(),
}));
/** Parse a persisted catalog file. Anything malformed reads as empty, so the caller falls back. */
export function parseCatalogCache(text) {
    try {
        return CachedCatalog(JSON.parse(text))
            .filter((r) => r.id.length > 0 && r.name.length > 0)
            .map((r) => {
            const row = M(r.id, r.name, r.contextWindow, r.efforts);
            if (r.createdAt !== undefined)
                row.createdAt = r.createdAt;
            return row;
        });
    }
    catch {
        return [];
    }
}
/** Seed the in-memory catalog from disk once, unless a live fetch has already replaced it. `at`
 *  stays 0 so the next `getCatalog` still tries the API; the disk copy only survives a failed fetch. */
async function seedFromDisk() {
    if (diskSeeded)
        return;
    diskSeeded = true;
    if (catalog.at !== 0)
        return;
    try {
        const rows = parseCatalogCache(await readFile(catalogCachePath(), "utf8"));
        if (rows.length > 0 && catalog.at === 0)
            catalog = { at: 0, models: rows };
    }
    catch {
        /* no cache yet or unreadable: the KNOWN_MODELS floor stays */
    }
}
/** Persist a fetched catalog for later boots. Best effort: a write that fails just misses the seed. */
async function persistCatalog(models) {
    try {
        const path = catalogCachePath();
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(models));
    }
    catch {
        /* read-only state dir or full disk: fall through, the fetch still served this boot */
    }
}
/** One entry of the Anthropic Models API list, in the shape the picker uses. */
export function modelFromApi(m) {
    const eff = m.capabilities?.effort;
    const efforts = eff?.supported ? EFFORTS_ALL.filter((l) => eff[l]?.supported) : [];
    const id = stableModelId(m.id ?? "");
    const row = M(id, m.display_name ?? id, m.max_input_tokens ?? 200_000, efforts);
    const created = m.created_at ? Date.parse(m.created_at) : Number.NaN;
    if (!Number.isNaN(created))
        row.createdAt = created;
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
const strip = (id) => (id.endsWith("[1m]") ? id.slice(0, -4) : id);
/** An allowlist entry and a model id meet in one shape: no `claude-` prefix, no `[1m]` suffix. */
const bareId = (id) => {
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
 * Kept on disk in `context-windows.json` beside the catalog cache, so a restart, or a model newer
 * than this build that only the CLI names, keeps the window a session last reported instead of
 * falling back to a guess. Wrong when the box's setup changes under a stored figure (a proxy added
 * or removed, 1M turned on or off): the stale figure stands until that model's next context read.
 * Also wrong when one box runs a model both plain and `[1m]`: both bank under one key, so whichever
 * ran last answers for both, now across restarts too.
 */
const liveWindows = new Map();
/** Where `liveWindows` is kept between boots; DSH_OMC_STATE_DIR moves it for tests, as the catalog's. */
const windowsPath = () => join(process.env.DSH_OMC_STATE_DIR ?? STATE_DIR, "context-windows.json");
let windowsSeed;
/** The last write queued, so writes land in the order they were asked and the newest map wins. */
let windowsWrite = Promise.resolve();
/** Ids a session reported since this process started. A figure read back from disk is not in it,
 *  so the once-per-model ask between turns still refreshes a stored figure. */
const reportedThisBoot = new Set();
/** The windows file: model id to the window its last session reported. Our own write, re-parsed
 *  on read so a hand-edited or truncated file is dropped whole rather than half-trusted. */
const StoredWindows = z.dict(z.number());
/** Load the stored windows once per process. A figure a session already reported this boot wins
 *  over the stored one; a malformed file is ignored and a non-positive figure skipped, never thrown. */
export const seedLiveWindows = () => (windowsSeed ??= (async () => {
    try {
        const stored = StoredWindows(JSON.parse(await readFile(windowsPath(), "utf8")));
        for (const [id, n] of Object.entries(stored))
            if (Number.isFinite(n) && n > 0 && !liveWindows.has(id))
                liveWindows.set(id, n);
    }
    catch {
        /* no file yet or unreadable: windows are relearned from the next context reads */
    }
})());
/** Queue a write of every known window. Writes run one after another and each reads the map when
 *  it runs, so the last to land holds the newest figures; `writeJson`'s temp file and rename keep a
 *  crash from tearing it. Best effort: a failed write costs a guess after the next restart. */
function persistLiveWindows() {
    windowsWrite = windowsWrite.then(() => writeJson(windowsPath(), Object.fromEntries(liveWindows)).catch(() => {
        /* read-only state dir or full disk: this boot still has the figures in memory */
    }));
    return windowsWrite;
}
/** Resolves once every window write asked for so far has landed; tests await it. Waits for the seed
 *  first, because a note queues its write only after the seed, in a callback that runs before this. */
export const flushLiveWindows = async () => {
    await seedLiveWindows();
    await windowsWrite;
};
/** Whether a session reported this model's window since this process started. */
export const windowReportedThisBoot = (modelId) => reportedThisBoot.has(windowKey(modelId));
/** The liveWindows key: strip any ANSI codes and resolve to the stable id, so a window looked up by the CLI's raw model id matches the normalized one stored here. */
export const windowKey = (id) => stableModelId(strip(id));
/** Claude Code's env flag for "the base URL is a proxy in front of Anthropic" (`Xo()` in 2.1.274). */
export const FIRST_PARTY_FLAG = "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL";
/** The base URL when it names a host the CLI does not treat as first-party, else undefined. The
 *  test is the CLI's own (`av()` in 2.1.274: `new URL(e).host` against `["api.anthropic.com"]`),
 *  `host` with its port included, so this fires exactly when the CLI demotes. */
export const proxyBaseUrl = (raw) => {
    if (!raw)
        return undefined;
    try {
        return new URL(raw).host === "api.anthropic.com" ? undefined : raw;
    }
    catch {
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
export const detectFirstParty = async () => {
    const baseUrl = proxyBaseUrl(process.env.ANTHROPIC_BASE_URL);
    if (!baseUrl)
        return false; // no proxy in front: the flag changes nothing either way
    // SAFETY: this plugin's own key on globalThis, typed here once, as the timers below are
    const store = globalThis;
    const asked = (store[FIRST_PARTY_PROBE] ??= probeFirstParty(baseUrl));
    const answer = await asked;
    if (answer === undefined)
        store[FIRST_PARTY_PROBE] = undefined;
    return answer;
};
/** Record what a session answered. A missing or nonsense figure leaves the last good one standing. */
export const noteLiveWindow = (modelId, maxTokens) => {
    if (modelId === undefined || maxTokens === undefined || !Number.isFinite(maxTokens))
        return;
    if (maxTokens <= 0)
        return;
    const key = windowKey(modelId);
    reportedThisBoot.add(key);
    if (liveWindows.get(key) === maxTokens)
        return;
    liveWindows.set(key, maxTokens);
    // After the seed, so a figure noted before the first catalog read never overwrites the stored file.
    void seedLiveWindows().then(persistLiveWindows);
};
/** The context window a live session last reported for this model, which beats the catalog's
 *  figure because it is what this box's CLI actually runs with (a proxy can demote a 1M model to
 *  200k). Keyed by the stable id, so an alias and its dated spelling share one answer. Undefined
 *  until some session has reported it. */
export const liveWindowFor = (modelId) => liveWindows.get(windowKey(modelId));
/**
 * The known row a CLI row resolves to: the same id, or that id with the Models API's date suffix
 * (`claude-haiku-4-5-20251001`), and never an id it merely starts with. `claude-opus-5-5` starts
 * with `claude-opus-5`, and a bare prefix match put Opus 5.5 under Opus 5's id and name.
 */
const knownRow = (base, resolvedModel) => {
    const bare = strip(resolvedModel);
    const undated = bare.replace(/-\d{8}$/, "");
    return base.find((b) => b.id === bare || b.id.replace(/-\d{8}$/, "") === undated);
};
/**
 * The name a model gets when no API row or table row names it: `claude-opus-5-5` reads
 * "Claude Opus 5.5", in the spelling the API gives its own rows, so a model newer than this build
 * does not stand in the picker as the CLI's bare "Opus" beside "Claude Opus 5". Undefined for an id
 * outside the `claude-<family>-<version>` shape, which keeps the CLI's label. Wrong for a family
 * the API spells with more than one capital: none today.
 */
export const nameFromId = (id) => {
    const m = /^claude-([a-z]+)-(\d+(?:-\d+)?)$/.exec(strip(id).replace(/-\d{8}$/, ""));
    if (!m?.[1] || !m[2])
        return undefined;
    return `Claude ${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2].replace("-", ".")}`;
};
/** The three forms an entry takes: a family alias, a version prefix, or the whole id. */
const allows = (entry, id) => {
    const want = bareId(entry);
    const have = bareId(id);
    return have === want || have.startsWith(`${want}-`);
};
/**
 * Drops the rows a `hiddenModels` entry names. An entry matches a row's id exactly or with a date
 * stamp after it (`claude-haiku-4-5` hides `claude-haiku-4-5-20251001`), never a longer version:
 * `claude-opus-5` leaves `claude-opus-5-5` in the picker. `default` is never hidden, and only the
 * picker changes: a session already on a hidden model keeps running.
 */
export const withoutHiddenModels = (rows, hidden) => {
    const wanted = hidden.map(bareId);
    return rows.filter((r) => {
        const have = bareId(r.id);
        return (r.id === "default" ||
            !wanted.some((w) => have === w ||
                new RegExp(`^${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{8}$`).test(have)));
    });
};
/** Merges the CLI's model rows into the catalog, giving each known model a single stable id and
 *  name so the picker offers the same lineup whether or not the CLI has yet learned the model's
 *  short spelling. */
export function mergeCatalog(cli, base, picker) {
    if (cli.length === 0 && !picker)
        return base;
    // A CLI row is keyed by an alias (`opus`, `default`), so each row carries the id the allowlist reads.
    const fromCli = cli.map((c) => {
        const known = knownRow(base, c.resolvedModel);
        const window = c.resolvedModel.endsWith("[1m]") ? 1_000_000 : (known?.contextWindow ?? 200_000);
        // The CLI is asked for its picker once a process is live, so before that answer the lineup
        // spells a model `claude-haiku-4-5` and after it `haiku`. Anything holding an id across that
        // moment, a dsh subagent allowlist or a stored session model, reads the other spelling as a
        // model that is gone. A row landing on a model this catalog already knows takes that model's
        // id, so both states offer the same ids; `default` and a `[1m]` variant have none to take.
        const stable = c.value === "default" || c.resolvedModel.endsWith("[1m]") ? undefined : known?.id;
        // The CLI names its rows for a terminal picker that shows nothing else ("Opus (1M context)",
        // "Fable", "Sonnet"), and the known rows that follow here read "Claude Opus 5"; two spellings
        // in one menu read as two lineups (owner, 2026-09-16). A row landing on a known model takes
        // that model's name, with the window named the way the CLI names it; Default keeps its own.
        const name = known?.name ?? nameFromId(c.resolvedModel);
        const label = c.value === "default" || name === undefined
            ? c.displayName
            : `${name}${c.resolvedModel.endsWith("[1m]") ? " (1M context)" : ""}`;
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
    // gets a refusal knows which update fixes it.
    // Dated only through the base: with no CLI row found there (a stale API cache), nothing is called
    // newer, since every dated row would be. Wrong for a real newer model in that state: unmarked.
    const dated = cli
        .map((c) => knownRow(base, c.resolvedModel)?.createdAt ?? 0)
        .filter((n) => n > 0);
    const newestCli = dated.length > 0 ? Math.max(...dated) : Number.POSITIVE_INFINITY;
    const newer = (b) => b.createdAt !== undefined && b.createdAt > newestCli;
    // With a CLI lineup in hand, the CLI decides what is current. A base row stays only when the CLI
    // reaches it through an alias that keeps its own id (`default`, a `[1m]` variant), so a session
    // bound to the plain id still finds its row, or when the API lists it as newer than the CLI.
    // Everything else is a model the CLI dropped, and it leaves the picker with the CLI that
    // dropped it. Wrong for a session still bound to one of those that someone wants to keep: its
    // turns run (dsh gates only a new pick on the list, and `resolveModelInfo` still finds the
    // model's metadata), but `StaleModelRepair` moves it to its family's newest listed model when it
    // is opened idle. A `modelPicker.options` row with the full id keeps a model listed.
    const reached = new Set(cli.map((c) => strip(c.resolvedModel).replace(/-\d{8}$/, "")));
    const keep = (b) => !emitted.has(b.id) &&
        (cli.length === 0 || reached.has(b.id.replace(/-\d{8}$/, "")) || newer(b));
    const leftover = (b) => cli.length > 0 && newer(b) ? { ...b, description: serverText("modelNeedsCliUpdate") } : b;
    let rows = [...fromCli, ...base.filter(keep).map((b) => ({ row: leftover(b), match: b.id }))];
    if (picker) {
        const extra = picker.options.map((o) => {
            const known = base.find((b) => allows(o.model, b.id) || allows(b.id, o.model));
            const label = o.label ?? known?.name ?? o.model;
            return {
                row: M(o.model, label, known?.contextWindow ?? 200_000, known?.efforts ?? []),
                match: o.model,
            };
        });
        if (picker.replaceBuiltInOptions)
            rows = rows.filter((r) => r.row.id === "default");
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
export async function getCatalog(fetchImpl = fetch, cli = [], picker) {
    await Promise.all([seedFromDisk(), seedLiveWindows()]);
    if (Date.now() - catalog.at < CATALOG_TTL_MS)
        return mergeCatalog(cli, catalog.models, picker);
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
                const mapped = data.map(modelFromApi);
                const models = [...new Map(mapped.map((m) => [m.id, m])).values()];
                if (models.length > 0) {
                    catalog = { at: Date.now(), models };
                    void persistCatalog(models);
                }
                return mergeCatalog(cli, catalog.models, picker);
            }
        }
        catch {
            /* offline or rejected: keep previous catalog */
        }
    }
    catalog = { at: Date.now(), models: catalog.models }; // retry no sooner than the TTL
    return mergeCatalog(cli, catalog.models, picker);
}
/** The provider-scoped half of a model entry; every Claude model takes text and images. */
export function modelInfo(provider, model) {
    const info = {
        provider,
        id: model.id ?? "",
        name: model.name ?? "",
        inputModalities: ["text", "image"],
    };
    if (model.description !== undefined)
        info.description = model.description;
    return info;
}
/** Exact model metadata. `id` must echo the requested id: dsh-llm normalizeModelInfo rejects mismatches. */
export function resolveModelInfo(provider, modelId, models = catalog.models, cap) {
    // The unmerged API cache sits between the listing and the table: a model the CLI dropped is
    // gone from `models` but still needs its efforts and window, or a session bound to it fails
    // every turn that carries a stored effort (dsh refuses an effort the model does not list).
    const pool = [...models, ...catalog.models, ...KNOWN_MODELS];
    // A session stored before the ids settled asks for the dated one; it still names a model we know.
    // A `modelPicker.options` row may be written without the prefix (`opus-4-5`), the form the CLI
    // accepts; without the last lookup it resolved with no efforts and a stored effort failed its turns.
    const found = pool.find((m) => m.id === modelId) ??
        pool.find((m) => m.id.startsWith(modelId)) ??
        pool.find((m) => m.id === stableModelId(modelId)) ??
        pool.find((m) => m.id === `claude-${modelId}`);
    const info = {
        ...modelInfo(provider, { id: modelId, name: found?.name ?? modelId }),
    };
    // A session's own answer first, whatever the tables say. It is the only figure that describes the
    // window the CLI compacts on, and it is right for a model released after this build.
    const live = liveWindowFor(modelId);
    if (!found) {
        if (live !== undefined)
            info.context = { contextWindow: live };
        return info;
    }
    info.context = { contextWindow: live ?? found.contextWindow };
    const efforts = capEfforts(found.efforts, cap);
    if (efforts.length > 0) {
        info.reasoning = {
            // SAFETY: effort ids come from the CLI's own catalog; the brand marks provenance only
            efforts: efforts.map((id) => ({ id: id, name: id })),
        };
    }
    return info;
}
//# sourceMappingURL=catalog.js.map