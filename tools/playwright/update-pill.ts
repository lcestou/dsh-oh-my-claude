// Dev-only check: the "<version> available" pill on the This box row. The box's own status is
// rewritten on the way to the page so npm appears to hold 1.0.1; the click must put the update
// command on the clipboard and the pill must say so for a moment, at a desktop and a phone width.
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token,
// arg 2 a directory for the screenshots.
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw"] = process.argv.slice(2);
const UPDATE = "dsh plugin --profile web update dsh-oh-my-claude";
const b = await launch();
let failed = false;
for (const [label, width] of [
  ["desktop", 1400],
  ["phone", 390],
] as const) {
  const ctx = await b.newContext({
    viewport: { width, height: 844 },
    colorScheme: "dark",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const p = await ctx.newPage();
  await p.route("**/dsh-oh-my-claude/status", async (route) => {
    const r = await route.fetch();
    const real = await r.json();
    await route.fulfill({ response: r, json: { ...real, latest: "1.0.1", update: UPDATE } });
  });
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
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
  // A phone keeps dsh's sidebar over the page until it is collapsed.
  const collapse = p.getByRole("button", { name: /^Collapse sidebar$/ });
  if (width < 600 && (await collapse.count())) {
    await collapse.first().click({ force: true });
    await p.waitForTimeout(600);
  }
  const pill = p.locator("[data-omc-update]");
  if (!(await pill.count())) {
    await p
      .locator("#dsh-oh-my-claude-boxes")
      .locator("button, summary, [role=button]", { hasText: /^Boxes$/ })
      .first()
      .click({ force: true });
    await p.waitForTimeout(1500);
  }
  const shown = await pill.first().innerText();
  await pill.first().scrollIntoViewIfNeeded();
  await pill
    .first()
    .locator("xpath=..")
    .screenshot({ path: `${out}/update-pill-${label}.png` });
  await pill.first().click();
  await p.waitForTimeout(300);
  const after = await pill.first().innerText();
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  await p.waitForTimeout(1500);
  const back = await pill.first().innerText();
  const ok =
    shown === "1.0.1 available" && after === "command copied" && clip === UPDATE && back === shown;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${label}: shown=${JSON.stringify(shown)} after=${JSON.stringify(after)} clipboard=${JSON.stringify(clip)} back=${JSON.stringify(back)}`,
  );
  if (!ok) failed = true;
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
