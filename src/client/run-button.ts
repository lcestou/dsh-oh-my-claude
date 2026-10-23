// The Run button dsh puts on a shell code block in a Claude session: the play glyph it appends and
// the scan that puts it there. The composer it writes into belongs to the dock file, which owns it.
import { t } from "./i18n.js";
import { activeClaudeSession, type ClientCtx } from "./shared.js";
import { runDraft, SHELL_LANGS } from "./nudge.js";
import { attachTip } from "./tooltip.js";
import { onBodyMutation } from "./dom.js";
import { dockComposer } from "./dock.js";

/** The play glyph for the Run button, drawn like dsh's own code-block icons (16-unit box, 1px
 *  `currentColor` stroke, 14px on screen) so it reads as one of them. */
function playIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const attrs: [string, string][] = [
    ["width", "14"],
    ["height", "14"],
    ["viewBox", "0 0 16 16"],
    ["fill", "none"],
    ["aria-hidden", "true"],
    ["stroke-width", "1"],
  ];
  for (const [k, v] of attrs) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M4.5 2.5v11l8.5-5.5z");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

/**
 * A Run button in the banner of every shell code block in a Claude session. Clicking writes the
 * snippet into the composer as a prompt, fenced under "Run this:", and leaves sending to you: the
 * owner found a button that sends at once too easy to hit for something that tells Claude to run
 * a command (2026-10-21). Nothing on the box runs from the click itself. The block is dsh's `.md-code-block`
 * with a `[data-code-block-banner]` holding the language span and an actions div (Wrap lines);
 * a block drawn without its banner yet is left for the next scan.
 */
export function watchRunButtons(ctx: ClientCtx) {
  onBodyMutation(() => {
    if (!activeClaudeSession(ctx) || !dockComposer) return;
    for (const block of document.querySelectorAll<HTMLElement>(
      ".md-code-block:not([data-omc-run-seen])",
    )) {
      const banner = block.querySelector<HTMLElement>("[data-code-block-banner]");
      const actions = banner?.querySelector("button")?.parentElement;
      if (!banner || !actions) continue;
      block.setAttribute("data-omc-run-seen", "");
      const lang = banner.firstElementChild?.textContent?.trim().toLowerCase() ?? "";
      if (!SHELL_LANGS.has(lang)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-omc-run", "");
      // dsh's own action look and shape, so the button sits with Copy and Wrap lines as one more
      // icon: its class, a 14px outline glyph, an aria-label, and a bubble like dsh's on hover.
      button.className = actions.querySelector("button")?.className ?? "";
      button.setAttribute("aria-label", t("main.run.button"));
      button.append(playIcon());
      attachTip(button, () => t("main.run.title"));
      button.addEventListener("click", () => {
        const snippet = block.querySelector("pre")?.textContent?.trimEnd() ?? "";
        const composer = dockComposer;
        if (!composer || snippet.trim() === "") return;
        composer.setDraft(runDraft(lang, snippet));
        document.querySelector<HTMLElement>("[data-composer-input]")?.focus();
      });
      actions.append(button);
    }
  });
}
