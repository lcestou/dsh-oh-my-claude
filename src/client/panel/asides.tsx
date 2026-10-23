// The asides tab: the `/btw` sidebars the route returns, as pills that open a copyable answer. The row
// shape and the body that lists them.
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  btn,
  errText,
  stateText,
  codeInline,
  nested,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  ago,
} from "../shared.js";
import { t, useLocale } from "../i18n.js";

/** One `/btw` aside as the route returns it (mirrors the adapter's `AsideEntry`). */
interface AsideRow {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  pending: boolean;
  at: number;
  dismissed?: boolean;
  /** The passage the selection bar asked about; a blank `question` beside it means "explain". */
  quote?: string;
}

/**
 * The Asides tab: this session's `/btw` question-and-answer pairs, newest first. The docked bubble
 * shows only what has not been closed, and a closed card is gone from the composer for good, so this
 * is where an answer is re-read after it was dismissed or scrolled out of the dock. The list is the
 * server's ring (the last ten per session, persisted under STATE_DIR), so it survives a restart but
 * does not grow without bound.
 */
/** A small outlined state label for an aside's header: waiting, error, dismissed. */
const asidePill = (color: string): CSSProperties => ({
  fontSize: 10,
  lineHeight: "16px",
  padding: "0 6px",
  borderRadius: 8,
  border: `1px solid ${color}`,
  color,
  whiteSpace: "nowrap",
});

/** The Asides tab: this session's `/btw` questions and answers, newest first. Renders an error
 *  line, a loading line, or an empty note when there are none. */
export function AsidesBody({ sessionId }: { sessionId: string }) {
  useLocale();
  const [items, setItems] = useState<AsideRow[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/side-questions?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<{ items: AsideRow[] } | { error: string }>(r))
      .then((b) => {
        if (!live) return;
        if ("error" in b) setError(b.error);
        else setItems(b.items ?? []);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [sessionId]);

  if (error !== null) return <span style={errText}>{error}</span>;
  if (items === null) return <span style={stateText}>{t("loading")}</span>;
  if (items.length === 0) {
    return (
      <div style={{ ...meta, paddingBottom: 4, fontSize: 12, whiteSpace: "normal" }}>
        {t("panel.asides.emptyBefore")} <code style={codeInline}>/btw</code>
        {t("panel.asides.emptyAfter")}
      </div>
    );
  }

  // The same copy the composer card offers: the answer, or the error, or the question while the
  // answer is still pending. A dismissed card lives only here, so this is where it gets copied from.
  const copy = (it: AsideRow) => {
    const text = it.answer ?? it.error ?? it.question;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(it.id);
      setTimeout(() => setCopied((cur) => (cur === it.id ? null : cur)), 1200);
    });
  };

  // An accordion of native <details>: the question is the row, the answer opens under it, and only
  // the newest starts open, so ten long answers cost ten lines until one is wanted. The header's
  // right end holds the state and the copy, floated so the native marker and the ellipsis on the
  // question both survive; the copy stops its click so the row does not toggle under it.
  return (
    <div style={bodyFlow}>
      {items.toReversed().map((it, i) => (
        <details
          key={it.id}
          open={i === 0}
          style={{
            padding: "6px 0",
            fontSize: 12,
            lineHeight: "1.5",
            borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              color: T.text,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <span
              style={{
                float: "right",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginLeft: 8,
              }}
            >
              {it.pending ? (
                <span style={asidePill(T.faint)}>{t("panel.asides.waiting")}</span>
              ) : it.error !== undefined ? (
                <span style={asidePill(T.err)}>{t("panel.asides.error")}</span>
              ) : null}
              {it.dismissed === true ? (
                <span style={asidePill(T.faint)}>{t("panel.asides.dismissed")}</span>
              ) : null}
              <span style={{ ...meta, fontSize: 11 }}>{ago(it.at)}</span>
              <button
                type="button"
                data-omc-aside-copy={it.id}
                style={{ ...btn, fontSize: 11, padding: "1px 8px", lineHeight: "16px" }}
                aria-label={copied === it.id ? t("copied") : t("panel.asides.copyLabel")}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  copy(it);
                }}
              >
                {copied === it.id ? t("copied") : t("copy")}
              </button>
            </span>
            {it.question || t("main.selection.explain")}
          </summary>
          <div
            style={{
              ...nested,
              margin: "4px 0 0 3px",
              maxHeight: "40vh",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: it.error !== undefined ? T.err : T.faint,
            }}
          >
            {it.quote ? (
              <blockquote
                data-omc-asides-quote={it.id}
                style={{
                  margin: "0 0 4px",
                  paddingLeft: 8,
                  borderLeft: `2px solid ${T.border}`,
                  color: T.muted,
                }}
              >
                {it.quote}
              </blockquote>
            ) : null}
            {it.pending ? t("panel.asides.waitingAnswer") : (it.answer ?? it.error ?? "")}
          </div>
        </details>
      ))}
    </div>
  );
}
