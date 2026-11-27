// The strip of earlier windows under a plan window in the ring's popover: one bar per ended
// window, oldest on the left, its height the percent the window ended at. The bars are one control
// (a slider over the windows) rather than one button each: twelve 10 px buttons would be twelve
// tab stops and twelve targets under the 24 px minimum, where one strip is one of each.
import { activeLocale, t } from "./i18n.js";
import { ACCENT, T } from "./shared.js";
import { typicalPercent } from "../usage-history.js";
import type { HistoryEnded, UsageHistory } from "../usage-history.js";

/** When a window ended, short: weekday and time inside the last six days, month and day beyond,
 *  in dsh's language like the reset line above it. */
const endClock = (at: number, now = Date.now()): string =>
  new Date(at).toLocaleString(
    activeLocale(),
    now - at < 6 * 86_400_000
      ? { weekday: "short", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" },
  );

/** One window's line: its end and percent, "at least" when it was last read well before it ended. */
export const barText = (e: HistoryEnded): string =>
  t(e.partial ? "main.usage.historyBarPartial" : "main.usage.historyBar", {
    when: endClock(e.resetsAt),
    percent: e.percent,
  });

/** A series' name in the reader's language, for a series whose window is not in the reply now
 *  (an idle 5-hour window, a model row the API dropped): the same words `windowLabel` uses. */
export const seriesLabel = (series: string): string =>
  series === "session"
    ? t("main.usage.window5h")
    : series === "weekly"
      ? t("main.usage.windowWeekly")
      : series.startsWith("model:")
        ? t("main.usage.windowModelWeekly", { model: series.slice(6) })
        : series.replace(/^label:/, "");

/** The order strips for absent windows follow: the 5-hour, the weekly, then models, then the rest,
 *  each group by name, so the popover reads in the same order the live rows do. */
const seriesRank = (s: string): number =>
  s === "session" ? 0 : s === "weekly" ? 1 : s.startsWith("model:") ? 2 : 3;

/** The series with ended windows that no live row drew, in display order. */
export function absentSeries(history: UsageHistory, drawn: ReadonlySet<string>): Array<string> {
  return Object.keys(history)
    .filter((s) => !drawn.has(s) && (history[s]?.length ?? 0) > 0)
    .toSorted((a, b) => seriesRank(a) - seriesRank(b) || a.localeCompare(b));
}

/**
 * The strip for one window, or null when none of its windows has ended yet. The bars form one
 * `role="slider"` over the ended windows: arrow keys, Home and End move along it, a pointer over a
 * bar or a tap on it picks that bar, and the caption under the bars then reads the picked window's
 * date and percent (the slider's `aria-valuetext` says the same to a screen reader). Leaving the
 * strip with the mouse or moving focus out puts the caption back. A touch pick stays until focus
 * moves, since a finger has no "leave".
 */
export function historyStrip(label: string, list: ReadonlyArray<HistoryEnded>): HTMLElement | null {
  if (list.length === 0) {
    return null;
  }

  const wrap = document.createElement("div");
  wrap.setAttribute("data-omc-usage-history", "");
  wrap.style.cssText = "grid-column:1 / -1;padding-top:4px";
  const bars = document.createElement("div");
  bars.setAttribute("role", "slider");
  bars.tabIndex = 0;
  bars.setAttribute("aria-label", t("main.usage.historyAria", { label }));
  bars.setAttribute("aria-orientation", "horizontal");
  bars.setAttribute("aria-valuemin", "1");
  bars.setAttribute("aria-valuemax", String(list.length));
  // 24 px tall so the one target meets the minimum size; the bars fill its lower 18 px.
  bars.style.cssText =
    "display:flex;align-items:flex-end;gap:2px;height:24px;padding-top:6px;box-sizing:border-box;cursor:default;touch-action:manipulation;border-radius:3px;outline-offset:2px;margin-bottom:6px";

  const els = list.map((e) => {
    const pct = Math.max(0, Math.min(100, e.percent));
    // The same thresholds as the window's own bar above, so a red stub means what a red bar means.
    const tone = pct >= 90 ? T.err : pct >= 70 ? T.warn : ACCENT;
    const bar = document.createElement("span");
    bar.setAttribute("data-omc-usage-history-bar", String(e.resetsAt));

    if (e.partial) {
      bar.setAttribute("data-omc-usage-history-partial", "");
    }

    bar.setAttribute("aria-hidden", "true");
    // A partial window is drawn hollow (its outline at full strength, a faint fill), so "at least"
    // reads as a shape, not as a dimmer colour that turns red into brown in dark mode.
    bar.style.cssText = e.partial
      ? `flex:1 1 0;max-width:10px;height:${Math.max(4, pct)}%;box-sizing:border-box;border-radius:1px;border:1.5px solid ${tone};background:color-mix(in srgb, ${tone} 22%, transparent)`
      : `flex:1 1 0;max-width:10px;height:${Math.max(2, pct)}%;border-radius:1px;background:${tone};opacity:0.85`;
    bars.append(bar);

    return bar;
  });

  const caption = document.createElement("div");
  caption.setAttribute("data-omc-usage-history-caption", "");
  caption.style.cssText = `color:${T.quiet};font-size:11px;line-height:16px;font-variant-numeric:tabular-nums`;
  const typical = typicalPercent(list);

  const resting =
    typical === undefined
      ? t("main.usage.historyLabel")
      : t("main.usage.historyTypical", { percent: typical });

  let picked = list.length - 1;

  /** Pick bar `i` (clamped), or none: outline the picked bar and put its line in the caption and
   *  the slider's value; with none, the caption rests on the label or the typical figure. */
  const pick = (i: number | null) => {
    if (i !== null) {
      picked = Math.max(0, Math.min(list.length - 1, i));
    }

    els.forEach((el, n) => {
      el.style.boxShadow = i !== null && n === picked ? `0 0 0 1px ${T.text}` : "";
    });
    const entry = list[picked]!;
    bars.setAttribute("aria-valuenow", String(picked + 1));
    bars.setAttribute("aria-valuetext", barText(entry));
    caption.textContent = i === null ? resting : barText(entry);
  };

  /** The bar under a pointer, by its share of the strip's width. */
  const at = (x: number): number => {
    const box = bars.getBoundingClientRect();
    const used = els.length ? els.at(-1)!.getBoundingClientRect().right - box.left : 0;

    return Math.floor(((x - box.left) / Math.max(1, used)) * list.length);
  };

  bars.addEventListener("pointermove", (ev) => ev.pointerType === "mouse" && pick(at(ev.clientX)));
  bars.addEventListener("pointerdown", (ev) => pick(at(ev.clientX)));
  bars.addEventListener("pointerleave", (ev) => ev.pointerType === "mouse" && pick(null));
  bars.addEventListener("focus", () => pick(picked));
  bars.addEventListener("blur", () => pick(null));
  bars.addEventListener("keydown", (ev) => {
    const move =
      ev.key === "ArrowLeft" || ev.key === "ArrowDown"
        ? -1
        : ev.key === "ArrowRight" || ev.key === "ArrowUp"
          ? 1
          : 0;

    const to =
      ev.key === "Home" ? 0 : ev.key === "End" ? list.length - 1 : move ? picked + move : undefined;

    if (to === undefined) {
      return;
    }

    ev.preventDefault();
    pick(to);
  });
  pick(null);
  wrap.append(bars, caption);

  return wrap;
}
