// Dev-only check: the usage history strips in the ring popover, served a fabricated usage reply
// (usage-fixture.ts) so it never needs, or touches, the box's own usage-history.json. Dark and
// light, desktop and phone: the strips and their bar counts, the row for a series with no live
// window, the partial bars, the keyboard walk, a hover or a tap, then the empty line and an older
// server's reply with no history. Screenshots go to OUT (default /tmp/pw).
// Usage: bun tools/playwright/usage-history.ts <token> [session title]
import { dshUrl, launch } from "./pw.js";
import type { Page } from "./pw.js";
import { routeUsage } from "./usage-fixture.js";
import type { HistoryCase } from "./usage-fixture.js";

const [token, sessionTitle] = process.argv.slice(2);
const out = process.env.OUT ?? "/tmp/pw";
const RING = 'button[aria-haspopup="dialog"]:has(> svg > circle + circle[stroke-dasharray])';
const now = Date.now();
let failed = 0;

/** Print one result line, counting it when it failed. */
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);

  if (!ok) {
    failed++;
  }
};

/** Load dsh with usage answered from the fixture, open the session under test (a DOM click, since
 *  on a phone the sidebar is a closed sheet), then its ring popover. */
async function openRing(p: Page, which: HistoryCase): Promise<void> {
  await routeUsage(p, which, now);
  await p.goto(dshUrl(token), { waitUntil: "load" });
  await p.waitForTimeout(2500);

  const row = sessionTitle
    ? p.getByText(sessionTitle).first()
    : p.locator('[role="treeitem"]').last();

  await row.evaluate((el) => el.click());
  await p.waitForTimeout(3500);
  await p
    .locator(RING)
    .first()
    .evaluate((el) => el.click());
  await p.waitForTimeout(1500);
}

/** The pace kinds the live rows show, in order: the rows above the strips must not change. */
const paceKinds = (p: Page): Promise<Array<string | null>> =>
  p
    .locator("[data-omc-usage-pace]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-omc-usage-pace")));

const b = await launch();
let baseline: Array<string | null> = [];

for (const which of ["none", "empty"] as const) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  await openRing(p, which);
  const strips = await p.locator("[data-omc-usage-history]").count();
  const empty = await p.locator("[data-omc-usage-history-empty]").count();
  check(
    strips === 0 && empty === (which === "empty" ? 1 : 0),
    `${which}: ${strips} strips, ${empty} empty lines`,
  );

  if (which === "none") {
    baseline = await paceKinds(p);
  }

  await p.unrouteAll({ behavior: "ignoreErrors" });
  await ctx.close();
}

for (const colorScheme of ["dark", "light"] as const) {
  for (const width of [1400, 390]) {
    const phone = width < 500;
    const scene = `${colorScheme} ${width}px`;

    const ctx = await b.newContext({
      viewport: { width, height: phone ? 844 : 900 },
      deviceScaleFactor: 2,
      colorScheme,
      isMobile: phone,
      hasTouch: phone,
    });

    const p = await ctx.newPage();
    await openRing(p, "full");
    const sliders = p.locator('[data-omc-usage-history] [role="slider"]');

    const maxes = await sliders.evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-valuemax")),
    );

    check(
      maxes.join("/") === "12/8/3/4",
      `${scene} strips hold 12/8/3/4 windows: ${maxes.join("/")}`,
    );
    check(
      (await p.locator('[data-omc-usage-history-row="model:Opus"]').count()) === 1,
      `${scene} the series with no live window gets its own row`,
    );
    const partials = await p.locator("[data-omc-usage-history-partial]").count();
    check(partials === 6, `${scene} 6 partial bars: ${partials}`);
    const kinds = await paceKinds(p);
    check(kinds.join() === baseline.join(), `${scene} live rows unchanged: ${kinds.join()}`);
    const first = sliders.first();
    await first.evaluate((el) => el.focus());
    await p.keyboard.press("End");
    await p.keyboard.press("ArrowLeft");
    const value = await first.getAttribute("aria-valuenow");
    const text = await first.getAttribute("aria-valuetext");
    const caption = await p.locator("[data-omc-usage-history-caption]").first().textContent();
    check(
      value === "11" && text === caption && /Ended|结束/.test(text ?? ""),
      `${scene} End then Left picks window 11 and the caption reads it: "${caption}"`,
    );
    const bar = p.locator("[data-omc-usage-history] [data-omc-usage-history-bar]").nth(2);
    const box = await bar.boundingBox();

    if (phone && box) {
      await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await bar.hover();
    }

    await p.waitForTimeout(200);
    check(
      (await first.getAttribute("aria-valuenow")) === "3",
      `${scene} a ${phone ? "tap" : "hover"} on bar 3 picks it`,
    );
    await p
      .locator('[role="dialog"]')
      .last()
      .screenshot({ path: `${out}/usage-history-${colorScheme}-${width}.png` });
    await p.unrouteAll({ behavior: "ignoreErrors" });
    await ctx.close();
  }
}

await b.close();

console.log(failed ? `${failed} FAILED` : "usage history check ok");

process.exit(failed ? 1 : 0);
