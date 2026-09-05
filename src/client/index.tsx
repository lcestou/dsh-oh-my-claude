// Browser half: Settings → "Claude Code". A runtime line (which claude, which account, which
// box), one session list across this box and every saved box (filter by box, workspace, origin;
// open here or jump to the box), and two collapsed cards: the saved boxes and Claude Code's own
// settings.json. Built into lib/client.js by `bun run build`.
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

/** Plugin name identifier. */
export const name = "dsh-llm-claude-client";
/** Services injected into the client plugin by dsh. */
export const inject = ["slots", "sessions", "workspaces"];

const ROUTE = "/dsh-llm-claude";
/** Deep link another box's panel sends us to: `#claude-session=<id>&cwd=<path>`. */
const HASH_KEY = "claude-session";

const ago = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};
const size = (bytes: number): string =>
  bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
/** `/home/me/Projects/app` → `Projects/app`; keeps the full path for the title attribute. */
const shortPath = (p: string | undefined): string => {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : p;
};

// dsh's design tokens (`--dsw-alias-*`) with plain fallbacks for any other host theme.
const T = {
  text: "var(--dsw-alias-label-primary, inherit)",
  muted: "var(--dsw-alias-label-secondary, rgba(128,128,128,.9))",
  faint: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.7))",
  border: "var(--dsw-alias-border-l2, rgba(128,128,128,.22))",
  card: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))",
  field: "var(--dsw-alias-bg-base, transparent)",
  hover: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1))",
  brand: "var(--dsw-alias-brand-primary, #3b82f6)",
  ok: "var(--dsw-alias-state-success-primary, #22a06b)",
  warn: "var(--dsw-alias-state-warn-primary, #d9822b)",
  err: "var(--dsw-alias-state-error-primary, #d33)",
  mono: "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  onBrand: "var(--dsw-alias-label-primary-inverted, #fff)",
};

