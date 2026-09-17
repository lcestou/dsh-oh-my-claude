// Dev-only check: the context popover names the Proxy reaches Anthropic switch when the CLI's
// window is a guess (`assumedBehind` in the `/context` reply), and says nothing when it is not.
// The reply is stubbed, so this runs on a box with no proxy and changes nothing on one that has
// one. The pass without the field is the control: the same popover, the same first line, no note.
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
const reply = (assumed: boolean) =>
  assumed
    ? { ...base, maxTokens: 200_000, percentage: 21, assumedBehind: BASE }
    : { ...base, maxTokens: 1_000_000, percentage: 4 };

const b = await launch();
let failed = false;
for (const assumed of [true, false]) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  await p.route("**/dsh-oh-my-claude/context?*", async (route) => {
    await route.fulfill({ json: reply(assumed) });
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
  const head = assumed ? "41k / 200k" : "41k / 1M";
  const ok =
    text.includes(head) &&
    (assumed
      ? notes === 1 && text.includes(BASE) && text.includes("Proxy reaches Anthropic")
      : notes === 0);
  console.log(`${ok ? "PASS" : "FAIL"}: assumed=${assumed} head="${head}" notes=${notes}`);
  if (!ok) {
    failed = true;
    console.log(JSON.stringify(text.slice(0, 600)));
  }
  await dlg.screenshot({ path: `/tmp/pw/context-assumed-${assumed ? "on" : "off"}.png` });
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
