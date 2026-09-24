import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { createPortal } from "react-dom";
import { subscribe } from "./events.js";
import type { PermissionModeState } from "./events.js";
import {
  btn,
  btnPrimary,
  rowBtn,
  errText,
  stateText,
  sectionHead,
  codeInline,
  nested,
  PANEL_INSET,
  PANEL_ATTR,
  panelSurface,
  tabStyle,
  ensurePanelStyle,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  ago,
  isOwnedActive,
  matchesQuery,
  activeClaudeSession,
  claudeProviderOf,
  hasRunTurn,
  useActiveClaude,
  boxQuery,
  boxParam,
  type ClientCtx,
  type SessionData,
  useNarrow,
  useDismiss,
  code,
  select,
  inputStyle,
  openHere,
  pill,
  PANEL_ACCENT,
  maskEmail,
  resumeCommand,
  saveBlob,
  groupSkillsByScope,
  skillStateFromReply,
  loadBreakdown,
  parseSkillCosts,
  sortSkillCosts,
  type SkillState,
  type UsageBreakdownReply,
} from "./shared.js";
import { checkContract, contractMisses, contractSummary } from "./contract.js";
import { UpdatePill } from "./update-pill.js";
import { ReportBlock } from "./report.js";
import { t, useLocale, type OmcKey } from "./i18n.js";
import { Menu, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  IconChevronDownOutlineRegular,
  IconSparkleMedium,
  PermissionIconFullAccessRegular,
  PermissionIconReadOnlyRegular,
  PermissionIconWorkspaceWriteRegular,
} from "./icons.js";
import { Spark } from "./spark.js";
import { ConfirmButton, TuneBody } from "./tune.js";
import { noticesOn, setNoticesOn } from "./notices.js";
import { queueDraft } from "./draft.js";
import { SearchField } from "./search-field.js";
import { diffQuestion, reviewPrompt } from "../prompts.js";
import type { FeatureSwitches } from "../switches.js";
import type { PluginRoster, PluginLoadError } from "../plugins.js";
import type { PermissionRules, HooksListing } from "../process.js";

// Module-level variable so reopening lands on the last picked tab.
let lastTab = "Memory";

/**
 * How long the panel fades and the Add form collapses. Short enough to stay out of the way of a
 * second click, and zero for a reader who asked the platform for no motion.
 */
const easeMs = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 140;

/** Space the panel keeps from the edge of whatever clips it, the gap dsh's own menus leave. */
const FIT_MARGIN = 8;

/**
 * The panel's max height: `cap`, or the room between its bottom and the top of the nearest
 * ancestor that clips it, whichever is less. dsh's `useAnchoredMaxHeight` measures to the top of
 * the window instead, and dsh's conversation scroller starts 40 px down, under its top strip. On a
 * blank session in a short window the composer sits mid-screen, so the panel reached the window's
 * top and its first 36 px, the Restore search among them, were cut off. Remeasured on open, on
 * resize and on any scroll.
 */
function useFitAbove(ref: { current: HTMLElement | null }, cap: number, open: boolean): number {
  const [maxHeight, setMaxHeight] = useState(cap);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const fit = () => {
      let top = 0;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const c = getComputedStyle(a);
        if (c.overflowX !== "visible" || c.overflowY !== "visible")
          top = Math.max(top, a.getBoundingClientRect().top);
      }
      // max-height sizes the content box, so the panel's own padding and border come off too.
      const own = getComputedStyle(el);
      const frame =
        parseFloat(own.paddingTop) +
        parseFloat(own.paddingBottom) +
        parseFloat(own.borderTopWidth) +
        parseFloat(own.borderBottomWidth);
      const room = el.getBoundingClientRect().bottom - top - FIT_MARGIN - frame;
      setMaxHeight(Math.min(cap, Math.max(0, room)));
    };
    // The scroll listener is on the capture phase of the window, so it fires for every scroll of
    // every scroller, including the conversation following a streaming turn; each fit reads
    // layout up the whole ancestor chain. One fit per frame is all a screen can show.
    let queued = 0;
    const fitSoon = () => {
      if (queued !== 0) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        fit();
      });
    };
    fit();
    window.addEventListener("resize", fitSoon);
    window.addEventListener("scroll", fitSoon, true);
    return () => {
      if (queued !== 0) cancelAnimationFrame(queued);
      window.removeEventListener("resize", fitSoon);
      window.removeEventListener("scroll", fitSoon, true);
    };
  }, [ref, cap, open]);
  return maxHeight;
}

/**
 * Ease the panel between heights instead of snapping. Its height is whatever the open tab's body
 * needs (capped by the viewport), so it changes on a tab switch and again when a body's data lands;
 * CSS cannot transition a height it never sets. A ResizeObserver reports each settled height and a
 * one-shot animation runs from the previous one to it, tabs at the bottom staying put while the
 * body above them grows or shrinks. Frames of a running animation are resizes too and are skipped.
 */