const card: CSSProperties = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: "14px 18px",
  marginTop: 14,
};
const cardHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};
const h3: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, color: T.text };
const meta: CSSProperties = { color: T.faint, fontSize: 12, whiteSpace: "nowrap" };
const row: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "9px 0",
  borderTop: `1px solid ${T.border}`,
};
const btn: CSSProperties = {
  padding: "5px 12px",
  cursor: "pointer",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.text,
  fontSize: 13,
  whiteSpace: "nowrap",
};
const btnPrimary: CSSProperties = {
  ...btn,
  background: T.brand,
  color: T.onBrand,
  border: "1px solid transparent",
};
const pill = (color: string): CSSProperties => ({
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
const chip = (active: boolean, disabled: boolean): CSSProperties => ({
  ...btn,
  padding: "3px 10px",
  fontSize: 12,
  borderRadius: 999,
  background: active ? T.brand : "transparent",
  color: active ? T.onBrand : disabled ? T.faint : T.text,
  border: `1px solid ${active ? "transparent" : T.border}`,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
});
const select: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.field,
  color: T.text,
  fontSize: 13,
  maxWidth: 260,
};
const input: CSSProperties = { ...select, minWidth: 0, flex: 1 };
const code: CSSProperties = {
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

/** Decode a reply from this plugin's own routes; a non-2xx status throws its `error` text. */
const readJson = async <T,>(r: Response): Promise<T> => {
  // SAFETY: the body comes from this plugin's own routes; the caller names the route's reply shape
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
/** JSON.parse hands back one of six shapes; this tells the plain object apart. */
const isObj = (v: Json | undefined): v is JsonObject => v instanceof Object && !Array.isArray(v);
const count = (v: Json | undefined): number =>
  Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0;

interface CardProps {
  id: string;
  title: string;
  summary?: string;
  actions?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Collapsible card: title, a one-line summary that stays visible when closed, optional actions. */
function Card({ id, title, summary, actions, open, onToggle, children }: CardProps) {
  return (
    <section id={id} style={card}>
      <div style={cardHead}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span style={{ ...meta, width: 10, display: "inline-block" }}>{open ? "▾" : "▸"}</span>
          <h3 style={h3}>{title}</h3>
          {summary && (
            <span style={{ ...meta, whiteSpace: "normal", overflow: "hidden" }}>{summary}</span>
          )}
        </button>
        {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
      </div>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </section>
  );
}

/** Where a transcript lives: terminal only, a live dsh session, or an archived one. */
function Origin({ s }: { s: { dsh?: { archived?: boolean; id?: string } } }) {
  if (!s.dsh) return <span style={pill(T.faint)}>terminal</span>;
  if (s.dsh.archived) return <span style={pill(T.warn)}>archived</span>;
  return <span style={pill(T.brand)}>dsh</span>;
}
const originOf = (s: { dsh?: { archived?: boolean } }): string =>
  !s.dsh ? "terminal" : s.dsh.archived ? "archived" : "dsh";

/** Facts worth a glance before opening the editor. */
export function summarize(settings: JsonObject | undefined): Array<[string, string]> {
  if (!settings) return [];
  const out: Array<[string, string]> = [];
  if (settings.model) out.push(["model", String(settings.model)]);
  const hooksObj = settings.hooks;
  if (isObj(hooksObj)) {
    const events = Object.keys(hooksObj);
    const hooks = events.reduce<number>((n, e) => {
      const groups = hooksObj[e];
      return (
        n +
        (Array.isArray(groups)
          ? groups.reduce<number>(
              (m, g) => m + (isObj(g) && Array.isArray(g.hooks) ? g.hooks.length : 1),
              0,
            )
          : 0)
      );
    }, 0);
    out.push(["hooks", `${hooks} on ${events.length} event${events.length === 1 ? "" : "s"}`]);
  }
  const p = settings.permissions;
  if (isObj(p)) {
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

/** Open a transcript row on this box: unarchive/open a dsh session, or import a terminal one. */
async function openHere(
  ctx: ClientCtx,
  s: { dsh?: { id?: string; archived?: boolean }; id: string; cwd?: string },
  cwd: string,
) {
  const known = () => ctx.sessions.list.getSnapshot()?.byId ?? {};
  const id = s.dsh?.id ?? s.id;
  if (s.dsh?.archived || (!s.dsh && !known()[id])) {
    await readJson(
      await fetch(`${ROUTE}/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, id: s.id }),
      }),
    );
    if (!s.dsh) {
      const ws = (ctx.workspaces.list.getSnapshot()?.items ?? []).find((w) => w.path === cwd);
      await ctx.sessions.create(
        ws ? { sessionId: id, workspaceId: ws.workspaceId } : { sessionId: id },
      );
    }
  }
  ctx.sessions.open(id);
}

/** Go to a box's dsh, logged in via its token if we hold one. */
const jump = (b: { url: string; token?: string }) =>
  window.location.assign(b.token ? `${b.url}/?token=${encodeURIComponent(b.token)}` : b.url);

/** Link that opens a transcript on another box: its dsh, logged in via token if we hold one. */
const jumpUrl = (box: { url: string; token?: string }, s: { id: string; cwd?: string }): string =>
  `${box.url}/${box.token ? `?token=${encodeURIComponent(box.token)}` : ""}#${HASH_KEY}=${encodeURIComponent(s.id)}&cwd=${encodeURIComponent(s.cwd ?? "")}`;

interface RuntimeStatus {
  binary?: string;
  version?: string;
  loggedIn?: boolean;
  email?: string;
  authMethod?: string;
  host?: string;
  configDir?: string;
  error?: string;
}

interface RuntimeProps {
  onStatus: (s: RuntimeStatus | null) => void;
}

/** One line answering "which claude, which account, which machine". */
function Runtime({ onStatus }: RuntimeProps) {
  const [st, setSt] = useState<RuntimeStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`${ROUTE}/status`)
      .then((r) => readJson<RuntimeStatus | null>(r))
      .then((status) => {
        setSt(status);
        onStatus?.(status);
      })
      .catch((e: Error) => setError(e.message));
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

interface SessionData {
  id: string;
  title?: string;
  cwd?: string;
  modifiedAt: number;
  turns: number;
  turnsPartial?: boolean;
  bytes: number;
  dsh?: { archived?: boolean; id?: string };
}

interface RemoteSessionData extends SessionData {
  url: string;
  host?: string;
  ok?: boolean;
  error?: string;
  sessions?: SessionData[];
  name?: string;
}

interface BoxData {
  url: string;
  name: string;
  token?: string;
}

interface SessionsProps {
  ctx: ClientCtx;
  boxes: BoxData[];
}

interface GroupInfo {
  key: string;
  name: string;
  host?: string;
  ok: boolean;
  error?: string;
  sessions: SessionData[];
  box?: BoxData;
}

/**
 * Every Claude Code transcript we can see: this box (all workspaces) plus each reachable saved
 * box. Filter by box, workspace and origin; sorted by box, newest first. Open acts here; a row
 * from another box jumps to that box with a deep link its panel understands.
 */
function Sessions({ ctx, boxes }: SessionsProps) {
  const [local, setLocal] = useState<{ host?: string; sessions?: SessionData[] } | null>(null);
  const [remote, setRemote] = useState<RemoteSessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [error, setError] = useState("");
  const [box, setBox] = useState("all");
  const [cwd, setCwd] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [busyId, setBusyId] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    fetch(`${ROUTE}/sessions?all=1`)
      .then((r) => readJson<{ host?: string; sessions?: SessionData[] } | null>(r))
      .then((body) => setLocal(body ?? null))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    if (boxes.length === 0) return;
    setRemoteLoading(true);
    fetch(`${ROUTE}/boxes/sessions`)
      .then((r) => readJson<{ boxes?: RemoteSessionData[] } | null>(r))
      .then((body) => setRemote(body?.boxes ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setRemoteLoading(false));
  };
  useEffect(load, [boxes.map((b) => b.url).join("|")]);

  const groups = useMemo<GroupInfo[]>(() => {
    const out: GroupInfo[] = [];
    if (local)
      out.push({
        key: "local",
        name: "This box",
        host: local.host,
        ok: true,
        sessions: local.sessions ?? [],
      });
    for (const b of boxes) {
      const r = remote.find((x) => x.url === b.url);
      out.push({
        key: b.url,
        name: b.name,
        host: r?.host,
        ok: r?.ok === true,
        error: r ? r.error : remoteLoading ? "checking…" : "unchecked",
        sessions: r?.sessions ?? [],
        box: b,
      });
    }
    return out;
  }, [local, remote, boxes, remoteLoading]);

  const rows = useMemo<Array<{ g: GroupInfo; s: SessionData }>>(() => {
    const out: Array<{ g: GroupInfo; s: SessionData }> = [];
    for (const g of groups) {
      if (box !== "all" && g.key !== box) continue;
      for (const s of g.sessions) {
        if (cwd !== "all" && s.cwd !== cwd) continue;
        if (origin !== "all" && originOf(s) !== origin) continue;
        out.push({ g, s });
      }
    }
    const order = new Map(groups.map((g, i) => [g.key, i]));
    return out.toSorted(
      (a, b) =>
        (order.get(a.g.key) ?? 0) - (order.get(b.g.key) ?? 0) || b.s.modifiedAt - a.s.modifiedAt,
    );
  }, [groups, box, cwd, origin]);

  const cwds = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const g of groups)
      if (box === "all" || g.key === box) for (const s of g.sessions) if (s.cwd) set.add(s.cwd);
    return [...set].toSorted();
  }, [groups, box]);
  useEffect(() => {
    if (cwd !== "all" && !cwds.includes(cwd)) setCwd("all");
  }, [cwds.join("|")]);

  const open = async (r: { g: { key: string; box?: BoxData; name: string }; s: SessionData }) => {
    if (r.g.key !== "local") {
      if (!r.g.box) return;
      window.location.assign(jumpUrl(r.g.box, r.s));
      return;
    }
    setBusyId(r.s.id);
    setError("");
    try {
      await openHere(ctx, r.s, r.s.cwd ?? "");
      if (r.s.dsh?.archived)
        setLocal((l) => {
          if (!l?.sessions) return l;
          return {
            ...l,
            sessions: l.sessions.map((x) =>
              x.id === r.s.id ? { ...x, dsh: { ...x.dsh, archived: false } } : x,
            ),
          };
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };

  const known = ctx.sessions.list.getSnapshot()?.byId ?? {};
  const total = groups.reduce((n, g) => n + g.sessions.length, 0);
  let lastGroup: { key: string } | null = null;
  return (
    <section id="dsh-llm-claude-sessions-card" style={card}>
      <div style={cardHead}>
        <div>
          <h3 style={h3}>Sessions</h3>
          <div style={{ ...meta, marginTop: 2 }}>
            {loading ? "Loading…" : `${rows.length} shown · ${total} total`}
            {remoteLoading ? " · checking boxes…" : ""}
          </div>
        </div>
        <button type="button" style={btn} disabled={loading} onClick={load}>
          Refresh
        </button>
      </div>
      <div
        id="dsh-llm-claude-session-filters"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 10 }}
      >
        <button type="button" style={chip(box === "all", false)} onClick={() => setBox("all")}>
          All boxes
        </button>
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            style={chip(box === g.key, !g.ok)}
            disabled={!g.ok}
            title={g.ok ? g.host : g.error}
            onClick={() => setBox(g.key)}
          >
            {g.name}
            {g.ok ? ` · ${g.sessions.length}` : " · offline"}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <select
          id="dsh-llm-claude-cwd-filter"
          style={select}
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          title="Workspace"
        >
          <option value="all">All workspaces</option>
          {cwds.map((c) => (
            <option key={c} value={c} title={c}>
              {shortPath(c)}
            </option>
          ))}
        </select>
        <select
          id="dsh-llm-claude-origin-filter"
          style={select}
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          title="Origin"
        >
          <option value="all">Any origin</option>
          <option value="dsh">In dsh</option>
          <option value="archived">Archived</option>
          <option value="terminal">Terminal only</option>
        </select>
      </div>
      {error && (
        <p id="dsh-llm-claude-error" style={{ color: T.err, fontSize: 13, margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      {!loading && rows.length === 0 && (
        <p id="dsh-llm-claude-empty" style={{ ...meta, marginTop: 10 }}>
          No Claude Code sessions match.
        </p>
      )}
      <div id="dsh-llm-claude-sessions" style={{ marginTop: 6 }}>
        {rows.map((r) => {
          const header =
            box === "all" && r.g !== lastGroup ? (
              <div
                key={`h-${r.g.key}`}
                style={{
                  ...meta,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "10px 0 4px",
                  fontWeight: 600,
                  color: T.muted,
                }}
              >
                <span>{r.g.name}</span>
                {r.g.host && <span style={pill(T.faint)}>{r.g.host}</span>}
              </div>
            ) : null;
          lastGroup = r.g;
          const isLocal = r.g.key === "local";
          const opened = isLocal && Boolean(known[r.s.dsh?.id ?? r.s.id]) && !r.s.dsh?.archived;
          const busy = busyId === r.s.id;
          const label = busy
            ? "Opening…"
            : !isLocal
              ? `Open on ${r.g.name}`
              : opened
                ? "Show"
                : r.s.dsh?.archived
                  ? "Restore"
                  : "Open";
          return [
            header,
            <div key={`${r.g.key}-${r.s.id}`} data-testid="dsh-llm-claude-session-row" style={row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: T.text,
                  }}
                  title={r.s.title || r.s.id}
                >
                  {r.s.title || r.s.id}
                </div>
                <div
                  style={{ ...meta, marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}
                >
                  <Origin s={r.s} />
                  {r.s.cwd && (
                    <span title={r.s.cwd} style={{ fontFamily: T.mono }}>
                      {shortPath(r.s.cwd)}
                    </span>
                  )}
                  <span>
                    {ago(r.s.modifiedAt)} · {r.s.turns}
                    {r.s.turnsPartial ? "+" : ""} prompts · {size(r.s.bytes)} ·{" "}
                    <span style={{ fontFamily: T.mono }}>{r.s.id.slice(0, 8)}</span>
                  </span>
                </div>
              </div>
              <button
                id={`dsh-llm-claude-session-${r.s.id}-button`}
                type="button"
                style={opened ? btn : btnPrimary}
                disabled={busy}
                onClick={() => open(r)}
              >
                {label}
              </button>
            </div>,
          ];
        })}
      </div>
    </section>
  );
}

interface SettingsFile {
  text: string;
  path?: string;
  exists?: boolean;
  mtime?: number | string;
  backup?: string;
}

interface SettingsEditorProps {
  open: boolean;
  onToggle: () => void;
}

/** `~/.claude/settings.json`: read-only until Edit, then live JSON check, Save, Cancel. */
function SettingsEditor({ open, onToggle }: SettingsEditorProps) {
  const [file, setFile] = useState<SettingsFile | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = () => {
    setBusy(true);
    setError("");
    fetch(`${ROUTE}/settings`)
      .then((r) => readJson<SettingsFile>(r))
      .then((b) => {
        setFile(b);
        setText(b.text);
        setEditing(false);
        setSaved("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(load, []);

  const parsed = useMemo<{ value?: JsonObject; error?: string }>(() => {
    try {
      const value: Json = JSON.parse(text);
      if (!isObj(value)) return { error: "settings.json must be a JSON object" };
      return { value };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
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
      .then((r) => readJson<{ mtime?: number | string; backup?: string }>(r))
      .then((b) => {
        setFile((f) => ({ ...f, text, exists: true, mtime: b.mtime }));
        setEditing(false);
        setSaved(
          `Saved ${new Date(b.mtime ?? 0).toLocaleTimeString()} · previous copy in ${b.backup ?? "?"}`,
        );
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };

  const facts = summarize(parsed.value);
  const summary = file
    ? facts.length
      ? facts.map(([k, v]) => `${k} ${v}`).join(" · ")
      : file.exists
        ? "empty"
        : "not created yet"
    : "";
  const actions = editing ? (
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
  ) : open ? (
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
  ) : null;
  return (
    <Card
      id="dsh-llm-claude-settings"
      title="settings.json"
      summary={summary}
      actions={actions}
      open={open}
      onToggle={onToggle}
    >
      <div style={{ ...meta, fontFamily: T.mono, whiteSpace: "normal", marginBottom: 8 }}>
        {file?.path ?? "…"}
        {file && !file.exists ? " · not created yet" : ""}
      </div>
      <p style={{ margin: "0 0 10px", color: T.muted, fontSize: 13 }}>
        Claude Code's own settings: hooks, permissions, model, env. Read by every Claude Code
        process on this box, in dsh or in a terminal. dsh's own hooks and settings are separate.
      </p>
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
            : `Valid JSON · ${Object.keys(parsed.value ?? {}).length} keys${dirty ? " · unsaved changes" : ""}`}
        </span>
        <span style={{ ...meta, whiteSpace: "normal", textAlign: "right" }}>
          {error ? (
            <span style={{ color: T.err }}>{error}</span>
          ) : (
            saved || (editing ? "Ctrl+S saves · Cancel discards" : "Read-only until Edit")
          )}
        </span>
      </div>
    </Card>
  );
}

interface BoxesProps {
  boxes: BoxData[];
  setBoxes: React.Dispatch<React.SetStateAction<BoxData[]>>;
  open: boolean;
  onToggle: () => void;
}

interface ProbeEntry {
  url: string;
  ok?: boolean;
  error?: string;
  status?: {
    host?: string;
    binary?: string;
    version?: string;
    loggedIn?: boolean;
    email?: string;
    plugin?: string;
  };
}

/**
 * Other dsh servers ("boxes"), each with its own Claude Code login. Same idea as another tool's
 * environments: the browser hops to the box, nothing is proxied. Saved on this dsh, probed
 * server-side so the row shows host, claude version, login and plugin version before you jump.
 */
function Boxes({ boxes, setBoxes, open, onToggle }: BoxesProps) {
  const [probe, setProbe] = useState<Record<string, ProbeEntry>>({});
  const [self, setSelf] = useState<{ plugin?: string } | null>(null);
  const [draft, setDraft] = useState({ name: "", url: "", token: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () => {
    if (boxes.length === 0) return;
    setBusy(true);
    setError("");
    fetch(`${ROUTE}/boxes/status`)
      .then((r) => readJson<{ self?: { plugin?: string }; boxes?: ProbeEntry[] }>(r))
      .then((b) => {
        setSelf(b.self ?? null);
        setProbe(Object.fromEntries((b.boxes ?? []).map((entry) => [entry.url, entry])));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(refresh, [boxes.map((b) => b.url).join("|")]);

  const save = (next: BoxData[]) => {
    setBusy(true);
    setError("");
    return fetch(`${ROUTE}/boxes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boxes: next }),
    })
      .then((r) => readJson<{ boxes?: BoxData[] }>(r))
      .then((b) => setBoxes(b.boxes ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim() || !draft.url.trim()) return;
    save([...boxes, draft]).then(() => setDraft({ name: "", url: "", token: "" }));
  };
  const remove = (url: string) => save(boxes.filter((b) => b.url !== url));

  const reachable = boxes.filter((b) => probe[b.url]?.ok).length;
  const summary =
    boxes.length === 0
      ? "none saved"
      : `${boxes.length} saved · ${busy ? "checking…" : `${reachable} reachable`}`;
  return (
    <Card
      id="dsh-llm-claude-boxes"
      title="Boxes"
      summary={summary}
      actions={
        open ? (
          <button type="button" style={btn} disabled={busy || boxes.length === 0} onClick={refresh}>
            {busy ? "Checking…" : "Refresh"}
          </button>
        ) : null
      }
      open={open}
      onToggle={onToggle}
    >
      <p style={{ margin: "0 0 4px", color: T.muted, fontSize: 13 }}>
        Other machines running dsh with this plugin. Their sessions show in the list above; Open
        jumps there. Each box keeps its own Claude Code login.
      </p>
      {error && <p style={{ color: T.err, fontSize: 13, margin: "4px 0" }}>{error}</p>}
      {boxes.map((b) => {
        const st = probe[b.url];
        const ok = st?.ok;
        const skew = ok && self && st.status?.plugin && st.status.plugin !== self.plugin;
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
                {ok && st.status && (
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
    </Card>
  );
}

/** A deep link from another box's panel: open that session here once dsh is ready. */
function followDeepLink(ctx: ClientCtx) {
  const m = /[#&]claude-session=([^&]+)(?:&cwd=([^&]*))?/.exec(window.location.hash ?? "");
  if (!m) return;
  const id = decodeURIComponent(m[1] ?? "");
  const cwd = decodeURIComponent(m[2] ?? "");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  const started = Date.now();
  const tick = async () => {
    const ready = ctx.sessions.list.getSnapshot()?.phase === "ready";
    if (!ready && Date.now() - started < 15000) return void setTimeout(tick, 250);
    try {
      const body = await readJson<{ sessions?: SessionData[] } | null>(
        await fetch(`${ROUTE}/sessions?all=1`),
      );
      const sessions = body?.sessions ?? [];
      const s = sessions.find((x) => x.id === id) ?? { id, cwd };
      await openHere(ctx, s, s.cwd ?? cwd);
    } catch (e) {
      console.warn(
        `[dsh-llm-claude] deep link failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  void tick();
}

interface UsageWindow {
  label: string;
  usedPercent: number;
  resetsAt: number | null;
}
type UsageReply =
  | { ok: true; fetchedAt: number; windows: UsageWindow[] }
  | { ok: false; error: string; windows?: undefined };

/** "in 2 h 10 min" inside a day, else weekday and time. */
const resetText = (at: number | null): string => {
  if (at === null) return "";
  const ms = at - Date.now();
  if (ms <= 0) return "resets now";
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return `resets in ${h ? `${h} h ` : ""}${m} min`;
  }
  return `resets ${new Date(at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
};

let usageCache: { at: number; reply: UsageReply } | undefined;
const loadUsage = async (): Promise<UsageReply> => {
  if (usageCache && Date.now() - usageCache.at < 60_000) return usageCache.reply;
  const reply = await readJson<UsageReply>(await fetch(`${ROUTE}/usage?force=1`));
  usageCache = { at: Date.now(), reply };
  return reply;
};

/** Fill a block with the usage rows, styled like the meter's own legend rows. */
function renderUsage(block: HTMLElement, reply: UsageReply) {
  block.replaceChildren();
  if (!reply.ok) {
    const p = document.createElement("div");
    p.textContent = `Claude usage: ${reply.error}`;
    p.style.color = T.faint;
    block.append(p);
    return;
  }
  for (const w of reply.windows) {
    const line = document.createElement("div");
    line.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;gap:12px;padding:2px 0";
    const dt = document.createElement("span");
    dt.textContent = w.label;
    dt.style.color = T.muted;
    const dd = document.createElement("span");
    dd.style.cssText = `font-variant-numeric:tabular-nums;color:${w.usedPercent >= 90 ? T.err : w.usedPercent >= 70 ? T.warn : T.text}`;
    dd.textContent = `${Math.round(w.usedPercent)}%`;
    const when = document.createElement("span");
    when.textContent = resetText(w.resetsAt);
    when.style.cssText = `color:${T.faint};margin-left:auto;font-size:11px`;
    line.append(dt, when, dd);
    block.append(line);
  }
  if (reply.windows.length === 0) {
    const p = document.createElement("div");
    p.textContent = "Claude usage: no limits reported";
    p.style.color = T.faint;
    block.append(p);
  }
}

/**
 * Put the plan usage inside dsh's context-meter popover, above the "N% of context used" line.
 * The meter (dsh-client-ui-conversation ContextMeter) has no slot, so this watches the DOM for
 * its dialog: the `[role=dialog]` that follows a `button[aria-haspopup=dialog]` holding a ring.
 * ponytail: DOM hook on a structural selector; swap for a slot the day the meter grows one.
 */
function watchContextMeter() {
  const MARK = "data-dsh-llm-claude-usage";
  const attach = (panel: HTMLElement) => {
    if (panel.hasAttribute(MARK)) return;
    panel.setAttribute(MARK, "1");
    const block = document.createElement("div");
    block.style.cssText = `border-bottom:1px solid ${T.border};margin-bottom:10px;padding-bottom:8px;font-size:12px;line-height:20px`;
    const title = document.createElement("div");
    title.textContent = "Claude usage";
    title.style.cssText = `color:${T.faint};margin-bottom:2px`;
    const rows = document.createElement("div");
    rows.textContent = "Loading…";
    rows.style.color = T.faint;
    block.append(title, rows);
    panel.prepend(block);
    loadUsage().then(
      (reply) => renderUsage(rows, reply),
      (e: Error) => renderUsage(rows, { ok: false, error: e.message }),
    );
  };
  const scan = (root: ParentNode) => {
    for (const el of root.querySelectorAll<HTMLElement>(
      'button[aria-haspopup="dialog"] + [role="dialog"]',
    ))
      if (el.previousElementSibling?.querySelector("svg circle + circle")) attach(el);
  };
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) if (n instanceof HTMLElement) scan(n.parentElement ?? n);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
}

/**
 * Registers the Claude Code panel in dsh settings: runtime line, one session list across boxes,
 * then the saved boxes and Claude Code's settings.json as collapsed cards.
 */
type DshSlots = {
  inject: (section: string, factory: () => ReactNode) => void;
  register: (
    spec: {
      name: string;
      id: string;
      order: number;
      label: string;
      inject: () => Record<string, never>;
    },
    Component: () => ReactNode,
  ) => void;
};
/** The dsh client services this panel uses, the ones `inject` names. */
interface ClientCtx {
  slots: DshSlots;
  sessions: {
    list: { getSnapshot: () => { byId: Record<string, { id: string }>; phase?: string } };
    open: (id: string) => void;
    create: (opts: { sessionId: string; workspaceId?: string }) => Promise<void>;
  };
  workspaces: {
    list: { getSnapshot: () => { items: Array<{ path: string; workspaceId: string }> } };
  };
}
export function apply(ctx: ClientCtx) {
  followDeepLink(ctx);
  watchContextMeter();

  function Section() {
    const [boxes, setBoxes] = useState<BoxData[]>([]);
    const [openBoxes, setOpenBoxes] = useState(false);
    const [openSettings, setOpenSettings] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
      fetch(`${ROUTE}/boxes`)
        .then((r) => readJson<{ boxes?: BoxData[] }>(r))
        .then((b) => setBoxes(b.boxes ?? []))
        .catch((e: Error) => {
          setError(e.message);
          setBoxes([]);
        });
    }, []);
    return (
      <div>
        <h2 id="dsh-llm-claude-heading" style={{ marginTop: 0 }}>
          Claude Code
        </h2>
        <Runtime onStatus={() => {}} />
        {error && <p style={{ color: T.err, fontSize: 13 }}>{error}</p>}
        {boxes !== null && <Sessions ctx={ctx} boxes={boxes} />}
        {boxes !== null && (
          <Boxes
            boxes={boxes}
            setBoxes={setBoxes}
            open={openBoxes || boxes.length === 0}
            onToggle={() => setOpenBoxes((v) => !v)}
          />
        )}
        <SettingsEditor open={openSettings} onToggle={() => setOpenSettings((v) => !v)} />
      </div>
    );
  }

  ctx.slots.inject("settings.section", () => {
    ctx.slots.register(
      {
        name: "settings.section",
        id: "claude-code-sessions",
        order: 19,
        label: "Claude Code",
        inject: () => ({}),
      },
      Section,
    );
    return null;
  });
}
