// Dev-only check: how many requests a tab makes to the plugin's routes in one window, by route.
// The number the server-push work is measured by: on main at c9a5985 a running session's page
// made 206 a minute (live-turn, awaiting and side-questions at 60 each), a blank session 80.
// Opens the first Running row (运行中 on a Chinese dsh), or with `idle` as arg 3 the first row
// that is not running and not a workspace, waits 5 s for the page to settle, then counts for
// arg 2 seconds (default 60). Point PLAYWRIGHT_ROOT at any project with Playwright; arg 1 is the
// dsh launch token.
import { dshUrl, launch } from "./pw.js";

const [token, secs = "60", which = "running"] = process.argv.slice(2);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
const counts = new Map<string, number>();
let started = 0;
/** Count one request once the window is open; only the plugin's own routes are counted. */
const onRequest = (r: { url(): string }) => {
  if (!started) return;
  const u = new URL(r.url());
  if (!u.pathname.startsWith("/dsh-oh-my-claude/")) return;
  const k = u.pathname.slice("/dsh-oh-my-claude/".length);
  counts.set(k, (counts.get(k) ?? 0) + 1);
};
p.on("request", onRequest);
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const rows = p.locator('[role="treeitem"]');
const running = rows.filter({ hasText: /Running|运行中/ });
if ((await running.count()) === 0) {
  const ws = rows.filter({ hasText: process.env.PW_WORKSPACE ?? "oh-my-claude" }).first();
  if (await ws.count()) await ws.click({ force: true });
  await p.waitForTimeout(1500);
}
let row = running.first();
if (which === "idle") {
  const texts = await rows.allInnerTexts();
  const idx = texts.findIndex(
    (t, i) =>
      i > 0 &&
      !/Running|运行中/.test(t) &&
      !/^(oh-my-claude|IC-Saves|lutechi|pewtron|afk-solutions)$/.test(t.trim()),
  );
  row = rows.nth(idx);
}
const label = (await row.innerText()).replace(/\n/g, " | ").slice(0, 80);
await row.click({ force: true });
await p.waitForTimeout(5000);
started = Date.now();
await p.waitForTimeout(Number(secs) * 1000);
const total = [...counts.values()].reduce((a, c) => a + c, 0);
console.log(`row: ${label}`);
console.log(`window ${secs}s: total ${total} (${((total * 60) / Number(secs)).toFixed(0)}/min)`);
for (const [k, v] of [...counts.entries()].toSorted((x, y) => y[1] - x[1]))
  console.log(`${v}\t${k}`);
await b.close();
