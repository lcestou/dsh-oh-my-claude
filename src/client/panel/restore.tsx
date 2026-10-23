// The restore tab: the transcript picker for a blank session, the transcripts and feature-switch hooks the
// rewind and diagnostics tabs read, the retention note, and the repairs notice.
import { useEffect, useState } from "react";
import {
  btn,
  rowBtn,
  errText,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  ago,
  isOwnedActive,
  matchesQuery,
  type ClientCtx,
  type SessionData,
  openHere,
} from "../shared.js";
import { t, useLocale } from "../i18n.js";
import { SearchField } from "../search-field.js";
import type { FeatureSwitches } from "../../switches.js";
import { readHints, markHintValue, sessionLabel, workspaceName } from "./shared.js";

/** One-row transcript pick inside the compact restore list. */
function TranscriptRow({
  s,
  cwd,
  ctx,
  onClose,
}: {
  s: SessionData;
  cwd: string;
  ctx: ClientCtx;
  onClose: () => void;
}) {
  useLocale();
  const label = sessionLabel(s);
  return (
    <button
      type="button"
      style={{
        ...rowBtn,
        overflow: "hidden",
      }}
      onClick={async () => {
        await openHere(ctx, s, cwd);
        onClose();
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
        {label}
      </span>
      <span style={{ ...meta, flex: "none", marginLeft: 8 }}>{ago(s.modifiedAt)}</span>
    </button>
  );
}

/**
 * The settings and environment that switch off something this panel offers, as
 * `GET /feature-switches` reports them. Null until the first answer; a failed read stays null,
 * since a warning nobody could read is not worth an error line over a feature that still works.
 */
export function useFeatureSwitches(cwd: string | undefined): FeatureSwitches | null {
  const [switches, setSwitches] = useState<FeatureSwitches | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let live = true;
    fetch(`${ROUTE}/feature-switches?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => readJson<FeatureSwitches>(r))
      .then((b) => live && setSwitches(b))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd]);
  return switches;
}

/** How a transcript list says what will empty it. Same sentence wherever transcripts are listed. */
export const retentionNote = (s: FeatureSwitches | null): string =>
  s === null
    ? ""
    : s.retention.scope === null
      ? t("panel.retention.default", { days: s.retention.days })
      : t("panel.retention.scoped", { days: s.retention.days, scope: s.retention.scope });

/**
 * The workspace's Claude Code transcripts, as `GET /sessions?cwd=` lists them; empty until the
 * answer lands, and dropped when the composer unmounts on a session switch. Shared by the Restore
 * tab and the composer button, which reads it to know whether a blank session has anything to
 * restore before the panel is ever opened.
 */
export function useTranscripts(cwd: string | undefined): SessionData[] {
  const [transcripts, setTranscripts] = useState<SessionData[]>([]);
  useEffect(() => {
    // The list is the workspace's: a switch to another workspace (or to a session with no cwd yet)
    // clears it before the new answer lands, so the Restore tab never shows the last workspace's
    // transcripts under the new one's name (owner, 2026-10-21, on a new session in IC-Saves).
    setTranscripts([]);
    if (!cwd) return;
    let live = true;
    fetch(`${ROUTE}/sessions?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => readJson<{ sessions?: SessionData[] }>(r))
      .then((body) => live && setTranscripts(body.sessions ?? []))
      .catch(() => live && setTranscripts([]));
    return () => {
      live = false;
    };
  }, [cwd]);
  return transcripts;
}

/** The line under the plugin's version that says what the heal did to this box's session logs
 *  since the last dismissal: healed logs, and the ones still refused for a reason the plugin
 *  cannot mend. Dismissal is a box-wide hint holding the newest entry's time, so a later heal
 *  shows again and an older one stays dismissed on every browser. Nothing while there is nothing
 *  to say. */
