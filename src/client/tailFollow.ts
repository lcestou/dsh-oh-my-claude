/**
 * Follow-the-tail state for the conversation scroll container.
 *
 * dsh streams a turn as two tracks: assistant prose as live chunks, and this plugin's native tool
 * rows as separate `session.append` events. While a tool runs the prose stream pauses, dsh stops
 * following the tail, and the tool rows plus the next prose land below the fold unseen — so the
 * newest text sits off-screen until the next message forces a full re-render. The on-disk log is
 * correctly ordered (verified); this is purely a live scroll-follow miss, treated in-plugin.
 *
 * The rule is the ordinary chat one: follow the bottom while a turn streams, but the moment the
 * reader scrolls up, stop and leave them where they are until they return to the bottom.
 */

export type Geom = { scrollTop: number; scrollHeight: number; clientHeight: number };

/** Pixels the container is above its own bottom; never negative (over-scroll clamps to 0). */
export const distanceFromBottom = (g: Geom): number =>
  Math.max(0, g.scrollHeight - g.scrollTop - g.clientHeight);

/** Within `px` of the bottom counts as "at the bottom" — a small slack absorbs sub-pixel rounding
 *  and the one-frame gap between a content append growing scrollHeight and the next pin. */
export const atBottom = (g: Geom, px: number): boolean => distanceFromBottom(g) <= px;

/** What moved the scroll state since the last decision. `user-up` is an unambiguous reader gesture
 *  (wheel/key/touch up); `scroll` is any scroll event, including our own pin. */
export type FollowSignal = "turn-start" | "user-up" | "scroll";

/**
 * Next follow state. A new turn re-arms following; a reader scrolling up disarms it; a plain scroll
 * only re-arms when it lands back at the bottom, and otherwise leaves the state untouched (our pin
 * writes fire `scroll` too, and must never be read as the reader leaving the bottom).
 */
export function nextFollow(prev: boolean, signal: FollowSignal, g: Geom, px: number): boolean {
  switch (signal) {
    case "turn-start":
      return true;
    case "user-up":
      return false;
    case "scroll":
      return atBottom(g, px) ? true : prev;
  }
}
