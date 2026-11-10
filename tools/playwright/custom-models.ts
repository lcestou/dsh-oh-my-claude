// Dev-only check: the Models block's "Add a model" form. Adds a model, expects it among the added
// models and in the block's own rows with a switch, expects a refused id to keep the draft and say
// why, then removes the model again unless told to keep it. Point PLAYWRIGHT_ROOT at any project
// with Playwright installed and DSH_ORIGIN at the dsh to drive; arg 1 is the dsh launch token,
// arg 2 (optional) a folder for screenshots, arg 3 `keep` to leave the model in place.
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw", keep] = process.argv.slice(2);
const MODEL = "omc-check-model";
const NAME = "Check Model";
const b = await launch();
// Dark, the way the owner runs dsh: a form that only holds in light mode is not checked.
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, colorScheme: "dark" });
const p = await ctx.newPage();
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

const editor = p.locator("[data-omc-custom-models]").first();
expect("the block has an Add a model part", (await editor.count()) === 1);
await editor.locator("[data-omc-custom-models-add] > summary").click();
await p.waitForTimeout(300);
const add = editor.locator("[data-omc-custom-model-add]");
expect("Add is off while the id is empty", await add.isDisabled());

// A refused id: the server's sentence shows, the draft stays, nothing is listed.
await editor.locator("[data-omc-custom-model-id]").fill("two words");
await add.click();
await p.waitForTimeout(800);
const refusal = editor.locator("[data-omc-custom-model-error]");
expect("a refused id says why", (await refusal.count()) === 1);
expect(
  "the draft is kept after a refusal",
  (await editor.locator("[data-omc-custom-model-id]").inputValue()) === "two words",
);
await p.screenshot({ path: `${out}/custom-models-refused.png` });

await editor.locator("[data-omc-custom-model-id]").fill(MODEL);
await editor.locator("[data-omc-custom-model-name]").fill(NAME);
// The window is a dropdown of the common sizes; "Other" opens a field for an exact number.
const size = editor.locator("[data-omc-custom-model-window]");
await size.selectOption("other");
await p.waitForTimeout(200);
expect(
  "Other opens a field for the exact size",
  (await editor.locator("[data-omc-custom-model-tokens]").count()) === 1,
);
await size.selectOption("128000");
await p.waitForTimeout(200);
expect(
  "a named size needs no field",
  (await editor.locator("[data-omc-custom-model-tokens]").count()) === 0,
);
await add.click();
await p.waitForTimeout(1500);
expect(
  "the model is among the added models",
  (await p.locator(`[data-omc-custom-model="${MODEL}"]`).count()) === 1,
);
expect(
  "the block lists it as a row with a switch",
  (await p.locator(`[data-omc-model-row="${MODEL}"] [role="switch"]`).count()) === 1,
);
expect(
  "the form is cleared after an add",
  (await editor.locator("[data-omc-custom-model-id]").inputValue()) === "",
);
// The picker's own list, which is what a session's model menu reads.
const listed = await p.evaluate(async () => {
  const r = await fetch("/dsh-oh-my-claude/models?all=1");
  return JSON.stringify(await r.json());
});
expect("GET /models?all=1 carries the added model", listed.includes(`"${MODEL}"`));
await p.screenshot({ path: `${out}/custom-models-added.png` });

if (keep !== "keep") {
  await p.locator(`[data-omc-custom-model="${MODEL}"] [data-omc-custom-model-remove]`).click();
  await p.waitForTimeout(1500);
  expect(
    "Remove takes it out of the added models",
    (await p.locator(`[data-omc-custom-model="${MODEL}"]`).count()) === 0,
  );
  expect(
    "and out of the block's rows",
    (await p.locator(`[data-omc-model-row="${MODEL}"]`).count()) === 0,
  );
}
await b.close();
process.exit(failed === 0 ? 0 : 1);
