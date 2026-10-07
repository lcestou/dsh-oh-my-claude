// Dev-only check: on a Claude session, the tok/s reading in dsh's activity pill is the one built
// from the plugin's turn records, not dsh's own. Opens this workspace's sessions until one shows
// the pill, then prints the reading on screen beside the figure `/turns` gives.
// Usage: bun tools/playwright/speed-reading.ts <token> [/tmp/pw/speed]
import { tokensPerSecond } from "../../src/client/speed.js";
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw/speed"] = process.argv.slice(2);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "load" });
await p.waitForTimeout(3000);
const wsName = process.env.PW_WORKSPACE ?? "oh-my-claude";
const ws = p
  .locator('[role="treeitem"]')
  .filter({ hasText: new RegExp(`^${wsName}$`) })
  .first();
if (await ws.count()) await ws.click({ force: true });
await p.waitForTimeout(1200);
let seen = false;
for (let i = 1; i < 10 && !seen; i++) {
  const row = p.locator('[role="treeitem"]').nth(i);
  if (!(await row.count())) break;
  await row.click({ force: true });
  await p.waitForTimeout(3500);
  const pill = p.locator('[data-composer-stat="activity"]').first();
  if (!(await pill.count()) || !(await p.locator("[data-omc-cost-slot]").count())) continue;
  const text = await pill.innerText();
  if (!/tok\/s/.test(text)) continue;
  seen = true;
  // The selected sidebar row names the session; dsh keeps no id in the URL.
  const session = await p.evaluate(() => {
    const html = document.querySelector('[role="treeitem"][aria-selected="true"]')?.outerHTML ?? "";
    return (
      /session-[0-9a-f-]{36}/.exec(html)?.[0] ??
      /session-[0-9a-f-]{36}/.exec(document.body.innerHTML)?.[0]
    );
  });
  const reply = await p.evaluate(
    async (id) => (await fetch(`/dsh-oh-my-claude/turns?session=${id}`)).json(),
    session ?? "",
  );
  // SAFETY: our own route's JSON; a wrong shape yields undefined from tokensPerSecond
  const ours = tokensPerSecond((reply as { turns?: never[] }).turns ?? []);
  console.log("session:", session);
  console.log("pill on screen:", JSON.stringify(text));
  console.log("from /turns:", ours === undefined ? "no usable turn" : `${ours.toFixed(1)} tok/s`);
  const box = await pill.boundingBox();
  if (box)
    await p.screenshot({
      path: `${out}.png`,
      clip: { x: Math.max(0, box.x - 300), y: box.y - 30, width: 900, height: box.height + 60 },
    });
}
if (!seen) console.log("no Claude session with a tok/s reading among the first rows");
await b.close();