function useHeightEase(ref: { current: HTMLElement | null }, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let last = el.getBoundingClientRect().height;
    let anim: Animation | undefined;
    const ro = new ResizeObserver(() => {
      if (anim?.playState === "running") return;
      const next = el.getBoundingClientRect().height;
      if (Math.abs(next - last) < 1) return;
      const from = last;
      last = next;
      if (easeMs() === 0) return;
      anim = el.animate([{ height: `${from}px` }, { height: `${next}px` }], {
        duration: easeMs() * 1.5,
        easing: "ease",
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      anim?.cancel();
    };
  }, [ref, active]);
}

/** A session's display name. The server answers an empty string, not undefined, for a transcript
 *  it could not title, so this tests for emptiness rather than absence; the fallback is the first
 *  eight characters of the id, enough to tell sessions apart on one screen. */
export const sessionLabel = (s: { title?: string; id: string }): string =>
  s.title?.trim() ? s.title : t("panel.session.untitled", { id: s.id.slice(0, 8) });

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
function useFeatureSwitches(cwd: string | undefined): FeatureSwitches | null {
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
const retentionNote = (s: FeatureSwitches | null): string =>
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
function useTranscripts(cwd: string | undefined): SessionData[] {
  const [transcripts, setTranscripts] = useState<SessionData[]>([]);
  useEffect(() => {
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

/** The last path segment, which is the name a workspace shows in the sidebar. */
const workspaceName = (cwd: string): string => cwd.split("/").filter(Boolean).at(-1) ?? cwd;

/**
 * One-time hints, kept on the box under the plugin's state (`GET`/`POST /hints`) so a hint shown
 * once stays shown across browsers, plugin updates and dsh updates. Read once per page; a failed
 * read answers nothing, so no hint fires on a box that cannot remember it fired.
 */
let hintsCache: Promise<Record<string, boolean | number> | null> | undefined;
/** Returns the cached `GET /hints` answer, fetched once and kept; resolves null on a failed
 *  read, so a box that cannot remember is treated as no hints rather than an error. */
const readHints = (): Promise<Record<string, boolean | number> | null> =>
  (hintsCache ??= fetch(`${ROUTE}/hints`)
    .then((r) => readJson<Record<string, boolean | number>>(r))
    .catch(() => null));
/** Record a numbered hint (a dismissal that names what it dismissed) the way `markHint` records a
 *  flag: the box remembers it, and this tab's cache sees it without a refetch. */
const markHintValue = (key: string, value: number): void => {
  hintsCache = (hintsCache ?? Promise.resolve(null)).then((h) => ({ ...h, [key]: value }));
  void fetch(`${ROUTE}/hints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  }).catch(() => {});
};
/** Mark a hint seen: POST it to the box, and add it to this tab's cached hints so the next read here
 *  sees it without a refetch. It is added, not swapped in: replacing the cache with the one key
 *  used to drop every other hint the tab had read, so a second mark brought the first one back. A
 *  failed POST is ignored. */
const markHint = (key: string): void => {
  hintsCache = (hintsCache ?? Promise.resolve(null)).then((h) => ({ ...h, [key]: true }));
  void fetch(`${ROUTE}/hints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [key]: true }),
  }).catch(() => {});
};

/** The line under the plugin's version that says what the heal did to this box's session logs
 *  since the last dismissal: healed logs, and the ones still refused for a reason the plugin
 *  cannot mend. Dismissal is a box-wide hint holding the newest entry's time, so a later heal
 *  shows again and an older one stays dismissed on every browser. Nothing while there is nothing
 *  to say. */
function SessionRepairsNotice({
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
      await readJson(
        await fetch(`${ROUTE}/reseed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        }),
      );
      await openHere(ctx, { id, dsh: { id } }, cwd);
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
function RestoreBody({
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

/** One of Claude's auto-memory files for the current workspace, as `GET /memory` lists it. */
interface MemoryFile {
  name: string;
  size: number;
  mtime: number;
  summary: string;
}

/**
 * "Memory" body rendered inside the Oh My Claude dialog: lists the workspace's Claude auto-memory
 * files (`<project dir>/memory/*.md`, MEMORY.md first) and edits or deletes one in place.
 */
function MemoryBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Every call names the session's own mount, so a session on a box lists and edits that box's
  // memories rather than this PC's.
  const provider = claudeProviderOf(ctx, sessionId);
  const q = [
    cwd ? `cwd=${encodeURIComponent(cwd)}` : "",
    provider === undefined ? "" : `provider=${encodeURIComponent(provider)}`,
  ]
    .filter((p) => p !== "")
    .join("&");
  const refresh = (signal?: AbortSignal) => {
    if (!cwd) return;
    fetch(`${ROUTE}/memory?${q}`, { signal })
      .then((r) => readJson<{ files?: MemoryFile[] }>(r))
      .then((b) => setFiles(b.files ?? []))
      // An in-flight list outlives the tab being closed, and its reply landed on a component that
      // is gone: React drops the state write and the error branch painted an error nobody asked
      // for. The abort is the teardown, and its own rejection is not a failure to report.
      .catch((e: Error) => {
        if (signal?.aborted !== true) setError(e.message);
      });
  };
  // Re-list every half minute: Claude writes memories mid-turn.
  useEffect(() => {
    const stop = new AbortController();
    refresh(stop.signal);
    const timer = setInterval(() => refresh(stop.signal), 30_000);
    return () => {
      clearInterval(timer);
      stop.abort();
    };
  }, [q]);

  const openFile = async (n: string) => {
    setError("");
    try {
      const body = await readJson<{ text: string }>(
        await fetch(`${ROUTE}/memory?${q}&name=${encodeURIComponent(n)}`),
      );
      setFile(n);
      setText(body.text);
      setSaved(body.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch(`${ROUTE}/memory?${q}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, name: file, text }),
        }),
      );
      setSaved(text);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!file || !window.confirm(t("panel.memory.deleteConfirm", { file }))) return;
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch(`${ROUTE}/memory?${q}&name=${encodeURIComponent(file)}`, { method: "DELETE" }),
      );
      setFile(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!cwd) return <span style={stateText}>{t("panel.memory.noWorkspace")}</span>;
  if (files.length === 0) return <span style={stateText}>{t("panel.memory.empty")}</span>;
  const dirty = text !== saved;
  return (
    <div style={bodyFlow}>
      {file === null ? (
        files.map((f) => (
          <button
            key={f.name}
            type="button"
            style={{
              ...rowBtn,
            }}
            onClick={() => openFile(f.name)}
          >
            <span
              // Shrinks before the summary does (auto basis against the summary's zero), so a
              // long name on a phone ellipsizes and the age on the right stays in the row.
              style={{
                flex: "0 1 auto",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: T.mono,
                fontSize: 12,
              }}
            >
              {f.name}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                marginLeft: 10,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: T.muted,
              }}
            >
              {f.summary}
            </span>
            <span style={{ ...meta, flex: "none", marginLeft: 8 }}>{ago(f.mtime)}</span>
          </button>
        ))
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" style={btn} onClick={() => setFile(null)} disabled={busy}>
              ‹ {t("panel.back")}
            </button>
            <span style={{ flex: 1, fontFamily: T.mono, fontSize: 12 }}>{file}</span>
            <button type="button" style={btn} onClick={remove} disabled={busy}>
              {t("panel.delete")}
            </button>
            <button
              type="button"
              style={dirty ? btnPrimary : btn}
              onClick={save}
              disabled={busy || !dirty}
            >
              {t("save")}
            </button>
          </div>
          <textarea
            data-omc-memory-editor=""
            aria-label={t("panel.memory.editorLabel")}
            value={text}
            spellCheck={false}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
            }}
            style={{ ...code, minHeight: 300, resize: "vertical", whiteSpace: "pre-wrap" }}
          />
        </>
      )}
      {error && <span style={errText}>{error}</span>}
    </div>
  );
}

/** One instruction file from the CLAUDE.md hierarchy: `GET /instructions` lists them. */
interface InstructionFile {
  path: string;
  kind: "Managed" | "User" | "Project" | "Local";
  size: number;
  mtime: number;
  importedBy?: string;
}

/** A path as the row shows it: relative to the workspace, or under `~`, whichever applies. */
const shortPath = (path: string, cwd: string): string =>
  path.startsWith(`${cwd}/`)
    ? `./${path.slice(cwd.length + 1)}`
    : path.replace(/^\/home\/[^/]+\//, "~/");

/** The one plugin scope not `user`-global reads and writes into a directory. Labels come from
 *  `panel.scope.<value>` at render so a language switch reaches them. */
const PLUGIN_SCOPE_OPTS = ["user", "project", "local"] as const;

/** The Add-marketplace form under the roster: a source and the scope to declare it in. */
function MarketplaceAddForm({ act, busy }: { act: Act; busy: string }) {
  useLocale();
  const [source, setSource] = useState("");
  const [scope, setScope] = useState("user");
  const submit = async () => {
    if (await act("/plugins/marketplace/add", { source, scope }, "mkt-add")) setSource("");
  };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <input
        type="text"
        placeholder={t("panel.plugins.mktSourcePlaceholder")}
        aria-label={t("panel.plugins.mktSourceLabel")}
        data-omc-plugin-marketplace-source=""
        value={source}
        onChange={(e) => setSource(e.currentTarget.value)}
        disabled={busy !== ""}
        style={inputStyle}
      />
      <select
        data-omc-plugin-marketplace-scope=""
        aria-label={t("panel.plugins.mktScopeLabel")}
        value={scope}
        onChange={(e) => setScope(e.currentTarget.value)}
        disabled={busy !== ""}
        style={select}
      >
        {PLUGIN_SCOPE_OPTS.map((o) => (
          <option key={o} value={o}>
            {t(`panel.scope.${o}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        style={btn}
        disabled={busy !== "" || source.trim() === ""}
        onClick={submit}
      >
        {busy === "mkt-add" ? "…" : t("panel.add")}
      </button>
    </div>
  );
}

/** The fields a plugin/marketplace mutation route reads, on top of the session the poster adds. */
interface PluginMutationBody {
  scope: string;
  key?: string;
  enable?: boolean;
  source?: string;
  name?: string;
}

/** Post one mutation; returns whether it succeeded so a form can clear itself. */
type Act = (path: string, body: PluginMutationBody, id: string) => Promise<boolean>;

/**
 * The plugins and marketplaces the session's settings turn on, under the CLAUDE.md files: the same
 * question, a different set of files. Each row acts on its own scope through `claude plugin`, then
 * the running process is asked to re-read plugins (`reload_plugins`) so the change applies now; with
 * no process up it lands at the next spawn instead, which the note reflects from the reply.
 */
function PluginManagerBlock({
  roster,
  pluginErrors,
  pluginWarnings,
  sessionId,
  ctx,
  onChanged,
}: {
  roster: PluginRoster | null;
  pluginErrors: PluginLoadError[];
  pluginWarnings: PluginLoadError[];
  sessionId: string;
  ctx: ClientCtx;
  onChanged: () => void;
}) {
  useLocale();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [applied, setApplied] = useState("");
  const act: Act = async (path, body, id) => {
    setBusy(id);
    setError("");
    try {
      const r = await readJson<{ ok: boolean; error?: string; live?: boolean }>(
        await fetch(`${ROUTE}${path}${boxQuery(ctx, sessionId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, ...body }),
        }),
      );
      if (!r.ok) {
        setError(r.error ?? t("panel.plugins.actionFailed"));
        return false;
      }
      setApplied(r.live === true ? t("panel.plugins.appliedLive") : t("panel.plugins.appliedNext"));
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy("");
    }
  };
  if (roster === null) return null;
  const { plugins, marketplaces } = roster;
  const line: CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontFamily: T.mono,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const small: CSSProperties = { ...btn, flex: "none", padding: "0 6px", fontSize: 11 };
  return (
    <>
      <span style={sectionHead}>{t("panel.plugins.head")}</span>
      <div style={{ padding: "2px 0", fontSize: 12, lineHeight: "1.7" }}>
        {pluginErrors.length > 0 && (
          <div data-omc-plugin-errors="" role="alert" style={{ marginBottom: 6 }}>
            <span style={{ ...meta, color: T.err, padding: "2px 0", display: "block" }}>
              {t("panel.plugins.loadFailed")}
            </span>
            {pluginErrors.map((e, i) => (
              <div key={`${e.plugin}:${i}`} style={{ ...line, whiteSpace: "normal", color: T.err }}>
                {e.plugin && !e.plugin.startsWith("inline") ? `${e.plugin}: ` : ""}
                {e.message}
              </div>
            ))}
          </div>
        )}
        {pluginWarnings.length > 0 && (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
          <div data-omc-plugin-warnings="" role="status" style={{ marginBottom: 6 }}>
            <span style={{ ...meta, color: T.warn, padding: "2px 0", display: "block" }}>
              {t("panel.plugins.warnings")}
            </span>
            {pluginWarnings.map((w, i) => (
              <div
                key={`${w.plugin}:${i}`}
                style={{ ...line, whiteSpace: "normal", color: T.warn }}
              >
                {w.plugin && !w.plugin.startsWith("inline") ? `${w.plugin}: ` : ""}
                {w.message}
              </div>
            ))}
          </div>
        )}
        {plugins.length === 0 && marketplaces.length === 0 && (
          <span style={{ ...meta, fontSize: 12 }}>{t("panel.plugins.empty")}</span>
        )}
        {plugins.map((p) => (
          <div key={p.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              style={{ ...small, width: 34, color: p.enabled ? undefined : T.faint }}
              disabled={busy !== ""}
              onClick={() =>
                act("/plugins/toggle", { key: p.key, scope: p.scope, enable: !p.enabled }, p.key)
              }
              title={p.enabled ? t("panel.plugins.disable") : t("panel.plugins.enable")}
            >
              {busy === p.key ? "…" : p.enabled ? t("panel.plugins.on") : t("panel.plugins.off")}
            </button>
            <span style={line}>
              {p.key}
              {p.detail !== undefined && ` (${p.detail})`}
            </span>
            <span style={{ ...meta, flex: "none" }}>{p.scope}</span>
            <ConfirmButton
              label={t("common.remove")}
              style={small}
              disabled={busy !== ""}
              busyLabel={busy === p.key ? "…" : undefined}
              onAct={() => void act("/plugins/uninstall", { key: p.key, scope: p.scope }, p.key)}
            />
          </div>
        ))}
        {marketplaces.map((m) => (
          <div key={m.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ ...meta, flex: "none" }}>{t("panel.plugins.marketTag")}</span>
            <span style={line}>
              {m.name} · {m.source}
              {m.alias === true && t("panel.plugins.aliasNote")}
            </span>
            <span style={{ ...meta, flex: "none" }}>{m.scope}</span>
            <ConfirmButton
              label={t("common.remove")}
              style={small}
              disabled={busy !== ""}
              busyLabel={busy === m.name ? "…" : undefined}
              onAct={() =>
                void act("/plugins/marketplace/remove", { name: m.name, scope: m.scope }, m.name)
              }
            />
          </div>
        ))}
        <MarketplaceAddForm act={act} busy={busy} />
        {error !== "" && <span style={{ ...meta, display: "block", marginTop: 4 }}>{error}</span>}
        <span style={{ ...meta, display: "block", marginTop: 4 }}>
          {applied || t("panel.plugins.applyNote")}
        </span>
      </div>
    </>
  );
}

/** A skill as `GET /skills` lists it: where it comes from, and what its SKILL.md says it does. */
interface SkillRow {
  name: string;
  scope: string;
  path: string;
  description: string;
}

/** True for a skill scope this tab can edit (user or project), so plugin skills draw read-only. */
const writable = (scope: string) => scope === "user" || scope === "project";

/** The /skill-doctor cost columns, one source of truth for the table header and body. `numeric` is
 *  true for the four the CLI prints as magnitudes, so they line up right under each other. Column
 *  headers come from `panel.skills.col.<col>` at render so a language switch reaches them. */
const costCols: {
  col: "skill" | "source" | "context" | "tokens" | "uses" | "lastUsed";
  numeric: boolean;
}[] = [
  { col: "skill", numeric: false },
  { col: "source", numeric: false },
  { col: "context", numeric: true },
  { col: "tokens", numeric: true },
  { col: "uses", numeric: true },
  { col: "lastUsed", numeric: true },
];

/** The body of an open fold: in behind the Settings rule, the line set under the marker. */
const FOLD_BODY: CSSProperties = { ...nested, marginLeft: 3 };
/** A fold's own title: the section label, kept a list item so the browser still draws its marker. */
const FOLD_HEAD: CSSProperties = { ...sectionHead, display: "list-item", cursor: "pointer" };

/** The CLI's "Top …" group headings from `claude -p "/usage"`, as the parser capitalises them. */
const DRIVER_GROUP_KEYS = new Map<string, OmcKey>([
  ["Subagents", "panel.skills.groupSubagents"],
  ["Plugins", "panel.skills.groupPlugins"],
  ["MCP servers", "panel.skills.groupMcpServers"],
]);

/** The CLI's usage sentences, one pattern per template it prints (2.1.x). The first group is the
 *  percentage and the second, when there is one, a skill, agent, plugin or server name, which stays
 *  as written. A sentence no pattern matches is a template newer than this list and shows as sent. */
const BEHAVIOUR_KEYS: Array<[RegExp, OmcKey]> = [
  [/^(\d+)% of your usage hit a >100k-token cache miss$/, "panel.skills.behCacheMiss"],
  [/^(\d+)% of your usage was at >150k context$/, "panel.skills.behLongContext"],
  [/^(\d+)% of your usage came from subagent-heavy sessions$/, "panel.skills.behSubagentHeavy"],
  [/^(\d+)% of your usage was while 4\+ sessions ran in parallel$/, "panel.skills.behParallel"],
  [/^(\d+)% of your usage came from sessions active for 8\+ hours$/, "panel.skills.behLongRunning"],
  [/^(\d+)% of your usage came from subagents under "(.+)"$/, "panel.skills.behFromAgent"],
  [/^(\d+)% of your usage came from the plugin "(.+)"$/, "panel.skills.behFromPlugin"],
  [/^(\d+)% of your usage came from the MCP server "(.+)"$/, "panel.skills.behFromMcp"],
  [/^(\d+)% of your usage came from \/(.+)$/, "panel.skills.behFromSkill"],
];

/** One CLI usage sentence in the reader's language, or as the CLI wrote it when it is new. */
const behaviourText = (line: string): string => {
  for (const [re, key] of BEHAVIOUR_KEYS) {
    const m = re.exec(line);
    if (m) return t(key, { pct: m[1] ?? "", name: m[2] ?? "" });
  }
  return line;
};

/**
 * The Skills tab: every skill the CLI can reach for this directory, grouped by where it comes from,
 * each scope a collapsible section. User and project skills are created, edited and removed here; a
 * plugin's skills are read-only, edited where the plugin ships them. A write asks the live process to
 * re-read skills (`reload_skills`), so a new skill's /command registers without a respawn. The box the
 * session runs on is named in the query, so a remote session lists and edits that box's skills.
 */

function SkillsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [cost, setCost] = useState<SkillState>({ kind: "idle" });
  const [drivers, setDrivers] = useState<UsageBreakdownReply | null>(null);
  const [driversBusy, setDriversBusy] = useState(false);
  const [costSort, setCostSort] = useState<{
    col: "skill" | "source" | "context" | "tokens" | "uses" | "lastUsed";
    dir: "asc" | "desc";
  }>({ col: "tokens", dir: "desc" });
  const costAc = useRef<AbortController | null>(null);
  const [editing, setEditing] = useState<{ path: string; name: string } | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [mtime, setMtime] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [applied, setApplied] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScope, setNewScope] = useState("user");
  const [newDesc, setNewDesc] = useState("");
  const provider = claudeProviderOf(ctx, sessionId);
  const onBox = provider === undefined ? "" : `provider=${encodeURIComponent(provider)}`;
  const q = [
    cwd ? `cwd=${encodeURIComponent(cwd)}` : "",
    `session=${encodeURIComponent(sessionId)}`,
    onBox,
  ]
    .filter((p) => p !== "")
    .join("&");
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const refresh = useCallback(() => {
    if (!cwd) return;
    fetch(`${ROUTE}/skills?${q}`)
      .then((r) => readJson<{ skills?: SkillRow[] }>(r))
      .then((b) => mounted.current && setSkills(b.skills ?? []))
      .catch(() => mounted.current && setSkills([]));
  }, [cwd, q]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => () => costAc.current?.abort(), []);
  const loadCost = useCallback(() => {
    setCost({ kind: "loading" });
    costAc.current?.abort();
    const ac = new AbortController();
    costAc.current = ac;
    const timer = setTimeout(() => ac.abort(), 25000);
    void (async () => {
      const reply = await readJson<{
        ok?: boolean;
        report?: string;
        declined?: boolean;
        error?: string;
        partial?: boolean;
      }>(
        await fetch(`${ROUTE}/skill-doctor?session=${encodeURIComponent(sessionId)}`, {
          signal: ac.signal,
        }),
      );
      if (mounted.current) setCost(skillStateFromReply(reply));
    })()
      .catch((e: Error) => mounted.current && setCost({ kind: "error", text: e.message }))
      .finally(() => clearTimeout(timer));
  }, [sessionId]);
  const loadDrivers = (force = false) => {
    setDriversBusy(true);
    void loadBreakdown(undefined, force)
      .then(setDrivers)
      .catch((e: Error) => setDrivers({ ok: false, error: e.message }))
      .finally(() => setDriversBusy(false));
  };

  const box = boxQuery(ctx, sessionId);
  const note = (live: boolean) =>
    setApplied(live ? t("panel.plugins.appliedLive") : t("panel.plugins.appliedNext"));
  const openEdit = async (path: string, name: string) => {
    setErr("");
    try {
      const body = await readJson<{ text: string; mtime?: number }>(
        await fetch(`${ROUTE}/skills/file?${q}&path=${encodeURIComponent(path)}`),
      );
      setEditing({ path, name });
      setText(body.text);
      setSaved(body.text);
      setMtime(body.mtime);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    if (!editing) return;
    setBusy("save");
    setErr("");
    setApplied("");
    try {
      const r = await readJson<{ mtime?: number; live?: boolean }>(
        await fetch(`${ROUTE}/skills/file${box}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, cwd, path: editing.path, text, mtime }),
        }),
      );
      setSaved(text);
      setMtime(r.mtime);
      note(r.live === true);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const create = async () => {
    setBusy("create");
    setErr("");
    setApplied("");
    try {
      const r = await readJson<{ path: string; live?: boolean }>(
        await fetch(`${ROUTE}/skills/create${box}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session: sessionId,
            cwd,
            name: newName,
            scope: newScope,
            description: newDesc,
          }),
        }),
      );
      note(r.live === true);
      const name = newName;
      setNewName("");
      setNewDesc("");
      refresh();
      // Open the editor before dropping the form, so the list never flashes between the two.
      await openEdit(r.path, name);
      setCreating(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const remove = async (s: SkillRow) => {
    setBusy(s.path);
    setErr("");
    setApplied("");
    try {
      const r = await readJson<{ live?: boolean }>(
        await fetch(`${ROUTE}/skills/remove${box}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, cwd, path: s.path }),
        }),
      );
      note(r.live === true);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const reload = async () => {
    setBusy("reload");
    setErr("");
    setApplied("");
    try {
      const r = await readJson<{ live?: boolean }>(
        await fetch(`${ROUTE}/skills/reload${box}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId }),
        }),
      );
      note(r.live === true);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  if (skills === null) return null;

  const nameOk = /^[a-z0-9][a-z0-9-]{0,63}$/.test(newName);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (s: SkillRow) =>
    words.every((w) => `${s.name} ${s.scope} ${s.description}`.toLowerCase().includes(w));
  const groups = groupSkillsByScope(skills);
  const sections: { key: "user" | "project" | "plugin"; label: string; rows: SkillRow[] }[] = [
    { key: "user", label: t("panel.skills.userSkills"), rows: groups.user },
    { key: "project", label: t("panel.skills.projectSkills"), rows: groups.project },
    { key: "plugin", label: t("panel.skills.pluginSkills"), rows: groups.plugin },
  ];
  const anyMatch = skills.some(match);
  const small: CSSProperties = { ...btn, flex: "none", padding: "0 6px", fontSize: 11 };
  const rowNode = (s: SkillRow) => (
    <div
      key={s.path}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}
      title={s.path}
    >
      <span style={{ flex: "none", fontFamily: T.mono, fontSize: 12 }}>{s.name}</span>
      <span style={pill(T.faint)}>{s.scope}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: T.muted,
          fontSize: 12,
        }}
      >
        {s.description}
      </span>
      {writable(s.scope) && (
        <button
          type="button"
          data-omc-skill-edit=""
          aria-label={t("panel.skills.editLabel", { name: s.name })}
          style={small}
          disabled={busy !== ""}
          onClick={() => openEdit(s.path, s.name)}
        >
          {t("panel.edit")}
        </button>
      )}
      {writable(s.scope) && (
        <ConfirmButton
          label={t("common.remove")}
          ariaLabel={t("panel.skills.removeLabel", { name: s.name })}
          style={small}
          disabled={busy !== ""}
          busyLabel={busy === s.path ? "…" : undefined}
          onAct={() => void remove(s)}
        />
      )}
    </div>
  );

  if (editing !== null) {
    const dirty = text !== saved;
    return (
      <div style={bodyFlow} data-omc-skills="">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" style={btn} onClick={() => setEditing(null)} disabled={busy !== ""}>
            ‹ {t("panel.back")}
          </button>
          <span style={{ flex: 1, minWidth: 0, fontFamily: T.mono, fontSize: 12 }}>
            {editing.name}
          </span>
          <button
            type="button"
            style={dirty ? btnPrimary : btn}
            onClick={save}
            disabled={busy !== "" || !dirty}
          >
            {t("save")}
          </button>
        </div>
        <textarea
          data-omc-skill-editor=""
          aria-label={t("panel.skills.editorLabel")}
          value={text}
          spellCheck={false}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
          }}
          style={{ ...code, minHeight: 300, resize: "vertical", whiteSpace: "pre-wrap" }}
        />
        {applied && (
          <span data-omc-skill-applied="" style={{ ...meta, padding: "2px 0" }}>
            {applied}
          </span>
        )}
        {err && (
          <span data-omc-skill-error="" style={errText}>
            {err}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={bodyFlow} data-omc-skills="">
      <div style={{ display: "flex", gap: 6, paddingBottom: 2 }}>
        {!creating && (
          <button
            type="button"
            data-omc-skill-new=""
            style={btn}
            disabled={busy !== ""}
            onClick={() => {
              setCreating(true);
              setErr("");
            }}
          >
            {t("panel.skills.newSkill")}
          </button>
        )}
        <button
          type="button"
          data-omc-skill-reload=""
          style={btn}
          disabled={busy !== ""}
          onClick={reload}
        >
          {busy === "reload" ? "…" : t("panel.skills.reload")}
        </button>
      </div>
      {creating && (
        <div
          data-omc-skill-form=""
          style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 0" }}
        >
          <input
            type="text"
            data-omc-skill-name=""
            aria-label={t("panel.skills.nameLabel")}
            placeholder={t("panel.skills.namePlaceholder")}
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            disabled={busy !== ""}
            style={{ ...inputStyle, flex: "none" }}
          />
          {newName !== "" && !nameOk && (
            <span data-omc-skill-name-error="" style={{ ...meta, color: T.err }}>
              {t("panel.skills.nameError")}
            </span>
          )}
          <select
            data-omc-skill-scope=""
            aria-label={t("panel.skills.scopeLabel")}
            value={newScope}
            onChange={(e) => setNewScope(e.currentTarget.value)}
            disabled={busy !== ""}
            style={{ ...select, flex: "none", maxWidth: "none" }}
          >
            <option value="user">{t("panel.scope.user")}</option>
            <option value="project">{t("panel.scope.project")}</option>
          </select>
          <input
            type="text"
            data-omc-skill-desc=""
            aria-label={t("panel.skills.descLabel")}
            placeholder={t("panel.skills.descPlaceholder")}
            value={newDesc}
            onChange={(e) => setNewDesc(e.currentTarget.value)}
            disabled={busy !== ""}
            style={{ ...inputStyle, flex: "none" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              data-omc-skill-create=""
              style={btnPrimary}
              disabled={busy !== "" || !nameOk}
              onClick={create}
            >
              {busy === "create" ? "…" : t("panel.skills.create")}
            </button>
            <button
              type="button"
              data-omc-skill-cancel=""
              style={btn}
              disabled={busy !== ""}
              onClick={() => setCreating(false)}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      {skills.length === 0 && (
        <span
          data-omc-skills-none=""
          style={{ ...meta, padding: "2px 0", display: "block", whiteSpace: "normal" }}
        >
          {t("panel.skills.empty")}
        </span>
      )}
      {skills.length > 12 && (
        <SearchField
          hook="data-omc-skills-search"
          style={{ margin: "2px 0 4px" }}
          value={query}
          placeholder={t("panel.skills.searchPlaceholder", { count: skills.length })}
          label={t("panel.skills.searchLabel")}
          onChange={setQuery}
        />
      )}
      {skills.length > 0 && !anyMatch && (
        <span data-omc-skills-empty="" style={{ ...meta, padding: "2px 0" }}>
          {t("panel.skills.noMatch")}
        </span>
      )}
      {sections.map((sec) => {
        const rows = sec.rows.filter(match);
        if (rows.length === 0) return null;
        // Groups start folded so the tab reads as a short list of groups plus Skill costs; a search
        // opens them to show its matches, and a lone group opens since folding it hides everything.
        const open = query.trim() !== "" || sections.filter((x) => x.rows.length > 0).length === 1;
        return (
          <details key={sec.key} open={open} data-omc-skills-scope={sec.key}>
            <summary style={FOLD_HEAD}>
              {sec.label} · {sec.rows.length}
            </summary>
            <div style={FOLD_BODY}>{rows.map(rowNode)}</div>
          </details>
        );
      })}
      {skills.some((s) => writable(s.scope)) && (
        <span data-omc-skill-note="" style={{ ...meta, padding: "2px 0", whiteSpace: "normal" }}>
          {t("panel.skills.removeNote")}
        </span>
      )}
      {applied && (
        <span data-omc-skill-applied="" style={{ ...meta, padding: "2px 0" }}>
          {applied}
        </span>
      )}
      {err && (
        <span data-omc-skill-error="" style={errText}>
          {err}
        </span>
      )}
      <details
        data-omc-skill-doctor-fold=""
        style={{ marginTop: 8 }}
        onToggle={(e) => {
          if (e.currentTarget.open && cost.kind === "idle") loadCost();
        }}
      >
        <summary style={FOLD_HEAD}>{t("panel.skills.costs")}</summary>
        <div style={FOLD_BODY}>
          <div style={{ ...meta, whiteSpace: "normal", margin: "8px 0" }}>
            {t("panel.skills.costsIntro")}
          </div>
          {cost.kind === "loading" && (
            <div style={{ color: T.muted, fontSize: 13 }}>{t("panel.skills.reading")}</div>
          )}
          {cost.kind === "error" && (
            <div style={{ color: T.err, fontSize: 13 }}>
              {t("panel.skills.reportError", { text: cost.text })}
            </div>
          )}
          {cost.kind === "declined" && (
            <pre
              data-omc-skill-doctor=""
              aria-label={t("panel.skills.reportLabel")}
              style={{ ...code, maxHeight: 320, overflow: "auto", margin: 0 }}
            >
              {cost.text}
            </pre>
          )}
          {cost.kind === "report" && (
            <>
              {cost.partial && (
                <div style={{ color: T.faint, fontSize: 12, marginBottom: 6 }}>
                  {t("panel.skills.partialNote")}
                </div>
              )}
              {(() => {
                const parsed = parseSkillCosts(cost.text);
                if (!parsed || parsed.length === 0)
                  return (
                    <pre
                      data-omc-skill-doctor=""
                      aria-label={t("panel.skills.costsReportLabel")}
                      style={{ ...code, maxHeight: 320, overflow: "auto", margin: 0 }}
                    >
                      {cost.text}
                    </pre>
                  );
                return (
                  <>
                    <div style={{ maxHeight: 320, overflow: "auto" }}>
                      <table
                        data-omc-skill-cost-table=""
                        aria-label={t("panel.skills.costsTableLabel")}
                        style={{ borderCollapse: "collapse", width: "100%" }}
                      >
                        <thead>
                          <tr>
                            {costCols.map((c) => (
                              <th
                                key={c.col}
                                data-omc-skill-cost-header={c.col}
                                aria-sort={
                                  costSort.col === c.col
                                    ? costSort.dir === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                                style={{
                                  ...meta,
                                  textAlign: "left",
                                  position: "sticky",
                                  top: 0,
                                  background: T.card,
                                  borderBottom: `1px solid ${T.border}`,
                                  padding: "2px 6px",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCostSort((prev) =>
                                      prev.col === c.col
                                        ? { col: c.col, dir: prev.dir === "asc" ? "desc" : "asc" }
                                        : { col: c.col, dir: "desc" },
                                    )
                                  }
                                  style={{
                                    background: "none",
                                    border: 0,
                                    padding: 0,
                                    margin: 0,
                                    font: "inherit",
                                    color: "inherit",
                                    cursor: "pointer",
                                  }}
                                >
                                  {t(`panel.skills.col.${c.col}`)}
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortSkillCosts(parsed, costSort.col, costSort.dir).map((row) => (
                            <tr key={row.skill}>
                              {costCols.map((c) => {
                                const cellStyle: CSSProperties = {
                                  ...meta,
                                  color: T.muted,
                                  padding: "2px 6px",
                                };
                                if (c.numeric) {
                                  cellStyle.fontFamily = T.mono;
                                  cellStyle.textAlign = "right";
                                }
                                return (
                                  <td key={c.col} style={cellStyle}>
                                    {row[c.col]}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <span
                      data-omc-skill-cost-note=""
                      style={{ ...meta, display: "block", marginTop: 6, whiteSpace: "normal" }}
                    >
                      {t("panel.skills.costNote")}
                    </span>
                  </>
                );
              })()}
            </>
          )}
          {cost.kind !== "loading" && (
            <button type="button" onClick={loadCost} style={{ ...btn, marginTop: 8 }}>
              {t("panel.refresh")}
            </button>
          )}
        </div>
      </details>
      <details
        data-omc-usage-drivers=""
        onToggle={(e) => {
          if (e.currentTarget.open && drivers === null) loadDrivers();
        }}
      >
        <summary style={FOLD_HEAD}>{t("panel.skills.driversHead")}</summary>
        <div style={FOLD_BODY}>
          <div
            data-omc-usage-drivers-note=""
            style={{ ...meta, display: "block", whiteSpace: "normal" }}
          >
            {t("panel.skills.driversNote")}
          </div>
          {drivers === null && (
            <>
              <div data-omc-skeleton="" style={{ height: 12, width: "45%", margin: "6px 0" }} />
              <div data-omc-skeleton="" style={{ height: 12, width: "80%", margin: "6px 0" }} />
              <div data-omc-skeleton="" style={{ height: 12, width: "62%", margin: "6px 0" }} />
            </>
          )}
          {drivers !== null && !drivers.ok && (
            <div style={{ ...meta, color: T.faint }}>{drivers.error}</div>
          )}
          {drivers !== null && drivers.ok && (
            <>
              {(() => {
                const win =
                  drivers.windows.find((w) => w.label === "Last 7d") ?? drivers.windows[0];
                if (!win)
                  return (
                    <div style={{ ...meta, color: T.faint }}>{t("panel.skills.noActivity")}</div>
                  );
                return (
                  <>
                    {/* `?? []` because this reply can come from a cache file written by an older
                      build that had no such field; a bare `.map` threw and React unmounted the
                      whole fold. Seen on this box 2026-09-20 against a cache from an hour before. */}
                    {(win.behaviours ?? []).map((b) => (
                      <div
                        key={b}
                        data-omc-usage-behaviour=""
                        style={{ ...meta, display: "block", whiteSpace: "normal", color: T.text }}
                      >
                        {behaviourText(b)}
                      </div>
                    ))}
                    {win.groups
                      .filter((g) => g.label !== "Skills")
                      .map((g) => (
                        <div key={g.label}>
                          <div
                            style={{
                              ...meta,
                              color: T.text,
                              marginTop: 6,
                              display: "block",
                            }}
                          >
                            {(() => {
                              const key = DRIVER_GROUP_KEYS.get(g.label);
                              return key ? t(key) : g.label;
                            })()}
                          </div>
                          {g.drivers.map((d) => (
                            <div
                              key={d.name}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr auto",
                                columnGap: 12,
                                alignItems: "baseline",
                              }}
                            >
                              <span>{d.name}</span>
                              <span style={{ fontVariantNumeric: "tabular-nums", color: T.faint }}>
                                {d.pct}%
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    <div data-omc-usage-drivers-window="" style={{ ...meta }}>
                      {t("panel.skills.driversWindow", {
                        requests: win.requests,
                        sessions: win.sessions,
                      })}
                    </div>
                  </>
                );
              })()}
            </>
          )}
          <button
            type="button"
            data-omc-usage-drivers-refresh=""
            aria-label={t("panel.skills.driversRefreshLabel")}
            style={{ ...btn, marginTop: 8 }}
            disabled={driversBusy}
            onClick={() => loadDrivers(true)}
          >
            {driversBusy ? t("panel.skills.readingBusy") : t("panel.refresh")}
          </button>
        </div>
      </details>
    </div>
  );
}

/**
 * "Instructions" body rendered inside the Oh My Claude dialog: lists the CLAUDE.md hierarchy
 * the session loaded (managed, user, project, local files plus @imports), and opens each in
 * an editor. Managed files open read-only. Same save/delete routes as Memory, path-checked.
 */
function InstructionsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = useState<InstructionFile[]>([]);
  const [file, setFile] = useState<InstructionFile | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [roster, setRoster] = useState<PluginRoster | null>(null);
  const [pluginErrors, setPluginErrors] = useState<PluginLoadError[]>([]);
  const [pluginWarnings, setPluginWarnings] = useState<PluginLoadError[]>([]);

  // Every call names the session's own mount, so a session on a box lists and edits that box's
  // CLAUDE.md files rather than this PC's.
  const provider = claudeProviderOf(ctx, sessionId);
  const onBox = provider === undefined ? "" : `provider=${encodeURIComponent(provider)}`;
  const q = [
    cwd ? `cwd=${encodeURIComponent(cwd)}` : "",
    `session=${encodeURIComponent(sessionId)}`,
    onBox,
  ]
    .filter((p) => p !== "")
    .join("&");
  // A fetch in flight when the tab closes must not set state on the unmounted component (React
  // warns, and the stale result would flash if the tab reopened). Both loaders check this first.
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const refresh = () => {
    if (!cwd) return;
    fetch(`${ROUTE}/instructions?${q}`)
      .then((r) => readJson<{ files?: InstructionFile[] }>(r))
      .then((b) => mounted.current && setFiles(b.files ?? []))
      .catch((e: Error) => mounted.current && setError(e.message));
  };
  useEffect(() => {
    refresh();
  }, [cwd]);
  const refreshRoster = useCallback(() => {
    if (!cwd) return;
    fetch(`${ROUTE}/plugins?${q}`)
      .then((r) =>
        readJson<
          PluginRoster & { pluginErrors?: PluginLoadError[]; pluginWarnings?: PluginLoadError[] }
        >(r),
      )
      // A roster that will not load is not an instructions error: the file list is still good.
      .then((b) => {
        if (!mounted.current) return;
        setRoster(b);
        setPluginErrors(b.pluginErrors ?? []);
        setPluginWarnings(b.pluginWarnings ?? []);
      })
      .catch(() => {});
  }, [cwd, q]);
  useEffect(() => {
    refreshRoster();
  }, [refreshRoster]);
  const openFile = async (f: InstructionFile) => {
    setError("");
    try {
      const body = await readJson<{ text: string; mtime?: number }>(
        await fetch(`${ROUTE}/instructions/file?${q}&path=${encodeURIComponent(f.path)}`),
      );
      // The read's own mtime, not the list's: the list can be minutes old by the time a row opens,
      // and the save sends this back for the server to check the file has not moved since.
      setFile({ ...f, mtime: body.mtime ?? f.mtime });
      setText(body.text);
      setSaved(body.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    if (!file || file.kind === "Managed") return;
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch(`${ROUTE}/instructions/file${onBox === "" ? "" : `?${onBox}`}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, path: file.path, text, mtime: file.mtime }),
        }),
      );
      setSaved(text);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // A session dsh reports no directory for has neither instructions nor settings to read.
  if (!cwd)
    return (
      <span style={{ ...meta, padding: "4px 0", color: error ? T.err : undefined }}>
        {error || t("panel.instructions.none")}
      </span>
    );
  const dirty = text !== saved;

  return (
    <div style={bodyFlow}>
      {file === null && files.length === 0 && (
        <span style={{ ...meta, padding: "4px 0" }}>{t("panel.instructions.none")}</span>
      )}
      {file === null ? (
        files.map((f) => (
          <button
            key={f.path}
            type="button"
            style={{
              ...rowBtn,
            }}
            onClick={() => openFile(f)}
          >
            <span style={{ ...meta, flex: "none", minWidth: 52 }}>
              {t(`panel.instructions.kind.${f.kind}`)}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                marginLeft: 8,
                fontFamily: T.mono,
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortPath(f.path, cwd)}
            </span>
            {f.importedBy && (
              <span style={{ ...meta, flex: "none", marginLeft: 8 }}>
                {t("panel.instructions.importedFrom", {
                  name: f.importedBy.split("/").pop() ?? "",
                })}
              </span>
            )}
            <span style={{ ...meta, flex: "none", marginLeft: 8 }}>{ago(f.mtime)}</span>
          </button>
        ))
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" style={btn} onClick={() => setFile(null)} disabled={busy}>
              ‹ {t("panel.back")}
            </button>
            <span style={{ flex: 1, minWidth: 0, fontFamily: T.mono, fontSize: 12 }}>
              {shortPath(file.path, cwd)}
            </span>
            {file.kind === "Managed" && (
              <span style={{ ...meta, flex: "none" }}>{t("panel.instructions.readOnly")}</span>
            )}
            {file.kind !== "Managed" && (
              <button
                type="button"
                style={dirty ? btnPrimary : btn}
                onClick={save}
                disabled={busy || !dirty}
              >
                {t("save")}
              </button>
            )}
          </div>
          <textarea
            data-omc-instructions-editor=""
            aria-label={t("panel.instructions.editorLabel")}
            value={text}
            spellCheck={false}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
            autoFocus
            readOnly={file.kind === "Managed"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
            }}
            style={{ ...code, minHeight: 300, resize: "vertical", whiteSpace: "pre-wrap" }}
          />
        </>
      )}
      {file === null && (
        <PluginManagerBlock
          roster={roster}
          pluginErrors={pluginErrors}
          pluginWarnings={pluginWarnings}
          sessionId={sessionId}
          ctx={ctx}
          onChanged={refreshRoster}
        />
      )}
      {error && <span style={errText}>{error}</span>}
    </div>
  );
}

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
function RewindBody({
  sessionId,
  ctx,
  onClose,
}: {
  sessionId: string;
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
    fetch(
      `${ROUTE}/rewind?session=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}${boxParam(ctx, sessionId)}`,
    )
      .then((r) => readJson<{ prompts?: RewindPrompt[] }>(r))
      .then((b) => live && setPrompts(b.prompts ?? []))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [cwd, sessionId]);

  if (!isClaude || !cwd) return null;
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
      if (!dryRun && reply.ok) onClose();
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
          <span style={{ ...meta, padding: "2px 0" }}>{t("panel.rewind.explain")}</span>
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
function ChangesBody({
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

/**
 * The modes in which the CLI reads a per-server override at all, because they auto-allow an MCP
 * tool call. `auto` and `dontAsk` rank the same in `src/state.ts`, and leaving `dontAsk` out had the
 * tab printing "this changes nothing yet" in the one mode where the toggle does the most work.
 * `acceptEdits` is not here: it auto-allows file edits, not tool calls from a server.
 */
const AUTO_ALLOWING = new Set(["auto", "dontAsk", "bypassPermissions"]);

interface McpServer {
  name: string;
  status: string;
  version?: string;
  error?: string;
  /** Bare tool names the server contributes; absent when the session has seen no init frame. */
  tools?: string[];
  /** Pinned back to asking on the live process. Comes from the plugin's record of what it sent,
   *  since the CLI reports connection only, and it is the live process that is asked either way. */
  asking?: boolean;
}
/** What the process-only routes answer for a session with no CLI behind it. The tabs match on this
 *  text to draw their not running line, so a reply made here has to read the same as the server's. */
const NOT_RUNNING = { ok: false, error: "no live Claude process for this session" } as const;

type McpReply = { ok: true; servers: McpServer[] } | { ok: false; error: string };
/** A server the CLI is configured with, as `GET /mcp-servers/configured` lists it, with its scope. */
interface ConfiguredMcpRow {
  name: string;
  scope: "user" | "local" | "project";
  summary: string;
}

/**
 * "MCP" body rendered inside the Oh My Claude dialog: the servers Claude's process
 * has, with their connection status, the tools each one contributes, a Reconnect
 * and Remove per row, and an Add form below.
 */
function McpBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx; onClose: () => void }) {
  useLocale();
  const isClaude = activeClaudeSession(ctx) === sessionId;
  const [reply, setReply] = useState<McpReply | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  // The session's own permission mode: whether the Always ask toggle would be inert. Null until
  // fetched; a failed read leaves it null and the toggle still renders because the mode can change.
  const [permMode, setPermMode] = useState<PermissionModeState | null>(null);

  // The configured list beside the live one: a server added a moment ago has no process yet, so
  // it shows here as "starts with the next session" instead of vanishing until Claude restarts,
  // and a live row learns its scope from it. Two file reads on the box, on open and after a change.
  const [configured, setConfigured] = useState<ConfiguredMcpRow[]>([]);
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const loadConfigured = () => {
    if (!cwd) return Promise.resolve();
    return fetch(
      `${ROUTE}/mcp-servers/configured?cwd=${encodeURIComponent(cwd)}${boxParam(ctx, sessionId)}`,
    )
      .then((r) => readJson<{ servers?: ConfiguredMcpRow[] }>(r))
      .then((b) => setConfigured(b.servers ?? []))
      .catch(() => setConfigured([]));
  };
  const load = () =>
    Promise.all([
      fetch(`${ROUTE}/mcp-servers?session=${encodeURIComponent(sessionId)}`)
        .then((r) => readJson<McpReply>(r))
        .then(setReply)
        .catch((e: Error) => setReply({ ok: false, error: e.message })),
      loadConfigured(),
    ]);
  useEffect(() => {
    setReply(null);
    setNote("");
    if (!hasRunTurn(ctx, sessionId)) {
      setReply(NOT_RUNNING);
      void loadConfigured();
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load closes over sessionId only
  }, [sessionId]);
  // Fetch the session's permission mode so rows can say whether the toggle is inert. A failed read
  // leaves permMode null; the row still renders because the mode may change while the tab is open.
  useEffect(() => {
    let live = true;
    setPermMode(null);
    fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<PermissionModeState>(r))
      .then((snap) => live && setPermMode(snap))
      .catch(() => live && setPermMode(null));
    return () => {
      live = false;
    };
  }, [sessionId]);
  const scopeOf = (name: string) => configured.find((c) => c.name === name)?.scope;

  if (!isClaude) return null;
  const reconnect = async (serverName: string) => {
    setBusy(serverName);
    setNote("");
    try {
      const r = await readJson<{ ok: boolean; error?: string }>(
        await fetch(`${ROUTE}/mcp-servers/reconnect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, name: serverName }),
        }),
      );
      setNote(
        t("panel.mcp.nameMsg", {
          name: serverName,
          msg: r.ok ? t("panel.mcp.reconnectedMsg") : (r.error ?? t("panel.plugins.actionFailed")),
        }),
      );
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  /** After the sign-in page opens, the CLI reconnects the server itself when the browser comes
   *  back, and says nothing about it. Re-read the status until the row stops needing auth, or give
   *  up after ninety seconds so a login someone abandoned does not poll forever. */
  const watchUntilSignedIn = () => {
    let left = 30;
    const tick = () => {
      left -= 1;
      void load().then(() => {
        if (left > 0) window.setTimeout(tick, 3000);
      });
    };
    window.setTimeout(tick, 3000);
  };
  const login = async (serverName: string) => {
    setBusy(serverName);
    setNote("");
    try {
      const r = await fetch(`${ROUTE}/mcp-servers/authenticate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, name: serverName }),
      }).then((x) => readJson<{ ok?: boolean; authUrl?: string; error?: string }>(x));
      if (r.ok === true && r.authUrl !== undefined) {
        window.open(r.authUrl, "_blank", "noopener");
        setNote(t("panel.mcp.nameMsg", { name: serverName, msg: t("panel.mcp.approveInTab") }));
        watchUntilSignedIn();
      } else if (r.ok === true) {
        setNote(t("panel.mcp.nameMsg", { name: serverName, msg: t("panel.mcp.alreadySignedIn") }));
        void load();
      } else {
        setNote(
          t("panel.mcp.nameMsg", { name: serverName, msg: r.error ?? t("panel.mcp.loginFailed") }),
        );
      }
    } catch (e) {
      setNote(
        t("panel.mcp.nameMsg", {
          name: serverName,
          msg: e instanceof Error ? e.message : t("panel.mcp.loginFailed"),
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (serverName: string) => {
    setBusy(serverName);
    setNote("");
    try {
      const r = await readJson<{ ok: boolean; error?: string }>(
        await fetch(`${ROUTE}/mcp-servers/remove${boxQuery(ctx, sessionId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, name: serverName }),
        }),
      );
      setNote(
        r.ok
          ? t("panel.mcp.removed", { name: serverName, spawn: spawnNote() })
          : t("panel.mcp.nameMsg", {
              name: serverName,
              msg: r.error ?? t("panel.plugins.actionFailed"),
            }),
      );
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  // Toggle one server's Always ask override, in the shape reconnect and remove use: the tab's note
  // line carries the outcome, and the local record moves only when the process took the change.
  const setAsk = async (serverName: string, ask: boolean) => {
    setBusy(serverName);
    setNote("");
    try {
      const r = await readJson<{ ok: boolean; error?: string }>(
        await fetch(`${ROUTE}/mcp-servers/ask`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, name: serverName, ask }),
        }),
      );
      if (r.ok) await load();
      else
        setNote(
          t("panel.mcp.nameMsg", {
            name: serverName,
            msg: r.error ?? t("panel.plugins.actionFailed"),
          }),
        );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const servers = reply?.ok ? reply.servers : [];
  // A mode that would not have auto-allowed the tool reads no override, so the toggles change
  // nothing today. They still draw: the mode can change while this tab is open. One line says it
  // once, because it is a fact about the session and not about any one server.
  const askIsInert = permMode !== null && !AUTO_ALLOWING.has(permMode.mode);
  // Configured but not in the process: the plugin-served `plugin:` names never appear in a config
  // file, so the match is by plain name.
  const pendingRows = configured.filter((c) => !servers.some((s) => s.name === c.name));
  return (
    <div style={bodyFlow}>
      {/* The form is what this tab is opened to reach, so it sits above the list rather than
          under however many servers happen to be configured. */}
      <button
        type="button"
        style={{ ...btn, marginBottom: 8 }}
        onClick={() => setShowAdd(!showAdd)}
      >
        {showAdd ? t("cancel") : t("panel.mcp.addServer")}
      </button>
      {/* Collapsed by row height rather than unmounted: 0fr to 1fr is the one way a grid row
          animates to a height nobody measured, so Cancel slides shut instead of cutting. */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: showAdd ? "1fr" : "0fr",
          transition: `grid-template-rows ${easeMs()}ms ease`,
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <McpAddForm
            sessionId={sessionId}
            ctx={ctx}
            onAdded={() => {
              setNote(spawnNote());
              void loadConfigured();
            }}
          />
        </div>
      </div>
      {reply === null ? (
        <span style={stateText}>{t("loading")}</span>
      ) : !reply.ok && reply.error.startsWith("no live Claude process") ? (
        <span style={stateText}>{t("panel.mcp.notRunning")}</span>
      ) : !reply.ok ? (
        <span style={errText}>{reply.error}</span>
      ) : servers.length === 0 && pendingRows.length === 0 ? (
        <span style={{ ...meta, padding: "2px 0" }}>{t("panel.mcp.none")}</span>
      ) : (
        servers.map((s) => (
          <div key={s.name}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  flex: "none",
                  background:
                    s.status === "connected" ? T.ok : s.status === "pending" ? T.warn : T.err,
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 13,
                }}
                title={s.name}
              >
                {s.name}
                {s.version ? <span style={meta}> {s.version}</span> : null}
              </span>
              {scopeOf(s.name) && <span style={pill(T.faint)}>{scopeOf(s.name)}</span>}
              <span style={{ ...meta, flex: "none" }}>{mcpStatusLabel(s.status)}</span>
              {/* A tighten-only toggle: on sends default (ask), off sends null (clear). What it
                  reads is the plugin's record on the live process, so a refresh or a second browser
                  sees the same thing; the CLI offers no read-back of its own. */}
              <button
                type="button"
                // Filled while it is on. `aria-pressed` alone tells a screen reader and nobody
                // else, and this is a button that changes what the session does the next time a
                // tool runs, so it has to read as on from across the row.
                style={s.asking === true ? btnPrimary : btn}
                aria-pressed={s.asking === true}
                aria-label={t("panel.mcp.alwaysAskLabel", { name: s.name })}
                data-omc-mcp-ask=""
                disabled={busy !== null}
                onClick={() => setAsk(s.name, s.asking !== true)}
              >
                {t("panel.mcp.alwaysAsk")}
              </button>
              {s.status !== "needs-auth" && (
                <button
                  type="button"
                  style={btn}
                  disabled={busy !== null}
                  onClick={() => reconnect(s.name)}
                >
                  {busy === s.name ? "…" : t("panel.mcp.reconnect")}
                </button>
              )}
              {s.status === "needs-auth" && (
                <button
                  type="button"
                  style={btn}
                  data-omc-mcp-login=""
                  aria-label={t("panel.mcp.loginLabel", { name: s.name })}
                  disabled={busy !== null}
                  onClick={() => void login(s.name)}
                >
                  {busy === s.name ? "…" : t("panel.mcp.login")}
                </button>
              )}
              <ConfirmButton
                label={t("common.remove")}
                style={btn}
                disabled={busy !== null}
                busyLabel={busy === s.name ? "…" : undefined}
                onAct={() => remove(s.name)}
              />
            </div>
            {s.status !== "connected" && (s.error || s.status === "needs-auth") ? (
              // A server that is down explains itself here in the CLI's own words. A `needs-auth`
              // row adds what to do about it, beside rather than instead of that wording: the CLI
              // does set an error on these rows ("Please log in to your account"), so a fallback
              // would never render and the Log in button would stand unexplained.
              <div style={{ padding: "0 0 4px 16px", color: T.muted, fontSize: 12 }}>
                {s.error}
                {s.status === "needs-auth" ? (
                  <div style={{ marginTop: 2 }}>{t("panel.mcp.loginHelp")}</div>
                ) : null}
              </div>
            ) : null}
            {s.tools && s.tools.length > 0 ? (
              <div style={{ padding: "0 0 4px 16px", color: T.muted, fontSize: 12 }}>
                {s.tools.join(" · ")}
              </div>
            ) : null}
            {/* When the override is set and the session would otherwise auto-allow, say what it
                does. The CLI keeps it in state that dies with the process, so the note says so. */}
            {s.asking === true && !askIsInert && (
              <div style={{ padding: "0 0 4px 16px", color: T.muted, fontSize: 12 }}>
                {t("panel.mcp.askNote")}
              </div>
            )}
          </div>
        ))
      )}
      {pendingRows.map((c) => (
        <div key={`configured:${c.name}`} data-omc-mcp-pending="">
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: 4, flex: "none", background: T.faint }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
              }}
              title={c.summary}
            >
              {c.name}
              <span style={meta}> {c.summary}</span>
            </span>
            <span style={pill(T.faint)}>{c.scope}</span>
            <span style={{ ...meta, flex: "none" }}>{t("panel.mcp.startsNext")}</span>
            <ConfirmButton
              label={t("common.remove")}
              style={btn}
              disabled={busy !== null}
              busyLabel={busy === c.name ? "…" : undefined}
              onAct={() => remove(c.name)}
            />
          </div>
        </div>
      ))}
      {askIsInert && servers.length > 0 && (
        <span style={{ ...meta, padding: "2px 0", marginTop: 8 }}>{t("panel.mcp.inertNote")}</span>
      )}
      {note && <span style={{ ...meta, padding: "2px 0", marginTop: 8 }}>{note}</span>}
    </div>
  );
}

/**
 * A server the config gains or loses is not a server this process has: the CLI reads its MCP
 * config at spawn, so the list on screen only catches up on the next one. A function, not a const,
 * so it reads the active language at the moment the note is shown rather than at module load.
 */
const spawnNote = (): string => t("panel.mcp.spawnNote");

/** An MCP server's connection status as a word: the three the tab knows, translated; any other the
 *  CLI reports (a status added later) shows through in the CLI's own word rather than vanishing. */
const mcpStatusLabel = (status: string): string =>
  status === "connected" || status === "pending" || status === "needs-auth"
    ? t(`panel.mcp.status.${status}`)
    : status;

/** Runtime status, config files, and doctor output. */
interface DiagnosticsReply {
  ok: true;
  runtime: {
    host: string;
    binary: string | null;
    version: string | null;
    loggedIn: boolean;
    email: string | null;
    configDir: string;
    plugin: string;
    /** A newer plugin release on npm, and the command that installs it. This box only. */
    latest?: string;
    update?: string;
    error?: string;
    /** Session logs the plugin healed, could not heal, or rolled back since the last dismissal;
     *  this box only. `refused` names the ones a click can reseed from their transcript. */
    sessionRepairs?: {
      healed: number;
      unknown: number;
      rolledBack: number;
      at: number;
      refused?: Array<{ id: string }>;
    };
  };
  configFiles: Array<{ scope: string; path: string; exists: boolean; parseError?: string }>;
  session?: { claudeId: string; cwd: string };
}
type DiagnosticsError = { ok: false; error: string };
/** The slice of a turn record this tab reads: when the turn ran, and the calls a rule refused. */
interface DeniedTurn {
  at: number;
  denials?: string[];
}

/**
 * The opt-in for the notice a finished session raises. It lives here rather than on Tune because
 * Tune writes Claude Code's settings and this is the browser's own permission plus one local flag.
 * The permission is asked for from this button and nowhere else: an unprompted prompt on page load
 * is the one people deny for good.
 */
function SessionNotices() {
  useLocale();
  const [on, setOn] = useState(noticesOn);
  const supported = "Notification" in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
  const write = (next: boolean) => {
    setNoticesOn(next);
    setOn(next);
  };
  const enable = () => {
    if (!supported) return;
    if (Notification.permission === "default")
      void Notification.requestPermission().then((p) => {
        setPermission(p);
        write(p === "granted");
      });
    else write(true);
  };
  const state = !supported
    ? t("panel.notices.noApi")
    : permission === "denied"
      ? t("panel.notices.blocked")
      : on
        ? t("panel.notices.on")
        : t("panel.notices.off");
  return (
    <>
      <span style={sectionHead}>{t("panel.notices.head")}</span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 0",
          fontSize: 12,
          lineHeight: "1.5",
        }}
      >
        <button
          type="button"
          style={{ ...btn, fontSize: 12, flex: "0 0 auto" }}
          disabled={!supported || permission === "denied"}
          onClick={() => (on ? write(false) : enable())}
        >
          {on ? t("panel.notices.turnOff") : t("panel.notices.turnOn")}
        </button>
        <span>{state}</span>
      </div>
    </>
  );
}

/**
 * The line a readout section shows in place of its list: no process to ask, the read still out, or
 * the reason it failed. Both sections show it, because both come from the one fetch.
 */
function ReadoutState({
  running,
  error,
  reply,
}: {
  running: boolean;
  error: string;
  reply: PermissionsReply | null;
}) {
  useLocale();
  if (!running)
    return (
      <span style={{ ...meta, padding: "2px 0", fontSize: 12 }}>
        {t("panel.readout.notRunning")}
      </span>
    );
  if (error !== "") return <span style={errText}>{error}</span>;
  if (reply === null) return <span style={stateText}>{t("loading")}</span>;
  return null;
}

/**
 * The fold both readout lists share: eight rows, a button past that, and back to eight. Returns how
 * many to show, whether that is all of them, and the button to draw when there is more than a fold.
 */
function useFold(total: number) {
  useLocale();
  const [shown, setShown] = useState(8);
  const allShown = shown >= total;
  const button =
    total > 8 ? (
      <button
        type="button"
        style={{ ...btn, fontSize: 12, margin: "2px 0" }}
        onClick={() => setShown(allShown ? 8 : total)}
      >
        {allShown ? t("panel.fold.showFewer") : t("panel.fold.showAll", { total })}
      </button>
    ) : null;
  return { shown, allShown, button };
}

/** Sort rank for permission behaviour: deny before ask before allow. */
const ruleRank = (r: string): number => (r === "deny" ? 0 : r === "ask" ? 1 : 2);

/** A permission rule's behaviour as a word: the three the CLI uses, translated; any other value
 *  it reports shows through unchanged rather than as a missing key. */
const ruleBehaviorLabel = (behavior: string): string =>
  behavior === "allow" || behavior === "deny" || behavior === "ask"
    ? t(`panel.rules.behavior.${behavior}`)
    : behavior;

/**
 * The permission rules readout: one row per rule, behaviour as a pill, the CLI's own display text
 * in mono, the source beside it. The eight it shows folded are the deny and ask rules first, so what
 * a fold hides is an allow rule for as long as there are fewer than eight restrictions; unfolded it
 * is the CLI's own order, which is the order the rules are applied in.
 */
function RulesList({ rules }: { rules: PermissionRules["rules"] }) {
  const { shown, allShown, button } = useFold(rules.length);
  // Deny first, then ask, then allow. Within each group the CLI's own order is preserved.
  const visible = allShown
    ? rules
    : [...rules].toSorted((a, b) => ruleRank(a.behavior) - ruleRank(b.behavior)).slice(0, shown);
  return (
    <div>
      {visible.map((r, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "3px 0",
            fontSize: 12,
          }}
        >
          <span
            style={pill(r.behavior === "allow" ? T.ok : r.behavior === "deny" ? T.err : T.warn)}
          >
            {ruleBehaviorLabel(r.behavior)}
          </span>
          <span style={{ flex: 1, fontFamily: T.mono, fontSize: 11 }}>{r.text}</span>
          <span style={{ ...meta, flex: "none" }}>{r.source}</span>
        </div>
      ))}
      {button}
    </div>
  );
}

/** The hooks readout: one row per hook, the event and the command in mono, the matcher and the
 *  source beside them, in the order the CLI listed them. */
function HooksList({ hooks }: { hooks: HooksListing["hooks"] }) {
  const { shown, button } = useFold(hooks.length);
  const visible = hooks.slice(0, shown);
  return (
    <div>
      {visible.map((h, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "3px 0",
            fontSize: 12,
          }}
        >
          <span style={{ flex: "none", fontFamily: T.mono, fontSize: 11 }}>{h.event}</span>
          {h.matcher !== "" && <span style={{ ...meta, flex: "none" }}>{h.matcher}</span>}
          <span style={{ flex: 1, fontFamily: T.mono, fontSize: 11 }}>{h.text}</span>
          <span style={{ ...meta, flex: "none" }}>{h.source}</span>
        </div>
      ))}
      {button}
    </div>
  );
}

/**
 * "Diagnostics" body in the Oh My Claude dialog: runtime status, config file parse errors,
 * MCP servers that are not connected with their errors, and a doctor output button.
 */
function DiagnosticsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const running = activeClaudeSession(ctx) === sessionId;
  // The readout, like the diff and the MCP roster, is answered by the session's own CLI process. A
  // session nobody has prompted yet has none, so the tab says so instead of asking and waiting on a
  // refusal.
  const started = running && hasRunTurn(ctx, sessionId);
  const [data, setData] = useState<DiagnosticsReply | DiagnosticsError | null>(null);
  const [mcp, setMcp] = useState<McpReply | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [audit, setAudit] = useState<DeniedTurn[] | null>(null);
  const [auditError, setAuditError] = useState("");
  const [permissions, setPermissions] = useState<PermissionsReply | null>(null);
  const [permissionsError, setPermissionsError] = useState("");
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);
  const [doctorError, setDoctorError] = useState("");
  const [doctorBusy, setDoctorBusy] = useState(false);
  const switches = useFeatureSwitches(cwd);

  const loadMcp = useCallback(
    () =>
      !hasRunTurn(ctx, sessionId)
        ? Promise.resolve(setMcp(NOT_RUNNING))
        : fetch(`${ROUTE}/mcp-servers?session=${encodeURIComponent(sessionId)}`)
            .then((r) => readJson<McpReply>(r))
            .then(setMcp)
            .catch((e: Error) => setMcp({ ok: false, error: e.message })),
    [sessionId],
  );

  useEffect(() => {
    // The route asks the running process; with none there is nothing to be not-connected about.
    if (!running) return;
    void loadMcp();
  }, [running, loadMcp]);

  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/turns?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<{ turns?: DeniedTurn[] }>(r))
      .then((b) => {
        // Newest first, and only the turns that had a call refused.
        if (live) setAudit((b.turns ?? []).filter((turn) => turn.denials?.length).toReversed());
      })
      // An error is not an empty audit: say which one it was.
      .catch((e: Error) => live && setAuditError(e.message));
    return () => {
      live = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!started) return;
    let live = true;
    // Clear both first: the error is read before the reply, so a failure left over from the previous
    // process would outlive the read that replaced it.
    setPermissions(null);
    setPermissionsError("");
    fetch(`${ROUTE}/permissions?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<PermissionsReply>(r))
      .then((b) => live && setPermissions(b))
      .catch((e: Error) => live && setPermissionsError(e.message));
    return () => {
      live = false;
    };
  }, [running, sessionId]);

  const reconnect = async (serverName: string) => {
    setReconnecting(serverName);
    try {
      await fetch(`${ROUTE}/mcp-servers/reconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, name: serverName }),
      });
      await loadMcp();
    } finally {
      setReconnecting(null);
    }
  };

  useEffect(() => {
    // A session dsh reports no directory for has nothing to read settings from; say that rather
    // than leaving the tab on "Loading…" for a fetch that will never be made.
    if (!cwd) {
      setData({ ok: false, error: t("panel.diag.noWorkdir") });
      return;
    }
    let live = true;
    // The session's own mount, so a session on a box is diagnosed on that box, not on this one.
    const provider = claudeProviderOf(ctx, sessionId);
    const on = provider ? `&provider=${encodeURIComponent(provider)}` : "";
    fetch(
      `${ROUTE}/diagnostics?cwd=${encodeURIComponent(cwd)}${on}&session=${encodeURIComponent(sessionId)}`,
    )
      .then((r) => readJson<DiagnosticsReply | DiagnosticsError>(r))
      .then((b) => live && setData(b))
      .catch((e: Error) => live && setData({ ok: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [cwd, ctx, sessionId]);

  const doctorProvider = claudeProviderOf(ctx, sessionId);
  const doctorQuery = doctorProvider ? `?provider=${encodeURIComponent(doctorProvider)}` : "";

  const runDoctor = async () => {
    setDoctorBusy(true);
    setDoctorError("");
    try {
      const r = await readJson<{ out?: string; error?: string }>(
        await fetch(`${ROUTE}/diagnostics/doctor${doctorQuery}`, { method: "POST" }),
      );
      if (r.error) {
        setDoctorError(r.error);
      } else {
        setDoctorOutput(r.out ?? "");
      }
    } catch (e) {
      setDoctorError(e instanceof Error ? e.message : String(e));
    } finally {
      setDoctorBusy(false);
    }
  };

  const [rowNote, setRowNote] = useState("");
  const exportMd = async () => {
    if (!data || !data.ok || !data.session) return;
    setRowNote("");
    const q = new URLSearchParams({ id: data.session.claudeId, cwd: data.session.cwd });
    if (doctorProvider) q.set("provider", doctorProvider);
    try {
      await saveBlob(
        `${ROUTE}/transcript.md?${q}`,
        `claude-${data.session.claudeId.slice(0, 8)}.md`,
      );
    } catch (e) {
      setRowNote(e instanceof Error ? e.message : String(e));
    }
  };
  const copyResume = async () => {
    if (!data || !data.ok || !data.session) return;
    try {
      await navigator.clipboard.writeText(resumeCommand(data.session.claudeId, data.session.cwd));
      setRowNote("Copied");
      setTimeout(() => setRowNote(""), 1600);
    } catch {
      setRowNote(t("panel.diag.clipboardFailed"));
    }
  };

  if (!cwd) return null;
  // What this plugin assumes about dsh's own markup, checked against the page as it stands. Every
  // dsh upgrade that has broken this plugin did it silently: a selector matched nothing and a
  // feature stopped without a word. This turns that into a line worth reading after an upgrade.
  // It takes no "is a conversation open" flag: the panel's nearest answer is which session is
  // open, which is true of a new session that renders none of this markup yet.
  const contract = checkContract(document);
  const missing = contractMisses(contract);
  return (
    <div style={bodyFlow}>
      <div
        data-omc-dsh-contract=""
        style={{
          ...meta,
          padding: "2px 0",
          display: "block",
          whiteSpace: "normal",
          color: missing.length > 0 ? T.warn : T.faint,
        }}
      >
        {contractSummary(contract)}
        {missing.map((m) => (
          <div key={m.id} data-omc-dsh-contract-miss={m.id}>
            {m.id}: {m.breaks}
          </div>
        ))}
      </div>
      {data === null ? (
        <span style={stateText}>{t("loading")}</span>
      ) : !data.ok ? (
        // A reply of the wrong shape carries no message; an empty red line says nothing at all.
        <span style={errText}>{data.error || t("panel.diag.unreadable")}</span>
      ) : (
        <>
          {data.session && (
            <>
              <span style={sectionHead}>{t("panel.diag.session")}</span>
              <div
                data-omc-session-row=""
                style={{
                  padding: "4px 0",
                  fontSize: 12,
                  lineHeight: "1.5",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontFamily: T.mono }} title={data.session.claudeId}>
                  {data.session.claudeId.slice(0, 8)}
                </span>
                <span
                  style={{
                    fontFamily: T.mono,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={data.session.cwd}
                >
                  {shortPath(data.session.cwd, cwd)}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  style={btn}
                  data-omc-export-md=""
                  onClick={() => void exportMd()}
                >
                  {t("panel.diag.exportMd")}
                </button>
                <button
                  type="button"
                  style={btn}
                  data-omc-copy-resume=""
                  onClick={() => void copyResume()}
                >
                  {rowNote === "Copied" ? t("copied") : t("panel.diag.copyResume")}
                </button>
                {rowNote !== "" && rowNote !== "Copied" && <span style={errText}>{rowNote}</span>}
              </div>
            </>
          )}
          {/* Runtime */}
          <span style={sectionHead}>{t("panel.diag.runtime")}</span>
          <div style={{ padding: "4px 0", fontSize: 12, lineHeight: "1.5" }}>
            <div>
              {t("panel.diag.binaryLabel")}{" "}
              <span style={{ fontFamily: T.mono }}>
                {data.runtime.binary || t("panel.diag.notFound")}
              </span>
            </div>
            <div>
              {t("panel.diag.versionLabel")} {data.runtime.version || t("panel.diag.unknown")}
            </div>
            <div>
              {t("panel.diag.pluginLabel")} {data.runtime.plugin || t("panel.diag.unknown")}
              {data.runtime.latest && data.runtime.update && (
                <span style={{ marginLeft: 6 }}>
                  <UpdatePill latest={data.runtime.latest} command={data.runtime.update} />
                </span>
              )}
            </div>
            <SessionRepairsNotice repairs={data.runtime.sessionRepairs} ctx={ctx} cwd={cwd} />
            <div>
              {t("panel.diag.loginLabel")}{" "}
              {data.runtime.loggedIn ? (
                <span style={{ color: T.ok }}>
                  {maskEmail(data.runtime.email || t("panel.diag.loggedInFallback"))} ·{" "}
                  {data.runtime.host}
                </span>
              ) : (
                <span style={{ color: T.err }}>{t("panel.diag.notLoggedIn")}</span>
              )}
            </div>
            <div>
              {t("panel.diag.configDirLabel")}{" "}
              <span style={{ fontFamily: T.mono }}>{data.runtime.configDir}</span>
            </div>
            {data.runtime.error && <div style={{ color: T.err }}>{data.runtime.error}</div>}
          </div>

          {/* Config files */}
          <span style={sectionHead}>{t("panel.diag.configFiles")}</span>
          {data.configFiles.length === 0 ? (
            <span style={{ ...meta, padding: "2px 0", fontSize: 12 }}>
              {t("panel.diag.noConfigFiles")}
            </span>
          ) : (
            data.configFiles.map((f) => (
              <div
                key={f.scope}
                style={{
                  ...nested,
                  padding: "4px 0 4px 12px",
                  fontSize: 12,
                  borderLeftColor: f.parseError ? T.err : T.border,
                  color: f.parseError ? T.err : undefined,
                }}
              >
                <div style={{ ...meta, marginBottom: 2 }}>{f.scope}</div>
                <div style={{ fontFamily: T.mono, fontSize: 11, marginBottom: 2 }}>{f.path}</div>
                {!f.exists && (
                  <div style={{ ...meta, fontSize: 11 }}>{t("panel.diag.fileNotFound")}</div>
                )}
                {f.parseError && <div style={{ fontSize: 11 }}>{f.parseError}</div>}
              </div>
            ))
          )}

          <SessionNotices />

          {/* The three settings that switch a tab off underneath it */}
          <span style={sectionHead}>{t("panel.diag.featureSwitches")}</span>
          {switches === null ? (
            <span style={stateText}>{t("loading")}</span>
          ) : (
            <div style={{ padding: "4px 0", fontSize: 12, lineHeight: "1.5" }}>
              <div>
                {switches.retention.scope === null
                  ? t("panel.diag.retentionDefault", { days: switches.retention.days })
                  : t("panel.diag.retentionScoped", {
                      days: switches.retention.days,
                      scope: switches.retention.scope,
                    })}
              </div>
              <div style={{ color: switches.bypassDisabled ? T.err : undefined }}>
                {switches.bypassDisabled
                  ? t("panel.diag.bypassDisabled", { scope: switches.bypassDisabled.scope })
                  : t("panel.diag.bypassAllowed")}
              </div>
              <div style={{ color: switches.checkpointingDisabled ? T.err : undefined }}>
                {switches.checkpointingDisabled
                  ? t("panel.diag.checkpointsOff")
                  : t("panel.diag.checkpointsOn")}
              </div>
              <div>
                {t("panel.diag.usageLimit", {
                  pluginPart: switches.usageLimit.plugin
                    ? t("panel.diag.usageLimitPluginWaits")
                    : t("panel.diag.usageLimitPluginOff"),
                  cliState:
                    switches.usageLimit.cli === null
                      ? t("panel.diag.usageLimitCliUnset")
                      : switches.usageLimit.cli
                        ? t("panel.diag.usageLimitCliOn")
                        : t("panel.diag.usageLimitCliOff"),
                })}
              </div>
            </div>
          )}

          {/* MCP servers that did not come up */}
          <span style={sectionHead}>{t("panel.diag.mcpServers")}</span>
          {!started ? (
            <span style={{ ...meta, padding: "2px 0", fontSize: 12 }}>
              {t("panel.readout.notRunning")}
            </span>
          ) : mcp === null ? (
            <span style={stateText}>{t("loading")}</span>
          ) : !mcp.ok ? (
            <span style={errText}>{mcp.error}</span>
          ) : mcp.servers.every((s) => s.status === "connected") ? (
            <span style={{ ...meta, padding: "2px 0", fontSize: 12 }}>
              {mcp.servers.length === 0 ? t("panel.mcp.none") : t("panel.diag.allConnected")}
            </span>
          ) : (
            mcp.servers
              .filter((s) => s.status !== "connected")
              .map((s) => (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "4px 0",
                    fontSize: 12,
                  }}
                >
                  <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <span style={{ fontFamily: T.mono }}>{s.name}</span>
                    <span style={{ ...meta, marginLeft: 6 }}>{mcpStatusLabel(s.status)}</span>
                    {s.error && (
                      <div style={{ color: T.err, fontSize: 11, marginTop: 2 }}>{s.error}</div>
                    )}
                  </span>
                  <button
                    type="button"
                    style={{ ...btn, fontSize: 12, flex: "none" }}
                    disabled={reconnecting === s.name}
                    onClick={() => void reconnect(s.name)}
                  >
                    {reconnecting === s.name ? "…" : t("panel.mcp.reconnect")}
                  </button>
                </div>
              ))
          )}

          {/* Calls a permission rule refused. The frame names the call, never the rule. */}
          <span style={sectionHead}>{t("panel.diag.refusedCalls")}</span>
          {auditError ? (
            <span style={errText}>{auditError}</span>
          ) : audit === null ? (
            <span style={stateText}>{t("loading")}</span>
          ) : audit.length === 0 ? (
            <span style={{ ...meta, padding: "2px 0", fontSize: 12 }}>
              {t("panel.diag.noRefused")}
            </span>
          ) : (
            audit.map((turn) => (
              <div key={turn.at} style={{ padding: "4px 0", fontSize: 12 }}>
                <div style={meta}>{ago(turn.at)}</div>
                {turn.denials?.map((label) => (
                  <div key={label} style={{ fontFamily: T.mono, fontSize: 11 }}>
                    {label}
                  </div>
                ))}
              </div>
            ))
          )}

          {/* The rules and hooks the live process loaded, read-only: this tab reports them,
              the CLI owns them. Headings paint whether or not the read lands, so a failed one
              says which section is missing rather than leaving a bare error line. */}
          <div data-omc-permission-rules="">
            <span style={sectionHead}>
              {t("panel.diag.permissionRules")}
              {permissions?.ok && ` · ${permissions.rules.length}`}
              {permissions?.ok && permissions.managedOnly && (
                <span style={{ marginLeft: 4 }}>{t("panel.diag.managed")}</span>
              )}
            </span>
            <ReadoutState running={started} error={permissionsError} reply={permissions} />
            {permissions?.ok &&
              (permissions.rules.length === 0 ? (
                <span style={{ ...meta, padding: "2px 0", fontSize: 12 }}>
                  {t("panel.diag.noRules")}
                </span>
              ) : (
                <>
                  <RulesList rules={permissions.rules} />
                  {permissions.directories.length > 0 && (
                    <span style={{ ...meta, padding: "2px 0", fontSize: 12 }}>
                      {(() => {
                        const dirs =
                          permissions.directories.length === 1
                            ? t("panel.diag.workspaceDirsOne", {
                                n: permissions.directories.length,
                              })
                            : t("panel.diag.workspaceDirsOther", {
                                n: permissions.directories.length,
                              });
                        return permissions.directories.length <= 3
                          ? t("panel.diag.dirsWithPaths", {
                              dirs,
                              paths: permissions.directories.map((d) => d.path).join(", "),
                            })
                          : dirs;
                      })()}
                    </span>
                  )}
                </>
              ))}
          </div>
          <div data-omc-hooks="">
            <span style={sectionHead}>
              {t("panel.diag.hooks")}
              {permissions?.ok && ` · ${permissions.hooks.length}`}
            </span>
            <ReadoutState running={started} error={permissionsError} reply={permissions} />
            {permissions?.ok &&
              (permissions.hooks.length === 0 ? (
                <span style={{ ...meta, padding: "2px 0", fontSize: 12 }}>
                  {t("panel.diag.noHooks")}
                </span>
              ) : (
                <HooksList hooks={permissions.hooks} />
              ))}
          </div>

          {/* Doctor button */}
          <div style={{ padding: "6px 0", marginTop: 8, borderTop: `1px solid ${T.border}` }}>
            <button
              type="button"
              style={doctorOutput ? btn : btnPrimary}
              onClick={runDoctor}
              disabled={doctorBusy}
            >
              {doctorBusy ? t("panel.diag.running") : t("panel.diag.runDoctor")}
            </button>
            {doctorError && (
              <div style={{ color: T.err, fontSize: 12, marginTop: 4 }}>{doctorError}</div>
            )}
            {doctorOutput && (
              <pre
                style={{
                  marginTop: 6,
                  padding: 8,
                  fontSize: 11,
                  lineHeight: "1.4",
                  background: T.field,
                  border: `1px solid ${T.border}`,
                  borderRadius: 4,
                  overflow: "auto",
                  maxHeight: 200,
                }}
              >
                {doctorOutput}
              </pre>
            )}
          </div>
          <span style={sectionHead}>{t("panel.diag.reportProblem")}</span>
          <div style={{ padding: "4px 0" }}>
            <ReportBlock sessionId={sessionId} provider={doctorProvider} />
          </div>
        </>
      )}
    </div>
  );
}

/** One task from the durable file or the session transcript. */
interface Task {
  name: string;
  description?: string;
  schedule?: string;
  nextRunAt?: number;
  durable?: boolean;
}

/** Reply from GET /scheduled-tasks. */
interface ScheduledTasksReply {
  ok: true;
  durable: Task[];
  session: Task[];
  goal: { text: string; at: number } | null;
  dshGoals: DshGoal[];
  path: string;
}

/** One of the session's dsh goals, as the route folds dsh's own log. */
interface DshGoal {
  id: string;
  objective: string;
  phase: string;
  roundsStarted: number;
  maxGoalRounds?: number;
  blockedReason?: string;
  createdAt: number;
  updatedAt: number;
}

/** How a goal's phase reads on its row: a mark a glance can take in, and dsh's word translated at
 *  render. The mark stays; only the word switches language. */
const PHASE = new Map<string, { glyph: string; key: OmcKey }>([
  ["active", { glyph: "●", key: "panel.tasks.phase.active" }],
  ["paused", { glyph: "‖", key: "panel.tasks.phase.paused" }],
  ["blocked", { glyph: "■", key: "panel.tasks.phase.blocked" }],
  ["complete", { glyph: "✓", key: "panel.tasks.phase.complete" }],
  ["cleared", { glyph: "○", key: "panel.tasks.phase.cleared" }],
]);

/** A goal phase as it reads on its row: the mark plus the translated word, or the raw phase for a
 *  value dsh added that this map has not caught up with. */
const phaseLabel = (phase: string): string => {
  const p = PHASE.get(phase);
  return p ? `${p.glyph} ${t(p.key)}` : phase;
};

/** One dsh goal: its phase and objective, then rounds and age, and why it stopped when blocked. */
function DshGoalRow({ goal }: { goal: DshGoal }) {
  useLocale();
  const rounds =
    goal.maxGoalRounds === undefined
      ? t("panel.tasks.rounds", { n: goal.roundsStarted })
      : t("panel.tasks.roundsOf", { n: goal.roundsStarted, max: goal.maxGoalRounds });
  return (
    <div
      data-omc-dsh-goal={goal.phase}
      style={{ padding: "4px 0", fontSize: 12, lineHeight: "1.5" }}
    >
      <div>
        <span style={{ color: goal.phase === "blocked" ? T.err : T.muted }}>
          {phaseLabel(goal.phase)}
        </span>{" "}
        · {goal.objective}
      </div>
      <div style={{ ...meta, fontSize: 11 }}>
        {rounds} · {t("panel.tasks.updated", { ago: ago(goal.updatedAt) })}
      </div>
      {goal.blockedReason ? (
        <div style={{ color: T.err, fontSize: 11, whiteSpace: "normal" }}>{goal.blockedReason}</div>
      ) : null}
    </div>
  );
}

/** Error from GET /scheduled-tasks. */
interface ScheduledTasksError {
  ok: false;
  error: string;
}

/** One scheduled task, the same row whether it survives a restart or not. */
function TaskRow({ task }: { task: Task }) {
  useLocale();
  return (
    <div style={{ ...nested, padding: "4px 0 4px 12px", fontSize: 12, lineHeight: "1.5" }}>
      <div style={{ fontWeight: 600 }}>{task.name}</div>
      {task.description ? <div style={{ ...meta, fontSize: 11 }}>{task.description}</div> : null}
      {task.schedule ? (
        <div style={{ ...meta, fontSize: 11 }}>
          {t("panel.tasks.schedule", { schedule: task.schedule })}
        </div>
      ) : null}
      {task.nextRunAt === undefined ? null : (
        <div style={{ ...meta, fontSize: 11 }}>
          {t("panel.tasks.nextRun", { date: new Date(task.nextRunAt).toLocaleString() })}
        </div>
      )}
    </div>
  );
}

/** An earlier dsh goal as one line (phase, objective cut to fit, age) that opens on a click to
 *  the full row, so a session with many past goals stays a short list. */
function PastGoalRow({ goal }: { goal: DshGoal }) {
  useLocale();
  const [open, setOpen] = useState(false);
  return (
    <div data-omc-dsh-goal-past={goal.phase}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "3px 0",
          background: "none",
          border: "none",
          font: "inherit",
          fontSize: 12,
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ color: T.faint, flex: "0 0 auto" }}>{open ? "▾" : "▸"}</span>
        <span style={{ color: goal.phase === "blocked" ? T.err : T.muted, flex: "0 0 auto" }}>
          {phaseLabel(goal.phase)}
        </span>
        <span
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {goal.objective}
        </span>
        <span style={{ ...meta, flex: "0 0 auto" }}>{ago(goal.updatedAt)}</span>
      </button>
      {open ? (
        <div style={{ ...nested, margin: "0 0 4px 3px", fontSize: 12, lineHeight: "1.5" }}>
          <div style={{ whiteSpace: "normal" }}>{goal.objective}</div>
          <div style={{ ...meta, fontSize: 11 }}>
            {goal.maxGoalRounds === undefined
              ? t("panel.tasks.rounds", { n: goal.roundsStarted })
              : t("panel.tasks.roundsOf", { n: goal.roundsStarted, max: goal.maxGoalRounds })}
          </div>
          {goal.blockedReason ? (
            <div style={{ color: T.err, fontSize: 11, whiteSpace: "normal" }}>
              {goal.blockedReason}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Both goals and the scheduled tasks, each section only when it has something: dsh's goal and its
 *  past ones from dsh's own log, the CLI's goal from its transcript, then the tasks. Read-only;
 *  dsh's goal is changed from dsh's own controls. With nothing at all, one line says so. */
function TasksBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const [data, setData] = useState<ScheduledTasksReply | ScheduledTasksError | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

  useEffect(() => {
    // dsh's goal is there with or without a running CLI; the CLI's half is empty without one.
    let live = true;
    fetch(
      `${ROUTE}/scheduled-tasks?session=${encodeURIComponent(sessionId)}${boxParam(ctx, sessionId)}`,
    )
      .then((r) => readJson<ScheduledTasksReply | ScheduledTasksError>(r))
      .then((b) => live && setData(b))
      .catch((e: Error) => live && setData({ ok: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [sessionId]);

  const dshGoals = data?.ok ? data.dshGoals : [];
  const current =
    dshGoals[0] && ["active", "paused", "blocked"].includes(dshGoals[0].phase)
      ? dshGoals[0]
      : undefined;
  const past = current ? dshGoals.slice(1) : dshGoals;

  return (
    <div style={bodyFlow}>
      {data === null ? (
        <span style={stateText}>{t("loading")}</span>
      ) : !data.ok ? (
        <span style={errText}>{data.error}</span>
      ) : (
        <>
          {dshGoals.length === 0 &&
          !data.goal &&
          data.durable.length === 0 &&
          data.session.length === 0 ? (
            <span data-omc-tasks-empty="" style={stateText}>
              {t("panel.tasks.empty")}
            </span>
          ) : null}
          {dshGoals.length > 0 ? <span style={sectionHead}>{t("panel.tasks.dshGoal")}</span> : null}
          {current ? (
            <DshGoalRow goal={current} />
          ) : dshGoals.length > 0 ? (
            <div style={{ ...meta, padding: "4px 0", fontSize: 12 }}>
              {t("panel.tasks.noGoalRunning")}
            </div>
          ) : null}
          {past.length > 0 ? (
            <div data-omc-dsh-goals-past="">
              <button
                type="button"
                aria-expanded={pastOpen}
                onClick={() => setPastOpen((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px 0",
                  font: "inherit",
                  fontSize: 12,
                  color: T.muted,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {`${pastOpen ? "▾" : "▸"}\u00a0${t("panel.tasks.pastGoals")}`}
                <span style={meta}> · {past.length}</span>
              </button>
              {pastOpen && past.map((g) => <PastGoalRow key={g.id} goal={g} />)}
            </div>
          ) : null}

          {/* The CLI's own /goal: rarely set from dsh, so the section only appears when it is. */}
          {data.goal ? (
            <>
              <span style={sectionHead}>{t("panel.tasks.cliGoal")}</span>
              <div
                data-omc-cli-goal=""
                style={{ padding: "4px 0", fontSize: 12, lineHeight: "1.5" }}
              >
                <div style={{ marginBottom: 4 }}>{data.goal.text}</div>
                <div style={{ ...meta, fontSize: 11 }}>
                  {t("panel.tasks.proposed", { ago: ago(data.goal.at) })}
                </div>
              </div>
            </>
          ) : null}

          {/* Like the CLI goal, the tasks only take room when there are some. */}
          {data.durable.length > 0 ? (
            <>
              <span style={sectionHead}>{t("panel.tasks.durable")}</span>
              {data.durable.map((task) => (
                <TaskRow key={task.name} task={task} />
              ))}
              <div style={{ ...meta, padding: "2px 0", fontSize: 11, fontFamily: T.mono }}>
                {data.path}
              </div>
            </>
          ) : null}

          {data.session.length > 0 ? (
            <>
              <span style={sectionHead}>{t("panel.tasks.sessionOnly")}</span>
              {data.session.map((task) => (
                <TaskRow key={task.name} task={task} />
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Common remote MCP connectors, to pre-fill the Add form. A preset is just name, transport and URL
 * feeding the path that already works; the user finishes OAuth in a terminal, which the needs-auth
 * row already instructs. URLs verified against code.claude.com/docs/en/mcp (2026-09-07).
 */
const CONNECTORS: readonly { label: string; name: string; transport: string; url: string }[] = [
  { label: "GitHub", name: "github", transport: "http", url: "https://api.githubcopilot.com/mcp/" },
  { label: "Notion", name: "notion", transport: "http", url: "https://mcp.notion.com/mcp" },
  { label: "Sentry", name: "sentry", transport: "http", url: "https://mcp.sentry.dev/mcp" },
  { label: "Slack", name: "slack", transport: "http", url: "https://mcp.slack.com/mcp" },
  { label: "Stripe", name: "stripe", transport: "http", url: "https://mcp.stripe.com" },
  { label: "Asana", name: "asana", transport: "sse", url: "https://mcp.asana.com/sse" },
  {
    label: "HubSpot",
    name: "hubspot",
    transport: "http",
    url: "https://mcp.hubspot.com/anthropic",
  },
];

/** A full-width field of the add form, in the settings field look the rest of the panel uses. */
const MCP_FIELD: CSSProperties = { ...inputStyle, flex: "none", width: "100%", marginBottom: 4 };
/** The form's multi-line fields: the same box, two lines tall, padded on every side. */
const MCP_AREA: CSSProperties = {
  ...MCP_FIELD,
  height: 56,
  padding: "6px 12px",
  resize: "vertical",
};

/** The Add form under the server list: name, where it goes, and the fields its transport needs. */
function McpAddForm({
  sessionId,
  ctx,
  onAdded,
}: {
  sessionId: string;
  ctx: ClientCtx;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState("local");
  const [transport, setTransport] = useState("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connector, setConnector] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await readJson<{ ok: boolean; error?: string }>(
        await fetch(`${ROUTE}/mcp-servers/add${boxQuery(ctx, sessionId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The server reads the directory from the session, so `local` and `project` land in the
          // project this session is open in rather than wherever dsh itself was started.
          body: JSON.stringify({
            session: sessionId,
            name,
            scope,
            transport,
            command,
            args,
            env,
            url,
            headers,
          }),
        }),
      );
      if (!r.ok) return setError(r.error ?? t("panel.mcp.addFailed"));
      setName("");
      setCommand("");
      setArgs("");
      setEnv("");
      setUrl("");
      setHeaders("");
      setConnector("");
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fillFromConnector = (picked: string) => {
    setConnector(picked);
    const c = CONNECTORS.find((x) => x.name === picked);
    if (!c) return;
    setName(c.name);
    setTransport(c.transport);
    setUrl(c.url);
  };

  return (
    <div style={{ padding: 8, marginTop: 8, border: `1px solid ${T.border}`, borderRadius: 8 }}>
      <select
        data-omc-mcp-connector=""
        aria-label={t("panel.mcp.connectorLabel")}
        value={connector}
        onChange={(e) => fillFromConnector(e.currentTarget.value)}
        disabled={busy}
        style={{ ...select, width: "100%", maxWidth: "none", marginBottom: 8 }}
      >
        <option value="">{t("panel.mcp.commonConnector")}</option>
        {CONNECTORS.map((c) => (
          <option key={c.name} value={c.name}>
            {c.label}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          placeholder={t("panel.mcp.serverName")}
          aria-label={t("panel.mcp.serverName")}
          data-omc-mcp-server-name=""
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={busy}
          // minWidth:0 lets the input shrink below its content so the two selects stay on the row
          // instead of overflowing the panel's narrow column; flexWrap drops them under it when tight.
          style={{ ...inputStyle, minWidth: 120 }}
        />
        <select
          data-omc-mcp-scope=""
          aria-label={t("panel.mcp.scopeLabel")}
          value={scope}
          onChange={(e) => setScope(e.currentTarget.value)}
          disabled={busy}
          style={select}
        >
          <option value="local">{t("panel.scope.local")}</option>
          <option value="user">{t("panel.scope.user")}</option>
          <option value="project">{t("panel.scope.project")}</option>
        </select>
        <select
          data-omc-mcp-transport=""
          aria-label={t("panel.mcp.transportLabel")}
          value={transport}
          onChange={(e) => setTransport(e.currentTarget.value)}
          disabled={busy}
          style={select}
        >
          <option value="stdio">Stdio</option>
          <option value="sse">SSE</option>
          <option value="http">HTTP</option>
        </select>
      </div>
      {transport === "stdio" ? (
        <>
          <input
            type="text"
            placeholder={t("panel.mcp.commandPlaceholder")}
            aria-label={t("panel.mcp.commandLabel")}
            data-omc-mcp-command=""
            value={command}
            onChange={(e) => setCommand(e.currentTarget.value)}
            disabled={busy}
            style={MCP_FIELD}
          />
          <textarea
            data-omc-mcp-add-args=""
            aria-label={t("panel.mcp.argsLabel")}
            placeholder={t("panel.mcp.argsPlaceholder")}
            value={args}
            onChange={(e) => setArgs(e.currentTarget.value)}
            disabled={busy}
            style={MCP_AREA}
          />
          <textarea
            data-omc-mcp-env=""
            aria-label={t("panel.mcp.envLabel")}
            placeholder={t("panel.mcp.envPlaceholder")}
            value={env}
            onChange={(e) => setEnv(e.currentTarget.value)}
            disabled={busy}
            style={MCP_AREA}
          />
        </>
      ) : (
        <>
          <input
            type="text"
            placeholder={t("panel.mcp.urlPlaceholder")}
            aria-label={t("panel.mcp.urlLabel")}
            data-omc-mcp-url=""
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            disabled={busy}
            style={MCP_FIELD}
          />
          <textarea
            data-omc-mcp-headers=""
            aria-label={t("panel.mcp.headersLabel")}
            placeholder={t("panel.mcp.headersPlaceholder")}
            value={headers}
            onChange={(e) => setHeaders(e.currentTarget.value)}
            disabled={busy}
            style={MCP_AREA}
          />
        </>
      )}
      <button type="button" style={btnPrimary} disabled={busy || !name} onClick={submit}>
        {busy ? t("panel.mcp.adding") : t("panel.add")}
      </button>
      {error && <span style={{ ...meta, display: "block", marginTop: 4 }}>{error}</span>}
    </div>
  );
}

/** The mode to show for a session: the process's own when one runs, else the one the next spawn gets. */
const shownMode = (snap: PermissionModeState): string => snap.liveMode ?? snap.mode;
/** The stored mode when it differs from the running process's, else empty: what the footer notes. */
const pendingMode = (snap: PermissionModeState): string =>
  snap.liveMode && snap.liveMode !== snap.mode ? snap.mode : "";
/** What `GET /permissions` reports: the rules and hooks the session's live process loaded. */
/** What `GET /permissions` returns on success. A failure answers 409, which `readJson` throws, so
 *  the failed arm never reaches state: the reason lands in `permissionsError` instead. */
type PermissionsReply = { ok: true } & PermissionRules & HooksListing;

// The three dsh presets in strict id→label order (kept for text-fallback trigger lookup), each with
// every label dsh draws it under: English and dsh's own Chinese (ui-permission-presets). The menu
// is dsh's, so its rows read in dsh's language; matching the English alone left a Chinese dsh with
// its three presets and none of the six Claude rows.
const PRESETS = [
  { id: "read-only", labels: ["Read Only", "仅可查看"] },
  { id: "workspace-write", labels: ["Workspace Write", "工作区内修改"] },
  { id: "danger-full-access", labels: ["Full access", "完全权限"] },
] as const;

/** The preset a dsh menu row or trigger names, by its text in either language; undefined for any
 *  other text. */
const presetOfText = (text: string | null): (typeof PRESETS)[number] | undefined =>
  PRESETS.find((p) => p.labels.some((label) => label === text));

// Claude mode → dsh preset it needs.
const PRESET_FOR_MODE = {
  plan: "read-only",
  default: "workspace-write",
  acceptEdits: "workspace-write",
  auto: "danger-full-access",
  dontAsk: "danger-full-access",
  bypassPermissions: "danger-full-access",
} satisfies Record<string, string>;

// The six Claude mode rows and the trigger, in key order; their labels come from
// `panel.access.mode.<mode>` at build time so the menu reads in the active language.
const MODE_KEYS = [
  "plan",
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
] as const;

// Narrowed indexers so callers can use arbitrary strings without widening the object type.
/** The dsh permission preset that matches a Claude mode. */
const presetForMode = (m: string): string =>
  // SAFETY: PRESET_FOR_MODE has exactly the six Claude modes as keys; all paths below pass a known key.
  PRESET_FOR_MODE[m as keyof typeof PRESET_FOR_MODE];
/** The glyph dsh draws for a preset in its own permission menu, keyed the way `PRESET_FOR_MODE`
 *  names them; a Claude mode shows the glyph of the preset it maps to, so the six rows read like
 *  dsh's three. Draws nothing for an unknown mode (the empty string before the first fetch). */
const ModeGlyph = ({ mode }: { mode: string }) => {
  // SAFETY: widening the readonly tuple to string[] only loosens `includes`; the membership check
  // is what makes `presetForMode` safe to call with an arbitrary string.
  const preset = (MODE_KEYS as readonly string[]).includes(mode) ? presetForMode(mode) : "";
  if (preset === "read-only") return <PermissionIconReadOnlyRegular aria-hidden />;
  if (preset === "workspace-write") return <PermissionIconWorkspaceWriteRegular aria-hidden />;
  if (preset === "danger-full-access") return <PermissionIconFullAccessRegular aria-hidden />;
  return null;
};
/** How a Claude mode is labelled in the menu, translated; a mode not in `MODE_KEYS` shows raw. */
const modeLabel = (m: string): string =>
  // SAFETY: the membership check guarantees `panel.access.mode.<m>` is a defined dictionary key.
  (MODE_KEYS as readonly string[]).includes(m) ? t(`panel.access.mode.${m}` as OmcKey) : m;

/**
 * Imperative rework: relabels dsh's own trigger and injects Claude-mode rows into its menu.
 * The component only mounts a hidden span; all DOM work happens inside useEffect.
 */
export function AccessShield({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Not a Claude session right now: stay dormant, but keep watching, since the model picker can
    // switch a session's provider without a remount (owner, 2026-09-06: the rows stayed after a
    // model change).
    const mine = () => activeClaudeSession(ctx) === sessionId;

    const build = () => {
      // The composer this shield belongs to, never the whole page. dsh 0.1.7 draws the same
      // permission control in Settings > General, and the text fallback below matched it: the
      // shield adopted that trigger and rewrote its label with the session's CLI mode, so the
      // Settings row read "Full access" whatever the menu had checked (owner, 2026-09-22).
      const anchor = anchorRef.current;
      const root =
        anchor?.closest("form") ??
        anchor?.closest('[data-composer-card], [class*="composer" i]') ??
        anchor?.parentElement;
      if (!root) return null;
      // SAFETY: querySelectorAll returns NodeList; we cast because the selector is exact.
      const found = Array.from(
        root.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Access mode"], button[aria-label^="访问模式"]',
        ),
      );
      const trigger =
        found[0] ??
        Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.closest('[role="dialog"]') === null && presetOfText(b.textContent) !== undefined,
        );
      if (!trigger) return null;
      return trigger;
    };

    // Everything below hangs off dsh's trigger: hide it, mirror it, and hand back one cleanup.
    const start = (trigger: HTMLButtonElement): (() => void) => {
      let currentMode = "";
      // A settings file can refuse bypass mode while this trigger still reads "Full access". The
      // scope it is refused in, once known, marks the label and the menu row.
      let bypassRefusedIn = "";
      const labelSpan = (): HTMLElement | null => {
        for (const child of Array.from(trigger.children))
          if (child instanceof HTMLElement && child.className.includes("Label")) return child;
        return trigger.children[1] instanceof HTMLElement ? trigger.children[1] : null;
      };
      // dsh's own label and aria-label, kept for the cleanup; refreshed whenever dsh rewrites them.
      let lastDshLabelText = labelSpan()?.textContent ?? "";
      let lastDshAriaLabel = trigger.getAttribute("aria-label") ?? "";

      // Apply our Claude-mode label to the trigger's label span and aria-label. Compares against
      // the DOM, so our own write is a no-op and a rewrite by dsh is overwritten again.
      const reapplyLabel = () => {
        if (!trigger.isConnected || !currentMode) return;
        const refused = bypassRefusedIn !== "" && currentMode === "bypassPermissions";
        const text = `${modeLabel(currentMode)}${refused ? " ⚠" : ""}`;
        const target = labelSpan();
        if (target && target.textContent !== text) {
          lastDshLabelText = target.textContent ?? "";
          target.textContent = text;
        }
        const newAria = t("panel.access.ariaLabel", {
          text,
          refused: refused ? t("panel.access.ariaRefused") : "",
        });
        const aria = trigger.getAttribute("aria-label") ?? "";
        if (aria !== newAria) {
          lastDshAriaLabel = aria;
          trigger.setAttribute("aria-label", newAria);
        }
      };

      // Observe dsh rewriting the trigger so we re-apply our label whenever it does.
      const labelObserver = new MutationObserver(() => {
        if (trigger.isConnected) reapplyLabel();
      });
      // SAFETY: DOM MutationObserverInit.attributes accepts boolean; TS 7 lib narrows the
      // modern string[] variant to boolean only. We observe all attributes (true) rather than
      // filtering to aria-label alone because the narrower form is not expressible in this TS lib.
      labelObserver.observe(trigger, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });

      // Fetch the current mode on start so the trigger label is correct immediately.
      const fetchMode = (): Promise<PermissionModeState | null> =>
        fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`)
          .then((r) => readJson<PermissionModeState>(r))
          .catch(() => null);

      fetchMode().then((snap) => {
        if (snap) {
          currentMode = shownMode(snap);
          reapplyLabel();
        }
      });

      // Which settings file, if any, refuses bypass mode. A failed read leaves the label alone.
      const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
      fetch(`${ROUTE}/feature-switches${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`)
        .then((r) => readJson<FeatureSwitches>(r))
        .then((s) => {
          bypassRefusedIn = s.bypassDisabled?.scope ?? "";
          reapplyLabel();
        })
        .catch(() => {});

      const parent = trigger.parentElement;
      if (!parent)
        return () => {
          labelObserver.disconnect();
        };

      // Watch for dsh's menu to appear and inject our rows into its viewport.
      const menuObserver = new MutationObserver(() => {
        if (!parent.isConnected) return;
        // The open menu is the signal, not the trigger: dsh 0.1.5 stopped setting aria-expanded on
        // it, so gating on that attribute skipped every injection and left dsh's three presets in
        // place of our six Claude rows. `parent` is the small modes box, not the composer, so one
        // selector per mutation costs nothing.
        //
        // Both places dsh can put the open menu: inline under the trigger, or as a direct child
        // of the body from 0.1.6, which renders it through `createPortal(menu, document.body)`.
        // Looking in one place only left 0.1.6 showing dsh's three presets. Body is searched one
        // level deep, never by subtree: the portalled node is the menu itself, and a subtree scan
        // of the body per mutation is the whole transcript. Menus other plugins portal there are
        // dropped by the preset-label check below, which is what identifies ours either way.
        // Only the composer's own menu. dsh 0.1.7 draws the same permission control in Settings >
        // General and portals its menu to the body with the same three preset labels, so the
        // label check alone adopted that one too: the six Claude rows landed in the Settings
        // dropdown and its pick never showed (owner, 2026-09-22). A trigger that says it is
        // closed has no menu of its own open (0.1.5 sets no such attribute, and an absent one
        // says nothing), and a dsh modal dialog on screen means the composer is behind it.
        if (trigger.getAttribute("aria-expanded") === "false") return;
        if (
          document.querySelector(
            '[role="dialog"][aria-modal="true"]:not([aria-label="Oh My Claude"])',
          ) !== null
        )
          return;
        const menus = [
          // dsh 0.1.5: inline, hung off the trigger inside the modes box.
          ...parent.querySelectorAll<HTMLElement>('[role="menu"]'),
          // dsh 0.1.6 and later: portalled, a direct child of the body.
          ...document.body.querySelectorAll<HTMLElement>(':scope > [role="menu"]'),
        ];
        if (menus.length === 0) return;
        for (const dshMenu of menus) {
          // Our own rows, not the attribute, say whether this menu is done: dsh re-renders the menu
          // through the same element, which drops the six rows we appended and unhides its three
          // while leaving every attribute we set in place. Trusting the mark there left the menu
          // showing dsh's presets with no way back to ours until it was closed and reopened.
          if (dshMenu.querySelector("[data-mode]")) continue;
          const menuItems = Array.from(dshMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
          const hasPreset = menuItems.some((el) => presetOfText(el.textContent) !== undefined);
          if (!hasPreset) continue;

          dshMenu.setAttribute("data-dsh-oh-my-claude", "1");
          // dsh re-renders the open menu through the same element, which drops our rows. Inline
          // that lands in `parent`; portalled it lands in the body, where only direct children are
          // watched, so the menu itself is the target that sees it. Re-observing the same node is
          // a no-op, and the `[data-mode]` check above stops our own appends looping back.
          menuObserver.observe(dshMenu, { childList: true, subtree: true });

          // Take template from the first itemWrap (parent of the first menuitem).
          const firstItemWrap = menuItems[0]?.parentElement;
          if (!firstItemWrap) continue;

          // Find the token containing "selected" across all three original menuitems.
          let selectedToken = "";
          // dsh marks the selected row with a class token and a trailing check svg; both are copied
          // onto our selected clone only.
          let checkMark: Element | null = null;
          for (const el of menuItems) {
            const tokens = el.className.split(" ");
            const found = tokens.find((tok) => tok.includes("selected"));
            if (found) {
              selectedToken = found;
              checkMark = el.querySelector(":scope > svg");
              break;
            }
          }
          // SAFETY: firstItemWrap exists only when menuItems[0] exists; checked above.
          const baseClass = selectedToken
            ? menuItems[0]!.className
                .split(" ")
                .filter((tok) => tok !== selectedToken)
                .join(" ")
            : menuItems[0]!.className;

          // Record each original row's icon svg keyed by preset id via labels.
          const svgByPresetId: Record<string, string> = {};
          for (const el of menuItems) {
            const svgEl = el.querySelector<SVGSVGElement>("svg");
            if (!svgEl) continue;
            const presetId = presetOfText(el.textContent)?.id;
            if (presetId) svgByPresetId[presetId] = svgEl.outerHTML;
          }

          // Hide the three original wraps.
          for (const wrap of dshMenu.querySelectorAll<HTMLElement>("[class*='itemWrap']")) {
            wrap.style.display = "none";
          }

          // Find the viewport to append our rows into.
          const viewport = dshMenu.querySelector<HTMLElement>('[role="presentation"]') ?? dshMenu;

          // Capture stateSnapshot for click handlers.
          let stateSnapshot: PermissionModeState | null = null;
          fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`)
            .then((r) => readJson<PermissionModeState>(r))
            .then((snap) => {
              stateSnapshot = snap;
            })
            .catch(() => {
              /* ignore */
            });

          // Append six new wraps in MODE_KEYS order.
          for (const m of MODE_KEYS) {
            // SAFETY: cloneNode on a HTMLElement returns a Node tree rooted at that element.
            const wrap = firstItemWrap.cloneNode(true) as HTMLElement;
            wrap.style.display = ""; // the template was hidden before cloning
            const menuitem = wrap.querySelector<HTMLElement>("button[role='menuitem']");
            if (!menuitem) continue;

            menuitem.className =
              m === currentMode && selectedToken ? `${baseClass} ${selectedToken}` : baseClass;
            menuitem.setAttribute("aria-checked", m === currentMode ? "true" : "false");
            for (const inherited of menuitem.querySelectorAll(":scope > svg")) inherited.remove();
            if (m === currentMode && checkMark) menuitem.append(checkMark.cloneNode(true));

            // SAFETY: PRESET_FOR_MODE has exactly the six Claude modes as keys.
            const presetId = PRESET_FOR_MODE[m as keyof typeof PRESET_FOR_MODE];
            const iconSpan = menuitem.querySelector<HTMLElement>("span[class*='Icon']");
            if (iconSpan && svgByPresetId[presetId]) {
              iconSpan.innerHTML = svgByPresetId[presetId];
            }

            // Replace the label text node or span with MODE_LABELS[m].
            const labelChild = Array.from(menuitem.children).find(
              (c) => c instanceof HTMLElement && c.className.includes("Label"),
            );
            if (labelChild instanceof HTMLElement) {
              labelChild.textContent = modeLabel(m);
            } else {
              const textNode = Array.from(menuitem.childNodes).find(
                (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
              );
              if (textNode instanceof Text) textNode.textContent = modeLabel(m);
            }

            menuitem.setAttribute("data-mode", m);
            menuitem.addEventListener("click", () => {
              // The snapshot fetched at open may still be in flight on a fast click: fetch then.
              (stateSnapshot ? Promise.resolve(stateSnapshot) : fetchMode()).then((snap) => {
                if (!snap) return;
                stateSnapshot = snap;
                pick(snap);
              });
            });
            const pick = (snap: PermissionModeState) => {
              const need = presetForMode(m);
              const have = snap.accessMode;
              // The label takes the pick at once. What follows is a dsh command, a settle and two
              // more round trips, over a second in all, and the trigger used to sit on the old mode
              // for every bit of it, which reads as a click that did not land. A failure below puts
              // the real mode back.
              const wasMode = currentMode;
              currentMode = m;
              reapplyLabel();
              const revert = () => {
                currentMode = wasMode;
                reapplyLabel();
              };
              const doSet = () => {
                const clearDefault =
                  (need === "read-only" && m === "plan") ||
                  (need === "workspace-write" && m === "acceptEdits") ||
                  (need === "danger-full-access" && m === "bypassPermissions");
                fetch(`${ROUTE}/permission-mode`, {
                  method: "PUT",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ session: sessionId, mode: clearDefault ? null : m }),
                })
                  .then((r) => readJson<PermissionModeState>(r))
                  .then((reply) => {
                    if (reply.error) {
                      revert();
                      const errEl = parent.querySelector<HTMLElement>("[data-err]");
                      if (errEl) errEl.textContent = reply.error;
                    } else {
                      fetchMode().then((next) => {
                        if (next) currentMode = shownMode(next);
                        reapplyLabel();
                      });
                    }
                  })
                  .catch((e) => {
                    revert();
                    const errEl = parent.querySelector<HTMLElement>("[data-err]");
                    if (errEl) errEl.textContent = e instanceof Error ? e.message : String(e);
                  });
              };
              if (need !== have) {
                const live = ctx.sessions.binding?.(sessionId)?.session;
                if (!live) {
                  revert();
                  const errEl = parent.querySelector<HTMLElement>("[data-err]");
                  if (errEl) errEl.textContent = t("panel.access.notMaterialized");
                  return;
                }
                live
                  .command(`/permission ${need}`)
                  .then((reply) => {
                    if (!reply || !reply.ok) {
                      revert();
                      const errEl = parent.querySelector<HTMLElement>("[data-err]");
                      if (errEl)
                        errEl.textContent =
                          reply?.error?.message ?? t("panel.access.commandFailed");
                    } else {
                      setTimeout(doSet, 700);
                    }
                  })
                  .catch((e) => {
                    revert();
                    const errEl = parent.querySelector<HTMLElement>("[data-err]");
                    if (errEl) errEl.textContent = e instanceof Error ? e.message : String(e);
                  });
              } else {
                doSet();
              }
              document.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              );
            };

            viewport.appendChild(wrap);
          }

          // Why the Full access row will not take, on the menu that offers it.
          if (bypassRefusedIn !== "") {
            const note = document.createElement("div");
            Object.assign(note.style, { ...meta, color: T.err, padding: "8px 10px" });
            note.textContent = t("panel.access.fullAccessRefused", { scope: bypassRefusedIn });
            viewport.appendChild(note);
          }

          // Error wrap at the bottom. Padding lives in a class so an empty slot collapses via
          // `:empty` (no leftover space under the last row) and returns the instant an error lands.
          if (!document.getElementById("omc-access-err-style")) {
            const st = document.createElement("style");
            st.id = "omc-access-err-style";
            st.textContent = ".omc-access-err{padding:8px 10px}.omc-access-err:empty{padding:0}";
            document.head.appendChild(st);
          }
          const errWrap = document.createElement("div");
          errWrap.setAttribute("data-err", "1");
          errWrap.className = "omc-access-err";
          Object.assign(errWrap.style, { ...meta, color: T.err });
          viewport.appendChild(errWrap);

          // A portalled menu is positioned from JavaScript: dsh measures its height once, on open,
          // and clamps `top` so the box sits inside a 12px margin. Six rows where it measured three
          // left the menu starting at the three-row position and running off the bottom of the
          // window, and its own max-height caps the height without moving a box that starts too
          // low. Scroll and resize are the two events that recompute it, so one resize hands the
          // job back to dsh's own maths instead of a second copy of it here. dsh 0.1.5 hangs the
          // menu inline off the trigger and positions it in CSS, where a taller menu already grows
          // the right way, so the event is only worth the other listeners it wakes when the menu
          // is the portalled kind.
          if (dshMenu.parentElement === document.body) {
            window.dispatchEvent(new Event("resize"));
          }
        }
      });
      menuObserver.observe(parent, { childList: true, subtree: true });
      menuObserver.observe(document.body, { childList: true });

      return () => {
        labelObserver.disconnect();
        menuObserver.disconnect();
        // Restore trigger's label text and aria-label to what dsh last rendered.
        // Give dsh back its own label and aria-label.
        const restoreTarget = labelSpan();
        if (restoreTarget && lastDshLabelText) restoreTarget.textContent = lastDshLabelText;
        if (lastDshAriaLabel) trigger.setAttribute("aria-label", lastDshAriaLabel);
        // If a marked menu is currently open, unhide original wraps and remove ours. Both places
        // are checked for the same reason the injection above checks both, and in the same order.
        const markedMenu =
          // dsh 0.1.5: inline.
          parent.querySelector<HTMLElement>('[role="menu"][data-dsh-oh-my-claude]') ??
          // dsh 0.1.6 and later: portalled to the body.
          document.body.querySelector<HTMLElement>(':scope > [role="menu"][data-dsh-oh-my-claude]');
        if (markedMenu) {
          const vp = markedMenu.querySelector<HTMLElement>('[role="presentation"]') ?? markedMenu;
          for (const wrap of vp.querySelectorAll<HTMLElement>("[class*='itemWrap']")) {
            if (wrap.hasAttribute("data-mode")) {
              wrap.remove();
            } else {
              wrap.style.display = "";
            }
          }
          const errEl = vp.querySelector<HTMLElement>("[data-err]");
          if (errEl) errEl.remove();
        }
      };
    };

    // The composer may render after us: try now, then every 500 ms for 20 s.
    let stop: (() => void) | undefined;
    let hidden: HTMLButtonElement | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const attempt = () => {
      const found = build();
      if (!found) return false;
      hidden = found;
      stop = start(found);
      return true;
    };
    if (mine() && !attempt()) {
      let attempts = 0;
      timer = setInterval(() => {
        attempts++;
        if (!mine() || attempt() || attempts >= 40) clearInterval(timer);
      }, 500);
    }
    // Every second: leave when the session stops being Claude's, come back when it is again, and
    // re-attach when dsh re-rendered its trigger (the node we hooked left the document).
    const watchdog = setInterval(() => {
      const claude = mine();
      if (stop && (!claude || !hidden?.isConnected)) {
        stop();
        stop = undefined;
      }
      if (!stop && claude) attempt();
    }, 1000);
    return () => {
      if (timer) clearInterval(timer);
      clearInterval(watchdog);
      stop?.();
    };
  }, [sessionId, ctx]);

  return <span ref={anchorRef} hidden />;
}

// dsh's own permission trigger, copied so the new control reads as dsh's in the composer: a 28 px
// capsule, transparent at rest, its hover shade under the pointer and a 2 px focus ring. The hashed
// class is a build rename, so the rule is injected once and keyed on our own hook.
const ACCESS_TRIGGER_CSS =
  "[data-omc-access-trigger]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
  "[data-omc-access-trigger]:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}" +
  // dsh's `.triggerIcon svg`: the capsule's glyph is 14 px, like the glyph cell in its menu rows.
  "[data-omc-access-trigger]>span:first-child svg{width:14px;height:14px}" +
  // On a phone the composer's action row has no room for the full mode name: the capsule takes
  // a third of the page at most and its label ends in an ellipsis, so the row stays one line
  // instead of breaking under the chevron (owner, 2026-09-23). The open menu is dsh's portal and
  // keeps its own width.
  "[data-omc-access-trigger]{max-width:220px}" +
  "@media (max-width:600px){[data-omc-access-trigger]{max-width:32vw}}";

/**
 * Read the session's permission mode, or null when the route is down or the session is not
 * materialized. The optimistic pick and the current-mode label both start here, and the pick's
 * success arm re-reads it to confirm the change.
 */
const fetchModeState = (sessionId: string): Promise<PermissionModeState | null> =>
  fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`)
    .then((r) => readJson<PermissionModeState>(r))
    .catch(() => null);

/** Inject the trigger's hover/focus rule once, so a hot reload's stale copy never survives. */
const ensureAccessTriggerStyle = (): void => {
  const existing = document.getElementById("dsh-oh-my-claude-access-trigger");
  if (existing) return;
  const el = document.createElement("style");
  el.id = "dsh-oh-my-claude-access-trigger";
  el.textContent = ACCESS_TRIGGER_CSS;
  document.head.appendChild(el);
};

/** The capsule the composer's permission control wears at rest: dsh's trigger shape, our hook. */
const accessTriggerStyle: CSSProperties = {
  minWidth: 0,
  // The max width lives in ACCESS_TRIGGER_CSS, where the phone rule can override it.
  height: 28,
  color: "var(--dsw-alias-label-secondary)",
  cursor: "pointer",
  background: "transparent",
  border: "none",
  borderRadius: 24,
  outline: "none",
  alignItems: "center",
  gap: 4,
  padding: "0 4px 0 8px",
  fontSize: 13,
  fontWeight: 500,
  lineHeight: "20px",
  display: "inline-flex",
};

/**
 * The permission control that owns dsh's composer permission slot (`conversation.input.permission`)
 * in a Claude session: a capsule showing the current Claude mode, opening a menu of the six modes.
 * It replaces the DOM-mutating AccessShield by rendering the trigger and menu directly, so it reads
 * the same on every dsh and needs no selector. Registration is gated on the current session being
 * Claude (see index.tsx), because the slot is a single cell and would otherwise shadow dsh's control
 * in a non-Claude session too.
 */
export function AccessTrigger({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const [open, setOpen] = useState(false);
  // The mode the session's process runs in (or will spawn in), from GET /permission-mode; empty
  // until the first fetch lands.
  const [mode, setMode] = useState("");
  // The stored mode the next turn will spawn in when the running process could not take it live.
  const [pending, setPending] = useState("");
  // The scope whose permissions.disableBypassPermissionsMode refused bypass, empty when allowed;
  // marks the bypass row and the trigger, and drives the full-access note.
  const [bypassRefusedIn, setBypassRefusedIn] = useState("");
  // The last pick's failure text, shown in the menu body; cleared on the next success.
  const [error, setError] = useState<string | null>(null);
  ensureAccessTriggerStyle();

  // Read the current mode and the bypass ceiling once, so the capsule and menu show the truth before
  // any pick. The session is fixed while this mounts, so the cwd does not change.
  useEffect(() => {
    let live = true;
    fetchModeState(sessionId).then((snap) => {
      if (!live || !snap) return;
      setMode(shownMode(snap));
      setPending(pendingMode(snap));
    });
    const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
    fetch(`${ROUTE}/feature-switches${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`)
      .then((r) => readJson<FeatureSwitches>(r))
      .then((s) => {
        if (live) setBypassRefusedIn(s.bypassDisabled?.scope ?? "");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sessionId, ctx]);

  // A deferred pick lands when the next turn respawns the process, which this component cannot
  // see; the respawn's mode arrives as a permission-mode event, and so does every pick made from
  // another tab. One read when the note first shows covers a stream that is down.
  useEffect(() => {
    const off = subscribe("permission-mode", (session, data) => {
      if (session !== sessionId) return;
      setMode(shownMode(data));
      setPending(pendingMode(data));
    });
    return off;
  }, [sessionId]);
  useEffect(() => {
    if (!pending) return;
    let live = true;
    fetchModeState(sessionId).then((snap) => {
      if (!live || !snap) return;
      setMode(shownMode(snap));
      setPending(pendingMode(snap));
    });
    return () => {
      live = false;
    };
  }, [pending, sessionId]);

  // Whether the bypass row and the trigger carry the refused badge for the current mode.
  const bypassRefused = bypassRefusedIn !== "" && mode === "bypassPermissions";
  const label = `${modeLabel(mode)}${bypassRefused ? " ⚠" : ""}`;

  /**
   * Pick a mode, doing exactly what the shield's `pick` did: optimistically show it, send
   * `/permission <preset>` through the live session when dsh's preset must change, then PUT the mode
   * with the clearDefault rule, reverting and showing the error on any failure.
   */
  const pick = (m: string) => {
    setOpen(false);
    fetchModeState(sessionId).then((snap) => {
      if (!snap) return; // nothing to compare against; leave the current mode as is
      const wasMode = mode;
      setMode(m); // optimistic, like the shield's reapplyLabel
      const revert = () => setMode(wasMode);
      const need = presetForMode(m);
      const settle = () => {
        const clearDefault =
          (need === "read-only" && m === "plan") ||
          (need === "workspace-write" && m === "acceptEdits") ||
          (need === "danger-full-access" && m === "bypassPermissions");
        fetch(`${ROUTE}/permission-mode`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, mode: clearDefault ? null : m }),
        })
          .then((r) => readJson<PermissionModeState>(r))
          .then((reply) => {
            if (reply.error) {
              revert();
              setError(reply.error);
            } else {
              setError(null);
              // The reply is the read-back: the process's own mode, and the stored one when the CLI
              // could not take the pick live, so a deferred Bypass reads as the old mode plus a note.
              setMode(shownMode(reply));
              setPending(pendingMode(reply));
            }
          })
          .catch((e) => {
            revert();
            setError(e instanceof Error ? e.message : String(e));
          });
      };
      if (need !== snap.accessMode) {
        const live = ctx.sessions.binding?.(sessionId)?.session;
        if (!live) {
          revert();
          setError(t("panel.access.notMaterialized"));
          return;
        }
        live
          .command(`/permission ${need}`)
          .then((reply) => {
            if (!reply || !reply.ok) {
              revert();
              setError(reply?.error?.message ?? t("panel.access.commandFailed"));
            } else {
              setTimeout(settle, 700);
            }
          })
          .catch((e) => {
            revert();
            setError(e instanceof Error ? e.message : String(e));
          });
      } else {
        settle();
      }
    });
  };

  const chevronOpen = open ? { transform: "rotate(180deg)" } : undefined;
  // The six rows go to dsh's Menu as data, the way dsh's own permission control hands it its three:
  // dsh draws the glyph cell, the label and the trailing check with its own classes, so the rows
  // track dsh's menu styling on every line instead of a copy of its numbers. The refused note and
  // a pick error ride in the footer as heading rows, dsh's small grey text under a hairline.
  const items = MODE_KEYS.map((m) => ({
    id: m,
    icon: <ModeGlyph mode={m} />,
    label: bypassRefusedIn !== "" && m === "bypassPermissions" ? `${modeLabel(m)} ⚠` : modeLabel(m),
  }));
  const footer = [
    ...(bypassRefused
      ? [
          {
            type: "label" as const,
            id: "refused",
            text: t("panel.access.fullAccessRefused", { scope: bypassRefusedIn }),
          },
        ]
      : []),
    ...(pending
      ? [
          {
            type: "label" as const,
            id: "pending",
            text: t("panel.access.nextTurn", { mode: modeLabel(pending) }),
          },
        ]
      : []),
    ...(error ? [{ type: "label" as const, id: "error", text: error }] : []),
  ];
  const accessMenuProps = {
    open,
    onClose: () => setOpen(false),
    side: "top" as const,
    portal: true,
    items,
    selectedId: mode,
    onSelect: pick,
    // An empty footer would still draw dsh's hairline above nothing.
    footer: footer.length > 0 ? footer : undefined,
    anchor: (
      <button
        type="button"
        data-omc-access-trigger=""
        aria-label={t("panel.access.ariaLabel", {
          text: label,
          refused: bypassRefused ? t("panel.access.ariaRefused") : "",
        })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={accessTriggerStyle}
      >
        <span aria-hidden style={{ flex: "none", display: "inline-flex", alignItems: "center" }}>
          {mode === "" ? <IconSparkleMedium size={14} /> : <ModeGlyph mode={mode} />}
        </span>
        <span
          aria-hidden="true"
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
        {bypassRefused && (
          <span aria-hidden style={{ flex: "none", color: "var(--dsw-alias-label-tertiary)" }}>
            ⚠
          </span>
        )}
        <IconChevronDownOutlineRegular aria-hidden style={chevronOpen} />
      </button>
    ),
  };
  return <Menu {...accessMenuProps} />;
}

/** One `/btw` aside as the route returns it (mirrors the adapter's `AsideEntry`). */
interface AsideRow {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  pending: boolean;
  at: number;
  dismissed?: boolean;
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
function AsidesBody({ sessionId }: { sessionId: string }) {
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
            {it.question}
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
            {it.pending ? t("panel.asides.waitingAnswer") : (it.answer ?? it.error ?? "")}
          </div>
        </details>
      ))}
    </div>
  );
}

/**
 * Single consolidated trigger for the Oh My Claude panel. One button replaces the five legacy
 * composer-slot buttons (Restore, Memory, Rewind, Changes, MCP). Clicking it opens a tabbed
 * dialog whose body is each legacy control's dialog content, moved verbatim into a body component.
 */
export function OhMyClaudeControl({ sessionId, ctx }: import("./shared.js").RestoreButtonProps) {
  // Subscribed, not read: the button must come up on the picker change itself, and this slot is
  // not re-rendered for one (see useActiveClaude).
  const isMine = useActiveClaude(ctx, sessionId);
  useLocale();
  // `open` is what is mounted, `shown` is what the transition draws. A close flips `shown` first
  // and unmounts a duration later, so the panel fades out instead of blinking away.
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const [tab, setTab] = useState(lastTab);
  // A blank session with transcripts to restore: the panel opens on Restore, the disc carries a
  // dot until the panel has been opened once here, and the very first time on this box the disc
  // pulses a few times. The dot and the default tab need no memory; the pulse is remembered on
  // the box through the hints store, so it fires once and never again after an update.
  const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId];
  const restorable = useTranscripts(entry?.blank === false ? undefined : entry?.cwd).filter(
    (s) => !isOwnedActive(s),
  ).length;
  const [seenRestore, setSeenRestore] = useState(false);
  const [pulse, setPulse] = useState(false);
  // A first-run pointer at the spark, for a box that has never used the plugin. The box counts as
  // used once either hint is set, so nobody upgrading sees it: the restore pulse has fired on every
  // box that has had a transcript to restore. Declared before the pulse effect below, so both read
  // the hints as they stood on load, before the pulse marks its own.
  const [tip, setTip] = useState(false);
  useEffect(() => {
    let live = true;
    void readHints().then((h) => {
      if (live && h !== null && !h.sparkTip && !h.restorePulse) setTip(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const dropTip = () => {
    if (!tip) return;
    setTip(false);
    markHint("sparkTip");
  };
  useEffect(() => {
    if (restorable === 0 || entry?.blank === false) return;
    let live = true;
    void readHints().then((h) => {
      if (!live || h === null || h.restorePulse) return;
      markHint("restorePulse");
      setPulse(true);
      setTimeout(() => live && setPulse(false), 4000);
    });
    return () => {
      live = false;
    };
  }, [restorable, entry?.blank]);
  // dsh's composer card, found when the panel opens: the panel is portalled into it and sits over
  // the composer the way dsh's own slash menu does. `data-composer-card` is the hook dsh's menu
  // dismisses by, so it is as stable as that menu. Null on a host without it: the panel then
  // floats fixed above the control, as before.
  const [card, setCard] = useState<HTMLElement | null>(null);
  // Phone sheet (fallback only): fixed, above the control, wherever the composer sits.
  const [above, setAbove] = useState(0);
  const maxHeight = useFitAbove(panelRef, 400, open);
  useHeightEase(panelRef, open);

  // dsh's chat width handles sit at the edges of the conversation column, outside this panel's
  // box, so a panel above them still leaves them hoverable and the column resizes under an open
  // dialog. They are dsh's own elements: mark the body instead, and the plugin's style block
  // switches their pointer events off for as long as the panel is mounted.
  useEffect(() => {
    if (!open) return;
    document.body.dataset.omcPanelOpen = "1";
    return () => {
      delete document.body.dataset.omcPanelOpen;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    ensurePanelStyle(); // hover, focus and active rules for everything inside; idempotent
    // One frame after mount, so the browser has a closed style to transition away from.
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  // False when an outside click closed the panel: that click already moved focus where the person
  // wanted it, and pulling it back to the trigger lit up the trigger's tooltip.
  const refocus = useRef(true);
  const close = useCallback((how?: "pointer" | "key") => {
    refocus.current = how !== "pointer";
    setShown(false);
    closeTimer.current = setTimeout(() => setOpen(false), easeMs());
  }, []);
  // A pending close must not unmount a panel the next click just reopened.
  const openPanel = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
    setShown(false);
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // The panel, not the trigger: a portal takes it out of the trigger's DOM subtree.
  useDismiss(open, close, panelRef);

  // On open, move focus onto the selected tab so a keyboard user lands inside the panel instead of
  // on the trigger behind the portal; on close, hand focus back to whatever held it first. No trap:
  // the panel is not modal and the page around it stays usable. An outside click is the exception:
  // focus stays where that click put it.
  useEffect(() => {
    if (!open) return;
    // Record the focused element before focus moves, so close can return it.
    const before = document.activeElement;
    document.getElementById(`omc-tab-${tab}`)?.focus();
    return () => {
      if (refocus.current && before instanceof HTMLElement && document.contains(before))
        before.focus();
    };
  }, [open]);

  if (!isMine) return null;
  // Restore only fits a blank session; the Restore body hides itself for the same reason.
  const blank = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.blank !== false;

  // Over the composer, like dsh's slash menu: absolute in the card, 4 px above it, its full width,
  // on dsh's menu surface (the `--dsw-specific-menu` fill and the prominent elevation), 20 px
  // corners. z-index 100 is what dsh gives that menu. Without a card (an older host), fall back to
  // a fixed float centred in the viewport by insets (`100vw` counts the scrollbar; an inset cannot
  // overshoot), sized to the tab strip on desktop and to the phone under 640 px.
  // overflow hidden so the body is the only scroller and the tab strip cannot scroll out of it.
  const panelStyle: CSSProperties = card
    ? {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 4px)",
        maxHeight,
        zIndex: 100,
        background: `var(--dsw-specific-menu, ${T.card})`,
        // dsh 0.1.7 made that fill translucent and leans on the blur behind it; without this the
        // card reads as see-through over the chat. Older dsh has no such variable and no need
        // for one: the fill was opaque, and an unset backdrop filter is simply none.
        backdropFilter: "var(--dsw-menu-backdrop-filter)",
        boxShadow: `var(--dsw-elevation-prominent, 0 10px 28px rgba(0,0,0,.26))`,
        // SAFETY: a custom property is not in CSSProperties; the browser reads it as written.
        ...({ "--dsw-elevation-stroke-color": "var(--dsw-alias-border-l1)" } as CSSProperties),
        borderRadius: 20,
        padding: 4,
      }
    : {
        position: "fixed",
        left: 12,
        right: 12,
        marginInline: "auto",
        bottom: above,
        width: narrow ? "auto" : "fit-content",
        maxWidth: narrow ? undefined : "calc(100vw - 24px)",
        // dvh, not vh: on a phone the browser chrome slides away and vh keeps measuring the tall value.
        maxHeight: narrow ? "60dvh" : "min(400px, 80dvh)",
        zIndex: 200,
        padding: 6,
        ...panelSurface,
        borderRadius: 10,
      };
  // In the card the panel only fades: `useFitAbove` measures the element's bottom
  // on mount, and a 6 px rise still applied at that moment would size it 6 px too tall.
  // The panel's own type base, so text a tab leaves unsized inherits 13 px on a 1.5 line instead
  // of dsh's 16/26 body, which spread every wrapped note in the panel over 26 px lines.
  Object.assign(panelStyle, {
    fontSize: 13,
    lineHeight: 1.5,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    // A wheel that reaches the panel's end, or lands on its tab strip, stays here instead of
    // scrolling the chat behind it.
    overscrollBehavior: "contain",
    opacity: shown ? 1 : 0,
    transform: shown || card ? "none" : "translateY(6px)",
    transition: `opacity ${easeMs()}ms ease, transform ${easeMs()}ms ease`,
  } satisfies CSSProperties);

  // The tab's key is both its React key and its stable `data-omc-label` hook; the visible label
  // comes from `panel.tab.<key>` at render, so the key stays English while the label translates.
  const tabs = [
    ...(blank ? [{ key: "Restore" }] : []),
    { key: "Memory" },
    { key: "Instructions" },
    { key: "Skills" },
    { key: "Rewind" },
    { key: "Changes" },
    { key: "MCP" },
    { key: "Asides" },
    { key: "Diagnostics" },
    { key: "Tasks" },
    { key: "Tune" },
  ] as const;
  // Fall back when an earlier session stored a tab no longer present (e.g. removed Permissions).
  // SAFETY: tabs is const-as, so tb.key is a literal string; the map produces string[].
  if (!(tabs.map((tb) => tb.key) as readonly string[]).includes(lastTab)) lastTab = "Memory";

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      {/* dsh's own bubble, as on the composer's "+" and "Add attachment" buttons, in place of the
          browser's title tooltip. Off while the panel is open so it does not sit on the tab strip. */}
      <Tooltip label="Oh My Claude" side="top" delayMs={500} disabled={open}>
        <button
          type="button"
          // The same disc as dsh's own composer buttons (`+` and Add attachment): 28 px, no border,
          // but bare at rest and filled with their hover shade only under the pointer or while the
          // panel is open; the mark at 15 px reads at the size of their 14 px strokes. Written on
          // the tokens rather than dsh's hashed class, which a build renames. dsh gives every
          // element `corner-shape: superellipse(1.5)` where the browser knows the property and its
          // round buttons opt back out, so ours does too (the rule beside the hover one in
          // shared.ts) or a 999 px radius draws a squircle.
          style={{
            width: 28,
            height: 28,
            padding: 0,
            border: "none",
            borderRadius: 999,
            background: open ? T.hoverSolid : "transparent",
            color: PANEL_ACCENT,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            cursor: "pointer",
            position: "relative",
          }}
          aria-label="Oh My Claude"
          aria-haspopup="dialog"
          aria-expanded={open}
          {...(pulse ? { "data-omc-pulse": "" } : {})}
          onClick={() => {
            if (open) {
              close();
              return;
            }
            setSeenRestore(true);
            dropTip();
            setTab(
              blank && restorable > 0
                ? "Restore"
                : lastTab === "Restore" && !blank
                  ? "Memory"
                  : lastTab,
            );
            const host = rootRef.current?.closest<HTMLElement>("[data-composer-card]") ?? null;
            setCard(host);
            const rect = rootRef.current?.getBoundingClientRect();
            if (!host && rect) setAbove(Math.max(12, window.innerHeight - rect.top + 8));
            openPanel();
          }}
        >
          <Spark size={15} color="currentColor" />
          {blank && restorable > 0 && !seenRestore && !open && (
            <span
              data-omc-restore-badge=""
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                width: 7,
                height: 7,
                borderRadius: 999,
                background: PANEL_ACCENT,
                boxShadow: "0 0 0 2px var(--dsw-specific-input-major, #fff)",
              }}
            />
          )}
        </button>
      </Tooltip>
      {tip && !open && (
        <span
          data-omc-spark-tip=""
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
          role="status"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px 6px 10px",
            borderRadius: 10,
            whiteSpace: "nowrap",
            fontSize: 12,
            color: T.text,
            background: `var(--dsw-specific-menu, ${T.card})`,
            backdropFilter: "var(--dsw-menu-backdrop-filter)",
            boxShadow: `var(--dsw-elevation-prominent, 0 10px 28px rgba(0,0,0,.26))`,
          }}
        >
          {t("panel.tip")}
          <button
            type="button"
            aria-label={t("panel.dismiss")}
            title={t("panel.dismiss")}
            onClick={dropTip}
            style={{
              background: "none",
              border: "none",
              padding: "0 2px",
              cursor: "pointer",
              color: T.faint,
            }}
          >
            ×
          </button>
        </span>
      )}
      {open &&
        portal(
          card,
          <div
            ref={panelRef}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a non-modal popover; <dialog> hides unless open and brings its own box
            role="dialog"
            aria-label="Oh My Claude"
            {...{ [PANEL_ATTR]: "1" }}
            style={panelStyle}
          >
            <div
              role="tabpanel"
              id="omc-tabpanel"
              aria-labelledby={`omc-tab-${tab}`}
              // width:0 + minWidth:100% keeps the body from contributing to the panel's fit-content
              // width: it fills whatever the tab strip sets, and its own long lines scroll rather than
              // widen the panel past the tabs.
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                overflow: "auto",
                overscrollBehavior: "contain",
                // The panel's one inset, top and bottom as well as the sides: every tab's first row, cards and
                // headings line up on it.
                padding: PANEL_INSET,
                width: card || narrow ? undefined : 0,
                minWidth: card || narrow ? undefined : "100%",
              }}
            >
              {tab === "Restore" && <RestoreBody sessionId={sessionId} ctx={ctx} onClose={close} />}
              {tab === "Memory" && <MemoryBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Instructions" && <InstructionsBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Skills" && <SkillsBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Rewind" && <RewindBody sessionId={sessionId} ctx={ctx} onClose={close} />}
              {tab === "Changes" && <ChangesBody sessionId={sessionId} ctx={ctx} onClose={close} />}
              {tab === "MCP" && <McpBody sessionId={sessionId} ctx={ctx} onClose={close} />}
              {tab === "Asides" && <AsidesBody sessionId={sessionId} />}
              {tab === "Diagnostics" && <DiagnosticsBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Tasks" && <TasksBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Tune" && <TuneBody sessionId={sessionId} ctx={ctx} />}
            </div>
            {/* Under the body, not over it: the panel is anchored to its bottom edge, so a taller tab
              pushes the top up and leaves the strip where the pointer left it. */}
            <div
              role="tablist"
              // ARIA APG keeps the strip itself out of the Tab order (only the selected tab is
              // focusable), but this lint rule makes a role="tablist" with a key handler focusable,
              // so tabIndex={-1} satisfies it without adding a Tab stop of its own.
              tabIndex={-1}
              // Arrow keys step the tabs in list order, wrapping at the ends; Home/End jump to the
              // first and last. Only the selected tab is in the Tab order, so arrows are how a
              // keyboard user moves. "Next" is next in the list, not the next row, matching ARIA APG.
              onKeyDown={(e) => {
                // Only these four keys are ours; every other key keeps its default, so focus can
                // still leave the strip.
                if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                const order = tabs.map((tb) => tb.key);
                const index = order.indexOf(tab);
                const next =
                  e.key === "ArrowRight"
                    ? (index + 1) % order.length
                    : e.key === "ArrowLeft"
                      ? (index - 1 + order.length) % order.length
                      : e.key === "Home"
                        ? 0
                        : order.length - 1;
                const key = order[next];
                // next is always a valid index, so this never fires; it narrows key to string.
                if (!key) return;
                lastTab = key;
                setTab(key);
                // Reach the button by the id it already carries, not by a ref.
                document.getElementById(`omc-tab-${key}`)?.focus();
              }}
              style={{
                display: "flex",
                flex: "0 0 auto",
                borderTop: `1px solid color-mix(in srgb, ${PANEL_ACCENT} 18%, ${T.border})`,
                // On the body's inset, rule included: dsh's own tab strips (the plugin settings
                // page) keep their underline inside the content column, not edge to edge.
                marginInline: PANEL_INSET,
                paddingTop: 4,
                gap: narrow ? 0 : 2,
                // Wrap rather than scroll sideways: a strip that scrolls hides the tab that did not
                // fit, and the panel is anchored to its bottom edge, so a second row grows upward.
                flexWrap: "wrap",
                rowGap: 4,
              }}
            >
              {tabs.map((tabDef) => {
                // SAFETY: every tabs[].key has a matching panel.tab.<key> entry in the dictionary.
                const label = t(`panel.tab.${tabDef.key}` as OmcKey);
                return (
                  <button
                    key={tabDef.key}
                    role="tab"
                    data-omc-label={tabDef.key}
                    id={`omc-tab-${tabDef.key}`}
                    aria-controls="omc-tabpanel"
                    aria-selected={tab === tabDef.key}
                    // Only the selected tab is in the Tab order; arrows move between tabs (the tablist
                    // handler), so the others stay out of the way.
                    tabIndex={tab === tabDef.key ? 0 : -1}
                    // The strip sits under the body, so the lit edge is the mirror of a top tab bar:
                    // accent along the bottom, corners rounded on that side only, no box around each
                    // tab (nine bordered boxes read as buttons, not as tabs). Hover is in the sheet.
                    // 8 px sides on a phone: the strip's inset would otherwise push the last tab
                    // onto a fourth row at 390 px.
                    style={
                      narrow
                        ? { ...tabStyle(tab === tabDef.key), paddingInline: 8 }
                        : tabStyle(tab === tabDef.key)
                    }
                    onClick={() => {
                      lastTab = tabDef.key;
                      setTab(tabDef.key);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>,
        )}
    </span>
  );
}

/** Render `node` inside dsh's composer card when one was found, else in place. */
const portal = (card: HTMLElement | null, node: ReactElement) =>
  card ? createPortal(node, card) : node;
