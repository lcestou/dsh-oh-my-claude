// Browser half: Settings → "Oh My Claude". A runtime line (which claude, which account, which
// box), one session list across this box and every saved box (filter by box, workspace, origin;
// open here or jump to the box), and two collapsed cards: the saved boxes and Claude Code's own
// settings.json. Built into lib/client.js by `bun run build`.
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
  activeClaudeProvider,
  type ClientCtx,
  openHere,
} from "./shared.js";
import { OhMyClaudeControl } from "./panel.js";
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
      <p id="dsh-oh-my-claude-runtime" style={{ color: T.err, fontSize: 13, margin: "0 0 4px" }}>
        {error}
      </p>
    );
  if (!st)
    return (
      <p id="dsh-oh-my-claude-runtime" style={{ ...meta, margin: "0 0 4px" }}>
        Checking claude…
      </p>
    );
  const who = st.loggedIn
    ? `logged in${st.email ? ` as ${maskEmail(st.email)}` : ""}${st.authMethod ? ` (${st.authMethod})` : ""}`
    : "not logged in";
  return (
    <div
      id="dsh-oh-my-claude-runtime"
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
 * Rows in box order, newest first within each box, each box capped to `shown[key]` (default PAGE).
 * `hidden[key]` is how many more that box has past the cap; `matched[key]` its filtered total, for
 * the "Load all" label. Pure so the paging math is checked without a DOM.
 */
export function pageSessions(
  groups: GroupInfo[],
  filters: { box: string; cwd: string; origin: string; shown: Record<string, number> },
) {
  const { box, cwd, origin, shown } = filters;
  const list: Array<{ g: GroupInfo; s: SessionData }> = [];
  const hidden: Record<string, number> = {};
  const matched: Record<string, number> = {};
  for (const g of groups) {
    if (box !== "all" && g.key !== box) continue;
    const gs = g.sessions
      .filter(
        (s) => (cwd === "all" || s.cwd === cwd) && (origin === "all" || originOf(s) === origin),
      )
      .toSorted((a, b) => b.modifiedAt - a.modifiedAt);
    matched[g.key] = gs.length;
    const cap = shown[g.key] ?? PAGE;
    if (gs.length > cap) hidden[g.key] = gs.length - cap;
    for (const s of gs.slice(0, cap)) list.push({ g, s });
  }
  return { list, hidden, matched };
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
  let lastGroup: { key: string } | null = null;
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
        {rows.map((r, i) => {
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
          const lastOfGroup = i === rows.length - 1 || rows[i + 1]?.g.key !== r.g.key;
          const more = paged.hidden[r.g.key] ?? 0;
          const grown = (shown[r.g.key] ?? PAGE) > PAGE;
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
            </div>,
            lastOfGroup && more > 0 ? (
              <div
                key={`more-${r.g.key}`}
                data-testid="dsh-oh-my-claude-load-more"
                style={{ display: "flex", gap: 8, padding: "6px 0 2px" }}
              >
                <button
                  type="button"
                  style={btn}
                  onClick={() =>
                    setShown((m) => ({ ...m, [r.g.key]: (m[r.g.key] ?? PAGE) + PAGE }))
                  }
                >
                  Load {Math.min(PAGE, more)} more
                </button>
                {grown && (
                  <button
                    type="button"
                    style={btn}
                    onClick={() =>
                      setShown((m) => ({ ...m, [r.g.key]: paged.matched[r.g.key] ?? PAGE }))
                    }
                  >
                    Load all {paged.matched[r.g.key] ?? ""}
                  </button>
                )}
              </div>
            ) : null,
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
  box?: BoxData;
}

/** `~/.claude/settings.json`: read-only until Edit, then live JSON check, Save, Cancel. */
function SettingsEditor({ open, onToggle, box }: SettingsEditorProps) {
  const [file, setFile] = useState<SettingsFile | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const settingsUrl = box
    ? `${ROUTE}/boxes/settings?url=${encodeURIComponent(box.url)}`
    : `${ROUTE}/settings`;

  const load = () => {
    setBusy(true);
    setError("");
    fetch(settingsUrl)
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
  useEffect(load, [settingsUrl]);

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
    fetch(settingsUrl, {
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
  const [openSettingsUrl, setOpenSettingsUrl] = useState<string | null>(null);

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
      id="dsh-oh-my-claude-boxes"
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
          <div key={b.url} data-testid="dsh-oh-my-claude-box-row" style={row}>
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
            <button
              type="button"
              style={btn}
              disabled={busy || !ok}
              onClick={() => setOpenSettingsUrl(openSettingsUrl === b.url ? null : b.url)}
            >
              Edit settings
            </button>
            <button type="button" style={btn} disabled={busy} onClick={() => remove(b.url)}>
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
          borderTop: boxes.length ? `1px solid ${T.border}` : "none",
          paddingTop: boxes.length ? 12 : 4,
          flexWrap: "wrap",
        }}
      >
        <input
          style={{ ...inputStyle, flex: "0 1 140px" }}
          placeholder="Name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
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
type UsageReply =
  | { ok: true; fetchedAt: number; windows: UsageWindow[]; host?: string; email?: string | null }
  | { ok: false; error: string; windows?: undefined; host?: string; email?: string | null };
/** "m*****@gmail.com": first letter, stars, domain; the panel is shared on screen. */
const maskEmail = (email: string): string => {
  const at = email.indexOf("@");
  if (at < 1) return email;
  return `${email[0]}${"*".repeat(Math.max(3, at - 1))}${email.slice(at)}`;
};
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
}

/**
 * Put the plan usage inside dsh's context-meter popover, above the "N% of context used" line,
 * and one compact line into the ring's hover tooltip.
 * The meter (dsh-client-ui-conversation ContextMeter) has no slot, so this watches the DOM for
 * its dialog: a `[role=dialog]` whose parent holds a `button[aria-haspopup=dialog]` with the ring.
 * ponytail: DOM hook on a structural selector; swap for a slot the day the meter grows one.
 */
function watchContextMeter(ctx: ClientCtx) {
  const MARK = "data-dsh-oh-my-claude-usage";
  const attach = (panel: HTMLElement) => {
    if (panel.hasAttribute(MARK)) return;
    // Only sessions on a Claude mount: a local-model session's meter stays dsh's own.
    if (!activeClaudeSession(ctx)) return;
    panel.setAttribute(MARK, "1");
    const block = document.createElement("div");
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
    if (tip.hasAttribute(MARK)) return;
    if (!activeClaudeSession(ctx)) return;
    tip.setAttribute(MARK, "1");
    const line = document.createElement("div");
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
  };
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) if (n instanceof HTMLElement) scan(n.parentElement ?? n);
  }).observe(document.body, { childList: true, subtree: true });
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
  styleEl.textContent = `body[data-omc-claude] [role="status"][aria-live="polite"],[data-dsh-oh-my-claude-turn]{background-image:linear-gradient(90deg,${CLAUDE_ORANGE} 0%,${CLAUDE_ORANGE} 40%,${CLAUDE_SHIMMER} 50%,${CLAUDE_ORANGE} 60%,${CLAUDE_ORANGE} 100%)}[data-dsh-oh-my-claude-turn]>span[aria-hidden]{display:inline-block;width:1.3em;text-align:center;flex:none}`;
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
  tick();
  const interval = setInterval(tick, 120);

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

  // Clear when the element is removed from the DOM.
  const remObs = new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.removedNodes)
        if (n === el) {
          clearInterval(interval);
          obs.disconnect();
          remObs.disconnect();
          return;
        }
  });
  remObs.observe(document.body, { childList: true, subtree: true });
};

