// The skills tab: the skill roster grouped by scope, the cost columns, the marketplace add form, and the
// plugin manager block the instructions tab reuses.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  btn,
  btnPrimary,
  errText,
  sectionHead,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  claudeProviderOf,
  boxQuery,
  type ClientCtx,
  code,
  select,
  inputStyle,
  pill,
  groupSkillsByScope,
  skillStateFromReply,
  loadBreakdown,
  parseSkillCosts,
  sortSkillCosts,
  type SkillState,
  type UsageBreakdownReply,
} from "../shared.js";
import { t, useLocale, type OmcKey } from "../i18n.js";
import { ConfirmButton } from "../tune.js";
import { SearchField } from "../search-field.js";
import type { PluginRoster, PluginLoadError } from "../../plugins.js";
import { FOLD_BODY, FOLD_HEAD } from "./shared.js";

/** The one plugin scope not `user`-global reads and writes into a directory. Labels come from
 *  `panel.scope.<value>` at render so a language switch reaches them. */
const PLUGIN_SCOPE_OPTS = ["user", "project", "local"] as const;

/** The Add-marketplace form under the roster: a source and the scope to declare it in. */
function MarketplaceAddForm({ act, busy }: { act: Act; busy: string }) {
  useLocale();
  const [source, setSource] = useState("");
  const [scope, setScope] = useState("user");
  const submit = async () => {
    if (await act("/plugins/marketplace/add", { source, scope }, "mkt-add")) setSource("");
  };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <input
        type="text"
        placeholder={t("panel.plugins.mktSourcePlaceholder")}
        aria-label={t("panel.plugins.mktSourceLabel")}
        data-omc-plugin-marketplace-source=""
        value={source}
        onChange={(e) => setSource(e.currentTarget.value)}
        disabled={busy !== ""}
        style={inputStyle}
      />
      <select
        data-omc-plugin-marketplace-scope=""
        aria-label={t("panel.plugins.mktScopeLabel")}
        value={scope}
        onChange={(e) => setScope(e.currentTarget.value)}
        disabled={busy !== ""}
        style={select}
      >
        {PLUGIN_SCOPE_OPTS.map((o) => (
          <option key={o} value={o}>
            {t(`panel.scope.${o}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        style={btn}
        disabled={busy !== "" || source.trim() === ""}
        onClick={submit}
      >
        {busy === "mkt-add" ? "…" : t("panel.add")}
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
export function PluginManagerBlock({
  roster,
  pluginErrors,
  pluginWarnings,
  sessionId,
  ctx,
  onChanged,
}: {
  roster: PluginRoster | null;
  pluginErrors: PluginLoadError[];
  pluginWarnings: PluginLoadError[];
  sessionId: string;
  ctx: ClientCtx;
  onChanged: () => void;
}) {
  useLocale();
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
        setError(r.error ?? t("panel.plugins.actionFailed"));
        return false;
      }
      setApplied(r.live === true ? t("panel.plugins.appliedLive") : t("panel.plugins.appliedNext"));
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
      <span style={sectionHead}>{t("panel.plugins.head")}</span>
      <div style={{ padding: "2px 0", fontSize: 12, lineHeight: "1.7" }}>
        {pluginErrors.length > 0 && (
          <div data-omc-plugin-errors="" role="alert" style={{ marginBottom: 6 }}>
            <span style={{ ...meta, color: T.err, padding: "2px 0", display: "block" }}>
              {t("panel.plugins.loadFailed")}
            </span>
            {pluginErrors.map((e, i) => (
              <div key={`${e.plugin}:${i}`} style={{ ...line, whiteSpace: "normal", color: T.err }}>
                {e.plugin && !e.plugin.startsWith("inline") ? `${e.plugin}: ` : ""}
                {e.message}
              </div>
            ))}
          </div>
        )}
        {pluginWarnings.length > 0 && (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
          <div data-omc-plugin-warnings="" role="status" style={{ marginBottom: 6 }}>
            <span style={{ ...meta, color: T.warn, padding: "2px 0", display: "block" }}>
              {t("panel.plugins.warnings")}
            </span>
            {pluginWarnings.map((w, i) => (
              <div
                key={`${w.plugin}:${i}`}
                style={{ ...line, whiteSpace: "normal", color: T.warn }}
              >
                {w.plugin && !w.plugin.startsWith("inline") ? `${w.plugin}: ` : ""}
                {w.message}
              </div>
            ))}
          </div>
        )}
        {plugins.length === 0 && marketplaces.length === 0 && (
          <span style={{ ...meta, fontSize: 12 }}>{t("panel.plugins.empty")}</span>
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
              title={p.enabled ? t("panel.plugins.disable") : t("panel.plugins.enable")}
            >
              {busy === p.key ? "…" : p.enabled ? t("panel.plugins.on") : t("panel.plugins.off")}
            </button>
            <span style={line}>
              {p.key}
              {p.detail !== undefined && ` (${p.detail})`}
            </span>
            <span style={{ ...meta, flex: "none" }}>{p.scope}</span>
            <ConfirmButton
              label={t("common.remove")}
              style={small}
              disabled={busy !== ""}
              busyLabel={busy === p.key ? "…" : undefined}
              onAct={() => void act("/plugins/uninstall", { key: p.key, scope: p.scope }, p.key)}
            />
          </div>
        ))}
        {marketplaces.map((m) => (
          <div key={m.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ ...meta, flex: "none" }}>{t("panel.plugins.marketTag")}</span>
            <span style={line}>
              {m.name} · {m.source}
              {m.alias === true && t("panel.plugins.aliasNote")}
            </span>
            <span style={{ ...meta, flex: "none" }}>{m.scope}</span>
            <ConfirmButton
              label={t("common.remove")}
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
          {applied || t("panel.plugins.applyNote")}
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

/** True for a skill scope this tab can edit (user or project), so plugin skills draw read-only. */
const writable = (scope: string) => scope === "user" || scope === "project";

/** The /skill-doctor cost columns, one source of truth for the table header and body. `numeric` is
 *  true for the four the CLI prints as magnitudes, so they line up right under each other. Column
 *  headers come from `panel.skills.col.<col>` at render so a language switch reaches them. */
const costCols: {
  col: "skill" | "source" | "context" | "tokens" | "uses" | "lastUsed";
  numeric: boolean;
}[] = [
  { col: "skill", numeric: false },
  { col: "source", numeric: false },
  { col: "context", numeric: true },
  { col: "tokens", numeric: true },
  { col: "uses", numeric: true },
  { col: "lastUsed", numeric: true },
];

/** The CLI's "Top …" group headings from `claude -p "/usage"`, as the parser capitalises them. */
const DRIVER_GROUP_KEYS = new Map<string, OmcKey>([
  ["Subagents", "panel.skills.groupSubagents"],
  ["Plugins", "panel.skills.groupPlugins"],
  ["MCP servers", "panel.skills.groupMcpServers"],
]);

/** The CLI's usage sentences, one pattern per template it prints (2.1.x). The first group is the
 *  percentage and the second, when there is one, a skill, agent, plugin or server name, which stays
 *  as written. A sentence no pattern matches is a template newer than this list and shows as sent. */
const BEHAVIOUR_KEYS: Array<[RegExp, OmcKey]> = [
  [/^(\d+)% of your usage hit a >100k-token cache miss$/, "panel.skills.behCacheMiss"],
  [/^(\d+)% of your usage was at >150k context$/, "panel.skills.behLongContext"],
  [/^(\d+)% of your usage came from subagent-heavy sessions$/, "panel.skills.behSubagentHeavy"],
  [/^(\d+)% of your usage was while 4\+ sessions ran in parallel$/, "panel.skills.behParallel"],
  [/^(\d+)% of your usage came from sessions active for 8\+ hours$/, "panel.skills.behLongRunning"],
  [/^(\d+)% of your usage came from subagents under "(.+)"$/, "panel.skills.behFromAgent"],
  [/^(\d+)% of your usage came from the plugin "(.+)"$/, "panel.skills.behFromPlugin"],
  [/^(\d+)% of your usage came from the MCP server "(.+)"$/, "panel.skills.behFromMcp"],
  [/^(\d+)% of your usage came from \/(.+)$/, "panel.skills.behFromSkill"],
];

/** One CLI usage sentence in the reader's language, or as the CLI wrote it when it is new. */
const behaviourText = (line: string): string => {
  for (const [re, key] of BEHAVIOUR_KEYS) {
    const m = re.exec(line);
    if (m) return t(key, { pct: m[1] ?? "", name: m[2] ?? "" });
  }
  return line;
};

/**
 * The Skills tab: every skill the CLI can reach for this directory, grouped by where it comes from,
 * each scope a collapsible section. User and project skills are created, edited and removed here; a
 * plugin's skills are read-only, edited where the plugin ships them. A write asks the live process to
 * re-read skills (`reload_skills`), so a new skill's /command registers without a respawn. The box the
 * session runs on is named in the query, so a remote session lists and edits that box's skills.
 */

export function SkillsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [cost, setCost] = useState<SkillState>({ kind: "idle" });
  const [drivers, setDrivers] = useState<UsageBreakdownReply | null>(null);
  const [driversBusy, setDriversBusy] = useState(false);
  const [costSort, setCostSort] = useState<{
    col: "skill" | "source" | "context" | "tokens" | "uses" | "lastUsed";
    dir: "asc" | "desc";
  }>({ col: "tokens", dir: "desc" });
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
  const loadDrivers = (force = false) => {
    setDriversBusy(true);
    void loadBreakdown(undefined, force)
      .then(setDrivers)
      .catch((e: Error) => setDrivers({ ok: false, error: e.message }))
      .finally(() => setDriversBusy(false));
  };

  const box = boxQuery(ctx, sessionId);
  const note = (live: boolean) =>
    setApplied(live ? t("panel.plugins.appliedLive") : t("panel.plugins.appliedNext"));
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
      const name = newName;
      setNewName("");
      setNewDesc("");
      refresh();
      // Open the editor before dropping the form, so the list never flashes between the two.
      await openEdit(r.path, name);
      setCreating(false);
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
    { key: "user", label: t("panel.skills.userSkills"), rows: groups.user },
    { key: "project", label: t("panel.skills.projectSkills"), rows: groups.project },
    { key: "plugin", label: t("panel.skills.pluginSkills"), rows: groups.plugin },
  ];
  const anyMatch = skills.some(match);
  const small: CSSProperties = { ...btn, flex: "none", padding: "0 6px", fontSize: 11 };
  const rowNode = (s: SkillRow) => (
    <div
      key={s.path}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}
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
          aria-label={t("panel.skills.editLabel", { name: s.name })}
          style={small}
          disabled={busy !== ""}
          onClick={() => openEdit(s.path, s.name)}
        >
          {t("panel.edit")}
        </button>
      )}
      {writable(s.scope) && (
        <ConfirmButton
          label={t("common.remove")}
          ariaLabel={t("panel.skills.removeLabel", { name: s.name })}
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
            ‹ {t("panel.back")}
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
            {t("save")}
          </button>
        </div>
        <textarea
          data-omc-skill-editor=""
          aria-label={t("panel.skills.editorLabel")}
          value={text}
          spellCheck={false}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
          }}
          style={{ ...code, minHeight: 300, resize: "vertical", whiteSpace: "pre-wrap" }}
        />
        {applied && (
          <span data-omc-skill-applied="" style={{ ...meta, padding: "2px 0" }}>
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
      <div style={{ display: "flex", gap: 6, paddingBottom: 2 }}>
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
            {t("panel.skills.newSkill")}
          </button>
        )}
        <button
          type="button"
          data-omc-skill-reload=""
          style={btn}
          disabled={busy !== ""}
          onClick={reload}
        >
          {busy === "reload" ? "…" : t("panel.skills.reload")}
        </button>
      </div>
      {creating && (
        <div
          data-omc-skill-form=""
          style={{ display: "flex", flexDirection: "column", gap: 6, padding: "2px 0" }}
        >
          <input
            type="text"
            data-omc-skill-name=""
            aria-label={t("panel.skills.nameLabel")}
            placeholder={t("panel.skills.namePlaceholder")}
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            disabled={busy !== ""}
            style={{ ...inputStyle, flex: "none" }}
          />
          {newName !== "" && !nameOk && (
            <span data-omc-skill-name-error="" style={{ ...meta, color: T.err }}>
              {t("panel.skills.nameError")}
            </span>
          )}
          <select
            data-omc-skill-scope=""
            aria-label={t("panel.skills.scopeLabel")}
            value={newScope}
            onChange={(e) => setNewScope(e.currentTarget.value)}
            disabled={busy !== ""}
            style={{ ...select, flex: "none", maxWidth: "none" }}
          >
            <option value="user">{t("panel.scope.user")}</option>
            <option value="project">{t("panel.scope.project")}</option>
          </select>
          <input
            type="text"
            data-omc-skill-desc=""
            aria-label={t("panel.skills.descLabel")}
            placeholder={t("panel.skills.descPlaceholder")}
            value={newDesc}
            onChange={(e) => setNewDesc(e.currentTarget.value)}
            disabled={busy !== ""}
            style={{ ...inputStyle, flex: "none" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              data-omc-skill-create=""
              style={btnPrimary}
              disabled={busy !== "" || !nameOk}
              onClick={create}
            >
              {busy === "create" ? "…" : t("panel.skills.create")}
            </button>
            <button
              type="button"
              data-omc-skill-cancel=""
              style={btn}
              disabled={busy !== ""}
              onClick={() => setCreating(false)}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      {skills.length === 0 && (
        <span
          data-omc-skills-none=""
          style={{ ...meta, padding: "2px 0", display: "block", whiteSpace: "normal" }}
        >
          {t("panel.skills.empty")}
        </span>
      )}
      {skills.length > 12 && (
        <SearchField
          hook="data-omc-skills-search"
          style={{ margin: "2px 0 4px" }}
          value={query}
          placeholder={t("panel.skills.searchPlaceholder", { count: skills.length })}
          label={t("panel.skills.searchLabel")}
          onChange={setQuery}
        />
      )}
      {skills.length > 0 && !anyMatch && (
        <span data-omc-skills-empty="" style={{ ...meta, padding: "2px 0" }}>
          {t("panel.skills.noMatch")}
        </span>
      )}
      {sections.map((sec) => {
        const rows = sec.rows.filter(match);
        if (rows.length === 0) return null;
        // Groups start folded so the tab reads as a short list of groups plus Skill costs; a search
        // opens them to show its matches, and a lone group opens since folding it hides everything.
        const open = query.trim() !== "" || sections.filter((x) => x.rows.length > 0).length === 1;
        return (
          <details key={sec.key} open={open} data-omc-skills-scope={sec.key}>
            <summary style={FOLD_HEAD}>
              {sec.label} · {sec.rows.length}
            </summary>
            <div style={FOLD_BODY}>{rows.map(rowNode)}</div>
          </details>
        );
      })}
      {skills.some((s) => writable(s.scope)) && (
        <span data-omc-skill-note="" style={{ ...meta, padding: "2px 0", whiteSpace: "normal" }}>
          {t("panel.skills.removeNote")}
        </span>
      )}
      {applied && (
        <span data-omc-skill-applied="" style={{ ...meta, padding: "2px 0" }}>
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
        <summary style={FOLD_HEAD}>{t("panel.skills.costs")}</summary>
        <div style={FOLD_BODY}>
          <div style={{ ...meta, whiteSpace: "normal", margin: "8px 0" }}>
            {t("panel.skills.costsIntro")}
          </div>
          {cost.kind === "loading" && (
            <div style={{ color: T.muted, fontSize: 13 }}>{t("panel.skills.reading")}</div>
          )}
          {cost.kind === "error" && (
            <div style={{ color: T.err, fontSize: 13 }}>
              {t("panel.skills.reportError", { text: cost.text })}
            </div>
          )}
          {cost.kind === "declined" && (
            <pre
              data-omc-skill-doctor=""
              aria-label={t("panel.skills.reportLabel")}
              style={{ ...code, maxHeight: 320, overflow: "auto", margin: 0 }}
            >
              {cost.text}
            </pre>
          )}
          {cost.kind === "report" && (
            <>
              {cost.partial && (
                <div style={{ color: T.faint, fontSize: 12, marginBottom: 6 }}>
                  {t("panel.skills.partialNote")}
                </div>
              )}
              {(() => {
                const parsed = parseSkillCosts(cost.text);
                if (!parsed || parsed.length === 0)
                  return (
                    <pre
                      data-omc-skill-doctor=""
                      aria-label={t("panel.skills.costsReportLabel")}
                      style={{ ...code, maxHeight: 320, overflow: "auto", margin: 0 }}
                    >
                      {cost.text}
                    </pre>
                  );
                return (
                  <>
                    <div style={{ maxHeight: 320, overflow: "auto" }}>
                      <table
                        data-omc-skill-cost-table=""
                        aria-label={t("panel.skills.costsTableLabel")}
                        style={{ borderCollapse: "collapse", width: "100%" }}
                      >
                        <thead>
                          <tr>
                            {costCols.map((c) => (
                              <th
                                key={c.col}
                                data-omc-skill-cost-header={c.col}
                                aria-sort={
                                  costSort.col === c.col
                                    ? costSort.dir === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                                style={{
                                  ...meta,
                                  textAlign: "left",
                                  position: "sticky",
                                  top: 0,
                                  background: T.card,
                                  borderBottom: `1px solid ${T.border}`,
                                  padding: "2px 6px",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCostSort((prev) =>
                                      prev.col === c.col
                                        ? { col: c.col, dir: prev.dir === "asc" ? "desc" : "asc" }
                                        : { col: c.col, dir: "desc" },
                                    )
                                  }
                                  style={{
                                    background: "none",
                                    border: 0,
                                    padding: 0,
                                    margin: 0,
                                    font: "inherit",
                                    color: "inherit",
                                    cursor: "pointer",
                                  }}
                                >
                                  {t(`panel.skills.col.${c.col}`)}
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortSkillCosts(parsed, costSort.col, costSort.dir).map((row) => (
                            <tr key={row.skill}>
                              {costCols.map((c) => {
                                const cellStyle: CSSProperties = {
                                  ...meta,
                                  color: T.muted,
                                  padding: "2px 6px",
                                };
                                if (c.numeric) {
                                  cellStyle.fontFamily = T.mono;
                                  cellStyle.textAlign = "right";
                                }
                                return (
                                  <td key={c.col} style={cellStyle}>
                                    {row[c.col]}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <span
                      data-omc-skill-cost-note=""
                      style={{ ...meta, display: "block", marginTop: 6, whiteSpace: "normal" }}
                    >
                      {t("panel.skills.costNote")}
                    </span>
                  </>
                );
              })()}
            </>
          )}
          {cost.kind !== "loading" && (
            <button type="button" onClick={loadCost} style={{ ...btn, marginTop: 8 }}>
              {t("panel.refresh")}
            </button>
          )}
        </div>
      </details>
      <details
        data-omc-usage-drivers=""
        onToggle={(e) => {
          if (e.currentTarget.open && drivers === null) loadDrivers();
        }}
      >
        <summary style={FOLD_HEAD}>{t("panel.skills.driversHead")}</summary>
        <div style={FOLD_BODY}>
          <div
            data-omc-usage-drivers-note=""
            style={{ ...meta, display: "block", whiteSpace: "normal" }}
          >
            {t("panel.skills.driversNote")}
          </div>
          {drivers === null && (
            <>
              <div data-omc-skeleton="" style={{ height: 12, width: "45%", margin: "6px 0" }} />
              <div data-omc-skeleton="" style={{ height: 12, width: "80%", margin: "6px 0" }} />
              <div data-omc-skeleton="" style={{ height: 12, width: "62%", margin: "6px 0" }} />
            </>
          )}
          {drivers !== null && !drivers.ok && (
            <div style={{ ...meta, color: T.faint }}>{drivers.error}</div>
          )}
          {drivers !== null && drivers.ok && (
            <>
              {(() => {
                const win =
                  drivers.windows.find((w) => w.label === "Last 7d") ?? drivers.windows[0];
                if (!win)
                  return (
                    <div style={{ ...meta, color: T.faint }}>{t("panel.skills.noActivity")}</div>
                  );
                return (
                  <>
                    {/* `?? []` because this reply can come from a cache file written by an older
                      build that had no such field; a bare `.map` threw and React unmounted the
                      whole fold. Seen on this box 2026-09-20 against a cache from an hour before. */}
                    {(win.behaviours ?? []).map((b) => (
                      <div
                        key={b}
                        data-omc-usage-behaviour=""
                        style={{ ...meta, display: "block", whiteSpace: "normal", color: T.text }}
                      >
                        {behaviourText(b)}
                      </div>
                    ))}
                    {win.groups
                      .filter((g) => g.label !== "Skills")
                      .map((g) => (
                        <div key={g.label}>
                          <div
                            style={{
                              ...meta,
                              color: T.text,
                              marginTop: 6,
                              display: "block",
                            }}
                          >
                            {(() => {
                              const key = DRIVER_GROUP_KEYS.get(g.label);
                              return key ? t(key) : g.label;
                            })()}
                          </div>
                          {g.drivers.map((d) => (
                            <div
                              key={d.name}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr auto",
                                columnGap: 12,
                                alignItems: "baseline",
                              }}
                            >
                              <span>{d.name}</span>
                              <span style={{ fontVariantNumeric: "tabular-nums", color: T.faint }}>
                                {d.pct}%
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    <div data-omc-usage-drivers-window="" style={{ ...meta }}>
                      {t("panel.skills.driversWindow", {
                        requests: win.requests,
                        sessions: win.sessions,
                      })}
                    </div>
                  </>
                );
              })()}
            </>
          )}
          <button
            type="button"
            data-omc-usage-drivers-refresh=""
            aria-label={t("panel.skills.driversRefreshLabel")}
            style={{ ...btn, marginTop: 8 }}
            disabled={driversBusy}
            onClick={() => loadDrivers(true)}
          >
            {driversBusy ? t("panel.skills.readingBusy") : t("panel.refresh")}
          </button>
        </div>
      </details>
    </div>
  );
}
