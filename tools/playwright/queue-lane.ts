// Dev-only check: an edit moves a pending message between dsh's queue and its steer list. Needs a
// dsh whose "Send behavior while busy" is Steer and a skill Claude Code has (arg 2, default
// `unslop`). Starts a turn that sleeps, then:
//   1. types `/<skill> …`, which the command bridge queues; edits that row in dsh's queue dock into
//      plain text and expects it to leave the dock and show on the plugin's steer card;
//   2. edits that steer on the card into `/<skill> …` and expects it back in the queue dock.
// The queue dock and the composer are dsh's own, so this check selects them by dsh's hooks and
// labels (both languages); nothing of the plugin's stands in for them. Costs one short Claude turn.
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token.
// Run it against a scratch dsh: it opens a session and leaves it behind.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const skill = process.argv[3] ?? "unslop";
const b = await launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
let failed = 0;
/** One line per expectation; a miss counts toward the exit code. */
const expect = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
/** Polls `read` until it answers true or `ms` have passed. */
const until = async (read: () => Promise<boolean>, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await read()) return true;
    await p.waitForTimeout(300);
  }
  return read();
};

await p.goto(dshUrl(token), { waitUntil: "load" });
await p.waitForTimeout(3000);
const input = p.locator("[data-composer-input]").first();
const dock = p.locator("[data-queue-dock]");
const card = p.locator("[data-omc-steer-card]");
/** Types into the composer and sends with Enter. */
const send = async (text: string) => {
  await input.click();
  await p.keyboard.type(text);
  await p.waitForTimeout(400);
  await p.keyboard.press("Enter");
};

await send(
  "Use the Bash tool to run `sleep 20` and then `sleep 20` again as two separate calls. Then reply with every extra instruction you were given while they ran.",
);
expect(
  "the turn is running",
  await until(
    async () => (await p.locator('[data-omc-turn-status], [role="status"]').count()) > 0,
    20_000,
  ),
);
await p.waitForTimeout(6000);

// 1. A skill line typed mid-turn is queued by the bridge. The slash menu may take the first Enter.
await send(`/${skill} the first line`);
if (!(await until(async () => (await dock.count()) > 0, 4000))) await p.keyboard.press("Enter");
expect(
  "the skill line waits in dsh's queue",
  await until(async () => (await dock.count()) > 0, 6000),
);
expect("and is not on the steer card", (await card.count()) === 0);

await dock
  .locator('button[aria-label="Edit queued message"], button[aria-label="编辑排队消息"]')
  .first()
  .click();
const dockText = dock.locator("textarea").first();
await dockText.fill("Extra instruction: the code word is PINEAPPLE.");
await dock
  .locator('button[aria-label="Save queued message"], button[aria-label="保存排队消息"]')
  .first()
  .click();
expect(
  "edited into plain text, it leaves the queue",
  await until(async () => (await dock.count()) === 0, 6000),
);
expect(
  "and shows on the steer card",
  await until(
    async () => (await card.count()) > 0 && (await card.first().innerText()).includes("PINEAPPLE"),
    6000,
  ),
);

// 2. That steer, edited into a skill line, goes back to the queue. Skipped when Claude already read it.
if ((await card.count()) > 0) {
  await card
    .locator('button[aria-label="Edit this message"], button[aria-label="编辑这条消息"]')
    .first()
    .click();
  const held = p.locator("[data-omc-steer-input]").first();
  if (await until(async () => (await held.count()) > 0, 4000)) {
    await held.fill(`/${skill} the second line`);
    await p.locator("[data-omc-steer-save]").first().click();
    expect(
      "a steer edited into a skill line waits in the queue",
      await until(
        async () =>
          (await dock.count()) > 0 && (await dock.first().innerText()).includes(`/${skill}`),
        6000,
      ),
    );
    expect(
      "and has left the steer card",
      await until(async () => (await card.count()) === 0, 4000),
    );
  } else console.log("SKIP steer to queue: Claude had read the steer before it could be edited");
} else console.log("SKIP steer to queue: no steer on the card");

await b.close();
process.exit(failed ? 1 : 0);
