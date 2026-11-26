// A fabricated plan-usage reply for checks that need the ring popover in a state the box is not in:
// every window kind, a full history with partial, amber and red windows, and a series with no live
// row. Served through `page.route`, so no check ever needs, or writes, the box's own history file.
import type { JsonDoc, Page } from "./pw.js";

const H = 3_600_000;
const D = 24 * H;

/** Which history the fixture serves: `full` every series, `empty` series with nothing ended yet,
 *  `none` no history field at all, as a server older than the history answers. */
export type HistoryCase = "full" | "empty" | "none";

/** `n` ended windows `len` apart, the newest an hour before `now`, percents from `pcts` in turn,
 *  every fourth one partial. Reset times are rounded to the minute, as the route sends them. */
const ended = (n: number, len: number, pcts: number[], now: number): JsonDoc[] =>
  Array.from({ length: n }, (_, i) => ({
    resetsAt: Math.round((now - H - (n - 1 - i) * len) / 60_000) * 60_000,
    percent: pcts[i % pcts.length] ?? 0,
    partial: i % 4 === 3,
  }));

/** One live window as the route sends it, graded `normal`. */
const live = (label: string, usedPercent: number, resetsAt: number, extra: JsonDoc): JsonDoc => ({
  label,
  usedPercent,
  resetsAt,
  severity: "normal",
  ...extra,
});

/** The usage reply for `which` as of `now`: three live windows (5-hour, weekly, Fable weekly) and,
 *  for `full`, 12, 8 and 3 ended windows under them plus 4 for Opus, which has no live row. */
export function usageFixture(which: HistoryCase, now: number): JsonDoc {
  const windows = [
    live("5-hour", 31, now + 3 * H, { kind: "session" }),
    live("Weekly", 64, now + 3 * D, { kind: "weekly" }),
    live("Fable weekly", 12, now + 3 * D, { model: "Fable" }),
  ];
  const reply: JsonDoc = { ok: true, fetchedAt: now, windows, host: "fixture", email: null };
  if (which === "full")
    reply.history = {
      session: ended(12, 5 * H, [22, 40, 95, 63, 75, 18], now),
      weekly: ended(8, 7 * D, [48, 71, 33, 90, 52], now),
      "model:Fable": ended(3, 7 * D, [5, 12, 9], now),
      "model:Opus": ended(4, 7 * D, [30, 44, 20, 61], now),
    };
  if (which === "empty") reply.history = { session: [], weekly: [], "model:Fable": [] };
  return reply;
}

/** Answer every plan-usage read on `p` with the fixture as of `now`; `/usage/breakdown` and every
 *  other route go through to the box. Call before the page loads. */
export async function routeUsage(p: Page, which: HistoryCase, now = Date.now()): Promise<void> {
  await p.route(/\/dsh-oh-my-claude\/usage(\?|$)/, async (route) => {
    await route.fulfill({ json: usageFixture(which, now) });
  });
}
