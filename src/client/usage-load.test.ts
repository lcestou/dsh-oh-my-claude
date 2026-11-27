// loadUsage never forces, shares one fetch between callers, and the stale note names its time.
import assert from "node:assert/strict";
import { loadUsage, resetText, staleNote, usageCache } from "./context-meter.js";
import { installLocale } from "./i18n.js";

const urls: Array<string> = [];

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

assert.equal(resetText(Date.now() + 20_000), resetText(Date.now() - 1), "20 s left reads as now");

// Dates follow dsh's language, not the browser's: with dsh on Chinese a reset two days out names
// its weekday in Chinese, whatever language the test process runs in.
{
  const off = installLocale({
    get: () => ({
      register: () => undefined,
      bind: () => (_key: string, params?: Record<string, string | number>) =>
        String(params?.when ?? ""),
      subscribe: () => () => {},
      getSnapshot: () => ({ active: "zh", revision: 1 }),
    }),
  });

  const when = resetText(Date.now() + 2 * 86_400_000);
  off();
  assert.match(when, /周|星期/, `a Chinese weekday, got ${when}`);
}

console.log("usage-load ok");
