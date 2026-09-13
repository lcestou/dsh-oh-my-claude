// Dev-only check: the computed colours the Claude look paints, dark and light, as JSON on stdout.
// Run it on `main` before a theme change and again after; the two documents must agree in RGB
// (alpha within 0.01) with no hints set. Point PLAYWRIGHT_ROOT at any project with Playwright
// installed; arg 1 is the dsh launch token, arg 2 (or PW_WORKSPACE) the workspace row to expand.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const wsName = process.argv[3] ?? process.env.PW_WORKSPACE ?? "oh-my-claude";
const b = await launch();

type Reads = Record<string, string>;

async function readScheme(colorScheme: "dark" | "light"): Promise<Reads> {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme });
  const p = await ctx.newPage();
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  // Expand the workspace (collapsed in a fresh profile), then open its first session row.
  const ws = p
    .locator('[role="treeitem"]')
    .filter({ hasText: new RegExp(`^${wsName}$`) })
    .first();
  if (await ws.count()) {
    await ws.click({ force: true });
    await p.waitForTimeout(1200);
  }
  const rows = p.locator('[role="treeitem"]');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const t = (await rows.nth(i).innerText()).trim();
    if (t !== wsName && t !== "") {
      await rows.nth(i).click({ force: true });
      break;
    }
  }
  await p.waitForTimeout(3000);
  const inChat = await p.evaluate(() => {
    const body = document.body;
    if (!body.hasAttribute("data-omc-claude")) return { claude: "no" };
    // Probes: the sheet's markdown rules match `[class*="_markdown"]`, so a synthetic host takes
    // them without needing a message that happens to contain a link, a quote and a rule.
    const host = document.createElement("div");
    host.className = "omc_markdown_probe";
    host.setAttribute("data-omc-theme-probe", "");
    host.innerHTML = '<a href="#">l</a><blockquote>q</blockquote><hr><input type="checkbox">';
    body.appendChild(host);
    const missing = "missing";
    const css = (el: Element | null, prop: string) =>
      el ? getComputedStyle(el).getPropertyValue(prop).trim() : missing;
    const status = document.querySelector('[role="status"][aria-live="polite"]');
    const tab = document.querySelector('[role="tablist"] > [role="tab"][aria-selected="true"]');
    // The composer's send button carries the plugin's own mark once tinted (`data-omc-send`).
    const send = document.querySelector<HTMLElement>("button[data-omc-send]");
    const out = {
      claude: "yes",
      linkColor: css(host.querySelector("a"), "color"),
      linkUnderline: css(host.querySelector("a"), "text-decoration-color"),
      quoteBar: css(host.querySelector("blockquote"), "border-left-color"),
      ruleBg: css(host.querySelector("hr"), "background-color"),
      checkboxAccent: css(host.querySelector("input"), "accent-color"),
      statusRowBg: css(status, "background-image"),
      viewTabColor: css(tab, "color"),
      sendFill: send ? send.style.getPropertyValue("--dsw-alias-button-info-fill") : missing,
      ongoingDot: css(document.querySelector('svg[data-state="ongoing"]'), "color"),
    };
    host.remove();
    return out;
  });
  const reads: Reads = {};
  Object.assign(reads, inChat);
  // The panel: open it from the composer button and read its surface and the spark's fill.
  const spark = p.locator('button[aria-label="Oh My Claude"]').first();
  if (await spark.count()) {
    await spark.click({ force: true });
    await p.waitForTimeout(800);
    Object.assign(
      reads,
      await p.evaluate(() => {
        const missing = "missing";
        const css = (el: Element | null, prop: string) =>
          el ? getComputedStyle(el).getPropertyValue(prop).trim() : missing;
        const panel = document.querySelector("[data-omc-panel]");
        const btn = document.querySelector('button[aria-label="Oh My Claude"]');
        const tabOn = panel?.querySelector('[role="tab"][aria-selected="true"]') ?? null;
        return {
          panelBg: css(panel, "background-color"),
          panelBorder: css(panel, "border-top-color"),
          panelTabRule: css(tabOn, "border-bottom-color"),
          sparkButtonColor: css(btn, "color"),
          sparkFill: css(btn?.querySelector("svg") ?? null, "fill"),
        };
      }),
    );
  }
  await ctx.close();
  return reads;
}

const out = { dark: await readScheme("dark"), light: await readScheme("light") };
console.log(JSON.stringify(out, null, 2));
await b.close();
