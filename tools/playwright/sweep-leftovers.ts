// Dev-only check for the 2026-10-21 sweep leftovers: the Compact nudge switch on the Settings
// card, the pace line under a plan window in the meter popover, the MCP tool-count pill, the Run
// button on a shell snippet (it sends the snippet to Claude as a prompt), and the compact card
// with the threshold lowered through /hints (restored at the end). Point PLAYWRIGHT_ROOT at any
// project with Playwright installed; arg 1 is the dsh launch token, arg 2 a screenshot directory.
// Spends two short haiku turns in a fresh session of the oh-my-claude workspace.
import { dshUrl, launch } from "./pw.js";
const [token, out = "/tmp/pw"] = process.argv.slice(2);
const ROUTE = "/dsh-oh-my-claude";
const b = await launch();
const ctx = await b.newContext({
  viewport: { width: 1400, height: 900 },
  colorScheme: "dark",
});
const p = await ctx.newPage();
const errors: string[] = [];
p.on("console", (m) => {
  const text = m.text();
  if (/error/i.test(text) && /omc|oh-my-claude/i.test(text)) errors.push(text.slice(0, 160));
});
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
let failed = 0;
/** One line per expectation; a miss counts toward the exit code. */
const expect = (label: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failed += 1;
};
/** POST one hint patch through the page, so the request carries dsh's cookie. */
const hint = (patch: Record<string, boolean | number | null>) =>
  p.evaluate(
    async ([route, body]) => {
      const r = await fetch(`${route}/hints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.status;
    },
    [ROUTE, patch] as const,
  );
/** Open Settings → Oh My Claude (account menu on dsh 0.2.1, a gear on older ones). */
const openSettings = async () => {
  const gear = p.locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]');
  if ((await gear.count()) > 0) await gear.first().click();
  else {
    await p
      .locator('button[aria-label="Account menu"], button[aria-label="账户菜单"]')
      .first()
      .click();
    await p.waitForTimeout(500);
    await p
      .getByText(/^(Settings|设置)$/)
      .first()
      .click();
  }
  await p.waitForTimeout(800);
  await p
    .getByText(/^Oh My Claude$/)
    .first()
    .click();
  await p.waitForTimeout(800);
};
/** Wait for the running turn to end: dsh's stop button goes, then a beat for the dock to settle. */
const settle = async (maxMs: number) => {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await p.waitForTimeout(2000);
    const running = await p.locator("[data-chat-running]").count();
    if (running === 0 && Date.now() - started > 6000) break;
  }
  await p.waitForTimeout(4000);
};

// 1. Settings: the switch is there and on.
await openSettings();
expect(
  "compact nudge switch on the Settings card",
  (await p.locator("[data-omc-compact-switch]").count()) === 1,
);
expect(
  "compact threshold picker under the switch, at the default",
  (await p.locator("[data-omc-compact-at] select").inputValue()) === "75",
);
expect(
  "compact nudge on by default",
  (await p.locator('[data-omc-compact-switch] [role="switch"]').getAttribute("aria-checked")) ===
    "true",
);
await p.keyboard.press("Escape");
await p.waitForTimeout(500);

// 2. A fresh session in the oh-my-claude workspace, one haiku turn that answers with a bash block.
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.locator('[role="treeitem"]').filter({ hasText: "oh-my-claude" }).first().hover();
await p.waitForTimeout(500);
await p.locator('button[aria-label="New session in oh-my-claude"]').first().click({ force: true });
await p.waitForTimeout(3000);
const composer = p.locator("[data-composer-input]").first();
await composer.click();
await p.keyboard.type(
  "Reply with exactly one fenced bash code block containing the single line: echo sweep-ok. No other text.",
);
await p.keyboard.press("Enter");
await settle(90_000);
const runButtons = p.locator("[data-omc-run]");
expect("a Run button on the bash block", (await runButtons.count()) >= 1);
await p.screenshot({ path: `${out}/sweep-run-button.png` });
if ((await runButtons.count()) >= 1) {
  const run = runButtons.first();
  expect(
    "Run is an icon with an aria-label, no browser title",
    (await run.getAttribute("title")) === null &&
      (await run.locator("svg").count()) === 1 &&
      (await run.getAttribute("aria-label")) !== null,
  );
  await run.scrollIntoViewIfNeeded();
  await run.hover();
  await p.waitForTimeout(400);
  const tip = p.locator("[data-omc-tip]");
  expect(
    "hovering Run shows a dsh-style bubble linked by aria-describedby",
    (await tip.count()) === 1 &&
      (await run.getAttribute("aria-describedby")) === (await tip.getAttribute("id")),
  );
  const box = await run.boundingBox();
  if (box)
    await p.screenshot({
      path: `${out}/sweep-run-tip.png`,
      clip: {
        x: Math.max(0, box.x - 440),
        y: Math.max(0, box.y - 60),
        width: 540,
        height: 110,
      },
    });
  const copy = p
    .locator(
      '[data-code-block-banner] button[aria-label="Copy"], [data-code-block-banner] button[aria-label="复制"]',
    )
    .first();
  if ((await copy.count()) > 0) {
    await copy.hover();
    await p.waitForTimeout(400);
    expect("moving to dsh's Copy takes our bubble down", (await tip.count()) === 0);
    const cbox = await copy.boundingBox();
    if (cbox)
      await p.screenshot({
        path: `${out}/sweep-copy-tip.png`,
        clip: {
          x: Math.max(0, cbox.x - 440),
          y: Math.max(0, cbox.y - 60),
          width: 540,
          height: 110,
        },
      });
  }
}

// 3. Run: the snippet lands in the composer as a draft; Enter sends it and the reply carries its output.
if ((await runButtons.count()) >= 1) {
  await runButtons.first().click();
  await p.waitForTimeout(500);
  const draft = await p.locator("[data-composer-input]").first().innerText();
  expect("Run wrote the snippet into the composer, unsent", draft.startsWith("Run this:"));
  await p.keyboard.press("Enter");
  await settle(90_000);
  const sent = await p.locator("text=Run this:").count();
  expect("Enter sent the snippet as a prompt", sent >= 1);
  const echoed = await p.locator("text=sweep-ok").count();
  expect("Claude ran it (sweep-ok appears more than in the block itself)", echoed >= 3);
  await p.screenshot({ path: `${out}/sweep-run-sent.png` });
}

// 4. The meter popover: plan windows carry a pace line when enough of the window has passed.
const ring = p.locator('button[aria-haspopup="dialog"]:has(circle + circle)').first();
if ((await ring.count()) > 0) {
  await ring.click();
  await p.waitForTimeout(3000);
  const paces = await p.locator("[data-omc-usage-pace]").allInnerTexts();
  console.log(`pace lines: ${JSON.stringify(paces)}`);
  expect(
    "a pace line under at least one plan window (or none early in the window)",
    paces.every((t) => /pace/i.test(t) || /速度/.test(t)),
  );
  await p.screenshot({ path: `${out}/sweep-pace.png` });
  await p.keyboard.press("Escape");
}

// 5. The compact card with the threshold at 1 %, then restored.
expect("hint lowered", (await hint({ compactNudgeAt: 1 })) === 200);
await p.waitForTimeout(2500);
const card = p.locator("[data-omc-compact-card]");
expect(
  "compact card shows once the threshold is below the session's fullness",
  (await card.count()) === 1,
);
await p.screenshot({ path: `${out}/sweep-compact-card.png` });
if ((await card.count()) === 1) {
  await p.locator("[data-omc-compact-now]").click();
  await settle(120_000);
  const compacted = await p.locator("text=/compact").count();
  expect("Compact sent /compact as a prompt", compacted >= 1);
  await p.screenshot({ path: `${out}/sweep-compacted.png` });
}
expect("hint restored", (await hint({ compactNudgeAt: null })) === 200);

// 6. MCP tab: a connected server shows its tool count.
await p
  .locator('button[aria-label*="Oh My Claude" i], [data-omc-panel-toggle]')
  .first()
  .click({ force: true })
  .catch(() => {});
await p.waitForTimeout(800);
const mcpTab = p.getByRole("tab", { name: /^(MCP)$/ }).first();
if ((await mcpTab.count()) > 0) {
  await mcpTab.click();
  await p.waitForTimeout(3000);
  const pills = await p.locator("[data-omc-mcp-tool-count]").allInnerTexts();
  console.log(`tool-count pills: ${JSON.stringify(pills.slice(0, 6))}`);
  expect("tool-count pill on at least one server", pills.length >= 1);
  await p.screenshot({ path: `${out}/sweep-mcp-count.png` });
} else console.log("MCP tab not found; skipped");

expect("no plugin console errors", errors.length === 0);
if (errors.length > 0) console.log(errors.join("\n"));
await b.close();
process.exit(failed === 0 ? 0 : 1);
