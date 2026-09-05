// Browser half: Settings → "Claude Code". Two cards: the session browser (transcripts of a
// workspace, terminal or dsh, opened or restored as dsh sessions) and an editor for Claude Code's
// own settings.json (hooks, permissions, model, env). Built into lib/client.js by `bun run build`.
import { useEffect, useMemo, useState } from "react";

/** Plugin name identifier. */
export const name = "dsh-llm-claude-client";
/** Services injected into the client plugin by dsh. */
export const inject = ["slots", "sessions", "workspaces"];

const ROUTE = "/dsh-llm-claude";

const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};

const size = (bytes) =>
  bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

// dsh's design tokens (`--dsw-alias-*`) with plain fallbacks for any other host theme.
const T = {
  text: "var(--dsw-alias-label-primary, inherit)",
  muted: "var(--dsw-alias-label-secondary, rgba(128,128,128,.9))",
  faint: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.7))",
  border: "var(--dsw-alias-border-l2, rgba(128,128,128,.22))",
  card: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))",
  field: "var(--dsw-alias-bg-base, transparent)",
  brand: "var(--dsw-alias-brand-primary, #3b82f6)",
  ok: "var(--dsw-alias-state-success-primary, #22a06b)",
  warn: "var(--dsw-alias-state-warn-primary, #d9822b)",
  err: "var(--dsw-alias-state-error-primary, #d33)",
  mono: "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  onBrand: "var(--dsw-alias-label-primary-inverted, #fff)",
};

const card = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: "16px 18px",
  marginTop: 16,
};
const cardHead = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 10,
};
const h3 = { margin: 0, fontSize: 15, fontWeight: 600, color: T.text };
const meta = { color: T.faint, fontSize: 12, whiteSpace: "nowrap" };
const row = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "9px 0",
  borderTop: `1px solid ${T.border}`,
};
const btn = {
  padding: "5px 12px",
  cursor: "pointer",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.text,
  fontSize: 13,
};
const btnPrimary = {
  ...btn,
  background: T.brand,
  color: T.onBrand,
  border: "1px solid transparent",
};
const pill = (color) => ({
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.2,
  color,
  border: `1px solid ${color}`,
  opacity: 0.9,
  whiteSpace: "nowrap",
});
const code = {
  width: "100%",
  boxSizing: "border-box",
  padding: 12,
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.field,
  color: T.text,
  fontFamily: T.mono,
  fontSize: 13,
  lineHeight: 1.5,
  tabSize: 2,
  whiteSpace: "pre",
};
const select = {
  padding: "4px 8px",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.field,
  color: T.text,
  fontSize: 13,
};

const readJson = async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
};

/** Where a transcript lives: terminal only, a live dsh session, or an archived one. */
function Origin({ s }) {
  if (!s.dsh) return <span style={pill(T.faint)}>terminal</span>;
  if (s.dsh.archived) return <span style={pill(T.warn)}>dsh · archived</span>;
  return <span style={pill(T.brand)}>dsh</span>;
}

/** Facts worth a glance before opening the editor. */
export function summarize(settings) {
  if (!settings || typeof settings !== "object") return [];
  const out = [];
  const count = (v) =>
    Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0;
  if (settings.model) out.push(["model", String(settings.model)]);
  if (settings.hooks && typeof settings.hooks === "object") {
    const events = Object.keys(settings.hooks);
    const hooks = events.reduce(
      (n, e) =>
        n +
        (Array.isArray(settings.hooks[e])
          ? settings.hooks[e].reduce(
              (m, g) => m + (Array.isArray(g?.hooks) ? g.hooks.length : 1),
              0,
            )
          : 0),
      0,
    );
    out.push(["hooks", `${hooks} on ${events.length} event${events.length === 1 ? "" : "s"}`]);
  }
  const p = settings.permissions;
  if (p && typeof p === "object") {
    const parts = ["allow", "ask", "deny"]
      .filter((k) => count(p[k]) > 0)
      .map((k) => `${count(p[k])} ${k}`);
    if (p.defaultMode) parts.unshift(String(p.defaultMode));
    if (parts.length) out.push(["permissions", parts.join(" · ")]);
  }
  if (count(settings.env) > 0)
    out.push(["env", `${count(settings.env)} var${count(settings.env) === 1 ? "" : "s"}`]);
  if (count(settings.enabledPlugins) > 0)
    out.push(["plugins", `${count(settings.enabledPlugins)} enabled`]);
  if (settings.statusLine) out.push(["statusLine", "set"]);
  return out;
}

