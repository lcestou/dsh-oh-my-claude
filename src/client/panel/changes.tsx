// The changes tab: the working-tree diff, its counts, and the per-file rows that queue a review prompt or
// a draft. The not-running marker comes from the MCP tab.
import { useEffect, useState } from "react";
import {
  btn,
  rowBtn,
  errText,
  stateText,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  activeClaudeSession,
  hasRunTurn,
  type ClientCtx,
} from "../shared.js";
import { t, useLocale } from "../i18n.js";
import { queueDraft } from "../draft.js";
import { diffQuestion, reviewPrompt } from "../../prompts.js";
import { NOT_RUNNING } from "./mcp.js";

interface DiffFile {
  path: string;
  added: number;
  removed: number;
  binary: boolean;
  untracked: boolean;
  hunks: Array<{ oldStart: number; newStart: number; lines: string[] }>;
}
type DiffReply =
  | { ok: true; filesCount: number; linesAdded: number; linesRemoved: number; files: DiffFile[] }
  | { ok: false; error: string };

/**
 * Added and removed line counts the way a diff stat reads: the plus in the success colour, the
 * minus in the error colour, either dimmed when it is zero so the eye lands on the side that moved.
 */
function DiffCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span data-omc-diff-counts="">
      <span style={{ color: added > 0 ? T.ok : T.faint }}>+{added}</span>{" "}
      <span style={{ color: removed > 0 ? T.err : T.faint }}>−{removed}</span>
    </span>
  );
}

/**
 * "Changes" body rendered inside the Oh My Claude dialog: the CLI's own working-tree
 * diff (`get_workspace_diff`), one row per file with its line counts, a row unfolds its hunks.
 * Ask sends the diff, whole or one file, as a side question, so the answer arrives beside the
 * transcript rather than in it, and closes the dialog on the way so the answer is not behind it.
 * Review writes a prompt into the composer and closes the dialog,
 * because that one is the turn itself and belongs where the person can edit it before it goes.
 */
export function ChangesBody({
  sessionId,
  ctx,
  onClose,
}: {
  sessionId: string;
  ctx: ClientCtx;
  onClose: () => void;
}) {
  useLocale();
  const isClaude = activeClaudeSession(ctx) === sessionId;
  const [reply, setReply] = useState<DiffReply | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  // Which Ask is in flight, by path ("" is the whole tree), so pressing one does not blank the other.
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const ask = async (path: string) => {
    setAsking(path);
    setNote("");
    try {
      const r = await fetch(`${ROUTE}/side-questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session: sessionId,
          question: diffQuestion(path),
          withDiff: true,
          path,
        }),
      });
      const body = await readJson<{ ok: boolean; error?: string }>(r);
      // On success the dialog gets out of the way: the answer docks above the composer, which this
      // panel covers. A failure keeps it open, because the message is the only place the error shows.
      if (body.ok) onClose();
      else setNote(body.error ?? t("panel.plugins.actionFailed"));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(null);
    }
  };

  useEffect(() => {
    let live = true;
    setReply(null);
    setShown(null);
    setNote("");
    // A session that has never run has no CLI to ask, and the route can only refuse. Answer it here
    // so the tab reads the same without the round trip.
    if (!hasRunTurn(ctx, sessionId)) {
      setReply(NOT_RUNNING);
      return;
    }
    fetch(`${ROUTE}/diff?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<DiffReply>(r))
      .then((b) => live && setReply(b))
      .catch((e: Error) => live && setReply({ ok: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [sessionId]);

  if (!isClaude) return null;
  const files = reply?.ok ? reply.files : [];
  const current = files.find((f) => f.path === shown);
  return (
    <div style={bodyFlow}>
      {/* Above the branches, not below them: Ask is pressed from the file list and from a file's own
          header, and a line appended after the list sits below the fold on any real diff. */}
      {note !== "" && <span style={{ ...meta, padding: "2px 0" }}>{note}</span>}
      {reply === null ? (
        <span style={stateText}>{t("loading")}</span>
      ) : !reply.ok ? (
        <span style={errText}>{reply.error}</span>
      ) : current ? (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
            <button
              type="button"
              style={btn}
              onClick={() => {
                setShown(null);
                setNote("");
              }}
            >
              ‹ {t("panel.back")}
            </button>
            <span style={{ fontSize: 13, fontFamily: "monospace" }}>{current.path}</span>
            <span style={{ ...meta, marginLeft: "auto" }}>
              <DiffCounts added={current.added} removed={current.removed} />
            </span>
            <button
              type="button"
              style={btn}
              data-omc-diff-ask=""
              title={t("panel.changes.askFileTitle")}
              disabled={asking !== null}
              onClick={() => void ask(current.path)}
            >
              {asking === current.path ? "…" : t("panel.changes.ask")}
            </button>
          </div>
          {current.hunks.length === 0 ? (
            <span style={{ ...meta, padding: "2px 0" }}>
              {current.binary
                ? t("panel.changes.binary")
                : current.untracked
                  ? t("panel.changes.untracked")
                  : t("panel.changes.noHunks")}
            </span>
          ) : (
            current.hunks.map((h, i) => (
              <pre
                key={i}
                style={{
                  margin: "2px 0",
                  padding: 6,
                  fontSize: 12,
                  lineHeight: "16px",
                  overflow: "auto",
                  background: T.field,
                  border: `1px solid ${T.border}`,
                  borderRadius: 4,
                }}
              >
                <span style={{ color: T.faint }}>
                  @@ -{h.oldStart} +{h.newStart} @@{"\n"}
                </span>
                {h.lines.map((l, j) => (
                  <span
                    key={j}
                    style={{
                      color: l.startsWith("+") ? T.ok : l.startsWith("-") ? T.err : T.text,
                    }}
                  >
                    {l}
                    {"\n"}
                  </span>
                ))}
              </pre>
            ))
          )}
        </>
      ) : (
        <>
          <span style={{ ...meta, padding: "2px 0" }}>
            {reply.filesCount === 0 ? (
              t("panel.changes.clean")
            ) : (
              <>
                {t("panel.changes.filesCount", { n: reply.filesCount })}{" "}
                <DiffCounts added={reply.linesAdded} removed={reply.linesRemoved} />
              </>
            )}
          </span>
          {reply.filesCount > 0 && (
            <div style={{ display: "flex", gap: 8, padding: "2px 0" }}>
              <button
                type="button"
                style={btn}
                data-omc-diff-ask-all=""
                title={t("panel.changes.askAllTitle")}
                disabled={asking !== null}
                onClick={() => void ask("")}
              >
                {asking === "" ? "…" : t("panel.changes.ask")}
              </button>
              <button
                type="button"
                style={btn}
                data-omc-diff-review=""
                title={t("panel.changes.reviewTitle")}
                onClick={() => {
                  queueDraft(sessionId, reviewPrompt(files.map((f) => f.path)));
                  onClose();
                }}
              >
                {t("panel.changes.review")}
              </button>
            </div>
          )}
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              style={{
                ...rowBtn,
                fontFamily: "monospace",
              }}
              onClick={() => {
                setShown(f.path);
                setNote("");
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.path}
              </span>
              <span style={{ ...meta, flex: "none", marginLeft: 8 }}>
                {f.untracked ? (
                  t("panel.changes.new")
                ) : f.binary ? (
                  t("panel.changes.binaryShort")
                ) : (
                  <DiffCounts added={f.added} removed={f.removed} />
                )}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
