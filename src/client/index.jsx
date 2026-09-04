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

/** `~/.claude/settings.json` in a textarea: live JSON check, Save, Reload, Ctrl/Cmd+S. */
function SettingsEditor() {
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
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
          <button type="button" style={btn} disabled={busy} onClick={load}>
            Reload
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
      <textarea
        id="dsh-llm-claude-settings-text"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          boxSizing: "border-box",
          minHeight: 320,
          resize: "vertical",
          padding: 12,
          borderRadius: 8,
          border: `1px solid ${parsed.error ? T.err : T.border}`,
          background: T.field,
          color: T.text,
          fontFamily: T.mono,
          fontSize: 13,
          lineHeight: 1.5,
          tabSize: 2,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: parsed.error ? T.err : T.ok }}>
          {parsed.error
            ? `Invalid JSON: ${parsed.error}`
            : `Valid JSON · ${Object.keys(parsed.value).length} keys${dirty ? " · unsaved changes" : ""}`}
        </span>
        <span style={{ ...meta, whiteSpace: "normal", textAlign: "right" }}>
          {error ? <span style={{ color: T.err }}>{error}</span> : saved || "Ctrl+S saves"}
        </span>
      </div>
    </section>
  );
}

/**
 * Registers the Claude Code panel in dsh settings: session browser + settings.json editor.
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
        <Sessions />
        <SettingsEditor />
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
