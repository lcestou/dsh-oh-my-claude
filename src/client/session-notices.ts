// Notices for Claude sessions: the OS notification, the tab title mark and the recap nudge that
// backs them. The entry keeps one import line for what it still uses.
import { t } from "./i18n.js";
import {
  ROUTE,
  readJson,
  isClaudeSession,
  openSession,
  openSessionId,
  whenContextGone,
  guard,
  type ClientCtx,
} from "./shared.js";
import { livingModelId } from "../model-ids.js";
import type { FallbackRecord } from "../translator.js";
import { pollEvery, streamUp, subscribe } from "./events.js";
import { draftPending } from "./draft.js";
import {
  awaitingBody,
  markTitle,
  newlyAwaiting,
  newlyWaiting,
  noticesOn,
  recapNext,
  recapOnIn,
  recapAwayIn,
  RECAP_QUESTION,
  type AwaitingRow,
  type NoticeSnapshot,
} from "./notices.js";
import { HINTS_EVENT, loadHints } from "./hints.js";

/**
 * Watch dsh's turn-status elements and restyle ones driven by claude-code sessions.
 * ponytail: DOM hook on a structural selector; swap for a slot the day the turn status grows one.
 */
/**
 * Say something when a Claude session the user is not on stops working. dsh has no notice of its
 * own (nothing in its bundle calls `Notification`), so a turn that ends in another session, or in a
 * tab behind this one, is silent.
 *
 * Two signals, both cheap: the OS notification when the browser has granted one, and a mark on the
 * tab title while the page is hidden. The list store is polled rather than subscribed to, the same
 * second-by-second read `watchTurnStatus` already does, so this holds whatever shape dsh's store
 * has today.
 */
