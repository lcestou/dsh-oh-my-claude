import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { createPortal } from "react-dom";
import {
  btn,
  btnPrimary,
  errText,
  stateText,
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
  type SkillState,
} from "./shared.js";
import { UpdatePill } from "./update-pill.js";
import { ReportBlock } from "./report.js";
import { Tooltip, useAnchoredMaxHeight } from "@deepseek-ai/dsh-client-ui-primitives";
import { Spark } from "./spark.js";
import { ConfirmButton, TuneBody } from "./tune.js";
import { noticesOn, setNoticesOn } from "./notices.js";
import { queueDraft } from "./draft.js";
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
  const label = s.title ?? s.id;
  return (
    <button
      type="button"
      style={{
        ...btn,
        display: "flex",
        alignItems: "center",
        width: "100%",
        textAlign: "left",
        padding: "5px 10px",
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
    : `Claude Code deletes transcripts older than ${s.retention.days} days` +
      `${s.retention.scope === null ? " (cleanupPeriodDays, its default)" : ` (cleanupPeriodDays in ${s.retention.scope} settings)`}.`;

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
const readHints = (): Promise<Record<string, boolean | number> | null> =>
  (hintsCache ??= fetch(`${ROUTE}/hints`)
    .then((r) => readJson<Record<string, boolean | number>>(r))
    .catch(() => null));
const markHint = (key: string): void => {
  hintsCache = Promise.resolve({ [key]: true });
  void fetch(`${ROUTE}/hints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [key]: true }),
  }).catch(() => {});
};

/** "Restore Claude session" body rendered inside the Oh My Claude dialog. */
function RestoreBody({
  sessionId,
  ctx,
  onClose,
}: {
  sessionId: string;
  ctx: ClientCtx;
  onClose: () => void;
}) {
  const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId];
  const cwd = entry?.cwd;
  const transcripts = useTranscripts(cwd);
  const [query, setQuery] = useState("");
  const switches = useFeatureSwitches(cwd);

  // Hide when the session already has content or the workspace is unknown.
  if (!cwd || entry?.blank === false) return null;
  const owned = transcripts.filter(isOwnedActive);
  const candidates = transcripts.filter((s) => !isOwnedActive(s));
  const name = workspaceName(cwd);
  const rest = candidates.filter((s) => matchesQuery(s, query)).slice(0, 8);

  return (
    <div style={bodyFlow}>
      {/* Eight rows show; the search is how the rest are reached, so it appears once there are more. */}
      {candidates.length > 8 && (
        <input
          type="search"
          data-omc-restore-search=""
          style={{ ...inputStyle, margin: "2px 4px 4px" }}
          value={query}
          placeholder={`Search ${candidates.length} transcripts in ${name}`}
          aria-label="Search transcripts"
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {candidates.length === 0 && (
        <span
          data-omc-restore-empty=""
          style={{ ...meta, padding: "2px 4px", whiteSpace: "normal" }}
        >
          No Claude Code transcripts in {name} to restore. One appears here after a session runs in
          this folder, from dsh or from a terminal.
        </span>
      )}
      {candidates.length > 0 && rest.length === 0 && (
        <span style={{ ...meta, padding: "2px 4px" }}>No transcript matches</span>
      )}
      {rest.map((s) => (
        <TranscriptRow key={s.id} s={s} cwd={cwd} ctx={ctx} onClose={onClose} />
      ))}
      {owned.length > 0 && (
        <span style={{ fontSize: 11, color: T.faint, padding: "2px 4px" }}>
          {owned.length} already open
        </span>
      )}
      <span style={{ ...meta, padding: "2px 4px", whiteSpace: "normal" }}>
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
    if (!file || !window.confirm(`Delete ${file}? MEMORY.md drops its line too.`)) return;
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

  if (!cwd) return <span style={stateText}>Open a workspace to see its memory files.</span>;
  if (files.length === 0)
    return (
      <span style={stateText}>
        No memory files for this workspace yet. Claude writes them as it learns the project.
      </span>
    );
  const dirty = text !== saved;
  return (
    <div style={bodyFlow}>
      {file === null ? (
        files.map((f) => (
          <button
            key={f.name}
            type="button"
            style={{
              ...btn,
              display: "flex",
              width: "100%",
              textAlign: "left",
              padding: "5px 10px",
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
              ‹ Back
            </button>
            <span style={{ flex: 1, fontFamily: T.mono, fontSize: 12 }}>{file}</span>
            <button type="button" style={btn} onClick={remove} disabled={busy}>
              Delete
            </button>
            <button
              type="button"
              style={dirty ? btnPrimary : btn}
              onClick={save}
              disabled={busy || !dirty}
            >
              Save
            </button>
          </div>
          <textarea
            value={text}
            spellCheck={false}
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

/**
 * "Instructions" body rendered inside the Oh My Claude dialog: lists the CLAUDE.md hierarchy
 * the session loaded (managed, user, project, local files plus @imports), and opens each in
 * an editor. Managed files open read-only. Same save/delete routes as Memory, path-checked.
 */
/** The one plugin scope not `user`-global reads and writes into a directory. */
const PLUGIN_SCOPE_OPTS = [
  { value: "user", label: "User" },
  { value: "project", label: "Project" },
  { value: "local", label: "Local" },
] as const;

/** The Add-marketplace form under the roster: a source and the scope to declare it in. */
function MarketplaceAddForm({ act, busy }: { act: Act; busy: string }) {
  const [source, setSource] = useState("");
  const [scope, setScope] = useState("user");
  const submit = async () => {
    if (await act("/plugins/marketplace/add", { source, scope }, "mkt-add")) setSource("");
  };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <input
        type="text"
        placeholder="Marketplace: URL, path or owner/repo"
        value={source}
        onChange={(e) => setSource(e.currentTarget.value)}
        disabled={busy !== ""}
        style={{ ...inputStyle, fontSize: 12 }}
      />
      <select
        value={scope}
        onChange={(e) => setScope(e.currentTarget.value)}
        disabled={busy !== ""}
        style={{ ...select, fontSize: 12 }}
      >
        {PLUGIN_SCOPE_OPTS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        style={btn}
        disabled={busy !== "" || source.trim() === ""}
        onClick={submit}
      >
        {busy === "mkt-add" ? "…" : "Add"}
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
  sessionId,
  ctx,
  onChanged,
}: {
  roster: PluginRoster | null;
  pluginErrors: PluginLoadError[];
  sessionId: string;
  ctx: ClientCtx;
  onChanged: () => void;
}) {
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
        setError(r.error ?? "failed");
        return false;
      }
      setApplied(r.live === true ? "Applied to this session." : "Takes effect at the next spawn.");
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
      <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
        Plugins and marketplaces
      </span>
      <div style={{ padding: "2px 10px", fontSize: 12, lineHeight: "1.7" }}>
        {pluginErrors.length > 0 && (
          <div data-omc-plugin-errors="" role="alert" style={{ marginBottom: 6 }}>
            <span style={{ ...meta, color: T.err, padding: "2px 4px", display: "block" }}>
              Failed to load
            </span>
            {pluginErrors.map((e, i) => (
              <div key={`${e.plugin}:${i}`} style={{ ...line, whiteSpace: "normal", color: T.err }}>
                {e.plugin && !e.plugin.startsWith("inline") ? `${e.plugin}: ` : ""}
                {e.message}
              </div>
            ))}
          </div>
        )}
        {plugins.length === 0 && marketplaces.length === 0 && (
          <span style={{ ...meta, fontSize: 12 }}>
            No settings file names a plugin (enabledPlugins) or a marketplace.
          </span>
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
              title={p.enabled ? "disable" : "enable"}
            >
              {busy === p.key ? "…" : p.enabled ? "on" : "off"}
            </button>
            <span style={line}>
              {p.key}
              {p.detail !== undefined && ` (${p.detail})`}
            </span>
            <span style={{ ...meta, flex: "none" }}>{p.scope}</span>
            <ConfirmButton
              label="Remove"
              style={small}
              disabled={busy !== ""}
              busyLabel={busy === p.key ? "…" : undefined}
              onAct={() => void act("/plugins/uninstall", { key: p.key, scope: p.scope }, p.key)}
            />
          </div>
        ))}
        {marketplaces.map((m) => (
          <div key={m.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ ...meta, flex: "none" }}>market</span>
            <span style={line}>
              {m.name} · {m.source}
              {m.alias === true && " (written as additionalMarketplaces)"}
            </span>
            <span style={{ ...meta, flex: "none" }}>{m.scope}</span>
            <ConfirmButton
              label="Remove"
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
          {applied ||
            "A change applies to the running session now, or at the next spawn if none is up."}
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

const writable = (scope: string) => scope === "user" || scope === "project";

/**
 * The Skills tab: every skill the CLI can reach for this directory, grouped by where it comes from,
 * each scope a collapsible section. User and project skills are created, edited and removed here; a
 * plugin's skills are read-only, edited where the plugin ships them. A write asks the live process to
 * re-read skills (`reload_skills`), so a new skill's /command registers without a respawn. The box the
 * session runs on is named in the query, so a remote session lists and edits that box's skills.
 */
function SkillsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [cost, setCost] = useState<SkillState>({ kind: "idle" });
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

  const box = boxQuery(ctx, sessionId);
  const note = (live: boolean) =>
    setApplied(live ? "Applied to this session." : "Takes effect at the next spawn.");
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
      setCreating(false);
      const name = newName;
      setNewName("");
      setNewDesc("");
      refresh();
      await openEdit(r.path, name);
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
    { key: "user", label: "User skills", rows: groups.user },
    { key: "project", label: "Project skills", rows: groups.project },
    { key: "plugin", label: "Plugin skills", rows: groups.plugin },
  ];
  const anyMatch = skills.some(match);
  const small: CSSProperties = { ...btn, flex: "none", padding: "0 6px", fontSize: 11 };
  const rowNode = (s: SkillRow) => (
    <div
      key={s.path}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 10px" }}
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
          aria-label={`Edit ${s.name}`}
          style={small}
          disabled={busy !== ""}
          onClick={() => openEdit(s.path, s.name)}
        >
          Edit
        </button>
      )}
      {writable(s.scope) && (
        <ConfirmButton
          label="Remove"
          ariaLabel={`Remove ${s.name}`}
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
            ‹ Back
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
            Save
          </button>
        </div>
        <textarea
          data-omc-skill-editor=""
          aria-label="Edit SKILL.md"
          value={text}
          spellCheck={false}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
          }}
          style={{ ...code, minHeight: 300, resize: "vertical", whiteSpace: "pre-wrap" }}
        />
        {applied && (
          <span data-omc-skill-applied="" style={{ ...meta, padding: "2px 4px" }}>
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
      <div style={{ display: "flex", gap: 6, padding: "2px 4px" }}>
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
            New skill
          </button>
        )}
        <button
          type="button"
          data-omc-skill-reload=""
          style={btn}
          disabled={busy !== ""}
          onClick={reload}
        >
          {busy === "reload" ? "…" : "Reload"}
        </button>
      </div>
      {creating && (
        <div
          data-omc-skill-form=""
          style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 4px" }}
        >
          <input
            type="text"
            data-omc-skill-name=""
            aria-label="New skill name"
            placeholder="skill-name (lowercase, hyphens)"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            disabled={busy !== ""}
            style={{ ...inputStyle, fontSize: 12 }}
          />
          {newName !== "" && !nameOk && (
            <span data-omc-skill-name-error="" style={{ ...meta, color: T.err }}>
              A skill name is lowercase letters, digits and hyphens.
            </span>
          )}
          <select
            data-omc-skill-scope=""
            value={newScope}
            onChange={(e) => setNewScope(e.currentTarget.value)}
            disabled={busy !== ""}
            style={{ ...select, fontSize: 12 }}
          >
            <option value="user">User</option>
            <option value="project">Project</option>
          </select>
          <input
            type="text"
            data-omc-skill-desc=""
            aria-label="New skill description"
            placeholder="One line: what it does and when to use it"
            value={newDesc}
            onChange={(e) => setNewDesc(e.currentTarget.value)}
            disabled={busy !== ""}
            style={{ ...inputStyle, fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              data-omc-skill-create=""
              style={btnPrimary}
              disabled={busy !== "" || !nameOk}
              onClick={create}
            >
              {busy === "create" ? "…" : "Create"}
            </button>
            <button
              type="button"
              data-omc-skill-cancel=""
              style={btn}
              disabled={busy !== ""}
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {skills.length === 0 && (
        <span
          data-omc-skills-none=""
          style={{ ...meta, padding: "2px 10px", display: "block", whiteSpace: "normal" }}
        >
          No skills: none under ~/.claude/skills, this project's .claude/skills, or an installed
          plugin.
        </span>
      )}
      {skills.length > 12 && (
        <input
          type="search"
          style={{ ...inputStyle, margin: "2px 4px 4px" }}
          value={query}
          placeholder={`Search ${skills.length} skills`}
          aria-label="Search skills"
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {skills.length > 0 && !anyMatch && (
        <span data-omc-skills-empty="" style={{ ...meta, padding: "2px 4px" }}>
          No skill matches
        </span>
      )}
      {sections.map((sec) => {
        const rows = sec.rows.filter(match);
        if (rows.length === 0) return null;
        return (
          <details key={sec.key} open data-omc-skills-scope={sec.key}>
            <summary style={{ ...meta, padding: "2px 4px", cursor: "pointer" }}>
              {sec.label} · {sec.rows.length}
            </summary>
            {rows.map(rowNode)}
          </details>
        );
      })}
      {skills.some((s) => writable(s.scope)) && (
        <span data-omc-skill-note="" style={{ ...meta, padding: "2px 4px", whiteSpace: "normal" }}>
          Removing deletes the skill&apos;s folder. Its /command stays until Claude restarts.
        </span>
      )}
      {applied && (
        <span data-omc-skill-applied="" style={{ ...meta, padding: "2px 4px" }}>
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
        <summary style={{ ...meta, padding: "2px 4px", cursor: "pointer" }}>Skill costs</summary>
        <div style={{ ...meta, whiteSpace: "normal", margin: "8px 0" }}>
          What each Claude Code skill costs in context and how often you have used it. Read from
          Claude Code&apos;s own /skill-doctor. No message is sent to the model, so this costs no
          usage.
        </div>
        {cost.kind === "loading" && (
          <div style={{ color: T.muted, fontSize: 13 }}>Reading skills…</div>
        )}
        {cost.kind === "error" && (
          <div style={{ color: T.err, fontSize: 13 }}>
            Couldn&apos;t read the skill report: {cost.text}
          </div>
        )}
        {cost.kind === "declined" && (
          <pre
            data-omc-skill-doctor=""
            aria-label="Skill report"
            style={{ ...code, maxHeight: 320, overflow: "auto", margin: 0 }}
          >
            {cost.text}
          </pre>
        )}
        {cost.kind === "report" && (
          <>
            {cost.partial && (
              <div style={{ color: T.faint, fontSize: 12, marginBottom: 6 }}>
                Showing user skills only; this box&apos;s Claude Code is too old to list project
                skills without writing a transcript.
              </div>
            )}
            <pre
              data-omc-skill-doctor=""
              aria-label="Skill costs report"
              style={{ ...code, maxHeight: 320, overflow: "auto", margin: 0 }}
            >
              {cost.text}
            </pre>
          </>
        )}
        {cost.kind !== "loading" && (
          <button type="button" onClick={loadCost} style={{ ...btn, marginTop: 8 }}>
            Refresh
          </button>
        )}
      </details>
    </div>
  );
}

function InstructionsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = useState<InstructionFile[]>([]);
  const [file, setFile] = useState<InstructionFile | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [roster, setRoster] = useState<PluginRoster | null>(null);
  const [pluginErrors, setPluginErrors] = useState<PluginLoadError[]>([]);

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
      .then((r) => readJson<PluginRoster & { pluginErrors?: PluginLoadError[] }>(r))
      // A roster that will not load is not an instructions error: the file list is still good.
      .then((b) => {
        if (!mounted.current) return;
        setRoster(b);
        setPluginErrors(b.pluginErrors ?? []);
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
      <span style={{ ...meta, padding: "4px 10px", color: error ? T.err : undefined }}>
        {error || "No instructions for this workspace."}
      </span>
    );
  const dirty = text !== saved;

  return (
    <div style={bodyFlow}>
      {file === null && files.length === 0 && (
        <span style={{ ...meta, padding: "4px 10px" }}>No instructions for this workspace.</span>
      )}
      {file === null ? (
        files.map((f) => (
          <button
            key={f.path}
            type="button"
            style={{
              ...btn,
              display: "flex",
              width: "100%",
              textAlign: "left",
              padding: "5px 10px",
            }}
            onClick={() => openFile(f)}
          >
            <span style={{ ...meta, flex: "none", minWidth: 52 }}>{f.kind}</span>
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
                (from {f.importedBy.split("/").pop()})
              </span>
            )}
            <span style={{ ...meta, flex: "none", marginLeft: 8 }}>{ago(f.mtime)}</span>
          </button>
        ))
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" style={btn} onClick={() => setFile(null)} disabled={busy}>
              ‹ Back
            </button>
            <span style={{ flex: 1, minWidth: 0, fontFamily: T.mono, fontSize: 12 }}>
              {shortPath(file.path, cwd)}
            </span>
            {file.kind === "Managed" && (
              <span style={{ ...meta, flex: "none" }}>read-only (managed)</span>
            )}
            {file.kind !== "Managed" && (
              <button
                type="button"
                style={dirty ? btnPrimary : btn}
                onClick={save}
                disabled={busy || !dirty}
              >
                Save
              </button>
            )}
          </div>
          <textarea
            value={text}
            spellCheck={false}
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

const rewindSummary = (r: RewindReply) =>
  r.error
    ? r.error
    : `${r.filesChanged?.length ?? 0} files, +${r.insertions ?? 0} −${r.deletions ?? 0}`;

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
      {noFiles && (
        <span style={errText}>
          CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING is set in dsh's environment, so Claude keeps no
          file checkpoints: a rewind moves the conversation back and leaves your files as they are.
        </span>
      )}
      {picked === null ? (
        prompts.length === 0 ? (
          <span style={{ ...meta, padding: "2px 4px" }}>No completed prompts yet</span>
        ) : (
          prompts.map((p) => (
            <button
              key={p.id}
              type="button"
              style={{
                ...btn,
                display: "flex",
                width: "100%",
                textAlign: "left",
                padding: "5px 10px",
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
          <span style={{ fontSize: 13, padding: "2px 4px" }}>Rewind to: {picked.text}</span>
          <span style={{ ...meta, padding: "2px 4px" }}>
            {busy && !preview ? "Checking…" : preview ? rewindSummary(preview) : ""}
          </span>
          <span style={{ ...meta, padding: "2px 4px" }}>
            Files go back and Claude forgets everything after this prompt. This dsh transcript keeps
            showing what happened.
          </span>
          <div style={{ display: "flex", gap: 8, padding: "2px 4px" }}>
            <button type="button" style={btn} disabled={busy} onClick={() => setPicked(null)}>
              ‹ Back
            </button>
            <button
              type="button"
              style={btnPrimary}
              disabled={busy || !preview?.ok}
              onClick={() => run(picked.id, false)}
            >
              Rewind
            </button>
          </div>
        </>
      )}
      {picked === null && prompts.length > 0 && (
        <span style={{ ...meta, padding: "2px 4px", whiteSpace: "normal" }}>
          {retentionNote(switches)} A prompt older than that is no longer here to rewind to.
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
      else setNote(body.error ?? "failed");
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
      {note !== "" && <span style={{ ...meta, padding: "2px 4px" }}>{note}</span>}
      {reply === null ? (
        <span style={stateText}>Loading…</span>
      ) : !reply.ok ? (
        <span style={errText}>{reply.error}</span>
      ) : current ? (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 4px" }}>
            <button
              type="button"
              style={btn}
              onClick={() => {
                setShown(null);
                setNote("");
              }}
            >
              ‹ Back
            </button>
            <span style={{ fontSize: 13, fontFamily: "monospace" }}>{current.path}</span>
            <span style={{ ...meta, marginLeft: "auto" }}>
              <DiffCounts added={current.added} removed={current.removed} />
            </span>
            <button
              type="button"
              style={btn}
              data-omc-diff-ask=""
              title="Ask Claude about this file, off the transcript"
              disabled={asking !== null}
              onClick={() => void ask(current.path)}
            >
              {asking === current.path ? "…" : "Ask"}
            </button>
          </div>
          {current.hunks.length === 0 ? (
            <span style={{ ...meta, padding: "2px 4px" }}>
              {current.binary ? "Binary file" : current.untracked ? "Untracked file" : "No hunks"}
            </span>
          ) : (
            current.hunks.map((h, i) => (
              <pre
                key={i}
                style={{
                  margin: "2px 4px",
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
          <span style={{ ...meta, padding: "2px 4px" }}>
            {reply.filesCount === 0 ? (
              "Working tree clean"
            ) : (
              <>
                {reply.filesCount} files,{" "}
                <DiffCounts added={reply.linesAdded} removed={reply.linesRemoved} />
              </>
            )}
          </span>
          {reply.filesCount > 0 && (
            <div style={{ display: "flex", gap: 8, padding: "2px 4px" }}>
              <button
                type="button"
                style={btn}
                data-omc-diff-ask-all=""
                title="Ask Claude about all the changes, off the transcript"
                disabled={asking !== null}
                onClick={() => void ask("")}
              >
                {asking === "" ? "…" : "Ask"}
              </button>
              <button
                type="button"
                style={btn}
                data-omc-diff-review=""
                title="Write a review prompt into the composer"
                onClick={() => {
                  queueDraft(sessionId, reviewPrompt(files.map((f) => f.path)));
                  onClose();
                }}
              >
                Review my changes
              </button>
            </div>
          )}
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              style={{
                ...btn,
                display: "flex",
                width: "100%",
                textAlign: "left",
                padding: "5px 10px",
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
                  "new"
                ) : f.binary ? (
                  "binary"
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
      setNote(r.ok ? `${serverName}: reconnected` : `${serverName}: ${r.error ?? "failed"}`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
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
        r.ok ? `${serverName} removed. ${SPAWN_NOTE}` : `${serverName}: ${r.error ?? "failed"}`,
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
      else setNote(`${serverName}: ${r.error ?? "failed"}`);
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
        {showAdd ? "Cancel" : "Add server"}
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
              setNote(SPAWN_NOTE);
              void loadConfigured();
            }}
          />
        </div>
      </div>
      {reply === null ? (
        <span style={stateText}>Loading…</span>
      ) : !reply.ok ? (
        <span style={errText}>{reply.error}</span>
      ) : servers.length === 0 && pendingRows.length === 0 ? (
        <span style={{ ...meta, padding: "2px 4px" }}>No MCP servers</span>
      ) : (
        servers.map((s) => (
          <div key={s.name}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" }}>
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
              <span style={{ ...meta, flex: "none" }}>{s.status}</span>
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
                aria-label={`Always ask: ${s.name}`}
                data-omc-mcp-ask=""
                disabled={busy !== null}
                onClick={() => setAsk(s.name, s.asking !== true)}
              >
                Always ask
              </button>
              {s.status !== "needs-auth" && (
                <button
                  type="button"
                  style={btn}
                  disabled={busy !== null}
                  onClick={() => reconnect(s.name)}
                >
                  {busy === s.name ? "…" : "Reconnect"}
                </button>
              )}
              <ConfirmButton
                label="Remove"
                style={btn}
                disabled={busy !== null}
                busyLabel={busy === s.name ? "…" : undefined}
                onAct={() => remove(s.name)}
              />
            </div>
            {s.status !== "connected" && (s.error || s.status === "needs-auth") ? (
              // A server that is down explains itself here; `needs-auth` always says something,
              // because its row carries no Reconnect and would otherwise be a dead end.
              <div style={{ padding: "0 6px 4px 22px", color: T.muted, fontSize: 12 }}>
                {s.error ??
                  "Needs authentication. Run /mcp in a Claude Code terminal on this box to authenticate this server."}
              </div>
            ) : null}
            {s.tools && s.tools.length > 0 ? (
              <div style={{ padding: "0 6px 4px 22px", color: T.muted, fontSize: 12 }}>
                {s.tools.join(" · ")}
              </div>
            ) : null}
            {/* When the override is set and the session would otherwise auto-allow, say what it
                does. The CLI keeps it in state that dies with the process, so the note says so. */}
            {s.asking === true && !askIsInert && (
              <div style={{ padding: "0 6px 4px 22px", color: T.muted, fontSize: 12 }}>
                Tools from this server ask, until this session's Claude restarts.
              </div>
            )}
          </div>
        ))
      )}
      {pendingRows.map((c) => (
        <div key={`configured:${c.name}`} data-omc-mcp-pending="">
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" }}>
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
            <span style={{ ...meta, flex: "none" }}>starts with the next session</span>
            <ConfirmButton
              label="Remove"
              style={btn}
              disabled={busy !== null}
              busyLabel={busy === c.name ? "…" : undefined}
              onAct={() => remove(c.name)}
            />
          </div>
        </div>
      ))}
      {askIsInert && servers.length > 0 && (
        <span style={{ ...meta, padding: "2px 4px", marginTop: 8 }}>
          This session already asks before an MCP tool runs, so Always ask changes nothing yet.
        </span>
      )}
      {note && <span style={{ ...meta, padding: "2px 4px", marginTop: 8 }}>{note}</span>}
    </div>
  );
}

/**
 * A server the config gains or loses is not a server this process has: the CLI reads its MCP
 * config at spawn, so the list on screen only catches up on the next one.
 */
const SPAWN_NOTE = "Saved. Claude picks it up the next time it starts.";

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
    ? "This browser has no notification API; the tab title carries the mark instead."
    : permission === "denied"
      ? "Blocked in the browser's site settings; the tab title still carries the mark."
      : on
        ? "On for sessions this tab is not showing."
        : "Off. The tab title is marked while the page is hidden either way.";
  return (
    <>
      <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
        Session notices
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
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
          {on ? "Turn off" : "Turn on"}
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
  if (!running)
    return (
      <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>
        Claude is not running for this session.
      </span>
    );
  if (error !== "") return <span style={errText}>{error}</span>;
  if (reply === null) return <span style={stateText}>Loading…</span>;
  return null;
}

/**
 * The fold both readout lists share: eight rows, a button past that, and back to eight. Returns how
 * many to show, whether that is all of them, and the button to draw when there is more than a fold.
 */
function useFold(total: number) {
  const [shown, setShown] = useState(8);
  const allShown = shown >= total;
  const button =
    total > 8 ? (
      <button
        type="button"
        style={{ ...btn, fontSize: 12, margin: "2px 10px" }}
        onClick={() => setShown(allShown ? 8 : total)}
      >
        {allShown ? "Show fewer" : `Show all ${total}`}
      </button>
    ) : null;
  return { shown, allShown, button };
}

/** Sort rank for permission behaviour: deny before ask before allow. */
const ruleRank = (r: string): number => (r === "deny" ? 0 : r === "ask" ? 1 : 2);

/**
 * The permission rules readout: one row per rule, behaviour as a pill, the CLI's own display text
 * in mono, the source beside it. The eight it shows folded are the deny and ask rules first, so what
 * a fold hides is an allow rule for as long as there are fewer than eight restrictions; unfolded it
 * is the CLI's own order, which is the order the rules are applied in.
 */
function RulesList({ rules }: { rules: PermissionRules["rules"] }) {
  const { shown, allShown, button } = useFold(rules.length);
  // Deny first, then ask, then allow — within each group the CLI's own order is preserved.
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
            padding: "3px 10px",
            fontSize: 12,
          }}
        >
          <span
            style={pill(r.behavior === "allow" ? T.ok : r.behavior === "deny" ? T.err : T.warn)}
          >
            {r.behavior}
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
            padding: "3px 10px",
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
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const running = activeClaudeSession(ctx) === sessionId;
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
      fetch(`${ROUTE}/mcp-servers?session=${encodeURIComponent(sessionId)}`)
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
        if (live) setAudit((b.turns ?? []).filter((t) => t.denials?.length).toReversed());
      })
      // An error is not an empty audit: say which one it was.
      .catch((e: Error) => live && setAuditError(e.message));
    return () => {
      live = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!running) return;
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
      setData({ ok: false, error: "This session has no working directory to inspect." });
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
      setRowNote("Clipboard write failed");
    }
  };

  if (!cwd) return null;
  return (
    <div style={bodyFlow}>
      {data === null ? (
        <span style={stateText}>Loading…</span>
      ) : !data.ok ? (
        // A reply of the wrong shape carries no message; an empty red line says nothing at all.
        <span style={errText}>{data.error || "Diagnostics could not be read."}</span>
      ) : (
        <>
          {data.session && (
            <>
              <span style={{ ...meta, padding: "2px 4px", display: "block" }}>Session</span>
              <div
                data-omc-session-row=""
                style={{
                  padding: "4px 10px",
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
                  Export as Markdown
                </button>
                <button
                  type="button"
                  style={btn}
                  data-omc-copy-resume=""
                  onClick={() => void copyResume()}
                >
                  {rowNote === "Copied" ? "Copied" : "Copy resume command"}
                </button>
                {rowNote !== "" && rowNote !== "Copied" && <span style={errText}>{rowNote}</span>}
              </div>
            </>
          )}
          {/* Runtime */}
          <span style={{ ...meta, padding: "2px 4px", display: "block" }}>Runtime</span>
          <div style={{ padding: "4px 10px", fontSize: 12, lineHeight: "1.5" }}>
            <div>
              Binary:{" "}
              <span style={{ fontFamily: T.mono }}>{data.runtime.binary || "(not found)"}</span>
            </div>
            <div>Version: {data.runtime.version || "(unknown)"}</div>
            <div>
              Plugin: {data.runtime.plugin || "(unknown)"}
              {data.runtime.latest && data.runtime.update && (
                <span style={{ marginLeft: 6 }}>
                  <UpdatePill latest={data.runtime.latest} command={data.runtime.update} />
                </span>
              )}
            </div>
            <div>
              Login:{" "}
              {data.runtime.loggedIn ? (
                <span style={{ color: T.ok }}>
                  {maskEmail(data.runtime.email || "logged in")} · {data.runtime.host}
                </span>
              ) : (
                <span style={{ color: T.err }}>
                  not logged in · Log in under Settings, Oh My Claude, Boxes, or run `claude auth
                  login`
                </span>
              )}
            </div>
            <div>
              Config dir: <span style={{ fontFamily: T.mono }}>{data.runtime.configDir}</span>
            </div>
            {data.runtime.error && <div style={{ color: T.err }}>{data.runtime.error}</div>}
          </div>

          {/* Config files */}
          <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
            Config files
          </span>
          {data.configFiles.length === 0 ? (
            <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>No config files</span>
          ) : (
            data.configFiles.map((f) => (
              <div
                key={f.scope}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderLeft: f.parseError ? `2px solid ${T.err}` : "2px solid transparent",
                  color: f.parseError ? T.err : undefined,
                }}
              >
                <div style={{ ...meta, marginBottom: 2 }}>{f.scope}</div>
                <div style={{ fontFamily: T.mono, fontSize: 11, marginBottom: 2 }}>{f.path}</div>
                {!f.exists && <div style={{ ...meta, fontSize: 11 }}>not found</div>}
                {f.parseError && <div style={{ fontSize: 11 }}>{f.parseError}</div>}
              </div>
            ))
          )}

          <SessionNotices />

          {/* The three settings that switch a tab off underneath it */}
          <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
            Feature switches
          </span>
          {switches === null ? (
            <span style={stateText}>Loading…</span>
          ) : (
            <div style={{ padding: "4px 10px", fontSize: 12, lineHeight: "1.5" }}>
              <div>
                Transcript retention: {switches.retention.days} days
                {switches.retention.scope === null
                  ? " (cleanupPeriodDays unset, so the CLI's default)"
                  : ` (cleanupPeriodDays in ${switches.retention.scope} settings)`}
                . Empties Rewind, Restore and the session browser as it sweeps.
              </div>
              <div style={{ color: switches.bypassDisabled ? T.err : undefined }}>
                Bypass permissions:{" "}
                {switches.bypassDisabled
                  ? `refused by permissions.disableBypassPermissionsMode in ${switches.bypassDisabled.scope} settings, so Full access does not take`
                  : "allowed"}
                .
              </div>
              <div style={{ color: switches.checkpointingDisabled ? T.err : undefined }}>
                File checkpoints:{" "}
                {switches.checkpointingDisabled
                  ? "off, CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING is set in dsh's environment, so a rewind cannot put files back"
                  : "on, so Rewind can put files back"}
                .
              </div>
              <div>
                At a usage limit:{" "}
                {switches.usageLimit.plugin
                  ? "this plugin waits for the reset and continues the turn"
                  : "nothing continues the turn, its Continue after limit is off"}
                . Claude Code's own autoContinueAtUsageLimit is{" "}
                {switches.usageLimit.cli === null
                  ? "unset"
                  : switches.usageLimit.cli
                    ? "on"
                    : "off"}
                , and does not act here: it drives the interactive limit dialog, which a headless
                run has no way to show.
              </div>
            </div>
          )}

          {/* MCP servers that did not come up */}
          <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
            MCP servers
          </span>
          {!running ? (
            <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>
              Claude is not running for this session.
            </span>
          ) : mcp === null ? (
            <span style={stateText}>Loading…</span>
          ) : !mcp.ok ? (
            <span style={errText}>{mcp.error}</span>
          ) : mcp.servers.every((s) => s.status === "connected") ? (
            <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>
              {mcp.servers.length === 0 ? "No MCP servers" : "All connected"}
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
                    padding: "4px 10px",
                    fontSize: 12,
                  }}
                >
                  <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <span style={{ fontFamily: T.mono }}>{s.name}</span>
                    <span style={{ ...meta, marginLeft: 6 }}>{s.status}</span>
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
                    {reconnecting === s.name ? "…" : "Reconnect"}
                  </button>
                </div>
              ))
          )}

          {/* Calls a permission rule refused. The frame names the call, never the rule. */}
          <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
            Refused calls
          </span>
          {auditError ? (
            <span style={errText}>{auditError}</span>
          ) : audit === null ? (
            <span style={stateText}>Loading…</span>
          ) : audit.length === 0 ? (
            <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>
              No calls were refused in the turns kept for this session.
            </span>
          ) : (
            audit.map((t) => (
              <div key={t.at} style={{ padding: "4px 10px", fontSize: 12 }}>
                <div style={meta}>{ago(t.at)}</div>
                {t.denials?.map((label) => (
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
            <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
              Permission rules
              {permissions?.ok && ` · ${permissions.rules.length}`}
              {permissions?.ok && permissions.managedOnly && (
                <span style={{ marginLeft: 4 }}>managed</span>
              )}
            </span>
            <ReadoutState running={running} error={permissionsError} reply={permissions} />
            {permissions?.ok &&
              (permissions.rules.length === 0 ? (
                <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>
                  This session loaded no permission rules.
                </span>
              ) : (
                <>
                  <RulesList rules={permissions.rules} />
                  {permissions.directories.length > 0 && (
                    <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>
                      {permissions.directories.length}{" "}
                      {permissions.directories.length === 1
                        ? "workspace directory"
                        : "workspace directories"}
                      {permissions.directories.length <= 3 &&
                        `: ${permissions.directories.map((d) => d.path).join(", ")}`}
                    </span>
                  )}
                </>
              ))}
          </div>
          <div data-omc-hooks="">
            <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
              Hooks
              {permissions?.ok && ` · ${permissions.hooks.length}`}
            </span>
            <ReadoutState running={running} error={permissionsError} reply={permissions} />
            {permissions?.ok &&
              (permissions.hooks.length === 0 ? (
                <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>
                  This session loaded no hooks.
                </span>
              ) : (
                <HooksList hooks={permissions.hooks} />
              ))}
          </div>

          {/* Doctor button */}
          <div style={{ padding: "6px 10px", marginTop: 8, borderTop: `1px solid ${T.border}` }}>
            <button
              type="button"
              style={doctorOutput ? btn : btnPrimary}
              onClick={runDoctor}
              disabled={doctorBusy}
            >
              {doctorBusy ? "Running…" : "Run doctor"}
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
          <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
            Report a problem
          </span>
          <div style={{ padding: "4px 10px" }}>
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
  path: string;
}

/** Error from GET /scheduled-tasks. */
interface ScheduledTasksError {
  ok: false;
  error: string;
}

/** One scheduled task, the same row whether it survives a restart or not. */
function TaskRow({ task }: { task: Task }) {
  return (
    <div style={{ padding: "4px 10px", fontSize: 12, borderLeft: `2px solid ${T.border}` }}>
      <div style={{ fontWeight: "bold" }}>{task.name}</div>
      {task.description ? <div style={{ ...meta, fontSize: 11 }}>{task.description}</div> : null}
      {task.schedule ? (
        <div style={{ ...meta, fontSize: 11 }}>Schedule: {task.schedule}</div>
      ) : null}
      {task.nextRunAt === undefined ? null : (
        <div style={{ ...meta, fontSize: 11 }}>
          Next run: {new Date(task.nextRunAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

/** Scheduled tasks and the goal the CLI is holding. Read-only: it shows what the CLI decided. */
function TasksBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const running = activeClaudeSession(ctx) === sessionId;
  const [data, setData] = useState<ScheduledTasksReply | ScheduledTasksError | null>(null);

  useEffect(() => {
    // The route reads the running session's transcript; with none there is nothing to list.
    if (!running) return;
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
  }, [running, sessionId]);

  if (!running) return null;

  return (
    <div style={bodyFlow}>
      {data === null ? (
        <span style={stateText}>Loading…</span>
      ) : !data.ok ? (
        <span style={errText}>{data.error}</span>
      ) : (
        <>
          <span style={{ ...meta, padding: "2px 4px", display: "block" }}>Goal</span>
          {data.goal ? (
            <div style={{ padding: "4px 10px", fontSize: 12, lineHeight: "1.5" }}>
              <div style={{ marginBottom: 4 }}>{data.goal.text}</div>
              <div style={{ ...meta, fontSize: 11 }}>Proposed {ago(data.goal.at)}</div>
            </div>
          ) : (
            <div style={{ ...meta, padding: "4px 10px", fontSize: 12 }}>
              No CLI goal in this session.
            </div>
          )}

          <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
            Durable tasks
          </span>
          {data.durable.length === 0 ? (
            <div style={{ ...meta, padding: "4px 10px", fontSize: 12 }}>
              <div>Nothing scheduled</div>
              <div style={{ fontSize: 11, marginTop: 4, fontFamily: T.mono }}>{data.path}</div>
            </div>
          ) : (
            data.durable.map((t) => <TaskRow key={t.name} task={t} />)
          )}

          {data.session.length > 0 ? (
            <>
              <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
                Session-only, reconstructed from this session's transcript; these die when Claude
                exits.
              </span>
              {data.session.map((t) => (
                <TaskRow key={t.name} task={t} />
              ))}
            </>
          ) : null}

          <div style={{ ...meta, padding: "2px 4px", marginTop: 8, fontSize: 11 }}>
            Read-only in this release. dsh keeps its own goal, which it does not expose to a plugin
            to read, so only the CLI's side is shown here.
          </div>
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
      if (!r.ok) return setError(r.error ?? "failed to add server");
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
    <div style={{ padding: "6px", marginTop: 8, border: `1px solid ${T.border}`, borderRadius: 4 }}>
      <select
        value={connector}
        onChange={(e) => fillFromConnector(e.currentTarget.value)}
        disabled={busy}
        style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 8 }}
      >
        <option value="">Common connector…</option>
        {CONNECTORS.map((c) => (
          <option key={c.name} value={c.name}>
            {c.label}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          placeholder="Server name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={busy}
          // minWidth:0 lets the input shrink below its content so the two selects stay on the row
          // instead of overflowing the panel's narrow column; flexWrap drops them under it when tight.
          style={{ flex: 1, minWidth: 120, padding: 4, fontSize: 12 }}
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.currentTarget.value)}
          disabled={busy}
          style={{ padding: 4, fontSize: 12 }}
        >
          <option value="local">Local</option>
          <option value="user">User</option>
          <option value="project">Project</option>
        </select>
        <select
          value={transport}
          onChange={(e) => setTransport(e.currentTarget.value)}
          disabled={busy}
          style={{ padding: 4, fontSize: 12 }}
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
            placeholder="Command, e.g. npx"
            value={command}
            onChange={(e) => setCommand(e.currentTarget.value)}
            disabled={busy}
            style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4 }}
          />
          <textarea
            placeholder="Args, one per line"
            value={args}
            onChange={(e) => setArgs(e.currentTarget.value)}
            disabled={busy}
            style={{ width: "100%", height: 50, padding: 4, fontSize: 12, marginBottom: 4 }}
          />
          <textarea
            placeholder="Env vars: KEY=value, one per line"
            value={env}
            onChange={(e) => setEnv(e.currentTarget.value)}
            disabled={busy}
            style={{ width: "100%", height: 50, padding: 4, fontSize: 12, marginBottom: 4 }}
          />
        </>
      ) : (
        <>
          <input
            type="text"
            placeholder="URL, http:// or https://"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            disabled={busy}
            style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4 }}
          />
          <textarea
            placeholder="Headers: Name: value, one per line"
            value={headers}
            onChange={(e) => setHeaders(e.currentTarget.value)}
            disabled={busy}
            style={{ width: "100%", height: 50, padding: 4, fontSize: 12, marginBottom: 4 }}
          />
        </>
      )}
      <button type="button" style={btnPrimary} disabled={busy || !name} onClick={submit}>
        {busy ? "Adding…" : "Add"}
      </button>
      {error && <span style={{ ...meta, display: "block", marginTop: 4 }}>{error}</span>}
    </div>
  );
}

/** What `GET /permission-mode` reports. */
interface PermissionModeState {
  mode: string;
  override: string | null;
  modes: string[];
  accessMode: string | null;
  ceiling: string;
  live?: boolean;
  error?: string;
}
/** What `GET /permissions` reports: the rules and hooks the session's live process loaded. */
/** What `GET /permissions` returns on success. A failure answers 409, which `readJson` throws, so
 *  the failed arm never reaches state: the reason lands in `permissionsError` instead. */
type PermissionsReply = { ok: true } & PermissionRules & HooksListing;

// The three dsh presets in strict id→label order (kept for text-fallback trigger lookup).
const PRESETS = [
  { id: "read-only", label: "Read Only" },
  { id: "workspace-write", label: "Workspace Write" },
  { id: "danger-full-access", label: "Full access" },
] as const;

// Claude mode → dsh preset it needs.
const PRESET_FOR_MODE = {
  plan: "read-only",
  default: "workspace-write",
  acceptEdits: "workspace-write",
  auto: "danger-full-access",
  dontAsk: "danger-full-access",
  bypassPermissions: "danger-full-access",
} satisfies Record<string, string>;

// Labels for the six Claude mode rows and the trigger, in key order.
const MODE_LABELS = {
  plan: "Plan · read-only",
  default: "Ask · workspace",
  acceptEdits: "Accept edits · workspace",
  auto: "Auto · full access",
  dontAsk: "Don't ask · full access",
  bypassPermissions: "Bypass · full access",
} satisfies Record<string, string>;

// Narrowed indexers so callers can use arbitrary strings without widening the object type.
const presetForMode = (m: string): string =>
  // SAFETY: PRESET_FOR_MODE has exactly the six Claude modes as keys; all paths below pass a known key.
  PRESET_FOR_MODE[m as keyof typeof PRESET_FOR_MODE];
const modeLabel = (m: string): string =>
  // SAFETY: MODE_LABELS has exactly the six Claude modes as keys; all paths below pass a known key.
  MODE_LABELS[m as keyof typeof MODE_LABELS];

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
      // Find dsh's trigger by aria-label prefix, fallback to the first matching text button.
      const form = anchorRef.current?.closest("form");
      // SAFETY: querySelectorAll returns NodeList; we cast because the selector is exact.
      const found = Array.from(
        (form ?? document).querySelectorAll<HTMLButtonElement>('button[aria-label^="Access mode"]'),
      );
      const trigger =
        found[0] ??
        Array.from((form ?? document).querySelectorAll<HTMLButtonElement>("button")).find((b) =>
          PRESETS.some((p) => b.textContent === p.label),
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
        const text = `${modeLabel(currentMode) ?? currentMode}${refused ? " ⚠" : ""}`;
        const target = labelSpan();
        if (target && target.textContent !== text) {
          lastDshLabelText = target.textContent ?? "";
          target.textContent = text;
        }
        const newAria = `Claude permission: ${text}${refused ? ", refused by settings" : ""}`;
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
          currentMode = snap.mode;
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
        // Both places dsh can put the open menu: inline under the trigger, or — from 0.1.6, which
        // renders it through `createPortal(menu, document.body)` — as a direct child of the body.
        // Looking in one place only left 0.1.6 showing dsh's three presets. Body is searched one
        // level deep, never by subtree: the portalled node is the menu itself, and a subtree scan
        // of the body per mutation is the whole transcript. Menus other plugins portal there are
        // dropped by the preset-label check below, which is what identifies ours either way.
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
          const hasPreset = menuItems.some((el) => PRESETS.some((p) => el.textContent === p.label));
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
            const found = tokens.find((t) => t.includes("selected"));
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
                .filter((t) => t !== selectedToken)
                .join(" ")
            : menuItems[0]!.className;

          // Record each original row's icon svg keyed by preset id via labels.
          const svgByPresetId: Record<string, string> = {};
          for (const el of menuItems) {
            const svgEl = el.querySelector<SVGSVGElement>("svg");
            if (!svgEl) continue;
            // SAFETY: PRESETS has exactly the three dsh preset labels as label values.
            const presetId = PRESETS.find((p) => p.label === el.textContent)?.id;
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

          // Append six new wraps in MODE_LABELS key order.
          // SAFETY: Object.keys on a const object with string keys returns string[].
          const modeKeys = Object.keys(MODE_LABELS) as string[];
          for (const m of modeKeys) {
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
                      const errEl = parent.querySelector<HTMLElement>("[data-err]");
                      if (errEl) errEl.textContent = reply.error;
                    } else {
                      fetchMode().then((next) => {
                        if (next) currentMode = next.mode;
                        reapplyLabel();
                      });
                    }
                  })
                  .catch((e) => {
                    const errEl = parent.querySelector<HTMLElement>("[data-err]");
                    if (errEl) errEl.textContent = e instanceof Error ? e.message : String(e);
                  });
              };
              if (need !== have) {
                const live = ctx.sessions.binding?.(sessionId)?.session;
                if (!live) {
                  const errEl = parent.querySelector<HTMLElement>("[data-err]");
                  if (errEl) errEl.textContent = "this session is not materialized yet";
                  return;
                }
                live
                  .command(`/permission ${need}`)
                  .then((reply) => {
                    if (!reply || !reply.ok) {
                      const errEl = parent.querySelector<HTMLElement>("[data-err]");
                      if (errEl) errEl.textContent = reply?.error?.message ?? "command failed";
                    } else {
                      setTimeout(doSet, 700);
                    }
                  })
                  .catch((e) => {
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
            note.textContent = `Full access is refused by permissions.disableBypassPermissionsMode in ${bypassRefusedIn} settings.`;
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

function AsidesBody({ sessionId }: { sessionId: string }) {
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
  if (items === null) return <span style={stateText}>Loading…</span>;
  if (items.length === 0) {
    return (
      <div style={{ ...meta, padding: "4px 10px", fontSize: 12, whiteSpace: "normal" }}>
        No asides in this session. Ask one with <code style={code}>/btw</code>. The answer docks
        above the composer instead of joining the transcript, and lands here.
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
            padding: "6px 10px",
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
                <span style={asidePill(T.faint)}>waiting</span>
              ) : it.error !== undefined ? (
                <span style={asidePill(T.err)}>error</span>
              ) : null}
              {it.dismissed === true ? <span style={asidePill(T.faint)}>dismissed</span> : null}
              <span style={{ ...meta, fontSize: 11 }}>{ago(it.at)}</span>
              <button
                type="button"
                data-omc-aside-copy={it.id}
                style={{ ...btn, fontSize: 11, padding: "1px 8px", lineHeight: "16px" }}
                aria-label={copied === it.id ? "Copied" : "Copy aside"}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  copy(it);
                }}
              >
                {copied === it.id ? "Copied" : "Copy"}
              </button>
            </span>
            {it.question}
          </summary>
          <div
            style={{
              marginTop: 4,
              maxHeight: "40vh",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: it.error !== undefined ? T.err : T.faint,
            }}
          >
            {it.pending ? "Waiting for an answer…" : (it.answer ?? it.error ?? "")}
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
  const maxHeight = useAnchoredMaxHeight(panelRef, 400, open);
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
  const close = useCallback(() => {
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
  // In the card the panel only fades: dsh's `useAnchoredMaxHeight` measures the element's bottom
  // on mount, and a 6 px rise still applied at that moment would size it 6 px too tall.
  Object.assign(panelStyle, {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    opacity: shown ? 1 : 0,
    transform: shown || card ? "none" : "translateY(6px)",
    transition: `opacity ${easeMs()}ms ease, transform ${easeMs()}ms ease`,
  } satisfies CSSProperties);

  const tabs = [
    ...(blank ? [{ key: "Restore", label: "Restore" }] : []),
    { key: "Memory", label: "Memory" },
    { key: "Instructions", label: "Instructions" },
    { key: "Skills", label: "Skills" },
    { key: "Rewind", label: "Rewind" },
    { key: "Changes", label: "Changes" },
    { key: "MCP", label: "MCP" },
    { key: "Asides", label: "Asides" },
    { key: "Diagnostics", label: "Diagnostics" },
    { key: "Tasks", label: "Tasks" },
    { key: "Tune", label: "Tune" },
  ] as const;
  // Fall back when an earlier session stored a tab no longer present (e.g. removed Permissions).
  // SAFETY: tabs is const-as, so t.key is a literal string; the map produces string[].
  if (!(tabs.map((t) => t.key) as readonly string[]).includes(lastTab)) lastTab = "Memory";

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
      {open &&
        portal(
          card,
          <div
            ref={panelRef}
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
                padding: "4px 0",
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
              style={{
                display: "flex",
                flex: "0 0 auto",
                borderTop: `1px solid color-mix(in srgb, ${PANEL_ACCENT} 18%, ${T.border})`,
                paddingTop: 4,
                gap: 2,
                // Wrap rather than scroll sideways: a strip that scrolls hides the tab that did not
                // fit, and the panel is anchored to its bottom edge, so a second row grows upward.
                flexWrap: "wrap",
                rowGap: 4,
              }}
            >
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  data-omc-label={t.label}
                  id={`omc-tab-${t.key}`}
                  aria-controls="omc-tabpanel"
                  aria-selected={tab === t.key}
                  // The strip sits under the body, so the lit edge is the mirror of a top tab bar:
                  // accent along the bottom, corners rounded on that side only, no box around each
                  // tab (nine bordered boxes read as buttons, not as tabs). Hover is in the sheet.
                  style={tabStyle(tab === t.key)}
                  onClick={() => {
                    lastTab = t.key;
                    setTab(t.key);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>,
        )}
    </span>
  );
}

/** Render `node` inside dsh's composer card when one was found, else in place. */
const portal = (card: HTMLElement | null, node: ReactElement) =>
  card ? createPortal(node, card) : node;
