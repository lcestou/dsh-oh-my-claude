// Browser half: Settings → "Oh My Claude". A branded header, then two cards: Sessions (one
// transcript list across this box and every saved box — filter by box, workspace, origin; open
// here or jump to the box) and Boxes (this box as the first row, plus the ssh and linked-dsh
// machines you add, each probed for claude version and login). Built into lib/client.js by
// `bun run build`.
import type { CSSProperties, FC, ReactNode } from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IconAgentPresetOutline16,
  IconApiOutline14,
  IconBrowseOutline16,
  IconChecklistOutline14,
  IconChevronDownOutline14,
  IconCodeOutline16,
  IconEditOutline16,
  IconListPenOutline16,
  IconSearchOutline16,
  IconSkillOutline16,
  IconSparkle16,
  Menu,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from "@deepseek-ai/dsh-client-ui-primitives";
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
  h3,
  row,
  pill,
  select,
  inputStyle,
  ago,
  btnPrimary,
  DOCK_ATTR,
  ensurePanelStyle,
  ACCENT,
  SHIMMER,
  CLAUDE_MARK,
  isRingRoot,
  SessionData,
  isOwnedActive,
  matchesQuery,
  activeClaudeSession,
  isClaudeSession,
  activeClaudeProvider,
  claudeProviderOf,
  type ClientCtx,
  openHere,
  maskEmail,
  numberOr,
  whenContextGone,
  guard,
  keywordMatches,
  controlStatesCss,
  resumeCommand,
  saveBlob,
} from "./shared.js";
import { themeOf, hexToRgb, type ThemeGroup } from "./theme.js";
import { PluginUpdateBadge } from "./update-pill.js";
import { ReportBlock } from "./report.js";
import { Spark, sparkNode } from "./spark.js";
import { AccessShield, OhMyClaudeControl } from "./panel.js";
import { ConfirmButton } from "./tune.js";
import { AddWorkspaceFlow, canBrowseDirs, OPEN_EVENT } from "./picker.js";
import { takeDraft, subscribeDraft, noteDraft, draftPending } from "./draft.js";
import {
  markTitle,
  newlyWaiting,
  noticesOn,
  recapNext,
  recapOnIn,
  recapAwayIn,
  RECAP_AWAY_MS,
  RECAP_AWAY_CHOICES,
  RECAP_QUESTION,
  type NoticeSnapshot,
} from "./notices.js";
import { SETTINGS_SCOPES, SCOPE_LABELS, overrideNote } from "./settings.js";
import type { SettingsScope, SettingsScopeInfo } from "./settings.js";
export { type SessionData, isOwnedActive, fmtCost, fmtDuration, cacheShare };

/** Deep link another box's panel sends us to: `#claude-session=<id>&cwd=<path>`. */
const HASH_KEY = "claude-session";
/** Format byte sizes for session rows. */
/** A row's identity in the list: the same transcript id can sit on two boxes. */
const rowKey = (r: { g: { key: string }; s: { id: string } }): string => `${r.g.key}-${r.s.id}`;

/** A file name a person can read back later; the id keeps it unique. */
const slugFile = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "claude";

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

/** dsh's own disclosure chevron (ui-settings-plugins): down when closed, turned when open. */
function Chevron({ open }: { open: boolean }) {
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
function Card({ id, title, summary, actions, open, onToggle, children }: CardProps) {
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
        aria-label={`${open ? "Hide" : "Show"} ${title}`}
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
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 10 }}>
              {actions}
            </div>
          )}
          <div style={{ marginTop: actions ? 4 : 10 }}>{children}</div>
        </div>
      )}
    </section>
  );
}

