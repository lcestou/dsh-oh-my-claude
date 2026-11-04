// Dev-only check: the "Default for new Claude sessions" dropdown follows the Models block. Hiding a
// model there drops it from the dropdown and showing it brings it back, with no refresh; the row
// used to read the list once and keep hidden models until Settings was reopened. Leaves the switch
// as it found it. Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh
// launch token, arg 2 (optional) the model id to toggle.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const modelId = process.argv[3] ?? "claude-haiku-5-5";
const b = await launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
let failed = 0;
/** One line per expectation; a miss counts toward the exit code. */
const expect = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};

await p.goto(dshUrl(token), { waitUntil: "load" });
await p.waitForTimeout(2500);
// Settings sits behind a gear on older dsh and in the account menu on newer; both languages.
const gear = p.locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]');
if (await gear.count()) await gear.first().click();
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
await p.waitForTimeout(1800);
await p.locator("[data-omc-models-block] > summary").first().click();
await p.waitForTimeout(800);

const options = p.locator("[data-omc-new-session-model] option");
/** The model ids the default dropdown offers, read from each option's `provider\nmodel` value. */
const values = async () =>
  (await options.evaluateAll((els) => els.map((e) => e.getAttribute("value") ?? ""))).map(
    (v) => v.split("\n")[1] ?? "",
  );
const sw = p.locator(`[data-omc-model-row="${modelId}"] [role="switch"]`).first();
expect(`a switch for ${modelId} in the Models block`, (await sw.count()) === 1);
const startsOn = (await sw.getAttribute("aria-checked")) === "true";
expect(
  `${modelId} listed in the default dropdown while on`,
  !startsOn || (await values()).includes(modelId),
);
await sw.click();
await p.waitForTimeout(1500);
const afterFirst = (await values()).includes(modelId);
expect(`the dropdown follows the switch without a refresh`, afterFirst === !startsOn);
await sw.click();
await p.waitForTimeout(1500);
expect(`and follows it back`, (await values()).includes(modelId) === startsOn);
expect(
  `the switch is back as it was`,
  ((await sw.getAttribute("aria-checked")) === "true") === startsOn,
);
await b.close();
process.exit(failed ? 1 : 0);
