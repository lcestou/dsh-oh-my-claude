import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  flushLiveWindows,
  getCatalog,
  KNOWN_MODELS,
  liveWindowFor,
  mergeCatalog,
  modelFromApi,
  nameFromId,
  noteLiveWindow,
  resolveModelInfo,
  seedLiveWindows,
  withoutHiddenModels,
} from "./adapter/catalog.js";
import type { CliModel } from "./process.js";

// The test runner gives each file its own DSH_OMC_STATE_DIR; this file needs it, since it reads and
// writes the windows file there.
const dir = process.env.DSH_OMC_STATE_DIR;
assert.ok(dir, "run through the repo's test script, which sets DSH_OMC_STATE_DIR");
// SAFETY: asserted non-empty above
mkdirSync(dir!, { recursive: true });
// The windows file is written first: the first catalog read below seeds from it, once per process.
const file = join(dir!, "context-windows.json");
writeFileSync(file, JSON.stringify({ "claude-stored-1": 640_000, bad: -5 }));

/** One CLI row whose alias is its own id. */
const row = (id: string): CliModel => ({
  value: id,
  resolvedModel: id,
  displayName: id,
  efforts: [],
});

// With a CLI lineup, the CLI decides what is current: a table row it does not offer leaves.
{
  const ids = mergeCatalog([row("claude-opus-5-5")], KNOWN_MODELS).map((m) => m.id);
  assert.deepEqual(ids, ["claude-opus-5-5"], "the table adds no row beside the CLI's lineup");
  assert.equal(mergeCatalog([], KNOWN_MODELS).length, KNOWN_MODELS.length, "no lineup: the floor");
}
// A base row the CLI reaches through an alias that keeps its own id stays, so a session bound to
// the plain id still finds its row; so does an API row newer than the CLI, marked for an update.
{
  const cli: CliModel[] = [
    {
      value: "fable",
      resolvedModel: "claude-fable-5-1[1m]",
      displayName: "Fable (1M context)",
      efforts: [],
    },
  ];
  const base = [
    modelFromApi({ id: "claude-fable-5-1", created_at: "2026-06-01T00:00:00Z" }),
    modelFromApi({ id: "claude-next-9", created_at: "2027-01-01T00:00:00Z" }),
    modelFromApi({ id: "claude-old-1", created_at: "2024-01-01T00:00:00Z" }),
  ];
  const merged = mergeCatalog(cli, base);
  const ids = merged.map((m) => m.id);
  assert.ok(ids.includes("claude-fable-5-1"), "the plain id behind a [1m] alias stays");
  assert.match(merged.find((m) => m.id === "claude-next-9")?.description ?? "", /update/i);
  assert.ok(!ids.includes("claude-old-1"), "an API row older than the CLI's lineup leaves");
}
// A stale API cache that holds none of the CLI's models cannot date the lineup, so none of its rows
// is called newer than the CLI and all of them leave.
{
  const base = [modelFromApi({ id: "claude-opus-4-1", created_at: "2025-08-01T00:00:00Z" })];
  assert.deepEqual(
    mergeCatalog([row("claude-opus-5-5")], base).map((m) => m.id),
    ["claude-opus-5-5"],
    "an undated lineup marks nothing as newer",
  );
}
// A dated API id the table does not undate still counts as reached by the CLI's undated alias row.
{
  const cli: CliModel[] = [
    { value: "x", resolvedModel: "claude-x-6[1m]", displayName: "X (1M context)", efforts: [] },
  ];
  const base = [modelFromApi({ id: "claude-x-6-20270101", created_at: "2026-01-01T00:00:00Z" })];
  assert.ok(
    mergeCatalog(cli, base).some((m) => m.id === "claude-x-6-20270101"),
    "the dated plain id behind a [1m] alias stays",
  );
}

// A model the CLI dropped leaves the listing but keeps its metadata: a session bound to it still
// resolves its efforts and window from the API cache, or every turn with a stored effort fails.
{
  writeFileSync(
    join(dir!, "models.json"),
    JSON.stringify([
      {
        provider: "claude-code",
        id: "claude-gone-7",
        name: "Claude Gone 7",
        contextWindow: 400_000,
        efforts: ["low", "high"],
        createdAt: Date.parse("2025-01-01T00:00:00Z"),
      },
      {
        provider: "claude-code",
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        contextWindow: 1_000_000,
        efforts: ["low", "high"],
        createdAt: Date.parse("2026-09-01T00:00:00Z"),
      },
    ]),
  );
  const offline = () => Promise.reject(new Error("offline"));
  const listed = await getCatalog(offline, [row("claude-opus-5-5")]);
  assert.ok(!listed.some((m) => m.id === "claude-gone-7"), "the dropped model is not listed");
  const info = resolveModelInfo("claude-code", "claude-gone-7", listed);
  assert.deepEqual(
    info.reasoning?.efforts.map((e) => e.id),
    ["low", "high"],
    "its efforts still resolve",
  );
  assert.equal(info.context?.contextWindow, 400_000, "and its window");
}

// A settings.json picker row written without the prefix resolves like the full id, efforts included.
assert.deepEqual(
  resolveModelInfo("claude-code", "opus-4-5").reasoning?.efforts.map((e) => e.id),
  ["low", "medium", "high"],
  "a short picker id keeps its efforts",
);

// A model nothing names is named from its id, in the API's spelling.
assert.equal(nameFromId("claude-opus-5-5"), "Claude Opus 5.5");
assert.equal(nameFromId("claude-haiku-4-5-20251001"), "Claude Haiku 4.5");
assert.equal(nameFromId("claude-fable-5-1[1m]"), "Claude Fable 5.1");
assert.equal(nameFromId("claude-sonnet-5"), "Claude Sonnet 5");
assert.equal(nameFromId("opus"), undefined, "an alias keeps the CLI's label");
assert.equal(nameFromId("my-proxy-model"), undefined);

// A window a session reported is written to disk, and a later boot reads it back. A figure this
// boot already holds is not replaced by the stored one.
await seedLiveWindows();
assert.equal(liveWindowFor("claude-stored-1"), 640_000, "a stored window is read back");
assert.equal(liveWindowFor("bad"), undefined, "a non-positive figure is skipped");
noteLiveWindow("claude-opus-5-5", 1_000_000);
await flushLiveWindows();
const written = JSON.parse(readFileSync(file, "utf8"));
assert.equal(written["claude-opus-5-5"], 1_000_000, "a new figure reaches the file");
assert.equal(written["claude-stored-1"], 640_000, "a later write keeps the stored figures");

// hiddenModels leaves rows out of the picker by exact id, or id plus a date stamp, and never by a
// longer version; Default stays, and an empty list changes nothing.
{
  const rows = ["default", "claude-opus-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"].map(
    (id) => ({ id }),
  );
  const ids = (hidden: string[]) => withoutHiddenModels(rows, hidden).map((r) => r.id);
  assert.deepEqual(
    ids([]),
    rows.map((r) => r.id),
    "an empty list hides nothing",
  );
  assert.deepEqual(ids(["claude-opus-5"]), [
    "default",
    "claude-opus-5-5",
    "claude-haiku-4-5-20251001",
  ]);
  assert.deepEqual(
    ids(["claude-haiku-4-5"]),
    ["default", "claude-opus-5", "claude-opus-5-5"],
    "a date stamp follows",
  );
  assert.deepEqual(
    ids(["opus-5[1m]", "default"]),
    ["default", "claude-opus-5-5", "claude-haiku-4-5-20251001"],
    "spelling variants match and Default stays",
  );
}

console.log("catalog sources ok");
