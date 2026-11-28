// Dev-only check: an axe-core WCAG 2.2 AA scan of the plugin's own elements in a Claude session,
// in English and Chinese, light and dark, at desktop and phone width, with the cost dialog both
// closed and open, and with the ring popover open on a fabricated usage history. dsh's own markup
// is left out: the scan includes only `[data-omc-*]` roots, so a finding is always ours to fix.
//
// axe-core is borrowed the way Playwright is: AXE_CORE names its `axe.min.js` (any `npm install
// axe-core` folder), so neither is a dependency of the plugin. PLAYWRIGHT_ROOT names a project with
// Playwright. Run it against a scratch dsh (DSH_ORIGIN) that has one Claude session with a turn in it.
// Usage: AXE_CORE=<path>/axe.min.js bun tools/playwright/axe.ts <token> [session title]
import { dshUrl, launch } from "./pw.js";
import type { Page } from "./pw.js";
import { routeUsage } from "./usage-fixture.js";

const [token, sessionTitle] = process.argv.slice(2);
const axeEnv = process.env.AXE_CORE;

if (!axeEnv) {
  throw new Error("set AXE_CORE to axe-core's axe.min.js");
}

const axePath: string = axeEnv;

/** The plugin's roots the scan covers; whichever are on the page in a scene get scanned. */
const ROOTS = [
  "[data-omc-cost-slot]",
  "[data-omc-cost-dialog]",
  "[data-omc-update-card]",
  "[data-omc-steer-card]",
  "[data-omc-turn-status]",
  "[data-omc-usage-history]",
  "[data-omc-usage-history-row]",
];

/** WCAG 2.0 to 2.2, levels A and AA: what the ship rule asks for. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Finding = { id: string; impact: string | null; targets: Array<string> };

/** The slice of axe-core's result the scan reads. */
type AxeResult = {
  violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: Array<string> }> }>;
};

/** What to scan: each entry is a selector path, one selector per frame level. */
type AxeContext = { include: Array<Array<string>> };

/** The run options the scan passes: rules by tag, violations only. */
type AxeOptions = {
  runOnly: { type: "tag"; values: Array<string> };
  resultTypes: Array<"violations">;
};

/** The slice of `window.axe` the scan calls. */
type AxeApi = { run(context: AxeContext, options: AxeOptions): Promise<AxeResult> };

declare global {
  interface Window {
    /** Set by axe-core's script once the scan injects it. */
    axe?: AxeApi;
  }
}

/**
 * Scan whichever of ROOTS are on the page and return one line per violation node. Answers an empty
 * list, not a pass, when no root is present: the caller counts scenes that scanned nothing as
 * failures, since a scan of nothing proves nothing.
 */
async function scan(p: Page): Promise<{ scanned: Array<string>; findings: Array<Finding> }> {
  await p.addScriptTag({ path: axePath });

  return p.evaluate(
    async ({ roots, tags }: { roots: Array<string>; tags: Array<string> }) => {
      const scanned = roots.filter((r) => document.querySelector(r) !== null);

      if (scanned.length === 0) {
        return { scanned, findings: [] };
      }

      // axe-core installs itself as `window.axe` when its script tag runs, just above.
      const axe = window.axe;

      if (!axe) {
        throw new Error("axe-core did not load");
      }

      const res = await axe.run(
        { include: scanned.map((r) => [r]) },
        { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] },
      );

      return {
        scanned,
        findings: res.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          targets: v.nodes.map((n) => n.target.join(" ")),
        })),
      };
    },
    { roots: ROOTS, tags: TAGS },
  );
}

const b = await launch();

/** Open the session under test from the sidebar. A DOM click, not a pointer one: on a phone the
 *  sidebar is a closed sheet, and dsh keeps the open session out of the URL, so there is no link
 *  to go to instead. */
async function openSession(p: Page): Promise<void> {
  const row = sessionTitle
    ? p.getByText(sessionTitle).first()
    : p.locator('[role="treeitem"]').last();

  await row.evaluate((el) => el.click());
  await p.waitForTimeout(3500);
}

let failed = 0;

for (const locale of ["en-US", "zh-CN"]) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [1400, 390]) {
      const ctx = await b.newContext({
        viewport: { width, height: width > 500 ? 900 : 844 },
        colorScheme,
        locale,
        isMobile: width < 500,
        hasTouch: width < 500,
      });

      const p = await ctx.newPage();
      // The ring popover's history comes from a fabricated usage reply, so every strip, the row
      // for a series with no live window and the partial bars are on screen whatever the box's
      // own history holds; the box's usage-history.json is never read or written.
      await routeUsage(p, "full");
      await p.goto(dshUrl(token), { waitUntil: "load" });
      await p.waitForTimeout(2500);
      await openSession(p);
      const scene = `${locale} ${colorScheme} ${width}px`;

      for (const state of ["closed", "dialog open", "ring open"]) {
        if (state === "dialog open") {
          const pill = p.locator("[data-omc-cost-pill]").first();

          if (!(await pill.count())) {
            console.log(`FAIL ${scene} ${state}: no cost pill to open`);
            failed++;
            continue;
          }

          await pill.evaluate((el) => el.click());
          await p.waitForTimeout(800);
        }

        if (state === "ring open") {
          await p.keyboard.press("Escape");

          const ring = p
            .locator(
              'button[aria-haspopup="dialog"]:has(> svg > circle + circle[stroke-dasharray])',
            )
            .first();

          if (!(await ring.count())) {
            console.log(`FAIL ${scene} ${state}: no context ring to open`);
            failed++;
            continue;
          }

          await ring.evaluate((el) => el.click());
          await p.waitForTimeout(1500);
        }

        const { scanned, findings } = await scan(p);

        if (scanned.length === 0) {
          console.log(`FAIL ${scene} ${state}: none of the plugin's roots on the page`);
          failed++;
          continue;
        }

        failed += findings.length;
        console.log(
          `${findings.length ? "FAIL" : "PASS"} ${scene} ${state}: ${scanned.join(" ")}` +
            findings.map((f) => `\n  ${f.id} (${f.impact}): ${f.targets.join(", ")}`).join(""),
        );
      }

      await p.unrouteAll({ behavior: "ignoreErrors" });
      await ctx.close();
    }
  }
}

await b.close();

process.exit(failed ? 1 : 0);
