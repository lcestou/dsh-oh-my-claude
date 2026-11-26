// The test gate's card above the composer: tests running, Claude fixing a failure (n of N), a
// pass that took fixes, or a turn that ended with the tests still failing, with Rewind to the
// prompt before it. Follows the run file through the `test-gate` event.
import { useEffect, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "./i18n.js";
import { subscribe } from "./events.js";
import { OpenPanelEvent } from "./edit-last.js";
import { DOCK_ATTR, DOCK_CARD, ROUTE, T, readJson, type ClientCtx } from "./shared.js";
import type { TestGateRun } from "../test-gate.js";

/** The notice box the context card uses, so the two read as one family above the composer. */
const BOX = {
  boxSizing: "border-box",
  background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
  border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
  borderRadius: "12px 12px 0 0",
  padding: "8px 10px",
  fontSize: 13,
} as const;
/** A small outlined button, as on the context card. */
const SMALL = {
  background: "transparent",
  border: `0.5px solid ${T.border}`,
  borderRadius: 6,
  padding: "2px 8px",
  cursor: "pointer",
  color: T.text,
  fontSize: 12,
} as const;
/** A run shorter than this never shows "Running": a fast suite would only flash. */
const RUNNING_DELAY_MS = 800;

/** The sentence for a run, or null when the run shows no card: a clean first pass, a cancel, or
 *  one the owner closed. */
export function gateLine(run: TestGateRun): string | null {
  if (run.dismissed) return null;
  switch (run.state) {
    case "held":
      return t("testGate.held");
    case "running":
      return t("testGate.running", { command: run.command });
    case "fixing":
      return t("testGate.fixing", { attempt: run.attempt, tries: run.tries });
    case "passed":
      return run.attempt === 0
        ? null
        : t(run.attempt === 1 ? "testGate.passedOne" : "testGate.passedOther", { n: run.attempt });
    case "gave-up":
      return t("testGate.gaveUp", { tries: run.tries });
    case "timed-out":
      return t("testGate.timedOut");
    case "broken":
      return t("testGate.broken", { code: String(run.exitCode ?? "?") });
    case "stopped":
      return null;
  }
}

/** What the card shows for `run` while the session's turn is or is not running: `gateLine`, or
 *  null for a run left `running` or `fixing` after the turn ended (an interrupt while Claude was
 *  fixing fires no Stop hook; a restart can kill the hook), since that line would lie. */
export function cardLine(run: TestGateRun, turnRunning: boolean): string | null {
  if ((run.state === "running" || run.state === "fixing") && !turnRunning) return null;
  return gateLine(run);
}

/** The dot's colour: an error for a failure, muted for a run that is going or said nothing
 *  either way (held, timed out, stopped), the success colour only for a pass. */
export function dotColour(state: TestGateRun["state"]): string {
  if (state === "fixing" || state === "gave-up" || state === "broken") return T.err;
  return state === "passed" ? T.ok : T.muted;
}

/** The card for one session; nothing at all while the session has no run worth showing
 *  (`cardLine`). */
export function TestGateCard({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const turnRunning = useSyncExternalStore(
    (fn) => ctx.sessions.list.subscribe?.(fn) ?? (() => {}),
    () => ctx.sessions.list.getSnapshot()?.byId[sessionId]?.running === true,
  );
  const [run, setRun] = useState<TestGateRun | null>(null);
  const [open, setOpen] = useState(false);
  const [late, setLate] = useState(false);
  useEffect(() => {
    let live = true;
    // Once an event lands it is newer than the first read, which then must not write over it.
    let heard = false;
    setRun(null);
    // The first read covers a tab opened mid-run; the event carries every write after it.
    fetch(`${ROUTE}/test-gate/run?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<{ run: TestGateRun | null }>(r))
      .then((r) => live && !heard && setRun(r.run))
      .catch(() => {});
    const off = subscribe("test-gate", (s, data) => {
      if (s !== sessionId) return;
      heard = true;
      setRun(data);
    });
    return () => {
      live = false;
      off();
    };
  }, [sessionId]);
  const running = run?.state === "running";
  useEffect(() => {
    setLate(false);
    if (!running) return;
    const timer = setTimeout(() => setLate(true), RUNNING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [running, run?.startedAt]);
  const line = run ? cardLine(run, turnRunning) : null;
  if (!run || line === null || (running && !late)) return null;
  const dismiss = () => {
    setRun({ ...run, dismissed: true });
    void fetch(`${ROUTE}/test-gate/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sessionId }),
    }).catch(() => {});
  };
  return (
    <div {...{ [DOCK_ATTR]: "1" }} style={DOCK_CARD}>
      <div
        data-omc-test-gate={run.state}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
        role="status"
        style={BOX}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: dotColour(run.state), flex: "0 0 auto" }} aria-hidden="true">
            ●
          </span>
          <span style={{ flex: "1 1 14em", minWidth: 0, overflowWrap: "anywhere" }}>{line}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            {run.tail && !running && (
              <button
                type="button"
                data-omc-test-gate-toggle=""
                aria-expanded={open}
                aria-controls={`omc-test-gate-output-${sessionId}`}
                style={SMALL}
                onClick={() => setOpen((v) => !v)}
              >
                {t(open ? "testGate.hideOutput" : "testGate.showOutput")}
              </button>
            )}
            {run.state === "gave-up" && (
              <button
                type="button"
                data-omc-test-gate-rewind=""
                style={SMALL}
                onClick={() =>
                  window.dispatchEvent(new OpenPanelEvent({ tab: "Rewind", rewindLatest: true }))
                }
              >
                {t("testGate.rewind")}
              </button>
            )}
            {/* In every state: a card must never be stuck on screen. */}
            <button
              type="button"
              data-omc-test-gate-dismiss=""
              aria-label={t("testGate.dismiss")}
              title={t("testGate.dismiss")}
              onClick={dismiss}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0 2px",
                color: T.faint,
              }}
            >
              ×
            </button>
          </span>
        </div>
        {open && run.tail && (
          <pre
            id={`omc-test-gate-output-${sessionId}`}
            data-omc-test-gate-output=""
            style={{
              margin: "8px 0 0",
              maxHeight: 200,
              overflow: "auto",
              fontFamily: T.mono,
              fontSize: 12,
              color: T.muted,
              whiteSpace: "pre-wrap",
            }}
          >
            {run.tail}
          </pre>
        )}
      </div>
    </div>
  );
}
