// Dev-only check: the MCP tab's Common connector dropdown fills the Add form. Point
// PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const item = p.locator('[role="treeitem"]').first();
if (await item.count()) {
  await item.click({ force: true });
  await p.waitForTimeout(2000);
}
await p.locator('button[aria-label="Oh My Claude"]').click();
await p.waitForTimeout(800);
await p.locator('[role="tab"]', { hasText: /^MCP/ }).first().click();
await p.waitForTimeout(800);
await p
  .getByRole("button", { name: /^Add server$/ })
  .first()
  .click();
await p.waitForTimeout(600);
const panel = '[role="dialog"][aria-label="Oh My Claude"]';
const connector = p.locator(`${panel} select`).filter({ hasText: "Common connector" }).first();
await connector.selectOption("github");
await p.waitForTimeout(300);
const name = await p.locator(`${panel} input[placeholder="Server name"]`).first().inputValue();
const url = await p.locator(`${panel} input[placeholder^="URL"]`).first().inputValue();
const transport = await p
  .locator(`${panel} select`)
  .filter({ hasText: "Stdio" })
  .first()
  .inputValue();
console.log("github =>", JSON.stringify({ name, transport, url }));
await connector.selectOption("notion");
await p.waitForTimeout(300);
const name2 = await p.locator(`${panel} input[placeholder="Server name"]`).first().inputValue();
const url2 = await p.locator(`${panel} input[placeholder^="URL"]`).first().inputValue();
console.log("notion =>", JSON.stringify({ name: name2, url: url2 }));
const ok =
  name === "github" &&
  transport === "http" &&
  url === "https://api.githubcopilot.com/mcp/" &&
  name2 === "notion" &&
  url2 === "https://mcp.notion.com/mcp";
console.log(ok ? "PASS: connector presets fill the form" : "FAIL: preset fill");
await p.screenshot({ path: "/tmp/pw/mcp-preset.png" });
await b.close();
