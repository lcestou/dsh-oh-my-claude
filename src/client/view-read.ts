// A read of box-wide state for a row whose value nothing pushes: read on mount, and again each time
// the tab comes back into view, so a change made in another tab or on another device shows without
// reopening Settings. Rows whose state is pushed (hints, the event hub) do not need this.
import { useEffect, useRef, useState } from "react";

import { newestWins } from "./events.js";

/**
 * Runs `read` on mount, when `key` changes, and whenever the tab becomes visible again. `read` is
 * handed `fresh`, which it must check before applying its answer: false once the row unmounted, and
 * false once the row wrote the value itself after that read was sent, since the answer then holds
 * the value from before the write. Returns `wrote`, which the row calls as it applies its own
 * write. `read` is taken from the latest render, so it may close over props without being listed.
 */
export function useViewRead(key: string, read: (fresh: () => boolean) => void): () => void {
  const [order] = useState(newestWins);
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    let live = true;
    const run = () => {
      const asked = order.ask();
      latest.current(() => live && asked());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, order]);
  return order.pushed;
}
