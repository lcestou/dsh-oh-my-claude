// Reply shapes, event shapes and the shared types behind the server's control surface.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { LlmError } from "@deepseek-ai/dsh-llm";
/** Whether a step's end keeps the status row's live figures: only when the step parked the CLI
 *  mid-turn (on a dsh tool dsh is running, or on a steer), since dsh calls back within the same
 *  turn. Every other outcome is the turn ending. */
export const keepsLiveTurn = (outcome) => outcome === "relayed" || outcome === "parked";
/** A live process always carries the prep it was spawned with; acquire() sets it before use. */
/** A process parked on a relayed tool call or a steer is mid-turn, not idle. */
export const isSettled = (p) => !p.busy && p.relays.size === 0 && !p.parked;
/** Throw rather than return a null prep: a process is assumed to carry the turn state acquire() set, so a missing one means it was used out of order. */
export function requirePrep(proc) {
    if (!proc.prep)
        throw new LlmError("claude process has no turn state", "PROVIDER_ERROR");
    return proc.prep;
}
/** What the steer card's route answers. `sent`: Claude already has it (or it was never waiting);
 *  `gone`: no live process; `error`: the CLI did not answer the cancel. */
/** Whether the CLI is inside a dsh tool right now: a live process with a relay pending. Reads the
 *  relay map as optional because the test fakes build processes field by field, and the ones that
 *  never relay carry no map. */
export const inRelay = (proc) => proc?.alive === true && (proc.relays?.size ?? 0) > 0;
/** How long a hold waits for a poll before it goes back to Claude unchanged. The card polls every
 *  3 s while its tab is visible; a minute covers a tab switch mid-edit without leaving a closed
 *  tab's message stranded for long. */
export const HOLD_IDLE_MS = 60_000;
/** The CLI's `result` frame (or its absence) as a reply. Pulled out of the spawn so the mapping is
 *  unit-tested without a process: a decline keeps its text for the card to show verbatim, a missing
 *  frame is a start failure, and `partial` marks a user-skills-only fallback run. */
export function skillDoctorReply(result, partial, failure) {
    if (result === null)
        return { ok: false, error: failure };
    const report = String(result.result ?? "");
    if (result.is_error)
        return { ok: false, declined: true, error: report };
    return partial ? { ok: true, report, partial: true } : { ok: true, report };
}
/** The key every live process is stored under, `providerId` then `sessionId`; a session id must not contain a colon or it would collide with this separator. */
export function registryKey(providerId, sessionId) {
    return `${providerId}:${sessionId}`;
}
//# sourceMappingURL=types.js.map