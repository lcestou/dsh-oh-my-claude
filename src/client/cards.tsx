// The cards the panel and the dock draw: the starter slot, the draft relay, and the steer, compact,
// limit, suggestion, login and Claude-update cards, plus the helpers they all share.
import { t, useLocale } from "./i18n.js";
import { useEffect, useRef, useState } from "react";
import { IconPaperclipOutlineRegular } from "./icons.js";
import {
  ROUTE,
  useNarrow,
  T,
  btn,
  readJson,
  ACCENT,
  claudeProviderOf,
  type ClientCtx,
} from "./shared.js";
import type { LoginNeed, SteerAttachmentRow, SteerCardData } from "./events.js";
import { Spark } from "./spark.js";
import { worstLimit } from "./limits.js";
import { noteWithdrawn } from "./steer-restore.js";
import { takeDraft, subscribeDraft, noteDraft } from "./draft.js";
import { useHintFlag } from "./hints.js";
import { Chevron, LoginSteps, useLoginFlow } from "./boxes.js";
import { size } from "./sessions-tab.js";
import { kTokens, loadUsage, resetText, sessionModelOf } from "./context-meter.js";
import { StarterCard } from "./settings-card.js";

/** Slot wrapper: reads the live draft through dsh's own input hook before handing the card its props.
 *  The hook comes in as a prop, so the read has to happen in a component dsh renders, not in the
 *  registration callback. */
export function StarterSlot({
  sessionId,
  ctx,
  inputActions,
  useInput,
}: {
  sessionId?: string;
  ctx: ClientCtx;
  inputActions?: { setDraft: (text: string) => void };
  useInput?: <T>(select: (state: { draft: string }) => T) => T;
}) {
  const draft = useInput?.((state) => state.draft) ?? "";
  const [off] = useHintFlag("starterOff");
  if (off || sessionId === undefined || inputActions === undefined) return null;
  return (
    <StarterCard
      sessionId={sessionId}
      ctx={ctx}
      draft={draft}
      setDraft={(text) => inputActions.setDraft(text)}
    />
  );
}

/** Renderless: writes a draft the panel queued into the composer. The panel has no `setDraft` of its
 *  own, and this slot does, so Review my changes crosses here. */
export function DraftRelay({
  sessionId,
  inputActions,
  useInput,
}: {
  sessionId?: string;
  inputActions?: { setDraft: (text: string) => void };
  useInput?: <T>(select: (state: { draft: string }) => T) => T;
}) {
  // Mirrored out for the recap watcher, which is an interval and so cannot call a hook. Cleared on
  // unmount: a composer that is gone has no text in it, and a stale value would mute every recap.
  const draft = useInput?.((state) => state.draft) ?? "";
  useEffect(() => {
    noteDraft(draft);
    return () => noteDraft("");
  }, [draft]);
  useEffect(() => {
    if (sessionId === undefined || inputActions === undefined) return;
    const flush = () => {
      const text = takeDraft(sessionId);
      if (text !== undefined) inputActions.setDraft(text);
    };
    flush(); // queued before this mounted, e.g. the panel closed on the same click
    return subscribeDraft(flush);
  }, [sessionId, inputActions]);
  return null;
}

/** Compare two LoginNeeds by identity or by matching host and label, so a re-rendered need counts
 *  the same one. */
export const sameNeed = (a: LoginNeed | null, b: LoginNeed | null): boolean =>
  a === b || (a !== null && b !== null && a.host === b.host && a.label === b.label);

/** A bare control in a dock card's header: the copy and close buttons, the update card's close. */
export const iconBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "0 2px",
  lineHeight: 1,
  flex: "0 0 auto",
} as const;

/** A dock card's fold toggle: a real button laid out as the header bar it replaced. The resets take
 *  back what a `<button>` brings (border, background, font, centred text), and `minWidth: 0` lets a
 *  long label truncate instead of pushing the close off the card. */
export const HEADER_TOGGLE = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flex: 1,
  minWidth: 0,
  margin: 0,
  background: "none",
  border: "none",
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
} as const;

/** How long the update card stays after a success before closing on its own. */
const CLOSE_AFTER_S = 10;

