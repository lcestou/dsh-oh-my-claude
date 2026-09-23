// Dev-only check: the working line's computed motion and colour, four ways (desktop and 390 px,
// dark and light), as JSON on stdout. Run it on `main` before a motion change and after; the
// "after" is expected to differ only where the plan says. Needs a Claude session running right
// now (PW_SESSION names its row, else the first row dsh labels Running). Point PLAYWRIGHT_ROOT at
// any project with Playwright installed; arg 1 is the dsh launch token. `--shots <dir>` also saves
// a screenshot of the line per read, named by viewport and scheme.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const shotsAt = process.argv.indexOf("--shots");
const shotsDir = shotsAt === -1 ? undefined : process.argv[shotsAt + 1];
const name = process.env.PW_SESSION;
const b = await launch();

type Read = {
  found: number;
  animationName: string;
  duration: string;
  direction: string;
  backgroundSize: string;
  mode: string | null;
  shimmer: string;
  shimmerOnLine: string;
  detail: string;
  spinner: string;
  live: { elapsedMs?: number; tokens?: number; mode?: string };
  sid: string;
};

/** One viewport and colour scheme: open the running session and read the line's computed style,
 *  the mode attribute, the bracket text and the shimmer token the line resolves. Throws when no
 *  session is running, since a line that is not drawn has nothing to measure. */
async function read(
  viewport: { width: number; height: number },
  colorScheme: "dark" | "light",
): Promise<Read> {
  // Open at desktop width, where the sidebar is drawn, and narrow the page once the session is
  // on screen: at 390 px dsh hides the session list behind a toggle.
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme });
  const p = await ctx.newPage();
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const running = p.locator('[role="treeitem"]').filter({ hasText: /Running|运行中/ });
  if ((await running.count()) === 0) {
    const ws = p
      .locator('[role="treeitem"]')
      .filter({ hasText: process.env.PW_WORKSPACE ?? "oh-my-claude" })
      .first();
    if (await ws.count()) await ws.click({ force: true });
    await p.waitForTimeout(1500);
  }
  const row = name
    ? p.locator('[role="treeitem"]').filter({ hasText: name }).first()
    : running.first();
  if ((await row.count()) === 0) throw new Error("no running Claude session to read");
  await row.click({ force: true });
  if (viewport.width < 500) await p.setViewportSize(viewport);
  await p.waitForTimeout(4000);
  const out = await p.evaluate(async () => {
    const line = document.querySelector<HTMLElement>("[data-omc-turn-line]");
    const cs = line ? getComputedStyle(line) : null;
    const root = getComputedStyle(document.documentElement);
    const sid = new URL(location.href).searchParams.get("session") ?? "";
    let live: Read["live"] = {};
    try {
      // The route needs the session id; the row's own subscription knows it, the check does not,
      // so read the first live-turn body off the event stream instead.
      live = await new Promise<Read["live"]>((resolve) => {
        const es = new EventSource("/dsh-oh-my-claude/events");
        es.addEventListener("live-turn", (e) => {
          // SAFETY: an EventSource listener for a named event receives a MessageEvent.
          resolve(JSON.parse((e as MessageEvent).data).data);
          es.close();
        });
        setTimeout(() => {
          resolve({});
          es.close();
        }, 3000);
      });
    } catch {
      /* the figures are optional */
    }
    return {
      found: document.querySelectorAll("[data-omc-turn-line]").length,
      animationName: cs?.animationName ?? "",
      duration: cs?.animationDuration ?? "",
      direction: cs?.animationDirection ?? "",
      backgroundSize: cs?.backgroundSize ?? "",
      mode: line?.getAttribute("data-omc-mode") ?? null,
      shimmer: root.getPropertyValue("--omc-shimmer").trim(),
      shimmerOnLine: cs?.getPropertyValue("--omc-shimmer").trim() ?? "",
      detail: line?.querySelector("[data-omc-turn-detail]")?.textContent ?? "",
      spinner: line?.querySelector("span[aria-hidden]")?.textContent ?? "",
      live,
      sid,
    };
  });
  if (shotsDir !== undefined) {
    // The line's own box clips the verb's left edge (the sheen is painted past it), so the shot is
    // of the group button that holds the line, which also shows dsh's label beside it.
    const group = p.locator("button[data-turn-process]:has([data-omc-turn-line])").last();
    if (await group.count()) {
      await group.scrollIntoViewIfNeeded();
      await group.screenshot({ path: `${shotsDir}/${viewport.width}-${colorScheme}.png` });
    }
  }
  await ctx.close();
  return out;
}

const result = {
  desktopDark: await read({ width: 1400, height: 900 }, "dark"),
  desktopLight: await read({ width: 1400, height: 900 }, "light"),
  phoneDark: await read({ width: 390, height: 844 }, "dark"),
  phoneLight: await read({ width: 390, height: 844 }, "light"),
};
console.log(JSON.stringify(result, null, 2));
await b.close();
