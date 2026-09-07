import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  btn,
  btnPrimary,
  bodyFlow,
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
  code,
  openHere,
  CLAUDE_ORANGE,
  CLAUDE_MARK,
  maskEmail,
} from "./shared.js";
import { TuneBody } from "./tune.js";

// Module-level variable so reopening lands on the last picked tab.
let lastTab = "Memory";

/**
 * How long the panel fades and the Add form collapses. Short enough to stay out of the way of a
 * second click, and zero for a reader who asked the platform for no motion.
 */
const easeMs = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 140;

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
function InstructionsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = useState<InstructionFile[]>([]);
  const [file, setFile] = useState<InstructionFile | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const q = cwd ? `cwd=${encodeURIComponent(cwd)}` : "";
  const refresh = () => {
    if (!cwd) return;
    fetch(`${ROUTE}/instructions?${q}`)
      .then((r) => readJson<{ files?: InstructionFile[] }>(r))
      .then((b) => setFiles(b.files ?? []))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    refresh();
  }, [cwd]);

  const openFile = async (f: InstructionFile) => {
    setError("");
    try {
      const body = await readJson<{ text: string }>(
        await fetch(`${ROUTE}/instructions/file?${q}&path=${encodeURIComponent(f.path)}`),
      );
      setFile(f);
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
        await fetch(`${ROUTE}/instructions/file`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, path: file.path, text }),
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

  // An empty list is a workspace with no CLAUDE.md; a failed list is the error, not an empty one.
  if (!cwd || files.length === 0)
    return (
      <span style={{ ...meta, padding: "4px 10px", color: error ? T.err : undefined }}>
        {error || "No instructions for this workspace."}
      </span>
    );
  const dirty = text !== saved;

  return (
    <div style={bodyFlow}>
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
  error?: string;
  /** Bare tool names the server contributes; absent when the session has seen no init frame. */
  tools?: string[];
}
type McpReply = { ok: true; servers: McpServer[] } | { ok: false; error: string };

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

  const remove = async (serverName: string) => {
    setBusy(serverName);
    setNote("");
    try {
      const r = await readJson<{ ok: boolean; error?: string }>(
        await fetch(`${ROUTE}/mcp-servers/remove`, {
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
  const servers = reply?.ok ? reply.servers : [];
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
          <McpAddForm sessionId={sessionId} onAdded={() => setNote(SPAWN_NOTE)} />
        </div>
      </div>
      {reply === null ? (
        <span style={{ ...meta, padding: "2px 4px" }}>Loading…</span>
      ) : !reply.ok ? (
        <span style={{ color: T.err, fontSize: 12 }}>{reply.error}</span>
      ) : servers.length === 0 ? (
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
              <span style={{ ...meta, flex: "none" }}>{s.status}</span>
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
              <button
                type="button"
                style={btn}
                disabled={busy !== null}
                onClick={() => remove(s.name)}
              >
                {busy === s.name ? "…" : "Remove"}
              </button>
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
          </div>
        ))
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
    error?: string;
  };
  configFiles: Array<{ scope: string; path: string; exists: boolean; parseError?: string }>;
}
type DiagnosticsError = { ok: false; error: string };
/** The slice of a turn record this tab reads: when the turn ran, and the calls a rule refused. */
interface DeniedTurn {
  at: number;
  denials?: string[];
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
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);
  const [doctorError, setDoctorError] = useState("");
  const [doctorBusy, setDoctorBusy] = useState(false);

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
    fetch(`${ROUTE}/diagnostics?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => readJson<DiagnosticsReply | DiagnosticsError>(r))
      .then((b) => live && setData(b))
      .catch((e: Error) => live && setData({ ok: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [cwd]);

  const runDoctor = async () => {
    setDoctorBusy(true);
    setDoctorError("");
    try {
      const r = await readJson<{ out?: string; error?: string }>(
        await fetch(`${ROUTE}/diagnostics/doctor`, { method: "POST" }),
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

  if (!cwd) return null;
  return (
    <div style={bodyFlow}>
      {data === null ? (
        <span style={{ ...meta, padding: "2px 4px" }}>Loading…</span>
      ) : !data.ok ? (
        // A reply of the wrong shape carries no message; an empty red line says nothing at all.
        <span style={{ color: T.err, fontSize: 12 }}>
          {data.error || "Diagnostics could not be read."}
        </span>
      ) : (
        <>
          {/* Runtime */}
          <span style={{ ...meta, padding: "2px 4px", display: "block" }}>Runtime</span>
          <div style={{ padding: "4px 10px", fontSize: 12, lineHeight: "1.5" }}>
            <div>
              Binary:{" "}
              <span style={{ fontFamily: T.mono }}>{data.runtime.binary || "(not found)"}</span>
            </div>
            <div>Version: {data.runtime.version || "(unknown)"}</div>
            <div>
              Login:{" "}
              {data.runtime.loggedIn ? (
                <span style={{ color: T.ok }}>
                  {maskEmail(data.runtime.email || "logged in")} · {data.runtime.host}
                </span>
              ) : (
                <span style={{ color: T.err }}>not logged in · run `claude auth login`</span>
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

          {/* MCP servers that did not come up */}
          <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
            MCP servers
          </span>
          {!running ? (
            <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>
              Claude is not running for this session.
            </span>
          ) : mcp === null ? (
            <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>Loading…</span>
          ) : !mcp.ok ? (
            <span style={{ color: T.err, fontSize: 12, padding: "2px 4px" }}>{mcp.error}</span>
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
            <span style={{ color: T.err, fontSize: 12, padding: "2px 4px" }}>{auditError}</span>
          ) : audit === null ? (
            <span style={{ ...meta, padding: "2px 4px", fontSize: 12 }}>Loading…</span>
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
    fetch(`${ROUTE}/scheduled-tasks?session=${encodeURIComponent(sessionId)}`)
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
        <span style={{ ...meta, padding: "2px 4px" }}>Loading…</span>
      ) : !data.ok ? (
        <span style={{ color: T.err, fontSize: 12 }}>{data.error}</span>
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
              <div>Nothing scheduled.</div>
              <div style={{ fontSize: 11, marginTop: 4, fontFamily: T.mono }}>{data.path}</div>
            </div>
          ) : (
            data.durable.map((t) => <TaskRow key={t.name} task={t} />)
          )}

          {data.session.length > 0 ? (
            <>
              <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
                Session-only — reconstructed from this session's transcript; these die when Claude
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

/** The Add form under the server list: name, where it goes, and the fields its transport needs. */
function McpAddForm({ sessionId, onAdded }: { sessionId: string; onAdded: () => void }) {
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

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await readJson<{ ok: boolean; error?: string }>(
        await fetch(`${ROUTE}/mcp-servers/add`, {
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
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "6px", marginTop: 8, border: `1px solid ${T.border}`, borderRadius: 4 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          placeholder="server name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={busy}
          style={{ flex: 1, padding: 4, fontSize: 12 }}
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
            placeholder="command, e.g. npx"
            value={command}
            onChange={(e) => setCommand(e.currentTarget.value)}
            disabled={busy}
            style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4 }}
          />
          <textarea
            placeholder="args, one per line"
            value={args}
            onChange={(e) => setArgs(e.currentTarget.value)}
            disabled={busy}
            style={{ width: "100%", height: 50, padding: 4, fontSize: 12, marginBottom: 4 }}
          />
          <textarea
            placeholder="env vars: KEY=value, one per line"
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
            placeholder="url, http:// or https://"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            disabled={busy}
            style={{ width: "100%", padding: 4, fontSize: 12, marginBottom: 4 }}
          />
          <textarea
            placeholder="headers: Name: value, one per line"
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
        const text = modeLabel(currentMode) ?? currentMode;
        const target = labelSpan();
        if (target && target.textContent !== text) {
          lastDshLabelText = target.textContent ?? "";
          target.textContent = text;
        }
        const newAria = `Claude permission: ${text}`;
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

      const parent = trigger.parentElement;
      if (!parent)
        return () => {
          labelObserver.disconnect();
        };

      // Watch for dsh's menu to appear and inject our rows into its viewport.
      const menuObserver = new MutationObserver(() => {
        if (!parent.isConnected) return;
        const menus = Array.from(parent.querySelectorAll<HTMLElement>('[role="menu"]'));
        for (const dshMenu of menus) {
          if (dshMenu.getAttribute("data-dsh-oh-my-claude")) continue;
          const menuItems = Array.from(dshMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
          const hasPreset = menuItems.some((el) => PRESETS.some((p) => el.textContent === p.label));
          if (!hasPreset) continue;

          dshMenu.setAttribute("data-dsh-oh-my-claude", "1");

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

          // Error wrap at the bottom.
          const errWrap = document.createElement("div");
          errWrap.setAttribute("data-err", "1");
          Object.assign(errWrap.style, { ...meta, color: T.err, padding: "8px 10px" });
          viewport.appendChild(errWrap);
        }
      });
      menuObserver.observe(parent, { childList: true, subtree: true });

      return () => {
        labelObserver.disconnect();
        menuObserver.disconnect();
        // Restore trigger's label text and aria-label to what dsh last rendered.
        // Give dsh back its own label and aria-label.
        const restoreTarget = labelSpan();
        if (restoreTarget && lastDshLabelText) restoreTarget.textContent = lastDshLabelText;
        if (lastDshAriaLabel) trigger.setAttribute("aria-label", lastDshAriaLabel);
        // If a marked menu is currently open, unhide original wraps and remove ours.
        const markedMenu = parent.querySelector<HTMLElement>(
          '[role="menu"][data-dsh-oh-my-claude]',
        );
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

/**
 * Single consolidated trigger for the Oh My Claude panel. One button replaces the five legacy
 * composer-slot buttons (Restore, Memory, Rewind, Changes, MCP). Clicking it opens a tabbed
 * dialog whose body is each legacy control's dialog content, moved verbatim into a body component.
 */
export function OhMyClaudeControl({ sessionId, ctx }: import("./shared.js").RestoreButtonProps) {
  const isMine = activeClaudeSession(ctx) === sessionId;
  // `open` is what is mounted, `shown` is what the transition draws. A close flips `shown` first
  // and unmounts a duration later, so the panel fades out instead of blinking away.
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rootRef = useRef<HTMLSpanElement>(null);
  const narrow = useNarrow();
  const [tab, setTab] = useState(lastTab);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  // Stable callback: a fresh arrow each render would re-run MemoryBody's fetch effect every time.
  const onCount = useCallback((n: number) => setMemoryCount(n), []);
  // Phone sheet: fixed, above the control, wherever the composer sits (a blank session centres it).
  const [above, setAbove] = useState(0);

  useEffect(() => {
    if (!open) return;
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

  useDismiss(open, close, rootRef);

  if (!isMine) return null;
  // Restore only fits a blank session; the Restore body hides itself for the same reason.
  const blank = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.blank !== false;

  // Centred in the viewport, not hung off the button: the trigger sits at the right end of the
  // composer, so a panel anchored to it runs past the right edge and grows a horizontal scrollbar
  // on the whole page. Fixed also lifts it out of the composer's own scrolling box.
  // z-index above dsh's menus and hover cards (100, 101) and below its modals (1000), so a dsh
  // dialog still covers the panel while the chat-history resize handle no longer draws over it.
  // overflow hidden so the body is the only scroller and the tab strip cannot scroll out of it.
  const panelStyle: CSSProperties = {
    position: "fixed",
    // Centred by a left/right inset and auto margins rather than 50% plus a translate: `100vw`
    // counts the page's scrollbar, so any width measured from it can sit a few pixels past the
    // right edge and give the whole page a horizontal scrollbar. An inset cannot.
    left: 12,
    right: 12,
    marginInline: "auto",
    bottom: above,
    width: narrow ? "auto" : "min(560px, 100%)",
    // dvh, not vh: on a phone the browser chrome slides away and vh keeps measuring the tall value.
    maxHeight: narrow ? "60dvh" : "min(400px, 80dvh)",
    zIndex: 200,
    display: "flex",
    flexDirection: "column",
    padding: 6,
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,.18)",
    overflow: "hidden",
    opacity: shown ? 1 : 0,
    // Insets do the centring now, so the transform carries the rise alone.
    transform: shown ? "none" : "translateY(6px)",
    transition: `opacity ${easeMs()}ms ease, transform ${easeMs()}ms ease`,
  };

  const tabs = [
    ...(blank ? [{ key: "Restore", label: "Restore" }] : []),
    { key: "Memory", label: `Memory${memoryCount !== null ? ` · ${memoryCount}` : ""}` },
    { key: "Instructions", label: "Instructions" },
    { key: "Rewind", label: "Rewind" },
    { key: "Changes", label: "Changes" },
    { key: "MCP", label: "MCP" },
    { key: "Diagnostics", label: "Diagnostics" },
    { key: "Tasks", label: "Tasks" },
    { key: "Tune", label: "Tune" },
  ] as const;
  // Fall back when an earlier session stored a tab no longer present (e.g. removed Permissions).
  // SAFETY: tabs is const-as, so t.key is a literal string; the map produces string[].
  if (!(tabs.map((t) => t.key) as readonly string[]).includes(lastTab)) lastTab = "Memory";

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
          if (open) {
            close();
            return;
          }
          setTab(lastTab === "Restore" && !blank ? "Memory" : lastTab);
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect) setAbove(Math.max(12, window.innerHeight - rect.top + 8));
          openPanel();
        }}
      >
        {CLAUDE_MARK}
      </button>
      {open && (
        <div role="dialog" aria-label="Oh My Claude" style={panelStyle}>
          <div
            role="tabpanel"
            style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "4px 0" }}
          >
            {tab === "Restore" && <RestoreBody sessionId={sessionId} ctx={ctx} onClose={close} />}
            {tab === "Memory" && <MemoryBody sessionId={sessionId} ctx={ctx} onCount={onCount} />}
            {tab === "Instructions" && <InstructionsBody sessionId={sessionId} ctx={ctx} />}
            {tab === "Rewind" && <RewindBody sessionId={sessionId} ctx={ctx} onClose={close} />}
            {tab === "Changes" && <ChangesBody sessionId={sessionId} ctx={ctx} />}
            {tab === "MCP" && <McpBody sessionId={sessionId} ctx={ctx} onClose={close} />}
            {tab === "Diagnostics" && <DiagnosticsBody sessionId={sessionId} ctx={ctx} />}
            {tab === "Tasks" && <TasksBody sessionId={sessionId} ctx={ctx} />}
            {tab === "Tune" && <TuneBody sessionId={sessionId} />}
          </div>
          {/* Under the body, not over it: the panel is anchored to its bottom edge, so a taller tab
              pushes the top up and leaves the strip where the pointer left it. */}
          <div
            role="tablist"
            style={{
              display: "flex",
              flex: "0 0 auto",
              borderTop: `1px solid ${T.border}`,
              paddingTop: 6,
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
                aria-selected={tab === t.key}
                style={{
                  ...btn,
                  fontSize: 12,
                  // The strip sits under the body, so the lit edge is the mirror of a top tab bar:
                  // accent along the bottom, and the corners rounded on that side only.
                  borderBottom:
                    tab === t.key ? `2px solid ${CLAUDE_ORANGE}` : "2px solid transparent",
                  borderRadius: "0 0 8px 8px",
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
        </div>
      )}
    </span>
  );
}
