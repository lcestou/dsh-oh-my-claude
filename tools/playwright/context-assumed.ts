// Dev-only check: the context popover names the Proxy reaches Anthropic switch when the CLI's
// window is a guess (`assumedBehind` in the `/context` reply), says the session follows on its
// next message when the switch is already on (`followsNext`), and says nothing otherwise. The
// reply is stubbed, so this runs on a box with no proxy and changes nothing on one that has one.
// The pass without the field is the control: the same popover, the same first line, no note.
//
// Point PLAYWRIGHT_ROOT at any project with Playwright installed. Arg 1 is the dsh launch token;
// PW_WORKSPACE names the workspace to expand, as in `usage-popover.ts`.
import { dshUrl, launch } from "./pw.js";

const [token] = process.argv.slice(2);
const BASE = "http://127.0.0.1:8787";
const base = {
  ok: true,
  categories: [{ name: "Messages", tokens: 41_000, deferred: false, kind: "used" }],
  totalTokens: 41_000,
  model: "claude-fable-5-1",
};
const guess = { ...base, maxTokens: 200_000, percentage: 21, assumedBehind: BASE };
const cases = [
  { name: "switch off", body: guess, head: "41k / 200k", has: [BASE, "turn on Proxy reaches"] },
  {
    name: "switch on, old process",
    body: { ...guess, followsNext: true },
    head: "41k / 200k",
    has: ["Proxy reaches Anthropic is on", "next message"],
  },
  { name: "no guess", body: { ...base, maxTokens: 1_000_000, percentage: 4 }, head: "41k / 1M" },
];

const b = await launch();
let failed = false;
for (const c of cases) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  await p.route("**/dsh-oh-my-claude/context?*", async (route) => {
    await route.fulfill({ json: c.body });
  });
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const want = /Running|\bnow\b|\d+min/;
  const wsName = process.env.PW_WORKSPACE;
  const ws = (
    wsName
      ? p.locator('[role="treeitem"]').filter({ hasText: new RegExp(`^${wsName}$`) })
      : p.locator('[role="treeitem"]')
  ).first();
  if (
    (await ws.count()) &&
    !(await p.locator('[role="treeitem"]').filter({ hasText: want }).count())
  ) {
    await ws.click({ force: true });
    await p.waitForTimeout(1200);
  }
  await p.locator('[role="treeitem"]').filter({ hasText: want }).first().click({ force: true });
  await p.waitForTimeout(2500);
  await p.locator('button[aria-haspopup="dialog"]:has(circle + circle)').first().click();
  await p.waitForTimeout(1500);
  const dlg = p.locator('[role="dialog"]').last();
  const text = await dlg.innerText().catch(() => "");
  const notes = await dlg.locator("[data-omc-context-assumed]").count();
  const has = c.has ?? [];
  const ok =
    text.includes(c.head) &&
    notes === (has.length > 0 ? 1 : 0) &&
    has.every((s) => text.includes(s)) &&
    // The switched-on wording must not still tell the reader to turn the switch on.
    (c.body === guess || !text.includes("turn on Proxy reaches"));
  console.log(`${ok ? "PASS" : "FAIL"}: ${c.name}: head="${c.head}" notes=${notes}`);
  if (!ok) {
    failed = true;
    console.log(JSON.stringify(text.slice(0, 600)));
  }
  await dlg.screenshot({ path: `/tmp/pw/context-assumed-${c.name.replaceAll(/\W+/g, "-")}.png` });
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
