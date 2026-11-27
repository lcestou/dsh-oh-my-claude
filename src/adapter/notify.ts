// Phone notices: when a Claude turn finishes or a session stops for an approval, a question or a
// plan, wait the box's delay and, unless the person answered or started a new turn by then, send
// one notice through the webhook and Web Push. Off until `notifyOn` is set in the hints store.
import { serverText } from "../locale.js";
import { hub } from "../events.js";
import { errorText } from "../process.js";
import {
  deviceId,
  readDevices,
  readNotifyConfig,
  removeDevices,
  vapidKeys,
} from "../notify-store.js";
import { encryptPayload, vapidAuthorization } from "./web-push.js";

/** What a notice is about. `test` is the Settings button's, never scheduled. */
export type NotifyEvent = "finished" | "approval" | "question" | "plan" | "test";

/** The delay used when the hints store holds none. */
export const NOTIFY_DELAY_MS = 60_000;

/** The delays Settings offers; anything else in the store reads as the default. */
export const NOTIFY_DELAY_CHOICES = [0, 30_000, 60_000, 300_000] as const;

/** The stored delay when it is one of the choices, else the default. A hand-edited 45000 reads as
 *  the default rather than as itself, so the select never shows a value it has no option for. */
export const notifyDelayIn = (stored: boolean | number | undefined): number =>
  NOTIFY_DELAY_CHOICES.find((ms) => ms === stored) ?? NOTIFY_DELAY_MS;

/** One notice, in the words the person reads. `session` is null for the test notice. */
export interface Note {
  event: NotifyEvent;
  session: string | null;
  title: string;
  message: string;
  tool?: string;
}

/** What one delivery did: the webhook's outcome (`none` when no webhook is set, `ok`, or the
 *  failure as text), and per device how many pushes went out, failed, or were dropped as gone. */
export interface DeliveryReport {
  webhook: string;
  sent: number;
  failed: number;
  removed: number;
}

/** The longest session title a notice carries; a push body must stay under 4 KB encrypted. */
const TITLE_MAX = 120;

/** No push or webhook call may hold a notice longer than this. */
const SEND_TIMEOUT_MS = 10_000;

/** The notice for `event`, in the server's stored language. The tool name is a code token and is
 *  never translated. What leaves the box is the session title (dsh often writes it from the
 *  first message) and this one event line; no message text or tool output is ever included. */
export function noteFor(
  event: NotifyEvent,
  session: string | null,
  title: string | undefined,
  tool?: string,
): Note {
  const message =
    event === "finished"
      ? serverText("notifyFinished")
      : event === "approval"
        ? serverText("notifyApproval", { tool: tool ?? "tool" })
        : event === "question"
          ? serverText("notifyQuestion")
          : event === "plan"
            ? serverText("notifyPlan")
            : serverText("notifyTest");

  const named = title?.trim() || (event === "test" ? "Oh My Claude" : serverText("notifyUntitled"));
  const note: Note = { event, session, title: named.slice(0, TITLE_MAX), message };

  if (tool !== undefined) {
    note.tool = tool;
  }

  return note;
}

/** The link a notice opens: the saved origin with the session the plugin's client opens on load,
 *  or null when no form was ever saved (the box cannot know the address a phone reaches it by). */
export const clickUrl = (openUrl: string | null, session: string | null): string | null =>
  openUrl === null
    ? null
    : session === null
      ? `${openUrl}/`
      : `${openUrl}/?omc-open=${encodeURIComponent(session)}`;

/** The push `Topic` header: a later notice for the same session replaces one the phone has not
 *  fetched yet. RFC 8030 allows 32 base64url characters. */
const topicOf = (session: string | null): string =>
  session === null ? "omc-test" : session.replaceAll(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "omc";

/** POST `note` to the webhook as JSON; resolves `ok`, or the failure as text (after one `warn`
 *  line). Never rejects. */
async function sendWebhook(
  url: string,
  note: Note,
  click: string | null,
  log: (level: "info" | "warn", msg: string) => void,
  fetchImpl: typeof fetch,
): Promise<string> {
  const headers = new Headers({ "content-type": "application/json" });

  // ntfy opens `click` on a tap; other receivers ignore an unknown header.
  if (click !== null) {
    headers.set("click", click);
  }

  let outcome: string;

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "dsh-oh-my-claude", ...note, click, at: Date.now() }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    outcome = res.ok ? "ok" : `HTTP ${res.status}`;
  } catch (error) {
    outcome = errorText(error);
  }

  if (outcome !== "ok") {
    log("warn", `phone notice: webhook failed: ${outcome}`);
  }

  return outcome;
}

/**
 * Send `note` everywhere the box is set to send: the webhook as JSON and each device as Web Push,
 * all at once, so a webhook that hangs for its 10 s does not hold the pushes. Never throws; a
 * failure is in the report and in one `warn` line. A device whose push service answers 404 or 410
 * has unsubscribed or expired: it is removed from the list and every open Settings tab is told
 * (`notify` event). Any other failure keeps it, since a 5xx or a timeout says nothing about the
 * subscription. Push requests never follow a redirect: a 3xx counts as failed.
 */
