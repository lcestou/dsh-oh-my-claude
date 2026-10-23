import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { liveWindowFor, noteLiveWindow, seedLiveWindows } from "./adapter/catalog.js";

// Its own file, so its process has not read the windows file yet: a figure noted before the first
// catalog read must not overwrite what earlier boots stored.
const dir = process.env.DSH_OMC_STATE_DIR;
assert.ok(dir, "run through the repo's test script, which sets DSH_OMC_STATE_DIR");
// SAFETY: asserted non-empty above
mkdirSync(dir!, { recursive: true });
const file = join(dir!, "context-windows.json");
writeFileSync(file, JSON.stringify({ "claude-stored-1": 640_000 }));
noteLiveWindow("claude-early-1", 300_000);
await seedLiveWindows();
await new Promise((r) => setTimeout(r, 50));
const written = JSON.parse(readFileSync(file, "utf8"));
assert.equal(written["claude-stored-1"], 640_000, "the stored figure survives an early note");
assert.equal(written["claude-early-1"], 300_000, "and the early note is written beside it");
assert.equal(liveWindowFor("claude-stored-1"), 640_000);
console.log("catalog windows seed ok");
