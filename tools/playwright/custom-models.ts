// Dev-only check: the Models block's "Add a model" form. Adds a model, expects it once among the
// block's rows with a switch, its size and a Remove, expects a refused id to keep the draft and
// say why, changes the size on the row, then removes the model again unless told to keep it. Also checks that the row follows the
// box's route: on a box that talks to Anthropic an added model is marked as waiting for a router
// and the block says so; on a routed box, or one whose route cannot be told, it is listed. Point PLAYWRIGHT_ROOT at any project
// with Playwright installed and DSH_ORIGIN at the dsh to drive; arg 1 is the dsh launch token,
// arg 2 (optional) a folder for screenshots, arg 3 `keep` to leave the model in place.
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw", keep] = process.argv.slice(2);
// A fresh id each run: once a session has run on a custom model, Claude Code's own lineup lists
// it, and that row stays after the Settings entry is removed. A reused id would fail the last
// expectation for that reason and not for one the form can do anything about.
const MODEL = `omc-check-${Date.now().toString(36)}`;
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

// With more than one box each is a fold of its own, shut by default; with one, the rows show.
const boxFold = p.locator("details[data-omc-models-box] > summary").first();
if (await boxFold.count()) {
  await boxFold.click();
  await p.waitForTimeout(400);
}
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
const row = p.locator(`[data-omc-model-row="${MODEL}"]`);
expect("the model shows once, as a row", (await row.count()) === 1);
expect("with a switch", (await row.locator('[role="switch"]').count()) === 1);
expect(
  "with a Remove on the row",
  (await row.locator("[data-omc-custom-model-remove]").count()) === 1,
);
const rowSize = row.locator("[data-omc-model-size-pick]");
expect("and with the size it was added with", (await rowSize.inputValue()) === "128000");
expect(
  "the form is cleared after an add",
  (await editor.locator("[data-omc-custom-model-id]").inputValue()) === "",
);
// The Settings read, which carries every row and each box's route.
interface BoxRead {
  provider: string;
  route?: { state: string };
  models: { id: string; off?: boolean; window?: number }[];
}
/** Every box's rows as the Settings card reads them. */
const readBoxes = () =>
  p.evaluate(async (): Promise<BoxRead[]> => {
    const r = await fetch("/dsh-oh-my-claude/models?all=1");
    return (await r.json()).models;
  });
const boxes = await readBoxes();
const provider = (await editor.getAttribute("data-omc-custom-models")) ?? "";
const read = boxes.find((box) => box.provider === provider);
const served = read?.models.find((m) => m.id === MODEL);
expect("GET /models?all=1 carries the added model", served !== undefined);
// The route decides whether the picker lists it, and the block says which it is.
const state = read?.route?.state ?? "";
const line = p.locator(`[data-omc-models-box="${provider}"] [data-omc-route-line]`).first();
expect("the box says where its traffic goes", ["direct", "routed", "unknown"].includes(state));
expect(
  "the block's line carries the same state",
  (await line.getAttribute("data-omc-route-line")) === state,
);
const marked =
  (await p.locator(`[data-omc-model-row="${MODEL}"] [data-omc-model-off]`).count()) === 1;
expect(
  state === "direct"
    ? "talking to Anthropic: the added model waits for a router, and its row says so"
    : "routed, or not known: the added model is listed",
  marked === (state === "direct") && (served?.off ?? false) === (state === "direct"),
);
if (state === "direct")
  expect("and the block explains the waiting rows", (await line.innerText()).trim() !== "");
console.log(`route: ${provider} is ${state}`);
// The size is changed on the row itself, and the server's rows follow: a named size, then an
// exact one typed under Other, which must come back as typed and not rounded to a neighbour.
/** The window the server's row for the model reports right now; undefined when it has no row. */
const windowNow = async () =>
  (await readBoxes()).find((box) => box.provider === provider)?.models.find((m) => m.id === MODEL)
    ?.window;
await rowSize.selectOption("256000");
await p.waitForTimeout(1500);
expect("a size picked on the row is stored", (await windowNow()) === 256_000);
await rowSize.selectOption("other");
await p.waitForTimeout(300);
const exact = row.locator("[data-omc-model-size-tokens]");
await exact.fill("262144");
await p.keyboard.press("Enter");
await p.waitForTimeout(1500);
expect("an exact size typed under Other is stored as typed", (await windowNow()) === 262_144);
expect("and the row still shows it as Other", (await rowSize.inputValue()) === "other");
await p.screenshot({ path: `${out}/custom-models-sized.png` });
await p.screenshot({ path: `${out}/custom-models-added.png` });

if (keep !== "keep") {
  await row.locator("[data-omc-custom-model-remove]").click();
  // The block re-reads every box after a save, and a box whose CLI lineup is not cached yet can
  // take a few seconds to answer, so the row is waited for rather than given a fixed pause.
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(500);
    if ((await p.locator(`[data-omc-model-row="${MODEL}"]`).count()) === 0) break;
  }
  expect(
    "Remove takes it out of the block's rows",
    (await p.locator(`[data-omc-model-row="${MODEL}"]`).count()) === 0,
  );
}
await b.close();
process.exit(failed === 0 ? 0 : 1);
