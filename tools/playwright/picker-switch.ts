// Dev-only check: the ✻ button follows the model picker on a session that has not been typed in.
//
// Opens a new session, picks a model from another provider (the first row that is not one of this
// plugin's), then picks a Claude row, and times how long the composer's Oh My Claude button takes
// to appear with the composer untouched. Before 2026-09-16 it waited for the first keystroke. Also
// prints every row the picker lists, name and detail, which is the surface the naming pass changed.
//
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

// A blank session of its own, so the switch below never rewrites a real session's model.
await p.locator('button[aria-label="New session"]').first().click();
await p.waitForTimeout(1500);
console.log("url:", p.url());

const trigger = p.locator('button[aria-label^="Select model"]').first();
const button = p.locator('button[aria-label="Oh My Claude"]');
// dsh's picker is two levels: the trigger opens Model and Effort, and Model opens the groups.
const openPicker = async () => {
  await trigger.click();
  await p.waitForTimeout(500);
  await p.locator('[role="menu"] [role="menuitem"]', { hasText: "Model" }).first().click();
  await p.waitForTimeout(600);
};
const groupRows = (group: string | RegExp) =>
  p.locator('[role="group"]', { hasText: group }).first().locator('[role="menuitemradio"]');

await openPicker();
const groups = p.locator('[role="group"]');
for (let i = 0; i < (await groups.count()); i++) {
  const g = groups.nth(i);
  const names = await g.locator('[role="menuitemradio"]').allInnerTexts();
  console.log((await g.innerText()).split("\n")[0], `(${names.length})`);
  for (const n of names) console.log("  ", n.replace(/\n/g, " · "));
}

// Another provider's row first: the one named in OMC_OTHER_PROVIDER when the box has it, else the
// first group that is not one of this plugin's mounts. The name is read from the environment
// rather than written here, because a provider id is whatever the person running the check chose.
// Escaped, so the id is matched as the literal text it is: a provider named `a.b` must not match
// `axb`, and one holding an unclosed `[` must not throw and fail the whole check.
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const otherName = new RegExp(literal(process.env.OMC_OTHER_PROVIDER ?? "local-llm"));
const other = (await groupRows(otherName).count())
  ? groupRows(otherName)
  : groups.first().locator('[role="menuitemradio"]');
const otherLabel = (await other.first().innerText()).split("\n")[0];
await other.first().click();
await p.waitForTimeout(1200);
console.log("picked:", otherLabel, "| seat:", await trigger.getAttribute("aria-label"));
console.log("button while on other provider:", await button.count());

await openPicker();
const claude = groupRows("Oh My Claude").first();
const claudeLabel = (await claude.innerText()).split("\n")[0];
const t0 = Date.now();
await claude.click();
let shown = -1;
while (Date.now() - t0 < 4000) {
  if ((await button.count()) > 0) {
    shown = Date.now() - t0;
    break;
  }
  await p.waitForTimeout(50);
}
console.log("picked:", claudeLabel, "| seat:", await trigger.getAttribute("aria-label"));
console.log(
  shown < 0
    ? "FAIL: ✻ button not up 4 s after picking a Claude model, composer untouched"
    : `PASS: ✻ button up ${shown} ms after the pick, composer untouched`,
);
await b.close();
process.exit(shown < 0 ? 1 : 0);
