// The diagnostics tab: runtime status, config files, doctor output, the rules and hooks lists, and the
// session notices. The fold, the not-running marker and the repair notice come from other tab files.
import { useCallback, useEffect, useState } from "react";
import {
  btn,
  btnPrimary,
  errText,
  stateText,
  sectionHead,
  nested,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  ago,
  activeClaudeSession,
  claudeProviderOf,
  hasRunTurn,
  type ClientCtx,
  pill,
  maskEmail,
  resumeCommand,
  saveBlob,
} from "../shared.js";
import { checkContract, contractMisses, contractSummary } from "../contract.js";
import { UpdatePill } from "../update-pill.js";
import { ReportBlock } from "../report.js";
import { t, useLocale } from "../i18n.js";
import { noticesOn, setNoticesOn } from "../notices.js";
import type { PermissionRules, HooksListing } from "../../process.js";
import type { PermissionsReply } from "./access.js";
import { shortPath, useFold } from "./shared.js";
import type { McpReply } from "./mcp.js";
import { NOT_RUNNING, mcpStatusLabel } from "./mcp.js";
import { SessionRepairsNotice, useFeatureSwitches } from "./restore.js";

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
export function DiagnosticsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
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
