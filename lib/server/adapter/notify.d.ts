/** What a notice is about. `test` is the Settings button's, never scheduled. */
export type NotifyEvent = "finished" | "approval" | "question" | "plan" | "test";
/** The delay used when the hints store holds none. */
export declare const NOTIFY_DELAY_MS = 60000;
/** The delays Settings offers; anything else in the store reads as the default. */
export declare const NOTIFY_DELAY_CHOICES: readonly [0, 30000, 60000, 300000];
/** The stored delay when it is one of the choices, else the default. A hand-edited 45000 reads as
 *  the default rather than as itself, so the select never shows a value it has no option for. */
export declare const notifyDelayIn: (stored: boolean | number | undefined) => number;
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
/** The notice for `event`, in the server's stored language. The tool name is a code token and is
 *  never translated. What leaves the box is the session title (dsh often writes it from the
 *  first message) and this one event line; no message text or tool output is ever included. */
export declare function noteFor(event: NotifyEvent, session: string | null, title: string | undefined, tool?: string): Note;
/** The link a notice opens: the saved origin with the session the plugin's client opens on load,
 *  or null when no form was ever saved (the box cannot know the address a phone reaches it by). */
export declare const clickUrl: (openUrl: string | null, session: string | null) => string | null;
/**
 * Send `note` everywhere the box is set to send: the webhook as JSON and each device as Web Push,
 * all at once, so a webhook that hangs for its 10 s does not hold the pushes. Never throws; a
 * failure is in the report and in one `warn` line. A device whose push service answers 404 or 410
 * has unsubscribed or expired: it is removed from the list and every open Settings tab is told
 * (`notify` event). Any other failure keeps it, since a 5xx or a timeout says nothing about the
 * subscription. Push requests never follow a redirect: a 3xx counts as failed.
 */
export declare function deliver(dir: string, note: Note, log: (level: "info" | "warn", msg: string) => void, fetchImpl?: typeof fetch): Promise<DeliveryReport>;
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
export declare class Notifier {
    private readonly deps;
    private readonly timers;
    private readonly gen;
    /** @param deps the box's state dir and hints reader; `send` defaults to `deliver`. */
    constructor(deps: NotifierDeps);
    /** Bump and return the session's generation, dropping any pending timer. */
    private bump;
    /** Drop the session's pending notice, if any. Cheap enough to call on every prompt. */
    cancel(sessionId: string): void;
    /** Arm a notice for `req` after the box's delay. Does nothing while `notifyOn` is not set; the
     *  hints are read again at send time, so turning the switch off also stops a pending one. */
    schedule(req: NotifyRequest): void;
    /** Send `req`'s notice if nothing superseded it: same generation, still true, switch still on,
     *  and not a subagent's finished turn. */
    private fire;
}