/**
 * `~/.claude/settings.json`: read-only view until Edit is pressed, then a textarea with live JSON
 * check, Save (Ctrl/Cmd+S) and Cancel. The gate exists so browsing the panel can never change
 * the file by accident.
 */
function SettingsEditor() {
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = () => {
    setBusy(true);
    setError("");
    fetch(`${ROUTE}/settings`)
      .then(readJson)
      .then((body) => {
        setFile(body);
        setText(body.text);
        setEditing(false);
        setSaved("");
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };
  useEffect(load, []);

  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value))
        return { error: "settings.json must be a JSON object" };
      return { value };
    } catch (e) {
      return { error: String(e.message ?? e) };
    }
  }, [text]);
  const dirty = file !== null && text !== file.text;
  const canSave = dirty && !parsed.error && !busy;

  const save = () => {
    if (!canSave) return;
    setBusy(true);
    setError("");
    fetch(`${ROUTE}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then(readJson)
      .then((body) => {
        setFile((f) => ({ ...f, text, exists: true, mtime: body.mtime }));
        setEditing(false);
        setSaved(
          `Saved ${new Date(body.mtime).toLocaleTimeString()} · previous copy in ${body.backup}`,
        );
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };

  const facts = summarize(parsed.value);
  return (
    <section id="dsh-llm-claude-settings" style={card}>
      <div style={cardHead}>
        <div>
          <h3 style={h3}>settings.json</h3>
          <div style={{ ...meta, fontFamily: T.mono, marginTop: 2, whiteSpace: "normal" }}>
            {file?.path ?? "…"}
            {file && !file.exists ? " · not created yet" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {editing ? (
            <>
              <button
                id="dsh-llm-claude-settings-cancel"
                type="button"
                style={btn}
                disabled={busy}
                onClick={() => {
                  setText(file?.text ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                id="dsh-llm-claude-settings-save"
                type="button"
                style={{ ...btnPrimary, opacity: canSave ? 1 : 0.5 }}
                disabled={!canSave}
                onClick={save}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <>
              <button type="button" style={btn} disabled={busy} onClick={load}>
                Reload
              </button>
              <button
                id="dsh-llm-claude-settings-edit"
                type="button"
                style={btn}
                disabled={busy || file === null}
                onClick={() => {
                  setSaved("");
                  setEditing(true);
                }}
              >
                Edit
              </button>
            </>
          )}
        </div>
      </div>
      <p style={{ margin: "0 0 10px", color: T.muted, fontSize: 13 }}>
        Claude Code's own settings: hooks, permissions, model, env. Edited here, read by every
        Claude Code process, in dsh or in a terminal. dsh's hooks and settings are separate.
      </p>
      {facts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {facts.map(([k, v]) => (
            <span
              key={k}
              style={{ ...pill(T.muted), fontWeight: 500, textTransform: "none", letterSpacing: 0 }}
            >
              <b style={{ fontWeight: 600 }}>{k}</b> {v}
            </span>
          ))}
        </div>
      )}
      {editing ? (
        <textarea
          id="dsh-llm-claude-settings-text"
          value={text}
          spellCheck={false}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          style={{
            ...code,
            minHeight: 320,
            resize: "vertical",
            border: `1px solid ${parsed.error ? T.err : T.brand}`,
          }}
        />
      ) : (
        <pre
          id="dsh-llm-claude-settings-view"
          style={{ ...code, maxHeight: 320, overflow: "auto", margin: 0 }}
        >
          {text}
        </pre>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: parsed.error ? T.err : T.ok }}>
          {parsed.error
            ? `Invalid JSON: ${parsed.error}`
            : `Valid JSON · ${Object.keys(parsed.value).length} keys${dirty ? " · unsaved changes" : ""}`}
        </span>
        <span style={{ ...meta, whiteSpace: "normal", textAlign: "right" }}>
          {error ? (
            <span style={{ color: T.err }}>{error}</span>
          ) : (
            saved || (editing ? "Ctrl+S saves · Cancel discards" : "Read-only until Edit")
          )}
        </span>
      </div>
    </section>
  );
}

/** One line answering "which claude, which account, which machine". */
function Runtime() {
  const [st, setSt] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`${ROUTE}/status`)
      .then(readJson)
      .then(setSt)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  if (error)
    return (
      <p id="dsh-llm-claude-runtime" style={{ color: T.err, fontSize: 13, margin: "0 0 4px" }}>
        {error}
      </p>
    );
  if (!st)
    return (
      <p id="dsh-llm-claude-runtime" style={{ ...meta, margin: "0 0 4px" }}>
        Checking claude…
      </p>
    );
  const who = st.loggedIn
    ? `logged in${st.email ? ` as ${st.email}` : ""}${st.authMethod ? ` (${st.authMethod})` : ""}`
    : "not logged in";
  return (
    <div
      id="dsh-llm-claude-runtime"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
        margin: "0 0 4px",
        fontSize: 13,
        color: T.muted,
      }}
    >
      <span style={pill(st.binary ? T.ok : T.err)}>
        {st.binary ? `claude ${st.version ?? ""}`.trim() : "claude not on PATH"}
      </span>
      <span style={pill(st.loggedIn ? T.ok : T.err)}>{who}</span>
      <span style={pill(T.faint)}>{st.host}</span>
      <span style={{ fontFamily: T.mono, fontSize: 12, color: T.faint }}>
        {st.binary ?? ""} · {st.configDir}
      </span>
      {st.error && (
        <span style={{ width: "100%", color: T.err, fontFamily: T.mono, fontSize: 12 }}>
          {st.error}
        </span>
      )}
      {!st.loggedIn && (
        <span style={{ width: "100%", color: T.err }}>
          Sign in on this machine first: run{" "}
          <code style={{ fontFamily: T.mono }}>claude auth login</code> in a terminal, then reload
          this page.
        </span>
      )}
    </div>
  );
}

const input = { ...select, minWidth: 0, flex: 1 };

/**
 * Other dsh servers ("boxes"), each with its own Claude Code login. Same idea as another tool's
 * environments: the browser hops to the box, nothing is proxied. Saved on this dsh, probed
 * server-side so the row shows host, claude version, login and plugin version before you jump.
 */
function Boxes() {
  const [boxes, setBoxes] = useState([]);
  const [probe, setProbe] = useState({});
  const [self, setSelf] = useState(null);
  const [draft, setDraft] = useState({ name: "", url: "", token: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () => {
    setBusy(true);
    setError("");
    fetch(`${ROUTE}/boxes/status`)
      .then(readJson)
      .then((body) => {
        setSelf(body.self);
        setProbe(Object.fromEntries(body.boxes.map((b) => [b.url, b])));
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    fetch(`${ROUTE}/boxes`)
      .then(readJson)
      .then((body) => {
        setBoxes(body.boxes ?? []);
        if ((body.boxes ?? []).length > 0) refresh();
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const save = (next) => {
    setBusy(true);
    setError("");
    return fetch(`${ROUTE}/boxes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boxes: next }),
    })
      .then(readJson)
      .then((body) => {
        setBoxes(body.boxes);
        refresh();
      })
      .catch((e) => {
        setError(String(e.message ?? e));
        setBusy(false);
      });
  };
  const add = (e) => {
    e.preventDefault();
    if (!draft.name.trim() || !draft.url.trim()) return;
    save([...boxes, draft]).then(() => setDraft({ name: "", url: "", token: "" }));
  };
  const remove = (url) => save(boxes.filter((b) => b.url !== url));
  const jump = (b) =>
    window.location.assign(b.token ? `${b.url}/?token=${encodeURIComponent(b.token)}` : b.url);

  return (
    <section id="dsh-llm-claude-boxes" style={card}>
      <div style={cardHead}>
        <div>
          <h3 style={h3}>Boxes</h3>
          <div style={{ ...meta, marginTop: 2 }}>
            Other machines running dsh with this plugin. Open jumps there; each box keeps its own
            Claude Code login and sessions.
          </div>
        </div>
        <button type="button" style={btn} disabled={busy || boxes.length === 0} onClick={refresh}>
          {busy ? "Checking…" : "Refresh"}
        </button>
      </div>
      {error && <p style={{ color: T.err, fontSize: 13, margin: "4px 0" }}>{error}</p>}
      {boxes.map((b) => {
        const st = probe[b.url];
        const ok = st?.ok;
        const skew = ok && self && st.status.plugin && st.status.plugin !== self.plugin;
        return (
          <div key={b.url} data-testid="dsh-llm-claude-box-row" style={row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: T.text, fontWeight: 600 }}>{b.name}</div>
              <div
                style={{
                  ...meta,
                  marginTop: 3,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  alignItems: "center",
                  whiteSpace: "normal",
                }}
              >
                <span style={{ fontFamily: T.mono }}>{b.url}</span>
                {!st && <span style={pill(T.faint)}>{busy ? "checking" : "unchecked"}</span>}
                {st && !ok && <span style={pill(T.err)}>{st.error}</span>}
                {ok && (
                  <>
                    <span style={pill(T.faint)}>{st.status.host}</span>
                    <span style={pill(st.status.binary ? T.ok : T.err)}>
                      {st.status.binary ? `claude ${st.status.version ?? ""}`.trim() : "no claude"}
                    </span>
                    <span style={pill(st.status.loggedIn ? T.ok : T.err)}>
                      {st.status.loggedIn ? (st.status.email ?? "logged in") : "not logged in"}
                    </span>
                    <span style={pill(skew ? T.warn : T.faint)}>
                      plugin {st.status.plugin ?? "?"}
                      {skew ? ` ≠ ${self.plugin} here` : ""}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button type="button" style={btn} disabled={busy} onClick={() => remove(b.url)}>
              Remove
            </button>
            <button type="button" style={btnPrimary} onClick={() => jump(b)}>
              Open
            </button>
          </div>
        );
      })}
      <form
        onSubmit={add}
        style={{
          ...row,
          borderTop: boxes.length ? `1px solid ${T.border}` : "none",
          paddingTop: boxes.length ? 12 : 4,
          flexWrap: "wrap",
        }}
      >
        <input
          style={{ ...input, flex: "0 1 140px" }}
          placeholder="Name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <input
          style={{ ...input, flex: "1 1 260px" }}
          placeholder="https://dsh.other-box.lan"
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
        />
        <input
          style={{ ...input, flex: "1 1 200px" }}
          type="password"
          autoComplete="off"
          placeholder="dsh token (optional)"
          value={draft.token}
          onChange={(e) => setDraft({ ...draft, token: e.target.value })}
        />
        <button
          type="submit"
          style={btn}
          disabled={busy || !draft.name.trim() || !draft.url.trim()}
        >
          Add
        </button>
      </form>
      <div style={{ ...meta, whiteSpace: "normal", marginTop: 4 }}>
        Token: the box's dsh launch token (printed when dsh web starts, or already in its URL behind
        a proxy). Needed only when this browser has never logged into that box.
      </div>
    </section>
  );
}

