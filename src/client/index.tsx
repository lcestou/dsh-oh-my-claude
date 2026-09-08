// Browser half: Settings → "Oh My Claude". A branded header, then two cards: Sessions (one
// transcript list across this box and every saved box — filter by box, workspace, origin; open
// here or jump to the box) and Boxes (this box as the first row, plus the ssh and linked-dsh
// machines you add, each probed for claude version and login). Built into lib/client.js by
// `bun run build`.
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ROUTE,
  fmtCost,
  fmtDuration,
  cacheShare,
  T,
  btn,
  meta,
  code,
  codeInline,
  readJson,
  card,
  cardHead,
  h3,
  row,
  pill,
  chip,
  select,
  inputStyle,
  ago,
  btnPrimary,
  CLAUDE_ORANGE,
  CLAUDE_SHIMMER,
  CLAUDE_MARK,
  isRingRoot,
  SessionData,
  isOwnedActive,
  activeClaudeSession,
  isClaudeSession,
  activeClaudeProvider,
  type ClientCtx,
  openHere,
  maskEmail,
} from "./shared.js";
import { AccessShield, OhMyClaudeControl } from "./panel.js";
import { markTitle, newlyWaiting, noticesOn, type NoticeSnapshot } from "./notices.js";
import { SETTINGS_SCOPES, SCOPE_LABELS, overrideNote } from "./settings.js";
import type { SettingsScope, SettingsScopeInfo } from "./settings.js";
export { type SessionData, isOwnedActive, fmtCost, fmtDuration, cacheShare };

/** Deep link another box's panel sends us to: `#claude-session=<id>&cwd=<path>`. */
const HASH_KEY = "claude-session";
/** Format byte sizes for session rows. */
const size = (bytes: number): string =>
  bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
/** `/home/me/Projects/app` → `Projects/app`; keeps the full path for the title attribute. */
const shortPath = (p: string | undefined): string => {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : p;
};

/** Plugin name identifier. */
export const name = "dsh-oh-my-claude-client";
/** Services injected into the client plugin by dsh. */
export const inject = ["slots", "sessions", "workspaces", "modelDirectories"];

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
/** JSON.parse hands back one of six shapes; this tells the plain object apart. */
const isObj = (v: Json | undefined): v is JsonObject => v instanceof Object && !Array.isArray(v);
const count = (v: Json | undefined): number =>
  Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0;

/** Default Claude Code spinner verbs, extracted from the installed CLI bundle. */
const DEFAULT_VERBS = [
  "Accomplishing",
  "Actioning",
  "Actualizing",
  "Architecting",
  "Baking",
  "Beaming",
  "Beboppin'",
  "Befuddling",
  "Billowing",
  "Blanching",
  "Bloviating",
  "Boogieing",
  "Boondoggling",
  "Booping",
  "Bootstrapping",
  "Brewing",
  "Bunning",
  "Burrowing",
  "Calculating",
  "Canoodling",
  "Caramelizing",
  "Cascading",
  "Catapulting",
  "Cerebrating",
  "Channeling",
  "Channelling",
  "Choreographing",
  "Churning",
  "Clauding",
  "Coalescing",
  "Cogitating",
  "Combobulating",
  "Composing",
  "Computing",
  "Concocting",
  "Considering",
  "Contemplating",
  "Cooking",
  "Crafting",
  "Creating",
  "Crunching",
  "Crystallizing",
  "Cultivating",
  "Deciphering",
  "Deliberating",
  "Determining",
  "Dilly-dallying",
  "Discombobulating",
  "Doing",
  "Doodling",
  "Drizzling",
  "Ebbing",
  "Effecting",
  "Elucidating",
  "Embellishing",
  "Enchanting",
  "Envisioning",
  "Fermenting",
  "Fiddle-faddling",
  "Finagling",
  "Flambéing",
  "Flibbertigibbeting",
  "Flowing",
  "Flummoxing",
  "Fluttering",
  "Forging",
  "Forming",
  "Frolicking",
  "Frosting",
  "Gallivanting",
  "Galloping",
  "Garnishing",
  "Generating",
  "Gesticulating",
  "Germinating",
  "Gitifying",
  "Grooving",
  "Gusting",
  "Harmonizing",
  "Hashing",
  "Hatching",
  "Herding",
  "Honking",
  "Hullaballooing",
  "Hyperspacing",
  "Ideating",
  "Imagining",
  "Improvising",
  "Incubating",
  "Inferring",
  "Infusing",
  "Ionizing",
  "Jitterbugging",
  "Julienning",
  "Kneading",
  "Leavening",
  "Levitating",
  "Lollygagging",
  "Manifesting",
  "Marinating",
  "Meandering",
  "Metamorphosing",
  "Misting",
  "Moonwalking",
  "Moseying",
  "Mulling",
  "Mustering",
  "Musing",
  "Nebulizing",
  "Nesting",
  "Newspapering",
  "Noodling",
  "Nucleating",
  "Orbiting",
  "Orchestrating",
  "Osmosing",
  "Perambulating",
  "Percolating",
  "Perusing",
  "Philosophising",
  "Photosynthesizing",
  "Pollinating",
  "Pondering",
  "Pontificating",
  "Pouncing",
  "Precipitating",
  "Prestidigitating",
  "Processing",
  "Proofing",
  "Propagating",
  "Puttering",
  "Puzzling",
  "Quantumizing",
  "Razzle-dazzling",
  "Razzmatazzing",
  "Recombobulating",
  "Reticulating",
  "Roosting",
  "Ruminating",
  "Sautéing",
  "Scampering",
  "Schlepping",
  "Scurrying",
  "Seasoning",
  "Shenaniganing",
  "Shimmying",
  "Simmering",
  "Skedaddling",
  "Sketching",
  "Slithering",
  "Smooshing",
  "Sock-hopping",
  "Spelunking",
  "Spinning",
  "Sprouting",
  "Stewing",
  "Sublimating",
  "Swirling",
  "Swooping",
  "Symbioting",
  "Synthesizing",
  "Tempering",
  "Thinking",
  "Thundering",
  "Tinkering",
  "Tomfoolering",
  "Topsy-turvying",
  "Transfiguring",
  "Transmuting",
  "Twisting",
  "Undulating",
  "Unfurling",
  "Unravelling",
  "Vibing",
  "Waddling",
  "Wandering",
  "Warping",
  "Whatchamacalliting",
  "Whirlpooling",
  "Whirring",
  "Whisking",
  "Wibbling",
  "Working",
  "Wrangling",
  "Zesting",
  "Zigzagging",
] as const;

/** Default ping-pong frames, played forward then reversed (~120 ms per frame). */
const DEFAULT_FRAMES = ["·", "✢", "✳", "✶", "✻", "✻"] as const;

/** Pick a verb at random from the list using the provided random function. */
export function pickVerb(list: readonly string[], random: () => number): string {
  // SAFETY: random() returns [0,1), so floor(random()*length) is always a valid index.
  return list[Math.floor(random() * list.length)]!;
}

/** Merge default verbs with a settings.json spinnerVerbs entry. */
export function mergeVerbs(
  defaults: readonly string[],
  setting: { mode: "append" | "replace"; verbs: string[] } | undefined,
): string[] {
  if (!setting) return [...defaults];
  if (setting.mode === "replace") return [...setting.verbs];
  return [...defaults, ...setting.verbs];
}

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

export interface GroupInfo {
  key: string;
  name: string;
  host?: string;
  ok: boolean;
  error?: string;
  sessions: SessionData[];
  box?: BoxData;
}

/** Rows shown per box before "Load more"; each press adds another PAGE. */
const PAGE = 10;

/**
 * The rows to show, newest first, capped to `shown[key]` (default PAGE). With a box selected the
 * key is that box; with "all" every box is merged into one recency-sorted stream keyed `"all"`, so
 * the list reads as one timeline rather than per-box sections. `hidden[key]` is how many more sit
 * past the cap and `matched[key]` the filtered total, for the "Load more"/"Load all" labels. Pure,
 * so the paging math is checked without a DOM.
 */
