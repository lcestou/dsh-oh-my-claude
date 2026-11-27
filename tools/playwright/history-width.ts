// Dev-only check: the Ctrl+R history search field is wide enough to show what is typed, on a
// desktop and on a phone. The scope button beside it once took the whole line and squeezed the
// field to its 50 px of padding, so the text sat hidden behind the magnifier.
// Point PLAYWRIGHT_ROOT at any project that has Playwright.
// Usage: bun tools/playwright/history-width.ts <token>
import { dshUrl, launch } from "./pw.js";
import type { Locator, Page } from "./pw.js";

const [token] = process.argv.slice(2);
const b = await launch();

/** What went wrong, one line each; the run exits 1 when any. */
const failed: Array<string> = [];

/** A DOM click, so a phone's sidebar rows below the fold still open. */
const tap = (l: Locator) => l.evaluate((el) => el.click());

/** Open the first Claude session in the sidebar that has priced turns (its stats row carries the
 *  plugin's cost pill). A workspace row also draws a Claude composer with the ✻ button, but that
 *  new-session composer has no history search, so the ✻ button alone is not enough. A phone keeps
 *  the tree behind dsh's "Open sidebar" button (打开侧边栏 on a Chinese dsh), shut again on each
 *  pick. Answers false when none of the first ten rows is one. */
async function openClaudeSession(p: Page): Promise<boolean> {
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);

  for (let i = 1; i < 10; i++) {
    const sidebar = p.getByRole("button", { name: /^(Open sidebar|打开侧边栏)$/ });

    if (await sidebar.count()) {
      await sidebar.click({ force: true });
      await p.waitForTimeout(800);
    }

    const row = p.locator('[role="treeitem"]').nth(i);

    if (!(await row.count())) {
      return false;
    }

    await tap(row);
    await p.waitForTimeout(2500);

    if (await p.locator("[data-omc-cost-pill]").count()) {
      return true;
    }
  }

  return false;
}

for (const [name, viewport] of [
  ["desktop", { width: 1400, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  const ctx = await b.newContext({ viewport, colorScheme: "dark" });
  const p = await ctx.newPage();

  if (!(await openClaudeSession(p))) {
    failed.push(`${name}: no Claude session to open`);
    await ctx.close();
    continue;
  }

  // Focused through the DOM: on a phone the sidebar sheet can still cover the composer.
  await p
    .locator('textarea, [contenteditable="true"]')
    .first()
    .evaluate((el) => {
      if (el instanceof HTMLElement) {
        el.focus();
      }
    });
  await p.keyboard.press("Control+r");
  const field = p.locator("[data-omc-history-query]");

  for (let i = 0; i < 25 && !(await field.count()); i++) {
    await p.waitForTimeout(200);
  }

  if (!(await field.count())) {
    failed.push(`${name}: Ctrl+R opened no history search`);
    await ctx.close();
    continue;
  }

  await p.keyboard.type("dsh");

  const m = await p.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("[data-omc-history-query]");
    const card = document.querySelector<HTMLElement>("[data-omc-history-search]");

    return {
      value: input?.value ?? "",
      field: Math.round(input?.getBoundingClientRect().width ?? 0),
      card: Math.round(card?.getBoundingClientRect().width ?? 0),
    };
  });

  // Half the card leaves room for the scope button at either size; the squeezed field was 50 px.
  // A missing card measures 0, which any field would pass, so it fails here instead.
  const ok = m.card > 0 && m.value === "dsh" && m.field >= m.card / 2;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: field ${m.field}px of a ${m.card}px card, value ${JSON.stringify(m.value)}`,
  );

  if (!ok) {
    failed.push(`${name}: field ${m.field}px of ${m.card}px`);
  }

  await ctx.close();
}

await b.close();

if (failed.length) {
  for (const f of failed) {
    console.log(`FAIL ${f}`);
  }

  process.exit(1);
}