/**
 * Registers the Claude Code panel in dsh settings: runtime line, session browser, settings.json
 * editor, boxes.
 */
export function apply(ctx) {
  const workspaceItems = () => ctx.workspaces.list.getSnapshot()?.items ?? [];
  const knownSessions = () => ctx.sessions.list.getSnapshot()?.byId ?? {};

  /** Transcripts of one workspace, opened or restored as dsh sessions. */
  function Sessions() {
    const [workspaces, setWorkspaces] = useState(workspaceItems);
    const [workspaceId, setWorkspaceId] = useState(() => workspaces[0]?.workspaceId ?? "");
    const [sessions, setSessions] = useState([]);
    const [state, setState] = useState("idle");
    const [error, setError] = useState("");
    const workspace = workspaces.find((w) => w.workspaceId === workspaceId);

    useEffect(() => {
      const items = workspaceItems();
      setWorkspaces(items);
      if (!workspaceId && items[0]) setWorkspaceId(items[0].workspaceId);
    }, []);

    useEffect(() => {
      if (!workspace) return;
      let live = true;
      setState("loading");
      setError("");
      fetch(`${ROUTE}/sessions?cwd=${encodeURIComponent(workspace.path)}`)
        .then(readJson)
        .then((body) => {
          if (!live) return;
          setSessions(body.sessions ?? []);
          setState("idle");
        })
        .catch((e) => {
          if (!live) return;
          setError(String(e.message ?? e));
          setState("idle");
        });
      return () => {
        live = false;
      };
    }, [workspace?.path]);

    const open = async (s) => {
      setState(`opening:${s.id}`);
      setError("");
      try {
        // A dsh session already exists server-side: unarchive if needed, then open. A terminal
        // transcript is converted server-side, then adopted by the client.
        const id = s.dsh?.id ?? s.id;
        if (s.dsh?.archived || (!s.dsh && !knownSessions()[id])) {
          await readJson(
            await fetch(`${ROUTE}/open`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ cwd: workspace.path, id: s.id }),
            }),
          );
          if (!s.dsh)
            await ctx.sessions.create({ workspaceId: workspace.workspaceId, sessionId: id });
        }
        ctx.sessions.open(id);
        if (s.dsh?.archived)
          setSessions((list) =>
            list.map((x) => (x.id === s.id ? { ...x, dsh: { ...x.dsh, archived: false } } : x)),
          );
      } catch (e) {
        setError(String(e.message ?? e));
      } finally {
        setState("idle");
      }
    };

    const known = knownSessions();
    const counts = sessions.reduce(
      (c, s) => {
        c[!s.dsh ? "terminal" : s.dsh.archived ? "archived" : "dsh"]++;
        return c;
      },
      { terminal: 0, dsh: 0, archived: 0 },
    );
    return (
      <section id="dsh-llm-claude-sessions-card" style={card}>
        <div style={cardHead}>
          <div>
            <h3 style={h3}>Sessions</h3>
            <div style={{ ...meta, marginTop: 2 }}>
              {state === "loading"
                ? "Loading…"
                : `${sessions.length} total · ${counts.dsh} in dsh · ${counts.archived} archived · ${counts.terminal} terminal only`}
            </div>
          </div>
          <label id="dsh-llm-claude-workspace-label" style={{ fontSize: 13, color: T.muted }}>
            Workspace{" "}
            <select
              id="dsh-llm-claude-workspace-select"
              style={select}
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {workspaces.map((w) => (
                <option key={w.workspaceId} value={w.workspaceId}>
                  {w.title || w.path}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p style={{ margin: "0 0 4px", color: T.muted, fontSize: 13 }}>
          Every Claude Code session of this workspace. Ones started here open their dsh session,
          archived ones are restored first; a terminal transcript is read, never written.
        </p>
        {error && (
          <p id="dsh-llm-claude-error" style={{ color: T.err, fontSize: 13 }}>
            {error}
          </p>
        )}
        {state !== "loading" && workspace && sessions.length === 0 && (
          <p id="dsh-llm-claude-empty" style={meta}>
            No Claude Code sessions for {workspace.path}.
          </p>
        )}
        <div id="dsh-llm-claude-sessions">
          {sessions.map((s) => {
            const opened = Boolean(known[s.dsh?.id ?? s.id]) && !s.dsh?.archived;
            const busy = state === `opening:${s.id}`;
            return (
              <div key={s.id} data-testid="dsh-llm-claude-session-row" style={row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    id={`dsh-llm-claude-session-${s.id}-title`}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: T.text,
                    }}
                  >
                    {s.title || s.id}
                  </div>
                  <div
                    style={{ ...meta, marginTop: 2, display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <Origin s={s} />
                    <span>
                      {ago(s.modifiedAt)} · {s.turns}
                      {s.turnsPartial ? "+" : ""} prompts · {size(s.bytes)} ·{" "}
                      <span style={{ fontFamily: T.mono }}>{s.id.slice(0, 8)}</span>
                    </span>
                  </div>
                </div>
                <button
                  id={`dsh-llm-claude-session-${s.id}-button`}
                  type="button"
                  style={opened ? btn : btnPrimary}
                  disabled={busy}
                  onClick={() => open(s)}
                >
                  {busy ? "Opening…" : opened ? "Show" : s.dsh?.archived ? "Restore" : "Open"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function Section() {
    return (
      <div>
        <h2 id="dsh-llm-claude-heading" style={{ marginTop: 0 }}>
          Claude Code
        </h2>
        <Runtime />
        <Sessions />
        <SettingsEditor />
        <Boxes />
      </div>
    );
  }

  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "claude-code-sessions",
        order: 19,
        label: "Claude Code",
        inject: () => ({}),
      },
      Section,
    ),
  );
}
