// The MCP tab: configured servers, the connectors list, the add form, and the status labels the
// diagnostics tab borrows. The add form only shows in the modes that read a per-server override.
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { PermissionModeState } from "../events.js";
import {
  btn,
  btnPrimary,
  errText,
  stateText,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  activeClaudeSession,
  hasRunTurn,
  boxQuery,
  boxParam,
  type ClientCtx,
  select,
  inputStyle,
  pill,
} from "../shared.js";
import { t, useLocale } from "../i18n.js";
import { ConfirmButton } from "../tune.js";
import { easeMs } from "./shared.js";

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
export const NOT_RUNNING = { ok: false, error: "no live Claude process for this session" } as const;

export type McpReply = { ok: true; servers: McpServer[] } | { ok: false; error: string };
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
export function McpBody({
  sessionId,
  ctx,
}: {
  sessionId: string;
  ctx: ClientCtx;
  onClose: () => void;
}) {
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
              {s.tools && (
                <span data-omc-mcp-tool-count="" style={pill(T.faint)}>
                  {t("panel.mcp.toolCount", { n: s.tools.length })}
                </span>
              )}
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
export const mcpStatusLabel = (status: string): string =>
  status === "connected" || status === "pending" || status === "needs-auth"
    ? t(`panel.mcp.status.${status}`)
    : status;

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
