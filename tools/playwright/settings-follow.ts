// Dev-only check: the Terminal sync switch in Settings follows a change it did not make. The value
// is flipped through the route, the way another tab or device would, and the switch must show it
// once the tab comes back into view, with Settings left open; it used to keep the old value until
// Settings was reopened. Leaves the switch as it found it. Point PLAYWRIGHT_ROOT at any project
// with Playwright installed; arg 1 is the dsh launch token.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
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

const sw = p.locator('[data-omc-terminal-sync] [role="switch"]').first();
/** Whether the switch on the page reads on. */
const shown = async () => (await sw.getAttribute("aria-checked")) === "true";
/** Sets terminal sync through the route, bypassing the switch, as another tab would. */
const setElsewhere = (enabled: boolean) =>
  p.evaluate(
    (next) =>
      fetch("/dsh-oh-my-claude/terminal-sync", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      }).then((r) => r.ok),
    enabled,
  );
/** What a tab coming back into view fires. */
const comeBack = async () => {
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await p.waitForTimeout(900);
};

expect("the switch is on the page", (await sw.count()) === 1);
const before = await shown();
try {
  expect("the route took the change", await setElsewhere(!before));
  await p.waitForTimeout(600);
  expect("nothing pushes it, so the switch still shows the old value", (await shown()) === before);
  await comeBack();
  expect("back in view, the switch shows the new value", (await shown()) === !before);
} finally {
  await setElsewhere(before);
  await comeBack();
}
expect("restored, the switch shows the first value again", (await shown()) === before);

await b.close();
process.exit(failed ? 1 : 0);
