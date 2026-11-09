// Dev-only check: the "<version> available" pill beside the Oh My Claude heading in Settings. The
// box's own status is rewritten on the way to the page so npm appears to hold 1.0.1. The copy half
// must put the update command on the clipboard and announce it; the pill itself must close Settings
// and open the plugin's page in dsh's Plugins panel. Both at a desktop and a phone width.
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
  // dsh's first-run notice covers the page on a fresh profile.
  const notice = p.getByRole("button", { name: /^Continue$/ });
  if (await notice.count()) await notice.first().click();
  // A phone keeps the sidebar, and with it the Account menu, folded away until it is opened.
  const sidebar = p.getByRole("button", { name: /^Open sidebar$/ });
  if (width < 600 && (await sidebar.count())) await sidebar.first().click();
  // Since dsh 0.2.2 Settings sits in the Account menu at the foot of the sidebar.
  await p
    .getByRole("button", { name: /^Account menu$/ })
    .first()
    .click();
  await p.waitForTimeout(600);
  await p
    .getByText(/^Settings$/)
    .first()
    .click({ force: true });
  await p.waitForTimeout(800);
  await p
    .getByText(/^Oh My Claude$/)
    .first()
    .click({ force: true });
  await p.waitForTimeout(1500);
  const pill = p.locator("[data-omc-update]");
  const open = p.locator("[data-omc-update-open]");
  const shown = (await open.first().innerText()).trim();
  await pill.first().scrollIntoViewIfNeeded();
  await pill
    .first()
    .locator("xpath=..")
    .screenshot({ path: `${out}/update-pill-${label}.png` });
  await p.locator("[data-omc-update-copy]").first().click();
  await p.waitForTimeout(300);
  const said = await p.locator('[data-omc-update] [role="status"]').first().innerText();
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  await open.first().click();
  await p.waitForTimeout(2000);
  const settingsGone = (await p.locator("[data-omc-settings]").count()) === 0;
  // dsh's bundle page names the package under its title; the plugin list does not.
  const onPage = (await p.getByText(/^dsh-oh-my-claude$/).count()) > 0;
  const ok =
    shown === "1.0.1 available" &&
    said === "Command copied" &&
    clip === UPDATE &&
    settingsGone &&
    onPage;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${label}: shown=${JSON.stringify(shown)} said=${JSON.stringify(said)} clipboard=${JSON.stringify(clip)} settingsGone=${settingsGone} onPluginPage=${onPage}`,
  );
  if (!ok) failed = true;
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
