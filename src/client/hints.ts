// The box-wide hints store from the browser's side: one memoised read, one window event, and the
// hooks the settings switches use. The import-time subscribe stays with the store it feeds.
import { useEffect, useState } from "react";
import { ROUTE, readJson } from "./shared.js";
import { subscribe } from "./events.js";
import { themeOf } from "./theme.js";

/** One flag from the box-wide `hints.json` store, live across components: a set here reaches every
 *  mounted reader through one window event, so the settings switch hides the dock without a remount. */
export const HINTS_EVENT = "omc-hints";

/** One read of the store shared by every hook on the page: a Settings open mounts five readers and
 *  every cost pill two, so the fetch is memoised until a write dispatches the event. */
let hintsOnce: Promise<Record<string, boolean | number>> | undefined;
// A hint written from another tab or browser lands here as an event carrying the whole store;
// hand it to every reader through the same event a local write dispatches, with no refetch.
// Module-level: a hot reload loads a new module whose subscriber map starts empty, so nothing stacks.
subscribe("hints", (_session, data) => {
  hintsOnce = Promise.resolve(data);
  window.dispatchEvent(new Event(HINTS_EVENT));
});
/** Fetch and parse the box-wide hints store once, memoising the promise and retrying on failure
 *  rather than caching the empty result. */
export const loadHints = (): Promise<Record<string, boolean | number>> =>
  (hintsOnce ??= fetch(`${ROUTE}/hints`)
    .then((r) => readJson<Record<string, boolean | number>>(r))
    .catch(() => {
      hintsOnce = undefined; // a failed read is retried by the next reader, not cached
      return {};
    }));
/** One box-wide hint and its setter. Undefined until the first load. The setter posts to the box,
 *  null clears the hint, and every other reader in this tab re-reads once it lands. */
export function useHintValue(
  key: string,
): [boolean | number | undefined, (next: boolean | number | null) => void] {
  const [value, setValue] = useState<boolean | number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () =>
      loadHints().then((h) => {
        if (live) setValue(h[key]);
      });
    void load();
    window.addEventListener(HINTS_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(HINTS_EVENT, load);
    };
  }, [key]);
  const set = (next: boolean | number | null) => {
    setValue(next === null ? undefined : next);
    void fetch(`${ROUTE}/hints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    }).finally(() => {
      hintsOnce = undefined; // every reader re-reads once, through one shared fetch
      window.dispatchEvent(new Event(HINTS_EVENT));
    });
  };
  return [value, set];
}

/**
 * Write several hints as one request.
 *
 * Two `set` calls in a row are two reads and two writes of the same file, and the second read can
 * predate the first write: picking Off wrote the off flag over a snapshot that still held the on
 * flag, so both came back set and the control stayed On. Keys that answer one question travel
 * together.
 */
export function writeHints(next: Record<string, boolean | number | null>): void {
  void fetch(`${ROUTE}/hints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  }).finally(() => {
    hintsOnce = undefined;
    window.dispatchEvent(new Event(HINTS_EVENT));
  });
}

/** One boolean flag from the hints store; `false` clears the key. */
export function useHintFlag(flag: string): [boolean, (on: boolean) => void] {
  const [value, set] = useHintValue(flag);
  return [value === true, (on) => set(on)];
}

/** Write the Claude look's switches to the page: the group tokens on `<body>` (absent means every
 *  group on, so the first paint before the hints load is today's paint) and the accent pair on the
 *  root. Read by the sheets through `[data-omc-theme~="…"]` and `var(--omc-accent)`. */
export function applyTheme(hints: Record<string, boolean | number>): void {
  const theme = themeOf(hints);
  document.body.setAttribute("data-omc-theme", theme.groups.join(" "));
  const root = document.documentElement.style;
  root.setProperty("--omc-accent", theme.accent);
  root.setProperty("--omc-shimmer", theme.shimmer);
  root.setProperty("--omc-shimmer-dark", theme.shimmerDark);
}
