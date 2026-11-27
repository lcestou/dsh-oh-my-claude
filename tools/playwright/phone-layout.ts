// Dev-only check: the plugin's surfaces at phone widths (360, 390, 430) and at a desktop width.
// On a phone: the cost pill's figure is not clipped, no panel tab scrolls sideways, every tab and
// card button is a 44 px touch target, MCP server names keep a readable width, the cards above
// the composer stop at 45% of the screen, and the Rewind tab opens history search with its keys
// line hidden. On the desktop (1280 and a narrowed 600 px window, both with a mouse): no
// touch size leaks in, and one capture line is printed at 1280 so a run before a change and a run
// after it can be diffed.
// The side-questions reply is rewritten on the way to the page so the steer card and an aside show
// without a running turn; nothing is sent and no setting changes. Point PLAYWRIGHT_ROOT at any
// project with Playwright; DSH_ORIGIN at a scratch dsh. PW_SESSION names the sidebar row of a
// Claude session with at least one finished turn (the cost pill needs one).
// Usage: bun tools/playwright/phone-layout.ts <token> [/tmp/pw/phone-layout]
import { dshUrl, launch } from "./pw.js";
import type { Browser, Page } from "./pw.js";

const [token, out = "/tmp/pw/phone-layout"] = process.argv.slice(2);
const sessionRow = process.env.PW_SESSION ?? "";

/** What went wrong, one line each; the run exits 1 when any. */
const failed: Array<string> = [];

/** Rewrites the side-questions reply to carry three waiting steers, one held edit and one answered
 *  aside, the stack the 45dvh cap exists for, so the cards draw on an idle session. The real
 *  reply's other fields pass through. */
async function fakeCards(p: Page): Promise<void> {
  const now = Date.now();
  await p.route("**/dsh-oh-my-claude/side-questions?*", async (route) => {
    const r = await route.fetch();
    const real = await r.json();
    await route.fulfill({
      response: r,
      json: {
        ...real,
        items: [
          {
            id: "omc-phone-aside",
            question: "Why does the panel wrap its tabs onto three rows on a phone?",
            answer: "Because the strip wraps rather than scrolls.",
            pending: false,
            at: now - 60_000,
          },
        ],
        steers: {
          waiting: [1, 2, 3].map((n) => ({
            id: `omc-phone-steer-${n}`,
            text: `Steer ${n}: also check the 360 px width and the context ring popover, then report back`,
            at: now - 5000 * n,
          })),
          held: [{ id: "omc-phone-held", text: "A held edit waiting for its send" }],
        },
      },
    });
  });
}

/** Opens the session PW_SESSION names, else the first sidebar row that shows a cost pill. A phone
 *  keeps the tree behind dsh's "Open sidebar" button, which closes again on each pick; rows are
 *  clicked through the DOM because the sheet's lower rows sit outside the viewport. */
async function openSession(p: Page): Promise<boolean> {
  await p.goto(dshUrl(token), { waitUntil: "load" });
  await p.waitForTimeout(2500);
  const sidebar = p.getByRole("button", { name: /^(Open sidebar|打开侧边栏)$/ });

  for (let i = 0; i < 8; i++) {
    if ((await sidebar.count()) > 0 && (await sidebar.isVisible())) {
      await sidebar.click({ force: true });
      await p.waitForTimeout(800);
    }

    const rows = p.locator('[role="treeitem"]');
    const row = sessionRow ? rows.filter({ hasText: sessionRow }).first() : rows.nth(i + 1);

    if ((await row.count()) === 0) {
      return false;
    }

    await row.evaluate((el) => el.click());
    await p.waitForTimeout(3000);

    if ((await p.locator("[data-omc-cost-pill]").count()) > 0) {
      return true;
    }

    if (sessionRow) {
      return false;
    }
  }

  return false;
}

/** The card and pill sizes one read returns, each as text so a capture line diffs cleanly. */
type Sizes = { pillText: string; pillClipped: string; steerButtons: string; asideDismiss: string };

/** What one walk through the panel's tabs returns. */
type PanelRead = { panelMax: string; tabHeight: string; sideways: string; mcpNameMin: string };

