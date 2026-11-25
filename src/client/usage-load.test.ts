// loadUsage never forces, shares one fetch between callers, and the stale note names its time.
import assert from "node:assert/strict";
import { loadUsage, resetText, staleNote, usageCache } from "./context-meter.js";

const urls: string[] = [];
globalThis.fetch = (async (url: string) => {
  urls.push(url);
  await new Promise((r) => setTimeout(r, 10));
  return new Response(JSON.stringify({ ok: true, fetchedAt: 1, windows: [] }));
}) as typeof fetch;

const [a, b, c] = await Promise.all([loadUsage("p1"), loadUsage("p1"), loadUsage("p1")]);
assert.equal(urls.length, 1);
assert.equal(a, b);
assert.equal(b, c);
assert.ok(!urls[0]?.includes("force"));
assert.ok(urls[0]?.endsWith("/usage?provider=p1"));
await loadUsage("p1");
assert.equal(urls.length, 1);
usageCache.clear();
await loadUsage();
assert.ok(urls[1]?.endsWith("/usage") && !urls[1].includes("force"));

assert.equal(staleNote({ ok: true, fetchedAt: 1, windows: [] }), "");
assert.equal(staleNote({ ok: false, error: "x" }), "");
assert.notEqual(staleNote({ ok: true, fetchedAt: Date.now(), windows: [], stale: true }), "");
// Rounding to the minute carries into the hour: 2 h 59 min 40 s is 3 h 0 min, not 2 h 60 min.
const soon = resetText(Date.now() + 3 * 3_600_000 - 20_000);
assert.ok(!soon.includes("60"), soon);
assert.ok(soon.includes("3"), soon);
console.log("usage-load ok");
