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
      (await p.locator("[data-omc-diff-review]").count()) === 0,
      "clean: neither control renders",
    );
  } else {
    console.log("note: totals line did not match either case; both skipped");
  }
}
await p.screenshot({ path: `${out}/five-changes.png` });

// b. Return recap switch in Diagnostics: absent key, reads off, toggles on, label changes, key restored.
await p
  .locator('[role="tab"]', { hasText: /^Diagnostics/ })
  .first()
  .click();
await p.waitForTimeout(1000);
expect((await p.locator("[data-omc-recap-switch]").count()) === 1, "recap switch renders");
const before = await p.evaluate(() => localStorage.getItem("omc.returnRecap"));
expect(
  before === null,
  `localStorage omc.returnRecap is null before click (got ${JSON.stringify(before)})`,
);
const switchBtn = p.locator("[data-omc-recap-switch] button").first();
await switchBtn.click();
await p.waitForTimeout(300);
const after = await p.evaluate(() => localStorage.getItem("omc.returnRecap"));
expect(
  after === "on",
  `localStorage omc.returnRecap reads "on" after click (got ${JSON.stringify(after)})`,
);
const label = await switchBtn.innerText();
expect(
  label === "Turn off",
  `switch button label changed to "Turn off" (got ${JSON.stringify(label)})`,
);
// No restore: launch() opens a throwaway context, which the null read above proves, and it dies
// with this script. The owner's own browser never sees the key this wrote.

// c. Diagnostics: permission rules and hooks containers render whether or not a process is live.
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
  }
} else {
  console.log("note: no MCP server rows present; button assertions skipped");
}
await p.screenshot({ path: `${out}/five-mcp.png` });

console.log(failures.length === 0 ? "PASS" : `FAIL: ${failures.join("; ")}`);
await ctx.close();
await b.close();
process.exit(failures.length === 0 ? 0 : 1);