/** The sizes this check compares, read in one pass; "none" for a surface that is not drawn. */
function readSizes(p: Page): Promise<Sizes> {
  return p.evaluate(() => {
    const label = document.querySelector<HTMLElement>("[data-omc-cost-pill] > span");
    const close = document.querySelector("[data-omc-aside-toggle] ~ button:last-of-type");
    const closeBox = close?.getBoundingClientRect();

    return {
      pillText: label?.textContent ?? "none",
      pillClipped: label ? String(label.scrollWidth > label.clientWidth) : "none",
      steerButtons: Array.from(document.querySelectorAll("[data-omc-steer-row] button"))
        .map((el) => {
          const b = el.getBoundingClientRect();

          return `${Math.round(b.width)}x${Math.round(b.height)}`;
        })
        .join(" "),
      asideDismiss: closeBox
        ? `${Math.round(closeBox.width)}x${Math.round(closeBox.height)}`
        : "none",
    };
  });
}

/** Opens the panel and walks every tab, reading the strip, each body's sideways overflow and,
 *  on MCP, the narrowest server name. Leaves the panel open on the last tab. */
async function walkPanel(p: Page): Promise<PanelRead> {
  await p.locator("[data-omc-panel-trigger]").first().click();
  await p.waitForTimeout(1200);
  const tabs = p.locator('[data-omc-panel] [role="tab"]');
  const sideways: Array<string> = [];
  let mcpNames = "none";

  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    await p.waitForTimeout(1200);

    const r = await p.evaluate(() => {
      const body = document.getElementById("omc-tabpanel");

      const names = Array.from(
        document.querySelectorAll("[data-omc-panel] [data-omc-wrap-lead]"),
      ).map((e) => Math.round(e.getBoundingClientRect().width));

      return {
        label:
          document
            .querySelector('[data-omc-panel] [role="tab"][aria-selected="true"]')
            ?.getAttribute("data-omc-label") ?? "?",
        over: body ? body.scrollWidth > body.clientWidth : false,
        names: names.length > 0 ? String(Math.min(...names)) : "none",
      };
    });

    if (r.over) {
      sideways.push(r.label);
    }

    if (r.label === "MCP") {
      mcpNames = r.names;
    }
  }

  const tab = await tabs.first().boundingBox();

  const cap = await p.evaluate(
    () => getComputedStyle(document.querySelector("[data-omc-panel]") ?? document.body).maxHeight,
  );

  return {
    panelMax: cap,
    tabHeight: tab ? String(Math.round(tab.height)) : "none",
    sideways: sideways.join(",") || "none",
    mcpNameMin: mcpNames,
  };
}

/** One phone width: reads the cards, the pill and the panel, checks them against the touch and
 *  overflow rules, then opens history search from the Rewind tab. */
