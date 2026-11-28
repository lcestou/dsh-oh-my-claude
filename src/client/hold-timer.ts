// A countdown that can be paused and resumed, for a close that waits while someone is reading.
// The update card uses it under reduced motion, where its draining bar does not animate and so
// cannot time the close from its own end event.

/** The controls `holdTimer` hands back. */
export interface HoldTimer {
  /** Start, or resume from where a pause left it; a no-op while already running or once fired. */
  run(): void;
  /** Stop counting and keep the time left; a no-op while paused. */
  pause(): void;
  /** Cancel for good, for an unmount: `fire` is never called after this. */
  stop(): void;
}

/**
 * A timer that calls `fire` once `ms` of running time has passed, not counting the time spent
 * paused. It starts paused: call `run`. `now` is the clock, replaceable for a test.
 */
export function holdTimer(ms: number, fire: () => void, now = () => Date.now()): HoldTimer {
  let left = ms;
  let startedAt = 0;
  let id: ReturnType<typeof setTimeout> | undefined;
  let done = false;

  return {
    run() {
      if (id !== undefined || done) {
        return;
      }

      startedAt = now();
      id = setTimeout(
        () => {
          id = undefined;
          done = true;
          fire();
        },
        Math.max(0, left),
      );
    },
    pause() {
      if (id === undefined) {
        return;
      }

      clearTimeout(id);
      id = undefined;
      left -= now() - startedAt;
    },
    stop() {
      if (id !== undefined) {
        clearTimeout(id);
      }

      id = undefined;
      done = true;
    },
  };
}
