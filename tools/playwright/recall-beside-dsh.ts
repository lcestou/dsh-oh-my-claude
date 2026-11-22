// Dev-only check: the plugin's prompt recall with dsh's own one present (dsh 0.2.3-alpha.1 added
// "Press ↑ in an empty composer to recall sent text"). Both answer the same key, so each case here
// names who should take it and what the box must hold after. One step per press is the main
// thing to catch: if both ever handled one press, the walk would skip every other prompt.
//
// It creates sessions and sends a few one-word Claude turns, so point it at a scratch dsh, not the
// box's live one:
//
//   PLAYWRIGHT_ROOT=<project with playwright> DSH_ORIGIN=http://127.0.0.1:<port> \
//   PW_WORKSPACE=<workspace name> PW_STATE=<scratch DSH_OMC_STATE_DIR> \
//   bun tools/playwright/recall-beside-dsh.ts <dsh token>
//
// PW_STATE lets the last case write `recallOff` into the scratch plugin's hints file. Without it,
// that case is skipped. PW_OTHER_MODEL names a picker group for a non-Claude model (dsh's recall
// alone); without it that case is skipped too. Exits 1 on any FAIL.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dshUrl, launch, type Page } from "./pw.js";

const token = process.argv[2];
if (!token) throw new Error("usage: bun recall-beside-dsh.ts <dsh token>");
const workspace = process.env.PW_WORKSPACE ?? "";
const state = process.env.PW_STATE;
const otherModel = process.env.PW_OTHER_MODEL;

