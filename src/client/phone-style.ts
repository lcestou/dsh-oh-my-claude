// The phone layer: larger touch targets and rows that wrap, for the plugin's own surfaces on a
// phone. Every rule sits inside a media query no desktop window with a mouse matches, so the
// desktop look stays as it is; phone-style.test.ts fails the gate on a rule outside one.

const STYLE_ID = "dsh-oh-my-claude-phone";

/** Width at and under which the plugin lays out for a phone; the same line `useNarrow` draws. */
export const PHONE_MAX = 640;

/**
 * The sheet. Touch rules key off `(pointer: coarse)`, so a touchscreen laptop driven by its
 * trackpad keeps the desktop sizes and a tablet held wide gets the touch sizes. Layout rules key off
 * width, which a desktop window dragged under 640 px also matches: the panel already treats that
 * window as a phone (`useNarrow`), and the rows here follow it. `!important` because every control
 * carries its base look inline, as in `ensurePanelStyle`. dsh's own 36 by 20 switches are left
 * alone: Settings would stop matching dsh's rows beside them. The dock stack is capped at 45% of the
 * screen because three waiting steers, a held edit and an aside measured 524 of 844 px at 390 once
 * their buttons were 44 px; its cards keep their height (`flex-shrink: 0`) and the stack scrolls.
 */
export const PHONE_CSS = [
  "@media (pointer: coarse) {",
  '  :is([data-omc-panel], [data-omc-dock], [data-omc-cost-dialog], [data-omc-history-search]) :is(button, select, [role="tab"]):not([role="switch"]) { min-height: 44px !important; min-width: 44px !important; }',
  '  :is([data-omc-panel], [data-omc-dock], [data-omc-cost-dialog], [data-omc-history-search]) input:not([type="checkbox"]):not([type="radio"]) { min-height: 44px !important; }',
  "  :is([data-omc-panel], [data-omc-dock], [data-omc-settings]) summary { padding-block: 15px !important; }",
  "  [data-omc-star-dismiss] { min-height: 44px !important; min-width: 44px !important; }",
  "  [data-omc-history-keys] { display: none !important; }",
  "}",
  `@media (max-width: ${PHONE_MAX}px) {`,
  "  [data-omc-wrap] { flex-wrap: wrap !important; }",
  "  [data-omc-wrap-lead] { flex: 1 1 calc(100% - 16px) !important; }",
  "  [data-omc-wrap-tail] { order: 9; flex: 1 1 100% !important; white-space: normal !important; display: -webkit-box !important; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }",
  "  [data-omc-cost-slot] { flex-shrink: 0 !important; }",
  "  [data-omc-dock-stack] { max-height: 45dvh !important; overflow-y: auto !important; overscroll-behavior: contain; }",
  "  [data-omc-dock-stack] > * { flex-shrink: 0 !important; }",
  "}",
].join("\n");

/** Puts the phone sheet in the page, or rewrites it in place so a hot reload replaces the rules. */
export function ensurePhoneStyle(): void {
  const existing = document.getElementById(STYLE_ID);
  const el = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = PHONE_CSS;
  if (el !== existing) document.head.append(el);
}
