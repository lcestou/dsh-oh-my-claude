// Dev-only check for the five features built on this branch (return recap switch, Ask/review on Changes
// tab, permission rules and hooks readout, per-server MCP Always ask). Point PLAYWRIGHT_ROOT at any
// project with Playwright. Usage: bun tools/playwright/five.ts <token> [/tmp/pw]
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw"] = process.argv.slice(2);
const b = await launch();
const ctx = await b.newContext({
  viewport: { width: 1400, height: 900 },
  colorScheme: "dark",
});
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

// Pick a session so the plugin panel has something to render.
const item = p.locator('[role="treeitem"]').first();
if (await item.count()) {
  await item.click({ force: true });
  await p.waitForTimeout(2000);
}
await p.locator('button[aria-label="Oh My Claude"]').click();
await p.waitForTimeout(800);

const failures: string[] = [];
const expect = (cond: boolean, what: string) => {
  if (!cond) failures.push(what);
};

// a. Changes tab: read the totals line to decide clean vs dirty, assert only the matching case.
await p
  .locator('[role="tab"]', { hasText: /^Changes/ })
  .first()
  .click();
await p.waitForTimeout(1000);
const askAllCount = await p.locator("[data-omc-diff-ask-all]").count();
if (askAllCount > 0) {
  console.log("note: dirty working tree exercised");
  expect(
    (await p.locator("[data-omc-diff-review]").count()) > 0,
    "dirty: both Ask all and Review render",
  );
  expect(
    (await p.locator("[data-omc-diff-ask]").count()) > 0,
    "dirty: at least one per-file Ask renders",
  );
} else {
  const cleanLines = await p.getByText(/^Working tree clean$/).all();
  if (cleanLines.length === 1) {
    console.log("note: clean working tree exercised");
    expect(
      (await p.locator("[data-omc-diff-review]").count()) === 0 &&
        (await p.locator("[data-omc-diff-ask-all]").count()) === 0 &&
        (await p.locator("[data-omc-diff-ask]").count()) === 0,
      "clean: none of the three controls render",
    );
  } else {
    console.log("note: totals line did not match either case; both skipped");
  }
}
await p.screenshot({ path: `${out}/five-changes.png` });

// b. Diagnostics: permission rules and hooks containers render whether or not a process is live.
await p
  .locator('[role="tab"]', { hasText: /^Diagnostics/ })
  .first()
  .click();
await p.waitForTimeout(1000);
expect(
  (await p.locator("[data-omc-permission-rules]").count()) === 1,
  "permission rules container renders",
);
expect((await p.locator("[data-omc-hooks]").count()) === 1, "hooks container renders");
await p.screenshot({ path: `${out}/five-diagnostics.png` });

// d. MCP tab: each Always ask button on a server row reads aria-pressed="false" without being clicked.
await p.locator('[role="tab"]', { hasText: /^MCP/ }).first().click();
await p.waitForTimeout(1000);
const mcpButtons = await p.locator("[data-omc-mcp-ask]").all();
if (mcpButtons.length > 0) {
  for (const btn of mcpButtons) {
    const pressed = await btn.getAttribute("aria-pressed");
    expect(
      pressed === "false",
      `MCP ask button aria-pressed is "false" (${JSON.stringify(pressed)})`,
    );
    // One accessible name per row, not the same "Always ask" on every one of them.
    const askLabel = await btn.getAttribute("aria-label");
    expect(
      askLabel !== null &&
        askLabel.startsWith("Always ask: ") &&
        askLabel.length > "Always ask: ".length,
      `MCP ask button names its server (${JSON.stringify(askLabel)})`,
    );
  }
  // Nothing here clicks: the Claude behind these rows is the owner's daily driver, and an override
  // it did not ask for would outlive this script. What a click does is covered by the route test in
  // src/sessions.test.ts and by the adapter test for setMcpAsk.
} else {
  console.log("note: no MCP server rows present; button assertions skipped");
}
await p.screenshot({ path: `${out}/five-mcp.png` });

// e. Return recap row, in Settings rather than a tab: renders, reads off, and keeps its away-time
// dropdown hidden until it is on. Last, because opening Settings leaves the dialog every block above
// it needs. Nothing here clicks any more: the switch used to be this browser's own localStorage, and
// a throwaway context made a click free, but it is a box-wide hint now and a click would turn the
// owner's recap on for good. What a flip does is covered by the hint readers in notices.test.ts.
await p
  .locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]')
  .first()
  .click({ force: true });
await p.waitForTimeout(800);
await p
  .getByText(/^Oh My Claude$/)
  .first()
  .click({ force: true });
await p.waitForTimeout(1500);
expect((await p.locator("[data-omc-recap-switch]").count()) === 1, "recap switch renders");
const recapSwitch = p.locator("[data-omc-recap-switch] [role=switch]").first();
const recapState = await recapSwitch.getAttribute("aria-checked");
expect(
  recapState === "true" || recapState === "false",
  `recap switch publishes its state (got ${JSON.stringify(recapState)})`,
);
// The dropdown follows the switch: it is a bar for something that never fires while the switch is
// off, so an off switch beside a visible dropdown is the bug this catches.
const awayRows = await p.locator("[data-omc-recap-away]").count();
expect(
  awayRows === (recapState === "true" ? 1 : 0),
  `away dropdown shows only with the recap on (switch ${recapState}, rows ${awayRows})`,
);
await p.screenshot({ path: `${out}/five-settings.png` });

console.log(failures.length === 0 ? "PASS" : `FAIL: ${failures.join("; ")}`);
await ctx.close();
await b.close();
process.exit(failures.length === 0 ? 0 : 1);
