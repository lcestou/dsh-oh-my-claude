// The rewind tab: the user prompts from the route, their summary line, and the body that offers to reopen
// the session at one of them. Its retention note and switch hook come from the restore tab.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  errorText,
} from "../shared.js";
import type { ClientCtx } from "../shared.js";
import { t, useLocale } from "../i18n.js";
import { retentionNote, useFeatureSwitches } from "./restore.js";
import { RewoundEvent } from "../edit-last.js";
import { PLUGIN_NOTICE } from "../recall.js";
import { OPEN_HISTORY_EVENT } from "../history-search.js";
import { touchScreen } from "../selection-actions.js";
import { useHintFlag } from "../hints.js";

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
  filesChanged?: Array<string>;
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
  const [prompts, setPrompts] = useState<Array<RewindPrompt>>([]);
  const [picked, setPicked] = useState<RewindPrompt | null>(null);
  const [preview, setPreview] = useState<RewindReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const switches = useFeatureSwitches(cwd);
  const [historyOff] = useHintFlag("historySearchOff");

  // Another session or workspace starts the walk clean, during the render that switches.
  const walkOf = cwd ? `${sessionId}\n${cwd}` : null;
  const [walkSeen, setWalkSeen] = useState<string | null>(null);

  if (walkSeen !== walkOf) {
    setWalkSeen(walkOf);

    if (walkOf !== null) {
      setPicked(null);
      setPreview(null);
      setError("");
    }
  }

  useEffect(() => {
    let live = true;

    // `full=1`: whole texts, so the prompt a rewind drops can go back into the composer as typed;
    // the row shows one line of it either way.
    if (cwd) {
      fetch(
        `${ROUTE}/rewind?session=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}&full=1${boxParam(ctx, sessionId)}`,
      )
        .then((r) => readJson<{ prompts?: Array<RewindPrompt> }>(r))
        .then((b) => live && setPrompts(b.prompts ?? []))
        .catch((cause: unknown) => live && setError(errorText(cause)));
    }

    return () => {
      live = false;
    };
  }, [cwd, sessionId, ctx]);

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
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_));
    } finally {
      setBusy(false);
    }
  };

  /** Picks a row and asks for its dry run. Never rejects: run reports its own failure. */
  const pick = (p: RewindPrompt) => {
    setPicked(p);
    setPreview(null);
    void run(p.id, true);
  };

  // The newest pick and spend, for the effect below, which runs on the flag and the list alone: a
  // re-render for the preview must not pick (and post) again.
  const pickRef = useRef(pick);
  const onPickedRef = useRef(onPicked);

  // After every commit, before any effect reads them: the latest-handler pattern useEffectEvent
  // gives a newer React.
  useLayoutEffect(() => {
    pickRef.current = pick;
    onPickedRef.current = onPicked;
  });

  // Esc Esc: the newest prompt the person typed (not a notice this plugin sent, such as the
  // reattach line after a dsh restart) is picked once the list is in; spent at once so a Back
  // press is not undone by the next render.
  useEffect(() => {
    const latest = prompts.find((p) => !p.text.trimStart().startsWith(PLUGIN_NOTICE));

    if (pickLatest && latest !== undefined) {
      onPickedRef.current?.();
      pickRef.current(latest);
    }
  }, [pickLatest, prompts]);

  if (!isClaude || !cwd) {
    return null;
  }

  // History search opens on Ctrl+R, which a phone does not have, so a touch screen gets a button
  // here, the tab that already lists past prompts. A mouse never sees it.
  const historyButton = picked === null && !historyOff && touchScreen();
  // The file half of a rewind needs checkpoints; without them the button still moves the
  // conversation, so say which half is missing before it is pressed rather than after.
  const noFiles = switches?.checkpointingDisabled === true;

  return (
    <div style={bodyFlow}>
      {historyButton && (
        <button
          type="button"
          data-omc-rewind-history=""
          style={btn}
          onClick={() => {
            window.dispatchEvent(new CustomEvent(OPEN_HISTORY_EVENT, { detail: sessionId }));
            onClose();
          }}
        >
          {t("main.history.title")}
        </button>
      )}
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
              onClick={() => void run(picked.id, false)}
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
