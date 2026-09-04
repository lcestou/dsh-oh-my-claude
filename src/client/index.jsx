// Browser half: Settings → "Claude Code" lists the Claude Code transcripts of a workspace and opens
// one as a dsh session. Built into lib/client.js by `bun run build`; dsh serves it from the package.
import { useEffect, useState } from "react";

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

const row = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid rgba(128,128,128,.2)",
};
const meta = { opacity: 0.65, fontSize: 12, whiteSpace: "nowrap" };
const btn = { padding: "4px 10px", cursor: "pointer" };

/**
 * Registers the Claude Code session browser panel in dsh settings.
 * Creates a UI for listing and opening Claude Code transcripts.
 */
export function apply(ctx) {
  const workspaceItems = () => ctx.workspaces.list.getSnapshot()?.items ?? [];
  const knownSessions = () => ctx.sessions.list.getSnapshot()?.byId ?? {};

  /**
   * React component displaying Claude Code transcripts for a workspace,
   * allowing users to open sessions in dsh.
   */
  function Section() {
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
        .then(async (r) => {
          if (!r.ok)
            throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
          return r.json();
        })
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
        if (!knownSessions()[s.id]) {
          const r = await fetch(`${ROUTE}/open`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd: workspace.path, id: s.id }),
          });
          if (!r.ok)
            throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
          await ctx.sessions.create({ workspaceId: workspace.workspaceId, sessionId: s.id });
        }
        ctx.sessions.open(s.id);
      } catch (e) {
        setError(String(e.message ?? e));
      } finally {
        setState("idle");
      }
    };

    const known = knownSessions();
    return (
      <div>
        <h2 id="dsh-llm-claude-heading" style={{ marginTop: 0 }}>
          Claude Code sessions
        </h2>
        <p id="dsh-llm-claude-description" style={{ opacity: 0.75 }}>
          Sessions Claude Code ran in this workspace, including ones started in the terminal. Open
          one to continue it here; the terminal transcript is read, never written.
        </p>
        <label id="dsh-llm-claude-workspace-label">
          Workspace{" "}
          <select
            id="dsh-llm-claude-workspace-select"
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
        {error && (
          <p id="dsh-llm-claude-error" style={{ color: "#d33" }}>
            {error}
          </p>
        )}
        {state === "loading" && (
          <p id="dsh-llm-claude-loading" style={meta}>
            Loading…
          </p>
        )}
        {state !== "loading" && workspace && sessions.length === 0 && (
          <p id="dsh-llm-claude-empty" style={meta}>
            No terminal Claude Code transcripts for {workspace.path}. Claude sessions started here
            in dsh live in the session list, not in this panel.
          </p>
        )}
        <div id="dsh-llm-claude-sessions">
          {sessions.map((s) => {
            const opened = Boolean(known[s.id]);
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
                    }}
                  >
                    {s.title || s.id}
                  </div>
                  <div style={meta}>
                    {ago(s.modifiedAt)} · {s.turns}
                    {s.turnsPartial ? "+" : ""} prompts · {size(s.bytes)} · {s.id.slice(0, 8)}
                  </div>
                </div>
                <button
                  id={`dsh-llm-claude-session-${s.id}-button`}
                  type="button"
                  style={btn}
                  disabled={busy}
                  onClick={() => open(s)}
                >
                  {busy ? "Opening…" : opened ? "Show" : "Open"}
                </button>
              </div>
            );
          })}
        </div>
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
