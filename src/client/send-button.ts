import { ACCENT, SHIMMER } from "./shared.js";
import { gated } from "./theme.js";

const STYLE_ID = "dsh-oh-my-claude-send";
/** The mark the old once-a-second scan left on a button it painted inline. */
const OLD_MARK = "data-omc-send";

/**
 * Paint the composer's send/stop button in the accent while the open session is Claude and the
 * "send" theme group is on, from a stylesheet keyed off the body flag. dsh fills the button from
 * `--dsw-alias-button-info-*`; setting those two variables on it recolours the resting and hover
 * states together. A once-a-second scan used to set them inline per element, and dsh swaps the
 * button when a turn starts, so the stop button showed in dsh's blue for up to a second before the
 * next pass caught it (owner, 2026-11-17). A rule matches the new element on its first frame. The
 * composer's button is the `_primary` one in the card that holds the message box (dsh draws no
 * form there: the card is the nearest element holding both); a settings view has a `_primary`
 * button too, outside any such card. Both are CSS-module suffixes, the way the scan matched them:
 * this is dsh's own button, so a `data-omc-*` hook of ours could only be set a tick after it
 * mounts, which is the lag this rule removes. The Playwright theme checks find it by ancestry. Rewritten on every call, so a hot reload
 * replaces the rule, and inline paint left by an older bundle is cleared once.
 */
export function ensureSendButtonStyle(): void {
  const existing = document.getElementById(STYLE_ID);
  const el = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `${gated("send", '[class*="_card"]:has([contenteditable]) button[class*="_primary"]')} { --dsw-alias-button-info-fill: ${ACCENT}; --dsw-alias-button-info-hover: ${SHIMMER}; }`;
  if (!existing) document.head.append(el);
  for (const old of document.querySelectorAll<HTMLElement>(`[${OLD_MARK}]`)) {
    old.style.removeProperty("--dsw-alias-button-info-fill");
    old.style.removeProperty("--dsw-alias-button-info-hover");
    old.removeAttribute(OLD_MARK);
  }
}