let failed = 0;
/** Prints one verdict line with its evidence and counts a failure. */
const verdict = (ok: boolean, what: string, evidence: string): void => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}  [${evidence.replace(/\s+/g, " ").slice(0, 120)}]`);
};

const browser = await launch();
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  colorScheme: "dark",
});
const page = await context.newPage();
await page.goto(dshUrl(token), { waitUntil: "load" });
await page.waitForTimeout(3000);

/** dsh's composer editor; the first one, which is the open session's. */
const box = (p: Page) => p.locator("[data-composer-input]").first();
/** The composer's text as a person sees it, trimmed. The editor renders each line as a
 *  paragraph, which innerText separates with blank lines, so runs of newlines count as one. */
const held = async (p: Page): Promise<string> =>
  (await box(p).innerText()).replace(/\n+/g, "\n").trim();
/** Presses `key` and waits long enough for the plugin's first read of the transcript route. */
const press = async (p: Page, key: string, ms = 700): Promise<string> => {
  await p.keyboard.press(key);
  await p.waitForTimeout(ms);
  return held(p);
};
/** Empties the composer without leaving a recall walk behind. */
const clear = async (p: Page): Promise<void> => {
  await box(p).click();
  await p.keyboard.press("Control+A");
  await p.keyboard.press("Backspace");
  await p.waitForTimeout(300);
};

/** A blank session in the workspace PW_WORKSPACE names. */
const newSession = async (p: Page): Promise<void> => {
  if (workspace)
    await p.locator('[role="treeitem"]', { hasText: workspace }).first().click({ force: true });
  await p.waitForTimeout(800);
  await p
    .locator('button[aria-label="New session"], button[aria-label="新建会话"]')
    .first()
    .click();
  await p.waitForTimeout(2000);
};
/** Picks the first row of the picker group whose text matches `group`; returns the seat label. */
const pickModel = async (p: Page, group: RegExp, row?: RegExp): Promise<string> => {
  const seat = p
    .locator('button[aria-label^="Select model"], button[aria-label^="选择模型"]')
    .first();
  await seat.click();
  await p.waitForTimeout(500);
  await p
    .locator('[role="menu"] [role="menuitem"]', { hasText: /^(Model|模型)/ })
    .first()
    .click();
  await p.waitForTimeout(600);
  const rows = p
    .locator('[role="group"]:not(:has([role="group"]))', { hasText: group })
    .first()
    .locator('[role="menuitemradio"]');
  const target = row ? rows.filter({ hasText: row }).first() : rows.first();
  await target.click();
  await p.waitForTimeout(1500);
  return (await seat.getAttribute("aria-label")) ?? "";
};
/** Types `lines` (Shift+Enter between them), sends, and waits for the turn's status row. A Claude
 *  turn closes on the plugin's "✻" line; any other model's on dsh's own row, so success there is
 *  a row that is not a failure. */
const send = async (p: Page, lines: string[]): Promise<boolean> => {
  const rows = p.locator("button[data-turn-process]");
  const before = await rows.count();
  await clear(p);
  for (const [i, line] of lines.entries()) {
    if (i > 0) await p.keyboard.press("Shift+Enter");
    await p.keyboard.type(line);
  }
  await p.keyboard.press("Enter");
  for (let waited = 0; waited < 90_000; waited += 1000) {
    await p.waitForTimeout(1000);
    if ((await rows.count()) > before) {
      await p.waitForTimeout(1500);
      return !/Failed|Interrupted|处理失败|已中断/.test((await rows.allInnerTexts()).at(-1) ?? "");
    }
  }
  return false;
};

// One Claude session with three prompts, the middle one on three lines.
await newSession(page);
console.log(`seat: ${await pickModel(page, /Oh My Claude/, /Haiku/)}`);
const one = "Reply with the single word alpha.";
const two = ["Reply with the single word beta.", "This is the second line.", "And a third line."];
const three = "Reply with the single word gamma.";
for (const lines of [[one], two, [three]])
  verdict(await send(page, lines), "turn answers", lines[0] ?? "");
const twoText = two.join("\n");

// 1. The walk: one step per press, both ways, back to an empty box.
await clear(page);
verdict(
  (await press(page, "ArrowUp", 1500)) === three,
  "Up from empty recalls the newest prompt",
  await held(page),
);
verdict(
  (await press(page, "ArrowUp")) === twoText,
  "second Up steps exactly one back (multi-line prompt whole)",
  await held(page),
);
verdict(
  (await press(page, "ArrowUp")) === one,
  "third Up steps exactly one back",
  await held(page),
);
verdict(
  (await press(page, "ArrowUp")) === one,
  "Up past the oldest stays on the oldest",
  await held(page),
);
verdict(
  (await press(page, "ArrowDown")) === twoText,
  "Down steps exactly one forward",
  await held(page),
);
verdict((await press(page, "ArrowDown")) === three, "Down again", await held(page));
verdict(
  (await press(page, "ArrowDown")) === "",
  "Down past the newest empties the box",
  await held(page),
);

// 2. The edit lock: from inside an unedited multi-line recall, Up still steps.
await clear(page);
await press(page, "ArrowUp", 1500);
await press(page, "ArrowUp");
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(200);
verdict(
  (await press(page, "ArrowUp")) === one,
  "Up with the caret inside an unedited recall steps (edit lock)",
  await held(page),
);

// 3. An edit hands the arrows back to the editor: nobody recalls over typed text.
await page.keyboard.press("End");
await page.keyboard.type("!");
const edited = await held(page);
verdict(
  (await press(page, "ArrowUp")) === edited,
  "after a typed character Up recalls nothing (ours or dsh's)",
  await held(page),
);
verdict((await press(page, "ArrowDown")) === edited, "and Down recalls nothing", await held(page));

// 4. A draft is never overwritten.
await clear(page);
await page.keyboard.type("a draft in progress");
verdict(
  (await press(page, "ArrowUp", 1200)) === "a draft in progress",
  "Up in a typed draft leaves it alone",
  await held(page),
);

// 5. Modifiers and Down from empty are not recall.
await clear(page);
verdict(
  (await press(page, "Shift+ArrowUp")) === "",
  "Shift+Up from empty recalls nothing",
  await held(page),
);
verdict(
  (await press(page, "ArrowDown")) === "",
  "Down from empty recalls nothing",
  await held(page),
);

// 6. Undo after a recall: report what it does; dsh's own recall is one undo step.
await clear(page);
await press(page, "ArrowUp", 1500);
const undone = await press(page, "Control+z");
console.log(`NOTE Ctrl+Z after a recall leaves: ${JSON.stringify(undone.slice(0, 60))}`);

// 7. A prompt sent after a walk is the newest next time.
await clear(page);
const four = "Reply with the single word delta.";
verdict(await send(page, [four]), "turn answers", four);
await clear(page);
verdict(
  (await press(page, "ArrowUp", 1500)) === four,
  "after a send, Up recalls the prompt just sent",
  await held(page),
);
verdict((await press(page, "ArrowUp")) === three, "and steps one back from it", await held(page));

// 8. With the plugin's switch off, dsh's recall takes over on this Claude session. A reload keeps
// the open session, so the page comes back to it.
if (state) {
  const file = join(state, "hints.json");
  const before = readFileSync(file, "utf8");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(before), recallOff: true }));
  try {
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(3000);
    await clear(page);
    verdict(
      (await press(page, "ArrowUp", 1200)) === four,
      "recallOff: dsh's recall answers on the Claude session",
      await held(page),
    );
    verdict(
      (await press(page, "ArrowUp")) === three,
      "recallOff: one step per press",
      await held(page),
    );
    await clear(page);
    await press(page, "ArrowUp", 1200);
    console.log(
      `NOTE recallOff, Ctrl+Z after dsh's recall leaves: ${JSON.stringify((await press(page, "Control+z")).slice(0, 60))}`,
    );
  } finally {
    writeFileSync(file, before);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(3000);
  }
} else console.log("SKIP recallOff (no PW_STATE)");

// 9. A fresh session recalls the workspace's last prompts (ours only; dsh's has nothing here).
await newSession(page);
await pickModel(page, /Oh My Claude/, /Haiku/);
await clear(page);
verdict(
  (await press(page, "ArrowUp", 2000)) === four,
  "fresh session: Up recalls the workspace's newest prompt",
  await held(page),
);
verdict((await press(page, "ArrowUp")) === three, "fresh session: one step back", await held(page));
verdict(
  (await press(page, "ArrowDown")) === four && (await press(page, "ArrowDown")) === "",
  "fresh session: Down back to empty",
  await held(page),
);

// 10. A non-Claude session: ours stays out, dsh's recall works alone.
if (otherModel) {
  await newSession(page);
  console.log(`other seat: ${await pickModel(page, new RegExp(otherModel))}`);
  const local = "Reply with the single word epsilon.";
  verdict(await send(page, [local]), "non-Claude turn answers", local);
  await clear(page);
  verdict(
    (await press(page, "ArrowUp", 1200)) === local,
    "non-Claude session: dsh's recall brings the prompt back",
    await held(page),
  );
  verdict(
    (await press(page, "ArrowUp")) === local,
    "non-Claude session: no Claude prompts leak in",
    await held(page),
  );
} else console.log("SKIP non-Claude session (no PW_OTHER_MODEL)");

await context.close();
await browser.close();
console.log(failed === 0 ? "all passed" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