export function watchSessionNotices(ctx: ClientCtx) {
  let prev: NoticeSnapshot | null = null;
  const waiting = new Set<string>();
  // The `at` of the last fallback announced per session, so a session that fell back once and then
  // ran clean turns does not re-announce the stale record on every later stop. `seenFallback` is in
  // memory, so a tab reload forgets it; the freshness window (FRESH_MS, beside announceStop) then
  // stops a record left over from a switch minutes ago from re-announcing on the next clean stop.
  const seenFallback: Record<string, number> = {};
  let recapPending: Record<string, number> = {};
  // Last tick's open prompts, for the diff. `null`, not `{}`: the first poll after a page load is
  // a baseline and must not fire, or a reload while a prompt is open re-announces a question the
  // person is already reading. Same rule `prev` above follows for `newlyWaiting`.
  let prevAwaiting: Record<string, AwaitingRow> | null = null;
  let lastRead = 0;
  /** Diff one awaiting map (from the stream or the fallback read) against the last one and
   *  announce every Claude session that newly holds a prompt. The first map after a page load
   *  (`prevAwaiting === null`) is a baseline and fires nothing, whichever way it arrived. */
  const onSnapshot = (nextAwaiting: Record<string, AwaitingRow>) => {
    const snap = ctx.sessions.list.getSnapshot();
    for (const id of newlyAwaiting(prevAwaiting, nextAwaiting, openSessionId(ctx))) {
      if (!isClaudeSession(ctx, id)) continue;
      const prompt = nextAwaiting[id];
      // noUncheckedIndexedAccess makes this read `AwaitingRow | undefined`; a missing row is
      // not a transition to announce, so skip it rather than pass undefined to `notifyAwaiting`.
      if (!prompt) continue;
      waiting.add(id);
      notifyAwaiting(ctx, id, snap?.byId[id]?.displayTitle ?? id, prompt);
    }
    prevAwaiting = nextAwaiting;
  };
  whenContextGone(subscribe("awaiting", (_session, data) => onSnapshot(data)));
  // The recap's two settings, kept beside the tick rather than read in it: the tick is synchronous
  // and the store is a fetch. Re-read on the same event the settings switches dispatch, so flipping
  // the switch reaches this watcher without a reload.
  let hints: Record<string, boolean | number> = {};
  const readHints = () => void loadHints().then((h) => (hints = h));
  readHints();
  window.addEventListener(HINTS_EVENT, readHints);
  whenContextGone(() => window.removeEventListener(HINTS_EVENT, readHints));
  const tick = () => {
    const snap = ctx.sessions.list.getSnapshot();
    if (!snap) return;
    const current = openSessionId(ctx);
    // Copy the compared fields into fresh rows: dsh's store may reuse row objects between calls, and
    // a shared reference would make every field read `was === now`, so no transition would ever fire.
    const byId: NoticeSnapshot["byId"] = {};
    for (const [id, s] of Object.entries(snap.byId))
      byId[id] = { running: s.running, completed: s.completed, displayTitle: s.displayTitle };
    const next: NoticeSnapshot = { byId, current };
    const stopped = newlyWaiting(prev, next).filter((id) => isClaudeSession(ctx, id));
    for (const id of stopped) {
      waiting.add(id);
      void announceStop(ctx, id, snap.byId[id]?.displayTitle ?? id, seenFallback);
    }
    prev = next;
    // A session waiting on a permission prompt keeps its stream open, so it still reads as running
    // and `newlyWaiting` never sees it stop. Poll the adapter's own map instead, and only while a
    // Claude session is running: a running dsh session cannot hold a Claude prompt, and an idle box
    // should make no requests.
    const anyClaudeRunning = Object.entries(snap.byId).some(
      ([id, s]) => s.running === true && isClaudeSession(ctx, id),
    );
    // A hidden tab keeps its bookkeeping but makes no request: this was the one unconditional
    // one-a-second poll a background tab still paid.
    if (anyClaudeRunning && !document.hidden) {
      // The map arrives on the event stream; this read is the fallback and runs every 30 s while
      // the stream is up, once a second when it is not.
      if (Date.now() - lastRead >= pollEvery(true, 1000, 1000)) {
        lastRead = Date.now();
        void fetch(`${ROUTE}/awaiting`)
          .then((r) => readJson<{ sessions?: Record<string, AwaitingRow> }>(r))
          .then((body) => onSnapshot(body.sessions ?? {}))
          .catch(() => {
            // A failed poll says nothing. The next tick asks again; a prompt is not urgent enough
            // to report a network error over.
          });
      }
    } else if (!streamUp()) {
      // Back to baseline: the next read seeds it and does not fire. With the stream up the pushed
      // maps are one continuous series and the diff holds in a hidden tab, so a prompt that opens
      // while the tab is hidden still fires, which is what a background notice is for.
      prevAwaiting = null;
    }
    // Return recap: a session that stopped working while it was not the one on screen is asked for
    // one line when it is opened. Off by default; the switch is in Settings, under Oh My Claude.
    // `recapNext` clears the id as it fires, so a return asks once and a second open of the
    // same session asks nothing. Two things this accepts on purpose: the queue is cleared before
    // `recapOn()` is read, so turning the switch on mid-session waits for the next return rather than
    // firing for a session that already came back, and the fire trusts the open session for the tick
    // it runs in, so one that lags the screen by a tick can bill a recap for a session nobody left.
    // A spurious title mark is free; a spurious recap is a model call, which is why the switch is off
    // until asked for.
    const step = recapNext(
      recapPending,
      stopped,
      current,
      Date.now(),
      recapAwayIn(hints.recapAwayMs),
    );
    recapPending = step.pending;
    // Three reasons not to spend the call, all of them the CLI's own: the switch is off, there is
    // half a prompt in the composer so the person is already saying what they want, or the session
    // picked up a new turn while the tick was deciding and the recap would describe stale work.
    if (
      step.fire !== undefined &&
      recapOnIn(hints) &&
      !draftPending() &&
      snap.byId[step.fire]?.running !== true
    ) {
      const session = step.fire;
      void fetch(`${ROUTE}/side-questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `recap: true` lets the route drop this when another tab already asked for the same
        // return. Every open tab runs this watcher with its own queue, so the tab is not the place
        // the count can be held.
        body: JSON.stringify({ session, question: RECAP_QUESTION, recap: true }),
      }).catch(() => {
        // A recap nobody typed stays quiet when it fails. The route refuses before the ring is
        // touched when there is no live process, so there is nothing to clean up here either.
      });
    }
    // Reading it clears it: the open session, and everything else once the tab is looked at again.
    if (current !== undefined) waiting.delete(current);
    if (!document.hidden) waiting.clear();
    const wanted = markTitle(document.title, waiting.size);
    if (wanted !== document.title) document.title = wanted;
  };
  tick(); // take the baseline now, so the first interval already has something to compare against
  const beat = setInterval(guard(tick), 1000);
  whenContextGone(() => clearInterval(beat));
}

/** Post a 'Claude is waiting' notification for a stopped session, or none when notifications are
 *  off or ungranted, leaving the title mark to carry it. */
function notifyWaiting(ctx: ClientCtx, id: string, title: string) {
  // Permission is only ever asked for from the panel's own toggle, so an ungranted browser is the
  // normal case here and the title mark carries it alone.
  if (!noticesOn() || !("Notification" in window) || Notification.permission !== "granted") return;
  // `tag` per session: a session that finishes twice replaces its own notice rather than stacking.
  const note = new Notification(title, { body: t("main.notice.waiting"), tag: `omc-${id}` });
  note.addEventListener("click", () => {
    window.focus();
    openSession(ctx, id);
    note.close();
  });
}

/** Post a notification for a session waiting on a permission prompt, using the prompt kind in the
 *  body; returns without one when notifications are off or ungranted. */
function notifyAwaiting(ctx: ClientCtx, id: string, title: string, prompt: AwaitingRow) {
  // Permission is only ever asked for from the panel's own toggle, so an ungranted browser is the
  // normal case here and the title mark carries it alone.
  if (!noticesOn() || !("Notification" in window) || Notification.permission !== "granted") return;
  // A tag of its own per prompt: two tabs watching the same prompt collapse to one visible notice,
  // and a session that asks twice replaces its own rather than stacking.
  const note = new Notification(title, { body: awaitingBody(prompt.kind), tag: `omc-await-${id}` });
  note.addEventListener("click", () => {
    window.focus();
    openSession(ctx, id);
    note.close();
  });
}

// How recent a fallback record must be to announce: a tab reload forgets `seenFallback`, so without
// this a record left from a switch minutes ago would re-announce on the session's next clean stop.
const FRESH_MS = 5 * 60_000;

/** On a stop, read the session's fallback record once. A fresh one (newer than the last announced,
 *  and within FRESH_MS) fires the fallback notice and moves the picker; otherwise the generic
 *  waiting notice fires. One fetch per stop, never per second. */
async function announceStop(
  ctx: ClientCtx,
  id: string,
  title: string,
  seen: Record<string, number>,
) {
  let rec: FallbackRecord | null = null;
  try {
    const r = await fetch(`${ROUTE}/side-questions?session=${encodeURIComponent(id)}`);
    if (r.ok) {
      const body = await readJson<{ fallback?: FallbackRecord | null }>(r);
      rec = body.fallback ?? null;
    }
  } catch {
    rec = null;
  }
  if (rec && rec.at > (seen[id] ?? 0) && Date.now() - rec.at < FRESH_MS) {
    seen[id] = rec.at;
    movePickerToFallback(ctx, id, rec);
    notifyFallback(ctx, id, title, rec);
    return;
  }
  notifyWaiting(ctx, id, title);
}

/** The notice body: the CLI's own sentence when it sent one, else a plain line that names the model
 *  that answered and the safeguard category. Verified against every case in the plan. */
function fallbackNoticeBody(rec: FallbackRecord): string {
  if (rec.content) return rec.content;
  const cat = rec.category ?? t("main.fallback.safety");
  const from = rec.from || t("main.fallback.pickedModel");
  const to = rec.to || t("main.fallback.anotherModel");
  if (rec.kind === "model_refusal_no_fallback") return t("main.fallback.blocked", { from, cat });
  if ((rec.scope ?? "session") === "local") return t("main.fallback.subtask", { to, cat, from });
  if (rec.direction === "sticky") return t("main.fallback.sticky", { to, cat, from });
  if (rec.direction === "revert") return t("main.fallback.revert", { to, cat, from });
  return t("main.fallback.oneMessage", { to, cat, from });
}

/** Post the fallback notice body for a session that fell back, with the same permission guard as
 *  notifyWaiting, so an ungranted browser gets the title mark alone. */
function notifyFallback(ctx: ClientCtx, id: string, title: string, rec: FallbackRecord) {
  // Same guard as notifyWaiting: an ungranted browser gets the title mark alone.
  if (!noticesOn() || !("Notification" in window) || Notification.permission !== "granted") return;
  const note = new Notification(title, {
    body: fallbackNoticeBody(rec),
    tag: `omc-fallback-${id}`,
  });
  note.addEventListener("click", () => {
    window.focus();
    openSession(ctx, id);
    note.close();
  });
}

/** Move dsh's picker onto the model that answered, only for a sticky, session-scoped safety
 *  fallback: retry/revert are one-off, local is a subagent, and the other frame kinds do not swap
 *  the session model. Mirrors StaleModelRepair's reads and its not-running guard (a model change
 *  respawns the next turn). Matches the app, which keeps the picker on Opus until the person
 *  switches back. */
function movePickerToFallback(ctx: ClientCtx, sessionId: string, rec: FallbackRecord) {
  if (
    rec.kind !== "model_refusal_fallback" ||
    rec.direction !== "sticky" ||
    (rec.scope ?? "session") !== "session" ||
    !rec.to
  )
    return;
  let dir: ReturnType<ClientCtx["modelDirectories"]["directoryFor"]>;
  try {
    dir = ctx.modelDirectories.directoryFor(sessionId);
  } catch {
    return; // unbound in this tab
  }
  const snap = dir.store.getSnapshot();
  const cur = snap.current;
  if (!cur?.provider.startsWith("claude-code")) return;
  const offered = snap.groups?.find((g) => g.id === cur.provider)?.models.map((m) => m.id);
  if (!offered || offered.length === 0) return;
  if (ctx.sessions.list.getSnapshot()?.byId[sessionId]?.running) return;
  const living = livingModelId(rec.to, offered);
  if (living && dir.select)
    void dir.select({ provider: cur.provider, model: living }).catch(() => {});
}
