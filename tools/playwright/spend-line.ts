// Dev-only check: the cost pill turns orange once a session's cost passes the spend warning line.
// It sets the box-wide line (the `spendWarnUsd` hint) to one cent for the length of the check,
// opens a Claude session that has a cost, reads the pill, then puts the line back to what it was,
// in a `finally`, so a failed check does not leave every session orange. Point PLAYWRIGHT_ROOT at
// any project with Playwright.
// Usage: bun tools/playwright/spend-line.ts <token> [/tmp/pw/spend-line]
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw/spend-line"] = process.argv.slice(2);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "load" });
await p.waitForTimeout(3000);

/** Read or write the plugin's hints from inside the page, which carries dsh's login. */
const hints = (body?: Record<string, number | boolean | null>): Promise<Record<string, number>> =>
  p.evaluate(async (patch) => {
    const r = await fetch(
      "/dsh-oh-my-claude/hints",
      patch
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          }
        : undefined,
    );
    return r.json();
  }, body);

/** The pill's state as the page shows it: the over mark, and the colour it is drawn in. */
const pill = (): Promise<{ text: string; over: boolean; colour: string } | undefined> =>
  p.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-omc-cost-pill]");
    if (!el) return undefined;
    return {
      text: el.innerText.replace(/\s+/g, " ").trim(),
      over: el.hasAttribute("data-omc-cost-over"),
      colour: getComputedStyle(el).color,
    };
  });

const was = (await hints()).spendWarnUsd;
console.log("line before the check:", was ?? "off");
let failed = 0;
try {
  const wsName = process.env.PW_WORKSPACE ?? "oh-my-claude";
  const ws = p
    .locator('[role="treeitem"]')
    .filter({ hasText: new RegExp(`^${wsName}$`) })
    .first();
  if (await ws.count()) await ws.click({ force: true });
  await p.waitForTimeout(1200);
  let found = false;
  for (let i = 1; i < 10 && !found; i++) {
    const row = p.locator('[role="treeitem"]').nth(i);
    if (!(await row.count())) break;
    await row.click({ force: true });
    await p.waitForTimeout(3000);
    found = (await pill()) !== undefined;
  }
  if (!found) throw new Error("no session with a cost pill among the first rows");
  await hints({ spendWarnUsd: false });
  await p.waitForTimeout(1500);
  const off = await pill();
  await hints({ spendWarnUsd: 0.01 });
  await p.waitForTimeout(1500);
  const on = await pill();
  await p.screenshot({ path: `${out}.png` });
  const ok = off?.over === false && on?.over === true && on.colour !== off.colour;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  line off: ${JSON.stringify(off)}`);
  console.log(`${ok ? "PASS" : "FAIL"}  line at $0.01: ${JSON.stringify(on)}`);
} finally {
  await hints({ spendWarnUsd: was ?? false });
  console.log("line after the check:", (await hints()).spendWarnUsd ?? "off");
  await b.close();
}
process.exit(failed);
