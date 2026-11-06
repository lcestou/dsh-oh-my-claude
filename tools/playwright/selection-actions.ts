// Dev-only: drives the selection popover on a live dsh 0.2.2. Opens the Claude session PW_SESSION
// names (a sidebar row's text; pick an idle one, since Quote writes into its composer and the
// check clears it again), selects text in the newest reply and asserts: dsh's popover shows Quote
// text and Ask in the Claude accent rather than dsh's neutral label colour, Quote puts dsh's quote
// chip in the composer and closes the popover, Ask turns the popover into a focused question box
// with a preview of the passage that a collapsed selection does not close, Shift+Enter breaks the
// line without asking, Escape closes it, a blank question posts the passage alone, a send in flight
// keeps the box read-only and focused, a 409 shows the note and Enter retries, a send still in
// flight when another passage is selected leaves that selection and its popover alone, and with
// the `selectionOff` hint set the popover offers Quote only. The sends are answered by stubs, so
// nothing is spent unless PW_ASK=1, which sends one real aside and waits for its card.
// PLAYWRIGHT_ROOT names a project with Playwright; arg 1 is dsh's launch token; PW_WIDTH and
// PW_SCHEME pick the viewport (1280, dark by default). Screenshots go to /tmp/pw/.
import { mkdirSync } from "node:fs";
import { dshUrl, launch, type Locator, type Page, type Route } from "./pw.js";

const [token] = process.argv.slice(2);
const name = process.env.PW_SESSION;
const width = Number(process.env.PW_WIDTH ?? 1280);
const height = 800;
const scheme = process.env.PW_SCHEME === "light" ? "light" : "dark";
const tag = `${width}-${scheme}`;
const SIDE_QUESTIONS = "**/dsh-oh-my-claude/side-questions";
/** Errors the plugin logs on dsh 0.2.2-rc.1 that predate this feature: the cost pill's
 *  `useAnchoredPosition` import is gone from dsh's primitives (cost.tsx, on main as well). */
const KNOWN_ERRORS = /useAnchoredPosition|'conversation\.composer\.dock'/;
let failed = 0;

