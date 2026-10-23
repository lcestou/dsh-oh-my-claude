// The boxes panel from the browser's side: the box rows, the login steps, the per-box settings editor,
// and the JSON helpers the panel reads through.
import { isNewer } from "../update.js";
import { t, useLocale } from "./i18n.js";
import { BOXES_EVENT, canBrowseDirs, OPEN_EVENT, RW_EVENT } from "./picker.js";
import { SCOPE_LABELS, SETTINGS_SCOPES, overrideNote } from "./settings.js";
import type { SettingsScope, SettingsScopeInfo } from "./settings.js";
import { ConfirmButton } from "./tune.js";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACCENT,
  type ClientCtx,
  ROUTE,
  T,
  btn,
  btnPrimary,
  code,
  codeInline,
  h3,
  inputStyle,
  maskEmail,
  meta,
  readJson,
  row,
  select,
} from "./shared.js";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type JsonObject = { [key: string]: Json };

/** JSON.parse hands back one of six shapes; this tells the plain object apart. */
export const isObj = (v: Json | undefined): v is JsonObject =>
  v instanceof Object && !Array.isArray(v);

/** Counts items in a parsed value: array length, object keys, or 0 when v is neither. */
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

/** dsh's own disclosure chevron (ui-settings-plugins): down when closed, turned when open. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{
        color: T.faint,
        flex: "none",
        transition: "transform .16s",
        transform: open ? "rotate(180deg)" : "none",
      }}
    >
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Collapsible card: title, a one-line summary that stays visible when closed, optional actions. */
export function Card({ id, title, summary, actions, open, onToggle, children }: CardProps) {
  useLocale();
  // dsh's own plugin-settings card (ui-settings-plugins, 2026-09-13): name over description on the
  // left, chevron on the right that turns when open, the body under a hairline. Measurements and
  // tokens copied rather than the class borrowed, since dsh's class names change per build.
  return (
    <section
      id={id}
      data-omc-card={open ? "open" : "closed"}
      style={{
        border: `0.5px solid ${open ? "var(--dsw-alias-label-dimmed, rgba(128,128,128,.5))" : "var(--dsw-alias-border-l4, rgba(128,128,128,.3))"}`,
        background: open
          ? "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08))"
          : "var(--dsw-alias-bg-layer-3, rgba(128,128,128,.05))",
        borderRadius: 16,
        marginTop: 12,
        transition: "border-color .16s, background .16s",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={t(open ? "main.card.hide" : "main.card.show", { title })}
        style={{
          appearance: "none",
          width: "100%",
          font: "inherit",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
          background: "none",
          border: 0,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", flex: 1, gap: 4, minWidth: 0 }}>
          <span style={{ color: T.text, fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>
            {title}
          </span>
          {summary && (
            <span style={{ color: T.faint, fontSize: 13, lineHeight: 1.5 }}>{summary}</span>
          )}
        </span>
        <Chevron open={open} />
      </button>
      {open && (
        <div
          style={{
            borderTop: `0.5px solid ${T.border}`,
            margin: "0 16px",
            paddingBottom: 8,
          }}
        >
          {actions && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 8,
                // The same air above the button as below it, where the first row's hairline sits.
                padding: "12px 0",
              }}
            >
              {actions}
            </div>
          )}
          <div style={{ marginTop: actions ? 0 : 10 }}>{children}</div>
        </div>
      )}
    </section>
  );
}

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
    out.push([
      "hooks",
      t(events.length === 1 ? "main.summary.hooksOnOne" : "main.summary.hooksOnOther", {
        hooks,
        events: events.length,
      }),
    ]);
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
    out.push([
      "env",
      t(count(settings.env) === 1 ? "main.summary.varsOne" : "main.summary.varsOther", {
        n: count(settings.env),
      }),
    ]);
  if (count(settings.enabledPlugins) > 0)
    out.push(["plugins", t("main.summary.enabled", { n: count(settings.enabledPlugins) })]);
  if (settings.statusLine) out.push(["statusLine", t("main.summary.set")]);
  return out;
}

/** Go to a box's dsh, logged in via its token if we hold one. */
const jump = (b: { url: string; token?: string }) =>
  window.location.assign(b.token ? `${b.url}/?token=${encodeURIComponent(b.token)}` : b.url);

interface RuntimeStatus {
  binary?: string;
  version?: string;
  plugin?: string;
  /** A newer plugin release on npm, and the command that installs it. */
  latest?: string;
  update?: string;
  /** The dsh this plugin is loaded beside, and the lowest dsh this build runs on. */
  dsh?: string | null;
  dshFloor?: string | null;
  /** Claude processes still running on the box on a login they loaded at start. */
  running?: number;
  loggedIn?: boolean;
  email?: string;
  authMethod?: string;
  host?: string;
  configDir?: string;
  error?: string;
}

export interface BoxData {
  url: string;
  name: string;
  token?: string;
}

export interface SettingsFile {
  text: string;
  path?: string;
  exists?: boolean;
  mtime?: number;
  backup?: string;
}

/** The body `PUT /settings` takes: a scope names the file, and the server resolves it. */
interface SettingsWrite {
  text: string;
  scope?: SettingsScope;
  cwd?: string;
  /** The mtime this tab read. The server refuses the write when the file has moved on since. */
  mtime?: number;
}

interface SettingsEditorProps {
  open: boolean;
  onToggle: () => void;
  box?: BoxData;
  ctx?: ClientCtx;
}

/**
 * Claude Code's settings, one scope at a time: `~/.claude/settings.json`, a project's own file,
 * its local file, and the managed file, which is shown read-only. Read-only until Edit, then a
 * live JSON check, Save and Cancel. A box's settings stay user-scope: a remote box has no
 * directory here to resolve a project against.
 */
function SettingsEditor({ open, onToggle, box, ctx }: SettingsEditorProps) {
  useLocale();
  const [scope, setScope] = useState<SettingsScope>("user");
  const [cwd, setCwd] = useState<string | null>(null);
  const [scopes, setScopes] = useState<SettingsScopeInfo[]>([]);
  const [file, setFile] = useState<SettingsFile | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  // Directories a dsh session is open in; the server accepts no others, so offering more would
  // only produce a rejected save. Read every render: the snapshot fills in as sessions load, and
  // this store has no subscribe to wait on.
  const byId = ctx?.sessions.list.getSnapshot()?.byId ?? {};
  const cwdOptions = [
    ...new Set(Object.values(byId).flatMap((s) => (s.cwd ? [s.cwd] : []))),
  ].toSorted();
  const projectCwd = cwd ?? cwdOptions[0] ?? null;

  const settingsUrl = box
    ? `${ROUTE}/boxes/settings?url=${encodeURIComponent(box.url)}`
    : `${ROUTE}/settings`;
  const scopesUrl = projectCwd
    ? `${ROUTE}/settings/scopes?cwd=${encodeURIComponent(projectCwd)}`
    : `${ROUTE}/settings/scopes`;

  const show = (loaded: SettingsFile) => {
    setFile(loaded);
    setText(loaded.text);
    setEditing(false);
    setSaved("");
  };

  const load = () => {
    setBusy(true);
    setError("");
    // A box answers one file and knows nothing of scopes; everything else reads every scope at
    // once, so the editor can show one and say which keys another file overrides.
    const done = box
      ? fetch(settingsUrl)
          .then((r) => readJson<SettingsFile>(r))
          .then(show)
      : fetch(scopesUrl)
          .then((r) => readJson<{ scopes?: SettingsScopeInfo[] }>(r))
          .then((b) => {
            const all = b.scopes ?? [];
            setScopes(all);
            const wanted =
              all.find((s) => s.scope === scope) ?? all.find((s) => s.scope === "user");
            if (wanted) show(wanted);
          });
    done.catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(load, [settingsUrl, scopesUrl, scope]);

  const parsed = useMemo<{ value?: JsonObject; error?: string }>(() => {
    try {
      const value: Json = JSON.parse(text);
      if (!isObj(value)) return { error: t("main.settings.mustBeObject") };
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
    const body: SettingsWrite = box ? { text } : { text, scope };
    if (!box && projectCwd !== null) body.cwd = projectCwd;
    // The file as this tab last read it. The CLI writes settings.json itself on a plugin
    // install or a /model pick. A save that ignored that would put the whole file back without it.
    if (file?.mtime !== undefined) body.mtime = file.mtime;
    fetch(settingsUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => readJson<{ mtime?: number; backup?: string }>(r))
      .then((b) => {
        setFile((f) => ({ ...f, text, exists: true, mtime: b.mtime }));
        setEditing(false);
        setSaved(
          t("main.settings.saved", {
            time: new Date(b.mtime ?? 0).toLocaleTimeString(),
            backup: b.backup ?? "?",
          }),
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

  const override = box ? "" : overrideNote(scopes, scope);
  const readOnly = !box && scope === "managed";

  const facts = summarize(parsed.value);
  const summary = file
    ? facts.length
      ? facts.map(([k, v]) => `${k} ${v}`).join(" · ")
      : file.exists
        ? t("main.settings.empty")
        : t("main.settings.notCreated")
    : "";
  const actions = editing ? (
    <>
      <button
        id="dsh-oh-my-claude-settings-cancel"
        type="button"
        style={btn}
        disabled={busy}
        onClick={() => {
          setText(file?.text ?? "");
          setEditing(false);
        }}
      >
        {t("cancel")}
      </button>
      <button
        id="dsh-oh-my-claude-settings-save"
        type="button"
        style={{ ...btnPrimary, opacity: canSave ? 1 : 0.5 }}
        disabled={!canSave}
        onClick={save}
      >
        {busy ? t("main.settings.saving") : t("save")}
      </button>
    </>
  ) : open ? (
    <>
      <button type="button" style={btn} disabled={busy} onClick={load}>
        {t("main.settings.reload")}
      </button>
      <button
        id="dsh-oh-my-claude-settings-edit"
        type="button"
        style={btn}
        disabled={busy || file === null || readOnly}
        onClick={() => {
          setSaved("");
          setEditing(true);
        }}
      >
        {t("main.settings.edit")}
      </button>
    </>
  ) : null;
  return (
    <Card
      id="dsh-oh-my-claude-settings"
      title="settings.json"
      summary={summary}
      actions={actions}
      open={open}
      onToggle={onToggle}
    >
      <div style={{ ...meta, fontFamily: T.mono, whiteSpace: "normal", marginBottom: 8 }}>
        {file?.path ?? "…"}
        {file && !file.exists ? t("main.settings.notCreatedDot") : ""}
      </div>
      <p style={{ margin: "0 0 10px", color: T.muted, fontSize: 13 }}>{t("main.settings.desc")}</p>
      {!box && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }} htmlFor="dsh-oh-my-claude-scope">
              {t("main.settings.scope")}
            </label>
            <select
              id="dsh-oh-my-claude-scope"
              value={scope}
              onChange={(e) => {
                // SAFETY: the options are the scope names themselves, so the value is one of them.
                setScope(e.target.value as SettingsScope);
              }}
              disabled={busy || editing}
              style={{
                ...inputStyle,
                padding: "4px 6px",
                fontSize: 12,
                textTransform: "capitalize",
              }}
            >
              {SETTINGS_SCOPES.toReversed().map((s) => (
                <option
                  key={s}
                  value={s}
                  disabled={cwdOptions.length === 0 && (s === "project" || s === "local")}
                >
                  {s}
                </option>
              ))}
            </select>
            {(scope === "project" || scope === "local") &&
              (cwdOptions.length > 0 ? (
                <select
                  data-omc-settings-cwd=""
                  aria-label={t("main.settings.workingDir")}
                  value={projectCwd ?? ""}
                  onChange={(e) => setCwd(e.target.value)}
                  disabled={busy || editing}
                  style={{ ...inputStyle, padding: "4px 6px", fontSize: 12, flex: 1 }}
                >
                  {cwdOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: 12, color: T.muted }}>
                  {t("main.settings.noSessionDir")}
                </span>
              ))}
          </div>
          {(readOnly || override) && (
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>
              {readOnly ? t("main.settings.readOnlyManaged", { name: SCOPE_LABELS.managed }) : ""}
              {override}
            </div>
          )}
        </>
      )}
      {editing ? (
        <textarea
          id="dsh-oh-my-claude-settings-text"
          value={text}
          spellCheck={false}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
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
          id="dsh-oh-my-claude-settings-view"
          style={{ ...code, maxHeight: 320, overflow: "auto", margin: 0 }}
        >
          {text}
        </pre>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: parsed.error ? T.err : T.ok }}>
          {parsed.error
            ? t("main.settings.invalidJson", { error: parsed.error })
            : t("main.settings.validJson", {
                n: Object.keys(parsed.value ?? {}).length,
                more: dirty ? t("main.settings.unsaved") : "",
              })}
        </span>
        <span style={{ ...meta, whiteSpace: "normal", textAlign: "right" }}>
          {error ? (
            <span style={{ color: T.err }}>{error}</span>
          ) : (
            saved || (editing ? t("main.settings.editHint") : t("main.settings.readOnlyHint"))
          )}
        </span>
      </div>
    </Card>
  );
}

interface BoxesProps {
  ctx: ClientCtx;
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

type BoxKind = "ssh" | "tailscale" | "wireguard" | "dsh";

/**
 * Every machine, in one place. This box is the first row (auto-detected, not removable. It is the
 * environment the plugin was installed on); the rest you add, in two kinds:
 *  - **SSH** (`ssh`): this dsh drives Claude Code on the box over ssh; it becomes its own entry in
 *    the model picker, nothing runs there but the CLI. Saved in the plugin's own state.
 *  - **Link** (`dsh`): the box runs its own dsh with this plugin; its sessions show in the archive
 *    and Open hops the browser there. Nothing is proxied.
 * Every row is probed server-side so it shows host, claude version and login before you use it.
 */
/** A login in progress on one row: the sign-in link, then the pasted code. Shared by every box kind. */
interface LoginFlow {
  host: string;
  code: string;
  url?: string;
  error?: string;
  busy?: boolean;
}

/** One box's panel login from the browser: start (the sign-in link), a paste when the page shows a
 *  code, and a 2s poll for a login the CLI finished by itself. Shared by the Boxes rows and the card
 *  above the composer, so both run the same three routes. `onDone` fires once the token is stored. */
/** One box in the Boxes card, in dsh's own settings shape: a name, a quiet kind and address beside
 *  it, one status line under it (a dot for the state, facts joined by dots, problems in the error
 *  colour), and the actions in a column on the right that never wraps into the facts. Every box
 *  kind renders through this so they read the same. */
function BoxRow({
  testId,
  title,
  kind,
  tone,
  facts,
  note,
  actions,
  children,
}: {
  testId: string;
  title: string;
  /** The transport and address: `ssh · devbox`, `link · http://…`, or this box's hostname. */
  kind?: string;
  /** The dot: green when the box can take a turn, red when something stops it, grey while unknown;
   *  none for a row that has no state of its own. */
  tone: "ok" | "err" | "faint" | "none";
  /** The status line's items, left to right; a string item joins with a middle dot. */
  facts: ReactNode[];
  /** A line under the facts: a reach hint, an install hint. */
  note?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const dot = tone === "ok" ? T.ok : tone === "err" ? T.err : T.faint;
  // The actions sit centred on the two-line block (title, status), not hung from its top line; a
  // row with a note or an open login form below keeps them at the top, beside the part they act on.
  const tall = Boolean(note || children);
  return (
    <div
      data-testid={testId}
      style={{ ...row, alignItems: tall ? "flex-start" : "center", flexWrap: "wrap", rowGap: 8 }}
    >
      {/* The text column gives way first: three buttons beside a wrapped status line beat three
          buttons on a line of their own under an unbroken one. */}
      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span style={{ color: T.text, fontWeight: 600, fontSize: 13 }}>{title}</span>
          {kind && (
            <span
              style={{
                ...meta,
                fontFamily: T.mono,
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {kind}
            </span>
          )}
        </div>
        <div
          style={{
            ...meta,
            marginTop: 3,
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            whiteSpace: "normal",
            lineHeight: "18px",
          }}
        >
          {tone !== "none" && (
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: dot,
                flex: "0 0 auto",
                // Centred on the first 18 px line, and staying there when the facts wrap.
                marginTop: 5,
              }}
            />
          )}
          {/* A fact never breaks inside itself ("Claude Code 2.1.273" stays one piece); a narrow
              row wraps between facts, at a dot. */}
          <span style={{ minWidth: 0 }}>
            {facts.map((f, i) => (
              <span key={i}>
                {/* The space after the dot is the one place the line may break. */}
                {i > 0 && <span style={{ margin: "0 6px", opacity: 0.6 }}>·</span>}
                {i > 0 && " "}
                {/* A fact wider than the whole column gets an ellipsis rather than running under
                    the buttons. */}
                <span
                  style={{
                    whiteSpace: "nowrap",
                    display: "inline-block",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    verticalAlign: "bottom",
                  }}
                >
                  {f}
                </span>
              </span>
            ))}
          </span>
        </div>
        {note && (
          <div style={{ ...meta, whiteSpace: "normal", marginTop: 4, color: T.muted }}>{note}</div>
        )}
        {children}
      </div>
      {actions && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flex: "0 1 auto",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            alignSelf: tall ? "flex-start" : "center",
            marginLeft: "auto",
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

/** `2.1.270 (Claude Code)` as the CLI prints it, without the name the row already says. */
const cliVersion = (v: string | null | undefined): string =>
  `Claude Code ${(v ?? "").replace(/\s*\(Claude Code\)\s*$/, "")}`.trim();

/** Placeholder rows while a list loads: the shape of what is coming, in the border tone with a
 *  slow sheen, so the card does not sit empty and then snap full. Motion off under reduced-motion. */
export function SkeletonRows({ rows: n }: { rows: number }) {
  return (
    <div aria-hidden="true" data-testid="dsh-oh-my-claude-skeleton">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ ...row, alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div data-omc-skeleton="" style={{ height: 12, width: `${46 - (i % 3) * 9}%` }} />
            <div
              data-omc-skeleton=""
              style={{ height: 10, width: `${70 - (i % 2) * 14}%`, marginTop: 7 }}
            />
          </div>
          <div data-omc-skeleton="" style={{ height: 28, width: 64, borderRadius: 8 }} />
        </div>
      ))}
    </div>
  );
}

/** A fact in the status line that is a problem: the error colour, so the eye lands on it. */
const bad = (text: string): ReactNode => <span style={{ color: T.err }}>{text}</span>;

/** Where a login flow's three routes live and what names the box in their body: an ssh box (or
 *  this box, host "") under `ssh-boxes/login` by host; a linked dsh box under `boxes/login` by url,
 *  forwarded to that dsh's own copy of this plugin. */
interface LoginRoutes {
  base: string;
  field: "host" | "url";
}

const SSH_LOGIN: LoginRoutes = { base: "ssh-boxes/login", field: "host" };

const DSH_LOGIN: LoginRoutes = { base: "boxes/login", field: "url" };

/** Login state for one box plus the start and submit handlers; each step POSTs to a login route. */
export function useLoginFlow(onDone: (host: string) => void, routes: LoginRoutes = SSH_LOGIN) {
  const [login, setLogin] = useState<LoginFlow | null>(null);
  const post = (route: string, host: string, extra: Record<string, string> = {}) =>
    fetch(`${ROUTE}/${routes.base}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [routes.field]: host, ...extra }),
    });
  const startLogin = (host: string) => {
    setLogin({ host, code: "", busy: true });
    post("start", host)
      .then((r) => readJson<{ url?: string; error?: string }>(r))
      .then((b) => setLogin({ host, code: "", url: b.url, error: b.error }))
      .catch((e: Error) => setLogin({ host, code: "", error: e.message }));
  };
  // While the link is up, ask every 2s whether setup-token finished by itself (it does when the
  // box already has a login: no browser, no code). Paused during a submit, stopped on an error.
  const pollKey = login && login.url && !login.busy && !login.error ? login.host : null;
  useEffect(() => {
    if (pollKey === null) return;
    const host = pollKey;
    let live = true;
    const tick = () =>
      post("poll", host)
        .then((r) => readJson<{ pending?: boolean; done?: boolean; error?: string }>(r))
        .then((b) => {
          if (!live || b.pending) return;
          if (b.done) {
            setLogin(null);
            onDone(host);
          } else setLogin((cur) => (cur && cur.host === host ? { ...cur, error: b.error } : cur));
        })
        .catch(() => {});
    const timer = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pollKey]);
  const submitLogin = () => {
    if (!login) return;
    const host = login.host;
    setLogin({ ...login, busy: true, error: undefined });
    post("code", host, { code: login.code })
      .then((r) => readJson<{ done?: boolean; loggedIn?: boolean; error?: string }>(r))
      .then((b) => {
        if (b.error) return setLogin({ host, code: "", error: b.error });
        setLogin(null);
        onDone(host);
      })
      .catch((e: Error) => setLogin({ host, code: "", error: e.message }));
  };
  return { login, setLogin, startLogin, submitLogin };
}

/** Renders one login's steps: the sign-in link, the paste area and the poll. */
export function LoginSteps({
  login,
  setLogin,
  submit,
}: {
  login: LoginFlow;
  setLogin: (next: LoginFlow | null) => void;
  submit: () => void;
}) {
  useLocale();
  return (
    <div style={{ ...meta, marginTop: 6, whiteSpace: "normal", overflowWrap: "anywhere" }}>
      {login.busy && !login.url && <span>{t("main.login.starting")}</span>}
      {login.url && (
        <>
          <div>
            {t("main.login.openBefore")}
            <a href={login.url} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>
              {t("main.login.linkText")}
            </a>
            {t("main.login.openAfter")}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input
              style={inputStyle}
              placeholder={t("main.login.pasteCode")}
              aria-label={t("main.login.codeLabel")}
              data-omc-login-code=""
              value={login.code}
              disabled={login.busy}
              onChange={(e) => setLogin({ ...login, code: e.target.value })}
            />
            <button
              type="button"
              style={btn}
              disabled={login.busy || !login.code.trim()}
              onClick={submit}
            >
              {login.busy ? "…" : t("main.login.submit")}
            </button>
            <button type="button" style={btn} onClick={() => setLogin(null)}>
              {t("cancel")}
            </button>
          </div>
        </>
      )}
      {login.error && <div style={{ color: T.err, marginTop: 4 }}>{login.error}</div>}
    </div>
  );
}

/** The Boxes card: this box first, then any added machines, each probed and addable from here. */
export function Boxes({ ctx, boxes, setBoxes, open, onToggle }: BoxesProps) {
  useLocale();
  const [probe, setProbe] = useState<Record<string, ProbeEntry>>({});
  const [self, setSelf] = useState<{ plugin?: string } | null>(null);
  const [ssh, setSsh] = useState<SshBoxData[]>([]);
  const [sshProbe, setSshProbe] = useState<Record<string, SshProbeEntry>>({});
  const [kind, setKind] = useState<BoxKind>("ssh");
  /** The add form is folded behind one button once a box exists; a first visit sees it open. */
  const [adding, setAdding] = useState(false);
  // The Add workspace… button opens the sidebar's dialog, which only takes over when a box is
  // saved and dsh exposes its directory service; without both, the click would do nothing.
  const canAdd = ssh.length > 0 && canBrowseDirs(ctx);
  const [draft, setDraft] = useState({ name: "", url: "", token: "", host: "" });
  // The two tunnels a box can sit behind, read from this node: a tailnet peer or a WireGuard peer
  // is a pick, not a hostname typed, and the tailnet is joined from here when it is not yet.
  const [ts, setTs] = useState<TailscaleStatusRow | null>(null);
  const [wg, setWg] = useState<{
    installed: boolean;
    peers: WireguardPeerRow[];
    error?: string;
  } | null>(null);
  const [pickedPeer, setPickedPeer] = useState<TailscalePeerRow | null>(null);
  const [tsLogin, setTsLogin] = useState<{ url?: string; error?: string; busy?: boolean } | null>(
    null,
  );
  // Headscale users point the client at their own server, and a pre-auth key skips the browser.
  const [tsServer, setTsServer] = useState({ loginServer: "", authKey: "" });
  const loadNets = useCallback(() => {
    fetch(`${ROUTE}/tailscale/status`)
      .then((r) => readJson<TailscaleStatusRow>(r))
      .then(setTs)
      .catch(() => {});
    fetch(`${ROUTE}/wireguard/status`)
      .then((r) => readJson<{ installed: boolean; peers: WireguardPeerRow[]; error?: string }>(r))
      .then(setWg)
      .catch(() => {});
  }, []);
  useEffect(loadNets, [loadNets]);
  // While an approval link is out, look every 3 s for the tailnet to come up; stop once it has.
  useEffect(() => {
    if (!tsLogin?.url || ts?.loggedIn) return;
    const timer = setInterval(loadNets, 3000);
    return () => clearInterval(timer);
  }, [tsLogin?.url, ts?.loggedIn, loadNets]);
  const joinTailnet = () => {
    setTsLogin({ busy: true });
    fetch(`${ROUTE}/tailscale/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tsServer),
    })
      .then((r) => readJson<{ url?: string; joined?: boolean; error?: string }>(r))
      .then((b) => {
        setTsLogin({ url: b.url, error: b.error });
        if (b.joined) loadNets();
      })
      .catch((e: Error) => setTsLogin({ error: e.message }));
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openSettingsUrl, setOpenSettingsUrl] = useState<string | null>(null);
  const [me, setMe] = useState<RuntimeStatus | null>(null);
  const [rws, setRws] = useState<RemoteWs[]>([]);
  const { login, setLogin, startLogin, submitLogin } = useLoginFlow(() => refresh());
  const dsh = useLoginFlow(() => refresh(), DSH_LOGIN);
  const logoutDsh = (target: string) => {
    setBusy(true);
    fetch(`${ROUTE}/boxes/login/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: target }),
    })
      .then(() => refresh())
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  /** This box's own row. Read on mount and again after every login change here: the row used to
   *  keep its old pills and its Log out button until the page was reloaded, which read as the
   *  click having done nothing. */
  const loadMe = () =>
    fetch(`${ROUTE}/status`)
      .then((r) => readJson<RuntimeStatus | null>(r))
      .then(setMe)
      .catch(() => {});
  /** The remote-workspace rows. Only state setters inside, so an effect may keep the first one. */
  const loadRws = () => {
    fetch(`${ROUTE}/remote-workspaces`)
      .then((r) => readJson<{ workspaces?: RemoteWs[] }>(r))
      .then((b) => setRws(b.workspaces ?? []))
      .catch(() => {});
  };
  useEffect(() => {
    fetch(`${ROUTE}/ssh-boxes`)
      .then((r) => readJson<{ boxes?: SshBoxData[] }>(r))
      .then((b) => setSsh(b.boxes ?? []))
      .catch((e: Error) => setError(e.message));
    void loadMe();
    loadRws();
  }, []);
  // The rows follow dsh's own workspace list, which changes on an add from the picker, a trash in
  // the sidebar and a box removal alike (the store carries every registry change, dsh's own or this
  // plugin's route). It also publishes a frame per drag-reorder and per archive, so the ids are
  // compared before a fetch. The picker's event covers the one gap: dsh's frame for a new
  // workspace can land before the route has written its row, so the picker says so itself once
  // its POST has answered.
  useEffect(() => {
    let ids = "";
    const onStore = () => {
      const next = (ctx.workspaces.list.getSnapshot()?.items ?? [])
        .map((w) => w.workspaceId)
        .toSorted()
        .join("|");
      if (next === ids) return;
      ids = next;
      loadRws();
    };
    const off = ctx.workspaces.list.subscribe(onStore);
    window.addEventListener(RW_EVENT, loadRws);
    return () => {
      off();
      window.removeEventListener(RW_EVENT, loadRws);
    };
  }, [ctx]);

  const refresh = () => {
    setBusy(true);
    setError("");
    const jobs: Promise<unknown>[] = [loadMe()];
    if (boxes.length)
      jobs.push(
        fetch(`${ROUTE}/boxes/status`)
          .then((r) => readJson<{ self?: { plugin?: string }; boxes?: ProbeEntry[] }>(r))
          .then((b) => {
            setSelf(b.self ?? null);
            setProbe(Object.fromEntries((b.boxes ?? []).map((entry) => [entry.url, entry])));
          }),
      );
    if (ssh.length)
      jobs.push(
        fetch(`${ROUTE}/ssh-boxes/status`)
          .then((r) => readJson<{ boxes?: SshProbeEntry[] }>(r))
          .then((b) => setSshProbe(Object.fromEntries((b.boxes ?? []).map((e) => [e.host, e])))),
      );
    loadNets();
    Promise.all(jobs)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(refresh, [boxes.map((b) => b.url).join("|"), ssh.map((b) => b.host).join("|")]);

  const saveDsh = (next: BoxData[]) => {
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
  const saveSsh = (next: SshBoxData[]) => {
    setBusy(true);
    setError("");
    return fetch(`${ROUTE}/ssh-boxes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boxes: next }),
    })
      .then((r) => readJson<{ boxes?: SshBoxData[] }>(r))
      .then((b) => {
        setSsh(b.boxes ?? []);
        window.dispatchEvent(new Event(BOXES_EVENT));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const clear = () => setDraft({ name: "", url: "", token: "", host: "" });
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    if (kind !== "dsh") {
      if (!draft.host.trim()) return;
      const box: SshBoxData = { name: draft.name.trim(), host: draft.host.trim() };
      if (kind !== "ssh") box.via = kind;
      saveSsh([...ssh, box]).then(clear);
    } else {
      if (!draft.url.trim()) return;
      saveDsh([
        ...boxes,
        { name: draft.name.trim(), url: draft.url.trim(), token: draft.token },
      ]).then(clear);
    }
  };
  const removeDsh = (url: string) => saveDsh(boxes.filter((b) => b.url !== url));
  const removeSsh = (host: string) => saveSsh(ssh.filter((b) => b.host !== host));

  const logout = (host: string) => {
    setBusy(true);
    fetch(`${ROUTE}/ssh-boxes/login/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host }),
    })
      .then(() => refresh())
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const removeRw = (path: string) => {
    setBusy(true);
    setError("");
    fetch(`${ROUTE}/remote-workspaces`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then((r) => readJson<{ workspaces?: RemoteWs[] }>(r))
      .then((b) => setRws(b.workspaces ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const total = boxes.length + ssh.length;
  const reachable =
    boxes.filter((b) => probe[b.url]?.ok).length +
    ssh.filter((b) => sshProbe[b.host]?.status?.binary).length;
  const summary =
    total === 0
      ? t("main.boxes.noneSaved")
      : t("main.boxes.summary", {
          total,
          status: busy ? t("main.sessions.checking") : t("main.boxes.reachable", { n: reachable }),
        });
  const seg = (k: BoxKind, label: string) => (
    <button
      type="button"
      style={
        kind === k
          ? {
              ...btn,
              background: ACCENT,
              color: T.onBrand,
              border: "1px solid transparent",
              // The label on the orange fill was the row's regular weight, thin against it.
              fontWeight: 600,
            }
          : btn
      }
      onClick={() => setKind(k)}
    >
      {label}
    </button>
  );
  return (
    <Card
      id="dsh-oh-my-claude-boxes"
      title={t("main.boxes.title")}
      summary={t("main.boxes.cardSummary")}
      actions={
        open ? (
          <>
            <span style={{ ...meta, alignSelf: "center", marginRight: "auto" }}>{summary}</span>
            <button type="button" style={btn} disabled={busy || total === 0} onClick={refresh}>
              {busy ? t("main.boxes.checkingCap") : t("main.sessions.refresh")}
            </button>
          </>
        ) : null
      }
      open={open}
      onToggle={onToggle}
    >
      {error && <p style={{ color: T.err, fontSize: 13, margin: "4px 0" }}>{error}</p>}
      {me && (
        <BoxRow
          testId="dsh-oh-my-claude-self-box-row"
          title={t("main.sessions.thisBox")}
          kind={me.host}
          tone={!me.binary || !me.loggedIn ? "err" : "ok"}
          facts={[
            me.binary ? cliVersion(me.version) : bad(t("main.boxes.notOnPath")),
            // A token from the earlier setup-token flow is named, since it is the plugin's alone; a
            // login made here or in a terminal is the CLI's own and needs no label.
            <span key="login" data-omc-login-method={me.authMethod}>
              {me.loggedIn
                ? `${maskEmail(me.email ?? t("main.boxes.loggedIn"))}${me.authMethod === "panel token" ? t("main.boxes.panelToken") : ""}`
                : bad(t("main.boxes.notLoggedIn"))}
            </span>,
            // Logged out on disk, but processes started earlier still answer on the login they
            // read then; Log out makes the cut.
            ...(!me.loggedIn && (me.running ?? 0) > 0
              ? [
                  <span key="running" data-omc-running={me.running}>
                    {t(
                      me.running === 1
                        ? "main.boxes.stillAnsweringOne"
                        : "main.boxes.stillAnsweringOther",
                      { n: me.running ?? 0 },
                    )}
                  </span>,
                ]
              : []),
          ]}
          note={
            !me.binary && (
              <>
                {t("main.boxes.installBefore")}
                <code style={codeInline}>claude</code>
                {t("main.boxes.installAfter")}
              </>
            )
          }
          actions={
            <>
              {me.binary && !me.loggedIn && login?.host !== "" && (
                <button
                  type="button"
                  style={btn}
                  disabled={busy}
                  data-testid="dsh-oh-my-claude-this-box-login"
                  onClick={() => startLogin("")}
                >
                  {t("main.boxes.logIn")}
                </button>
              )}
              {/* One Log out does everything: forgets a stored token, logs the box's Claude Code
                  out, and kills its running sessions. */}
              {(me.loggedIn || (me.running ?? 0) > 0) && (
                <ConfirmButton
                  label={t("main.boxes.logOut")}
                  ariaLabel={t("main.boxes.logOutThisAria")}
                  style={btn}
                  disabled={busy}
                  onAct={() => logout("")}
                />
              )}
              {me.binary && (
                <BoxUpdateButton
                  host=""
                  label={t("main.boxes.thisBoxLower")}
                  disabled={busy}
                  onDone={refresh}
                />
              )}
            </>
          }
        >
          {login?.host === "" && (
            <LoginSteps login={login} setLogin={setLogin} submit={submitLogin} />
          )}
        </BoxRow>
      )}
      {ssh.map((b) => {
        const st = sshProbe[b.host]?.status;
        const down = st?.reach && st.reach.stage !== "ok";
        const up = st && !st.error && st.binary;
        const facts: ReactNode[] = !st
          ? [busy ? t("main.sessions.checking") : t("main.sessions.unchecked")]
          : down
            ? [
                <span key="reach" title={st.reach?.detail}>
                  {bad(reachLabel(st.reach?.stage ?? ""))}
                </span>,
              ]
            : st.error
              ? [bad(st.error)]
              : [
                  st.binary ? cliVersion(st.version) : bad(t("main.boxes.noClaude")),
                  st.loggedIn
                    ? maskEmail(st.email ?? t("main.boxes.loggedIn"))
                    : bad(t("main.boxes.notLoggedIn")),
                ];
        if (st && up && !st.loggedIn && (st.running ?? 0) > 0)
          facts.push(
            t(
              st.running === 1 ? "main.boxes.stillAnsweringOne" : "main.boxes.stillAnsweringOther",
              { n: st.running ?? 0 },
            ),
          );
        // Said before the click: Remove on a box takes the workspaces pinned to it as well.
        const onIt = rws.filter((w) => w.host === b.host).length;
        if (onIt > 0)
          facts.push(
            t(onIt === 1 ? "main.boxes.wsOnItOne" : "main.boxes.wsOnItOther", { n: onIt }),
          );
        return (
          <BoxRow
            key={`ssh:${b.host}`}
            testId="dsh-oh-my-claude-ssh-box-row"
            title={b.name}
            kind={`${b.via ?? "ssh"} · ${b.host}`}
            tone={!st ? "faint" : up && st.loggedIn ? "ok" : "err"}
            facts={facts}
            note={down ? st.reach?.hint.replaceAll("<host>", b.host) : undefined}
            actions={
              <>
                {up && !st.loggedIn && login?.host !== b.host && (
                  <button
                    type="button"
                    style={btn}
                    disabled={busy}
                    onClick={() => startLogin(b.host)}
                  >
                    {t("main.boxes.logIn")}
                  </button>
                )}
                {/* The same Log out this box has: `claude auth logout` over ssh, its running
                    sessions stopped, any leftover token forgotten. */}
                {up && (st.loggedIn || (st.running ?? 0) > 0) && (
                  <ConfirmButton
                    label={t("main.boxes.logOut")}
                    ariaLabel={t("main.boxes.logOutBoxAria", { name: b.name })}
                    style={btn}
                    disabled={busy}
                    onAct={() => logout(b.host)}
                  />
                )}
                {up && st.binary && (
                  <BoxUpdateButton host={b.host} label={b.name} disabled={busy} onDone={refresh} />
                )}
                <ConfirmButton
                  label={t("common.remove")}
                  ariaLabel={
                    onIt > 0
                      ? t(
                          onIt === 1
                            ? "main.boxes.removeWithWsOne"
                            : "main.boxes.removeWithWsOther",
                          { name: b.name, n: onIt },
                        )
                      : t("main.boxes.removeBox", { name: b.name })
                  }
                  style={btn}
                  disabled={busy}
                  onAct={() => removeSsh(b.host)}
                />
              </>
            }
          >
            {login?.host === b.host && (
              <LoginSteps login={login} setLogin={setLogin} submit={submitLogin} />
            )}
          </BoxRow>
        );
      })}
      {boxes.map((b) => {
        const st = probe[b.url];
        const ok = st?.ok;
        const r = ok ? st.status : undefined;
        const skew = r?.plugin && self && r.plugin !== self.plugin;
        const facts: ReactNode[] = !st
          ? [busy ? t("main.sessions.checking") : t("main.sessions.unchecked")]
          : !ok
            ? [bad(st.error ?? t("main.sessions.unreachable"))]
            : r
              ? [
                  r.host ?? "",
                  r.binary ? cliVersion(r.version) : bad(t("main.boxes.noClaude")),
                  r.loggedIn
                    ? maskEmail(r.email ?? t("main.boxes.loggedIn"))
                    : bad(t("main.boxes.notLoggedIn")),
                  <span key="plugin" style={skew ? { color: T.warn } : undefined}>
                    {t("main.boxes.pluginVer", { ver: r.plugin ?? "?" })}
                    {skew ? t("main.boxes.pluginSkew", { ver: self?.plugin ?? "" }) : ""}
                  </span>,
                ]
              : [];
        return (
          <BoxRow
            key={`dsh:${b.url}`}
            testId="dsh-oh-my-claude-box-row"
            title={b.name}
            kind={`${t("main.boxes.kindLink")} · ${b.url}`}
            tone={!st ? "faint" : ok && r?.binary && r.loggedIn ? "ok" : "err"}
            facts={facts}
            actions={
              <>
                {/* The same Log in and Log out every row has, run by that dsh's own copy of this
                    plugin on its box. */}
                {r?.binary && !r.loggedIn && dsh.login?.host !== b.url && (
                  <button
                    type="button"
                    style={btn}
                    disabled={busy}
                    onClick={() => dsh.startLogin(b.url)}
                  >
                    {t("main.boxes.logIn")}
                  </button>
                )}
                {r?.loggedIn && (
                  <ConfirmButton
                    label={t("main.boxes.logOut")}
                    ariaLabel={t("main.boxes.logOutBoxAria", { name: b.name })}
                    style={btn}
                    disabled={busy}
                    onAct={() => logoutDsh(b.url)}
                  />
                )}
                <button
                  type="button"
                  style={btn}
                  disabled={busy || !ok}
                  onClick={() => setOpenSettingsUrl(openSettingsUrl === b.url ? null : b.url)}
                >
                  {t("main.boxes.editSettings")}
                </button>
                <ConfirmButton
                  label={t("common.remove")}
                  ariaLabel={t("main.boxes.removeBox", { name: b.name })}
                  style={btn}
                  disabled={busy}
                  onAct={() => removeDsh(b.url)}
                />
                <button type="button" style={btnPrimary} onClick={() => jump(b)}>
                  {t("main.sessions.open")}
                </button>
              </>
            }
          >
            {dsh.login?.host === b.url && (
              <LoginSteps login={dsh.login} setLogin={dsh.setLogin} submit={dsh.submitLogin} />
            )}
          </BoxRow>
        );
      })}
      {openSettingsUrl && (
        <div style={{ padding: "0 0 4px" }}>
          <SettingsEditor
            open
            onToggle={() => setOpenSettingsUrl(null)}
            box={boxes.find((b) => b.url === openSettingsUrl)!}
          />
        </div>
      )}
      {adding || total === 0 ? (
        <>
          <form
            onSubmit={add}
            style={{
              ...row,
              borderTop: `1px solid ${T.border}`,
              paddingTop: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: 6 }}>
              {seg("ssh", "SSH")}
              {seg("tailscale", "Tailscale")}
              {seg("wireguard", "WireGuard")}
              {seg("dsh", t("main.boxes.segLink"))}
            </div>
            <input
              style={{ ...inputStyle, flex: "0 1 140px" }}
              placeholder={t("main.boxes.name")}
              aria-label={t("main.boxes.boxName")}
              data-omc-box-name=""
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            {kind === "ssh" ? (
              <input
                style={{ ...inputStyle, flex: "1 1 240px" }}
                placeholder={t("main.boxes.sshHostPlaceholder")}
                aria-label={t("main.boxes.sshHostLabel")}
                data-omc-ssh-host=""
                value={draft.host}
                onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              />
            ) : kind === "tailscale" ? (
              <>
                {ts?.loggedIn && (
                  <select
                    style={{ ...select, flex: "0 1 220px" }}
                    aria-label={t("main.boxes.tsPeerLabel")}
                    value={pickedPeer?.host ?? ""}
                    onChange={(e) => {
                      const peer = ts.peers.find((p) => p.host === e.target.value) ?? null;
                      setPickedPeer(peer);
                      if (peer)
                        setDraft({ ...draft, name: draft.name || peer.name, host: peer.host });
                    }}
                  >
                    <option value="">{t("main.boxes.pickPeer")}</option>
                    {ts.peers.map((p) => (
                      <option key={p.host} value={p.host} disabled={peerIsSaved(p, ssh)}>
                        {p.online ? "●" : "○"} {p.name}
                        {p.os ? ` · ${p.os}` : ""}
                        {peerIsSaved(p, ssh) ? t("main.boxes.peerSaved") : ""}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  style={{ ...inputStyle, flex: "1 1 220px" }}
                  placeholder={t("main.boxes.tsHostPlaceholder")}
                  aria-label={t("main.boxes.tsHostLabel")}
                  data-omc-tailscale-host=""
                  value={draft.host}
                  onChange={(e) => {
                    setPickedPeer(null);
                    setDraft({ ...draft, host: e.target.value });
                  }}
                />
              </>
            ) : kind === "wireguard" ? (
              <>
                {wg && wg.peers.length > 0 && (
                  <select
                    style={{ ...select, flex: "0 1 220px" }}
                    aria-label={t("main.boxes.wgPeerLabel")}
                    // Reflects what the host field holds, with or without a user in front of it.
                    value={
                      wg.peers.find(
                        (p) => draft.host === p.host || draft.host.endsWith(`@${p.host}`),
                      )?.host ?? ""
                    }
                    onChange={(e) => {
                      const peer = wg.peers.find((p) => p.host === e.target.value);
                      if (peer) setDraft({ ...draft, host: peer.host });
                    }}
                  >
                    <option value="">{t("main.boxes.pickPeer")}</option>
                    {wg.peers.map((p) => (
                      <option key={`${p.iface}:${p.host}`} value={p.host}>
                        {p.host} · {p.iface} · {t("main.boxes.handshake")}{" "}
                        {handshakeText(p.handshakeAge)}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  style={{ ...inputStyle, flex: "1 1 220px" }}
                  placeholder={t("main.boxes.wgHostPlaceholder")}
                  aria-label={t("main.boxes.tunnelAddr")}
                  data-omc-wireguard-host=""
                  value={draft.host}
                  onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                />
              </>
            ) : (
              <>
                <input
                  style={{ ...inputStyle, flex: "1 1 260px" }}
                  placeholder="https://dsh.other-box.lan"
                  aria-label={t("main.boxes.dshUrl")}
                  data-omc-dsh-url=""
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
                <input
                  style={{ ...inputStyle, flex: "1 1 200px" }}
                  type="password"
                  autoComplete="off"
                  placeholder={t("main.boxes.dshTokenPlaceholder")}
                  aria-label={t("main.boxes.dshToken")}
                  data-omc-dsh-token=""
                  value={draft.token}
                  onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                />
              </>
            )}
            <button
              type="submit"
              style={btnPrimary}
              disabled={
                busy ||
                !draft.name.trim() ||
                (kind !== "dsh" ? !draft.host.trim() : !draft.url.trim())
              }
            >
              {t("main.boxes.add")}
            </button>
            {total > 0 && (
              <button type="button" style={btn} onClick={() => setAdding(false)}>
                {t("cancel")}
              </button>
            )}
          </form>
          {kind === "tailscale" && (
            <div
              style={{
                ...meta,
                whiteSpace: "normal",
                marginTop: 6,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              {ts === null ? (
                t("main.boxes.tsChecking")
              ) : !ts.installed ? (
                <>
                  <span style={{ color: T.faint }}>{t("main.boxes.notInstalled")}</span>
                  {t("main.boxes.tsInstallHint")}
                </>
              ) : ts.loggedIn ? (
                <>
                  <span style={{ color: T.ok }}>{t("main.boxes.onTailnet")}</span>
                  {ts.self && (
                    <span style={{ fontFamily: T.mono }}>{ts.self.host || ts.self.name}</span>
                  )}
                  {ts.peers.length === 0 && t("main.boxes.noPeersYet")}
                </>
              ) : (
                <>
                  <span style={{ color: T.warn }}>{t("main.boxes.notConnected")}</span>
                  <input
                    style={{ ...inputStyle, flex: "1 1 200px", fontSize: 12 }}
                    placeholder={t("main.boxes.loginServerPlaceholder")}
                    aria-label={t("main.boxes.loginServer")}
                    data-omc-tailscale-login-server=""
                    value={tsServer.loginServer}
                    onChange={(e) => setTsServer({ ...tsServer, loginServer: e.target.value })}
                  />
                  <input
                    style={{ ...inputStyle, flex: "1 1 160px", fontSize: 12 }}
                    type="password"
                    autoComplete="off"
                    placeholder={t("main.boxes.preAuthPlaceholder")}
                    aria-label={t("main.boxes.preAuthKey")}
                    data-omc-tailscale-auth-key=""
                    value={tsServer.authKey}
                    onChange={(e) => setTsServer({ ...tsServer, authKey: e.target.value })}
                  />
                  {tsLogin?.url ? (
                    <>
                      <a
                        href={tsLogin.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: ACCENT }}
                      >
                        {t("main.boxes.approveTailnet")}
                      </a>
                      <span>{t("main.boxes.waitingApproval")}</span>
                    </>
                  ) : (
                    <button
                      type="button"
                      style={btn}
                      disabled={tsLogin?.busy}
                      onClick={joinTailnet}
                    >
                      {tsLogin?.busy ? t("main.boxes.asking") : t("main.boxes.connect")}
                    </button>
                  )}
                  {tsLogin?.error && <span style={{ color: T.err }}>{tsLogin.error}</span>}
                </>
              )}
            </div>
          )}
          {kind === "tailscale" && pickedPeer && (
            <div style={{ ...meta, whiteSpace: "normal", marginTop: 4 }}>
              {pickedPeer.tailscaleSsh
                ? t("main.boxes.peerTsSsh", { name: pickedPeer.name })
                : t("main.boxes.peerNeedsKey", { name: pickedPeer.name })}
            </div>
          )}
          {kind === "wireguard" && (
            <div
              style={{
                ...meta,
                whiteSpace: "normal",
                marginTop: 6,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              {wg === null ? (
                t("main.boxes.wgChecking")
              ) : !wg.installed ? (
                <>
                  <span style={{ color: T.faint }}>{t("main.boxes.notInstalled")}</span>
                  {t("main.boxes.wgInstallHint")}
                </>
              ) : wg.peers.length === 0 ? (
                <>
                  <span style={{ color: T.warn }}>{t("main.boxes.noTunnel")}</span>
                  {wg.error ? wg.error : t("main.boxes.wgNoTunnelHint")}
                </>
              ) : (
                <>
                  <span style={{ color: T.ok }}>
                    {wg.peers.length === 1
                      ? t("main.boxes.peersOne")
                      : t("main.boxes.peersOther", { n: wg.peers.length })}
                  </span>
                  {t("main.boxes.wgTunnelHint")}
                </>
              )}
            </div>
          )}
          <div style={{ ...meta, whiteSpace: "normal", marginTop: 4 }}>
            {kind !== "dsh" ? t("main.boxes.sshExplain") : t("main.boxes.dshExplain")}
          </div>
        </>
      ) : (
        <div style={{ ...row, flexWrap: "wrap" }}>
          <p style={{ ...meta, whiteSpace: "normal", flex: "1 1 220px", margin: 0 }}>
            {t("main.boxes.addHint")}
          </p>
          <button type="button" style={btn} disabled={busy} onClick={() => setAdding(true)}>
            {t("main.boxes.addBox")}
          </button>
        </div>
      )}
      {/* Nothing here works without an ssh box, so the whole block reads as unavailable until one
          is saved, not just its button. */}
      <div
        data-omc-remote-workspaces={ssh.length > 0 ? "on" : "off"}
        aria-disabled={ssh.length === 0}
        style={{
          borderTop: `1px solid ${T.border}`,
          // No margin of its own: the row above already keeps 12 px to this line.
          paddingTop: 12,
          opacity: ssh.length > 0 ? 1 : 0.45,
          transition: "opacity 120ms ease",
        }}
      >
        <h3 style={h3}>{t("main.boxes.remoteWsTitle")}</h3>
        <p style={{ margin: "2px 0 12px", color: T.muted, fontSize: 13 }}>
          {t("main.boxes.remoteWsDesc")}
        </p>
        {rws.map((w) => (
          <BoxRow
            key={`rw:${w.path}`}
            testId="dsh-oh-my-claude-remote-ws-row"
            title={w.name}
            kind={w.host}
            tone="none"
            facts={[
              <span key="path" style={{ fontFamily: T.mono }}>
                {w.remoteCwd}
              </span>,
            ]}
            actions={
              <ConfirmButton
                label={t("common.remove")}
                ariaLabel={t("main.boxes.removeBox", { name: w.name })}
                style={btn}
                disabled={busy}
                onAct={() => removeRw(w.path)}
              />
            }
          />
        ))}
        <div style={{ ...row, flexWrap: "wrap" }}>
          <p style={{ ...meta, whiteSpace: "normal", flex: "1 1 220px", margin: 0 }}>
            {canAdd
              ? t("main.boxes.rwAddSidebar")
              : ssh.length === 0
                ? t("main.boxes.rwNeedsBox")
                : t("main.boxes.rwSidebarWhenReady")}
          </p>
          <button
            type="button"
            style={btn}
            disabled={!canAdd}
            onClick={() => document.dispatchEvent(new Event(OPEN_EVENT))}
          >
            {t("main.boxes.addWorkspace")}
          </button>
        </div>
      </div>
    </Card>
  );
}

interface SshBoxData {
  name: string;
  host: string;
  /** How the host is reached when it is a tunnel address; the row's pill says so. */
  via?: "tailscale" | "wireguard";
}

/** This node's tailnet, as `/tailscale/status` answers it (mirrors reach.ts's `TailscaleState`). */
interface TailscaleStatusRow {
  installed: boolean;
  state: string;
  loggedIn: boolean;
  self?: { name: string; host: string; ip: string };
  peers: TailscalePeerRow[];
  error?: string;
}

/** A WireGuard peer this node can dial, as `/wireguard/status` answers it. */
interface WireguardPeerRow {
  iface: string;
  host: string;
  allowedIps: string[];
  endpoint: string;
  handshakeAge: number | null;
}

/** `44s ago`, `3m ago`, `never`: a tunnel's last handshake, which is its pulse. */
const handshakeText = (age: number | null): string =>
  age === null
    ? t("main.boxes.never")
    : age < 90
      ? t("main.boxes.secAgo", { n: age })
      : t("main.boxes.minAgo", { n: Math.round(age / 60) });

/** A Tailscale peer as `/tailscale/status` lists it (mirrors reach.ts's `TailscalePeer`). */
interface TailscalePeerRow {
  name: string;
  host: string;
  os: string;
  online: boolean;
  tailscaleSsh: boolean;
}

/** Already a saved box, by host (with or without a user@ in front), so the picker says so. */
const peerIsSaved = (peer: TailscalePeerRow, boxes: Array<{ host: string }>): boolean =>
  boxes.some((b) => b.host === peer.host || b.host.endsWith(`@${peer.host}`));

/** The row's word for each reach stage; the hint under the row says what to do. */
const reachLabel = (stage: string): string => {
  switch (stage) {
    case "dns":
      return t("main.boxes.reachDns");
    case "route":
      return t("main.sessions.unreachable");
    case "hostkey":
      return t("main.boxes.reachHostkey");
    case "auth":
      return t("main.boxes.reachAuth");
    case "policy":
      return t("main.boxes.reachPolicy");
    case "shell":
      return t("main.boxes.reachShell");
    case "no-cli":
      return t("main.boxes.noClaude");
    default:
      return stage;
  }
};

interface SshProbeEntry {
  name: string;
  host: string;
  status?: {
    host?: string;
    binary?: string;
    version?: string;
    reach?: { stage: string; hint: string; detail: string };
    loggedIn?: boolean;
    /** Claude processes still running for the box on a login they loaded at start. */
    running?: number;
    email?: string;
    error?: string;
  };
}

/** A workspace pinned to a directory on an SSH box; mirrors the server's RemoteWorkspace. */
interface RemoteWs {
  name: string;
  host: string;
  remoteCwd: string;
  path: string;
  workspaceId: string;
}

/** The updater's answer as the Boxes rows read it: the two versions, whether a run is on, its log. */
interface BoxUpdateState {
  installed: string | null;
  latest?: string;
  busy: boolean;
  log: Array<{ ok: boolean; to: string | null; note?: string }>;
}

/** The Update button on a Boxes row, beside Log out, for a box the server sees behind: the same
 *  run the card above the composer starts, from Settings, so a box with no session open (an ssh
 *  box someone else uses) can still be brought up to date from here. Reads the box's state once on
 *  mount, shows nothing while the box is current, and follows a run through the GET every 3 s. */
function BoxUpdateButton({
  host,
  label,
  disabled,
  onDone,
}: {
  host: string;
  label: string;
  disabled: boolean;
  /** A run landed: the row's version pill comes from the status probe, so the caller re-probes. */
  onDone: () => void;
}) {
  useLocale();
  const [state, setState] = useState<BoxUpdateState | null>(null);
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "declined" | "failed">("idle");
  const [note, setNote] = useState("");
  const url = `${ROUTE}/claude-update?host=${encodeURIComponent(host)}`;
  useEffect(() => {
    let live = true;
    fetch(url)
      .then((r) => readJson<BoxUpdateState>(r))
      .then((s) => live && setState(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  useEffect(() => {
    if (phase !== "busy") return;
    let live = true;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const s = await readJson<BoxUpdateState>(await fetch(url));
        if (!live) return;
        if (s.busy) {
          if (Date.now() - startedAt > 200_000) {
            setNote(t("main.update.noAnswer200"));
            setPhase("failed");
          }
          return;
        }
        const last = s.log[s.log.length - 1];
        setState(s);
        setNote(last?.note ?? "");
        setPhase(!last ? "failed" : last.ok ? "done" : last.to !== null ? "declined" : "failed");
        if (last?.ok) onDone();
      } catch {
        // a missed poll is retried on the next tick
      }
    };
    const id = setInterval(() => void tick(), 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [phase, url, onDone]);
  if (!state || !state.latest || !state.installed || !isNewer(state.installed, state.latest))
    return null;
  const run = () => {
    setPhase("busy");
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run: true }),
    }).catch((e: Error) => {
      setNote(e.message);
      setPhase("failed");
    });
  };
  const text =
    phase === "busy"
      ? t("main.update.updating")
      : phase === "done"
        ? t("main.update.updatedTo", { v: state.installed })
        : phase === "declined"
          ? t("main.update.notUpdated")
          : phase === "failed"
            ? t("main.update.retry")
            : t("main.update.updateTo", { v: state.latest });
  return (
    <button
      type="button"
      style={btn}
      data-omc-box-update={host || "this-box"}
      data-omc-update-phase={phase}
      disabled={disabled || phase === "busy" || phase === "done" || phase === "declined"}
      aria-busy={phase === "busy" ? "true" : undefined}
      aria-label={t("main.update.runAria", { text, label })}
      title={note || t("main.update.runTitle", { label })}
      onClick={run}
    >
      {text}
    </button>
  );
}