export async function deliver(
  dir: string,
  note: Note,
  log: (level: "info" | "warn", msg: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryReport> {
  const report: DeliveryReport = { webhook: "none", sent: 0, failed: 0, removed: 0 };
  const config = await readNotifyConfig(dir);
  const click = clickUrl(config.openUrl, note.session);

  const webhook =
    config.webhookUrl === null
      ? Promise.resolve("none")
      : sendWebhook(config.webhookUrl, note, click, log, fetchImpl);

  const devices = await readDevices(dir);

  if (devices.length === 0) {
    report.webhook = await webhook;

    return report;
  }

  const keys = await vapidKeys(dir);

  const payload = Buffer.from(
    JSON.stringify({ title: note.title, body: note.message, session: note.session }),
  );

  const gone = new Set<string>();
  await Promise.all(
    devices.map(async (d) => {
      try {
        const res = await fetchImpl(d.endpoint, {
          method: "POST",
          headers: {
            authorization: vapidAuthorization(d.endpoint, keys),
            "content-encoding": "aes128gcm",
            "content-type": "application/octet-stream",
            ttl: "3600",
            urgency: note.event === "finished" || note.event === "test" ? "normal" : "high",
            topic: topicOf(note.session),
          },
          body: new Uint8Array(encryptPayload(payload, d.p256dh, d.auth)),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          redirect: "manual",
        });

        if (res.ok) {
          report.sent++;
        } else if (res.status === 404 || res.status === 410) {
          gone.add(deviceId(d.endpoint));
        } else {
          report.failed++;
          log("warn", `phone notice: push to ${new URL(d.endpoint).host} answered ${res.status}`);
        }
      } catch (error) {
        report.failed++;
        log("warn", `phone notice: push failed: ${errorText(error)}`);
      }
    }),
  );

  if (gone.size > 0) {
    await removeDevices(dir, gone);
    report.removed = gone.size;
    hub.publish({ kind: "notify", session: null, data: {} });
  }

  report.webhook = await webhook;

  return report;
}

/** One event handed to the notifier by the adapter. `still` answers, at send time, whether the
 *  thing is still true (the prompt with this request id is still open); `isChild` whether the
 *  session is a subagent's. A child's finished turn is skipped (its parent's turn goes on), but its
 *  approval, question or plan is sent: the parent sits blocked inside the subagent call and raises
 *  no event of its own, so the child's prompt is the only signal. */
export interface NotifyRequest {
  sessionId: string;
  event: Exclude<NotifyEvent, "test">;
  /** The tool an approval is for; undefined for every other event. */
  tool: string | undefined;
  still: () => boolean;
  title: () => string | undefined;
  isChild: () => Promise<boolean>;
  log: (level: "info" | "warn", msg: string) => void;
}

/** What the notifier needs from the box: the state dir, a hints read, and (for the test) a stand-in
 *  for `deliver` and the clock. */
export interface NotifierDeps {
  dir: string;
  hints: () => Promise<Record<string, boolean | number>>;
  send?: (dir: string, note: Note, log: NotifyRequest["log"]) => Promise<DeliveryReport>;
}

/**
 * Holds at most one pending notice per session. A new event for the session replaces the pending
 * one; `cancel` (a prompt sent, a steer written) drops it. Each schedule and cancel bumps the
 * session's generation, and a notice checks its generation after every await, so a cancel that
 * lands while the hints read is still in flight is not undone by the timer that read arms.
 *
 * The rule gets one case wrong on purpose: someone reading a long reply at the desk for longer than
 * the delay gets a phone notice for a turn they watched end. Telling "at the desk" from "away" would
 * need the tab to report focus to the box; the delay is the cheap stand-in, and 0 to 5 minutes is
 * the person's to pick.
 */
export class Notifier {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly gen = new Map<string, number>();

  /** @param deps the box's state dir and hints reader; `send` defaults to `deliver`. */
  constructor(private readonly deps: NotifierDeps) {}

  /** Bump and return the session's generation, dropping any pending timer. */
  private bump(sessionId: string): number {
    const t = this.timers.get(sessionId);

    if (t !== undefined) {
      clearTimeout(t);
    }

    this.timers.delete(sessionId);
    const next = (this.gen.get(sessionId) ?? 0) + 1;
    this.gen.set(sessionId, next);

    return next;
  }

  /** Drop the session's pending notice, if any. Cheap enough to call on every prompt. */
  cancel(sessionId: string): void {
    if (this.timers.has(sessionId) || this.gen.has(sessionId)) {
      this.bump(sessionId);
    }
  }

  /** Arm a notice for `req` after the box's delay. Does nothing while `notifyOn` is not set; the
   *  hints are read again at send time, so turning the switch off also stops a pending one. */
  schedule(req: NotifyRequest): void {
    const mine = this.bump(req.sessionId);
    void this.deps
      .hints()
      .then((h) => {
        if (h.notifyOn !== true || this.gen.get(req.sessionId) !== mine) {
          return;
        }

        // A send that throws (a key file that cannot be written, say) is logged, not left to
        // reject with nothing listening.
        const timer = setTimeout(
          () =>
            void this.fire(req, mine).catch((error: Error) =>
              req.log("warn", `phone notice: send failed: ${errorText(error)}`),
            ),
          notifyDelayIn(h.notifyDelayMs),
        );

        // A pending notice must not keep a test process or a shutting-down dsh alive.
        timer.unref?.();
        this.timers.set(req.sessionId, timer);
      })
      .catch((error: Error) => req.log("warn", `phone notice: hints unreadable: ${error.message}`));
  }

  /** Send `req`'s notice if nothing superseded it: same generation, still true, switch still on,
   *  and not a subagent's finished turn. */
  private async fire(req: NotifyRequest, mine: number): Promise<void> {
    this.timers.delete(req.sessionId);
    const current = () => this.gen.get(req.sessionId) === mine;

    if (!current() || !req.still()) {
      return;
    }

    if ((await this.deps.hints()).notifyOn !== true || !current()) {
      return;
    }

    if ((req.event === "finished" && (await req.isChild())) || !current()) {
      return;
    }

    const send = this.deps.send ?? deliver;
    await send(this.deps.dir, noteFor(req.event, req.sessionId, req.title(), req.tool), req.log);
  }
}
