// The rewind tab: the user prompts from the route, their summary line, and the body that offers to reopen
// the session at one of them. Its retention note and switch hook come from the restore tab.
import { useEffect, useState } from "react";
import {
  btn,
  btnPrimary,
  rowBtn,
  errText,
  bodyFlow,
  meta,
  readJson,
  ROUTE,
  ago,
  activeClaudeSession,
  boxParam,
  type ClientCtx,
} from "../shared.js";
import { t, useLocale } from "../i18n.js";
import { retentionNote, useFeatureSwitches } from "./restore.js";
import { RewoundEvent } from "../edit-last.js";

/** One user prompt from `GET /rewind`. */
interface RewindPrompt {
  id: string;
  time: number;
  text: string;
}
interface RewindReply {
  ok: boolean;
  dryRun: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

/** Formats the rewind preview: the reply's error string, or a tally of files changed plus
 *  insertions and deletions. */
const rewindSummary = (r: RewindReply) =>
  r.error
    ? r.error
    : t("panel.rewind.summary", {
        files: r.filesChanged?.length ?? 0,
        ins: r.insertions ?? 0,
        del: r.deletions ?? 0,
      });

/**
 * "Rewind" body rendered inside the Oh My Claude dialog: lists the session's user prompts,
 * dry-runs the file rewind for the picked one, and on confirm rewinds files and Claude's
 * conversation. dsh's own transcript stays as it is.
 */
export function RewindBody({
  sessionId,
  ctx,
  onClose,
  pickLatest,
  onPicked,
}: {
  sessionId: string;
  /** Esc Esc in the composer: pick the newest prompt as soon as the list is in, preview and all,
   *  the way the terminal's double Escape lands on the last message. `onPicked` spends it. */
  pickLatest?: boolean;
  onPicked?: () => void;
  ctx: ClientCtx;
  onClose: () => void;
}) {
  useLocale();
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const isClaude = activeClaudeSession(ctx) === sessionId;
  const [prompts, setPrompts] = useState<RewindPrompt[]>([]);
  const [picked, setPicked] = useState<RewindPrompt | null>(null);
  const [preview, setPreview] = useState<RewindReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const switches = useFeatureSwitches(cwd);

  useEffect(() => {
    if (!cwd) return;
    let live = true;
    setPicked(null);
    setPreview(null);
    setError("");
    // `full=1`: whole texts, so the prompt a rewind drops can go back into the composer as typed;
    // the row shows one line of it either way.
    fetch(
      `${ROUTE}/rewind?session=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}&full=1${boxParam(ctx, sessionId)}`,
    )
      .then((r) => readJson<{ prompts?: RewindPrompt[] }>(r))
      .then((b) => live && setPrompts(b.prompts ?? []))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [cwd, sessionId]);
  const run = async (uuid: string, dryRun: boolean) => {
    setBusy(true);
    setError("");
    try {
      const reply = await readJson<RewindReply>(
        await fetch(`${ROUTE}/rewind`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, uuid, dryRun }),
        }),
      );
      setPreview(reply);
      if (!dryRun && reply.ok) {
        // The walk's list now holds prompts the transcript no longer has; recall re-reads it,
        // and the composer (`edit-last.ts`) takes the dropped prompt back to edit and resend.
        window.dispatchEvent(new RewoundEvent(sessionId, picked?.text));
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = (p: RewindPrompt) => {
    setPicked(p);
    setPreview(null);
    run(p.id, true);
  };
  // Esc Esc: the newest prompt is picked for the person once the list is in; spent at once so a
  // Back press is not undone by the next render.
  useEffect(() => {
    const latest = prompts[0];
    if (!pickLatest || latest === undefined) return;
    onPicked?.();
    pick(latest);
    // Only the flag and the list: a re-render for the preview must not pick (and post) again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick is a per-render closure
  }, [pickLatest, prompts]);

  if (!isClaude || !cwd) return null;
  // The file half of a rewind needs checkpoints; without them the button still moves the
  // conversation, so say which half is missing before it is pressed rather than after.
  const noFiles = switches?.checkpointingDisabled === true;
  return (
    <div style={bodyFlow}>
      {noFiles && <span style={errText}>{t("panel.rewind.noCheckpoints")}</span>}
      {picked === null ? (
        prompts.length === 0 ? (
          <span style={{ ...meta, padding: "2px 0" }}>{t("panel.rewind.noPrompts")}</span>
        ) : (
          prompts.map((p) => (
            <button
              key={p.id}
              type="button"
              style={{
                ...rowBtn,
              }}
              onClick={() => pick(p)}
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
                {p.text}
              </span>
              <span style={{ ...meta, flex: "none", marginLeft: 8 }}>{ago(p.time)}</span>
            </button>
          ))
        )
      ) : (
        <>
          <span style={{ fontSize: 13, padding: "2px 0" }}>
            {t("panel.rewind.rewindTo", { text: picked.text })}
          </span>
          <span style={{ ...meta, padding: "2px 0" }}>
            {busy && !preview ? t("panel.rewind.checking") : preview ? rewindSummary(preview) : ""}
          </span>
          <span style={{ ...meta, padding: "2px 0", whiteSpace: "normal" }}>
            {t("panel.rewind.explain")}
          </span>
          <div style={{ display: "flex", gap: 8, padding: "2px 0" }}>
            <button type="button" style={btn} disabled={busy} onClick={() => setPicked(null)}>
              ‹ {t("panel.back")}
            </button>
            <button
              type="button"
              style={btnPrimary}
              disabled={busy || !preview?.ok}
              onClick={() => run(picked.id, false)}
            >
              {t("panel.rewind.action")}
            </button>
          </div>
        </>
      )}
      {picked === null && prompts.length > 0 && (
        <span style={{ ...meta, padding: "2px 0", whiteSpace: "normal" }}>
          {retentionNote(switches)} {t("panel.rewind.retentionTail")}
        </span>
      )}
      {error && <span style={errText}>{error}</span>}
    </div>
  );
}
