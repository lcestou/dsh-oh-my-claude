import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  btn,
  btnPrimary,
  bodyFlow,
  select,
  meta,
  T,
  readJson,
  ROUTE,
  ago,
  isOwnedActive,
  activeClaudeSession,
  type ClientCtx,
  type SessionData,
  useNarrow,
  useDismiss,
  popover,
  code,
  openHere,
  CLAUDE_ORANGE,
  CLAUDE_MARK,
} from "./shared.js";

// Module-level variable so reopening lands on the last picked tab.
let lastTab = "Memory";

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
  const [transcripts, setTranscripts] = useState<SessionData[]>([]);

  useEffect(() => {
    if (!cwd) return;
    let live = true; // the composer unmounts on session switch; drop a late reply
    fetch(`${ROUTE}/sessions?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => readJson<{ sessions?: SessionData[] }>(r))
      .then((body) => live && setTranscripts(body.sessions ?? []))
      .catch(() => live && setTranscripts([]));
    return () => {
      live = false;
    };
  }, [cwd]);

  // Hide when the session already has content, the workspace is unknown, or nothing to restore.
  if (!cwd || entry?.blank === false) return null;
  const owned = transcripts.filter(isOwnedActive);
  const rest = transcripts.filter((s) => !isOwnedActive(s)).slice(0, 8);
  if (rest.length === 0) return null;

  return (
    <div style={bodyFlow}>
      {rest.map((s) => (
        <TranscriptRow key={s.id} s={s} cwd={cwd} ctx={ctx} onClose={onClose} />
      ))}
      {owned.length > 0 && (
        <span style={{ fontSize: 11, color: T.faint, padding: "2px 4px" }}>
          {owned.length} already open
        </span>
      )}
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
function MemoryBody({
  sessionId,
  ctx,
  onCount,
}: {
  sessionId: string;
  ctx: ClientCtx;
  onCount?: (n: number) => void;
}) {
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const q = cwd ? `cwd=${encodeURIComponent(cwd)}` : "";
  const refresh = () => {
    if (!cwd) return;
    fetch(`${ROUTE}/memory?${q}`)
      .then((r) => readJson<{ files?: MemoryFile[] }>(r))
      .then((b) => {
        setFiles(b.files ?? []);
        onCount?.(b.files?.length ?? 0);
      })
      .catch((e: Error) => setError(e.message));
  };
  // Re-list every half minute: Claude writes memories mid-turn.
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [cwd, onCount]);

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
        await fetch(`${ROUTE}/memory`, {
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

  if (!cwd || files.length === 0) return null;
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
            <span style={{ flex: "none", fontFamily: T.mono, fontSize: 12 }}>{f.name}</span>
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
      {error && <span style={{ color: T.err, fontSize: 12 }}>{error}</span>}
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

  useEffect(() => {
    if (!cwd) return;
    let live = true;
    setPicked(null);
    setPreview(null);
    setError("");
    fetch(`${ROUTE}/rewind?session=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}`)
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
  return (
    <div style={bodyFlow}>
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
      {error && <span style={{ color: T.err, fontSize: 12 }}>{error}</span>}
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
 * "Changes" body rendered inside the Oh My Claude dialog: the CLI's own working-tree
 * diff (`get_workspace_diff`), one row per file with its line counts, a row unfolds its hunks.
 */
function ChangesBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const isClaude = activeClaudeSession(ctx) === sessionId;
  const [reply, setReply] = useState<DiffReply | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReply(null);
    setShown(null);
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
      {reply === null ? (
        <span style={{ ...meta, padding: "2px 4px" }}>Loading…</span>
      ) : !reply.ok ? (
        <span style={{ color: T.err, fontSize: 12 }}>{reply.error}</span>
      ) : current ? (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 4px" }}>
            <button type="button" style={btn} onClick={() => setShown(null)}>
              ‹ Back
            </button>
            <span style={{ fontSize: 13, fontFamily: "monospace" }}>{current.path}</span>
            <span style={{ ...meta, marginLeft: "auto" }}>
              +{current.added} −{current.removed}
            </span>
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
            {reply.filesCount === 0
              ? "Working tree clean"
              : `${reply.filesCount} files, +${reply.linesAdded} −${reply.linesRemoved}`}
          </span>
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
              onClick={() => setShown(f.path)}
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
                {f.untracked ? "new" : f.binary ? "binary" : `+${f.added} −${f.removed}`}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

interface McpServer {
  name: string;
  status: string;
  version?: string;
}
type McpReply = { ok: true; servers: McpServer[] } | { ok: false; error: string };

/**
 * "MCP" body rendered inside the Oh My Claude dialog: the servers Claude's process
 * has, with their connection status, and a Reconnect per row (`mcp_reconnect`).
 */
function McpBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx; onClose: () => void }) {
  const isClaude = activeClaudeSession(ctx) === sessionId;
  const [reply, setReply] = useState<McpReply | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = () =>
    fetch(`${ROUTE}/mcp-servers?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<McpReply>(r))
      .then(setReply)
      .catch((e: Error) => setReply({ ok: false, error: e.message }));
  useEffect(() => {
    setReply(null);
    setNote("");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load closes over sessionId only
  }, [sessionId]);

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
  const servers = reply?.ok ? reply.servers : [];
  return (
    <div style={bodyFlow}>
      {reply === null ? (
        <span style={{ ...meta, padding: "2px 4px" }}>Loading…</span>
      ) : !reply.ok ? (
        <span style={{ color: T.err, fontSize: 12 }}>{reply.error}</span>
      ) : servers.length === 0 ? (
        <span style={{ ...meta, padding: "2px 4px" }}>No MCP servers</span>
      ) : (
        servers.map((s) => (
          <div
            key={s.name}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" }}
          >
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
            <span style={{ ...meta, flex: "none" }}>{s.status}</span>
            <button
              type="button"
              style={btn}
              disabled={busy !== null}
              onClick={() => reconnect(s.name)}
            >
              {busy === s.name ? "…" : "Reconnect"}
            </button>
          </div>
        ))
      )}
      {note && <span style={{ ...meta, padding: "2px 4px" }}>{note}</span>}
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

/**
 * "Permissions" body rendered inside the Oh My Claude dialog: a select over Claude's permission
 * modes, with "config" meaning no override. A change is stored per session and pushed to a live process.
 */
function PermissionsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const [state, setState] = useState<PermissionModeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isClaude = activeClaudeSession(ctx) === sessionId;

  useEffect(() => {
    if (!isClaude) return;
    let alive = true;
    fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<PermissionModeState>(r))
      .then((b) => alive && setState(b))
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [sessionId, isClaude]);

  if (!isClaude || !state) return null;
  const change = async (value: string) => {
    setBusy(true);
    setError("");
    try {
      const reply = await readJson<PermissionModeState>(
        await fetch(`${ROUTE}/permission-mode`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, mode: value || null }),
        }),
      );
      setState({ ...state, ...reply });
      if (reply.error) setError(reply.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={bodyFlow}>
      <span style={{ color: T.faint, fontSize: 12 }}>
        dsh access {state.accessMode ?? "unknown"} → Claude {state.ceiling}
      </span>
      <span style={{ color: T.faint, fontSize: 12 }}>
        Override can only be stricter than the shield.
      </span>
      {state.modes.length > 1 && (
        <select
          aria-label="Claude permission mode"
          value={state.override ?? ""}
          disabled={busy}
          onChange={(e) => change(e.currentTarget.value)}
          title={
            state.override
              ? `Permission mode ${state.mode}, set for this session`
              : `Permission mode ${state.mode}, from the plugin config`
          }
          style={{
            ...select,
            fontSize: 13,
            padding: "5px 8px",
            color: state.override ? CLAUDE_ORANGE : T.text,
          }}
        >
          <option value="">config · {state.mode}</option>
          {state.modes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      {(state.override || state.modes.length <= 1) && (
        <button type="button" style={btn} onClick={() => change("")}>
          Use config
        </button>
      )}
      {error && <span style={{ color: T.err, fontSize: 11 }}>{error}</span>}
    </div>
  );
}

/**
 * Single consolidated trigger for the Oh My Claude panel. One button replaces the five legacy
 * composer-slot buttons (Restore, Memory, Rewind, Changes, MCP). Clicking it opens a tabbed
 * dialog whose body is each legacy control's dialog content, moved verbatim into a body component.
 */
export function OhMyClaudeControl({ sessionId, ctx }: import("./shared.js").RestoreButtonProps) {
  const isMine = activeClaudeSession(ctx) === sessionId;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const narrow = useNarrow();
  const [tab, setTab] = useState(lastTab);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  // Stable callback: a fresh arrow each render would re-run MemoryBody's fetch effect every time.
  const onCount = useCallback((n: number) => setMemoryCount(n), []);
  // Phone sheet: fixed, above the control, wherever the composer sits (a blank session centres it).
  const [above, setAbove] = useState(0);

  useDismiss(open, () => setOpen(false), rootRef);

  if (!isMine) return null;
  // Restore only fits a blank session; the Restore body hides itself for the same reason.
  const blank = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.blank !== false;

  const panelStyle: CSSProperties = narrow
    ? {
        position: "fixed",
        left: 12,
        right: 12,
        bottom: above,
        width: "auto",
        maxHeight: "60vh",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        padding: 6,
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,.18)",
        overflow: "hidden",
      }
    : { ...popover, width: "min(560px, calc(100vw - 24px))", maxHeight: 400 };

  const tabs = [
    ...(blank ? [{ key: "Restore", label: "Restore" }] : []),
    { key: "Memory", label: `Memory${memoryCount !== null ? ` · ${memoryCount}` : ""}` },
    { key: "Rewind", label: "Rewind" },
    { key: "Changes", label: "Changes" },
    { key: "MCP", label: "MCP" },
    { key: "Permissions", label: "Permissions" },
  ] as const;

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        // Same box as dsh's own composer icons (22 px, no border, 6 px radius); the mark at 18 px
        // reads at the size of their 14 px strokes.
        style={{
          width: 22,
          height: 22,
          padding: 0,
          border: "none",
          borderRadius: 6,
          background: open ? T.hover : "transparent",
          color: CLAUDE_ORANGE,
          fontSize: 18,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
        aria-label="Oh My Claude"
        title="Oh My Claude: memory, rewind, changes, MCP"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setTab(lastTab === "Restore" && !blank ? "Memory" : lastTab);
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect) setAbove(Math.max(12, window.innerHeight - rect.top + 8));
          setOpen((v) => !v);
        }}
      >
        {CLAUDE_MARK}
      </button>
      {open && (
        <div role="dialog" aria-label="Oh My Claude" style={panelStyle}>
          <div
            role="tablist"
            style={{
              display: "flex",
              borderBottom: `1px solid ${T.border}`,
              paddingBottom: 6,
              overflowX: "auto",
              whiteSpace: "nowrap",
            }}
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                style={{
                  ...btn,
                  fontSize: 12,
                  borderBottom:
                    tab === t.key ? `2px solid ${CLAUDE_ORANGE}` : "2px solid transparent",
                  color: tab === t.key ? T.text : T.faint,
                  marginBottom: -1,
                  paddingBottom: 4,
                }}
                onClick={() => {
                  lastTab = t.key;
                  setTab(t.key);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "4px 0" }}
          >
            {tab === "Restore" && (
              <RestoreBody sessionId={sessionId} ctx={ctx} onClose={() => setOpen(false)} />
            )}
            {tab === "Memory" && <MemoryBody sessionId={sessionId} ctx={ctx} onCount={onCount} />}
            {tab === "Rewind" && (
              <RewindBody sessionId={sessionId} ctx={ctx} onClose={() => setOpen(false)} />
            )}
            {tab === "Changes" && <ChangesBody sessionId={sessionId} ctx={ctx} />}
            {tab === "MCP" && (
              <McpBody sessionId={sessionId} ctx={ctx} onClose={() => setOpen(false)} />
            )}
            {tab === "Permissions" && <PermissionsBody sessionId={sessionId} ctx={ctx} />}
          </div>
        </div>
      )}
    </span>
  );
}