export function SessionRepairsNotice({
  repairs,
  ctx,
  cwd,
}: {
  repairs:
    | {
        healed: number;
        unknown: number;
        rolledBack: number;
        at: number;
        refused?: Array<{ id: string }>;
      }
    | undefined;
  ctx: ClientCtx;
  cwd: string;
}) {
  useLocale();
  const [seen, setSeen] = useState<number | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  /** The person's click: the route moves the refused log to .bak and seeds the session again
   *  from its transcript; on success the tab opens it the way the Restore tab does, and the
   *  route's sentence shows under the row otherwise. */
  const reseed = async (id: string) => {
    setBusyId(id);
    setRowError(null);
    try {
      const seeded = await readJson<{ transcriptId?: string }>(
        await fetch(`${ROUTE}/reseed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        }),
      );
      // The open helper posts the transcript's id to `/open` and adopts the session under its
      // dsh id, as the Restore tab's rows do; the route names the transcript for that.
      await openHere(ctx, { id: seeded.transcriptId ?? id, dsh: { id } }, cwd);
    } catch (e) {
      setRowError({ id, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  };
  useEffect(() => {
    let live = true;
    void readHints().then((h) => {
      if (!live) return;
      const v = h?.sessionRepairsSeen;
      // A flag or nothing reads as never dismissed; only a number names a dismissal.
      setSeen(v === undefined || v === true || v === false ? 0 : v);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!repairs || seen === undefined) return null;
  const refused = repairs.unknown + repairs.rolledBack;
  if (repairs.healed + refused === 0 || repairs.at <= seen) return null;
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
    <div data-omc-session-repairs="" role="status" style={{ padding: "4px 0" }}>
      {repairs.healed > 0 && (
        <div data-omc-session-repairs-healed="">
          {t("panel.repairs.healed", { n: String(repairs.healed) })}
        </div>
      )}
      {refused > 0 && (
        <div data-omc-session-repairs-unknown="" style={{ color: T.warn }}>
          {t("panel.repairs.unknown", { n: String(refused) })}
        </div>
      )}
      {(repairs.refused ?? []).map((r) => (
        <div
          key={r.id}
          data-omc-session-repairs-row={r.id}
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <span
            style={{
              flex: 1,
              fontFamily: T.mono,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {r.id}
          </span>
          <button
            type="button"
            data-omc-session-repairs-reseed={r.id}
            aria-label={t("panel.repairs.reseedLabel")}
            title={t("panel.repairs.reseedLabel")}
            style={btn}
            disabled={busyId === r.id}
            onClick={() => void reseed(r.id)}
          >
            {t("panel.repairs.reseed")}
          </button>
          {rowError?.id === r.id && (
            <span data-omc-session-repairs-error="" style={{ ...errText, flexBasis: "100%" }}>
              {rowError.text}
            </span>
          )}
        </div>
      ))}
      <button
        type="button"
        data-omc-session-repairs-dismiss=""
        style={btn}
        onClick={() => {
          markHintValue("sessionRepairsSeen", repairs.at);
          setSeen(repairs.at);
        }}
      >
        {t("panel.repairs.dismiss")}
      </button>
    </div>
  );
}

/** "Restore Claude session" body inside the Oh My Claude dialog. Nothing when the session
 * already has content or the workspace has no directory to restore into. */
export function RestoreBody({
  sessionId,
  ctx,
  onClose,
}: {
  sessionId: string;
  ctx: ClientCtx;
  onClose: () => void;
}) {
  useLocale();
  const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId];
  const cwd = entry?.cwd;
  const transcripts = useTranscripts(cwd);
  const [query, setQuery] = useState("");
  // How many rows show: eight to start, twenty more per click. A workspace with 146 transcripts
  // showed eight and nothing said there were more (owner, 2026-09-22); the search is for finding
  // one, not for reaching the ninth. Reset with the query, so a narrowed list starts short again.
  const [shown, setShown] = useState(8);
  const switches = useFeatureSwitches(cwd);

  // Hide when the session already has content or the workspace is unknown.
  if (!cwd || entry?.blank === false) return null;
  const owned = transcripts.filter(isOwnedActive);
  const candidates = transcripts.filter((s) => !isOwnedActive(s));
  const name = workspaceName(cwd);
  const matches = candidates.filter((s) => matchesQuery(s, query));
  const rest = matches.slice(0, shown);
  const more = matches.length - rest.length;

  return (
    <div style={bodyFlow}>
      {/* Eight rows show; the search is how the rest are reached, so it appears once there are more. */}
      {candidates.length > 8 && (
        <SearchField
          hook="data-omc-restore-search"
          style={{ marginBottom: 4 }}
          value={query}
          placeholder={t("panel.restore.searchPlaceholder", { count: candidates.length, name })}
          label={t("panel.restore.searchLabel")}
          onChange={(next) => {
            setQuery(next);
            setShown(8);
          }}
        />
      )}
      {candidates.length === 0 && (
        <span data-omc-restore-empty="" style={{ ...meta, padding: "2px 0", whiteSpace: "normal" }}>
          {t("panel.restore.empty", { name })}
        </span>
      )}
      {candidates.length > 0 && rest.length === 0 && (
        <span style={{ ...meta, padding: "2px 0" }}>{t("panel.restore.noMatch")}</span>
      )}
      {rest.map((s) => (
        <TranscriptRow key={s.id} s={s} cwd={cwd} ctx={ctx} onClose={onClose} />
      ))}
      {more > 0 && (
        <button
          type="button"
          data-omc-restore-more=""
          onClick={() => setShown((n) => n + 20)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 0",
            textAlign: "left",
            font: "inherit",
            fontSize: 12,
            color: T.muted,
          }}
        >
          {t("panel.restore.showMore", { n: Math.min(20, more), left: more })}
        </button>
      )}
      {owned.length > 0 && (
        <span style={{ fontSize: 11, color: T.faint, padding: "2px 0" }}>
          {t("panel.restore.alreadyOpen", { n: owned.length })}
        </span>
      )}
      <span style={{ ...meta, padding: "2px 0", whiteSpace: "normal" }}>
        {retentionNote(switches)}
      </span>
    </div>
  );
}