/**
 * Watch dsh's turn-status elements and restyle ones driven by claude-code sessions.
 * ponytail: DOM hook on a structural selector; swap for a slot the day the turn status grows one.
 */
function watchTurnStatus(ctx: ClientCtx) {
  ensureTurnStatusStyle(); // a hot reload drops the old module's style tag but keeps marked elements
  // Keep a body flag in step with the open session so the first-paint colour rule applies before
  // the observer runs (the flash of dsh's blue the owner saw on first load).
  const markBody = () => {
    if (activeClaudeSession(ctx)) document.body.setAttribute("data-omc-claude", "1");
    else document.body.removeAttribute("data-omc-claude");
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
  const scan = (root: ParentNode) => {
    for (const el of root.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"]'))
      attach(el);
  };
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) if (n instanceof HTMLElement) scan(n.parentElement ?? n);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
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

/** What `GET /permission-mode` reports. */
interface PermissionModeState {
  mode: string;
  override: string | null;
  modes: string[];
  live?: boolean;
  error?: string;
}

/**
 * Permission mode chip in the session header of Claude sessions: a select over the CLI's modes,
 * with "config" meaning no override. A change is stored per session and pushed to a live process.
 */
function PermissionChip({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const [state, setState] = useState<PermissionModeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isClaude = activeClaudeSession(ctx) === sessionId;

  useEffect(() => {
    if (!isClaude) return;
    let alive = true;
    fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<PermissionModeState>(r))
      .then((b) => alive && setState(b))
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [sessionId, isClaude]);

  if (!isClaude || !state) return null;
  const change = async (value: string) => {
    setBusy(true);
    setError("");
    try {
      const reply = await readJson<PermissionModeState>(
        await fetch(`${ROUTE}/permission-mode`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, mode: value || null }),
        }),
      );
      setState({ ...state, ...reply });
      if (reply.error) setError(reply.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <select
        aria-label="Claude permission mode"
        value={state.override ?? ""}
        disabled={busy}
        onChange={(e) => change(e.currentTarget.value)}
        title={
          state.override
            ? `Permission mode ${state.mode}, set for this session`
            : `Permission mode ${state.mode}, from the plugin config`
        }
        style={{
          ...select,
          fontSize: 12,
          padding: "3px 8px",
          color: state.override ? CLAUDE_ORANGE : T.text,
        }}
      >
        <option value="">config · {state.mode}</option>
        {state.modes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {error && <span style={{ color: T.err, fontSize: 11 }}>{error}</span>}
    </span>
  );
}

/** Cost readout in dsh's footer stats row: only when the open session is a Claude mount. */
function CostLine({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const [turns, setTurns] = useState<TurnRecord[]>([]);
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
        if (alive) setTurns(body.turns ?? []);
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

  const mine = activeClaudeSession(ctx) === sessionId;
  const total = turns.reduce((s, r) => s + r.costUsd, 0);
  const last = turns[turns.length - 1];
  const text = mine && total > 0 && last ? costText(total, last.costUsd) : "";
  const title =
    mine && total > 0 && last
      ? `Claude cost: ${fmtCost(total)} this session, ${fmtCost(last.costUsd)} last turn (${turns.length} turn${turns.length === 1 ? "" : "s"})`
      : "";
  // dsh's stats row is one div of groups; a slot entry can only be its sibling and lands on its
  // own line. Append into that div instead, the way the context meter hooks its popover.
  // ponytail: structural lookup of the row by its "N turns · N steps" text; swap for a slot the
  // day dsh's stats line grows one.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [hooked, setHooked] = useState(false);
  useEffect(() => {
    if (!text) {
      setHooked(false);
      return;
    }
    let inline: HTMLSpanElement | undefined;
    // The row appears with the first settled step and is one of dsh's own divs anywhere in the
    // document; look for it until found (one conversation is on screen at a time).
    const tryHook = () => {
      if (inline || !anchorRef.current?.isConnected) return;
      const statsRow = [...document.querySelectorAll<HTMLDivElement>("div")]
        .filter(
          (el) => el.children.length > 1 && /\d+ turns · \d+ steps/.test(el.textContent ?? ""),
        )
        .at(-1);
      if (!statsRow) return;
      inline = document.createElement("span");
      inline.title = title;
      inline.style.whiteSpace = "nowrap";
      const sep = document.createElement("span");
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "|";
      const body = document.createElement("span");
      body.textContent = ` ${text}`;
      inline.append(" ", sep, body);
      statsRow.append(inline);
      setHooked(true);
    };
    tryHook();
    const timer = setInterval(tryHook, 1000);
    return () => {
      clearInterval(timer);
      inline?.remove();
      setHooked(false);
    };
  }, [text, title]);
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

/** `✻ $18.21 · $0.42 last`: the session total and the newest turn. */
const costText = (total: number, last: number) =>
  `${CLAUDE_MARK} ${fmtCost(total)} · ${fmtCost(last)} last`;

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
        <h2 id="dsh-oh-my-claude-heading" style={{ marginTop: 0 }}>
          Oh My Claude
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

  // Header chips in the session header.
  ctx.slots.inject("conversation.session.header.actions", () => {
    ctx.slots.register(
      { name: "conversation.session.header.actions", id: "claude-permission-mode", order: 32 },
      (props) =>
        props.sessionId ? <PermissionChip sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    ctx.slots.register(
      { name: "conversation.session.header.actions", id: "claude-idle-warn", order: 31 },
      (props) => (props.sessionId ? <IdleChip sessionId={props.sessionId} /> : null),
    );
    return null;
  });

  // One Oh My Claude control in the composer's left group replaces the five separate buttons.
  // The slot must be declared through `inject` before anything registers into it.
  ctx.slots.inject("conversation.input.left", () => {
    ctx.slots.register(
      { name: "conversation.input.left", id: "oh-my-claude", order: 50 },
      // Session-scoped slots receive `sessionId` (dsh-client-ui-jobs reads it the same way).
      (props) =>
        props.sessionId ? <OhMyClaudeControl sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    return null;
  });
}