/** Where a transcript lives: terminal only, a live dsh session, or an archived one. */
function Origin({ s }: { s: { dsh?: { archived?: boolean; id?: string }; imported?: boolean } }) {
  if (s.imported) return <span style={pill(T.brand)}>imported</span>;
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
  plugin?: string;
  /** A newer plugin release on npm, and the command that installs it. */
  latest?: string;
  update?: string;
  /** Claude processes still running on the box on a login they loaded at start. */
  running?: number;
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

/** One SSH box's transcripts, from `/boxes/ssh-sessions` (listed over ssh, no HTTP endpoint). */
interface SshSessionData {
  name: string;
  host?: string;
  provider?: string;
  ok?: boolean;
  error?: string;
  sessions?: SessionData[];
}

interface SessionsProps {
  ctx: ClientCtx;
  boxes: BoxData[];
  /** Dismiss the settings panel, so a restored session lands in the foreground as if clicked. */
  close?: () => void;
}

export interface GroupInfo {
  key: string;
  name: string;
  host?: string;
  ok: boolean;
  error?: string;
  sessions: SessionData[];
  box?: BoxData;
  /** An SSH box: transcripts live on its host, reachable only over ssh — no HTTP box to jump to. */
  sshBox?: boolean;
  /** The box's provider id (`claude-code-<slug>`), so a resumed transcript binds back to it. */
  provider?: string;
}

/** Rows shown per box before "Load more"; each press adds another PAGE. */
const PAGE = 10;

/** A filter control that shares its row evenly: the shared `select` caps at 260 px and left the
 *  first row 50 px short of the card's edge while the search row below it filled it. */
const filterSelect: CSSProperties = { ...select, flex: "1 1 160px", maxWidth: "none" };

/**
 * The rows to show, newest first, capped to `shown[key]` (default PAGE). With a box selected the
 * key is that box; with "all" every box is merged into one recency-sorted stream keyed `"all"`, so
 * the list reads as one timeline rather than per-box sections. `hidden[key]` is how many more sit
 * past the cap and `matched[key]` the filtered total, for the "Load more"/"Load all" labels. Pure,
 * so the paging math is checked without a DOM.
 */
export function pageSessions(
  groups: GroupInfo[],
  filters: {
    box: string;
    cwd: string;
    origin: string;
    /** Typed search; see `matchesQuery`. Absent or empty keeps every row. */
    query?: string;
    shown: Record<string, number>;
  },
) {
  const { box, cwd, origin, query = "", shown } = filters;
  const hidden: Record<string, number> = {};
  const matched: Record<string, number> = {};
  const keep = (s: SessionData) =>
    (cwd === "all" || s.cwd === cwd) &&
    (origin === "all" || originOf(s) === origin) &&
    matchesQuery(s, query);
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
function Sessions({ ctx, boxes, close }: SessionsProps) {
  const [local, setLocal] = useState<{ host?: string; sessions?: SessionData[] } | null>(null);
  const [remote, setRemote] = useState<RemoteSessionData[]>([]);
  const [ssh, setSsh] = useState<SshSessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [error, setError] = useState("");
  const [box, setBox] = useState("all");
  const [cwd, setCwd] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  // How many rows each box shows; every box starts at PAGE and grows by "Load more".
  const [shown, setShown] = useState<Record<string, number>>({});
  // Rows ticked for download, by their row key: the same id can sit on two boxes.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState("");
  const [menuFor, setMenuFor] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    setError("");
    fetch(`${ROUTE}/sessions?all=1`)
      .then((r) => readJson<{ host?: string; sessions?: SessionData[] } | null>(r))
      .then((body) => setLocal(body ?? null))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // SSH boxes list over ssh (own registry, no HTTP url); fetch regardless of the HTTP boxes above.
    fetch(`${ROUTE}/boxes/ssh-sessions`)
      .then((r) => readJson<{ boxes?: SshSessionData[] } | null>(r))
      .then((body) => setSsh(body?.boxes ?? []))
      .catch(() => setSsh([]));
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
    for (const s of ssh)
      out.push({
        key: `ssh:${s.host ?? s.name}`,
        name: s.name,
        host: s.host,
        ok: s.ok === true,
        error: s.ok ? undefined : (s.error ?? "unreachable"),
        sessions: s.sessions ?? [],
        sshBox: true,
        provider: s.provider,
      });
    return out;
  }, [local, remote, ssh, boxes, remoteLoading]);

  // Rows in box order, newest first within each box, capped to that box's `shown` count. `hidden`
  // and `matched` are per box so the footer can offer "Load more"/"Load all" and count the rest.
  const paged = useMemo(
    () => pageSessions(groups, { box, cwd, origin, query, shown }),
    [groups, box, cwd, origin, query, shown],
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

  const open = async (r: {
    g: { key: string; box?: BoxData; name: string; sshBox?: boolean; provider?: string };
    s: SessionData;
  }) => {
    if (r.g.sshBox) {
      // A dsh session that already ran on the box (archived or live): go through the same open path
      // as local. For an owned session `/open` unarchives it via the registry without reading the
      // transcript from this box's disk, then opens under its own durable provider binding. Calling
      // `sessions.open` alone would leave an archived row archived — the "Restore" no-op just seen.
      if (r.s.dsh?.id) {
        setBusyId(r.s.id);
        setError("");
        try {
          await openHere(ctx, r.s, r.s.cwd ?? "");
          close?.();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusyId("");
        }
        return;
      }
      // A raw box transcript dsh never tracked: make a session for it, bind it to the box's provider
      // (default model) so the resume runs back on the box, then open. If the model seam is gone we
      // fall back to a clear message rather than resuming it against the local claude.
      const provider = r.g.provider;
      if (!provider) {
        setError(`Pick ${r.g.name}'s model in the composer to open this session.`);
        return;
      }
      setBusyId(r.s.id);
      setError("");
      try {
        await ctx.sessions.create({ sessionId: r.s.id });
        const dir = ctx.modelDirectories.directoryFor(r.s.id);
        const state = await dir.load?.();
        const model = state?.groups.find((g) => g.id === provider)?.models[0]?.id;
        if (model && dir.select) await dir.select({ provider, model });
        ctx.sessions.open(r.s.id);
        close?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId("");
      }
      return;
    }
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
      close?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };

  // Export is a plain file save: the transcript byte for byte, so importing it back is a no-op.
  // ponytail: one file per ticked row rather than a zip — no archive dependency, and a browser
  // saves a handful of sequential downloads without a prompt. Zip it if people tick dozens.
  const download = async () => {
    const wanted = rows.filter((r) => picked.has(rowKey(r)));
    setMoving(`Downloading ${wanted.length}…`);
    setError("");
    try {
      for (const r of wanted) {
        const q = new URLSearchParams({ id: r.s.id });
        if (r.s.cwd) q.set("cwd", r.s.cwd);
        if (r.g.provider) q.set("provider", r.g.provider);
        const base = `${r.s.title ? slugFile(r.s.title) : "claude"}-${r.s.id.slice(0, 8)}`;
        await saveBlob(`${ROUTE}/transcript?${q}`, `${base}.jsonl`);
      }
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving("");
    }
  };

  // One row's menu: the same file the batch download saves, the Markdown export, and the command
  // that reopens the session in a terminal on the box it lives on.
  const rowAction = async (
    r: Exclude<(typeof paged)["list"], undefined>[number],
    action: string,
  ) => {
    setMenuFor("");
    setError("");
    const q = new URLSearchParams({ id: r.s.id });
    if (r.s.cwd) q.set("cwd", r.s.cwd);
    if (r.g.provider) q.set("provider", r.g.provider);
    const base = `${r.s.title ? slugFile(r.s.title) : "claude"}-${r.s.id.slice(0, 8)}`;
    try {
      if (action === "jsonl") await saveBlob(`${ROUTE}/transcript?${q}`, `${base}.jsonl`);
      else if (action === "md") await saveBlob(`${ROUTE}/transcript.md?${q}`, `${base}.md`);
      else if (action === "resume") {
        const host = r.g.sshBox ? r.g.host : undefined;
        await navigator.clipboard.writeText(resumeCommand(r.s.id, r.s.cwd, host));
        setMoving("Copied");
        setTimeout(() => setMoving(""), 1600);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMoving(`Importing ${files.length}…`);
    setError("");
    try {
      for (const f of Array.from(files)) {
        const body = await readJson<{ id?: string; error?: string }>(
          await fetch(`${ROUTE}/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: await f.text() }),
          }),
        );
        if (!body.id) throw new Error(`${f.name}: ${body.error ?? "import failed"}`);
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving("");
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
    <div>
      <div
        style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}
      >
        <div style={meta}>
          {loading ? "Loading…" : `${rows.length} shown · ${total} total`}
          {remoteLoading ? " · checking boxes…" : ""}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {moving && <span style={meta}>{moving}</span>}
          {picked.size > 0 && (
            <button
              id="dsh-oh-my-claude-download"
              type="button"
              style={btnPrimary}
              disabled={moving !== ""}
              onClick={() => void download()}
            >
              Download {picked.size}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".jsonl,application/x-ndjson"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            id="dsh-oh-my-claude-import"
            type="button"
            style={btn}
            disabled={moving !== ""}
            title="Add a .jsonl transcript from another box; it lands in this plugin's own store."
            onClick={() => fileInput.current?.click()}
          >
            Import
          </button>
          <button type="button" style={btn} disabled={loading} onClick={load}>
            Refresh
          </button>
        </div>
      </div>
      <div
        id="dsh-oh-my-claude-session-filters"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 10 }}
      >
        <select
          id="dsh-oh-my-claude-box-filter"
          style={filterSelect}
          value={box}
          onChange={(e) => setBox(e.target.value)}
          title="Box"
        >
          <option value="all">All boxes</option>
          {groups.map((g) => (
            <option key={g.key} value={g.key} disabled={!g.ok} title={g.ok ? g.host : g.error}>
              {g.name}
              {g.key === "local" ? " · here" : ""}
              {g.ok ? ` · ${g.sessions.length}` : " · offline"}
            </option>
          ))}
        </select>
        <select
          id="dsh-oh-my-claude-cwd-filter"
          style={filterSelect}
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
          style={{ ...filterSelect, flexBasis: 120 }}
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          title="Origin"
        >
          <option value="all">Any origin</option>
          <option value="dsh">In dsh</option>
          <option value="archived">Archived</option>
          <option value="terminal">Terminal only</option>
        </select>
        <input
          id="dsh-oh-my-claude-session-search"
          type="search"
          style={{ ...inputStyle, flex: "2 1 200px", minWidth: 160 }}
          value={query}
          placeholder="Search title, id or path"
          aria-label="Search sessions"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && (
        <p id="dsh-oh-my-claude-error" style={{ color: T.err, fontSize: 13, margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      {!loading && rows.length === 0 && (
        <p id="dsh-oh-my-claude-empty" style={{ ...meta, marginTop: 10 }}>
          No Claude Code sessions match
        </p>
      )}
      {loading && <SkeletonRows rows={4} />}
      <div id="dsh-oh-my-claude-sessions" style={{ marginTop: 6 }}>
        {rows.map((r) => {
          const isLocal = r.g.key === "local";
          const isSsh = r.g.sshBox === true;
          const opened =
            (isLocal || isSsh) && Boolean(known[r.s.dsh?.id ?? r.s.id]) && !r.s.dsh?.archived;
          const busy = busyId === r.s.id;
          const label = busy
            ? "Opening…"
            : !isLocal && !isSsh
              ? `Open on ${r.g.name}`
              : opened
                ? "Show"
                : r.s.dsh?.archived
                  ? "Restore"
                  : "Open";
          return (
            <div
              key={rowKey(r)}
              data-testid="dsh-oh-my-claude-session-row"
              data-omc-arrived=""
              style={row}
            >
              {/* Only a row this box can read is downloadable: an HTTP box's transcript is on that
                  box's disk, and its own panel is where it downloads from. */}
              <input
                type="checkbox"
                aria-label={`Select ${r.s.title || r.s.id}`}
                disabled={!isLocal && !isSsh}
                checked={picked.has(rowKey(r))}
                onChange={(e) =>
                  setPicked((set) => {
                    const next = new Set(set);
                    if (e.target.checked) next.add(rowKey(r));
                    else next.delete(rowKey(r));
                    return next;
                  })
                }
                style={{ marginRight: 8, flex: "0 0 auto" }}
              />
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
                  style={{
                    ...meta,
                    marginTop: 3,
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    // A flex item never shrinks past its own text, so without this the row's tail
                    // ran out of the card and under the Open button. The workspace path gives way
                    // first (below), and this clips whatever is still too wide on a narrow panel.
                    overflow: "hidden",
                  }}
                >
                  {multiBox && (
                    <span style={pill(T.faint)} title={r.g.host}>
                      {r.g.host ?? r.g.name}
                    </span>
                  )}
                  <Origin s={r.s} />
                  {r.s.cwd && (
                    <span
                      title={r.s.cwd}
                      style={{
                        fontFamily: T.mono,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {shortPath(r.s.cwd)}
                    </span>
                  )}
                  <span style={{ flex: "0 0 auto" }}>
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
              {(isLocal || isSsh) && (
                <Menu
                  open={menuFor === rowKey(r)}
                  onClose={() => setMenuFor("")}
                  selectedId=""
                  items={[
                    { id: "jsonl", label: "Download .jsonl" },
                    { id: "md", label: "Export as Markdown" },
                    { id: "resume", label: "Copy resume command" },
                  ]}
                  onSelect={(id) => void rowAction(r, id)}
                  side="top"
                  portal
                  anchor={
                    <button
                      type="button"
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={menuFor === rowKey(r)}
                      data-omc-row-menu=""
                      style={{ ...btn, padding: "0 8px", marginLeft: 6 }}
                      onClick={() => setMenuFor((cur) => (cur === rowKey(r) ? "" : rowKey(r)))}
                    >
                      ⋯
                    </button>
                  }
                />
              )}
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
    </div>
  );
}

interface SettingsFile {
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
    // The file as this tab last read it. The CLI writes settings.json itself — a plugin install, a
    // /model pick — and a save that ignored that would put the whole file back without it.
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
 * Every machine, in one place. This box is the first row (auto-detected, not removable — it is the
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
  /** The transport and address: `ssh · lilly`, `link · http://…`, or this box's hostname. */
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
  return (
    <div data-testid={testId} style={{ ...row, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
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
            alignItems: "center",
            gap: 6,
            whiteSpace: "normal",
            lineHeight: "18px",
          }}
        >
          {tone !== "none" && (
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: dot,
                flex: "0 0 auto",
              }}
            />
          )}
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {facts.map((f, i) => (
              <span key={i}>
                {i > 0 && <span style={{ margin: "0 6px", opacity: 0.6 }}>·</span>}
                {f}
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
        <div style={{ display: "flex", gap: 6, flex: "0 0 auto", alignSelf: "flex-start" }}>
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
function SkeletonRows({ rows: n }: { rows: number }) {
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

function useLoginFlow(onDone: (host: string) => void, routes: LoginRoutes = SSH_LOGIN) {
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

function LoginSteps({
  login,
  setLogin,
  submit,
}: {
  login: LoginFlow;
  setLogin: (next: LoginFlow | null) => void;
  submit: () => void;
}) {
  return (
    <div style={{ ...meta, marginTop: 6, whiteSpace: "normal", overflowWrap: "anywhere" }}>
      {login.busy && !login.url && <span>starting login…</span>}
      {login.url && (
        <>
          <div>
            A sign-in tab may have opened by itself; if not, open{" "}
            <a href={login.url} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>
              Claude sign-in
            </a>{" "}
            and approve. If that page shows a code, paste it below; if it says you are all set, this
            row finishes on its own.
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input
              style={inputStyle}
              placeholder="Paste code"
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
              {login.busy ? "…" : "Submit"}
            </button>
            <button type="button" style={btn} onClick={() => setLogin(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {login.error && <div style={{ color: T.err, marginTop: 4 }}>{login.error}</div>}
    </div>
  );
}

function Boxes({ ctx, boxes, setBoxes, open, onToggle }: BoxesProps) {
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
    const t = setInterval(loadNets, 3000);
    return () => clearInterval(t);
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
  useEffect(() => {
    fetch(`${ROUTE}/ssh-boxes`)
      .then((r) => readJson<{ boxes?: SshBoxData[] }>(r))
      .then((b) => setSsh(b.boxes ?? []))
      .catch((e: Error) => setError(e.message));
    void loadMe();
    fetch(`${ROUTE}/remote-workspaces`)
      .then((r) => readJson<{ workspaces?: RemoteWs[] }>(r))
      .then((b) => setRws(b.workspaces ?? []))
      .catch(() => {});
  }, []);

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
      .then((b) => setSsh(b.boxes ?? []))
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
      ? "none saved"
      : `${total} saved · ${busy ? "checking…" : `${reachable} reachable`}`;
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
      title="Boxes"
      summary="Where Claude Code runs: this box, any ssh box, a linked dsh. Each keeps its own login."
      actions={
        open ? (
          <>
            <span style={{ ...meta, alignSelf: "center", marginRight: "auto" }}>{summary}</span>
            <button type="button" style={btn} disabled={busy || total === 0} onClick={refresh}>
              {busy ? "Checking…" : "Refresh"}
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
          title="This box"
          kind={me.host}
          tone={!me.binary || !me.loggedIn ? "err" : "ok"}
          facts={[
            me.binary ? cliVersion(me.version) : bad("Claude Code not on PATH"),
            // A token from the earlier setup-token flow is named, since it is the plugin's alone; a
            // login made here or in a terminal is the CLI's own and needs no label.
            <span key="login" data-omc-login-method={me.authMethod}>
              {me.loggedIn
                ? `${maskEmail(me.email ?? "logged in")}${me.authMethod === "panel token" ? " · panel token" : ""}`
                : bad("not logged in")}
            </span>,
            // Logged out on disk, but processes started earlier still answer on the login they
            // read then; Log out makes the cut.
            ...(!me.loggedIn && (me.running ?? 0) > 0
              ? [
                  <span key="running" data-omc-running={me.running}>
                    {me.running} {me.running === 1 ? "session" : "sessions"} still answering on the
                    old login
                  </span>,
                ]
              : []),
          ]}
          note={
            !me.binary && (
              <>
                Install Claude Code here (<code style={codeInline}>claude</code> on PATH), then
                refresh.
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
                  Log in
                </button>
              )}
              {/* One Log out does everything: forgets a stored token, logs the box's Claude Code
                  out, and kills its running sessions. */}
              {(me.loggedIn || (me.running ?? 0) > 0) && (
                <ConfirmButton
                  label="Log out"
                  ariaLabel="Log out: log this box's Claude Code out and stop its running sessions"
                  style={btn}
                  disabled={busy}
                  onAct={() => logout("")}
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
          ? [busy ? "checking…" : "unchecked"]
          : down
            ? [
                <span key="reach" title={st.reach?.detail}>
                  {bad(reachLabel(st.reach?.stage ?? ""))}
                </span>,
              ]
            : st.error
              ? [bad(st.error)]
              : [
                  st.binary ? cliVersion(st.version) : bad("no claude"),
                  st.loggedIn ? maskEmail(st.email ?? "logged in") : bad("not logged in"),
                ];
        if (st && up && !st.loggedIn && (st.running ?? 0) > 0)
          facts.push(
            `${st.running} ${st.running === 1 ? "session" : "sessions"} still answering on the old login`,
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
                    Log in
                  </button>
                )}
                {/* The same Log out this box has: `claude auth logout` over ssh, its running
                    sessions stopped, any leftover token forgotten. */}
                {up && (st.loggedIn || (st.running ?? 0) > 0) && (
                  <ConfirmButton
                    label="Log out"
                    ariaLabel={`Log out ${b.name}: log its Claude Code out and stop its running sessions`}
                    style={btn}
                    disabled={busy}
                    onAct={() => logout(b.host)}
                  />
                )}
                <ConfirmButton
                  label="Remove"
                  ariaLabel={`Remove ${b.name}`}
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
          ? [busy ? "checking…" : "unchecked"]
          : !ok
            ? [bad(st.error ?? "unreachable")]
            : r
              ? [
                  r.host ?? "",
                  r.binary ? cliVersion(r.version) : bad("no claude"),
                  r.loggedIn ? maskEmail(r.email ?? "logged in") : bad("not logged in"),
                  <span key="plugin" style={skew ? { color: T.warn } : undefined}>
                    plugin {r.plugin ?? "?"}
                    {skew ? ` ≠ ${self?.plugin} here` : ""}
                  </span>,
                ]
              : [];
        return (
          <BoxRow
            key={`dsh:${b.url}`}
            testId="dsh-oh-my-claude-box-row"
            title={b.name}
            kind={`link · ${b.url}`}
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
                    Log in
                  </button>
                )}
                {r?.loggedIn && (
                  <ConfirmButton
                    label="Log out"
                    ariaLabel={`Log out ${b.name}: log its Claude Code out and stop its running sessions`}
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
                  Edit settings
                </button>
                <ConfirmButton
                  label="Remove"
                  ariaLabel={`Remove ${b.name}`}
                  style={btn}
                  disabled={busy}
                  onAct={() => removeDsh(b.url)}
                />
                <button type="button" style={btnPrimary} onClick={() => jump(b)}>
                  Open
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
            ) : kind === "tailscale" ? (
              <>
                {ts?.loggedIn && (
                  <select
                    style={{ ...select, flex: "0 1 220px" }}
                    aria-label="Tailscale peer"
                    value={pickedPeer?.host ?? ""}
                    onChange={(e) => {
                      const peer = ts.peers.find((p) => p.host === e.target.value) ?? null;
                      setPickedPeer(peer);
                      if (peer)
                        setDraft({ ...draft, name: draft.name || peer.name, host: peer.host });
                    }}
                  >
                    <option value="">Pick a peer…</option>
                    {ts.peers.map((p) => (
                      <option key={p.host} value={p.host} disabled={peerIsSaved(p, ssh)}>
                        {p.online ? "●" : "○"} {p.name}
                        {p.os ? ` · ${p.os}` : ""}
                        {peerIsSaved(p, ssh) ? " · saved" : ""}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  style={{ ...inputStyle, flex: "1 1 220px" }}
                  placeholder="user@name.tailnet.ts.net or 100.x.y.z"
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
                    aria-label="WireGuard peer"
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
                    <option value="">Pick a peer…</option>
                    {wg.peers.map((p) => (
                      <option key={`${p.iface}:${p.host}`} value={p.host}>
                        {p.host} · {p.iface} · handshake {handshakeText(p.handshakeAge)}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  style={{ ...inputStyle, flex: "1 1 220px" }}
                  placeholder="user@10.x.y.z (the tunnel address)"
                  value={draft.host}
                  onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                />
              </>
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
              style={btnPrimary}
              disabled={
                busy ||
                !draft.name.trim() ||
                (kind !== "dsh" ? !draft.host.trim() : !draft.url.trim())
              }
            >
              Add
            </button>
            {total > 0 && (
              <button type="button" style={btn} onClick={() => setAdding(false)}>
                Cancel
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
                "Checking this node's tailnet…"
              ) : !ts.installed ? (
                <>
                  <span style={{ color: T.faint }}>not installed</span>
                  Install Tailscale on this box first (tailscale.com/download); the box side needs
                  it too.
                </>
              ) : ts.loggedIn ? (
                <>
                  <span style={{ color: T.ok }}>on the tailnet</span>
                  {ts.self && (
                    <span style={{ fontFamily: T.mono }}>{ts.self.host || ts.self.name}</span>
                  )}
                  {ts.peers.length === 0 &&
                    "No peers yet: bring the box onto the tailnet and Refresh."}
                </>
              ) : (
                <>
                  <span style={{ color: T.warn }}>not connected</span>
                  <input
                    style={{ ...inputStyle, flex: "1 1 200px", fontSize: 12 }}
                    placeholder="Login server (Headscale), else Tailscale"
                    value={tsServer.loginServer}
                    onChange={(e) => setTsServer({ ...tsServer, loginServer: e.target.value })}
                  />
                  <input
                    style={{ ...inputStyle, flex: "1 1 160px", fontSize: 12 }}
                    type="password"
                    autoComplete="off"
                    placeholder="Pre-auth key (optional)"
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
                        Approve this box on your tailnet
                      </a>
                      <span>waiting for the approval…</span>
                    </>
                  ) : (
                    <button
                      type="button"
                      style={btn}
                      disabled={tsLogin?.busy}
                      onClick={joinTailnet}
                    >
                      {tsLogin?.busy ? "Asking…" : "Connect"}
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
                ? `${pickedPeer.name} runs Tailscale SSH: no key to copy, ssh signs in with your tailnet identity.`
                : `${pickedPeer.name} needs an SSH key of yours, or Tailscale SSH turned on there (tailscale up --ssh).`}
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
                "Checking WireGuard…"
              ) : !wg.installed ? (
                <>
                  <span style={{ color: T.faint }}>not installed</span>
                  Install wireguard-tools and bring a tunnel up (wg-quick up); its peer address is
                  the host.
                </>
              ) : wg.peers.length === 0 ? (
                <>
                  <span style={{ color: T.warn }}>no tunnel up</span>
                  {wg.error
                    ? wg.error
                    : "Bring one up with wg-quick, or type the peer's tunnel address."}
                </>
              ) : (
                <>
                  <span style={{ color: T.ok }}>
                    {wg.peers.length === 1 ? "1 peer" : `${wg.peers.length} peers`}
                  </span>
                  The tunnel address is the host; ssh still needs your key on the box.
                </>
              )}
            </div>
          )}
          <div style={{ ...meta, whiteSpace: "normal", marginTop: 4 }}>
            {kind !== "dsh" ? (
              <>
                This dsh drives Claude Code on the box over ssh (key-based, or Tailscale SSH), and
                the box shows up in the model picker. Log in from its row once it is added.
              </>
            ) : (
              <>
                The box runs its own dsh with this plugin: its sessions show in the archive and Open
                hops there. The token is its dsh launch token, needed only when this browser has
                never logged into it.
              </>
            )}
          </div>
        </>
      ) : (
        <div style={{ ...row, flexWrap: "wrap", paddingTop: 12 }}>
          <p style={{ ...meta, whiteSpace: "normal", flex: "1 1 220px", margin: 0 }}>
            An ssh box shows up in the model picker; a linked dsh shows its sessions in the archive.
          </p>
          <button type="button" style={btn} disabled={busy} onClick={() => setAdding(true)}>
            Add a box…
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
          marginTop: 12,
          paddingTop: 12,
          opacity: ssh.length > 0 ? 1 : 0.45,
          transition: "opacity 120ms ease",
        }}
      >
        <h3 style={h3}>Remote workspaces</h3>
        <p style={{ margin: "2px 0 4px", color: T.muted, fontSize: 13 }}>
          A folder on an ssh box, pinned as a workspace. Sessions there run that box's Claude on its
          files; nothing is copied.
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
                label="Remove"
                ariaLabel={`Remove ${w.name}`}
                style={btn}
                disabled={busy}
                onAct={() => removeRw(w.path)}
              />
            }
          />
        ))}
        <div style={{ ...row, flexWrap: "wrap", paddingTop: 4 }}>
          <p style={{ ...meta, whiteSpace: "normal", flex: "1 1 220px", margin: 0 }}>
            {canAdd
              ? "Add one from the sidebar's Add workspace button: it browses whichever box you pick."
              : ssh.length === 0
                ? "Needs an ssh box above first."
                : "The sidebar's Add workspace button browses the box you pick once dsh can list its folders."}
          </p>
          <button
            type="button"
            style={btn}
            disabled={!canAdd}
            onClick={() => document.dispatchEvent(new Event(OPEN_EVENT))}
          >
            Add workspace…
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
  age === null ? "never" : age < 90 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;
/** A Tailscale peer as `/tailscale/peers` answers it (mirrors reach.ts's `TailscalePeer`). */
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
      return "name not found";
    case "route":
      return "unreachable";
    case "hostkey":
      return "host key";
    case "auth":
      return "key refused";
    case "policy":
      return "tailnet policy";
    case "shell":
      return "shell error";
    case "no-cli":
      return "no claude";
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
// The breakdown is re-read whenever dsh re-renders the meter's dialog, which is on every repaint of
// the percentage while a turn runs. The promise is cached, not its answer, so the frames that arrive
// before the first one lands share it instead of each opening a request of their own.
const contextCache = new Map<string, { at: number; reply: Promise<ContextReply> }>();
const loadContext = (sessionId: string): Promise<ContextReply> => {
  const hit = contextCache.get(sessionId);
  if (hit && Date.now() - hit.at < 10_000) return hit.reply;
  const reply = (async (): Promise<ContextReply> => {
    try {
      const r = await fetch(`${ROUTE}/context?session=${encodeURIComponent(sessionId)}`);
      // SAFETY: the body is our own JSON route; both shapes carry `ok`
      return (await r.json()) as ContextReply;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  })();
  contextCache.set(sessionId, { at: Date.now(), reply });
  return reply;
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
    const tone = pct >= 90 ? T.err : pct >= 70 ? T.warn : ACCENT;
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
    fill.style.cssText = `height:100%;width:${pct}%;border-radius:2px;background:linear-gradient(90deg,${tone},${pct >= 70 ? tone : SHIMMER})`;
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
/** A registered scan. Sync scans are handed the burst's records so they can look at what changed
 *  instead of the whole document; a scan called with none does a full pass. */
type FrameScan = (records?: MutationRecord[]) => void;
const frameScans = new Set<FrameScan>();
/**
 * Scans that have to land before the browser paints. A frame scan is fine for anything that only
 * adds to what dsh drew, but the tool fold *hides* a block dsh already laid out, and a frame late
 * is a frame the full code block is on screen. Those run inside the observer callback instead,
 * which is a microtask checkpoint: still before paint, still batched per mutation burst.
 */
const syncScans = new Set<FrameScan>();
let bodyObserver: MutationObserver | undefined;
let scanQueued = false;
/** The bursts since the last frame, so a frame scan can look at what changed instead of the body. */
let pending: MutationRecord[] = [];
/**
 * A hidden tab gets no animation frames, so a turn that streams into a background tab piles records
 * up with nothing draining them. Past this many the burst is dropped and the next frame goes wide,
 * which is what a scan does on its first run anyway.
 */
const PENDING_CAP = 4000;
let pendingOverflow = false;
const flushScans = () => {
  scanQueued = false;
  const records = pendingOverflow ? undefined : pending;
  pending = [];
  pendingOverflow = false;
  for (const scan of frameScans) scan(records);
};
const observeBody = (observer: MutationObserver) => {
  observer.observe(document.body, { childList: true, subtree: true });
};
/**
 * The elements a burst touched: each record's target plus whatever it added. A scan handed these
 * covers the same ground as one over `document.body` — dsh only ever draws through the DOM — at a
 * cost that follows what changed rather than how long the conversation is.
 */
const changedElements = (records: MutationRecord[]): Set<HTMLElement> => {
  const nodes = new Set<HTMLElement>();
  for (const rec of records) {
    if (rec.target instanceof HTMLElement) nodes.add(rec.target);
    for (const node of rec.addedNodes) if (node instanceof HTMLElement) nodes.add(node);
  }
  return nodes;
};

/** Register a scan; the returned function removes it again (a React effect's cleanup needs that). */
const onBodyMutation = (scan: FrameScan, sync = false): (() => void) => {
  const set = sync ? syncScans : frameScans;
  const wrapped = guard(scan);
  set.add(wrapped);
  const off = () => set.delete(wrapped);
  if (bodyObserver) return off;
  // The new bundle registers its own scans; this one's would run on top of them against a context
  // that no longer answers.
  whenContextGone(() => {
    bodyObserver?.disconnect();
    bodyObserver = undefined;
    frameScans.clear();
    syncScans.clear();
  });
  bodyObserver = new MutationObserver((records) => {
    // The records are the point: a sync scan that walks only what changed costs the same on a long
    // transcript as on a short one. So the observer stays attached across the pass — detaching to
    // avoid being called back by our own writes threw the records away, and a scan with no records
    // has nothing to scope itself to. The writes do call this back once more; a scan that already
    // did its work finds nothing to do and the second pass ends there.
    for (const run of syncScans) run(records);
    if (frameScans.size === 0) return;
    if (pending.length + records.length > PENDING_CAP) {
      pendingOverflow = true;
      pending = [];
    } else if (!pendingOverflow) for (const rec of records) pending.push(rec);
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(flushScans);
  });
  observeBody(bodyObserver);
  return off;
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
    const mark = sparkNode(13);
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
    // The mark is a drawing, not a letter, so the row centres on it rather than sitting it on a
    // baseline it does not have.
    line.style.cssText = `border-bottom:1px solid ${T.border};margin-bottom:4px;padding-bottom:4px;display:flex;gap:6px;align-items:center`;
    const mark = sparkNode(12, SHIMMER);
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
  // Scoped to the burst: the ring's dialog and tooltip are rare nodes, and the body-wide pair of
  // attribute queries this used to run every dirty frame cost 0.4 ms on a conversation of 30k nodes
  // — paid on every frame of every streaming turn to find, almost always, nothing.
  onBodyMutation((records) => {
    if (records === undefined) return scan(document.body);
    for (const node of changedElements(records)) scan(node);
  });
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

/** A rule that paints only while its theme group is on. The selector is doubled: once for an
 *  absent `data-omc-theme` (before the hints load every group is on, so the first paint is
 *  today's) and once for the group's token. `rest` is the part of the selector after the body;
 *  `claude` false drops the `[data-omc-claude]` condition for rules that never had it. */
const gated = (group: ThemeGroup, rest: string, claude = true): string => {
  const body = claude ? "body[data-omc-claude]" : "body";
  return `${body}:not([data-omc-theme]) ${rest},${body}[data-omc-theme~="${group}"] ${rest}`;
};

/** Whether a theme group is on right now: absent attribute means on (nothing has loaded yet). */
const hasTheme = (group: ThemeGroup): boolean => {
  const v = document.body.getAttribute("data-omc-theme");
  return v === null || v.split(" ").includes(group);
};
/** The page's accent as channels for the spinner's mixing, or `fallback` when none is set yet. */
const accentRgb = (fallback: Rgb): Rgb => {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--omc-accent").trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? hexToRgb(v) : fallback;
};

/** Wire one turn-status element for a claude-code session: verb + ping-pong spinner + orange gradient. */
/** Inject (or re-inject after a hot reload) the Claude-orange rule; idempotent by id. Reuses the
 *  element but always rewrites it: a hot reload lands a new bundle in a page still carrying the last
 *  one's sheet, and returning early here left the old rules in force until a hand reload. */
const ensureTurnStatusStyle = () => {
  const found = document.getElementById("dsh-oh-my-claude-turn-status");
  const styleEl = found instanceof HTMLStyleElement ? found : document.createElement("style");
  styleEl.id = "dsh-oh-my-claude-turn-status";
  // The frames differ in advance width in a proportional font; a fixed cell keeps the verb still.
  // The glyph sits at the cell's start, not its middle, which is what the terminal does for free:
  // there every frame is one monospace cell, so the wide asterisks all land on the same left edge
  // and only the narrow `·` reads as movement. Centring here made the whole animation breathe out
  // of both sides instead.
  // `body[data-omc-claude]` is set while the open session is a Claude mount, so the row is orange
  // from its first paint; the watcher then swaps the text and adds the spinner a frame later.
  //
  // The last two rules recolour the conversation's selected view tab (Chat / Trajectory), which dsh
  // paints from its blue `--dsw-alias-state-business-primary` — the label and its underline draw
  // from the same token but as `color` and `background`, so both are overridden. Gated on the same
  // body attribute, so a session that switches off a Claude mount hands the tab straight back to
  // dsh's blue on the next paint. ponytail: `[role=tablist] > [role=tab]` catches any dsh view-tab
  // switcher; if a non-conversation one should stay blue, narrow it the day one appears.
  //
  // Then what the markdown draws in a colour of its own inside a Claude session. Two in dsh's
  // blue: a link, with its underline at a lighter weight and the shimmer on hover, and a task
  // checkbox, whose tick is the platform accent. Two in a flat grey: a blockquote's left bar
  // (`--dsw-alias-label-caption`) and a rule's hairline (`--dsw-alias-border-l2`). All are accents
  // rather than text, so they take the orange — the bar at half strength, the rule at a third of it
  // since it runs the whole width and a solid orange band across a message reads as a warning.
  // Code highlighting keeps its own palette: those colours mean token kinds, not the brand. Swept
  // 2026-09-09 with a computed-style pass over the conversation column: nothing else is blue there.
  // Missed by that sweep because it only exists while a run is open: a workflow-run card's member
  // row is a button in `--dsw-alias-link` blue while its child session is still running (dsh's
  // ui-workflow-run package, `memberButton`); once the member finishes it becomes a plain grey row.
  // The data attributes are dsh's own, the hashed class name is not.
  // The stats row under the composer (`data-composer-stats`) is padded to the composer's side
  // clearance, which leaves its pills 653px in a 717px column. dsh's two fill that; ours as a
  // third clips all three to an ellipsis by a few pixels. The pills are centred, so the padding
  // does no aligning; take it down to the row's rounded corners and the three fit.
  styleEl.textContent = `${gated("row", '[role="status"][aria-live="polite"]')},${gated("row", "[data-dsh-oh-my-claude-turn]", false)}{background-image:var(--omc-row-bg,linear-gradient(90deg,var(--omc-accent) 0%,var(--omc-accent) 40%,var(--omc-shimmer) 50%,var(--omc-accent) 60%,var(--omc-accent) 100%))}@keyframes omc-word{from{-webkit-text-fill-color:var(--omc-word-lo)}to{-webkit-text-fill-color:var(--omc-word-hi)}}[data-omc-turn-word]{animation:omc-word 1s ease-in-out 3s infinite alternate}@media (prefers-reduced-motion:reduce){[data-omc-turn-word]{animation:none}}[data-dsh-oh-my-claude-turn]>span[aria-hidden]{display:inline-block;width:1.3em;text-align:start;flex:none}[data-dsh-oh-my-claude-turn]{max-width:100%;min-width:0}[data-omc-turn-detail]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}${gated("panel", "[data-omc-login-card] button:hover", false)},${gated("panel", "[data-omc-login-card] button:focus-visible", false)}{color:var(--omc-accent);border-color:var(--omc-accent)}${controlStatesCss("[data-omc-settings]")}${controlStatesCss('[role="dialog"][aria-label="Oh My Claude"]')}[data-omc-card]:hover{border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.5))}[data-omc-card]>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:-2px}[data-omc-card]>button:hover{background:none}@keyframes omc-sheen{from{background-position:200% 0}to{background-position:-200% 0}}[data-omc-skeleton]{border-radius:6px;background:linear-gradient(90deg,${T.border} 30%,${T.hover} 50%,${T.border} 70%);background-size:200% 100%;animation:omc-sheen 1.4s linear infinite}@keyframes omc-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}[data-omc-arrived]{animation:omc-rise .18s ease-out}@media (prefers-reduced-motion:reduce){[data-omc-skeleton],[data-omc-arrived]{animation:none}}${gated("prose", '[role="tablist"]>[role="tab"][aria-selected="true"]')}{color:var(--omc-accent)}${gated("prose", '[role="tablist"]>[role="tab"][aria-selected="true"]::after')}{background:var(--omc-accent)}${gated("prose", '[class*="_markdown"] blockquote')}{border-left-color:color-mix(in srgb,var(--omc-accent) 50.2%,transparent)}${gated("prose", '[class*="_markdown"] hr')}{background:color-mix(in srgb,var(--omc-accent) 34.9%,transparent)}${gated("prose", '[class*="_markdown"] a')}{color:var(--omc-accent);text-decoration-color:color-mix(in srgb,var(--omc-accent) 40%,transparent)}${gated("prose", '[class*="_markdown"] a:hover')}{color:var(--omc-shimmer);text-decoration-color:var(--omc-shimmer)}${gated("prose", '[class*="_markdown"] input[type="checkbox"]')}{accent-color:var(--omc-accent)}${gated("prose", "[data-workflow-run] button[data-member-status] [data-member-label]")}{color:var(--omc-accent)}body[data-omc-panel-open] [data-width-handle]{pointer-events:none}body[data-omc-panel-open] [class*="_toBottomSlot"],body:has([data-omc-cost-dialog]) [class*="_toBottomSlot"]{opacity:0;pointer-events:none;transition:opacity .1s}@keyframes omc-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--omc-accent) 55%,transparent)}100%{box-shadow:0 0 0 12px transparent}}${gated("panel", 'button[aria-label="Oh My Claude"][data-omc-pulse]', false)}{animation:omc-pulse 1.1s ease-out 3}@media (prefers-reduced-motion:reduce){button[aria-label="Oh My Claude"][data-omc-pulse]{animation:none}}${gated("prose", "[data-produced-files-row] button")}{color:var(--omc-accent)}${gated("prose", "[data-produced-files-row] button:hover")}{color:var(--omc-shimmer)}body[data-omc-claude] [data-composer-stats]{padding-left:8px;padding-right:8px}${gated("prose", '[class*="_optionLine"]>[class*="_badge"]')}{background:color-mix(in srgb,var(--omc-accent) 16%,transparent);color:var(--omc-accent)}[data-omc-cost-over]{color:var(--omc-accent)}${RAINBOW_CSS}${COST_DIALOG_CSS}`;
  document.head.appendChild(styleEl);
};

/** One verb per running turn: the row remounts on every tool step and dsh rewrites its text, so a
 *  fresh pick each time reads as flicker. Keyed by session; forgotten after a short absence. */
const turnVerbs = new Map<string, { verb: string; seen: number }>();
const VERB_MEMORY_MS = 4000;
/** A token count the way the CLI's status line writes one: `1.2k` past a thousand, plain below. */
const shortCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const verbFor = (sessionId: string, verbs: string[]): string => {
  const now = Date.now();
  // Every session that ever ran a turn in this tab left an entry behind. They are small, but the
  // map is only ever read for a turn that is running right now, so the stale ones are pure growth.
  for (const [id, seen] of turnVerbs) if (now - seen.seen >= VERB_MEMORY_MS) turnVerbs.delete(id);
  const kept = turnVerbs.get(sessionId);
  const verb = kept && now - kept.seen < VERB_MEMORY_MS ? kept.verb : pickVerb(verbs, Math.random);
  turnVerbs.set(sessionId, { verb, seen: now });
  return verb;
};

/** On dsh's status element once this bundle has wired it; read before the wiring path allocates. */
const TURN_MARK = "data-dsh-oh-my-claude-turn";
/** The bracket this bundle appends to a status row. Marked so a later bundle can clear the one its
 *  predecessor left: a hot reload re-runs the wiring over a row already on screen, and without this
 *  every rebuild added another bracket to it. */
const DETAIL_MARK = "data-omc-turn-detail";
/** How long thinking runs before the row says so differently. The CLI switches to "still thinking"
 *  and warms the colour once it has been at it a while; neither the wording nor the colour is ever
 *  put on the wire, so the rule is kept here. */
/** The CLI's own wording ladder for a thinking burst (2.1.268, `gr()` in its spinner), by how long
 *  the burst has run; it warms the colour from the first step. Same marks here so the row reads
 *  the way a terminal user already knows it. */
const THINKING_WORDS: [number, string][] = [
  [45_000, "almost done thinking"],
  [30_000, "thinking some more"],
  [20_000, "thinking more"],
  [10_000, "still thinking"],
];
const thinkingWord = (ms: number): string =>
  THINKING_WORDS.find(([at]) => ms >= at)?.[1] ?? "thinking";

type Rgb = readonly [number, number, number];
/** The CLI's spinner colours (2.1.268 themes). `claude` is the same in both; the shimmer and the
 *  warning shade differ, so the row picks by the page's background. The stall red is a constant in
 *  the spinner code, not a theme entry. The grey pair is the bracket word's idle pulse. */
const SPINNER_DARK = {
  claude: [215, 119, 87],
  shimmer: [235, 159, 127],
  warning: [255, 193, 7],
} as const;
const SPINNER_LIGHT = {
  claude: [215, 119, 87],
  shimmer: [245, 149, 117],
  warning: [150, 108, 30],
} as const;
const STALL_RED: Rgb = [171, 43, 63];
const WORD_GREY_LO: Rgb = [153, 153, 153];
const WORD_GREY_HI: Rgb = [185, 185, 185];
const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1);
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const cssRgb = (c: Rgb): string => `rgb(${c[0]},${c[1]},${c[2]})`;
/** Dark page or light, from the body's own background: dsh keeps its theme in CSS variables and
 *  exposes no flag, and the luminance of what is actually painted is what the eye compares to. */
const pageIsDark = (): boolean => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor);
  if (!m) return true;
  return (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000 < 128;
};
/** The CLI's ramps: nothing for the first 10s, then linear to full over the next 10s. */
const rampAfter10s = (ms: number): number => clamp01((ms - 10_000) / 10_000);
/** One 50ms step of the CLI's count easing, in characters (tokens × 4): small gaps close by 3,
 *  middling ones by 15%, large ones by 50, and a gap past 2000 snaps. */
const easeChars = (shown: number, target: number): number => {
  const gap = target - shown;
  if (gap === 0) return shown;
  const abs = Math.abs(gap);
  if (abs > 2000) return target;
  const step = abs < 70 ? 3 : abs < 200 ? Math.max(8, Math.ceil(abs * 0.15)) : 50;
  return gap > 0 ? Math.min(shown + step, target) : Math.max(shown - step, target);
};
const noBeat = (): void => undefined;
const wireTurnStatus = (
  el: HTMLElement,
  sessionId: string,
  verbs: string[],
  frames: readonly string[],
) => {
  ensureTurnStatusStyle();
  if (el.hasAttribute(TURN_MARK)) return;
  el.setAttribute(TURN_MARK, "1");

  // Build the leading spinner span.
  const spinner = document.createElement("span");
  spinner.setAttribute("aria-hidden", "true");
  el.prepend(spinner);

  // Find the original text node (first child before the clock span).
  const textNode = Array.from(el.childNodes).find(
    (n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim().length,
  );

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** The figure and colour beat, assigned once the row's state exists below. */
  let onTick: () => void = noBeat;
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
  const stop = () => {
    clearInterval(interval);
    clearInterval(pollTimer);
    obs.disconnect();
  };
  const interval = setInterval(
    () => {
      // The beat doubles as the teardown check: React unmounts this row by removing an
      // ancestor, so watching for `el` itself in a removal record missed it and left one
      // whole-document observer plus one interval alive per row dsh ever drew.
      if (!el.isConnected) {
        stop();
        return;
      }
      tick();
      onTick();
    },
    // A reduced-motion spinner is one glyph that never changes, so its beat is the teardown check
    // and nothing else; 1s notices an unmounted row soon enough at an eighth of the wakeups.
    reduced ? 1000 : 120,
  );
  // The row can outlive the bundle that wired it — a rebuild disposes the context while the turn is
  // still running — and a connected row never trips the check above, so each reload used to leave
  // one more beat animating the same spinner. The wired mark and the spinner go back with it: both
  // live on dsh's element, which outlives this bundle, and a row still wearing the mark is one the
  // next bundle refuses to wire.
  whenContextGone(() => {
    stop();
    el.removeAttribute(TURN_MARK);
    spinner.remove();
  });
  tick();

  // Pick a fresh verb once per element instance.
  const verb = verbFor(sessionId, verbs);
  // The row reads `Marinating… · ↓ 1.2k · thinking` once the turn has figures, the way the CLI's own
  // status line does; dsh's clock beside it is left alone. The figures come from the plugin's
  // live-turn route, polled once a second while this row is up: the browser never sees the CLI
  // stream, so the adapter keeps the running count and this asks for it.
  const verbLabel = `${verb}…`;
  if (textNode) textNode.nodeValue = verbLabel;
  // Everything after the verb sits in one quiet bracket, the way the CLI's status line writes it.
  for (const stale of Array.from(el.querySelectorAll(`[${DETAIL_MARK}]`))) stale.remove();
  const detailSpan = document.createElement("span");
  detailSpan.setAttribute(DETAIL_MARK, "1");
  // Important, because the row's own rule paints the whole status line in the brand colour and a
  // plain inline colour loses to it: the bracket came out orange with the verb.
  // Out of the row's painted gradient, then into a plain grey. The row is coloured by clipping a
  // background to its text, so the glyphs take that gradient and ignore any `color` set on them:
  // setting the colour alone, even important, left the bracket orange alongside the verb.
  detailSpan.style.setProperty("background-image", "none", "important");
  detailSpan.style.setProperty("background-clip", "border-box", "important");
  detailSpan.style.setProperty("-webkit-background-clip", "border-box", "important");
  detailSpan.style.setProperty("color", T.faint, "important");
  // The one that actually decides it: with the background clipped to the text, the glyphs are filled
  // from that background and `color` is ignored, so the fill colour is what has to be set.
  detailSpan.style.setProperty("-webkit-text-fill-color", T.faint, "important");
  // The clock's face from the first paint: dsh adds its clock node a moment after the row, and
  // the copy below only lands once it exists, so the bracket opened at the row's 16px medium and
  // shrank a beat later (owner, 2026-09-13). The clock measures 14px regular against the row's
  // 16px, hence the ratio; the copy still takes over the moment the node is there.
  detailSpan.style.fontSize = "0.875em";
  detailSpan.style.fontWeight = "400";
  el.append(detailSpan);
  /** dsh's own elapsed-time node. Found, not hidden: the time belongs inside the bracket, but hiding
   *  it as a side effect of looking meant one failed read left the row showing no time at all. */
  const clockNode = (): HTMLElement | undefined => {
    for (const child of Array.from(el.children)) {
      if (child === spinner || child === detailSpan) continue;
      const text = (child.textContent ?? "").trim();
      if (/^\d+\s*[hms]/.test(text) && child instanceof HTMLElement) return child;
    }
    return undefined;
  };
  // The figures the route last reported, and when, so the beat can carry them forward between
  // polls: the burst and stall ages grow with the clock, the count eases toward its target.
  let polledAt = 0;
  let targetChars = 0;
  let thinkingMs = -1;
  let idleMs = -1;
  let tool = false;
  let thoughtMs = -1;
  let thoughtAgoMs = -1;
  let effort = "";
  // What is on screen: the eased count in characters (the CLI eases its response length, and
  // shows it over four) and the two colour ramps, each chased 10% per 50ms like the CLI does.
  let shownChars = 0;
  let thinkIntensity = 0;
  let stallIntensity = 0;
  let lastBeat = Date.now();
  const palette = pageIsDark() ? SPINNER_DARK : SPINNER_LIGHT;
  /** What the bracket last showed, so a beat that changes nothing writes nothing. */
  let painted = "";
  /** Whether the bracket has taken the clock's measured face yet (the guess above until then). */
  let clockFaceCopied = false;
  const wordNode = document.createElement("span");
  wordNode.setAttribute("data-omc-turn-word", "1");
  const paint = () => {
    const now = Date.now();
    const since = polledAt > 0 ? now - polledAt : 0;
    const burst = thinkingMs >= 0 ? thinkingMs + since : -1;
    const idle = idleMs >= 0 ? idleMs + since : -1;
    // The CLI holds both ramps at zero while a tool runs, and the stall ramp while thinking: a
    // running tool is silence by design, and thinking has its own ramp.
    const thinkTarget = burst >= 0 && !tool ? rampAfter10s(burst) : 0;
    const stallTarget = burst < 0 && !tool && idle >= 0 ? rampAfter10s(idle) : 0;
    if (reduced) {
      thinkIntensity = thinkTarget;
      stallIntensity = stallTarget;
      shownChars = targetChars;
    } else {
      const steps = Math.floor((now - lastBeat) / 50);
      if (steps > 0) {
        for (let i = 0; i < steps; i++) {
          thinkIntensity += (thinkTarget - thinkIntensity) * 0.1;
          stallIntensity += (stallTarget - stallIntensity) * 0.1;
          shownChars = easeChars(shownChars, targetChars);
        }
        lastBeat += steps * 50;
      }
    }
    // Snap to the target once within a hair of it, so the memo key settles.
    if (Math.abs(thinkTarget - thinkIntensity) < 0.01) thinkIntensity = thinkTarget;
    if (Math.abs(stallTarget - stallIntensity) < 0.01) stallIntensity = stallTarget;
    const ti = thinkIntensity;
    const si = stallIntensity;
    const parts: string[] = [];
    const clock = clockNode();
    // The bracket wears dsh's own clock face, read off its node rather than assumed: the row's
    // verb is 16px medium and the clock dsh set beside it 14px regular (measured 2026-09-12),
    // and a bracket at the verb's size read heavier than the verb it follows.
    if (clock && !clockFaceCopied) {
      clockFaceCopied = true;
      const face = getComputedStyle(clock);
      detailSpan.style.fontSize = face.fontSize;
      detailSpan.style.fontWeight = face.fontWeight;
    }
    const time = (clock?.textContent ?? "").trim();
    if (time) parts.push(time);
    // dsh's copy goes quiet only while ours is showing the same figure. Hiding it unconditionally is
    // what left the row reading just the verb when the read came back empty.
    if (clock) clock.style.display = time ? "none" : "";
    const shownTokens = Math.round(shownChars / 4);
    if (shownTokens > 0) parts.push(`↓ ${shortCount(shownTokens)} tokens`);
    // The CLI names the effort after the word when one was asked for, and once a burst closes
    // it says "thought for Ns" for two seconds, never sooner than two seconds after the burst
    // began.
    let word = "";
    if (burst >= 0) word = `${thinkingWord(burst)}${effort ? ` with ${effort} effort` : ""}`;
    else if (thoughtAgoMs >= 0) {
      const closedFor = thoughtAgoMs + since;
      const showAt = Math.max(0, 2000 - thoughtMs);
      if (closedFor >= showAt && closedFor < showAt + 2000)
        word = `thought for ${Math.max(1, Math.round(thoughtMs / 1000))}s`;
    }
    const thinking = burst >= 0;
    // The CLI's colours. Verb and spinner: Claude orange, toward the warning shade by the thinking
    // ramp, toward its stall red by the stall ramp; the spinner goes bold past half. The word:
    // a slow grey pulse, itself pulled toward the warning shade by the thinking ramp. Time, count
    // and the brackets stay dim. Once either ramp is above zero the verb is one flat colour, no
    // shimmer: the CLI's glimmer only draws when neither ramp is up.
    const claude = accentRgb(palette.claude);
    const tint =
      ti > 0
        ? mixRgb(claude, palette.warning, ti)
        : si > 0
          ? mixRgb(claude, STALL_RED, si)
          : undefined;
    const lo = cssRgb(mixRgb(WORD_GREY_LO, palette.warning, ti));
    const hi = cssRgb(mixRgb(WORD_GREY_HI, palette.warning, ti));
    const key = `${parts.join("\0")}\0${word}\0${cssRgb(claude)}\0${tint ? cssRgb(tint) : ""}\0${lo}\0${hi}\0${ti >= 0.5}`;
    if (key === painted) return;
    painted = key;
    if (tint)
      el.style.setProperty(
        "--omc-row-bg",
        `linear-gradient(90deg,${cssRgb(tint)},${cssRgb(tint)})`,
      );
    else el.style.removeProperty("--omc-row-bg");
    spinner.style.fontWeight = ti >= 0.5 ? "bold" : "";
    if (word) {
      detailSpan.textContent = "";
      detailSpan.append(`\u00A0(${parts.join(" · ")}${parts.length > 0 ? " · " : ""}`);
      wordNode.textContent = word;
      if (thinking) {
        // The grey pulse, pulled toward the warning shade by the ramp.
        wordNode.setAttribute("data-omc-turn-word", "1");
        wordNode.style.setProperty("--omc-word-lo", lo);
        wordNode.style.setProperty("--omc-word-hi", hi);
        wordNode.style.setProperty("-webkit-text-fill-color", lo, "important");
      } else {
        // "thought for Ns": the warning shade while the ramp is still fading, dim after.
        wordNode.removeAttribute("data-omc-turn-word");
        const c = ti > 0 ? cssRgb(palette.warning) : T.faint;
        wordNode.style.setProperty("-webkit-text-fill-color", c, "important");
      }
      detailSpan.append(wordNode, ")");
      return;
    }
    // A non-breaking space, written as its escape so a rewrite cannot quietly turn it into an
    // ordinary one: at the edge of the element an ordinary space collapses away, which ran the
    // bracket straight into the verb.
    detailSpan.textContent = parts.length > 0 ? `\u00A0(${parts.join(" · ")})` : "";
  };
  const poll = async () => {
    // A hidden tab paints nothing, so its read would be a round trip for no one; the next beat
    // after it is shown again catches up.
    if (!el.isConnected || document.hidden) return;
    try {
      const r = await fetch(`${ROUTE}/live-turn?session=${encodeURIComponent(sessionId)}`);
      const b = await readJson<{
        tokens?: number;
        thinkingMs?: number;
        idleMs?: number;
        tool?: boolean;
        thoughtMs?: number;
        thoughtAgoMs?: number;
        effort?: string;
      }>(r);
      targetChars = (b.tokens ?? 0) * 4;
      // The ages come from the adapter, which saw the block open and the last frame land; a tab
      // that opens mid-think would otherwise start its own clocks late.
      thinkingMs = b.thinkingMs ?? -1;
      idleMs = b.idleMs ?? -1;
      tool = b.tool === true;
      thoughtMs = b.thoughtMs ?? -1;
      thoughtAgoMs = b.thoughtAgoMs ?? -1;
      effort = b.effort ?? "";
      polledAt = Date.now();
    } catch {
      // the row keeps its verb; the bracket is decoration
    }
    paint();
  };
  const pollTimer = setInterval(() => void poll(), 1000);
  onTick = paint;
  void poll();
  paint();

  // Re-apply when dsh resets the verb's text node. Observed on that node alone: watching the whole
  // row with subtree fired the callback on every clock tick and on every write of ours, and the
  // handler only ever looked at this one node anyway.
  const obs = new MutationObserver(() => {
    if (textNode && textNode.nodeValue !== verbLabel) textNode.nodeValue = verbLabel;
  });
  if (textNode) obs.observe(textNode, { characterData: true });
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
  let recapPending: Record<string, number> = {};
  // The recap's two settings, kept beside the tick rather than read in it: the tick is synchronous
  // and the store is a fetch. Re-read on the same event the settings switches dispatch, so flipping
  // the switch reaches this watcher without a reload.
  let hints: Record<string, boolean | number> = {};
  const readHints = () => void loadHints().then((h) => (hints = h));
  readHints();
  window.addEventListener(HINTS_EVENT, readHints);
  whenContextGone(() => window.removeEventListener(HINTS_EVENT, readHints));
  const tick = () => {
    const snap = ctx.sessions.list.getSnapshot();
    if (!snap) return;
    // Copy the compared fields into fresh rows: dsh's store may reuse row objects between calls, and
    // a shared reference would make every field read `was === now`, so no transition would ever fire.
    const byId: NoticeSnapshot["byId"] = {};
    for (const [id, s] of Object.entries(snap.byId))
      byId[id] = { running: s.running, completed: s.completed, displayTitle: s.displayTitle };
    const next: NoticeSnapshot = { byId, current: snap.current };
    const stopped = newlyWaiting(prev, next).filter((id) => isClaudeSession(ctx, id));
    for (const id of stopped) {
      waiting.add(id);
      notifyWaiting(ctx, id, snap.byId[id]?.displayTitle ?? id);
    }
    prev = next;
    // Return recap: a session that stopped working while it was not the one on screen is asked for
    // one line when it is opened. Off by default; the switch is in Settings, under Oh My Claude.
    // `recapNext` clears the id as it fires, so a return asks once and a second open of the
    // same session asks nothing. Two things this accepts on purpose: the queue is cleared before
    // `recapOn()` is read, so turning the switch on mid-session waits for the next return rather than
    // firing for a session that already came back, and the fire trusts `snap.current` for the tick it
    // runs in, so a current that lags the screen by a tick can bill a recap for a session nobody left.
    // A spurious title mark is free; a spurious recap is a model call, which is why the switch is off
    // until asked for.
    const step = recapNext(
      recapPending,
      stopped,
      snap.current,
      Date.now(),
      recapAwayIn(hints.recapAwayMs),
    );
    recapPending = step.pending;
    // Three reasons not to spend the call, all of them the CLI's own: the switch is off, there is
    // half a prompt in the composer so the person is already saying what they want, or the session
    // picked up a new turn while the tick was deciding and the recap would describe stale work.
    if (
      step.fire !== undefined &&
      recapOnIn(hints) &&
      !draftPending() &&
      snap.byId[step.fire]?.running !== true
    ) {
      const session = step.fire;
      void fetch(`${ROUTE}/side-questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, question: RECAP_QUESTION }),
      }).catch(() => {
        // A recap nobody typed stays quiet when it fails. The route refuses before the ring is
        // touched when there is no live process, so there is nothing to clean up here either.
      });
    }
    // Reading it clears it: the open session, and everything else once the tab is looked at again.
    if (snap.current !== undefined) waiting.delete(snap.current);
    if (!document.hidden) waiting.clear();
    const wanted = markTitle(document.title, waiting.size);
    if (wanted !== document.title) document.title = wanted;
  };
  tick(); // take the baseline now, so the first interval already has something to compare against
  const beat = setInterval(guard(tick), 1000);
  whenContextGone(() => clearInterval(beat));
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
  const beat = setInterval(guard(markBody), 1000);
  whenContextGone(() => clearInterval(beat));
  const attach = (el: HTMLElement) => {
    // Only act on [role="status"][aria-live="polite"] (dsh's turn-status element).
    if (el.getAttribute("role") !== "status" || el.getAttribute("aria-live") !== "polite") return;
    // The wired mark is read here rather than inside `wireTurnStatus`: everything below allocates a
    // promise, and this runs for every status element on every dirty frame of a running turn.
    if (el.hasAttribute(TURN_MARK)) return;
    const activeId = activeClaudeSession(ctx);
    if (!activeId) return;
    if (!hasTheme("row")) return; // the Claude look's status row is off: dsh's own text stays
    spinnerSettings ??= loadSpinnerSettings(); // once per page load
    // The settings load once and resolve for good, so this is a microtask after the first frame —
    // but the await used to be unhandled, so a throw inside `wireTurnStatus` became a rejection
    // `guard` never saw: the spinner simply never appeared, with nothing on the console to say why.
    void spinnerSettings.then((settings) => {
      if (el.isConnected) wireTurnStatus(el, activeId, settings.verbs, settings.frameSet);
    }, console.error);
  };
  const scan = (root: HTMLElement) => {
    attach(root);
    for (const el of root.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"]'))
      attach(el);
  };
  // Once per dirty frame, and the cheapest check comes first: on a session that is not a Claude
  // mount there is nothing to attach, so bail before the querySelectorAll. attach is idempotent
  // (the status row carries a data-attr once wired), so re-scanning the body each frame is safe.
  onBodyMutation((records) => {
    if (!activeClaudeSession(ctx)) return;
    if (records === undefined) return scan(document.body);
    for (const node of changedElements(records)) scan(node);
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
const inComposer = (node: Element, box: Element | null): boolean => {
  // `contains` per level, against a message box the caller looked up once. The walk used to run a
  // fresh subtree query at every ancestor, which is the whole document by the time it reaches the
  // top; the query then moved out here, and now out again to the scan, which checks several
  // buttons per pass and was paying for one lookup each.
  if (box === null) return false;
  for (let p = node.parentElement; p && p !== document.body; p = p.parentElement)
    if (p.contains(box)) return true;
  return false;
};

/** The CLI's rainbow for the word `ultrathink` (2.1.268, `ZT` over the `rainbow_*` theme entries,
 *  the same seven values in all four themes): each character of the word takes the next colour,
 *  wrapping after violet. Only that one word, `\bultrathink\b` case-insensitive; `ultracode`,
 *  `ultraplan` and `ultrareview` are other features and draw nothing. It is painted in the
 *  composer as it is typed and in the sent message. */
const RAINBOW: readonly string[] = [
  "rgb(235,95,87)",
  "rgb(245,139,87)",
  "rgb(250,195,95)",
  "rgb(145,200,130)",
  "rgb(130,170,220)",
  "rgb(155,130,200)",
  "rgb(200,130,180)",
];
/** The `rainbow_*_shimmer` entries: what a character shows while the composer's sweep is on it. */
const RAINBOW_SHIMMER: readonly string[] = [
  "rgb(250,155,147)",
  "rgb(255,185,137)",
  "rgb(255,225,155)",
  "rgb(185,230,180)",
  "rgb(180,205,240)",
  "rgb(195,180,230)",
  "rgb(230,180,210)",
];
/** `ultracode` in the composer takes the CLI's `autoAccept` purple (dark rgb(175,135,255), light
 *  rgb(135,0,255)) with the one `autoAcceptShimmer` for both, under the same sweep. It opts the
 *  turn into the Workflow tool's multi-agent orchestration when workflows are on; the CLI's chat
 *  never colours it, only the composer does. The light value rides a custom property set on the
 *  root, since a highlight rule cannot read the page's theme itself. */
const ULTRACODE_DARK = "rgb(175,135,255)";
const ULTRACODE_LIGHT = "rgb(135,0,255)";
const ULTRACODE_SHIMMER = "rgb(208,180,255)";
const ULTRACODE_INDEX = RAINBOW.length;
const RAINBOW_CSS =
  RAINBOW.map((c, i) => `::highlight(omc-rainbow-${i}){color:${c}}`).join("") +
  RAINBOW_SHIMMER.map((c, i) => `::highlight(omc-rainbow-s${i}){color:${c}}`).join("") +
  `::highlight(omc-rainbow-${ULTRACODE_INDEX}){color:var(--omc-ultracode,${ULTRACODE_DARK})}` +
  `::highlight(omc-rainbow-s${ULTRACODE_INDEX}){color:${ULTRACODE_SHIMMER}}`;
const ULTRATHINK = /\bultrathink\b/gi;
/** One character of a match: where it sits, which colour it takes, and its index in the
 *  composer's text (the sweep runs over those indices, as the CLI's does over its input string). */
interface RainbowChar {
  node: Node;
  offset: number;
  colour: number;
  index: number;
}

const rangeOf = (c: RainbowChar): Range => {
  const r = document.createRange();
  r.setStart(c.node, c.offset);
  r.setEnd(c.node, c.offset + 1);
  return r;
};

/**
 * Paint `ultrathink` in the CLI's rainbow wherever a person wrote it: the composer and the sent
 * user messages. Done with the CSS Highlight API, ranges over the existing text nodes, so neither
 * dsh's chat (React) nor its composer (Lexical) sees a DOM change; wrapping characters in spans
 * would have been undone by the next render of either, or thrown when it reconciled a node that
 * had moved. Both hosts are found by their own data attributes.
 *
 * The composer also gets the CLI's shimmer (its text input's `glimmerIndex`): a window of three
 * characters, lit in the shimmer shades, that steps one character every 50ms from ten before the
 * first match to ten past the last and wraps. Sent messages never shimmer, as in the CLI.
 */
function watchUltrathink(ctx: ClientCtx) {
  // A browser without the Highlight API paints nothing; every Chromium since 105 has it.
  if (!("highlights" in CSS) || !("Highlight" in globalThis)) return;
  const registry = CSS.highlights;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const colours = RAINBOW.length + 1; // the seven, then ultracode's purple
  const names = Array.from({ length: colours }, (_, i) => `omc-rainbow-${i}`);
  const shimmerNames = Array.from({ length: colours }, (_, i) => `omc-rainbow-s${i}`);
  if (!pageIsDark()) document.documentElement.style.setProperty("--omc-ultracode", ULTRACODE_LIGHT);
  // A message sent mid-turn waits under `data-pending-steering` until the CLI takes it, and only
  // then becomes an input-message anchor; it is a person's words either way, so both are hosts.
  const HOSTS =
    '[data-composer-input], [data-pending-steering], [data-chat-anchor-key*=":input-message"]';
  const clear = () => {
    for (const key of [...names, ...shimmerNames]) registry.delete(key);
  };
  const charsIn = (host: Element, isComposer: boolean): RainbowChar[] => {
    const out: RainbowChar[] = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let base = 0;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      if (text.includes("ltrathink") || text.includes("LTRATHINK"))
        for (const m of text.matchAll(ULTRATHINK))
          for (let i = 0; i < m[0].length; i++)
            out.push({
              node,
              offset: m.index + i,
              colour: i % RAINBOW.length,
              index: base + m.index + i,
            });
      if (isComposer && (text.includes("ltracode") || text.includes("LTRACODE")))
        for (const m of keywordMatches(text, "ultracode"))
          for (let i = m.start; i < m.end; i++)
            out.push({ node, offset: i, colour: ULTRACODE_INDEX, index: base + i });
      base += text.length;
    }
    return out;
  };
  // The composer's characters, kept for the sweep; the sweep's window and length come from them.
  let composer: RainbowChar[] = [];
  let sweepStart = 0;
  let cycle = 1;
  let tick = 0;
  let sweep: ReturnType<typeof setInterval> | undefined;
  const paintSweep = () => {
    const at = sweepStart + (tick % cycle);
    const lit: RainbowChar[][] = names.map(() => []);
    for (const c of composer) if (Math.abs(c.index - at) <= 1) lit[c.colour]!.push(c);
    shimmerNames.forEach((key, i) => {
      const cs = lit[i]!;
      if (cs.length === 0) registry.delete(key);
      else {
        const h = new Highlight(...cs.map(rangeOf));
        h.priority = 1; // over the base colour of the same character
        registry.set(key, h);
      }
    });
  };
  const stopSweep = () => {
    if (sweep !== undefined) clearInterval(sweep);
    sweep = undefined;
    for (const key of shimmerNames) registry.delete(key);
  };
  const scan = () => {
    if (document.hidden) {
      stopSweep();
      return;
    }
    if (activeClaudeSession(ctx) === undefined || !hasTheme("rainbow")) {
      stopSweep();
      clear();
      return;
    }
    const buckets: RainbowChar[][] = names.map(() => []);
    composer = [];
    for (const host of document.querySelectorAll<HTMLElement>(HOSTS)) {
      const isComposer = host.hasAttribute("data-composer-input");
      const cs = charsIn(host, isComposer);
      if (isComposer) composer.push(...cs);
      for (const c of cs) buckets[c.colour]!.push(c);
    }
    names.forEach((key, i) => {
      const cs = buckets[i]!;
      if (cs.length === 0) registry.delete(key);
      else registry.set(key, new Highlight(...cs.map(rangeOf)));
    });
    if (composer.length === 0 || reduced) {
      stopSweep();
      return;
    }
    const first = Math.min(...composer.map((c) => c.index));
    const last = Math.max(...composer.map((c) => c.index)) + 1;
    sweepStart = first - 10;
    cycle = last - first + 20;
    if (sweep === undefined) {
      tick = 0;
      sweep = setInterval(() => {
        tick++;
        guard(paintSweep)();
      }, 50);
    }
    paintSweep();
  };
  // The composer changes on every keystroke and the chat on every message; both are observed
  // rather than polled, with the pass folded to one per frame. The observer has to sit on the
  // body (dsh remounts the chat and the composer), but a streaming reply mutates the document
  // many times a second, so only a change inside a host, or one that adds a host, asks for a
  // pass; the rest is dropped before any walking happens.
  let queued = false;
  const request = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      guard(scan)();
    });
  };
  const touchesHost = (records: MutationRecord[]): boolean => {
    for (const r of records) {
      const el = r.target instanceof Element ? r.target : r.target.parentElement;
      if (el?.closest(HOSTS)) return true;
      for (const n of r.addedNodes)
        if (n instanceof Element && (n.matches(HOSTS) || n.querySelector(HOSTS))) return true;
    }
    return false;
  };
  const obs = new MutationObserver((records) => {
    if (touchesHost(records)) request();
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("input", request, true);
  document.addEventListener("visibilitychange", request);
  request();
  whenContextGone(() => {
    obs.disconnect();
    document.removeEventListener("input", request, true);
    document.removeEventListener("visibilitychange", request);
    stopSweep();
    clear();
  });
}

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
    // A hidden tab is not being looked at, and this pass is two document-wide queries a second. The
    // visibility listener below runs it once the moment the tab comes back.
    if (document.hidden) return;
    const claude = claudeRunningTitles();
    // Every other ongoing matrix square — the job-list dot in the session header, and the same dot
    // dsh shows for subagents, plans and schedules — renders inside the open conversation, so it
    // belongs to whichever session is open. Tint those when that session is a Claude mount.
    const openClaude = activeClaudeSession(ctx) !== undefined;
    const openIsClaude = openClaude && hasTheme("row");
    for (const dot of document.querySelectorAll<SVGElement>('svg[data-state="ongoing"]')) {
      const inRow = dot.closest('[role="treeitem"]'); // a sidebar session row vs a dot elsewhere
      let want: boolean;
      if (inRow) {
        const title = spinnerRowTitle(dot);
        want = title !== null && claude.has(title) && hasTheme("row");
      } else {
        want = openIsClaude;
      }
      if (want) {
        dot.style.color = ACCENT;
        dot.setAttribute(MARK, "1");
      } else if (dot.hasAttribute(MARK)) {
        dot.style.color = "";
        dot.removeAttribute(MARK);
      }
    }
    // The composer's send/stop button (one button, aria-label toggles). dsh fills it from
    // `--dsw-alias-button-info-*`; overriding those two vars on the button recolours both the base
    // and hover states in one place, and clearing them hands it back to dsh's blue on the next pass.
    // One message-box lookup for the pass: `inComposer` is asked about every primary button dsh
    // draws, and each ask used to run its own subtree query for the same element.
    const box = document.querySelector("[contenteditable]");
    for (const sendBtn of document.querySelectorAll<HTMLElement>('button[class*="_primary"]')) {
      const sendWant = openClaude && hasTheme("send") && inComposer(sendBtn, box);
      if (sendWant) {
        sendBtn.style.setProperty("--dsw-alias-button-info-fill", ACCENT);
        sendBtn.style.setProperty("--dsw-alias-button-info-hover", SHIMMER);
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
  const beat = setInterval(guard(scan), 1000);
  const wake = guard(scan);
  document.addEventListener("visibilitychange", wake);
  whenContextGone(() => {
    clearInterval(beat);
    document.removeEventListener("visibilitychange", wake);
  });
}

/** Fold a native-tool code block into a one-line disclosure. dsh renders a tool step as a `<p>` whose
 *  text is an icon plus the tool's name (`❯ Bash`, `▤ Read` — set by the translator) followed by its
 *  `.md-code-block` fence, both children of `._markdown`. Collapsed, the fence hides; hovering the
 *  header swaps its icon for dsh's chevron, and clicking toggles it. The marker is the leading glyph:
 *  only a header that starts with one of the translator's tool icons folds, so Claude's own prose code
 *  blocks are left alone. Kept in sync with the translator's TOOL_ICON set. */
const TOOL_ICONS = "❯▤✎⌕✳⤓☑⚙☰⌘◆";
/** The invisible word joiner the translator writes after the glyph (`HEADER_MARK` there), stripped
 *  with the glyph when it is there.
 *
 *  It cannot be demanded outright: a dsh process holds the server half of this plugin in memory
 *  until it restarts, while `lib/client.js` reloads into the open tab the moment it is built, so a
 *  client that required the mark unfolded every header the running build was still writing (#234).
 *  So the page says which it is. Until a marked header has been seen, the glyph alone claims a
 *  paragraph, exactly as before; from the first marked one on, the running server writes marks and
 *  a bare glyph is prose \u2014 a pasted `\u276f npm test` keeps its glyph and the block under it stays open.
 *  A header already claimed keeps its fold either way, so the switch never reopens what is on screen. */
const FOLD_MARK = "\u2060";
/** Whether this page has seen the mark, which is what tells the two halves apart. */
let markedHeaders = false;
const HEAD_MARK = "data-omc-tool"; // on the header <p>: "1" collapsed · "open" expanded · "flat" no fence
const LEAD_MARK = "data-omc-lead"; // on the span that replaces the glyph: the sprite key it carries
const SPRITE_MARK = "data-omc-sprite"; // on each hidden sprite: its key

/** The translator's glyph mapped to the dsh icon that stands for the same tool in its own tool cards
 *  (`VARIANT_ICONS` in dsh-client-ui-tool). Reusing dsh's art keeps a Claude tool header and a dsh tool
 *  row visually the same family instead of inventing a second icon set. `chevron` is the disclosure
 *  marker; dsh's tool rows use the same one, unrotated. */
const SPRITES = {
  "❯": IconApiOutline14,
  "▤": IconBrowseOutline16,
  "✎": IconEditOutline16,
  "⌕": IconSearchOutline16,
  "✳": IconCodeOutline16,
  "⤓": IconBrowseOutline16,
  "☑": IconChecklistOutline14,
  "⚙": IconAgentPresetOutline16,
  "☰": IconListPenOutline16,
  "⌘": IconSkillOutline16,
  "◆": IconSparkle16,
  chevron: IconChevronDownOutline14,
} satisfies Record<string, FC<{ size?: number }>>;

/** The hidden sprite sheet: one rendered copy of each dsh icon, cloned into the tool headers by the
 *  fold scan. Rendering them as ordinary children of a mounted component is what lets this plugin use
 *  dsh's React icons from plain DOM code — no react-dom import, no portal, and the sheet costs one
 *  hidden div per session. */
function ToolIconSprites() {
  return (
    <span hidden>
      {Object.entries(SPRITES).map(([key, Icon]) => (
        <span key={key} {...{ [SPRITE_MARK]: key }}>
          <Icon size={14} />
        </span>
      ))}
    </span>
  );
}

const ensureFoldStyle = () => {
  // Reuse the element but always rewrite it. A hot reload drops a new bundle into a page that still
  // carries the previous one's sheet, so returning early here left the old rules in force and the new
  // build's markup styled by them — which looks like the feature half-shipped until the tab is
  // reloaded by hand.
  const existing = document.getElementById("dsh-oh-my-claude-fold");
  const el = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  el.id = "dsh-oh-my-claude-fold";
  // The header reads as dsh's muted tool text — its secondary content size and label colour — and sits
  // flush-left like any prose line. The leading span is a fixed 16px box holding both glyphs stacked, so the row never
  // shifts: the tool icon is the resting state and the chevron sits on top of it at opacity 0, the two
  // cross-fading on hover. This is how dsh draws its own tool rows (`iconIdle`/`chevronHover` in
  // dsh-client-ui-tool), down to the secondary label colour, and the chevron never rotates — expanding
  // is shown by the fence appearing, not by the marker turning. A `flat` header has no fence under it
  // (`▤ Read \`path\`` is the whole step), so it takes the muted type and the icon but neither the
  // pointer nor the chevron: there is nothing to disclose. The `body` prefix stays out of `lead` on
  // purpose — pasted into a descendant position it would read as a `body` inside a `p` and match
  // nothing, which is what silently killed the hover swap.
  const head = `body[data-omc-claude] p[${HEAD_MARK}]`;
  const fold = `${head}:not([${HEAD_MARK}="flat"])`;
  const lead = `span[${LEAD_MARK}]`;
  // Metrics copied from dsh's own row rather than approximated: a 16px leading box, a 14px icon inside
  // it, a 6px gap to the title, and both sizes carrying `--dsh-content-font-delta` so the header grows
  // with the user's content font size the way a dsh tool row does. Fixed pixels made ours read a hair
  // small for anyone who raised that setting. Colour comes from the same tokens: tertiary for the
  // icon, secondary for the text and the chevron.
  //
  // Vertical centring is the fiddly part. `vertical-align:middle` centres on the baseline plus half
  // the x-height, which sits about a pixel below the middle of the capitals, so the icon read low next
  // to the title. The box is centred on cap height instead: both glyphs are absolutely positioned, so
  // the box has no in-flow content and its baseline is its own bottom edge, and a length
  // `vertical-align` then places that edge exactly. `cap` is the right unit for it; the `em`
  // approximation above it is the fallback for a browser without `cap` units, where the whole
  // declaration would otherwise be dropped and the icon would sit on the baseline.
  const box = "calc(16px + var(--dsh-content-font-delta,0px))";
  const glyphSize = "calc(14px + var(--dsh-content-font-delta,0px))";
  const half = "8px - var(--dsh-content-font-delta,0px)/2"; // half the leading box, for the baseline offset
  el.textContent = [
    // The hanging indent keeps a wrapped header (a long URL, a long grep pattern) lined up under its
    // own text rather than back under the icon. `user-select` is off for a folding header, where a
    // drag is a mis-click on a control, but stays on for a flat one: `▤ Read \`path\`` is a whole step
    // and the path is the thing worth copying out of it.
    // The line has to clear the leading box: dsh's paragraph line-height is set from a 13px font, and
    // a 16px icon sitting in it puts the glyph into the row above.
    `${head}{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(${box} + 4px);color:var(--dsw-alias-label-secondary);padding-left:calc(${box} + 6px);text-indent:calc(0px - ${box} - 6px);margin-bottom:4px}`,
    // `text-indent` inherits, and dsh renders inline code as an inline-block — a block container, so
    // the hanging indent applies a second time inside the chip and drags the path left over the verb.
    `${head} *{text-indent:0}`,
    `${fold}{cursor:pointer;user-select:none}`,
    `${fold}:focus-visible{outline:1px solid var(--dsw-alias-label-tertiary);outline-offset:2px;border-radius:4px}`,
    `${head} ${lead}{position:relative;display:inline-block;width:${box};height:${box};margin-right:6px;color:var(--dsw-alias-label-tertiary);vertical-align:calc(.36em - ${half});vertical-align:calc(.5cap - ${half})}`,
    `${head} ${lead} svg{width:${glyphSize};height:${glyphSize}}`,
    `${head} ${lead}>[data-omc-part]{position:absolute;inset:0;display:inline-flex;align-items:center;justify-content:center;transition:opacity .1s}`,
    `${head} ${lead}>[data-omc-part="chevron"]{opacity:0;color:var(--dsw-alias-label-secondary)}`,
    `${fold}:hover ${lead}>[data-omc-part="icon"]{opacity:0}`,
    `${fold}:hover ${lead}>[data-omc-part="chevron"]{opacity:1}`,
    // The dot between the tool's name and its summary is dsh's own: a 2 px square in the caption
    // colour with 8 px either side, and the summary in the tertiary colour, so a row this plugin
    // writes reads like the rows dsh draws for its own tools.
    `${head}>[data-omc-part="sep"]{display:inline-block;width:2px;height:2px;border-radius:1px;background:var(--dsw-alias-label-caption);margin:0 8px;vertical-align:middle}`,
    `${head}>[data-omc-part="summary"]{color:var(--dsw-alias-label-tertiary)}`,
    // A path in a header is dsh's file link, not a code chip: no fill, the row's own type, the
    // summary colour. The chip keeps its look everywhere else in the answer.
    `${head}>code{background:none;border:0;padding:0;font-family:inherit;font-size:inherit;color:var(--dsw-alias-label-tertiary)}`,
    `${head}[${HEAD_MARK}="1"]+.md-code-block{display:none}`,
    // Rows stack the way dsh's own tool rows do: one tight step between rows rather than a
    // paragraph's worth, and an expanded block sits against the header it belongs to. The step has
    // to be the header's own `margin-bottom`: dsh wraps each row in its own markdown container, so
    // two rows are never siblings and a `+` rule between them can never match — that margin
    // collapses through the wrapper and is the whole gap. Zero it and the rows sit flush.
    `${head}+.md-code-block{margin-top:4px;margin-bottom:0}`,
    `${head}+.md-code-block+${head}{margin-top:8px}`,
  ].join("");
  document.head.appendChild(el);
};

/** Build the leading span for a glyph: dsh's tool icon with its chevron stacked on top, both cloned
 *  out of the sprite sheet. Returns null while the sheet has not rendered yet, or when the sheet has
 *  no sprite for the glyph, so the caller can leave the header alone and retry on the next scan. */
const leadFor = (glyph: string): HTMLElement | null => {
  const svg = document.querySelector(`[${SPRITE_MARK}="${glyph}"] svg`);
  const chevron = document.querySelector(`[${SPRITE_MARK}="chevron"] svg`);
  if (svg === null || chevron === null) return null;
  const span = document.createElement("span");
  span.setAttribute(LEAD_MARK, glyph);
  for (const [part, source] of [
    ["icon", svg],
    ["chevron", chevron],
  ] as const) {
    const holder = document.createElement("span");
    holder.setAttribute("data-omc-part", part);
    holder.appendChild(source.cloneNode(true));
    span.appendChild(holder);
  }
  return span;
};

/** One delegated listener pair toggles a header. Bound once per bundle and dropped when this bundle
 *  retires: a flag on documentElement outlives the reload the listeners do not, which left a tab
 *  answering clicks from whichever bundle loaded first and every later one silently unbound. */
let foldClicksBound = false;
const bindFoldClicks = () => {
  if (foldClicksBound) return;
  foldClicksBound = true;
  const stop = new AbortController();
  whenContextGone(() => {
    stop.abort();
  });
  const toggle = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    const head = target.closest<HTMLElement>(`p[${HEAD_MARK}]`);
    const state = head?.getAttribute(HEAD_MARK);
    if (head === null || state === "flat" || state === null) return false;
    setFoldState(head, state === "1" ? "open" : "1");
    return true;
  };
  document.addEventListener(
    "click",
    (e) => {
      toggle(e.target);
    },
    { signal: stop.signal },
  );
  // A header is a real control, so it answers the keys a button answers. Space would scroll the
  // transcript otherwise, hence the preventDefault, and only when the header actually took the key.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (toggle(e.target)) e.preventDefault();
    },
    { signal: stop.signal },
  );
};

/** Set a header's fold state and keep the announced state with it: a folding header is a button to a
 *  screen reader, and `aria-expanded` is the only thing that tells one whether the fence below is
 *  showing. A flat header is not a control, so it carries none of it. */
const setFoldState = (head: HTMLElement, state: "1" | "open" | "flat") => {
  head.setAttribute(HEAD_MARK, state);
  if (state === "flat") {
    head.removeAttribute("role");
    head.removeAttribute("tabindex");
    head.removeAttribute("aria-expanded");
    return;
  }
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  head.setAttribute("aria-expanded", state === "open" ? "true" : "false");
};

/** The glyph a header leads with, wherever it currently lives: still in the text, already lifted into
 *  a leading span, or in the `data-omc-icon` attribute an older build left behind. A glyph with the
 *  mark behind it is a header and says so for the rest of the page; a bare one is a header only
 *  while no marked header has been seen, or when this paragraph is one already folding. */
export const glyphOf = (head: HTMLElement): string => {
  const node = head.firstChild;
  if (node?.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? "";
    const at = text.search(/\S/);
    if (at >= 0 && TOOL_ICONS.includes(text.charAt(at))) {
      if (text.startsWith(FOLD_MARK, at + 1)) markedHeaders = true;
      else if (markedHeaders && !head.hasAttribute(HEAD_MARK)) return "";
      return text.charAt(at);
    }
  }
  return (
    head.querySelector(`span[${LEAD_MARK}]`)?.getAttribute(LEAD_MARK) ??
    head.getAttribute("data-omc-icon") ??
    ""
  );
};

/**
 * "Bash · Show the diff" as the translator writes it becomes name, dot and summary, the dot a
 * styled span and the summary its own span, once the glyph has been lifted. Split on every " · "
 * so an MCP tool's "dsh · subagent" keeps a dot inside its name too; the last part is the summary.
 * Repeatable: a converted header has no " · " left in the text node after the lead, so a second
 * pass does nothing, and React's text rewrite restores the plain form for the next pass.
 */
const dotHeader = (head: HTMLElement): void => {
  const node = head.querySelector(`span[${LEAD_MARK}]`)?.nextSibling;
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const text = node.nodeValue ?? "";
  if (!text.includes(" · ")) {
    // "Read `path`" and "Write `path`" carry no dot in the text: the path is a code chip right
    // after the name. dsh draws those rows as name, dot, file; the dot goes in before the chip
    // and the chip is flattened to dsh's file-link look by the header's own rule. A converted
    // header has the dot span there instead of the chip, so the pass does nothing twice.
    const next = node.nextSibling;
    if (next instanceof HTMLElement && next.tagName === "CODE" && text.trim() !== "") {
      node.nodeValue = text.trimEnd();
      const sep = document.createElement("span");
      sep.setAttribute("data-omc-part", "sep");
      sep.setAttribute("aria-hidden", "true");
      head.insertBefore(sep, next);
    }
    return;
  }
  const parts = text.split(" · ");
  const frag = document.createDocumentFragment();
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.setAttribute("data-omc-part", "sep");
      sep.setAttribute("aria-hidden", "true");
      frag.appendChild(sep);
    }
    if (i === parts.length - 1) {
      const summary = document.createElement("span");
      summary.setAttribute("data-omc-part", "summary");
      summary.textContent = part;
      frag.appendChild(summary);
    } else frag.appendChild(document.createTextNode(part));
  });
  node.replaceWith(frag);
};

function watchToolFolds() {
  ensureFoldStyle();
  ensurePanelStyle(); // the aside dock shares the panel's hover and focus rules
  bindFoldClicks();
  // Every tool step is a `<p>` that opens with one of the translator's glyphs; only some are followed
  // by a fence (`▤ Read \`path\`` is a whole step on its own). Both get the icon and the muted type;
  // only the ones with a fence fold. Marking is driven off the header rather than the fence for that
  // reason, and the pass is repeatable: a re-render restores the glyph in the text, so the swap has to
  // survive being done twice. A header is left alone while the sprite sheet has not mounted, and the
  // next mutation brings the scan back.
  // Set when a header was left for the sprite sheet: the mutation that mounts the sheet says nothing
  // about the headers waiting on it, so the pass after one is skipped goes wide again.
  let sweepAgain = false;
  const visit = (head: HTMLElement) => {
    const glyph = glyphOf(head);
    // React reuses a `<p>` node across renders: the paragraph that held a tool header one frame
    // can hold prose the next. It rewrites the text (`textContent` on a node with our extra span
    // takes the wipe-and-append path, so the lead span goes with it) but never touches our
    // attributes — leaving a prose line wearing the header type, taking clicks, and hiding the
    // fence under it for good. A paragraph that no longer leads with a glyph gives its marks back.
    if (glyph === "") {
      if (head.hasAttribute(HEAD_MARK)) {
        setFoldState(head, "flat");
        head.removeAttribute(HEAD_MARK);
      }
      return;
    }
    // State first, icon second. The state attribute is what hides the fence, and a header that has
    // to wait for the sprite sheet would otherwise sit unmarked with its whole block on screen.
    // A header folded before its icon lands still opens on click or Enter — setFoldState is what
    // gives it the role and the tab stop — so the only thing missing for that frame is the glyph.
    const foldable = head.nextElementSibling?.classList.contains("md-code-block") === true;
    const state = head.getAttribute(HEAD_MARK);
    // A header can start flat and gain its fence a moment later while the step streams in, so the
    // flat state is never sticky: only an already-folding header keeps the state the user set.
    // Written only on a change: this runs on every mutation burst, and an attribute write on a
    // node the fold rules can match invalidates style for all of them.
    if (!foldable) {
      if (state !== "flat") setFoldState(head, "flat");
    } else if (state !== "1" && state !== "open") setFoldState(head, "1");
    const node = head.firstChild;
    if (node?.nodeType === Node.TEXT_NODE && (node.nodeValue ?? "").trimStart().startsWith(glyph)) {
      const span = leadFor(glyph);
      if (span === null) {
        sweepAgain = true;
        return;
      }
      const text = node.nodeValue ?? "";
      head.querySelector(`span[${LEAD_MARK}]`)?.remove();
      head.removeAttribute("data-omc-icon");
      // The glyph goes, and the mark behind it when the writer put one there: the icon replaces
      // both. A header from an older build has no mark and loses only the glyph.
      const from = text.indexOf(glyph) + 1;
      const cut = text.startsWith(FOLD_MARK, from) ? from + FOLD_MARK.length : from;
      node.nodeValue = text.slice(cut).replace(/^ /, "");
      head.insertBefore(span, node);
    } else if (head.querySelector(`span[${LEAD_MARK}]`) === null) {
      // An older build stripped the glyph into the attribute; adopt it from there.
      const span = leadFor(glyph);
      if (span === null) {
        sweepAgain = true;
        return;
      }
      head.removeAttribute("data-omc-icon");
      head.insertBefore(span, head.firstChild);
    }
    dotHeader(head);
  };
  const MARKDOWN_P = '[class*="_markdown"] p';
  // What a burst touched, as headers. A record's target is the node whose children changed — the
  // paragraph itself when React rewrites its text, the markdown container when a step gains its
  // fence — and its added nodes are whole blocks that may hold headers of their own.
  const headsIn = (records: MutationRecord[]): Set<HTMLElement> => {
    const heads = new Set<HTMLElement>();
    const take = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === "P") {
        if (node.closest('[class*="_markdown"]') !== null) heads.add(node);
        return;
      }
      for (const head of node.querySelectorAll<HTMLElement>(MARKDOWN_P)) heads.add(head);
    };
    for (const rec of records) {
      take(rec.target);
      for (const node of rec.addedNodes) take(node);
    }
    return heads;
  };
  const scan = (records?: MutationRecord[]) => {
    // Scoped to the burst by default: dsh fires many bursts a frame and the document-wide query is
    // the one cost here that grows with the transcript, so a long turn used to get stickier as it
    // ran. The wide pass is for the first run and for the burst after a header waited on its icon.
    const wide = records === undefined || sweepAgain;
    sweepAgain = false;
    for (const head of wide ? document.querySelectorAll<HTMLElement>(MARKDOWN_P) : headsIn(records))
      visit(head);
  };
  scan();
  onBodyMutation(scan, true);
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

/** The hashed half of a CSS-module class changes with every dsh build, the suffix does not. */
const MODULE_ROOT = /(?:^|\s)[\w-]*_root(?:\s|$)/;
/** dsh's `StatsLine` separator: a direct child of the row, `aria-hidden`, and a literal bar. */
const STATS_SEP = ':scope > span[aria-hidden="true"][class$="_sep"]';

/**
 * dsh's own stats row, the div the cost line is appended to. dsh builds it in `StatsLine` as a
 * `_root` div of `<span>` groups joined by `_sep` bars, which is the handle used here: the groups
 * themselves come from the `stats.counts` message and read differently in another locale. The
 * English text stays as a last resort for a row that has one group and therefore no bar yet.
 */
export const isStatsRow = (el: HTMLElement): boolean => {
  if (!el.isConnected || el.children.length < 1) return false;
  // dsh 0.1.5 draws the row as pills and marks it (`StatsPills`, ui-chat); the shape checks below
  // are for the earlier row of groups with a bar between them.
  if (el.hasAttribute("data-composer-stats")) return true;
  // The class comes before the text, and the text is only read for a div that has it. Both old and
  // new dsh draw the row as a `_root` module div, and `textContent` on a div that is not one builds
  // the whole subtree's text: over every div in a long conversation that alone was 20 ms a call.
  if (el.children.length < 2 || !MODULE_ROOT.test(el.className)) return false;
  // Three other dsh components draw an empty `_sep` span inside a row; only this one is a bar.
  if (el.querySelector(STATS_SEP)?.textContent === "|") return true;
  return /\d+ turns · \d+ steps/.test(el.textContent ?? "");
};

/** Cost readout in dsh's footer stats row: only when the open session is a Claude mount. */
function CostLine({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  // What the poll compares against without listing `turns` as a dependency of its effect.
  const turnsRef = useRef<TurnRecord[]>([]);
  turnsRef.current = turns;
  const visibleRef = useRef(true);

  useEffect(() => {
    // No `activeClaudeSession` gate here. It reads the session's provider binding, which is briefly
    // undefined during a restart or a rebind; an effect that ran in that window returned before
    // installing the interval and, with `[ctx, sessionId]` stable, never ran again — so the cost never
    // appeared for that tab until it was reloaded. This is the same fault the `/btw` card had (#210).
    // The route is per-session and the render below decides whether to draw, so polling unconditionally
    // costs one request per ten seconds and removes the dead window.
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

  const [boxLine] = useHintValue("spendWarnUsd");
  const [sessionLine, setSessionLine] = useHintValue(
    `spendWarnUsd${sessionId.replaceAll("-", "")}`,
  );
  const line = numberOr(sessionLine) ?? numberOr(boxLine);

  // dsh's current session blinks: a child session takes the slot for a moment, and a model
  // directory mid-rebind answers no provider at all. A blank answer used to read as "not mine" and
  // took the cost off the row under the pointer, so only another session's id gives it up.
  // Derived during render, committed after it: React throws renders away, and one that never
  // reached the screen used to latch this ref anyway — so a render for another session could leave
  // the cost of this one on the row.
  const mineRef = useRef(false);
  const current = ctx.sessions.list.getSnapshot()?.current;
  const mine =
    activeClaudeSession(ctx) === sessionId
      ? true
      : current && current !== sessionId
        ? false
        : mineRef.current;
  useLayoutEffect(() => {
    mineRef.current = mine;
  });
  const total = turns.reduce((s, r) => s + r.costUsd, 0);
  const totalCacheRead = turns.reduce((s, r) => s + r.cacheRead, 0);
  const last = turns[turns.length - 1];
  const text = mine && total > 0 && last ? costText(total, last.costUsd, totalCacheRead) : "";
  // Past the line the pill turns orange and the tooltip leads with the fact; every wording says
  // API-rate, since a subscription login is not billed by this figure.
  const over = mine && total > 0 && line !== undefined && total >= line;
  const base =
    mine && total > 0 && last
      ? `Claude cost, API-rate: ${fmtCost(total)} this session, ${fmtCost(last.costUsd)} last turn (${turns.length} turn${turns.length === 1 ? "" : "s"})${fmtTtft(last.ttftMs)}`
      : "";
  const title =
    over && line !== undefined ? `over ${fmtCost(line)} this session, API-rate · ${base}` : base;
  const [subscription, setSubscription] = useState(false);
  useEffect(() => {
    let live = true;
    statusOnce ??= fetch(`${ROUTE}/status`)
      .then((r) => readJson<{ authMethod?: string | null }>(r))
      .then((s) => s.authMethod === "claude.ai")
      .catch(() => false);
    void statusOnce.then((v) => live && setSubscription(v));
    return () => {
      live = false;
    };
  }, []);
  const [guardDraft, setGuardDraft] = useState("");
  useEffect(() => {
    setGuardDraft(numberOr(sessionLine) === undefined ? "" : String(sessionLine));
  }, [sessionLine]);
  const saveGuard = () => {
    const t = guardDraft.trim();
    if (t === "") {
      setSessionLine(null);
      return;
    }
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) setSessionLine(n);
    else setGuardDraft(numberOr(sessionLine) === undefined ? "" : String(sessionLine));
  };
  // The pill's dialog, the same seat dsh's own pills use (`useStatDialog`, ui-chat): the injected
  // anchor span is the trigger root, the panel is fixed-positioned above it by dsh's own hook and
  // closes on an outside pointer or Escape. No portal: the panel is rendered here, beside the slot
  // span, and `position: fixed` puts it where the coordinates say regardless.
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  const pillRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pos = useAnchoredPosition({
    open,
    anchorRef: pillRef,
    panelRef,
    side: "top",
    gap: 8,
    margin: 12,
  });
  useDismissOnOutsidePointer(pillRef, open, setOpen, panelRef);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  // A cost that left the row takes its dialog with it.
  useEffect(() => {
    if (!text) setOpen(false);
  }, [text]);
  // dsh's stats row is one div of groups; a slot entry can only be its sibling and lands on its
  // own line. Append into that div instead, the way the context meter hooks its popover.
  // ponytail: the row is found by its shape, not by a slot dsh offers; swap for a slot the day
  // dsh's stats line grows one.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [hooked, setHooked] = useState(false);
  // What the injected nodes say, held in a ref: a new cost arriving mid-hover used to tear the
  // whole hook down and build it again, which is the blink the row was reported to have. The
  // nodes now stay where they are and only their text is rewritten.
  // Same reason as `mineRef`: these feed nodes injected into dsh's own row, and `tryHook` writes
  // `textRef.current` straight onto the screen. Written in a layout effect, so what lands there
  // comes from a render React committed. Layout effects run before the passive effect below, so
  // the sync still sees the new text.
  const textRef = useRef(text);
  const titleRef = useRef(title);
  const overRef = useRef(false);
  overRef.current = over;
  useLayoutEffect(() => {
    textRef.current = text;
    titleRef.current = title;
    openRef.current = open;
  });
  const syncRef = useRef<() => void>(() => {});
  useEffect(() => syncRef.current(), [text, title, open]);
  useEffect(() => {
    let inline: HTMLSpanElement | undefined;
    let body: HTMLSpanElement | undefined;
    let trigger: HTMLButtonElement | undefined; // the pill itself, in the pill row only
    let pad = ` ${CLAUDE_MARK} `; // between the bar and the text, with the mark; nothing in a pill
    let lastRow: HTMLElement | undefined;
    let lastHost: HTMLElement | undefined; // the footer the row hangs in; it outlives the row
    // The row appears with the first settled step and is one of dsh's own divs anywhere in the
    // document; look for it until found (one conversation is on screen at a time).
    // `inline?.isConnected`, not `inline`: dsh re-renders this row on every step and React drops
    // the span we appended. Holding the detached node as proof it is hooked left the cost gone for
    // good — the row has to be hooked again each time it loses ours.
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
    const paintOver = () => {
      const target = trigger ?? inline;
      if (target) {
        if (overRef.current) target.setAttribute("data-omc-cost-over", "");
        else target.removeAttribute("data-omc-cost-over");
      }
    };

    const tryHook = () => {
      if (!anchorRef.current?.isConnected) return;
      if (inline?.isConnected) {
        // Already in the row: rewrite what it says instead of building it again. Only what
        // changed: the observer above reports every childList mutation, and a `textContent` write
        // replaces the text node even when the string is the same, so an unconditional write here
        // called this back on every frame — 35 mutations a second under an idle pill, measured
        // 2026-09-10 — for nothing.
        if (trigger) {
          const expanded = String(openRef.current);
          if (trigger.getAttribute("aria-label") !== titleRef.current)
            trigger.setAttribute("aria-label", titleRef.current);
          if (trigger.getAttribute("aria-expanded") !== expanded)
            trigger.setAttribute("aria-expanded", expanded);
          paintOver();
        } else if (inline.title !== titleRef.current) {
          inline.title = titleRef.current;
          paintOver();
        }
        const wanted = `${pad}${textRef.current}`;
        if (body && body.textContent !== wanted) body.textContent = wanted;
        return;
      }
      if (inline) debug("row dropped our span; hooking again");
      // Three tries, cheapest first. The row dsh re-rendered is usually the same element with new
      // children, so the one it was last found in is tried first. When dsh replaces the element —
      // which it does on a settled step, and that is exactly when this runs — the footer it hangs
      // in is still the same node, so the second try searches that instead of the document. Only a
      // conversation that was never hooked, or a footer that went away, pays for the full walk.
      // dsh 0.1.5 marks the row, so ask for it by name first: one indexed attribute query against
      // a conversation where the `div` walk below is thousands of nodes.
      const rowIn = (root: ParentNode) => {
        const marked = [...root.querySelectorAll<HTMLDivElement>("div[data-composer-stats]")].at(
          -1,
        );
        if (marked?.isConnected) return marked;
        return [...root.querySelectorAll<HTMLDivElement>("div")].filter(isStatsRow).at(-1);
      };
      const statsRow =
        lastRow && isStatsRow(lastRow)
          ? lastRow
          : ((lastHost?.isConnected === true ? rowIn(lastHost) : undefined) ?? rowIn(document));
      lastRow = statsRow;
      lastHost = statsRow?.parentElement ?? lastHost;
      if (!statsRow) {
        debug("no stats row on screen");
        return;
      }
      inline = document.createElement("span");
      inline.style.whiteSpace = "nowrap";
      body = document.createElement("span");
      // The pill row: an anchor span holding a pill (button or span) whose first span is the
      // label. Ours borrows the three class names from dsh's first pill, so it takes the same
      // padding, radius and colour whatever the module hash is in this build. It is a button, as
      // dsh's are: the hover rule is `button._pill:hover`, a span never lights up, and a phone has
      // no hover at all — the tap opens the dialog, which is where the detail lives.
      const proto = statsRow.hasAttribute("data-composer-stats")
        ? statsRow.firstElementChild?.firstElementChild
        : null;
      if (proto?.parentElement) {
        pad = "";
        inline.className = proto.parentElement.className;
        trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = proto.className;
        trigger.setAttribute("data-omc-cost-pill", "");
        trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-expanded", String(openRef.current));
        trigger.setAttribute("aria-label", titleRef.current);
        paintOver();
        trigger.addEventListener("click", () => setOpen((was) => !was));
        body.className = proto.querySelector("span")?.className ?? "";
        body.textContent = textRef.current;
        // dsh's pills lead with a 14px icon in the pill's own text colour; ours is Claude's spark.
        trigger.append(sparkNode(14, "currentColor"), body);
        inline.append(trigger);
        pillRef.current = inline;
      } else {
        pad = ` ${CLAUDE_MARK} `;
        inline.title = titleRef.current;
        paintOver();
        const sep = document.createElement("span");
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "|";
        body.textContent = `${pad}${textRef.current}`;
        inline.append(" ", sep, body);
      }
      statsRow.append(inline);
      debug("hooked the stats row", { text: textRef.current });
      setHooked(true);
    };

    const drop = () => {
      // Nothing was ever put on screen: the first turn of a session runs this on every frame with
      // no cost to show yet. `lastRow` is what says a hook once succeeded, so a span dsh has since
      // dropped still clears the hooked flag.
      if (inline === undefined && lastRow === undefined) return;
      inline?.remove();
      inline = undefined;
      body = undefined;
      trigger = undefined;
      pillRef.current = null;
      lastRow = undefined; // a fresh hook looks the row up again rather than trusting an old pane
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
    };
    syncRef.current = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(sync);
      }
    };
    // The one shared body observer, not a second one of its own: every observer on `document.body`
    // is handed its own copy of each mutation record, and a streaming turn makes hundreds a second.
    // The shared one already coalesces to one pass per frame, which is what `sync` wanted.
    const off = onBodyMutation(() => syncRef.current());
    sync();
    // Fallback for a change no mutation reports at all (a row moved by CSS, a bubble reused).
    const timer = setInterval(sync, 1000);
    return () => {
      clearInterval(timer);
      off();
      syncRef.current = () => {};
      drop();
    };
  }, []);
  if (!text) return <span ref={anchorRef} hidden />;
  return (
    <>
      <span ref={anchorRef} style={hooked ? { display: "none" } : undefined}>
        {(() => {
          const overAttr: Record<string, string> = {};
          if (over) overAttr["data-omc-cost-over"] = "";
          return (
            <span
              title={title}
              style={{
                display: "inline",
                fontSize: 14,
                color: over ? ACCENT : T.faint,
                whiteSpace: "nowrap",
              }}
              {...overAttr}
            >
              <span aria-hidden="true">|</span> {CLAUDE_MARK} {text}
            </span>
          );
        })()}
      </span>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Claude cost"
          data-omc-cost-dialog=""
          style={pos ?? MEASURE_STYLE}
        >
          <div data-omc-cost-title="">
            <span data-omc-cost-title-label="">
              <Spark size={14} />
              Claude cost
            </span>
            <span data-omc-cost-title-value="">{fmtCost(total)}</span>
          </div>
          <div data-omc-cost-rule="" aria-hidden="true" />
          <dl data-omc-cost-details="">
            {costDetails(turns).map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
          <div data-omc-cost-guard="">
            <label>
              Warn at $
              <input
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                aria-label="Warn this session at dollars"
                data-omc-cost-guard-input=""
                value={guardDraft}
                placeholder={numberOr(boxLine) === undefined ? "off" : String(boxLine)}
                onChange={(e) => setGuardDraft(e.target.value)}
                onBlur={saveGuard}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveGuard();
                }}
              />
            </label>
            {numberOr(sessionLine) !== undefined && (
              <button
                type="button"
                data-omc-cost-guard-clear=""
                onClick={() => setSessionLine(null)}
              >
                Clear
              </button>
            )}
            {subscription && (
              <p data-omc-cost-note="">
                Shown at API rates; a subscription login is not billed by it.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** dsh's own dock-card box (its QueueDock `_7yHdaG_dock`), to the pixel: composer-card width less one
 *  dock inset each side, centred, and the negative bottom margin every dsh dock card uses to hug the
 *  stack gap below it. Both of this plugin's dock cards sit on it so they line up with the queue,
 *  todo and goal panels instead of spanning the pane. */
const DOCK_CARD: CSSProperties = {
  boxSizing: "border-box",
  width:
    "calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
  maxWidth:
    "calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
  // dsh stacks the dock and the composer with its stack gap between them; pulling the card up by
  // most of that gap keeps it close, and the 4 px left over is what stops the composer's top edge
  // from clipping the strip's buttons.
  margin: "0 auto calc(4px - var(--dsh-composer-stack-gap))",
  padding: "0 var(--dsh-composer-dock-inset)",
  flex: "none",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

/** What the starter route answers: this session's own saved opener and the shared fallback. */
interface StarterReply {
  session: string;
  fallback: string;
}

/** Session ids this tab already applied a remembered model to, so a re-render never re-selects. */
const appliedModel = new Set<string>();

/**
 * On a blank session whose provider is already Claude, select the model this workspace last ran.
 * The provider is never changed: the memory is which Claude model, not whether Claude. Once per
 * session id per tab, and never once the session has a message.
 */
function WorkspaceModelMemory({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useEffect(() => {
    const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId];
    if (!entry || entry.blank === false || !entry.cwd) return;
    const provider = claudeProviderOf(ctx, sessionId);
    if (!provider || appliedModel.has(sessionId)) return;
    appliedModel.add(sessionId);
    let live = true;
    const runApply = async () => {
      const hints = await loadHints();
      if (hints.workspaceModelOff === true || !live) return;
      const q = `cwd=${encodeURIComponent(entry.cwd ?? "")}`;
      const saved = await readJson<{ model?: string }>(
        await fetch(`${ROUTE}/workspace-model?${q}`),
      );
      if (!saved.model || !live) return;
      const dir = ctx.modelDirectories.directoryFor(sessionId);
      if (dir.store.getSnapshot().current?.model === saved.model) return;
      if (dir.select) await dir.select({ provider, model: saved.model });
    };
    // A session dsh has not bound yet throws from directoryFor (see claudeProviderOf); a route
    // that is not there answers an error. Neither is this component's problem to report.
    void runApply().catch(() => {});
    return () => {
      live = false;
    };
  }, [ctx, sessionId]);
  return null;
}

/**
 * The prompt starter: a card above the composer on a session that has not been used yet, offering the
 * opening line saved for this session — or, on a brand-new tab, the last one saved anywhere — and
 * writing it into the composer without sending it, so it can be edited first. The card also saves the
 * current draft as the opener, and forgets it again. It hides the moment the session has a message or
 * the composer has text, so it never sits between the user and a prompt they are already writing.
 */
function StarterCard({
  sessionId,
  ctx,
  draft,
  setDraft,
}: {
  sessionId: string;
  ctx: ClientCtx;
  draft: string;
  setDraft: (text: string) => void;
}) {
  const [starter, setStarter] = useState<StarterReply | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/starter?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<StarterReply>(r))
      .then((b) => {
        if (live) setStarter(b);
      })
      .catch(() => {}); // no store yet: the card simply does not appear
    return () => {
      live = false;
    };
  }, [sessionId]);

  // The card says what the store did, not what the click did: a save that never reached the route
  // has to say so, or the opener is quietly gone by the next tab.
  const save = (text: string) => {
    setStarter({ session: text, fallback: text });
    setNote("Saving…");
    void fetch(`${ROUTE}/starter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sessionId, text }),
    })
      .then((r) => {
        setNote(r.ok ? "Saved" : "Save failed");
      })
      .catch(() => {
        setNote("Save failed");
      })
      .finally(() => setTimeout(() => setNote(""), 1600));
  };

  // Only on an unused session: dsh's own `blank` bit, which is false as soon as the session has a
  // message. `!== false` rather than `=== true` so a session missing from the snapshot (the moment a
  // tab opens) still counts as blank.
  const blank = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.blank !== false;
  if (!blank || starter === null) return null;
  const opener = starter.session || starter.fallback;
  const busy = draft !== "" && draft !== opener; // they are writing something of their own
  const saveLabel = note !== "" ? note : busy ? "Save draft" : "Saved";

  const chip: CSSProperties = {
    ...btn,
    fontSize: 12,
    lineHeight: "16px",
    padding: "2px 8px",
    borderRadius: 999,
    border: `1px solid ${T.border}`,
    background: "transparent",
    flex: "none",
  };
  const clipped: CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div {...{ [DOCK_ATTR]: "1" }} style={DOCK_CARD}>
      <div
        // One row, always: the opener and the hint shrink with an ellipsis and the buttons keep
        // their width, so a long draft never wraps the row and shoves the buttons under it.
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "nowrap",
          fontSize: 12,
          color: T.faint,
          minWidth: 0,
          // Chip height (16 px line + 2 px padding and 1 px border each side) is the row's floor,
          // so the Save draft chip appearing on the first keystroke does not grow the row and
          // push the composer down.
          minHeight: 22,
        }}
      >
        {opener === "" || busy ? (
          <span style={clipped}>
            Type a prompt to start. Save it here to open the next session with it.
          </span>
        ) : (
          <>
            <button
              type="button"
              style={{ ...chip, ...clipped, flex: "0 1 auto" }}
              onClick={() => setDraft(opener)}
              title={opener}
            >
              {opener}
            </button>
            <span style={clipped}>fills the composer; edit before sending.</span>
          </>
        )}
        <span style={{ flex: "1 1 auto" }} />
        <Slide open={draft !== ""}>
          <button
            type="button"
            style={chip}
            onClick={() => save(draft)}
            title="Save what is in the composer as this session's opening prompt"
            // Greyed while the composer already matches the saved opener, and while a save runs.
            disabled={!busy || note !== ""}
          >
            {/* Every label the chip can show shares one cell, so Saving… and Saved do not resize it. */}
            <span style={{ display: "inline-grid" }}>
              {["Save draft", "Saving…", "Saved", "Save failed"].map((text) => (
                <span
                  key={text}
                  style={{
                    gridArea: "1 / 1",
                    visibility: text === saveLabel ? "visible" : "hidden",
                  }}
                >
                  {text}
                </span>
              ))}
            </span>
          </button>
        </Slide>
        <Slide open={opener !== ""}>
          <ConfirmButton
            label="Forget"
            style={chip}
            disabled={opener === ""}
            onAct={() => save("")}
          />
        </Slide>
      </div>
    </div>
  );
}

/** Width of one starter-row chip eased in and out. The wrapper is a one-column grid whose column
 *  goes 0fr to 1fr, which is animatable, so a chip appearing or leaving slides its neighbours over
 *  instead of shoving them. Closed, a negative margin swallows the row gap the empty wrapper would
 *  still claim, and `visibility` drops it from the tab order, delayed on close so the slide is seen. */
const SLIDE_MS = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
function Slide({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <span
      style={{
        display: "grid",
        gridTemplateColumns: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        visibility: open ? "visible" : "hidden",
        marginLeft: open ? 0 : -6,
        flex: "none",
        transition: `grid-template-columns ${SLIDE_MS}ms ease, opacity ${SLIDE_MS}ms ease, margin-left ${SLIDE_MS}ms ease, visibility 0s ${open ? 0 : SLIDE_MS}ms`,
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", display: "flex" }}>{children}</span>
    </span>
  );
}

/** One flag from the box-wide `hints.json` store, live across components: a set here reaches every
 *  mounted reader through one window event, so the settings switch hides the dock without a remount. */
const HINTS_EVENT = "omc-hints";
let statusOnce: Promise<boolean> | undefined;
/** One read of the store shared by every hook on the page: a Settings open mounts five readers and
 *  every cost pill two, so the fetch is memoised until a write dispatches the event. */
let hintsOnce: Promise<Record<string, boolean | number>> | undefined;
const loadHints = (): Promise<Record<string, boolean | number>> =>
  (hintsOnce ??= fetch(`${ROUTE}/hints`)
    .then((r) => readJson<Record<string, boolean | number>>(r))
    .catch(() => {
      hintsOnce = undefined; // a failed read is retried by the next reader, not cached
      return {};
    }));
function useHintValue(
  key: string,
): [boolean | number | undefined, (next: boolean | number | null) => void] {
  const [value, setValue] = useState<boolean | number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () =>
      loadHints().then((h) => {
        if (live) setValue(h[key]);
      });
    void load();
    window.addEventListener(HINTS_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(HINTS_EVENT, load);
    };
  }, [key]);
  const set = (next: boolean | number | null) => {
    setValue(next === null ? undefined : next);
    void fetch(`${ROUTE}/hints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    }).finally(() => {
      hintsOnce = undefined; // every reader re-reads once, through one shared fetch
      window.dispatchEvent(new Event(HINTS_EVENT));
    });
  };
  return [value, set];
}

/** One boolean flag from the hints store; `false` clears the key. */
function useHintFlag(flag: string): [boolean, (on: boolean) => void] {
  const [value, set] = useHintValue(flag);
  return [value === true, (on) => set(on)];
}

/** Write the Claude look's switches to the page: the group tokens on `<body>` (absent means every
 *  group on, so the first paint before the hints load is today's paint) and the accent pair on the
 *  root. Read by the sheets through `[data-omc-theme~="…"]` and `var(--omc-accent)`. */
function applyTheme(hints: Record<string, boolean | number>): void {
  const theme = themeOf(hints);
  document.body.setAttribute("data-omc-theme", theme.groups.join(" "));
  const root = document.documentElement.style;
  root.setProperty("--omc-accent", theme.accent);
  root.setProperty("--omc-shimmer", theme.shimmer);
}

/** dsh's own settings switch, drawn with its measurements and colour tokens: a 36 by 20 pill with a
 *  16 px thumb that slides 16 px, brand-coloured when on. Its class names are generated per build,
 *  so the look is copied rather than the class borrowed. */
function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        boxSizing: "border-box",
        position: "relative",
        flex: "0 0 auto",
        width: 36,
        height: 20,
        padding: 2,
        border: 0,
        borderRadius: 10,
        background: on ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l3)",
        cursor: "pointer",
        transition: "background 120ms ease",
      }}
    >
      <span
        style={{
          display: "block",
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--dsw-alias-label-primary-foreground)",
          transform: on ? "translateX(16px)" : "none",
          transition: "transform 120ms ease",
        }}
      />
    </button>
  );
}

/** One theme group's checkbox: checked means on; the flag is the group's off key. */
function ThemeGroupBox({ flag, group, label }: { flag: string; group: string; label: string }) {
  const [off, setOff] = useHintFlag(flag);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <input
        type="checkbox"
        data-omc-theme-group={group}
        checked={!off}
        onChange={(e) => setOff(!e.target.checked)}
      />
      {label}
    </label>
  );
}

/** The Claude look: the master switch first under the section title, then a fold with one checkbox
 *  per group and the accent colour. Box-wide in the hints store like the switches under it;
 *  applyTheme repaints on the hints event the setters dispatch, so nothing here touches the DOM. */
function ThemeSwitch() {
  const [off, setOff] = useHintFlag("themeOff");
  const [accent, setAccent] = useHintValue("themeAccent");
  const hints: Record<string, boolean | number> = {};
  if (accent !== undefined) hints.themeAccent = accent;
  const hex = themeOf(hints).accent;
  return (
    <>
      <div
        data-omc-theme-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: off ? 12 : 4,
        }}
      >
        <div>
          <div>Claude look</div>
          <div style={{ color: T.faint, fontSize: 12 }}>
            Orange accent, the verb status line, links and the panel tint. Off is dsh's own colours.
          </div>
        </div>
        <Switch on={!off} onChange={(next) => setOff(!next)} label="Claude look" />
      </div>
      {!off && (
        <details data-omc-theme-custom="" style={{ marginBottom: 12, fontSize: 13 }}>
          <summary style={{ cursor: "pointer", color: T.muted }}>Customize</summary>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0 16px" }}
          >
            <ThemeGroupBox
              flag="themeRowOff"
              group="row"
              label="Status row, verb and running dots"
            />
            <ThemeGroupBox flag="themeProseOff" group="prose" label="Links, rules and quotes" />
            <ThemeGroupBox flag="themeSendOff" group="send" label="Send button" />
            <ThemeGroupBox flag="themePanelOff" group="panel" label="Panel and spark" />
            <ThemeGroupBox flag="themeRainbowOff" group="rainbow" label="Rainbow words" />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              Accent
              <input
                type="color"
                data-omc-theme-accent=""
                aria-label="Accent colour"
                value={hex}
                // `change`, not `input`: a drag through the picker must not post per frame.
                onChange={(e) => setAccent(parseInt(e.target.value.slice(1), 16))}
              />
              {accent !== undefined && (
                <button
                  type="button"
                  style={btn}
                  data-omc-theme-reset=""
                  onClick={() => setAccent(null)}
                >
                  Reset
                </button>
              )}
            </label>
          </div>
        </details>
      )}
    </>
  );
}

/** The settings switch for the prompt-starter dock, under the Claude look switch. */
function StarterSwitch() {
  const [off, setOff] = useHintFlag("starterOff");
  return (
    <div
      data-omc-starter-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>Prompt starter</div>
        <div style={{ color: T.faint, fontSize: 12 }}>
          Offer a saved opening prompt above the composer on a blank session.
        </div>
      </div>
      <Switch on={!off} onChange={(next) => setOff(!next)} label="Prompt starter" />
    </div>
  );
}

/** The settings switch for the update notice. The flag lives in the box's hints store, which the
 *  server reads before it asks npm: off means no registry read at all, not a hidden pill. */
function UpdateNoticeSwitch() {
  const [off, setOff] = useHintFlag("updateCheckOff");
  return (
    <div
      data-omc-update-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>Update notice</div>
        <div style={{ color: T.faint, fontSize: 12 }}>
          A pill beside the heading above when a newer plugin is on npm. One registry read a day,
          from this dsh server; off means none.
        </div>
      </div>
      <Switch on={!off} onChange={(next) => setOff(!next)} label="Update notice" />
    </div>
  );
}

/** The settings switch for remembering which Claude model a workspace last ran. */
function WorkspaceModelSwitch() {
  const [off, setOff] = useHintFlag("workspaceModelOff");
  return (
    <div
      data-omc-workspace-model-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>Remember model per workspace</div>
        <div style={{ color: T.faint, fontSize: 12 }}>
          A new Claude session in a workspace opens on the model it last ran there. The provider
          never changes; only which Claude model.
        </div>
      </div>
      <Switch on={!off} onChange={(next) => setOff(!next)} label="Remember model per workspace" />
    </div>
  );
}

/**
 * The settings switch for the one-line recap on returning to a finished session. Backed by
 * `localStorage`, not a hint, because it costs a model call and belongs to the browser that would
 * read the line, not to every tab on the box.
 */
function ReturnRecapSwitch() {
  const [on, setOn] = useHintFlag("recapOn");
  const [stored, setStored] = useHintValue("recapAwayMs");
  const away = recapAwayIn(stored);
  return (
    <>
      <div
        data-omc-recap-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: on ? 4 : 12,
        }}
      >
        <div>
          <div>Return recap</div>
          <div style={{ color: T.faint, fontSize: 12 }}>
            One line on what Claude did while you were on another session, asked when you come back
            to one that finished without you. Costs a model call each time.
          </div>
        </div>
        <Switch on={on} onChange={setOn} label="Return recap" />
      </div>
      {/* Only with the feature on: a bar for something that never fires is a question about nothing. */}
      {on && (
        <label
          data-omc-recap-away=""
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            marginBottom: 12,
            paddingLeft: 16,
          }}
        >
          <span style={{ color: T.muted }}>Away at least</span>
          <select
            style={select}
            aria-label="Away time before a recap"
            value={String(away)}
            // The default is stored as absence, so a box that never touched this reads the default
            // even if it moves later.
            onChange={(e) => {
              const next = Number(e.target.value);
              setStored(next === RECAP_AWAY_MS ? null : next);
            }}
          >
            {RECAP_AWAY_CHOICES.map((ms) => (
              <option key={ms} value={String(ms)}>
                {awayLabel(ms)}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** Minutes or hours, with the default named so picking it back is one choice rather than a button. */
const awayLabel = (ms: number): string => {
  const minutes = ms / 60_000;
  const text =
    minutes >= 60 ? `${minutes / 60} hour` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return ms === RECAP_AWAY_MS ? `${text} (default)` : text;
};

/** Box-wide spend warning: a dollar figure that turns the cost pill orange once a session passes it. */
function SpendGuardField() {
  const [stored, setStored] = useHintValue("spendWarnUsd");
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(numberOr(stored) === undefined ? "" : String(stored));
  }, [stored]);
  const save = () => {
    const t = draft.trim();
    if (t === "") {
      setStored(null);
      return;
    }
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) setStored(n);
    else setDraft(numberOr(stored) === undefined ? "" : String(stored));
  };
  return (
    <div
      data-omc-spend-field=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>Spend warning</div>
        <div style={{ color: T.faint, fontSize: 12 }}>
          Turns the cost pill orange once a session passes this API-rate figure. Empty is off. A
          session can set its own line in the cost dialog.
        </div>
      </div>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 13,
        }}
      >
        $
        <input
          type="number"
          min={0}
          step={1}
          inputMode="decimal"
          aria-label="Warn per session at dollars"
          data-omc-spend-input=""
          style={{ ...inputStyle, width: 72 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
      </label>
    </div>
  );
}

/** The settings switch for terminal sync. Server-held, unlike the starter's client hint: it gates a
 *  watcher the adapter runs, so it reads and writes the plugin's `/terminal-sync` route. */
function TerminalSyncSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/terminal-sync`)
      .then((r) => readJson<{ enabled: boolean }>(r))
      .then((b) => live && setOn(b.enabled))
      .catch(() => live && setErr("could not read the terminal sync setting"));
    return () => {
      live = false;
    };
  }, []);
  const toggle = async (next: boolean) => {
    setErr("");
    try {
      const b = await readJson<{ enabled: boolean }>(
        await fetch(`${ROUTE}/terminal-sync`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        }),
      );
      setOn(b.enabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div
      data-omc-terminal-sync=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>
          Terminal mirror <span style={{ color: T.err }}>(experimental)</span>
        </div>
        <div style={{ color: T.faint, fontSize: 12 }}>
          {err ||
            "Copy exchanges from a terminal that picked this session up with claude /resume into this dsh session as they land. Experimental: it holds a turn open while it fills, so a prompt you type can wait behind it. Carrying a session between dsh and a terminal works either way; this only controls the live copy."}
        </div>
      </div>
      <Switch on={on ?? false} onChange={(next) => void toggle(next)} label="Terminal mirror" />
    </div>
  );
}

/** Slot wrapper: reads the live draft through dsh's own input hook before handing the card its props.
 *  The hook comes in as a prop, so the read has to happen in a component dsh renders, not in the
 *  registration callback. */
function StarterSlot({
  sessionId,
  ctx,
  inputActions,
  useInput,
}: {
  sessionId?: string;
  ctx: ClientCtx;
  inputActions?: { setDraft: (text: string) => void };
  useInput?: <T>(select: (state: { draft: string }) => T) => T;
}) {
  const draft = useInput?.((state) => state.draft) ?? "";
  const [off] = useHintFlag("starterOff");
  if (off || sessionId === undefined || inputActions === undefined) return null;
  return (
    <StarterCard
      sessionId={sessionId}
      ctx={ctx}
      draft={draft}
      setDraft={(text) => inputActions.setDraft(text)}
    />
  );
}

/** Renderless: writes a draft the panel queued into the composer. The panel has no `setDraft` of its
 *  own, and this slot does, so Review my changes crosses here. */
function DraftRelay({
  sessionId,
  inputActions,
  useInput,
}: {
  sessionId?: string;
  inputActions?: { setDraft: (text: string) => void };
  useInput?: <T>(select: (state: { draft: string }) => T) => T;
}) {
  // Mirrored out for the recap watcher, which is an interval and so cannot call a hook. Cleared on
  // unmount: a composer that is gone has no text in it, and a stale value would mute every recap.
  const draft = useInput?.((state) => state.draft) ?? "";
  useEffect(() => {
    noteDraft(draft);
    return () => noteDraft("");
  }, [draft]);
  useEffect(() => {
    if (sessionId === undefined || inputActions === undefined) return;
    const flush = () => {
      const text = takeDraft(sessionId);
      if (text !== undefined) inputActions.setDraft(text);
    };
    flush(); // queued before this mounted, e.g. the panel closed on the same click
    return subscribeDraft(flush);
  }, [sessionId, inputActions]);
  return null;
}

/** One `/btw` side question as the client bubble draws it (mirrors the adapter's `AsideEntry`). */
interface AsideItem {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  pending: boolean;
  at: number;
  dismissed?: boolean;
}

/**
 * The `/btw` aside bubble: a Claude-orange card docked above the composer, in the same slot and at
 * the same width as dsh's todo and goal panels, that shows each side question and the answer the
 * CLI returns off the transcript. Pending cards read as thinking; each is dismissed on its own. The
 * server keeps only the last few per session, so the list stays short.
 */
/** Mirrors the server's LoginNeed: the box the failed turn ran on (empty for this box) and its name. */
interface LoginNeed {
  host: string;
  label: string;
}
const sameNeed = (a: LoginNeed | null, b: LoginNeed | null): boolean =>
  a === b || (a !== null && b !== null && a.host === b.host && a.label === b.label);

/** The card above the composer after a turn failed for want of a login on its box: the same login
 *  the Boxes row runs, here so nobody has to find Settings. It only ever follows a failed turn, so a
 *  box nobody uses never asks. Once the token is stored the server clears the need and the next poll
 *  takes the card down; until then it says what to do next. */
function LoginCard({ need, onDismiss }: { need: LoginNeed; onDismiss: () => void }) {
  const [done, setDone] = useState(false);
  const { login, setLogin, startLogin, submitLogin } = useLoginFlow(() => setDone(true));
  const where = need.host ? need.label : "this box";
  return (
    <div
      data-omc-login-card={need.host || "this-box"}
      role="status"
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Spark size={14} />
        <span style={{ flex: 1 }}>
          {done ? "Logged in. Send your message again." : `Claude Code on ${where} is logged out.`}
        </span>
        {!done && !login && (
          <button
            type="button"
            style={btn}
            data-testid="dsh-oh-my-claude-card-login"
            onClick={() => startLogin(need.host)}
          >
            Log in
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss login card"
          title="Dismiss"
          onClick={onDismiss}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 2px",
            color: T.faint,
          }}
        >
          ×
        </button>
      </div>
      {login && !done && <LoginSteps login={login} setLogin={setLogin} submit={submitLogin} />}
    </div>
  );
}

function AsideBubble({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const [items, setItems] = useState<AsideItem[]>([]);
  // What the poll compares its answer against, without listing `items` as a dependency of its effect.
  const itemsRef = useRef<AsideItem[]>([]);
  itemsRef.current = items;
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  /** The box whose login the last turn wanted, from the same poll; null once a turn or a login
   *  clears it on the server. Dismissal is this tab's alone. */
  const [need, setNeed] = useState<LoginNeed | null>(null);
  const [needDismissed, setNeedDismissed] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Only the newest card starts open; the rest fold to their header row, so a stack of answers costs
  // the composer one line each rather than a screen. A click flips a card either way.
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const visibleRef = useRef(true);

  useEffect(() => {
    // Poll this session's asides unconditionally — do NOT gate on `activeClaudeSession`. That reads
    // the session's provider binding, which is briefly undefined during a restart/reattach; gating
    // the poll on it here meant that if the effect ran in that window the interval never installed
    // and, with deps `[ctx, sessionId]` stable, never retried, so the card died for good ("gone with
    // no way to get it back"). The card only mounts for the open composer's session and its data is
    // this session's own server-persisted asides, so an unconditional per-session poll is correct.
    let alive = true;
    const fetchItems = async () => {
      try {
        const r = await fetch(`${ROUTE}/side-questions?session=${encodeURIComponent(sessionId)}`);
        if (!r.ok) return;
        // SAFETY: our own JSON route; the union names both shapes the caller checks.
        const body = (await r.json()) as
          | { items: AsideItem[]; loginNeeded?: LoginNeed | null }
          | { error: string };
        if ("error" in body) return;
        if (alive) {
          const nextNeed = body.loginNeeded ?? null;
          setNeed((cur) => (sameNeed(cur, nextNeed) ? cur : nextNeed));
        }
        // A fresh array every three seconds re-rendered the dock in every conversation forever,
        // answer or no answer; only a list that actually moved is worth a render.
        const next = body.items ?? [];
        if (alive && JSON.stringify(next) !== JSON.stringify(itemsRef.current)) setItems(next);
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

  // Server-side `dismissed` (a closed card, which the route marks and keeps) and the local set (this
  // click, before the next poll confirms it) both hide a card here. The entry itself stays in the ring
  // for the panel's Asides tab.
  const shown = items.filter((it) => !it.dismissed && !dismissed.has(it.id));
  // No `activeClaudeSession` gate here either: the card shows this session's own persisted asides,
  // which only exist for a Claude session, so an empty list is the only reason to hide it. Reading
  // the provider binding at render blinked the card out whenever the binding reloaded.
  const loginCard = need && needDismissed !== need.host ? need : null;
  if (shown.length === 0 && !loginCard) return null;

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
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const newest = shown[shown.length - 1]?.id;

  const iconBtn = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0 2px",
    lineHeight: 1,
    flex: "0 0 auto",
  } as const;

  return (
    <div {...{ [DOCK_ATTR]: "1" }} style={DOCK_CARD}>
      {loginCard && (
        <LoginCard need={loginCard} onDismiss={() => setNeedDismissed(loginCard.host)} />
      )}
      {shown.map((it) => {
        const open = (it.id === newest) !== toggled.has(it.id);
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
              <Spark size={12} />
              <span
                style={{
                  color: ACCENT,
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
                  color: copied === it.id ? ACCENT : T.muted,
                  fontSize: 11,
                }}
              >
                {copied === it.id ? "Copied" : "Copy"}
              </button>
              {/* Up when collapsed, down when open — same convention as the queue dock. */}
              <Chevron open={open} />
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
              // A very tall answer scrolls inside the card rather than pushing the composer down.
              <div style={{ padding: "0 10px 8px 24px", maxHeight: "40vh", overflow: "auto" }}>
                {it.pending ? (
                  <div style={{ color: ACCENT, fontSize: 12, fontStyle: "italic" }}>
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

/** `$18.21 · $0.42 last`: the session total, newest turn, and cached tokens. The Claude mark
 *  goes in front of it by whoever draws it: the spark SVG in the pill, the glyph in a text row. */
const costText = (total: number, last: number, cacheRead: number = 0) => {
  let text = `${fmtCost(total)} · ${fmtCost(last)} last`;
  const cached = formatCacheRead(cacheRead);
  if (cached) text += ` · ${cached} cached`;
  return text;
};

/** A token count for the dialog: `0` rather than the readout's blank for none. */
const fmtTokens = (n: number): string => formatCacheRead(n) || "0";

/** The rows of the cost dialog, label and value, from the session's turn records. */
export const costDetails = (turns: TurnRecord[]): [string, string][] => {
  const sum = (pick: (r: TurnRecord) => number) => turns.reduce((s, r) => s + pick(r), 0);
  const last = turns[turns.length - 1];
  const totals = {
    input: sum((r) => r.input),
    cacheRead: sum((r) => r.cacheRead),
    cacheWrite: sum((r) => r.cacheWrite),
  };
  const rows: [string, string][] = [
    ["Last turn", fmtCost(last?.costUsd ?? 0)],
    ["Turns", String(turns.length)],
    ["Wall time", fmtDuration(sum((r) => r.durationMs))],
    ["API time", fmtDuration(sum((r) => r.apiMs))],
    ["Input", fmtTokens(totals.input)],
    ["Cache read", fmtTokens(totals.cacheRead)],
  ];
  if (totals.cacheWrite > 0) rows.push(["Cache write", fmtTokens(totals.cacheWrite)]);
  rows.push(["Output", fmtTokens(sum((r) => r.output))]);
  if (totals.input + totals.cacheRead + totals.cacheWrite > 0)
    rows.push(["Cache hit", `${Math.round(cacheShare(totals) * 100)}%`]);
  if (last?.ttftMs !== undefined && last.ttftMs > 0)
    rows.push([
      "First token",
      last.ttftMs < 1000 ? `${Math.round(last.ttftMs)}ms` : `${(last.ttftMs / 1000).toFixed(1)}s`,
    ]);
  return rows;
};

/** dsh's `stat-dialog.module.css` (ui-chat), rule for rule, on this plugin's own hooks: the hashed
 *  class names change with every dsh build, the design tokens do not. */
const COST_DIALOG_CSS =
  "[data-omc-cost-dialog]{z-index:1100;box-sizing:border-box;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:16px;font-size:12px;line-height:18px;position:fixed}" +
  "[data-omc-cost-title]{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}" +
  "[data-omc-cost-title-label]{align-items:center;gap:6px;min-width:0;display:inline-flex}" +
  "[data-omc-cost-title-label] svg{flex:none;width:14px;height:14px}" +
  "[data-omc-cost-title-value]{font-variant-numeric:tabular-nums}" +
  "[data-omc-cost-rule]{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}" +
  "[data-omc-cost-details]{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}" +
  "[data-omc-cost-details] dt,[data-omc-cost-details] dd{min-width:0;margin:0}" +
  "[data-omc-cost-details] dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}" +
  "[data-omc-cost-guard]{margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px}" +
  "[data-omc-cost-guard] label{display:inline-flex;align-items:center;gap:4px}" +
  "[data-omc-cost-guard] input{width:64px;font:inherit;color:inherit;background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.1));border:0;border-radius:6px;padding:2px 6px}" +
  "[data-omc-cost-guard] button{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;cursor:pointer}" +
  "[data-omc-cost-note]{flex-basis:100%;margin:4px 0 0;color:var(--dsw-alias-label-tertiary)}";

/** dsh's unplaced-portal style: mounted so it can be measured, invisible until it has coordinates. */
const MEASURE_STYLE: CSSProperties = { visibility: "hidden", left: 0, top: 0 };

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
  watchUltrathink(ctx);
  watchToolFolds();

  // The Claude look: apply the stored switches once the hints load, and again on every change
  // (a Settings switch dispatches HINTS_EVENT after its POST). Removed with the module, like the
  // interval in watchTurnStatus, so a hot reload does not stack listeners.
  const reapplyTheme = () => void loadHints().then(applyTheme, console.error);
  // The sheets read bare var(--omc-accent); until the hints land nothing has set it and a fresh
  // page would paint the status row, links and rules unaccented for a fetch. Write the defaults
  // now, synchronously; the stored switches overwrite them a moment later.
  applyTheme({});
  reapplyTheme();
  window.addEventListener(HINTS_EVENT, reapplyTheme);
  whenContextGone(() => window.removeEventListener(HINTS_EVENT, reapplyTheme));

  const SECTION_LABEL = "Oh My Claude";

  /**
   * Renders nothing; on each mount and update finds the settings nav row labelled SECTION_LABEL
   * (by role and text, not by dsh's hashed classes) and puts the spark where dsh drew its gear,
   * keeping the gear's class so the row lays out as before. Idempotent: a swapped row is marked.
   */
  function SectionNavIcon() {
    useEffect(() => {
      const cell = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"] nav button'),
      ).find((b) => b.textContent?.trim() === SECTION_LABEL);
      const gear = cell?.querySelector("svg");
      if (!gear || gear.hasAttribute("data-omc-spark")) return;
      const spark = sparkNode(16, "currentColor");
      spark.setAttribute("class", gear.getAttribute("class") ?? "");
      spark.setAttribute("data-omc-spark", "1");
      gear.replaceWith(spark);
    });
    return null;
  }

  function Section(props: { close?: () => void }) {
    const [boxes, setBoxes] = useState<BoxData[]>([]);
    const [openBoxes, setOpenBoxes] = useState(true);
    const [openSessions, setOpenSessions] = useState(false);
    const [openReport, setOpenReport] = useState(false);
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
      <div data-omc-settings="">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Spark size={16} />
          <h2 id="dsh-oh-my-claude-heading" style={{ margin: 0, fontSize: 18 }}>
            Oh My Claude
          </h2>
          {/* A newer plugin on npm is a fact about the plugin, so it sits by its name, not in a
              box row: the one place everyone who opens this section looks. */}
          <span style={{ marginLeft: "auto" }}>
            <PluginUpdateBadge />
          </span>
        </div>
        <ThemeSwitch />
        <StarterSwitch />
        <UpdateNoticeSwitch />
        <WorkspaceModelSwitch />
        <ReturnRecapSwitch />
        <SpendGuardField />
        <TerminalSyncSwitch />
        {error && <p style={{ color: T.err, fontSize: 13 }}>{error}</p>}
        {boxes !== null && (
          <Card
            id="dsh-oh-my-claude-sessions-card"
            title="Archived Sessions"
            summary="Claude Code transcripts on every box: open one here, import, download, or move."
            open={openSessions}
            onToggle={() => setOpenSessions((v) => !v)}
          >
            <Sessions ctx={ctx} boxes={boxes} close={props.close} />
          </Card>
        )}
        {boxes !== null && (
          <Boxes
            ctx={ctx}
            boxes={boxes}
            setBoxes={setBoxes}
            open={openBoxes}
            onToggle={() => setOpenBoxes((v) => !v)}
          />
        )}
        <Card
          id="dsh-oh-my-claude-report-card"
          title="Report a problem"
          summary="A masked report of this box for a GitHub issue: versions, login state, switches, last error."
          open={openReport}
          onToggle={() => setOpenReport((v) => !v)}
        >
          <ReportBlock />
        </Card>
      </div>
    );
  }

  ctx.slots.inject("settings.section", () => {
    ctx.slots.register(
      {
        name: "settings.section",
        id: "claude-code-sessions",
        order: 19,
        label: SECTION_LABEL,
        inject: () => ({}),
      },
      Section,
    );
    return null;
  });

  // dsh draws a settings nav glyph per section id and gives every other id its gear; the slot
  // spec has no field for one. `settings.action` is a list slot in the dialog's header that
  // mounts whenever the dialog opens (`settings.header` is single, dsh's own title holds it), so
  // a registrant there that renders nothing can swap our row's gear for the spark, in the row's
  // own text colour like dsh's glyphs.
  ctx.slots.inject("settings.action", () => {
    ctx.slots.register(
      { name: "settings.action", id: "claude-nav-icon", order: 99, inject: () => ({}) },
      SectionNavIcon,
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
    // Above the aside so a fresh tab reads top-down: what to type first, then anything that answered
    // later. dsh hands composer-slot entries the composer's own `inputActions` and `useInput`, which
    // is what lets the card fill the box without sending it.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-starter", order: 44 },
      (props) => <StarterSlot {...props} ctx={ctx} />,
    );
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-draft-relay", order: 43 },
      (props) => <DraftRelay {...props} />,
    );
    // The tool headers' icons are cloned out of this hidden sheet; it rides along with the dock
    // because that is mounted wherever a conversation is, which is the only place headers exist.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-tool-icons", order: 46 },
      () => <ToolIconSprites />,
    );
    // Renderless: applies the workspace's remembered Claude model to a blank session.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-workspace-model", order: 47 },
      (props) =>
        props.sessionId ? <WorkspaceModelMemory sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    return null;
  });

  // Add workspace, with a box to pick it on. Renderless until dsh's sidebar "+" is clicked, and
  // dormant unless an SSH box is saved; the sidebar footer is where a root-scoped entry stays
  // mounted whether the sidebar is wide or collapsed.
  ctx.slots.inject("sidebar.footer.action", () => {
    ctx.slots.register(
      { name: "sidebar.footer.action", id: "claude-add-workspace", order: 90 },
      () => <AddWorkspaceFlow ctx={ctx} />,
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
