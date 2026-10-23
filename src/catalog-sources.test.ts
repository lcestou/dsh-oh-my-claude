import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWN_MODELS,
  liveWindowFor,
  mergeCatalog,
  modelFromApi,
  nameFromId,
  noteLiveWindow,
  seedLiveWindows,
} from "./adapter/catalog.js";
import type { CliModel } from "./process.js";

// The test runner gives each file its own DSH_OMC_STATE_DIR; this file needs it, since it reads and
// writes the windows file there.
const dir = process.env.DSH_OMC_STATE_DIR;
assert.ok(dir, "run through the repo's test script, which sets DSH_OMC_STATE_DIR");

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

// A model nothing names is named from its id, in the API's spelling.
assert.equal(nameFromId("claude-opus-5-5"), "Claude Opus 5.5");
assert.equal(nameFromId("claude-haiku-4-5-20251001"), "Claude Haiku 4.5");
assert.equal(nameFromId("claude-fable-5-1[1m]"), "Claude Fable 5.1");
assert.equal(nameFromId("claude-sonnet-5"), "Claude Sonnet 5");
assert.equal(nameFromId("opus"), undefined, "an alias keeps the CLI's label");
assert.equal(nameFromId("my-proxy-model"), undefined);

// A window a session reported is written to disk, and a later boot reads it back. A figure this
// boot already holds is not replaced by the stored one.
// SAFETY: asserted non-empty above
const file = join(dir!, "context-windows.json");
mkdirSync(dir!, { recursive: true });
writeFileSync(file, JSON.stringify({ "claude-stored-1": 640_000, "claude-held-1": 1, bad: -5 }));
noteLiveWindow("claude-held-1", 300_000);
await seedLiveWindows();
assert.equal(liveWindowFor("claude-stored-1"), 640_000, "a stored window is read back");
assert.equal(liveWindowFor("claude-held-1"), 300_000, "this boot's figure wins");
assert.equal(liveWindowFor("bad"), undefined, "a non-positive figure is skipped");
noteLiveWindow("claude-opus-5-5", 1_000_000);
await new Promise((r) => setTimeout(r, 50));
const written = JSON.parse(readFileSync(file, "utf8"));
assert.equal(written["claude-opus-5-5"], 1_000_000, "a new figure reaches the file");

console.log("catalog sources ok");