async function phone(b: Browser, width: number): Promise<void> {
  const ctx = await b.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });

  const p = await ctx.newPage();
  await fakeCards(p);

  if (!(await openSession(p))) {
    failed.push(`${width}: no session with a cost pill found`);
    await ctx.close();

    return;
  }

  await p.waitForTimeout(2000);
  await p.screenshot({ path: `${out}-${width}-cards.png` });
  const s = await readSizes(p);
  console.log(width, JSON.stringify(s));

  if (s.pillClipped !== "false") {
    failed.push(`${width}: cost pill figure clipped (${s.pillText})`);
  }

  // A check that found no steer buttons measured nothing; say so instead of passing.
  if (s.steerButtons.trim() === "") {
    failed.push(`${width}: no steer buttons drawn to measure`);
  }

  for (const size of s.steerButtons.split(" ").filter(Boolean)) {
    if (Number(size.split("x")[1]) < 44) {
      failed.push(`${width}: steer button ${size} under 44 px`);
    }
  }

  if (s.asideDismiss !== "none" && Number(s.asideDismiss.split("x")[1]) < 44) {
    failed.push(`${width}: aside close ${s.asideDismiss} under 44 px`);
  }

  // The stack above the composer stops at 45% of the screen and scrolls; missing hook, no cap.
  const stack = await p.evaluate(() => {
    const el = document.querySelector("[data-omc-dock-stack]");

    if (el === null) {
      return "none";
    }

    const cap = Math.round(window.innerHeight * 0.45) + 1;

    return getComputedStyle(el).overflowY === "auto" && el.getBoundingClientRect().height <= cap
      ? "capped"
      : "uncapped";
  });

  if (stack !== "capped") {
    failed.push(`${width}: dock stack ${stack}`);
  }

  const panel = await walkPanel(p);
  console.log(width, JSON.stringify(panel));
  await p.screenshot({ path: `${out}-${width}-panel.png` });

  // 618 px is the room above the composer on an 844 px phone; the old 400 px cap left the body
  // about 300 px under a three-row tab strip.
  if (Number.parseFloat(panel.panelMax) < 500) {
    failed.push(`${width}: panel capped at ${panel.panelMax}`);
  }

  if (Number(panel.tabHeight) < 44) {
    failed.push(`${width}: panel tab ${panel.tabHeight} px high`);
  }

  if (panel.sideways !== "none") {
    failed.push(`${width}: tabs that scroll sideways: ${panel.sideways}`);
  }

  if (panel.mcpNameMin !== "none" && Number(panel.mcpNameMin) < 120) {
    failed.push(`${width}: an MCP server name is ${panel.mcpNameMin} px wide`);
  }

  await p.locator('[data-omc-panel] [data-omc-label="Rewind"]').click();
  await p.waitForTimeout(1200);
  const opener = p.locator("[data-omc-rewind-history]");

  if ((await opener.count()) === 0) {
    failed.push(`${width}: Rewind has no history search button`);
  } else {
    await opener.click();
    await p.waitForTimeout(1200);

    if ((await p.locator("[data-omc-history-search]").count()) === 0) {
      failed.push(`${width}: the Rewind button did not open history search`);
    }

    // Tab, Enter and Ctrl mean nothing on a phone, so the keys line is hidden there.
    const keys = await p.evaluate(() => {
      const el = document.querySelector("[data-omc-history-keys]");

      return el === null ? "none" : getComputedStyle(el).display;
    });

    if (keys !== "none" || (await p.locator("[data-omc-history-keys]").count()) === 0) {
      failed.push(`${width}: history keys line ${keys === "none" ? "has no hook" : "shows"}`);
    }

    await p.screenshot({ path: `${out}-${width}-history.png` });
  }

  await p.unrouteAll({ behavior: "ignoreErrors" });
  await ctx.close();
}

/** A desktop with a mouse at `width`. At 1280 it prints one capture line to diff against a run on
 *  the tree before the change. At 600, under the phone layout line, rows may wrap and the pill
 *  shows the total alone, but no touch size may leak in: tabs stay 28 px and Rewind has no button. */
async function desktop(b: Browser, width: number): Promise<void> {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  await fakeCards(p);

  if (!(await openSession(p))) {
    failed.push(`desktop ${width}: no session with a cost pill found`);
    await ctx.close();

    return;
  }

  await p.waitForTimeout(2000);
  const s = await readSizes(p);
  const panel = await walkPanel(p);
  const wide = width > 640;
  // The MCP name width is left out: the hooks it reads exist only once the change is in, and the
  // desktop width of those names is not something the change touches.
  const { panelMax, tabHeight, sideways } = panel;

  if (wide) {
    console.log("desktop capture", JSON.stringify({ ...s, panelMax, tabHeight, sideways }));
  }

  await p.screenshot({ path: `${out}-desktop-${width}.png` });

  if (wide && !s.pillText.includes("·")) {
    failed.push(`desktop: pill lost its last-turn figure (${s.pillText})`);
  }

  if (wide && panelMax !== "400px") {
    failed.push(`desktop: panel cap ${panelMax}, was 400px`);
  }

  if (tabHeight !== "28") {
    failed.push(`desktop ${width}: panel tab ${tabHeight} px, was 28`);
  }

  await p.locator('[data-omc-panel] [data-omc-label="Rewind"]').click();
  await p.waitForTimeout(1200);

  if ((await p.locator("[data-omc-rewind-history]").count()) > 0) {
    failed.push(`desktop ${width}: the touch-only history button shows with a mouse`);
  }

  await p.unrouteAll({ behavior: "ignoreErrors" });
  await ctx.close();
}

const b = await launch();

for (const width of [360, 390, 430]) {
  await phone(b, width);
}

await desktop(b, 1280);

await desktop(b, 600);

await b.close();

for (const f of failed) {
  console.log("FAIL", f);
}

console.log(failed.length === 0 ? "phone layout ok" : `${failed.length} failed`);

process.exit(failed.length === 0 ? 0 : 1);