/** Mirrors the server's `ClaudeUpdateCard`: the box a session runs on and the two versions. */
export interface ClaudeUpdateCardData {
  host: string;
  label: string;
  installed: string;
  latest: string;
  folded: boolean;
}
/** Compare two update-card data objects by identity or by host, installed and latest versions, so a
 *  re-rendered card matches the last drawn one. */
export const sameCard = (a: ClaudeUpdateCardData | null, b: ClaudeUpdateCardData | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.host === b.host &&
    a.installed === b.installed &&
    a.latest === b.latest &&
    a.folded === b.folded);

/** The release's entry on Claude Code's changelog page: its anchors are the version with dots as
 *  hyphens, `#2-1-277`. */
const claudeReleaseNotes = (version: string): string =>
  `https://code.claude.com/docs/en/changelog#${version.replace(/\./g, "-")}`;

/** The loudest plan limit the session's model counts against, rechecked every minute through the
 *  usage route's own one-minute cache, so a model switched mid-session is picked up on the next
 *  read. Undefined while nothing binding is past normal, or when usage cannot be read. */
export function useBindingLimit(sessionId: string, ctx: ClientCtx) {
  const [limit, setLimit] = useState<ReturnType<typeof worstLimit>>(undefined);
  useEffect(() => {
    let live = true;
    const read = () =>
      loadUsage(claudeProviderOf(ctx, sessionId)).then(
        (r) =>
          live &&
          setLimit(r.ok ? worstLimit(r.windows, sessionModelOf(ctx, sessionId)) : undefined),
        () => {},
      );
    void read();
    const timer = setInterval(read, 60_000);
    // A model switch changes which limits count, so it rereads at once rather than on the clock;
    // usage itself comes from the route's cache, so this costs no request.
    let off: (() => void) | undefined;
    try {
      off = ctx.modelDirectories.directoryFor(sessionId).store.subscribe(() => void read());
    } catch {
      // Not bound in this tab yet: the clock still covers it.
    }
    return () => {
      live = false;
      clearInterval(timer);
      off?.();
    };
  }, [sessionId, ctx]);
  return limit;
}

/** One request to the steer-edit route, as its validation accepts them. */
type SteerAction =
  | { action: "hold" | "remove" | "sendNow"; ids: string[] }
  | { action: "save"; holdId: string; text: string }
  | { action: "restore" | "drop"; holdId: string };

/** What the steer-edit route answers when it refuses. */
type SteerEditFailure = { reason?: "sent" | "gone" | "error" | "relayed"; error?: string };

/** The line under a row when an edit or removal did not happen, in the reader's language. */
const steerFailureText = (f: SteerEditFailure): string =>
  f.reason === "gone"
    ? t("main.steer.gone")
    : f.reason === "relayed"
      ? t("main.steer.relayedNoSend")
      : f.reason === "error"
        ? t("main.steer.error", { error: f.error ?? t("common.unknownError") })
        : t("main.steer.sent");

/** A chip's size: under a kilobyte in bytes, since the shared formatter rounds those to 0 KB. */
const chipSize = (bytes: number): string => (bytes < 1000 ? `${bytes} B` : size(bytes));

/** The files and images on a waiting or held steer, as small chips in the order the message holds
 *  them: a file by name and size, an image by its name or the word for image. Draws nothing for a
 *  text-only message. */