/** Prints one check's line and counts it when it fails, so the run exits non-zero on any miss. */
const check = (label: string, ok: boolean, got: string | number | boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(got)}`);
};

/** Selects the first words of the newest reply paragraph, or the one `back` paragraphs before it.
 *  dsh's text-interaction hook listens for `selectionchange`, which `addRange` fires, so no pointer
 *  gesture is needed. The old selection is dropped first, a beat apart: after Escape it is still
 *  there, and the same range added again is no change to dsh, as a mouse drag (which collapses it
 *  on press) never is. Answers the text. */
const selectReply = async (p: Page, back = 0) => {
  await p.evaluate(() => document.getSelection()?.removeAllRanges());
  await p.waitForTimeout(200);
  return p.evaluate((skip) => {
    const paras = document.querySelectorAll('[data-chat-flow-kind="assistant-step"] p');
    const para = paras[paras.length - 1 - skip];
    const text = para && document.createTreeWalker(para, NodeFilter.SHOW_TEXT).nextNode();
    const sel = document.getSelection();
    if (!(text instanceof Text) || sel === null) return "";
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(19, text.length));
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.toString().trim();
  }, back);
};

/** Whether the element is rendered with its whole box inside the viewport. A popover that drew
 *  off screen or stayed hidden answers false here instead of a 30 s click timeout. */
const onScreen = async (el: Locator): Promise<boolean> => {
  if ((await el.count()) === 0 || !(await el.first().isVisible())) return false;
  const box = await el.first().boundingBox();
  return (
    box !== null &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= width &&
    box.y + box.height <= height
  );
};

/** Clicks the element when it is on screen; otherwise logs a FAIL and answers false so the
 *  caller skips the steps that depended on the click. */
const press = async (label: string, el: Locator): Promise<boolean> => {
  const shown = await onScreen(el);
  if (!shown) {
    check(`${label} is on screen`, false, await el.count());
    return false;
  }
  await el.first().click({ timeout: 3000 });
  return true;
};

/** The button's colour beside the two it could take: dsh's neutral label colour and the Claude
 *  accent, each read from a probe span placed beside it so the variables resolve in its scope. */
const coloursOf = (el: Locator) =>
  el.evaluate((node) => {
    const resolve = (value: string) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      node.parentElement?.appendChild(probe);
      const got = getComputedStyle(probe).color;
      probe.remove();
      return got;
    };
    return {
      colour: getComputedStyle(node).color,
      neutral: resolve("var(--dsw-alias-label-primary)"),
      accent: resolve("var(--omc-accent)"),
    };
  });

if (!name) {
  console.log("set PW_SESSION to an idle Claude session's sidebar text");
  process.exit(1);
}
mkdirSync("/tmp/pw", { recursive: true });
const b = await launch();
const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme });
const p = await ctx.newPage();
const pluginErrors: string[] = [];
p.on("console", (m) => {
  const text = m.text();
  if (text.includes("dsh-oh-my-claude") && !KNOWN_ERRORS.test(text))
    pluginErrors.push(text.split("\n")[0] ?? text);
});
await p.goto(dshUrl(token), { waitUntil: "load" });
await p.waitForTimeout(3000);
const row = p.locator('[role="treeitem"]').filter({ hasText: name }).first();
check("session row found", (await row.count()) === 1, await row.count());
// A DOM click, not a pointer one: at phone width the sidebar is folded off screen.
await row.evaluate((el) => el.click());
await p.waitForTimeout(4000);

const surface = p.locator("[data-text-interaction-surface]");
const quoteBtn = p.locator('[data-omc-selection-action="quote"]');
const askBtn = p.locator('[data-omc-selection-action="ask"]');
const field = p.locator("[data-omc-selection-question]");
const preview = p.locator("[data-omc-selection-preview]");
const note = p.locator("[data-omc-selection-note]");
const chip = p.locator("[data-composer-input] [data-composer-quote]");
/** Empties the composer, as the check found it. */
const clearComposer = async () => {
  await p.locator("[data-composer-input]").click({ force: true });
  await p.keyboard.press("ControlOrMeta+A");
  await p.keyboard.press("Backspace");
  await p.waitForTimeout(300);
};
/** Selects a passage and opens Ask on it; answers the passage, or null when Ask was not there. */
const openAsk = async (): Promise<string | null> => {
  const picked = await selectReply(p);
  await p.waitForTimeout(600);
  if (!(await press("Ask", askBtn))) return null;
  await p.waitForTimeout(400);
  return picked;
};
/** The body of the side-questions POST a stub answered; null until one arrives. */
type Sent = { body: string | null };
/** Answers every side-questions POST with `reply` until `unrouteAll`, and hands back the body of
 *  the latest, so a check can read what the popover sent without anything reaching Claude. */
const stubSends = async (reply: (route: Route) => Promise<void>): Promise<Sent> => {
  const seen: Sent = { body: null };
  await p.route(SIDE_QUESTIONS, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    seen.body = route.request().postData();
    await reply(route);
  });
  return seen;
};
let asked = 0;
p.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/side-questions")) asked++;
});

const picked = await selectReply(p);
await p.waitForTimeout(600);
const popoverShown = await onScreen(quoteBtn);
check("popover shows Quote text on screen", popoverShown, picked);
check("popover shows Ask in a Claude session", await onScreen(askBtn), await askBtn.count());
check("popover surface is dsh's", (await surface.count()) > 0, await surface.count());
if (popoverShown) {
  const { colour, neutral, accent } = await coloursOf(quoteBtn.first());
  check("Quote is not dsh's neutral label colour", colour !== neutral, `${colour} vs ${neutral}`);
  check("Quote takes the Claude accent", colour === accent, `${colour} vs ${accent}`);
}
await p.screenshot({ path: `/tmp/pw/selection-actions-${tag}.png` });

if (await press("Quote text", quoteBtn)) {
  await p.waitForTimeout(500);
  check(
    "Quote puts dsh's quote chip in the composer",
    (await chip.count()) === 1,
    await chip.count(),
  );
  check("Quote closes the popover", (await quoteBtn.count()) === 0, await quoteBtn.count());
  await clearComposer();
}

const passage = await openAsk();
if (passage !== null) {
  const focused = await field.evaluate((el) => el === document.activeElement);
  check("Ask opens a focused question box", focused, focused);
  check(
    "the box survives the collapsed selection",
    (await field.count()) === 1,
    await field.count(),
  );
  const shown = (await preview.count()) === 1 ? await preview.innerText() : "";
  check("the preview shows the passage", passage !== "" && shown.startsWith(passage), shown);
  await p.keyboard.type("first line");
  await p.keyboard.press("Shift+Enter");
  await p.keyboard.type("second");
  const typed = await field.inputValue();
  check("Shift+Enter breaks the line without asking", asked === 0 && typed.includes("\n"), typed);
  await p.screenshot({ path: `/tmp/pw/selection-ask-${tag}.png` });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  check("Escape closes the box", (await field.count()) === 0, await field.count());
  check("nothing was asked", asked === 0, asked);
}

// A send in flight: held for a second so the box can be read, then failed with dsh's 409.
let held = { readOnly: false, disabled: true, focused: false, label: "" };
const sent409 = await stubSends(async (route) => {
  held = await field.evaluate((el) => ({
    readOnly: el instanceof HTMLTextAreaElement && el.readOnly,
    disabled: el instanceof HTMLTextAreaElement && el.disabled,
    focused: el === document.activeElement,
    label: document.querySelector('[data-omc-selection-action="send"]')?.textContent ?? "",
  }));
  await route.fulfill({ status: 409, json: { ok: false, error: "no process" } });
});
if ((await openAsk()) !== null) {
  await p.keyboard.press("Enter");
  await p.waitForTimeout(1200);
  check(
    "a blank question posts the passage alone",
    /"question":"","quote":"\S/.test(sent409.body ?? ""),
    sent409.body ?? "",
  );
  check(
    "in flight the box is read-only, not disabled",
    held.readOnly && !held.disabled,
    held.readOnly,
  );
  check("in flight focus stays in the box", held.focused, held.focused);
  check("in flight the send button says so", held.label !== "", held.label);
  check(
    "a 409 shows the note",
    (await note.count()) === 1,
    (await note.count()) ? await note.innerText() : "",
  );
  check("the box stays open after a 409", (await field.count()) === 1, await field.count());
  await p.screenshot({ path: `/tmp/pw/selection-409-${tag}.png` });
  const before = asked;
  await p.keyboard.press("Enter");
  await p.waitForTimeout(800);
  check("Enter again retries without a click", asked === before + 1, asked - before);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  check("Escape closes the box after a failure", (await field.count()) === 0, await field.count());
}
await p.unrouteAll({ behavior: "ignoreErrors" });

// A send still in flight when the person clicks away and selects another passage: its late answer
// must not clear that selection or close its popover.
const lateSent = await stubSends(async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await route.fulfill({ status: 200, json: { ok: true } });
});
// It needs a second reply paragraph to select; a session with one skips the check.
const paragraphs = await p.locator('[data-chat-flow-kind="assistant-step"] p').count();
if (paragraphs < 2) console.log("skip a late answer: the session has one reply paragraph");
else if ((await openAsk()) !== null) {
  await p.keyboard.type("late");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(300);
  // Any press outside dsh's surface dismisses it; the composer is a target every width shows.
  await p.locator("[data-composer-input]").click({ force: true });
  await p.waitForTimeout(300);
  const next = await selectReply(p, 1);
  await p.waitForTimeout(600);
  const opened = await quoteBtn.count();
  await p.waitForTimeout(3000);
  const kept = await p.evaluate(() => document.getSelection()?.toString().trim() ?? "");
  check(
    "a late answer leaves the next selection alone",
    lateSent.body !== null && next !== "" && kept === next,
    kept,
  );
  check(
    "a late answer leaves the next popover open",
    opened === 1 && (await quoteBtn.count()) === 1,
    await quoteBtn.count(),
  );
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
}
await p.unrouteAll({ behavior: "ignoreErrors" });

if (process.env.PW_ASK === "1") {
  const question = `what is this? ${Date.now() % 1000}`;
  const quoted = await openAsk();
  if (quoted !== null) {
    await p.keyboard.type(question);
    const before = asked;
    await p.keyboard.press("Enter");
    await p.waitForTimeout(1500);
    check(
      "Enter sends one aside and closes",
      asked === before + 1 && (await field.count()) === 0,
      asked - before,
    );
    const card = p.locator("[data-omc-aside-toggle]").filter({ hasText: question });
    await p.waitForTimeout(1500);
    check("the aside card shows the question", (await card.count()) === 1, await card.count());
    const id = (await card.count()) === 1 ? await card.getAttribute("data-omc-aside-toggle") : null;
    const cardQuote = p.locator(`[data-omc-aside-quote="${id}"]`);
    const cardText = (await cardQuote.count()) === 1 ? await cardQuote.innerText() : "";
    check("the aside card shows the passage", quoted !== "" && cardText.includes(quoted), cardText);
    await p.screenshot({ path: `/tmp/pw/selection-aside-${tag}.png` });
  }
}

// The switch in Settings → Oh My Claude is the box-wide `selectionOff` hint.
const hintsUrl = "/dsh-oh-my-claude/hints";
/** Writes the `selectionOff` hint through the plugin's route from inside the page, which carries
 *  dsh's session cookie; null clears it. The box pushes the new store to every open tab. */
const setHint = (value: boolean | null) =>
  p.evaluate(
    async (arg) => {
      await fetch(arg.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectionOff: arg.value }),
      });
    },
    { url: hintsUrl, value },
  );
const was = await p.evaluate(async (url) => {
  const hints: Record<string, boolean | number> = await (await fetch(url)).json();
  return hints.selectionOff === true;
}, hintsUrl);
try {
  await setHint(true);
  await p.waitForTimeout(1500);
  await selectReply(p);
  await p.waitForTimeout(600);
  check("switch off: Quote text still shows", await onScreen(quoteBtn), await quoteBtn.count());
  check("switch off: no Ask", (await askBtn.count()) === 0, await askBtn.count());
  await p.screenshot({ path: `/tmp/pw/selection-off-${tag}.png` });
  await p.keyboard.press("Escape");
  await setHint(null);
  await p.waitForTimeout(1500);
  await selectReply(p);
  await p.waitForTimeout(600);
  check(
    "switch back on: Ask returns without a reload",
    (await askBtn.count()) === 1,
    await askBtn.count(),
  );
  await p.keyboard.press("Escape");
} finally {
  await setHint(was ? true : null);
}

check(
  "no plugin console errors beyond the known cost.tsx one",
  pluginErrors.length === 0,
  pluginErrors.join(" | "),
);
await b.close();
console.log(
  failed === 0 ? "selection actions: all checks passed" : `selection actions: ${failed} failed`,
);
process.exit(failed === 0 ? 0 : 1);