export function pageSessions(
  groups: GroupInfo[],
  filters: { box: string; cwd: string; origin: string; shown: Record<string, number> },
) {
  const { box, cwd, origin, shown } = filters;
  const hidden: Record<string, number> = {};
  const matched: Record<string, number> = {};
  const keep = (s: SessionData) =>
    (cwd === "all" || s.cwd === cwd) && (origin === "all" || originOf(s) === origin);
  const cappedList = (pairs: Array<{ g: GroupInfo; s: SessionData }>, key: string) => {
    const sorted = pairs.toSorted((a, b) => b.s.modifiedAt - a.s.modifiedAt);
    matched[key] = sorted.length;
    const cap = shown[key] ?? PAGE;
    if (sorted.length > cap) hidden[key] = sorted.length - cap;
    return sorted.slice(0, cap);
  };

  // One box selected: that box alone, keyed by its own url/"local".
  if (box !== "all") {
    const g = groups.find((x) => x.key === box);
    const pairs = g ? g.sessions.filter(keep).map((s) => ({ g, s })) : [];
    return { list: cappedList(pairs, box), hidden, matched };
  }

  // All boxes: one timeline across every box, capped once under "all". Session ids are unique per
  // box and the self-proxy box is dropped upstream, so no row appears twice.
  const pairs = groups.flatMap((g) => g.sessions.filter(keep).map((s) => ({ g, s })));
  return { list: cappedList(pairs, "all"), hidden, matched };
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
  // How many rows each box shows; every box starts at PAGE and grows by "Load more".
  const [shown, setShown] = useState<Record<string, number>>({});

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
        // Name is the host, not a fixed "This box": the plugin runs on whatever box, so the label
        // must read as that box's name. A "· here" marker in the chip says which one is local.
        key: "local",
        name: local.host ?? "This box",
        host: local.host,
        ok: true,
        sessions: local.sessions ?? [],
      });
    for (const b of boxes) {
      const r = remote.find((x) => x.url === b.url);
      // A box whose URL loops back to this same dsh (e.g. a NAS reverse proxy pointing at self)
      // reports the local hostname and returns the same transcripts already in the local group.
      // Skip it so nothing is listed twice; when unreachable we cannot tell, so it still shows.
      if (local?.host && r?.host && r.host === local.host) continue;
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

  // Rows in box order, newest first within each box, capped to that box's `shown` count. `hidden`
  // and `matched` are per box so the footer can offer "Load more"/"Load all" and count the rest.
  const paged = useMemo(
    () => pageSessions(groups, { box, cwd, origin, shown }),
    [groups, box, cwd, origin, shown],
  );
  const rows = paged.list;

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
  // One box (local only, or a self-proxy dropped) needs no per-row origin pill. The merged "all"
  // view and any specific-box view page under one key, so the footer is a single control.
  const multiBox = groups.length > 1;
  const moreKey = box === "all" ? "all" : box;
  const more = paged.hidden[moreKey] ?? 0;
  const grown = (shown[moreKey] ?? PAGE) > PAGE;
  return (
    <section id="dsh-oh-my-claude-sessions-card" style={card}>
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
        id="dsh-oh-my-claude-session-filters"
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
            {g.key === "local" ? " · here" : ""}
            {g.ok ? ` · ${g.sessions.length}` : " · offline"}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <select
          id="dsh-oh-my-claude-cwd-filter"
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
          id="dsh-oh-my-claude-origin-filter"
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
        <p id="dsh-oh-my-claude-error" style={{ color: T.err, fontSize: 13, margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      {!loading && rows.length === 0 && (
        <p id="dsh-oh-my-claude-empty" style={{ ...meta, marginTop: 10 }}>
          No Claude Code sessions match.
        </p>
      )}
      <div id="dsh-oh-my-claude-sessions" style={{ marginTop: 6 }}>
        {rows.map((r) => {
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
          return (
            <div
              key={`${r.g.key}-${r.s.id}`}
              data-testid="dsh-oh-my-claude-session-row"
              style={row}
            >
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
                  {multiBox && (
                    <span style={pill(T.faint)} title={r.g.host}>
                      {r.g.host ?? r.g.name}
                    </span>
                  )}
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
                id={`dsh-oh-my-claude-session-${r.s.id}-button`}
                type="button"
                style={opened ? btn : btnPrimary}
                disabled={busy}
                onClick={() => open(r)}
              >
                {label}
              </button>
            </div>
          );
        })}
        {more > 0 && (
          <div
            data-testid="dsh-oh-my-claude-load-more"
            style={{ display: "flex", gap: 8, padding: "6px 0 2px" }}
          >
            <button
              type="button"
              style={btn}
              onClick={() => setShown((m) => ({ ...m, [moreKey]: (m[moreKey] ?? PAGE) + PAGE }))}
            >
              Load {Math.min(PAGE, more)} more
            </button>
            {grown && (
              <button
                type="button"
                style={btn}
                onClick={() =>
                  setShown((m) => ({ ...m, [moreKey]: paged.matched[moreKey] ?? PAGE }))
                }
              >
                Load all {paged.matched[moreKey] ?? ""}
              </button>
            )}
          </div>
        )}
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

/** The body `PUT /settings` takes: a scope names the file, and the server resolves it. */
interface SettingsWrite {
  text: string;
  scope?: SettingsScope;
  cwd?: string;
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
    const body: SettingsWrite = box ? { text } : { text, scope };
    if (!box && projectCwd !== null) body.cwd = projectCwd;
    fetch(settingsUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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

  const override = box ? "" : overrideNote(scopes, scope);
  const readOnly = !box && scope === "managed";

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
        id="dsh-oh-my-claude-settings-cancel"
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
        id="dsh-oh-my-claude-settings-save"
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
        id="dsh-oh-my-claude-settings-edit"
        type="button"
        style={btn}
        disabled={busy || file === null || readOnly}
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
      id="dsh-oh-my-claude-settings"
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
      {!box && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }} htmlFor="dsh-oh-my-claude-scope">
              Scope
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
                <span style={{ fontSize: 12, color: T.muted }}>no session open in a directory</span>
              ))}
          </div>
          {(readOnly || override) && (
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>
              {readOnly ? `${SCOPE_LABELS.managed} is read-only. ` : ""}
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

type BoxKind = "ssh" | "dsh";

/**
 * Every machine, in one place. This box is the first row (auto-detected, not removable — it is the
 * environment the plugin was installed on); the rest you add, in two kinds:
 *  - **SSH** (`ssh`): this dsh drives Claude Code on the box over ssh; it becomes its own entry in
 *    the model picker, nothing runs there but the CLI. Saved in the plugin's own state.
 *  - **Link** (`dsh`): the box runs its own dsh with this plugin; its sessions show in the archive
 *    and Open hops the browser there. Same idea as another tool's environments, nothing proxied.
 * Every row is probed server-side so it shows host, claude version and login before you use it.
 */
function Boxes({ boxes, setBoxes, open, onToggle }: BoxesProps) {
  const [probe, setProbe] = useState<Record<string, ProbeEntry>>({});
  const [self, setSelf] = useState<{ plugin?: string } | null>(null);
  const [ssh, setSsh] = useState<SshBoxData[]>([]);
  const [sshProbe, setSshProbe] = useState<Record<string, SshProbeEntry>>({});
  const [kind, setKind] = useState<BoxKind>("ssh");
  const [draft, setDraft] = useState({ name: "", url: "", token: "", host: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openSettingsUrl, setOpenSettingsUrl] = useState<string | null>(null);
  const [me, setMe] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    fetch(`${ROUTE}/ssh-boxes`)
      .then((r) => readJson<{ boxes?: SshBoxData[] }>(r))
      .then((b) => setSsh(b.boxes ?? []))
      .catch((e: Error) => setError(e.message));
    fetch(`${ROUTE}/status`)
      .then((r) => readJson<RuntimeStatus | null>(r))
      .then(setMe)
      .catch(() => {});
  }, []);

  const refresh = () => {
    if (boxes.length === 0 && ssh.length === 0) return;
    setBusy(true);
    setError("");
    const jobs: Promise<unknown>[] = [];
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
      .then((b) => setSsh(b.boxes ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const clear = () => setDraft({ name: "", url: "", token: "", host: "" });
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    if (kind === "ssh") {
      if (!draft.host.trim()) return;
      saveSsh([...ssh, { name: draft.name.trim(), host: draft.host.trim() }]).then(clear);
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

  const total = boxes.length + ssh.length;
  const reachable =
    boxes.filter((b) => probe[b.url]?.ok).length +
    ssh.filter((b) => sshProbe[b.host]?.status?.binary).length;
  const summary =
    total === 0
      ? "none saved"
      : `${total} saved · ${busy ? "checking…" : `${reachable} reachable`}`;
  const seg = (k: BoxKind, label: string) => (
    <button
      type="button"
      style={
        kind === k
          ? { ...btn, background: CLAUDE_ORANGE, color: T.onBrand, border: "1px solid transparent" }
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
      title="Boxes"
      summary={summary}
      actions={
        open ? (
          <button type="button" style={btn} disabled={busy || total === 0} onClick={refresh}>
            {busy ? "Checking…" : "Refresh"}
          </button>
        ) : null
      }
      open={open}
      onToggle={onToggle}
    >
      <p style={{ margin: "0 0 4px", color: T.muted, fontSize: 13 }}>
        This box plus any you add. <b>SSH</b>: this dsh drives Claude Code on the box over ssh — it
        shows up in the model picker, no dsh needed there. <b>Link</b>: it runs its own dsh with
        this plugin — its sessions show in the archive and Open hops there. Each keeps its own
        Claude Code login.
      </p>
      {error && <p style={{ color: T.err, fontSize: 13, margin: "4px 0" }}>{error}</p>}
      {me && (
        <div data-testid="dsh-oh-my-claude-self-box-row" style={row}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: T.text, fontWeight: 600 }}>This box</div>
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
              <span style={pill(CLAUDE_ORANGE)}>this box</span>
              {me.host && <span style={{ fontFamily: T.mono }}>{me.host}</span>}
              <span style={pill(me.binary ? T.ok : T.err)}>
                {me.binary ? `claude ${me.version ?? ""}`.trim() : "claude not on PATH"}
              </span>
              <span style={pill(me.loggedIn ? T.ok : T.err)}>
                {me.loggedIn ? maskEmail(me.email ?? "logged in") : "not logged in"}
              </span>
              {!me.loggedIn && (
                <span style={{ width: "100%", color: T.err, fontSize: 12 }}>
                  Run <code style={codeInline}>claude auth login</code> in a terminal here, then
                  refresh.
                </span>
              )}
            </div>
          </div>
          <span style={{ ...meta, alignSelf: "center" }}>auto</span>
        </div>
      )}
      {ssh.map((b) => {
        const st = sshProbe[b.host]?.status;
        const up = st && !st.error && st.binary;
        return (
          <div key={`ssh:${b.host}`} data-testid="dsh-oh-my-claude-ssh-box-row" style={row}>
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
                <span style={pill(T.faint)}>ssh</span>
                <span style={{ fontFamily: T.mono }}>{b.host}</span>
                {!st && <span style={pill(T.faint)}>{busy ? "checking" : "unchecked"}</span>}
                {st?.error && <span style={pill(T.err)}>{st.error}</span>}
                {up && (
                  <>
                    <span style={pill(st.binary ? T.ok : T.err)}>
                      {st.binary ? `claude ${st.version ?? ""}`.trim() : "no claude"}
                    </span>
                    <span style={pill(st.loggedIn ? T.ok : T.err)}>
                      {st.loggedIn ? maskEmail(st.email ?? "logged in") : "not logged in"}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button type="button" style={btn} disabled={busy} onClick={() => removeSsh(b.host)}>
              Remove
            </button>
          </div>
        );
      })}
      {boxes.map((b) => {
        const st = probe[b.url];
        const ok = st?.ok;
        const skew = ok && self && st.status?.plugin && st.status.plugin !== self.plugin;
        return (
          <div key={`dsh:${b.url}`} data-testid="dsh-oh-my-claude-box-row" style={row}>
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
                <span style={pill(T.faint)}>link</span>
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
                      {st.status.loggedIn
                        ? maskEmail(st.status.email ?? "logged in")
                        : "not logged in"}
                    </span>
                    <span style={pill(skew ? T.warn : T.faint)}>
                      plugin {st.status.plugin ?? "?"}
                      {skew ? ` ≠ ${self.plugin} here` : ""}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              style={btn}
              disabled={busy || !ok}
              onClick={() => setOpenSettingsUrl(openSettingsUrl === b.url ? null : b.url)}
            >
              Edit settings
            </button>
            <button type="button" style={btn} disabled={busy} onClick={() => removeDsh(b.url)}>
              Remove
            </button>
            <button type="button" style={btnPrimary} onClick={() => jump(b)}>
              Open
            </button>
          </div>
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
      <form
        onSubmit={add}
        style={{
          ...row,
          borderTop: total ? `1px solid ${T.border}` : "none",
          paddingTop: total ? 12 : 4,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {seg("ssh", "SSH")}
          {seg("dsh", "Link")}
        </div>
        <input
          style={{ ...inputStyle, flex: "0 1 140px" }}
          placeholder="Name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        {kind === "ssh" ? (
          <input
            style={{ ...inputStyle, flex: "1 1 240px" }}
            placeholder="user@host or ssh alias"
            value={draft.host}
            onChange={(e) => setDraft({ ...draft, host: e.target.value })}
          />
        ) : (
          <>
            <input
              style={{ ...inputStyle, flex: "1 1 260px" }}
              placeholder="https://dsh.other-box.lan"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
            <input
              style={{ ...inputStyle, flex: "1 1 200px" }}
              type="password"
              autoComplete="off"
              placeholder="dsh token (optional)"
              value={draft.token}
              onChange={(e) => setDraft({ ...draft, token: e.target.value })}
            />
          </>
        )}
        <button
          type="submit"
          style={btn}
          disabled={
            busy || !draft.name.trim() || (kind === "ssh" ? !draft.host.trim() : !draft.url.trim())
          }
        >
          Add
        </button>
      </form>
      <div style={{ ...meta, whiteSpace: "normal", marginTop: 4 }}>
        {kind === "ssh" ? (
          <>
            Key-based ssh only. Not logged in there? Run{" "}
            <code style={codeInline}>ssh &lt;host&gt;</code> then{" "}
            <code style={codeInline}>claude auth login</code> on the box; it needs a browser. The
            file-reading tabs still read this box, not the remote.
          </>
        ) : (
          <>
            Token: the box's dsh launch token (printed when dsh web starts, or already in its URL
            behind a proxy). Needed only when this browser has never logged into that box.
          </>
        )}
      </div>
    </Card>
  );
}

interface SshBoxData {
  name: string;
  host: string;
}
interface SshProbeEntry {
  name: string;
  host: string;
  status?: {
    host?: string;
    binary?: string;
    version?: string;
    loggedIn?: boolean;
    email?: string;
    error?: string;
  };
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
        `[dsh-oh-my-claude] deep link failed: ${e instanceof Error ? e.message : String(e)}`,
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
interface UsageCredits {
  enabled: boolean;
  capped: boolean;
  used?: string;
  limit?: string;
  canPurchase: boolean;
  note?: string;
}
type UsageReply =
  | {
      ok: true;
      fetchedAt: number;
      windows: UsageWindow[];
      credits?: UsageCredits;
      host?: string;
      email?: string | null;
    }
  | { ok: false; error: string; windows?: undefined; host?: string; email?: string | null };
/** "m*****@example.com on <host>" or whichever half is known; the usage is this box's login. */
const whose = (r: UsageReply): string =>
  [r.email ? maskEmail(r.email) : null, r.host].filter((x): x is string => !!x).join(" on ");

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

// Per provider: two plugin instances are two accounts, so two answers.
const usageCache = new Map<string, { at: number; reply: UsageReply }>();
const loadUsage = async (provider?: string): Promise<UsageReply> => {
  const key = provider ?? "";
  const hit = usageCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.reply;
  const url = provider
    ? `${ROUTE}/usage?force=1&provider=${encodeURIComponent(provider)}`
    : `${ROUTE}/usage?force=1`;
  const reply = await readJson<UsageReply>(await fetch(url));
  usageCache.set(key, { at: Date.now(), reply });
  return reply;
};

/** Fill a block with the usage rows, styled like the meter's own legend rows. */
type ContextReply =
  | {
      ok: true;
      categories: Array<{ name: string; tokens: number; deferred: boolean }>;
      totalTokens: number;
      maxTokens: number;
      percentage: number;
    }
  | { ok: false; error: string };
const loadContext = async (sessionId: string): Promise<ContextReply> => {
  try {
    const r = await fetch(`${ROUTE}/context?session=${encodeURIComponent(sessionId)}`);
    // SAFETY: the body is our own JSON route; both shapes carry `ok`
    return (await r.json()) as ContextReply;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};
const kTokens = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
function renderContext(el: HTMLElement, reply: ContextReply) {
  el.replaceChildren();
  if (!reply.ok) {
    el.textContent = `Context breakdown: ${reply.error}`;
    return;
  }
  const head = document.createElement("div");
  head.style.cssText = `display:flex;justify-content:space-between;color:${T.text};font-weight:500`;
  const headLabel = document.createElement("span");
  headLabel.textContent = "Context breakdown (Claude's count)";
  const headValue = document.createElement("span");
  headValue.style.cssText = "font-variant-numeric:tabular-nums";
  headValue.textContent = `${kTokens(reply.totalTokens)} / ${kTokens(reply.maxTokens)} · ${Math.round(reply.percentage)}%`;
  head.append(headLabel, headValue);
  el.append(head);
  for (const c of reply.categories) {
    if (c.deferred || c.tokens <= 0 || c.name === "Free space") continue;
    const line = document.createElement("div");
    line.style.cssText = "display:flex;justify-content:space-between;gap:12px";
    const label = document.createElement("span");
    label.textContent = c.name;
    const val = document.createElement("span");
    val.style.cssText = "font-variant-numeric:tabular-nums";
    val.textContent = kTokens(c.tokens);
    line.append(label, val);
    el.append(line);
  }
}

const extLink = (text: string, href: string): HTMLAnchorElement => {
  const a = document.createElement("a");
  a.textContent = text;
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer noopener";
  a.style.color = T.brand;
  return a;
};

/** The disclaimer is Claude's markdown, at most one `[text](url)`: the link becomes an anchor and
 *  the rest stays text. A href the payload writes is followed only when it is an https URL. */
const appendNote = (el: HTMLElement, note: string) => {
  const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(note);
  const [whole, text, href] = m ?? [];
  if (!m || !whole || !text || !href) {
    el.append(note);
    return;
  }
  el.append(note.slice(0, m.index));
  el.append(href.startsWith("https://") ? extLink(text, href) : text);
  el.append(note.slice(m.index + whole.length));
};

/**
 * Credits sit under the plan windows in the same grammar, but with no bar and no reset: they are a
 * balance, not a window, and a percent here would imply a clock they do not have. The caption is
 * the API's own sentence about them, so the panel never invents its own account of what they cover.
 */
function creditsRow(c: UsageCredits): HTMLElement {
  const creditsLine = document.createElement("div");
  creditsLine.style.cssText =
    "display:grid;grid-template-columns:1fr auto;align-items:baseline;column-gap:12px;row-gap:3px;padding:3px 0";
  const label = document.createElement("span");
  label.textContent = "Extra usage";
  label.style.cssText = `color:${T.text};font-weight:500`;
  const capped = c.enabled && c.capped;
  const amount = c.used ? ` · ${c.used}${c.limit ? ` / ${c.limit}` : ""}` : "";
  const value = document.createElement("span");
  value.textContent = `${capped ? "Limit reached" : c.enabled ? "On" : "Off"}${amount}`;
  value.style.cssText = `font-variant-numeric:tabular-nums;font-weight:600;color:${capped ? T.err : T.text}`;
  creditsLine.append(label, value);
  // No caption at all when the API neither explains credits nor lets this account buy them.
  if (c.note || c.canPurchase) {
    const caption = document.createElement("span");
    caption.style.cssText = `grid-column:1 / -1;color:${T.faint};font-size:11px;line-height:16px`;
    if (c.note) appendNote(caption, c.note);
    if (c.canPurchase) {
      if (c.note) caption.append(" ");
      caption.append(extLink("Buy credits", "https://claude.ai/settings/usage"));
    }
    creditsLine.append(caption);
  }
  return creditsLine;
}

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
    // Label and reset on the left, percent on the right, a thin bar under both: the same shape
    // dsh draws for the context meter below, so the two sections read as one panel.
    const pct = Math.max(0, Math.min(100, w.usedPercent));
    const tone = pct >= 90 ? T.err : pct >= 70 ? T.warn : CLAUDE_ORANGE;
    const usageRow = document.createElement("div");
    usageRow.style.cssText =
      "display:grid;grid-template-columns:1fr auto;align-items:baseline;column-gap:12px;row-gap:3px;padding:3px 0";
    const label = document.createElement("span");
    label.textContent = w.label;
    label.style.cssText = `color:${T.text};font-weight:500`;
    const value = document.createElement("span");
    value.textContent = `${Math.round(pct)}%`;
    value.style.cssText = `font-variant-numeric:tabular-nums;font-weight:600;color:${tone}`;
    const bar = document.createElement("div");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-label", `${w.label} ${Math.round(pct)}% used`);
    bar.style.cssText = `grid-column:1 / -1;height:4px;border-radius:2px;background:${T.border};overflow:hidden`;
    const fill = document.createElement("div");
    fill.style.cssText = `height:100%;width:${pct}%;border-radius:2px;background:linear-gradient(90deg,${tone},${pct >= 70 ? tone : CLAUDE_SHIMMER})`;
    bar.append(fill);
    const when = document.createElement("span");
    when.textContent = resetText(w.resetsAt);
    when.style.cssText = `grid-column:1 / -1;color:${T.faint};font-size:11px;line-height:16px`;
    usageRow.append(label, value, bar, when);
    block.append(usageRow);
  }
  if (reply.windows.length === 0) {
    const p = document.createElement("div");
    p.textContent = "Claude usage: no limits reported";
    p.style.color = T.faint;
    block.append(p);
  }
  // Last, whether or not any window was reported: a user with no limits still plans around credits.
  if (reply.credits) block.append(creditsRow(reply.credits));
}

/**
 * Put the plan usage inside dsh's context-meter popover, above the "N% of context used" line,
 * and one compact line into the ring's hover tooltip.
 * The meter (dsh-client-ui-conversation ContextMeter) has no slot, so this watches the DOM for
 * its dialog: a `[role=dialog]` whose parent holds a `button[aria-haspopup=dialog]` with the ring.
 * ponytail: DOM hook on a structural selector; swap for a slot the day the meter grows one.
 */
/**
 * One shared `document.body` observer for every feature that reacts to nodes dsh adds. dsh appends
 * a message chunk many times a second during a turn, so a per-feature observer that ran a
 * `querySelectorAll` per mutation multiplied that load by the feature count and janked mobile
 * (Firefox worst). Here any mutation burst just marks the frame dirty; on the next animation frame
 * each registered scan runs once against `document.body`. The feature selectors are rare attributes
 * ([role=dialog/tooltip/status]), so one body-wide scan per frame is far cheaper than scanning each
 * of the hundreds of nodes a streaming turn appends. Scans do their own scoping and idempotency.
 */
type FrameScan = () => void;
const frameScans = new Set<FrameScan>();
let bodyObserver: MutationObserver | undefined;
let scanQueued = false;
const flushScans = () => {
  scanQueued = false;
  for (const scan of frameScans) scan();
};
const onBodyMutation = (scan: FrameScan) => {
  frameScans.add(scan);
  if (bodyObserver) return;
  bodyObserver = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(flushScans);
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
};

function watchContextMeter(ctx: ClientCtx) {
  const MARK = "data-dsh-oh-my-claude-usage";
  // The mark goes on the node we inject, never on dsh's node: React owns these children and drops
  // ours whenever it re-renders the panel, and a mark on the host would say "done" forever while
  // the row it names is gone.
  const missing = (host: HTMLElement) => host.querySelector(`:scope > [${MARK}]`) === null;
  const attach = (panel: HTMLElement) => {
    if (!missing(panel)) return;
    // Only sessions on a Claude mount: a local-model session's meter stays dsh's own.
    if (!activeClaudeSession(ctx)) return;
    const block = document.createElement("div");
    block.setAttribute(MARK, "1");
    block.style.cssText = `border-bottom:1px solid ${T.border};margin-bottom:10px;padding-bottom:8px;font-size:13px;line-height:20px`;
    const title = document.createElement("div");
    title.style.cssText = `display:flex;align-items:center;gap:6px;color:${T.text};font-weight:600`;
    const mark = document.createElement("span");
    mark.textContent = CLAUDE_MARK;
    mark.setAttribute("aria-hidden", "true");
    mark.style.cssText = `color:${CLAUDE_ORANGE};font-size:14px;line-height:1`;
    const titleText = document.createElement("span");
    titleText.textContent = "Claude usage";
    title.append(mark, titleText);
    // Account and box on their own caption line: the email plus host wrapped the title before.
    const caption = document.createElement("div");
    caption.style.cssText = `color:${T.faint};font-size:11px;line-height:16px;margin:-2px 0 4px 20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
    const rows = document.createElement("div");
    rows.textContent = "Loading…";
    rows.style.color = T.faint;
    // Below the plan bars: the CLI's own context breakdown for this session (item 30), one row
    // per category that holds tokens, deferred tool schemas folded out since they are not in context.
    const breakdown = document.createElement("div");
    breakdown.style.cssText = `margin-top:6px;padding-top:6px;border-top:1px solid ${T.border};color:${T.faint};font-size:12px;line-height:18px`;
    breakdown.textContent = "Context breakdown…";
    block.append(title, caption, rows, breakdown);
    panel.prepend(block);
    const sid = activeClaudeSession(ctx);
    const provider = activeClaudeProvider(ctx);
    if (sid) loadContext(sid).then((reply) => renderContext(breakdown, reply));
    loadUsage(provider).then(
      (reply) => {
        const who = whose(reply);
        if (who) {
          caption.textContent = who;
          caption.title = who;
        } else caption.remove();
        renderUsage(rows, reply);
      },
      (e: Error) => renderUsage(rows, { ok: false, error: e.message }),
    );
  };
  // The hover tooltip can sit between the button and the dialog at insertion time, so the
  // dialog is matched through its parent rather than as the button's next sibling.
  // The hover bubble (`role=tooltip`, a sibling of the ring button) gets one compact line on top.
  const bubble = (tip: HTMLElement) => {
    if (!missing(tip)) return;
    if (!activeClaudeSession(ctx)) return;
    const line = document.createElement("div");
    line.setAttribute(MARK, "1");
    // Above dsh's own sentence, like the panel rows, with a hairline between.
    line.style.cssText =
      "border-bottom:1px solid rgba(255,255,255,.25);margin-bottom:4px;padding-bottom:4px;display:flex;gap:6px;align-items:baseline";
    const mark = document.createElement("span");
    mark.textContent = CLAUDE_MARK;
    mark.setAttribute("aria-hidden", "true");
    mark.style.color = CLAUDE_SHIMMER;
    const text = document.createElement("span");
    text.textContent = "Claude usage…";
    line.append(mark, text);
    tip.prepend(line);
    loadUsage(activeClaudeProvider(ctx)).then(
      (reply) => {
        const who = reply.host ? ` (${reply.host})` : "";
        text.textContent = reply.ok
          ? `Claude ${reply.windows.map((w) => `${w.label.toLowerCase()} ${Math.round(w.usedPercent)}%`).join(" · ") || "usage: no limits"}${who}`
          : `Claude usage: ${reply.error}`;
      },
      (e: Error) => {
        text.textContent = `Claude usage: ${e.message}`;
      },
    );
  };
  const scan = (root: ParentNode) => {
    for (const el of root.querySelectorAll<HTMLElement>('[role="dialog"]'))
      if (isRingRoot(el.parentElement)) attach(el);
    for (const el of root.querySelectorAll<HTMLElement>('[role="tooltip"]'))
      if (isRingRoot(el.parentElement)) bubble(el);
    // A re-render adds nodes inside the dialog, not the dialog itself, so climb to it as well.
    if (root instanceof Element) {
      const dialog = root.closest<HTMLElement>('[role="dialog"]');
      if (dialog && isRingRoot(dialog.parentElement)) attach(dialog);
      const tip = root.closest<HTMLElement>('[role="tooltip"]');
      if (tip && isRingRoot(tip.parentElement)) bubble(tip);
    }
  };
  onBodyMutation(() => scan(document.body));
  scan(document.body);
}

/** Fetch Claude Code's settings.json text and extract spinnerVerbs if present. */
let spinnerSettings: Promise<{ verbs: string[]; frameSet: typeof DEFAULT_FRAMES }> | undefined;
const loadSpinnerSettings = async (): Promise<{
  verbs: string[];
  frameSet: typeof DEFAULT_FRAMES;
}> => {
  try {
    const body = await readJson<SettingsFile>(await fetch(`${ROUTE}/settings`));
    const parsed = JSON.parse(body.text);
    if (!isObj(parsed)) return { verbs: [...DEFAULT_VERBS], frameSet: [...DEFAULT_FRAMES] };
    const sv = parsed.spinnerVerbs;
    // SAFETY: spinnerVerbs comes from parsed JSON (a JsonObject); the cast is to read its known keys.
    if (!isObj(sv) || !Array.isArray((sv as { verbs?: unknown }).verbs))
      return { verbs: [...DEFAULT_VERBS], frameSet: [...DEFAULT_FRAMES] };
    // SAFETY: mode is a string key on the JsonObject; we validate the value below.
    const mode = (sv as { mode?: string }).mode;
    if (mode !== "append" && mode !== "replace")
      return { verbs: [...DEFAULT_VERBS], frameSet: [...DEFAULT_FRAMES] };
    // SAFETY: mode and verbs have been validated above; the cast narrows to the expected shape.
    return {
      verbs: mergeVerbs(DEFAULT_VERBS, sv as { mode: "append" | "replace"; verbs: string[] }),
      frameSet: [...DEFAULT_FRAMES],
    };
  } catch {
    return { verbs: [...DEFAULT_VERBS], frameSet: [...DEFAULT_FRAMES] };
  }
};

/** Wire one turn-status element for a claude-code session: verb + ping-pong spinner + orange gradient. */
/** Inject (or re-inject after a hot reload) the Claude-orange rule; idempotent by id. */
const ensureTurnStatusStyle = () => {
  let styleEl = document.getElementById("dsh-oh-my-claude-turn-status");
  if (styleEl) return;
  styleEl = document.createElement("style");
  styleEl.id = "dsh-oh-my-claude-turn-status";
  // The frames differ in advance width in a proportional font; a fixed cell keeps the verb still.
  // `body[data-omc-claude]` is set while the open session is a Claude mount, so the row is orange
  // from its first paint; the watcher then swaps the text and adds the spinner a frame later.
  //
  // The last two rules recolour the conversation's selected view tab (Chat / Trajectory), which dsh
  // paints from its blue `--dsw-alias-state-business-primary` — the label and its underline draw
  // from the same token but as `color` and `background`, so both are overridden. Gated on the same
  // body attribute, so a session that switches off a Claude mount hands the tab straight back to
  // dsh's blue on the next paint. ponytail: `[role=tablist] > [role=tab]` catches any dsh view-tab
  // switcher; if a non-conversation one should stay blue, narrow it the day one appears.
  styleEl.textContent = `body[data-omc-claude] [role="status"][aria-live="polite"],[data-dsh-oh-my-claude-turn]{background-image:linear-gradient(90deg,${CLAUDE_ORANGE} 0%,${CLAUDE_ORANGE} 40%,${CLAUDE_SHIMMER} 50%,${CLAUDE_ORANGE} 60%,${CLAUDE_ORANGE} 100%)}[data-dsh-oh-my-claude-turn]>span[aria-hidden]{display:inline-block;width:1.3em;text-align:center;flex:none}body[data-omc-claude] [role="tablist"]>[role="tab"][aria-selected="true"]{color:${CLAUDE_ORANGE}}body[data-omc-claude] [role="tablist"]>[role="tab"][aria-selected="true"]::after{background:${CLAUDE_ORANGE}}`;
  document.head.appendChild(styleEl);
};

/** One verb per running turn: the row remounts on every tool step and dsh rewrites its text, so a
 *  fresh pick each time reads as flicker. Keyed by session; forgotten after a short absence. */
const turnVerbs = new Map<string, { verb: string; seen: number }>();
const VERB_MEMORY_MS = 4000;
const verbFor = (sessionId: string, verbs: string[]): string => {
  const now = Date.now();
  const kept = turnVerbs.get(sessionId);
  const verb = kept && now - kept.seen < VERB_MEMORY_MS ? kept.verb : pickVerb(verbs, Math.random);
  turnVerbs.set(sessionId, { verb, seen: now });
  return verb;
};

const wireTurnStatus = (
  el: HTMLElement,
  sessionId: string,
  verbs: string[],
  frames: readonly string[],
) => {
  ensureTurnStatusStyle();
  if (el.hasAttribute("data-dsh-oh-my-claude-turn")) return;
  el.setAttribute("data-dsh-oh-my-claude-turn", "1");

  // Build the leading spinner span.
  const spinner = document.createElement("span");
  spinner.setAttribute("aria-hidden", "true");
  el.prepend(spinner);

  // Find the original text node (first child before the clock span).
  const textNode = Array.from(el.childNodes).find(
    (n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim().length,
  );

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frameIndex = 0;
  let direction = 1; // 1 = forward, -1 = reverse

  const tick = () => {
    const kept = turnVerbs.get(sessionId);
    if (kept) kept.seen = Date.now(); // still running: keep this verb for the next remount
    if (reduced) {
      spinner.textContent = "✻";
      return;
    }
    // SAFETY: frameIndex is kept within bounds by the ping-pong logic above.
    spinner.textContent = frames[frameIndex]!;
    frameIndex += direction;
    if (frameIndex >= frames.length) {
      frameIndex = frames.length - 2;
      direction = -1;
    } else if (frameIndex < 0) {
      frameIndex = 1;
      direction = 1;
    }
  };
  const interval = setInterval(() => {
    // The 120ms beat doubles as the teardown check: React unmounts this row by removing an
    // ancestor, so watching for `el` itself in a removal record missed it and left one
    // whole-document observer plus one interval alive per row dsh ever drew.
    if (!el.isConnected) {
      clearInterval(interval);
      obs.disconnect();
      return;
    }
    tick();
  }, 120);
  tick();

  // Pick a fresh verb once per element instance.
  const verb = verbFor(sessionId, verbs);
  if (textNode) textNode.nodeValue = `${verb}…`;

  // Re-apply on characterData mutations (dsh may reset the text node).
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData" && textNode && r.target === textNode) {
        if (textNode.nodeValue !== `${verb}…`) textNode.nodeValue = `${verb}…`;
      }
    }
  });
  obs.observe(el, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: false,
  });
};

/**
 * Watch dsh's turn-status elements and restyle ones driven by claude-code sessions.
 * ponytail: DOM hook on a structural selector; swap for a slot the day the turn status grows one.
 */
/**
 * Say something when a Claude session the user is not on stops working. dsh has no notice of its
 * own (nothing in its bundle calls `Notification`), so a turn that ends in another session, or in a
 * tab behind this one, is silent.
 *
 * Two signals, both cheap: the OS notification when the browser has granted one, and a mark on the
 * tab title while the page is hidden. The list store is polled rather than subscribed to, the same
 * second-by-second read `watchTurnStatus` already does, so this holds whatever shape dsh's store
 * has today.
 */
function watchSessionNotices(ctx: ClientCtx) {
  let prev: NoticeSnapshot | null = null;
  const waiting = new Set<string>();
  const tick = () => {
    const snap = ctx.sessions.list.getSnapshot();
    if (!snap) return;
    // Copy the compared fields into fresh rows: dsh's store may reuse row objects between calls, and
    // a shared reference would make every field read `was === now`, so no transition would ever fire.
    const byId: NoticeSnapshot["byId"] = {};
    for (const [id, s] of Object.entries(snap.byId))
      byId[id] = { running: s.running, completed: s.completed, displayTitle: s.displayTitle };
    const next: NoticeSnapshot = { byId, current: snap.current };
    for (const id of newlyWaiting(prev, next)) {
      if (!isClaudeSession(ctx, id)) continue; // other providers are not this plugin's to announce
      waiting.add(id);
      notifyWaiting(ctx, id, snap.byId[id]?.displayTitle ?? id);
    }
    prev = next;
    // Reading it clears it: the open session, and everything else once the tab is looked at again.
    if (snap.current !== undefined) waiting.delete(snap.current);
    if (!document.hidden) waiting.clear();
    const wanted = markTitle(document.title, waiting.size);
    if (wanted !== document.title) document.title = wanted;
  };
  tick(); // take the baseline now, so the first interval already has something to compare against
  setInterval(tick, 1000);
}

function notifyWaiting(ctx: ClientCtx, id: string, title: string) {
  // Permission is only ever asked for from the panel's own toggle, so an ungranted browser is the
  // normal case here and the title mark carries it alone.
  if (!noticesOn() || !("Notification" in window) || Notification.permission !== "granted") return;
  // `tag` per session: a session that finishes twice replaces its own notice rather than stacking.
  const note = new Notification(title, { body: "Claude is waiting.", tag: `omc-${id}` });
  note.addEventListener("click", () => {
    window.focus();
    ctx.sessions.open(id);
    note.close();
  });
}

function watchTurnStatus(ctx: ClientCtx) {
  ensureTurnStatusStyle(); // a hot reload drops the old module's style tag but keeps marked elements
  // Keep a body flag in step with the open session so the first-paint colour rule applies before
  // the observer runs (the flash of dsh's blue the owner saw on first load).
  // Written only when it changes: this runs every second, and an attribute write invalidates the
  // style of everything the rule can match whether or not the value moved.
  const markBody = () => {
    const want = activeClaudeSession(ctx) ? "1" : null;
    if (document.body.getAttribute("data-omc-claude") === want) return;
    if (want === null) document.body.removeAttribute("data-omc-claude");
    else document.body.setAttribute("data-omc-claude", want);
  };
  markBody();
  setInterval(markBody, 1000);
  const attach = async (el: HTMLElement) => {
    // Only act on [role="status"][aria-live="polite"] (dsh's turn-status element).
    if (el.getAttribute("role") !== "status" || el.getAttribute("aria-live") !== "polite") return;
    const activeId = activeClaudeSession(ctx);
    if (!activeId) return;
    spinnerSettings ??= loadSpinnerSettings(); // once per page load
    const settings = await spinnerSettings;
    if (el.isConnected) wireTurnStatus(el, activeId, settings.verbs, settings.frameSet);
  };
  const scan = (root: HTMLElement) => {
    attach(root);
    for (const el of root.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"]'))
      attach(el);
  };
  // Once per dirty frame, and the cheapest check comes first: on a session that is not a Claude
  // mount there is nothing to attach, so bail before the querySelectorAll. attach is idempotent
  // (the status row carries a data-attr once wired), so re-scanning the body each frame is safe.
  onBodyMutation(() => {
    if (!activeClaudeSession(ctx)) return;
    scan(document.body);
  });
  scan(document.body);
}

/**
 * Tint dsh's running indicator (its state-dot matrix) Claude-orange for Claude sessions, both the
 * sidebar row dot and the job/subagent/plan dots inside the open conversation, leaving every other
 * provider dsh's own colour. dsh colours the `ongoing` dot from the
 * `--dsh-state-ongoing` custom property; an inline `color` on the svg overrides it, and clearing it
 * hands the row straight back to dsh — so a session that switches off a Claude mount reverts on the
 * next pass.
 *
 * The row carries no session id in the DOM, so a running dot is matched to a session by the title
 * text beside it (dsh renders `displayTitle` there, the same string the list store holds).
 * ponytail: title match, not id; two running sessions with the same title share a tint. Swap for a
 * per-row id the day dsh puts one on the row.
 */
// The title span sits next to the slot that holds the dot; the dot's nearest span ancestor is that
// slot, so its next sibling is the title. Structural, so no hashed class name is needed.
const spinnerRowTitle = (dot: Element): string | null =>
  dot.closest("span")?.nextElementSibling?.textContent?.trim() ?? null;

// The composer's primary send/stop button shares the local CSS-module class `_primary` with one
// button in a settings view, so class alone is not enough. The real one shares an ancestor with the
// message box (a contenteditable). Walk up until an ancestor holds one; null means it is not the
// composer button. Structural, so no hashed class is needed.
const inComposer = (node: Element): boolean => {
  for (let p = node.parentElement; p && p !== document.body; p = p.parentElement)
    if (p.querySelector("[contenteditable]")) return true;
  return false;
};

function watchSessionSpinners(ctx: ClientCtx) {
  const MARK = "data-omc-spinner";
  const SEND_MARK = "data-omc-send";
  // displayTitles of the sessions that are both running and on a Claude mount, this instant.
  const claudeRunningTitles = (): Set<string> => {
    const set = new Set<string>();
    const snap = ctx.sessions.list.getSnapshot();
    if (!snap) return set;
    for (const [id, s] of Object.entries(snap.byId))
      if (s.running && s.displayTitle && isClaudeSession(ctx, id)) set.add(s.displayTitle.trim());
    return set;
  };
  const scan = () => {
    const claude = claudeRunningTitles();
    // Every other ongoing matrix square — the job-list dot in the session header, and the same dot
    // dsh shows for subagents, plans and schedules — renders inside the open conversation, so it
    // belongs to whichever session is open. Tint those when that session is a Claude mount.
    const openIsClaude = activeClaudeSession(ctx) !== undefined;
    for (const dot of document.querySelectorAll<SVGElement>('svg[data-state="ongoing"]')) {
      const inRow = dot.closest('[role="treeitem"]'); // a sidebar session row vs a dot elsewhere
      let want: boolean;
      if (inRow) {
        const title = spinnerRowTitle(dot);
        want = title !== null && claude.has(title);
      } else {
        want = openIsClaude;
      }
      if (want) {
        dot.style.color = CLAUDE_ORANGE;
        dot.setAttribute(MARK, "1");
      } else if (dot.hasAttribute(MARK)) {
        dot.style.color = "";
        dot.removeAttribute(MARK);
      }
    }
    // The composer's send/stop button (one button, aria-label toggles). dsh fills it from
    // `--dsw-alias-button-info-*`; overriding those two vars on the button recolours both the base
    // and hover states in one place, and clearing them hands it back to dsh's blue on the next pass.
    for (const sendBtn of document.querySelectorAll<HTMLElement>('button[class*="_primary"]')) {
      const sendWant = openIsClaude && inComposer(sendBtn);
      if (sendWant) {
        sendBtn.style.setProperty("--dsw-alias-button-info-fill", CLAUDE_ORANGE);
        sendBtn.style.setProperty("--dsw-alias-button-info-hover", CLAUDE_SHIMMER);
        sendBtn.setAttribute(SEND_MARK, "1");
      } else if (sendBtn.hasAttribute(SEND_MARK)) {
        sendBtn.style.removeProperty("--dsw-alias-button-info-fill");
        sendBtn.style.removeProperty("--dsw-alias-button-info-hover");
        sendBtn.removeAttribute(SEND_MARK);
      }
    }
  };
  scan();
  // A dot going from idle to running is an attribute flip (`data-state`), not an added node, and a
  // new session row can appear at any time; a 1s poll catches both with one scan a second. A
  // body-subtree MutationObserver used to sit here too, but it re-ran the whole-document scan on
  // every mutation dsh made, so a streaming turn (hundreds of chunk appends a second) became
  // hundreds of full-page scans and janked mobile. The poll alone is enough for a sidebar dot's
  // colour. ponytail: if a newly-running row ever needs to tint faster than 1s, observe the sidebar
  // container only and coalesce with requestAnimationFrame, never document.body per mutation.
  setInterval(scan, 1000);
}

interface TurnRecord {
  at: number;
  costUsd: number;
  durationMs: number;
  apiMs: number;
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ttftMs?: number;
}
interface TurnsReply {
  turns: TurnRecord[];
  total: {
    costUsd: number;
    durationMs: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    count: number;
  };
}

/** dsh's own "N turns · N steps" row, the div the cost line is appended to. */
const isStatsRow = (el: HTMLElement): boolean =>
  el.isConnected && el.children.length > 1 && /\d+ turns · \d+ steps/.test(el.textContent ?? "");

/** Cost readout in dsh's footer stats row: only when the open session is a Claude mount. */
function CostLine({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  // What the poll compares against without listing `turns` as a dependency of its effect.
  const turnsRef = useRef<TurnRecord[]>([]);
  turnsRef.current = turns;
  const visibleRef = useRef(true);

  useEffect(() => {
    if (activeClaudeSession(ctx) !== sessionId) return;
    let alive = true;
    const fetchTurns = async () => {
      try {
        const r = await fetch(`${ROUTE}/turns?session=${encodeURIComponent(sessionId)}`);
        if (!r.ok) return;
        // SAFETY: the body is our own JSON route; the union type names both shapes the caller checks
        const body = (await r.json()) as TurnsReply | { error: string };
        if ("error" in body) return;
        // An empty answer is "no records to hand out right now", not "this session cost nothing":
        // the route reads an in-memory map that is empty for a moment after dsh restarts, and
        // zeroing the total took the cost off the row under the pointer. Only records replace records.
        const next = body.turns ?? [];
        if (alive && (next.length > 0 || turnsRef.current.length === 0)) setTurns(next);
      } catch {
        // network error: keep previous turns
      }
    };
    fetchTurns();
    const interval = setInterval(() => {
      if (visibleRef.current) fetchTurns();
    }, 10_000);
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current) fetchTurns();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ctx, sessionId]);

  // dsh's current session blinks: a child session takes the slot for a moment, and a model
  // directory mid-rebind answers no provider at all. A blank answer used to read as "not mine" and
  // took the cost off the row under the pointer, so only another session's id gives it up.
  const mineRef = useRef(false);
  if (activeClaudeSession(ctx) === sessionId) mineRef.current = true;
  else {
    const current = ctx.sessions.list.getSnapshot()?.current;
    if (current && current !== sessionId) mineRef.current = false;
  }
  const mine = mineRef.current;
  const total = turns.reduce((s, r) => s + r.costUsd, 0);
  const totalCacheRead = turns.reduce((s, r) => s + r.cacheRead, 0);
  const last = turns[turns.length - 1];
  const text = mine && total > 0 && last ? costText(total, last.costUsd, totalCacheRead) : "";
  const title =
    mine && total > 0 && last
      ? `Claude cost: ${fmtCost(total)} this session, ${fmtCost(last.costUsd)} last turn (${turns.length} turn${turns.length === 1 ? "" : "s"})${fmtTtft(last.ttftMs)}`
      : "";
  // dsh's stats row is one div of groups; a slot entry can only be its sibling and lands on its
  // own line. Append into that div instead, the way the context meter hooks its popover.
  // ponytail: structural lookup of the row by its "N turns · N steps" text; swap for a slot the
  // day dsh's stats line grows one.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [hooked, setHooked] = useState(false);
  // What the injected nodes say, held in a ref: a new cost arriving mid-hover used to tear the
  // whole hook down and build it again, which is the blink the row was reported to have. The
  // nodes now stay where they are and only their text is rewritten.
  const textRef = useRef(text);
  const titleRef = useRef(title);
  textRef.current = text;
  titleRef.current = title;
  const syncRef = useRef<() => void>(() => {});
  useEffect(() => syncRef.current(), [text, title]);
  useEffect(() => {
    let inline: HTMLSpanElement | undefined;
    let body: HTMLSpanElement | undefined;
    let rowLead = "";
    let lastRow: HTMLElement | undefined;
    // The row appears with the first settled step and is one of dsh's own divs anywhere in the
    // document; look for it until found (one conversation is on screen at a time).
    // `inline?.isConnected`, not `inline`: dsh re-renders this row on every step and React drops
    // the span we appended. Holding the detached node as proof it is hooked left the cost gone for
    // good — the row has to be hooked again each time it loses ours.
    const MARK = "data-dsh-oh-my-claude-cost";
    // `localStorage.setItem("omc-debug", "1")` prints every hook, drop and repaint to the console;
    // the row lives in someone else's DOM, so this is the only way to watch what removed it.
    const debug = (...args: unknown[]) => {
      try {
        if (localStorage.getItem("omc-debug") === "1")
          console.debug("[oh-my-claude cost]", ...args);
      } catch {
        // a browser that refuses localStorage simply has no debug output
      }
    };

    const tryHook = () => {
      if (!anchorRef.current?.isConnected) return;
      if (inline?.isConnected) {
        // Already in the row: rewrite what it says instead of building it again.
        inline.title = titleRef.current;
        if (body) body.textContent = ` ${textRef.current}`;
        return;
      }
      if (inline) debug("row dropped our span; hooking again");
      // The row dsh re-rendered is usually the same element with new children, so the one it was
      // last found in is tried first: the fallback walks every div in the document, and that walk
      // ran on each of the many steps in a turn.
      const statsRow =
        lastRow && isStatsRow(lastRow)
          ? lastRow
          : [...document.querySelectorAll<HTMLDivElement>("div")].filter(isStatsRow).at(-1);
      lastRow = statsRow;
      if (!statsRow) {
        debug("no stats row on screen");
        return;
      }
      inline = document.createElement("span");
      inline.title = titleRef.current;
      inline.style.whiteSpace = "nowrap";
      const sep = document.createElement("span");
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "|";
      body = document.createElement("span");
      body.textContent = ` ${textRef.current}`;
      inline.append(" ", sep, body);
      // The row's first group ("52 turns · 77 steps" in any locale) identifies its bubble.
      rowLead = (statsRow.firstElementChild?.textContent ?? "").replace(/\s+/g, "");
      statsRow.append(inline);
      debug("hooked the stats row", { rowLead, text: textRef.current });
      setHooked(true);
    };

    // The row truncates and dsh shows its full line in a hover bubble built from its own text;
    // append the cost to that bubble. Every open bubble is checked on each pass, not only the ones
    // a mutation just added: dsh rewrites an open bubble's text in place while the pointer is on
    // it, which drops our span without ever adding an element for an observer to notice.
    const hookTips = () => {
      if (!rowLead) return;
      for (const tip of document.querySelectorAll<HTMLElement>('[role="tooltip"]')) {
        if (!(tip.textContent ?? "").replace(/\s+/g, "").startsWith(rowLead)) continue;
        // The mark rides the appended span, so a re-render that drops it asks for it again.
        const part = tip.querySelector<HTMLElement>(`:scope > [${MARK}]`);
        if (part) {
          part.textContent = ` | ${textRef.current}`;
          continue;
        }
        const fresh = document.createElement("span");
        fresh.setAttribute(MARK, "1");
        fresh.textContent = ` | ${textRef.current}`;
        tip.append(fresh);
        debug("hooked a bubble");
      }
    };

    const drop = () => {
      inline?.remove();
      inline = undefined;
      body = undefined;
      lastRow = undefined; // a fresh hook looks the row up again rather than trusting an old pane
      for (const part of document.querySelectorAll(`[${MARK}]`)) part.remove();
      setHooked(false);
    };

    // One pass per frame however many mutations dsh made: the observer watches the whole body, and
    // a streaming turn changes it many times a frame.
    let queued = false;
    const sync = () => {
      queued = false;
      if (!textRef.current) {
        if (inline) debug("no cost to show; dropping the row");
        drop();
        return;
      }
      tryHook();
      hookTips();
    };
    syncRef.current = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(sync);
      }
    };
    const observer = new MutationObserver(syncRef.current);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    sync();
    // Fallback for a change no mutation reports at all (a row moved by CSS, a bubble reused).
    const timer = setInterval(sync, 1000);
    return () => {
      clearInterval(timer);
      observer.disconnect();
      syncRef.current = () => {};
      drop();
    };
  }, []);
  if (!text) return <span ref={anchorRef} hidden />;
  return (
    <span ref={anchorRef} style={hooked ? { display: "none" } : undefined}>
      <span
        title={title}
        style={{ display: "inline", fontSize: 14, color: T.faint, whiteSpace: "nowrap" }}
      >
        <span aria-hidden="true">|</span> {text}
      </span>
    </span>
  );
}

/** One `/btw` side question as the client bubble draws it (mirrors the adapter's `AsideEntry`). */
interface AsideItem {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  pending: boolean;
  at: number;
}

/**
 * The `/btw` aside bubble: a Claude-orange card docked above the composer, in the same slot and at
 * the same width as dsh's todo and goal panels, that shows each side question and the answer the
 * CLI returns off the transcript. Pending cards read as thinking; each is dismissed on its own. The
 * server keeps only the last few per session, so the list stays short.
 */
function AsideBubble({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const [items, setItems] = useState<AsideItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const visibleRef = useRef(true);

  useEffect(() => {
    if (activeClaudeSession(ctx) !== sessionId) return;
    let alive = true;
    const fetchItems = async () => {
      try {
        const r = await fetch(`${ROUTE}/side-questions?session=${encodeURIComponent(sessionId)}`);
        if (!r.ok) return;
        // SAFETY: our own JSON route; the union names both shapes the caller checks.
        const body = (await r.json()) as { items: AsideItem[] } | { error: string };
        if ("error" in body) return;
        if (alive) setItems(body.items ?? []);
      } catch {
        // network error: keep the last items on screen
      }
    };
    fetchItems();
    // ponytail: a 3s poll, since a server command cannot push to the client; swap for an event
    // channel the day dsh gives a plugin one.
    const interval = setInterval(() => {
      if (visibleRef.current) fetchItems();
    }, 3000);
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current) fetchItems();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ctx, sessionId]);

  const shown = items.filter((it) => !dismissed.has(it.id));
  if (activeClaudeSession(ctx) !== sessionId || shown.length === 0) return null;

  const dismissAside = (id: string) => {
    // Hide now, but tell the server to drop it so the next poll (or a remount) does not bring it back.
    setDismissed((prev) => new Set(prev).add(id));
    void fetch(`${ROUTE}/side-questions/dismiss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sessionId, id }),
    }).catch(() => {});
  };

  const copy = (it: AsideItem) => {
    const text = it.answer ?? it.error ?? it.question;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(it.id);
      setTimeout(() => setCopied((cur) => (cur === it.id ? null : cur)), 1200);
    });
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const iconBtn = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0 2px",
    lineHeight: 1,
    flex: "0 0 auto",
  } as const;

  return (
    <div
      style={{
        // Match dsh's own dock card (its QueueDock `_7yHdaG_dock`) to the pixel, so the aside sits at
        // the same width and the same vertical spacing as the queue/todo/goal cards instead of
        // spanning the pane: composer-card width less one dock inset each side, centred, and the same
        // negative bottom margin every dsh dock card uses to hug the stack gap below it.
        boxSizing: "border-box",
        width:
          "calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
        maxWidth:
          "calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
        margin: "0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px)",
        padding: "0 var(--dsh-composer-dock-inset)",
        flex: "none",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {shown.map((it) => {
        const open = !collapsed.has(it.id);
        return (
          <div
            key={it.id}
            style={{
              // Neutral theme tokens (not a solid-orange bubble) so it reads as a native dock card;
              // the orange lives only on the ✻ mark and label. Fallbacks cover a theme without them.
              boxSizing: "border-box",
              background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
              border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
              // Square bottom, rounded top: it is always the first card above the composer, so it
              // docks onto the message box like a tab (dsh's own QueueDock uses this same radius).
              borderRadius: "12px 12px 0 0",
              overflow: "hidden",
            }}
          >
            {/* Header is the collapse toggle; the copy/dismiss controls sit beside it and stop the
                click so they do not also fold the card. A div (not a button) avoids nesting buttons. */}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => toggle(it.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(it.id);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                cursor: "pointer",
              }}
            >
              <span
                style={{ color: CLAUDE_ORANGE, fontSize: 13, flex: "0 0 auto" }}
                aria-hidden="true"
              >
                {CLAUDE_MARK}
              </span>
              <span
                style={{
                  color: CLAUDE_ORANGE,
                  fontWeight: 600,
                  fontSize: 12,
                  flex: "0 0 auto",
                }}
              >
                Side question
              </span>
              {/* Question rides the bar, truncated, so a collapsed card still says what it asked. */}
              <span
                style={{
                  color: T.muted,
                  fontSize: 12,
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {it.question}
              </span>
              <span style={{ color: T.faint, fontSize: 11, flex: "0 0 auto" }}>{ago(it.at)}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copy(it);
                }}
                aria-label="Copy side question"
                style={{
                  ...iconBtn,
                  color: copied === it.id ? CLAUDE_ORANGE : T.muted,
                  fontSize: 11,
                }}
              >
                {copied === it.id ? "Copied" : "Copy"}
              </button>
              {/* Collapse chevron, sized to match dsh's own todo/queue chevron (14px, tertiary).
                  Up when collapsed, down when open — same convention as the queue dock. */}
              <span
                style={{
                  width: 14,
                  height: 14,
                  color: "var(--dsw-alias-label-tertiary, " + T.faint + ")",
                  flex: "0 0 auto",
                  display: "grid",
                  placeItems: "center",
                }}
                aria-hidden="true"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <polyline
                    points={open ? "3.5,5.5 7,9 10.5,5.5" : "3.5,8.5 7,5 10.5,8.5"}
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissAside(it.id);
                }}
                aria-label="Dismiss side question"
                style={{ ...iconBtn, color: T.muted, fontSize: 12 }}
              >
                ✕
              </button>
            </div>
            {open ? (
              <div style={{ padding: "0 10px 8px 24px" }}>
                {it.pending ? (
                  <div style={{ color: CLAUDE_ORANGE, fontSize: 12, fontStyle: "italic" }}>
                    Claude is thinking…
                  </div>
                ) : it.error ? (
                  <div style={{ color: T.err, fontSize: 12 }}>{it.error}</div>
                ) : (
                  <div style={{ color: T.text, fontSize: 13, whiteSpace: "pre-wrap" }}>
                    {it.answer}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Cached tokens for the readout: `999`, `12.3K`, `2.1M`, and nothing at all for none. */
export const formatCacheRead = (tokens: number): string => {
  if (tokens <= 0) return "";
  if (tokens < 1000) return String(Math.round(tokens));
  const scaled = tokens < 1_000_000 ? tokens / 1000 : tokens / 1_000_000;
  const unit = tokens < 1_000_000 ? "K" : "M";
  return `${scaled.toFixed(1).replace(/\.0$/, "")}${unit}`;
};

/** `, 840ms to first token` for the tooltip; nothing when the turn was not measured. */
const fmtTtft = (ms?: number): string => {
  if (ms === undefined || ms <= 0) return "";
  const shown = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  return `, ${shown} to first token`;
};

/** `✻ $18.21 · $0.42 last`: the session total, newest turn, and cached tokens. */
const costText = (total: number, last: number, cacheRead: number = 0) => {
  let text = `${CLAUDE_MARK} ${fmtCost(total)} · ${fmtCost(last)} last`;
  const cached = formatCacheRead(cacheRead);
  if (cached) text += ` · ${cached} cached`;
  return text;
};

interface IdleReply {
  deadline: number | null;
  timeoutMs: number;
}

/** Small chip that warns when the idle watchdog is about to kill the process. */
function IdleChip({ sessionId }: { sessionId: string }) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const visibleRef = useRef(true);

  useEffect(() => {
    let alive = true;
    const fetchIdle = async () => {
      try {
        const r = await fetch(`${ROUTE}/idle?session=${encodeURIComponent(sessionId)}`);
        if (!r.ok) return;
        // SAFETY: the body is our own JSON route; the union type names both shapes the caller checks
        const body = (await r.json()) as IdleReply | { error: string };
        if ("error" in body) return;
        if (alive) setDeadline(body.deadline ?? null);
      } catch {
        // network error: keep previous deadline
      }
    };
    fetchIdle();
    const interval = setInterval(() => {
      if (visibleRef.current) fetchIdle();
    }, 5_000);
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current) fetchIdle();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId]);

  const remainingMs = deadline ? deadline - Date.now() : 0;
  if (!deadline || remainingMs > 60_000) return null;
  const seconds = Math.max(0, Math.round(remainingMs / 1000));
  const extend = async () => {
    try {
      await fetch(`${ROUTE}/idle/extend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId }),
      });
    } catch {
      // extend failed silently; next poll will reflect state
    }
  };
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, color: T.warn, fontFamily: T.mono }}>
        stopping in {seconds}s
      </span>
      <button type="button" style={btn} onClick={extend}>
        Extend
      </button>
    </span>
  );
}

export function apply(ctx: ClientCtx) {
  followDeepLink(ctx);
  watchContextMeter(ctx);
  watchTurnStatus(ctx);
  watchSessionNotices(ctx);
  watchSessionSpinners(ctx);

  function Section() {
    const [boxes, setBoxes] = useState<BoxData[]>([]);
    const [openBoxes, setOpenBoxes] = useState(true);
    const [openSessions, setOpenSessions] = useState(false);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ color: CLAUDE_ORANGE, fontSize: 18, lineHeight: 1 }}>{CLAUDE_MARK}</span>
          <h2 id="dsh-oh-my-claude-heading" style={{ margin: 0, fontSize: 18 }}>
            Oh My Claude
          </h2>
        </div>
        {error && <p style={{ color: T.err, fontSize: 13 }}>{error}</p>}
        {boxes !== null && (
          <Card
            id="dsh-oh-my-claude-sessions-card"
            title="Sessions"
            open={openSessions}
            onToggle={() => setOpenSessions((v) => !v)}
          >
            <Sessions ctx={ctx} boxes={boxes} />
          </Card>
        )}
        {boxes !== null && (
          <Boxes
            boxes={boxes}
            setBoxes={setBoxes}
            open={openBoxes}
            onToggle={() => setOpenBoxes((v) => !v)}
          />
        )}
      </div>
    );
  }

  ctx.slots.inject("settings.section", () => {
    ctx.slots.register(
      {
        name: "settings.section",
        id: "claude-code-sessions",
        order: 19,
        label: "Oh My Claude",
        inject: () => ({}),
      },
      Section,
    );
    return null;
  });

  // Cost readout in dsh's footer stats row.
  ctx.slots.inject("conversation.composer.dock", () => {
    ctx.slots.register(
      { name: "conversation.composer.dock", id: "claude-cost", order: 10 },
      (props) => (props.sessionId ? <CostLine sessionId={props.sessionId} ctx={ctx} /> : null),
    );
    return null;
  });

  // `/btw` answers dock above the composer beside dsh's todo and goal panels, at their width.
  ctx.slots.inject("conversation.input.dock", () => {
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-aside", order: 45 },
      (props) => (props.sessionId ? <AsideBubble sessionId={props.sessionId} ctx={ctx} /> : null),
    );
    return null;
  });

  // Header chips in the session header.
  ctx.slots.inject("conversation.session.header.actions", () => {
    ctx.slots.register(
      { name: "conversation.session.header.actions", id: "claude-idle-warn", order: 31 },
      (props) => (props.sessionId ? <IdleChip sessionId={props.sessionId} /> : null),
    );
    return null;
  });

  // One Oh My Claude control in the composer's left group replaces the five separate buttons.
  // The slot must be declared through `inject` before anything registers into it.
  ctx.slots.inject("conversation.input.left", () => {
    // Lookalike shield replaces dsh's trigger inside Claude sessions only.
    ctx.slots.register(
      { name: "conversation.input.left", id: "claude-access", order: 40 },
      (props) => (props.sessionId ? <AccessShield sessionId={props.sessionId} ctx={ctx} /> : null),
    );
    ctx.slots.register(
      { name: "conversation.input.left", id: "oh-my-claude", order: 50 },
      // Session-scoped slots receive `sessionId` (dsh-client-ui-jobs reads it the same way).
      (props) =>
        props.sessionId ? <OhMyClaudeControl sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    return null;
  });
}