function SteerAttachments({ items }: { items: SteerAttachmentRow[] | undefined }) {
  useLocale();
  if (!items?.length) return null;
  return (
    <ul
      data-omc-steer-attachments=""
      aria-label={t("main.steer.attachmentsAria")}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        margin: "0 0 2px",
        padding: 0,
        listStyle: "none",
      }}
    >
      {items.map((a, i) => {
        const label = a.name ?? t("main.steer.image");
        // An older dsh's image reference may carry no size; the chip then names it alone.
        const sized = a.bytes > 0;
        return (
          <li
            key={`${label}:${i}`}
            data-omc-steer-attachment={a.kind}
            title={label}
            aria-label={
              sized
                ? t("main.steer.attachmentAria", { name: label, size: chipSize(a.bytes) })
                : label
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              maxWidth: 220,
              padding: "1px 6px",
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              color: T.faint,
              fontSize: 12,
            }}
          >
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <IconPaperclipOutlineRegular size={12} />
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {label}
            </span>
            {sized && <span aria-hidden="true">{chipSize(a.bytes)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The card above the composer for typed steers Claude has not read yet. Edit (or Edit all, joining
 *  them one per line, as Claude Code's up arrow does) takes them back from Claude first, so nothing
 *  goes out while the editor is open; Save sends one message with the new text, Cancel or Escape
 *  puts the originals back, Remove drops them. The editor is drawn from the server's hold, not local
 *  state, so a refresh mid-edit brings it back. `refresh` re-polls at once so the list follows. */
export function SteerCard({
  steers,
  sessionId,
  refresh,
}: {
  steers: SteerCardData;
  sessionId: string;
  refresh: () => void;
}) {
  useLocale();
  // Typed text per hold. A hold's own text seeds it; a poll never overwrites what someone typed.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);
  // Send now takes the rows back as a hold while the turn is cut short, then sends them once
  // Claude is idle. This keeps the ids of the holds that already stood when it was pressed; any
  // other hold seen while it runs is Send now's own and is drawn as a row going out, not as an
  // editor. Drawn as an editor, it flashed the edit box for a moment on every Send now.
  const [sendingFrom, setSendingFrom] = useState<ReadonlySet<string> | null>(null);
  const sending = steers.held.filter((h) => sendingFrom !== null && !sendingFrom.has(h.id));
  const editing = steers.held.filter((h) => !sending.includes(h));
  // A process fact from the server: the CLI is inside a dsh tool, which blocks Send now for every
  // row, a stdin one typed before the tool call included.
  const inTool = steers.inTool === true;

  /** Post one action for the row or hold `id`, then re-poll; a refusal leaves its line under it. */
  const act = async (id: string, body: SteerAction) => {
    if ("ids" in body) noteWithdrawn(body.ids);
    setBusy(id);
    setFailed(null);
    if (body.action === "sendNow") setSendingFrom(new Set(steers.held.map((h) => h.id)));
    try {
      const r = await fetch(`${ROUTE}/steer-edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, ...body }),
      });
      // SAFETY: our own JSON route; both answers carry these optional fields
      const reply = (await r.json()) as { ok?: boolean } & SteerEditFailure;
      if (!reply.ok) setFailed({ id, text: steerFailureText(reply) });
    } catch (e) {
      setFailed({
        id,
        text: t("main.steer.error", { error: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setBusy(null);
      setSendingFrom(null);
      refresh();
    }
  };

  /** Send a hold's typed text in its place; blank only when the hold keeps a file or image, which
   *  then goes alone. */
  const save = (holdId: string, fallback: string, hasFiles: boolean) => {
    const text = drafts[holdId] ?? fallback;
    if (text.trim() !== "" || hasFiles) void act(holdId, { action: "save", holdId, text });
  };

  const buttonStyle = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0 4px",
    color: T.faint,
    fontSize: 12,
  } as const;
  /** The line under a row or hold when its last action was refused. */
  const failure = (id: string) =>
    failed?.id === id ? (
      <div role="alert" style={{ color: T.err, fontSize: 12, marginTop: 2 }}>
        {failed.text}
      </div>
    ) : null;

  return (
    <section
      data-omc-steer-card=""
      aria-label={t("main.steer.title")}
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ flex: 1, color: T.faint, fontSize: 12 }}>
          {t("main.steer.title")} ·{" "}
          {editing.length > 0
            ? t("main.steer.heldHint")
            : inTool
              ? t("main.steer.relayedHint")
              : t("main.steer.hint")}
        </span>
        {steers.waiting.length > 1 && (
          <>
            <button
              type="button"
              data-omc-steer-edit-all=""
              aria-label={t("main.steer.editAllAria")}
              disabled={busy !== null}
              onClick={() =>
                void act("all", { action: "hold", ids: steers.waiting.map((w) => w.id) })
              }
              style={buttonStyle}
            >
              {t("main.steer.editAll")}
            </button>
            {!inTool && (
              <button
                type="button"
                data-omc-steer-send-all=""
                aria-label={t("main.steer.sendAllNowAria")}
                title={t("main.steer.sendNowTitle")}
                disabled={busy !== null}
                onClick={() =>
                  void act("all", { action: "sendNow", ids: steers.waiting.map((w) => w.id) })
                }
                style={buttonStyle}
              >
                {t("main.steer.sendAllNow")}
              </button>
            )}
          </>
        )}
      </div>
      {failure("all")}
      {sending.map((h) => (
        <div key={h.id} data-omc-steer-sending={h.id} style={{ padding: "4px 0" }}>
          <SteerAttachments items={h.attachments} />
          <span
            style={{
              color: T.faint,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {h.text}
          </span>
        </div>
      ))}
      {editing.map((h) => {
        const disabled = busy === h.id;
        const value = drafts[h.id] ?? h.text;
        const hasFiles = Boolean(h.attachments?.length);
        return (
          <div key={h.id} data-omc-steer-hold={h.id} style={{ padding: "4px 0" }}>
            <SteerAttachments items={h.attachments} />
            <textarea
              data-omc-steer-input=""
              aria-label={t("main.steer.inputAria")}
              aria-describedby={hasFiles ? `omc-steer-kept-${h.id}` : undefined}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
              autoFocus
              value={value}
              disabled={disabled}
              rows={Math.min(8, Math.max(2, value.split("\n").length))}
              onChange={(e) => setDrafts((d) => ({ ...d, [h.id]: e.target.value }))}
              onKeyDown={(e) => {
                // dsh's QueueDock keys: Enter saves, Shift+Enter is a newline, Escape backs out.
                if (e.key === "Escape") {
                  e.preventDefault();
                  void act(h.id, { action: "restore", holdId: h.id });
                } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save(h.id, h.text, hasFiles);
                }
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: T.field,
                color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: "4px 6px",
                font: "inherit",
                resize: "vertical",
              }}
            />
            {hasFiles && (
              <div
                id={`omc-steer-kept-${h.id}`}
                data-omc-steer-kept=""
                style={{ color: T.faint, fontSize: 12, marginTop: 2 }}
              >
                {t("main.steer.attachmentsKept")}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
              <button
                type="button"
                data-omc-steer-remove=""
                aria-label={t("main.steer.removeAria")}
                disabled={disabled}
                onClick={() => void act(h.id, { action: "drop", holdId: h.id })}
                style={buttonStyle}
              >
                {t("common.remove")}
              </button>
              <button
                type="button"
                data-omc-steer-cancel=""
                disabled={disabled}
                onClick={() => void act(h.id, { action: "restore", holdId: h.id })}
                style={buttonStyle}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                data-omc-steer-save=""
                disabled={disabled || (value.trim() === "" && !hasFiles)}
                onClick={() => save(h.id, h.text, hasFiles)}
                style={{ ...buttonStyle, color: T.text }}
              >
                {t("save")}
              </button>
            </div>
            {failure(h.id)}
          </div>
        );
      })}
      {steers.waiting.map((s) => {
        const disabled = busy !== null;
        return (
          <div
            key={s.id}
            data-omc-steer-row={s.id}
            data-omc-steer-relayed={s.relayed ? "" : undefined}
            style={{ padding: "4px 0" }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SteerAttachments items={s.attachments} />
                <span
                  style={{
                    color: T.text,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {s.text}
                </span>
              </div>
              <button
                type="button"
                data-omc-steer-edit=""
                aria-label={t("main.steer.editAria")}
                disabled={disabled}
                onClick={() => void act(s.id, { action: "hold", ids: [s.id] })}
                style={buttonStyle}
              >
                {t("edit")}
              </button>
              <button
                type="button"
                data-omc-steer-remove=""
                aria-label={t("main.steer.removeAria")}
                disabled={disabled}
                onClick={() => void act(s.id, { action: "remove", ids: [s.id] })}
                style={buttonStyle}
              >
                {t("common.remove")}
              </button>
              {!inTool && (
                <button
                  type="button"
                  data-omc-steer-send-now=""
                  aria-label={t("main.steer.sendNowAria")}
                  title={t("main.steer.sendNowTitle")}
                  disabled={disabled}
                  onClick={() => void act(s.id, { action: "sendNow", ids: [s.id] })}
                  style={buttonStyle}
                >
                  {t("main.steer.sendNow")}
                </button>
              )}
            </div>
            {failure(s.id)}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The nudge above the composer when a session's context is mostly full: how full, what the next
 * prompt carries, and a Compact button that posts to the plugin's `/compact` route, which sends
 * Claude's own `/compact` as the next prompt the way the bridged `/claude-compact` does. Not
 * through the composer: a draft of `/claude-compact` submitted by script goes to Claude as that
 * literal text, since dsh only turns a typed slash into a command chip (seen 2026-10-22).
 */
export function CompactCard({
  percent,
  tokens,
  onCompact,
  onDismiss,
}: {
  percent: number;
  tokens: number;
  onCompact: () => void;
  onDismiss: () => void;
}) {
  useLocale();
  return (
    <div
      data-omc-compact-card=""
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{ color: percent >= 90 ? T.err : T.warn, flex: "0 0 auto" }}
          aria-hidden="true"
        >
          ●
        </span>
        <span style={{ flex: "1 1 14em", minWidth: 0 }}>
          {t("main.compact.full", { percent: Math.floor(percent), tokens: kTokens(tokens) })}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <button
            type="button"
            data-omc-compact-now=""
            onClick={onCompact}
            style={{
              background: "var(--dsw-alias-bg-elevated, transparent)",
              border: `0.5px solid ${T.border}`,
              borderRadius: 6,
              padding: "2px 8px",
              cursor: "pointer",
              color: T.text,
              fontSize: 12,
            }}
          >
            {t("main.compact.now")}
          </button>
          <button
            type="button"
            aria-label={t("main.compact.dismissAria")}
            title={t("main.compact.dismissAria")}
            onClick={onDismiss}
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
    </div>
  );
}

/** The one-line notice above the composer when the API grades a limit the session's model counts
 *  against as critical. The API grades a window critical before it is full (Fable weekly at 91%,
 *  2026-09-27), so the card says "reached" only at 100% and gives the percentage otherwise.
 *  Dismissing it hides it until that limit resets, box-wide, since the reset is the next time the
 *  notice could say something new. */
export function LimitCard({
  label,
  usedPercent,
  resetsAt,
  onDismiss,
}: {
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  onDismiss: () => void;
}) {
  useLocale();
  return (
    <div
      data-omc-limit-card=""
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{ color: usedPercent >= 100 ? T.err : T.warn, flex: "0 0 auto" }}
          aria-hidden="true"
        >
          ●
        </span>
        <span style={{ flex: 1 }}>
          {usedPercent >= 100
            ? t("main.limit.reached", { label })
            : t("main.limit.near", { label, percent: Math.floor(usedPercent) })}
          {resetsAt === null ? (
            ""
          ) : (
            <span style={{ color: T.faint }}> · {resetText(resetsAt)}</span>
          )}
        </span>
        <button
          type="button"
          aria-label={t("main.limit.dismissAria")}
          title={t("main.limit.dismissAria")}
          onClick={onDismiss}
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
      </div>
    </div>
  );
}

/** The CLI's predicted next prompt as a dock card: Use writes it into the composer (over any
 *  draft there, which is the one case a click gets wrong), Send writes it and sends it the way
 *  Enter does (only on a dsh whose composer offers `submit`, 0.2.1 and later), Dismiss hides this
 *  text in this tab. Same frame as the login card so the stack reads as one set. */
export function SuggestionCard({
  text,
  folded,
  onUse,
  onSend,
  onDismiss,
}: {
  text: string;
  /** The person is typing something else: the card fades and collapses, and its buttons stop
   *  taking clicks, until the box is cleared again. Stays mounted so the fade can run both ways. */
  folded: boolean;
  onUse: () => void;
  onSend?: () => void;
  onDismiss: () => void;
}) {
  useLocale();
  return (
    <div
      data-omc-suggestion-card=""
      data-omc-suggestion-folded={folded ? "" : undefined}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      aria-hidden={folded}
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        // The border is split out so its width can fold to nothing too: at 0.5px top and bottom
        // a folded card still drew a hairline across the dock.
        borderStyle: "solid",
        borderColor: "var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderWidth: folded ? 0 : "0.5px",
        borderRadius: "12px 12px 0 0",
        padding: folded ? "0 10px" : "8px 10px",
        fontSize: 13,
        // The fold: height and opacity ease out together; `maxHeight` stands in for height, which
        // CSS cannot animate from auto. 240px is four wrapped lines on a phone with room over; a
        // guess the CLI lets through is one short line, so the cap never shows.
        maxHeight: folded ? 0 : 240,
        opacity: folded ? 0 : 1,
        overflow: "hidden",
        pointerEvents: folded ? "none" : undefined,
        transition:
          "max-height .35s ease, opacity .35s ease, padding .35s ease, border-width .35s ease",
      }}
    >
      {/* Wraps on a phone: the text takes a line of its own under the label once the row is too
          narrow for label, text and buttons together (390 px squeezed it to three characters a
          line, 2026-10-21). */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Spark size={14} />
        <span style={{ color: ACCENT, fontWeight: 600, fontSize: 12, flex: "none" }}>
          {t("main.suggestion.label")}
        </span>
        <span
          data-omc-suggestion-text=""
          style={{ flex: "1 1 14em", minWidth: 0, overflowWrap: "break-word" }}
        >
          {text}
        </span>
        {/* One cluster, pushed right: at phone width the text takes the first line and the
            three buttons move to the next together, instead of Use staying up and Send and the
            close dropping alone (owner's phone, 2026-10-21). */}
        <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          {/* Disabled while folded: a card that is out of sight must not take the Tab key either. */}
          <button
            type="button"
            style={btn}
            data-omc-suggestion-use=""
            disabled={folded}
            onClick={onUse}
          >
            {t("main.suggestion.use")}
          </button>
          {onSend && (
            <button
              type="button"
              style={btn}
              data-omc-suggestion-send=""
              disabled={folded}
              onClick={onSend}
            >
              {t("main.suggestion.send")}
            </button>
          )}
          <button
            type="button"
            aria-label={t("main.suggestion.dismissAria")}
            title={t("main.suggestion.dismiss")}
            data-omc-suggestion-dismiss=""
            disabled={folded}
            onClick={onDismiss}
            style={{
              background: "none",
              border: "none",
              padding: "2px 4px",
              cursor: "pointer",
              color: "inherit",
              font: "inherit",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </span>
      </div>
    </div>
  );
}

/** The card above the composer after a turn failed for want of a login on its box: the same login
 *  the Boxes row runs, here so nobody has to find Settings. It only ever follows a failed turn, so a
 *  box nobody uses never asks. Once the token is stored the server clears the need and the next poll
 *  takes the card down; until then it says what to do next. */
export function LoginCard({ need, onDismiss }: { need: LoginNeed; onDismiss: () => void }) {
  useLocale();
  const [done, setDone] = useState(false);
  const { login, setLogin, startLogin, submitLogin } = useLoginFlow(() => setDone(true));
  const where = need.host ? need.label : t("main.boxes.thisBoxLower");
  return (
    <div
      data-omc-login-card={need.host || "this-box"}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Spark size={14} />
        <span style={{ flex: 1 }}>
          {done ? t("main.loginCard.loggedIn") : t("main.loginCard.loggedOut", { where })}
        </span>
        {!done && !login && (
          <button
            type="button"
            style={btn}
            data-testid="dsh-oh-my-claude-card-login"
            onClick={() => startLogin(need.host)}
          >
            {t("main.boxes.logIn")}
          </button>
        )}
        <button
          type="button"
          aria-label={t("main.loginCard.dismissAria")}
          title={t("main.loginCard.dismiss")}
          onClick={onDismiss}
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
      </div>
      {login && !done && <LoginSteps login={login} setLogin={setLogin} submit={submitLogin} />}
    </div>
  );
}

/** One run of `claude update` as the GET answers it in the box's log. */
interface UpdateOutcome {
  ok: boolean;
  from: string | null;
  to: string | null;
  note?: string;
}

/** The card above the composer when a newer Claude Code is out for the box this session runs on.
 *  A headless claude never updates itself, so the button runs `claude update` there from dsh. The
 *  POST answers at once and the card follows the run through the GET every 3 s, since a request
 *  held open for the download would be cut by the reverse proxy this box is reached through. Once
 *  clicked the card owns its own life until ×: the dock's poll would otherwise take it down the
 *  moment `installed` moves, before anyone has read what happened. */
export function ClaudeUpdateCard({
  update,
  sessionId,
  onAct,
  onGone,
}: {
  update: ClaudeUpdateCardData;
  sessionId: string;
  onAct: () => void;
  onGone: () => void;
}) {
  useLocale();
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "declined" | "failed">("idle");
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);
  const where = update.host ? update.label : t("main.boxes.thisBoxLower");
  const Where = update.host ? update.label : t("main.sessions.thisBox");
  // `host` is the box this card is about, so its Update button never lands on another one: the
  // card is drawn from the picked mount, and the run has to follow the card.
  const url = `${ROUTE}/claude-update?session=${encodeURIComponent(sessionId)}&host=${encodeURIComponent(update.host)}`;
  const fail = (note: string) => {
    setOutcome({ ok: false, from: update.installed, to: null, note });
    setPhase("failed");
  };
  const start = (body: { run: true; auto?: true }) => {
    onAct();
    setPhase("busy");
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => readJson<{ busy: boolean }>(r))
      .catch((e: Error) => fail(e.message));
  };
  const dismiss = () => {
    onAct();
    if (phase === "idle")
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skip: update.latest }),
      }).catch(() => {});
    onGone();
  };
  // Follow the run: the GET until `busy` is false, then the newest log entry is the outcome.
  useEffect(() => {
    if (phase !== "busy") return;
    let live = true;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const s = await readJson<{ busy: boolean; log: UpdateOutcome[] }>(await fetch(url));
        if (!live) return;
        if (s.busy) {
          if (Date.now() - startedAt > 200_000) fail(t("main.update.noAnswer200"));
          return;
        }
        const last = s.log[s.log.length - 1];
        if (!last) return fail(t("main.update.noRun"));
        setOutcome(last);
        setPhase(last.ok ? "done" : last.to !== null && last.note ? "declined" : "failed");
      } catch {
        // a missed poll is retried on the next tick
      }
    };
    const id = setInterval(() => void tick(), 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [phase, url]);
  const text =
    phase === "done"
      ? t("main.update.cardDone", {
          where,
          to: outcome?.to ?? update.latest,
          installed: update.installed,
        })
      : phase === "declined"
        ? t("main.update.cardDeclined", { note: outcome?.note ?? t("main.update.noReason") })
        : phase === "failed"
          ? t("main.update.cardFailed", { note: outcome?.note ?? t("main.update.noAnswerShort") })
          : null;
  const narrow = useNarrow();
  const label =
    phase === "busy"
      ? t("main.update.updating")
      : phase === "done"
        ? t("main.update.updated")
        : phase === "declined"
          ? t("main.update.notUpdated")
          : phase === "failed"
            ? t("main.update.retryShort")
            : t("main.update.update");
  // Folded, the card is its header line, the way a side-question card folds: the label, the
  // chevron and the close. Open, the sentence and the buttons. A fold is recorded on the box for
  // this release, beside the skip: a session switch used to remount the card open (owner,
  // 2026-09-18), and a fold in one tab now reaches the others on the next poll. The close is what
  // records a skip until the next release.
  const [open, setOpen] = useState(!update.folded);
  useEffect(() => setOpen(!update.folded), [update.folded]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fold: next ? null : update.latest }),
    }).catch(() => {});
  };
  // After a success the card closes on its own: a thin accent bar along its bottom edge drains
  // over CLOSE_AFTER_S seconds as one CSS animation, so the close is seen coming without a number
  // ticking. The pointer over the card, or focus inside it, pauses the animation where it is (a
  // paused animation holds its frame; a transition cut short would jump to its end), and the close
  // fires from the animation's own end event, so a pause delays it by exactly the pause. The card
  // then fades for a moment rather than popping out. A decline or a failure stays until it is read
  // and closed.
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => goneRef.current(), 250);
    return () => clearTimeout(id);
  }, [leaving]);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover and focus only pause the auto-dismiss; every action is a real button inside
    <div
      data-omc-update-card={update.latest}
      data-omc-update-phase={phase}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      // Focus holds the card too, so someone tabbing to its buttons is not raced by the timer.
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
          setHeld(false);
      }}
      style={{
        position: "relative",
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        overflow: "hidden",
        fontSize: 13,
        opacity: leaving ? 0 : 1,
        transition: "opacity .25s ease",
      }}
    >
      {phase === "done" && (
        <div
          data-omc-update-closing={held ? "held" : "running"}
          aria-hidden="true"
          title={held ? t("main.update.held") : t("main.update.closesIn", { n: CLOSE_AFTER_S })}
          onAnimationEnd={() => setLeaving(true)}
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 2,
            background: ACCENT,
            animation: `omc-drain ${CLOSE_AFTER_S}s linear forwards`,
            animationPlayState: held ? "paused" : "running",
          }}
        />
      )}
      {/* The header row holds two siblings, the fold toggle and the close, so neither button sits
          inside the other. The row keeps the old 6 px gap and 8 px right edge; the toggle carries
          the rest of the old padding so the whole bar left of the close is still one click. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 8 }}>
        <button
          type="button"
          aria-expanded={open}
          data-omc-update-toggle=""
          onClick={toggle}
          style={{ ...HEADER_TOGGLE, padding: "6px 0 6px 8px" }}
        >
          <Spark size={12} />
          {/* The label alone: the sentence lives in the body, where a phone shows it whole. */}
          <span style={{ color: ACCENT, fontWeight: 600, fontSize: 12, flex: 1 }}>
            {t("main.update.cardTitle")}
          </span>
          <Chevron open={open} />
        </button>
        <button
          type="button"
          aria-label={phase === "idle" ? t("main.update.dismissNextRelease") : t("close")}
          title={phase === "idle" ? t("main.update.dismissNextRelease") : t("close")}
          onClick={() => dismiss()}
          style={{ ...iconBtn, color: T.muted, fontSize: 12 }}
        >
          ✕
        </button>
      </div>
      {open ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            // Flush with the spark above, not indented under the label as a side question's
            // answer is: the buttons are the body, not a quote.
            padding: "0 8px 8px",
          }}
        >
          {/* On a phone the sentence takes its own line and the buttons the next; wider, one line. */}
          <span
            style={{
              flex: narrow ? "1 1 100%" : 1,
              minWidth: 0,
              color: phase === "failed" ? T.err : phase === "declined" ? T.faint : undefined,
            }}
          >
            {text ?? (
              <>
                {t("main.update.outBefore")}
                <a
                  data-omc-update-notes=""
                  href={claudeReleaseNotes(update.latest)}
                  target="_blank"
                  rel="noreferrer"
                  title={t("main.update.notesTitle")}
                  style={{ color: ACCENT }}
                >
                  {update.latest}
                </a>
                {t("main.update.outAfter", { where: Where, installed: update.installed })}
              </>
            )}
          </span>
          <button
            type="button"
            style={btn}
            data-testid="dsh-oh-my-claude-card-update"
            disabled={phase === "busy" || phase === "done" || phase === "declined"}
            aria-busy={phase === "busy" ? "true" : undefined}
            onClick={() => start({ run: true })}
          >
            {label}
          </button>
          {phase === "idle" && (
            <button
              type="button"
              aria-label={t("main.update.alwaysAria")}
              title={t("main.update.alwaysTitle")}
              onClick={() => start({ run: true, auto: true })}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0 2px",
                color: T.faint,
                textDecoration: "underline",
                fontSize: 12,
              }}
            >
              {t("main.update.always")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
