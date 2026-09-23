// Browser half: Settings → "Oh My Claude". A branded header, then two cards: Sessions (one
// transcript list across this box and every saved box. Filter by box, workspace, origin; open
// here or jump to the box) and Boxes (this box as the first row, plus the ssh and linked-dsh
// machines you add, each probed for claude version and login). Built into lib/client.js by
// `bun run build`.
import { activeLocale, installLocale, type OmcKey, onLocaleSwitch, t, useLocale } from "./i18n.js";
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
  Menu,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
  IconAgentPresetOutlineMedium,
  IconApiOutlineRegular,
  IconBrowseOutlineMedium,
  IconChecklistOutlineRegular,
  IconChevronDownOutlineRegular,
  IconCodeOutlineMedium,
  IconEditOutlineMedium,
  IconListPenOutlineMedium,
  IconSearchOutlineMedium,
  IconSkillOutlineMedium,
  IconSparkleMedium,
} from "./icons.js";
import {
  ROUTE,
  useNarrow,
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
  claudeMount,
  type ClientCtx,
  type DirectoryFlowOwnerProps,
  openHere,
  openSession,
  openSessionId,
  maskEmail,
  numberOr,
  whenContextGone,
  guard,
  retire,
  revive,
  keywordMatches,
  controlStatesCss,
  resumeCommand,
  saveBlob,
  nested,
} from "./shared.js";
import { themeOf, hexToRgb, type ThemeGroup } from "./theme.js";
import { PluginUpdateBadge, StarNudge } from "./update-pill.js";
import { isNewer } from "../update.js";
import { livingModelId } from "../model-ids.js";
import type { FallbackRecord } from "../translator.js";
import { ReportBlock } from "./report.js";
import { ChangelogBlock } from "./changelog.js";
import { Spark, sparkNode } from "./spark.js";
import { AccessShield, AccessTrigger, OhMyClaudeControl, sessionLabel } from "./panel.js";
import { ConfirmButton } from "./tune.js";
import {
  AddWorkflow,
  AddWorkspaceFlow,
  BOXES_EVENT,
  canBrowseDirs,
  OPEN_EVENT,
  RW_EVENT,
} from "./picker.js";
import { ClaudeUpdateDetails } from "./claude-updates.js";
import { type LimitLevel, worstLimit } from "./limits.js";
import { SearchField } from "./search-field.js";
import { Switch } from "./switch.js";
import type { ToolMode, ToolModeInfo } from "../rows-probe.js";
import { takeDraft, subscribeDraft, noteDraft, draftPending } from "./draft.js";
import {
  awaitingBody,
  markTitle,
  newlyAwaiting,
  newlyWaiting,
  noticesOn,
  recapNext,
  recapOnIn,
  recapAwayIn,
  RECAP_AWAY_MS,
  RECAP_AWAY_CHOICES,
  RECAP_QUESTION,
  type AwaitingRow,
  type NoticeSnapshot,
} from "./notices.js";
import { SETTINGS_SCOPES, SCOPE_LABELS, overrideNote } from "./settings.js";
import type { SettingsScope, SettingsScopeInfo } from "./settings.js";
// Type only, so nothing from the server half reaches the bundle: the row renders what the route
// answered, and the route is the only thing that knows how to work the answer out.
import type { ClaudeMdState } from "../switches.js";
import {
  type ChatFlowNode,
  contextDrops,
  maskedRows,
  MASTER_KEY,
  OFF_KEY,
} from "../context-sources.js";
export { type SessionData, isOwnedActive, fmtCost, fmtDuration, cacheShare };

/** Deep link another box's panel sends us to: `#claude-session=<id>&cwd=<path>`. */
const HASH_KEY = "claude-session";
/** A row's identity in the list: the same transcript id can sit on two boxes. */
const rowKey = (r: { g: { key: string }; s: { id: string } }): string => `${r.g.key}-${r.s.id}`;

/** A file name a person can read back later; the id keeps it unique. */
const slugFile = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "claude";

/** A byte count for a session row: whole KB under a megabyte, MB with one decimal above. */
const size = (bytes: number): string =>
  bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
/** `/home/me/Projects/app` → `Projects/app`; keeps the full path for the title attribute. */
const shortPath = (p: string | undefined): string => {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : p;
};

/** The client bundle's name, exported so dsh can identify this plugin. */
export const name = "dsh-oh-my-claude-client";
/** Services injected into the client plugin by dsh. */
export const inject = ["slots", "sessions", "workspaces", "modelDirectories"];

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
/** JSON.parse hands back one of six shapes; this tells the plain object apart. */
const isObj = (v: Json | undefined): v is JsonObject => v instanceof Object && !Array.isArray(v);
/** Counts items in a parsed value: array length, object keys, or 0 when v is neither. */
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

/** The Chinese stand-in for the CLI's verbs, which exist only in English and are mostly puns
 *  (Razzle-dazzling, Flibbertigibbeting) that do not survive translation. Not a translation: the same
 *  register instead, cheeky and mock-grand, kitchen, magic and workshop, so a Chinese reader gets the
 *  joke the English one does. */
const ZH_VERBS = [
  "琢磨中",
  "捣鼓中",
  "鼓捣中",
  "酝酿中",
  "盘算中",
  "掐指一算中",
  "冥思苦想中",
  "绞尽脑汁中",
  "抓耳挠腮中",
  "炼丹中",
  "文火慢炖中",
  "爆炒中",
  "腌制中",
  "发酵中",
  "揉面中",
  "撒葱花中",
  "施法中",
  "念咒中",
  "画符中",
  "变戏法中",
  "搓火球中",
  "开光中",
  "算卦中",
  "观星中",
  "灵光乍现中",
  "脑洞大开中",
  "头脑风暴中",
  "抽丝剥茧中",
  "顺藤摸瓜中",
  "精雕细琢中",
  "妙笔生花中",
  "运筹帷幄中",
  "天马行空中",
  "左思右想中",
  "融会贯通中",
  "化繁为简中",
  "胸有成竹中",
  "举一反三中",
  "画龙点睛中",
  "整活中",
  "憋大招中",
  "打怪升级中",
  "疯狂输出中",
  "加载灵感中",
  "充能中",
  "量子纠缠中",
  "转圈圈中",
  "蹦跶中",
  "嘀咕中",
  "叽里咕噜中",
  "手舞足蹈中",
  "一本正经中",
  "搬砖中",
  "敲敲打打中",
  "修修补补中",
  "拼乐高中",
  "打磨中",
  "抛光中",
  "煲汤中",
  "假装很忙中",
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

/** Where a transcript lives: terminal only, a live dsh session, or an archived one. */
function Origin({ s }: { s: { dsh?: { archived?: boolean; id?: string }; imported?: boolean } }) {
  useLocale();
  if (s.imported) return <span style={pill(T.brand)}>{t("main.origin.imported")}</span>;
  if (!s.dsh) return <span style={pill(T.faint)}>{t("main.origin.terminal")}</span>;
  if (s.dsh.archived) return <span style={pill(T.warn)}>{t("main.origin.archived")}</span>;
  return <span style={pill(T.brand)}>dsh</span>;
}
/** Returns a box's origin: terminal, archived or dsh, and terminal when it has no dsh record. */
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
  /** An SSH box: transcripts live on its host, reachable only over ssh. No HTTP box to jump to. */
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
    /** When set, only sessions whose id is in this set survive, and the typed query stops
     *  filtering titles: a deep search has already run that query over the messages, and a session
     *  whose title happens not to hold the phrase is the whole reason to run one. */
    deepIds?: ReadonlySet<string>;
    shown: Record<string, number>;
  },
) {
  const { box, cwd, origin, query = "", shown, deepIds } = filters;
  const hidden: Record<string, number> = {};
  const matched: Record<string, number> = {};
  const keep = (s: SessionData) =>
    (deepIds === undefined || deepIds.has(s.id)) &&
    (cwd === "all" || s.cwd === cwd) &&
    (origin === "all" || originOf(s) === origin) &&
    // A deep search replaces the title filter rather than narrowing it. Applying both threw every
    // result away: the typed phrase is in the messages, not the titles, which is the only reason
    // anyone presses the button. Caught in the browser on 2026-09-20, 59 hits rendering as 0 rows.
    (deepIds !== undefined || matchesQuery(s, query));
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
  useLocale();
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
  // A deep search's answer: the matching session ids, each with the snippet the route cut. Null
  // means no deep search is running or finished, which is the ordinary list. An empty map is a
  // search that found nothing, which is not the same thing.
  const [deep, setDeep] = useState<Map<string, { snippet: string; count: number }> | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepNote, setDeepNote] = useState("");
  const [deepScope, setDeepScope] = useState<"workspace" | "box">("workspace");
  // The ids a deep search keeps, rebuilt only when `deep` changes: a fresh Set on every render
  // would make the paged list memo recompute each keystroke, so it is keyed on `deep` here.
  const deepIds = useMemo(() => (deep === null ? undefined : new Set(deep.keys())), [deep]);
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
        name: local.host ?? t("main.sessions.thisBox"),
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
        error: r
          ? r.error
          : remoteLoading
            ? t("main.sessions.checking")
            : t("main.sessions.unchecked"),
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
        error: s.ok ? undefined : (s.error ?? t("main.sessions.unreachable")),
        sessions: s.sessions ?? [],
        sshBox: true,
        provider: s.provider,
      });
    return out;
  }, [local, remote, ssh, boxes, remoteLoading]);

  // Rows in box order, newest first within each box, capped to that box's `shown` count. `hidden`
  // and `matched` are per box so the footer can offer "Load more"/"Load all" and count the rest.
  const paged = useMemo(
    () => pageSessions(groups, { box, cwd, origin, query, shown, deepIds }),
    [groups, box, cwd, origin, query, shown, deepIds],
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
      // `sessions.open` alone would leave an archived row archived. The "Restore" no-op just seen.
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
        setError(t("main.sessions.pickModel", { name: r.g.name }));
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
        openSession(ctx, r.s.id);
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
  // ponytail: one file per ticked row rather than a zip. No archive dependency, and a browser
  // saves a handful of sequential downloads without a prompt. Zip it if people tick dozens.
  const download = async () => {
    const wanted = rows.filter((r) => picked.has(rowKey(r)));
    setMoving(t("main.sessions.downloading", { n: wanted.length }));
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
        setMoving(t("copied"));
        setTimeout(() => setMoving(""), 1600);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMoving(t("main.sessions.importing", { n: files.length }));
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
        if (!body.id)
          throw new Error(`${f.name}: ${body.error ?? t("main.sessions.importFailed")}`);
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving("");
    }
  };

  const runDeep = async () => {
    setDeepBusy(true);
    setDeepNote("");
    try {
      // The route needs an absolute path when the scope is `workspace`; the panel's cwd filter is
      // the string "all", not a path. Read the workspace the panel is open in the way context-sizes
      // and claude-md do, using the open session's own cwd, and widen to box when there is no path.
      let scope = deepScope;
      let cwdParam = cwd === "all" ? "" : cwd;
      if (scope === "workspace" && cwdParam === "") {
        const snap = ctx.sessions.list.getSnapshot();
        const openId = openSessionId(ctx);
        cwdParam = (openId ? snap?.byId[openId]?.cwd : "") ?? "";
        if (cwdParam === "") scope = "box";
      }
      const url = `${ROUTE}/search?q=${encodeURIComponent(query.trim())}&scope=${scope}&cwd=${encodeURIComponent(cwdParam)}`;
      const body = await readJson<{
        hits?: Array<{ id: string; snippet: string; count: number }>;
        scanned?: number;
        tookMs?: number;
        truncated?: boolean;
        error?: string;
      }>(await fetch(url));
      if (body.error !== undefined) {
        setDeepNote(t("main.sessions.searchFailed", { error: body.error }));
        setDeep(null);
        return;
      }
      const hits = body.hits ?? [];
      setDeep(new Map(hits.map((h) => [h.id, { snippet: h.snippet, count: h.count }])));
      setDeepNote(
        hits.length === 0
          ? t("main.sessions.deepNone", { q: query.trim() })
          : t(hits.length === 1 ? "main.sessions.deepHitsOne" : "main.sessions.deepHitsOther", {
              n: hits.length,
              q: query.trim(),
              scanned: body.scanned ?? 0,
              ms: body.tookMs ?? 0,
              more: body.truncated === true ? t("main.sessions.deepMore") : "",
            }),
      );
    } catch (e) {
      setDeepNote(
        t("main.sessions.searchFailed", {
          error: e instanceof Error ? e.message : t("main.sessions.unknownError"),
        }),
      );
      setDeep(null);
    } finally {
      setDeepBusy(false);
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
          {loading ? t("loading") : t("main.sessions.count", { shown: rows.length, total })}
          {remoteLoading ? t("main.sessions.checkingBoxes") : ""}
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
              {t("main.sessions.download", { n: picked.size })}
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
            title={t("main.sessions.importTitle")}
            onClick={() => fileInput.current?.click()}
          >
            {t("main.sessions.import")}
          </button>
          <button type="button" style={btn} disabled={loading} onClick={load}>
            {t("main.sessions.refresh")}
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
          title={t("main.sessions.box")}
        >
          <option value="all">{t("main.sessions.allBoxes")}</option>
          {groups.map((g) => (
            <option key={g.key} value={g.key} disabled={!g.ok} title={g.ok ? g.host : g.error}>
              {g.name}
              {g.key === "local" ? t("main.sessions.here") : ""}
              {g.ok ? ` · ${g.sessions.length}` : t("main.sessions.offline")}
            </option>
          ))}
        </select>
        <select
          id="dsh-oh-my-claude-cwd-filter"
          style={filterSelect}
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          title={t("main.sessions.workspace")}
        >
          <option value="all">{t("main.sessions.allWorkspaces")}</option>
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
          title={t("main.sessions.origin")}
        >
          <option value="all">{t("main.sessions.anyOrigin")}</option>
          <option value="dsh">{t("main.sessions.inDsh")}</option>
          <option value="archived">{t("main.sessions.archived")}</option>
          <option value="terminal">{t("main.sessions.terminalOnly")}</option>
        </select>
        <SearchField
          id="dsh-oh-my-claude-session-search"
          // 160 px, or the card's whole width when that is less: dsh's Settings leaves about 100 px
          // for a section at phone width, and a fixed minimum spilled past the card's edge.
          style={{ flex: "2 1 200px", minWidth: "min(160px, 100%)" }}
          value={query}
          placeholder={t("main.sessions.searchPlaceholder")}
          label={t("main.sessions.searchLabel")}
          onChange={setQuery}
        />
        <select
          data-omc-search-scope=""
          aria-label={t("main.sessions.searchScope")}
          style={{ ...filterSelect, flexBasis: 150 }}
          value={deepScope}
          onChange={(e) => setDeepScope(e.target.value === "box" ? "box" : "workspace")}
        >
          <option value="workspace">{t("main.sessions.scopeWorkspace")}</option>
          <option value="box">{t("main.sessions.scopeBox")}</option>
        </select>
        <button
          type="button"
          id="dsh-oh-my-claude-search-transcripts"
          data-omc-search-transcripts=""
          aria-label={t("main.sessions.searchInside")}
          style={btn}
          disabled={deepBusy || query.trim().length < 2}
          onClick={() => void runDeep()}
        >
          {deepBusy ? t("main.sessions.searching") : t("main.sessions.searchTranscripts")}
        </button>
        {deep !== null && (
          <button
            type="button"
            data-omc-search-clear=""
            style={btn}
            onClick={() => {
              setDeep(null);
              setDeepNote("");
            }}
          >
            {t("main.sessions.backToAll")}
          </button>
        )}
      </div>
      {deepNote !== "" && (
        <p
          data-omc-search-status=""
          // No role="status" here. The plugin's own turn-status writer claims every
          // [role="status"][aria-live="polite"] element on the page and replaces its text with the
          // running turn's spinner, which ate this line in the browser. aria-live alone announces
          // it without matching that selector.
          aria-live="polite"
          style={{ ...meta, marginTop: 8 }}
        >
          {deepNote}
        </p>
      )}
      {deep !== null && (
        <p data-omc-search-caveat="" style={{ ...meta, marginTop: 4 }}>
          {t("main.sessions.caveat")}
        </p>
      )}
      {error && (
        <p id="dsh-oh-my-claude-error" style={{ color: T.err, fontSize: 13, margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      {!loading && rows.length === 0 && (
        <p id="dsh-oh-my-claude-empty" style={{ ...meta, marginTop: 10 }}>
          {t("main.sessions.empty")}
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
            ? t("main.sessions.opening")
            : !isLocal && !isSsh
              ? t("main.sessions.openOn", { name: r.g.name })
              : opened
                ? t("main.sessions.show")
                : r.s.dsh?.archived
                  ? t("main.sessions.restore")
                  : t("main.sessions.open");
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
                aria-label={t("main.sessions.select", { name: sessionLabel(r.s) })}
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
                  title={sessionLabel(r.s)}
                >
                  {sessionLabel(r.s)}
                </div>
                {deep?.get(r.s.id) !== undefined && (
                  <div
                    data-omc-search-snippet=""
                    style={{
                      ...meta,
                      marginTop: 3,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {deep.get(r.s.id)?.snippet}
                  </div>
                )}
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
                    {r.s.turnsPartial ? "+" : ""} {t("main.sessions.prompts")} · {size(r.s.bytes)} ·{" "}
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
                    { id: "jsonl", label: t("main.sessions.downloadJsonl") },
                    { id: "md", label: t("main.sessions.exportMarkdown") },
                    { id: "resume", label: t("main.sessions.copyResume") },
                  ]}
                  onSelect={(id) => void rowAction(r, id)}
                  side="top"
                  portal
                  anchor={
                    <button
                      type="button"
                      aria-label={t("main.sessions.moreActions")}
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
              {t("main.sessions.loadMore", { n: Math.min(PAGE, more) })}
            </button>
            {grown && (
              <button
                type="button"
                style={btn}
                onClick={() =>
                  setShown((m) => ({ ...m, [moreKey]: paged.matched[moreKey] ?? PAGE }))
                }
              >
                {t("main.sessions.loadAll", { n: paged.matched[moreKey] ?? "" })}
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

/** Login state for one box plus the start and submit handlers; each step POSTs to a login route. */
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

/** Renders one login's steps: the sign-in link, the paste area and the poll. */
function LoginSteps({
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
function Boxes({ ctx, boxes, setBoxes, open, onToggle }: BoxesProps) {
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
  severity?: string;
  model?: string;
  kind?: "session" | "weekly";
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
const whose = (r: UsageReply): string => {
  const email = r.email ? maskEmail(r.email) : "";
  const host = r.host ?? "";
  if (email && host) return t("main.usage.whoOn", { email, host });
  return email || host;
};

/** "in 2 h 10 min" inside a day, else weekday and time. */
const resetText = (at: number | null): string => {
  if (at === null) return "";
  const ms = at - Date.now();
  if (ms <= 0) return t("main.usage.resetsNow");
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return h ? t("main.usage.resetsInH", { h, m }) : t("main.usage.resetsInM", { m });
  }
  return t("main.usage.resetsAt", {
    when: new Date(at).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }),
  });
};

// Per provider: two plugin instances are two accounts, so two answers.
const usageCache = new Map<string, { at: number; reply: UsageReply }>();
/** Fetches a provider's usage, cached 60 s, so a repeat call returns the cached value. */
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

type ContextReply =
  | {
      ok: true;
      categories: Array<{
        name: string;
        tokens: number;
        deferred: boolean;
        kind?: "used" | "free" | "buffer" | "deferred";
      }>;
      totalTokens: number;
      maxTokens: number;
      percentage: number;
      model?: string;
      assumedBehind?: string;
      followsNext?: true;
    }
  | { ok: false; error: string };
// The breakdown is re-read whenever dsh re-renders the meter's dialog, which is on every repaint of
// the percentage while a turn runs. The promise is cached, not its answer, so the frames that arrive
// before the first one lands share it instead of each opening a request of their own.
const contextCache = new Map<string, { at: number; reply: Promise<ContextReply> }>();
/** Fetches a session's context breakdown, cached 10 s, returning an error when the fetch fails. */
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
/** Formats a token count the way the CLI does: `1.2M`, `12.3k` or plain. */
const kTokens = (n: number) =>
  n >= 1_000_000
    ? `${Number((n / 1_000_000).toFixed(1))}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
      : String(n);
/**
 * Rows worth a line: the ones whose tokens are the conversation. The CLI's `kind` is the authority.
 * It says so in the field's own description, "classify on this, never on the English name". And
 * it is what keeps the free space and the compaction buffer out, neither of which is content and
 * neither of which is counted in `totalTokens` either. The name test is the fallback for a CLI too
 * old to send `kind`; it misses the buffer rows, which is what this whole readout used to do.
 */
const isUsedRow = (c: { name: string; deferred: boolean; kind?: string }): boolean =>
  c.kind !== undefined
    ? c.kind === "used"
    : !c.deferred && c.name !== "Free space" && !/buffer$/i.test(c.name);
/**
 * A colour per breakdown row, by position. dsh's own meter paints three bands and names them in a
 * legend; this keeps that shape over the CLI's categories, which are more numerous and vary with
 * what a session loaded. Position rather than name because the names are the CLI's to change, and a
 * swatch that drifts one hue is a smaller wrong than a classification that reads the name and is
 * believed, the same reason `isUsedRow` asks `kind` instead. The order opens on the neutral grey,
 * purple and blue dsh itself uses, so the block still reads as part of its meter.
 */
const SEGMENT_COLORS = [
  "#8b8f98",
  "#a855f7",
  "#3b82f6",
  "#14b8a6",
  "#f59e0b",
  "#ec4899",
  "#22c55e",
  "#6366f1",
];

/** The CLI's context category names, which it sends in English only. A name not listed here (one a
 *  newer CLI adds) shows as sent rather than disappearing. */
const CATEGORY_KEYS = new Map<string, OmcKey>([
  ["System prompt", "main.usage.catSystemPrompt"],
  ["System tools", "main.usage.catSystemTools"],
  ["MCP tools", "main.usage.catMcpTools"],
  ["Custom agents", "main.usage.catCustomAgents"],
  ["Memory files", "main.usage.catMemoryFiles"],
  ["Skills", "main.usage.catSkills"],
  ["Messages", "main.usage.catMessages"],
]);
/** A context category's name in the reader's language, or the CLI's own name when it is new. */
const categoryName = (cliName: string): string => {
  const key = CATEGORY_KEYS.get(cliName);
  return key ? t(key) : cliName;
};

/** The meter's own readout, over the CLI's categories: a filled bar and one legend row each. */
function renderContext(el: HTMLElement, reply: ContextReply) {
  el.replaceChildren();
  if (!reply.ok) {
    el.textContent = t("main.usage.contextBreakdownErr", { error: reply.error });
    return;
  }
  const rows = reply.categories.filter((c) => c.tokens > 0 && isUsedRow(c));
  const head = document.createElement("div");
  head.style.cssText = `display:flex;justify-content:space-between;gap:12px;color:${T.text}`;
  const headLabel = document.createElement("span");
  headLabel.textContent = t("main.usage.contextUsed", { pct: Math.round(reply.percentage) });
  // The model whose window that percentage is against, so a session that switched models says so
  // rather than leaving the reader to assume the one they picked first.
  if (reply.model) {
    const on = document.createElement("span");
    on.style.color = T.faint;
    on.textContent = ` · ${reply.model}`;
    headLabel.append(on);
  }
  const headValue = document.createElement("span");
  headValue.style.cssText = `font-variant-numeric:tabular-nums;color:${T.faint};white-space:nowrap`;
  headValue.textContent = `${kTokens(reply.totalTokens)} / ${kTokens(reply.maxTokens)}`;
  head.append(headLabel, headValue);
  // The CLI's window is a guess here, and it says so: name the switch rather than show a second
  // figure the CLI does not act on.
  const note = reply.assumedBehind ? document.createElement("div") : null;
  if (note) {
    note.setAttribute("data-omc-context-assumed", "");
    note.setAttribute("role", "note");
    note.style.cssText = `font-size:12px;color:${T.faint};margin-top:4px`;
    note.textContent = reply.followsNext
      ? t("main.usage.assumedNow", { max: kTokens(reply.maxTokens) })
      : t("main.usage.assumedBehind", {
          max: kTokens(reply.maxTokens),
          host: reply.assumedBehind ?? "",
        });
  }
  // The bar spans the whole window, so the empty tail is the room left. Segments are sized against
  // `maxTokens` rather than against each other, which is what makes the filled part read as the
  // percentage above it.
  const bar = document.createElement("div");
  bar.style.cssText = `display:flex;gap:1px;height:6px;margin:6px 0;border-radius:3px;overflow:hidden;background:${T.border}`;
  bar.setAttribute("role", "img");
  bar.setAttribute(
    "aria-label",
    t("main.usage.contextBarLabel", {
      pct: Math.round(reply.percentage),
      rows: rows.map((c) => `${categoryName(c.name)} ${kTokens(c.tokens)}`).join(", "),
    }),
  );
  const legend = document.createElement("div");
  rows.forEach((c, i) => {
    const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
    const seg = document.createElement("div");
    // A row worth a fraction of a percent still earns a sliver, so the legend never names a colour
    // the bar does not show.
    seg.style.cssText = `flex:0 0 auto;width:${Math.max((c.tokens / Math.max(reply.maxTokens, 1)) * 100, 0.4)}%;background:${color}`;
    bar.append(seg);
    const line = document.createElement("div");
    line.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px";
    const label = document.createElement("span");
    label.style.cssText = "display:flex;align-items:center;gap:6px;min-width:0";
    const dot = document.createElement("span");
    dot.style.cssText = `flex:0 0 auto;width:8px;height:8px;border-radius:2px;background:${color}`;
    const rowName = document.createElement("span");
    rowName.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    rowName.textContent = categoryName(c.name);
    label.append(dot, rowName);
    const val = document.createElement("span");
    val.style.cssText = "font-variant-numeric:tabular-nums;white-space:nowrap";
    val.textContent = kTokens(c.tokens);
    line.append(label, val);
    legend.append(line);
  });
  el.append(head, ...(note ? [note] : []), bar, legend);
}

/** Builds a link that opens in a new tab (noreferrer noopener) styled in the brand colour. */
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

/** Anthropic's credits sentence in the reader's language when it is the wording this was written
 *  against. Other wording shows as the API sent it: a guessed translation of new text would be the
 *  plugin's account of credits, not Anthropic's. The link inside keeps its address either way. */
const creditsNote = (note: string): string =>
  note
    .replace("Usage credits cover you when you hit your plan limits.", t("main.usage.creditsNote"))
    .replace("[Learn more](", `[${t("main.usage.learnMore")}](`);

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
  label.textContent = t("main.usage.extraUsage");
  label.style.cssText = `color:${T.text};font-weight:500`;
  const capped = c.enabled && c.capped;
  const amount = c.used ? ` · ${c.used}${c.limit ? ` / ${c.limit}` : ""}` : "";
  const value = document.createElement("span");
  value.textContent = `${capped ? t("main.usage.limitReached") : c.enabled ? t("main.usage.on") : t("main.usage.off")}${amount}`;
  value.style.cssText = `font-variant-numeric:tabular-nums;font-weight:600;color:${capped ? T.err : T.text}`;
  creditsLine.append(label, value);
  // No caption at all when the API neither explains credits nor lets this account buy them.
  if (c.note || c.canPurchase) {
    const caption = document.createElement("span");
    caption.style.cssText = `grid-column:1 / -1;color:${T.faint};font-size:11px;line-height:16px`;
    if (c.note) appendNote(caption, creditsNote(c.note));
    if (c.canPurchase) {
      if (c.note) caption.append(" ");
      caption.append(extLink(t("main.usage.buyCredits"), "https://claude.ai/settings/usage"));
    }
    creditsLine.append(caption);
  }
  return creditsLine;
}

/** A window's name in the reader's language: the plugin's word for the two plan windows and a
 *  model's weekly one, and the API's own kind name for a window this code has not met. */
const windowLabel = (w: UsageWindow): string =>
  w.kind === "session"
    ? t("main.usage.window5h")
    : w.kind === "weekly"
      ? t("main.usage.windowWeekly")
      : w.model
        ? t("main.usage.windowModelWeekly", { model: w.model })
        : w.label;

/** Fill a block with the usage rows, styled like the meter's own legend rows, or with the error
 *  text when the reply is not ok. */
function renderUsage(block: HTMLElement, reply: UsageReply) {
  block.replaceChildren();
  if (!reply.ok) {
    const p = document.createElement("div");
    p.textContent = t("main.usage.usageErr", { error: reply.error });
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
    label.textContent = windowLabel(w);
    label.style.cssText = `color:${T.text};font-weight:500`;
    const value = document.createElement("span");
    value.textContent = `${Math.round(pct)}%`;
    value.style.cssText = `font-variant-numeric:tabular-nums;font-weight:600;color:${tone}`;
    const bar = document.createElement("div");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute(
      "aria-label",
      t("main.usage.barLabel", { label: windowLabel(w), pct: Math.round(pct) }),
    );
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
    p.textContent = t("main.usage.noLimits");
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
/** Run every frame scan once with the records gathered this frame, or with none after an
 *  overflow, which a scan reads as "look at the whole body". */
const flushScans = () => {
  scanQueued = false;
  const records = pendingOverflow ? undefined : pending;
  pending = [];
  pendingOverflow = false;
  for (const scan of frameScans) scan(records);
};
/** Subscribes the given MutationObserver to document.body for added and removed nodes and for text
 *  rewritten in place. The last one matters: React updates a paragraph whose only child is text by
 *  setting that text node's value, so a `<p>` reused from prose into a tool header changed without a
 *  single childList record, and the header stayed bare until a reload swept the page. */
const observeBody = (observer: MutationObserver) => {
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
};
/** The element a record is about: its target, or for a text edit the element holding the text. */
const recordElement = (rec: MutationRecord): HTMLElement | null =>
  rec.target instanceof HTMLElement
    ? rec.target
    : rec.target.parentElement instanceof HTMLElement
      ? rec.target.parentElement
      : null;
/**
 * The elements a burst touched: each record's target plus whatever it added. A scan handed these
 * covers the same ground as one over `document.body`, because dsh only ever draws through the DOM.
 * The cost follows what changed rather than how long the conversation is.
 */
const changedElements = (records: MutationRecord[]): Set<HTMLElement> => {
  const nodes = new Set<HTMLElement>();
  for (const rec of records) {
    const el = recordElement(rec);
    if (el) nodes.add(el);
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
  // When the bundle is replaced, disconnect the observer and clear the scan sets.
  whenContextGone(() => {
    bodyObserver?.disconnect();
    bodyObserver = undefined;
    frameScans.clear();
    syncScans.clear();
  });
  bodyObserver = new MutationObserver((records) => {
    // The records are the point: a sync scan that walks only what changed costs the same on a long
    // transcript as on a short one. So the observer stays attached across the pass.
    // Detaching to avoid being called back by our own writes threw the records away, and a scan
    // with no records has nothing to scope itself to. The writes do call this back once more;
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

/**
 * Hide the meter's own context readout, leaving this plugin's block in its place.
 *
 * Selected structurally, every child of the host that is not ours, because dsh's class names are
 * generated and change under us on any upgrade, and there is nothing else in either host to keep:
 * the ring's popover and its hover bubble are both the context readout and nothing more. Re-applied
 * on each attach, since React rebuilds these children whenever it re-renders. Elements are hidden
 * rather than removed, so a dsh that later puts something else here is one line from being let back
 * through; a bare text node has no style to set, so it goes, and the next re-render restores it.
 *
 * The `hidden` attribute alone does not do it. It works through the user agent's `[hidden]{display:
 * none}`, which any class rule of dsh's outranks. Its own header carries `display:flex`, so the
 * row stayed on screen wearing `hidden=""`. The inline `!important` is what actually wins, and the
 * attribute stays for the accessibility tree.
 */
function hideNativeContext(host: HTMLElement, ours: HTMLElement) {
  for (const node of Array.from(host.childNodes)) {
    if (node === ours) continue;
    if (node instanceof HTMLElement) {
      node.hidden = true;
      node.style.setProperty("display", "none", "important");
    } else node.remove();
  }
}

/** Injects the plugin's usage block into a Claude row, re-hiding it when dsh puts its own back. */
function watchContextMeter(ctx: ClientCtx) {
  const MARK = "data-dsh-oh-my-claude-usage";
  // The mark goes on the node we inject, never on dsh's node: React owns these children and drops
  // ours whenever it re-renders the panel, and a mark on the host would say "done" forever while
  // the row it names is gone.
  // Our block, if this host already has one. A host that has it is done, except for the hiding,
  // which is about dsh's children rather than ours: React rebuilds those on every repaint of the
  // percentage, so a readout hidden a moment ago can be back beside a block that never left.
  const HID = "data-dsh-oh-my-claude-replaced";
  const ours = (host: HTMLElement) => host.querySelector<HTMLElement>(`:scope > [${MARK}]`);
  const rehide = (host: HTMLElement, block: HTMLElement) => {
    if (block.hasAttribute(HID)) hideNativeContext(host, block);
  };
  const attach = (panel: HTMLElement) => {
    const already = ours(panel);
    if (already) return rehide(panel, already);
    // Only sessions on a Claude mount: a local-model session's meter stays dsh's own.
    if (!activeClaudeSession(ctx)) return;
    const block = document.createElement("div");
    block.setAttribute(MARK, "1");
    block.style.cssText = `border-bottom:1px solid ${T.border};margin-bottom:10px;padding-bottom:8px;font-size:13px;line-height:20px`;
    const title = document.createElement("div");
    title.style.cssText = `display:flex;align-items:center;gap:6px;color:${T.text};font-weight:600`;
    const mark = sparkNode(13);
    const titleText = document.createElement("span");
    titleText.textContent = t("main.usage.title");
    title.append(mark, titleText);
    // Account and box on their own caption line: the email plus host wrapped the title before.
    // Flush left, not indented under the spark: it names the whole section, not the title's icon.
    const caption = document.createElement("div");
    caption.style.cssText = `color:${T.faint};font-size:11px;line-height:16px;margin:-2px 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
    const rows = document.createElement("div");
    rows.textContent = t("loading");
    rows.style.color = T.faint;
    // Below the plan bars: the CLI's own context breakdown for this session (item 30), one row
    // per category that holds tokens, deferred tool schemas folded out since they are not in context.
    const breakdown = document.createElement("div");
    breakdown.style.cssText = `margin-top:6px;padding-top:6px;border-top:1px solid ${T.border};color:${T.faint};font-size:12px;line-height:18px`;
    breakdown.textContent = t("main.usage.contextBreakdownLoading");
    // Between the plan bars and the context breakdown: what drives the plan limits (this pass).
    block.append(title, caption, rows, breakdown);
    panel.prepend(block);
    const sid = activeClaudeSession(ctx);
    const provider = activeClaudeProvider(ctx);
    if (sid)
      loadContext(sid).then((reply) => {
        renderContext(breakdown, reply);
        // dsh's own readout of the same window sits below this block and measures a different
        // thing: its count of the session surface it holds, which has never seen the system prompt,
        // the tool schemas or the files the CLI read, and keeps counting turns the CLI compacted
        // away. Two bars disagreeing by tens of thousands of tokens is worse than one, so the
        // CLI's own answer replaces it, and only when there is an answer, so a session with no
        // live process still gets dsh's estimate rather than nothing.
        if (!reply.ok) return;
        block.setAttribute(HID, "1");
        hideNativeContext(panel, block);
        // The rule under this block divided it from dsh's readout. With that readout gone it is the
        // last thing in the dialog, and a rule under the last thing is a line to nowhere.
        block.style.borderBottom = "none";
        block.style.paddingBottom = "0";
        block.style.marginBottom = "0";
      });
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
    const already = ours(tip);
    if (already) return rehide(tip, already);
    if (!activeClaudeSession(ctx)) return;
    const block = document.createElement("div");
    block.setAttribute(MARK, "1");
    // Bounded, and allowed to wrap. The line this fills reads "Claude 5-hour 13% · weekly 68% ·
    // weekly (fable) 100% (hostname)", around 430 px of text, and dsh sizes the bubble to its
    // content: on a phone that pushed the whole tooltip past the edge of the screen. The cap is
    // ours alone, on the block this plugin prepends, so dsh's own tooltip content is untouched.
    block.style.cssText = "max-width:min(80vw,420px);white-space:normal;overflow-wrap:anywhere";
    const line = document.createElement("div");
    // The mark is a drawing, not a letter, so the row centres on it rather than sitting it on a
    // baseline it does not have. `flex-start` because a wrapped line is taller than the mark.
    line.style.cssText = "display:flex;gap:6px;align-items:flex-start";
    const mark = sparkNode(12, SHIMMER);
    mark.style.flex = "0 0 auto";
    const text = document.createElement("span");
    text.textContent = t("main.usage.titleLoading");
    line.append(mark, text);
    // The context sentence dsh's bubble carries, over the CLI's own count rather than dsh's, for
    // the same reason the dialog's breakdown replaces its readout: the two measure different
    // things and the CLI's is the one auto-compact fires on.
    const ctxLine = document.createElement("div");
    ctxLine.style.cssText = `color:${T.faint};margin-left:18px`;
    block.append(line, ctxLine);
    tip.prepend(block);
    loadUsage(activeClaudeProvider(ctx)).then(
      (reply) => {
        const who = reply.host ? ` (${reply.host})` : "";
        if (!reply.ok) {
          text.textContent = t("main.usage.usageErr", { error: reply.error });
          return;
        }
        const windows = reply.windows
          .map((w) => `${windowLabel(w).toLowerCase()} ${Math.round(w.usedPercent)}%`)
          .join(" · ");
        text.textContent = windows
          ? t("main.usage.bubbleWindows", { windows, who })
          : t("main.usage.bubbleNoLimits", { who });
      },
      (e: Error) => {
        text.textContent = t("main.usage.usageErr", { error: e.message });
      },
    );
    const sid = activeClaudeSession(ctx);
    if (sid)
      loadContext(sid).then((reply) => {
        if (!reply.ok) {
          ctxLine.remove();
          return;
        }
        ctxLine.textContent = t("main.usage.contextUsedTokens", {
          pct: Math.round(reply.percentage),
          used: kTokens(reply.totalTokens),
          max: kTokens(reply.maxTokens),
        });
        block.setAttribute(HID, "1");
        hideNativeContext(tip, block);
      });
  };
  // The ring's filled arc, its geometry, the occupancy last read for it, and when that was asked for.
  const ARC = ':scope > button[aria-haspopup="dialog"] circle + circle';
  let arc: SVGCircleElement | undefined;
  let arcLength = 0;
  let ringSession: string | undefined;
  let ringPercent: number | undefined;
  let ringAsked = 0;
  // The plan limit the ring is tinted for, and when usage and the switches were last read for it.
  let ringLevel: LimitLevel | undefined;
  let ringLimitAsked = 0;
  let ringModel: string | undefined;
  // Flipping a warning switch rereads at the next paint rather than a minute later.
  window.addEventListener(HINTS_EVENT, () => {
    ringLimitAsked = 0;
  });
  /**
   * Fill the ring from the CLI's own occupancy.
   *
   * dsh draws the arc from `contextPressure`, which is the prompt side of the last usage sample,
   * input plus both cache counters, over the window. For a Claude Code session that sample is the
   * result frame's, and the CLI sums it across every API call the turn made: a turn of 117 calls
   * reports millions of cache reads, so the arc pins at 100% while the session is a third full. The
   * dash is rewritten with the percentage the CLI reports, which is the number this plugin's popover
   * and bubble already show and the one auto-compact fires on.
   *
   * Written rather than handed upstream because the number dsh is drawing is also what it bills the
   * turn on; the throughput figure is right for that and wrong only here. The circle is found the
   * same structural way `isRingRoot` finds it, and its radius is read from the element rather than
   * assumed, so a ring dsh redraws at another size still gets a correct arc.
   *
   * This runs once per mutation burst, so past the first paint it is two string compares and no DOM
   * query: the circle and its circumference are held from the scan that found them, and a ring that
   * went away is an element that is no longer connected.
   */
  const paintRing = () => {
    if (arc?.isConnected !== true) return;
    const sid = activeClaudeSession(ctx);
    if (sid === undefined) return;
    if (sid !== ringSession) {
      ringSession = sid;
      ringPercent = undefined;
      ringAsked = 0;
      ringLevel = undefined;
      ringLimitAsked = 0;
    }
    // A reached or near plan limit tints the arc, on a slower clock than the fill: usage is cached
    // for a minute by the route. A model switch rereads at once from that cache, since it changes
    // which limits count; picking a model redraws dsh's picker, so a paint follows it.
    const model = sessionModelOf(ctx, sid);
    if (model !== ringModel) {
      ringModel = model;
      ringLimitAsked = 0;
    }
    if (Date.now() - ringLimitAsked > 60_000) {
      ringLimitAsked = Date.now();
      void Promise.all([loadHints(), loadUsage(activeClaudeProvider(ctx))]).then(
        ([hints, usage]) => {
          const off = hints.limitWarningsOff === true || hints.limitRingOff === true;
          ringLevel =
            off || !usage.ok
              ? undefined
              : worstLimit(usage.windows, sessionModelOf(ctx, sid))?.level;
          paintRing();
        },
      );
    }
    const stroke = ringLevel === "critical" ? T.err : ringLevel === "warning" ? T.warn : "";
    if (arc.style.stroke !== stroke) arc.style.stroke = stroke;
    // dsh repaints the arc by rewriting an attribute, which the body observer does not watch, and a
    // ring already pinned at 100% stops changing altogether, so neither dsh's repaints nor ours can
    // be the thing that keeps this current. It is re-asked on a clock instead, off the same
    // ten-second cache the popover reads.
    if (Date.now() - ringAsked > 5_000) {
      ringAsked = Date.now();
      void loadContext(sid).then((reply) => {
        if (!reply.ok) return;
        ringPercent = Math.min(100, Math.max(0, reply.percentage));
        paintRing();
      });
    }
    if (ringPercent === undefined) return;
    const dash = `${(arcLength * ringPercent) / 100} ${arcLength}`;
    if (arc.getAttribute("stroke-dasharray") !== dash) arc.setAttribute("stroke-dasharray", dash);
    // The button's label is the same reading spoken aloud, so it moves with the arc.
    const label = t("main.ring.used", { pct: Math.round(ringPercent) });
    const button = arc.closest("button");
    if (button?.getAttribute("aria-label") !== label) button?.setAttribute("aria-label", label);
    // dsh also writes its own number as text inside the button, from the same pressure figure
    // that pins the arc at 100%. On a phone that text sits beside the ring, so it read 100% next
    // to an arc at 58% (owner, 2026-09-18). Same rewrite; a span whose text is not a bare
    // percentage is not dsh's number and is left alone.
    const pct = `${Math.round(ringPercent)}%`;
    for (const span of button?.querySelectorAll("span") ?? [])
      if (/^\d{1,3}%$/.test(span.textContent ?? "") && span.textContent !== pct)
        span.textContent = pct;
  };
  /**
   * The meter's open panel when dsh renders it away from the ring.
   *
   * Up to dsh 0.1.5 the panel was a sibling of the ring button, which is what `isRingRoot` tests.
   * 0.1.6-alpha.2 portals it to `<body>` instead, so that test can never match and the usage block
   * stopped appearing. The panel is claimed here by the ring's own button: it is open
   * (`aria-expanded`), and dsh labels the panel with the same phrase as the button minus the
   * percentage, so the button's label contains the panel's. That pair travels with dsh's
   * translations, unlike the generated class names on either node.
   *
   * The sibling path above stays until 0.1.5 is no longer supported; dropping that support means
   * deleting the two `isRingRoot` dialog lines and this call's companion comment, not this one.
   */
  const portalPanel = (): HTMLElement | null => {
    const trigger = arc?.closest("button");
    if (!trigger || trigger.getAttribute("aria-expanded") !== "true") return null;
    const label = trigger.getAttribute("aria-label");
    if (!label) return null;
    for (const panel of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
      if (panel.contains(trigger)) continue; // the ring sits inside no panel of its own
      const own = panel.getAttribute("aria-label");
      if (own && own !== label && label.includes(own)) return panel;
    }
    return null;
  };
  const scan = (root: ParentNode) => {
    // Looked for only until it is found. The ring outlives every burst that follows, and this query
    // would otherwise run over each of them for an element already in hand.
    if (arc?.isConnected !== true) {
      arc = undefined;
      for (const el of root.querySelectorAll<HTMLElement>('button[aria-haspopup="dialog"]')) {
        const host = el.parentElement;
        const found = host && isRingRoot(host) ? host.querySelector<SVGCircleElement>(ARC) : null;
        const radius = Number(found?.getAttribute("r"));
        if (!found || !Number.isFinite(radius) || radius <= 0) continue;
        arc = found;
        arcLength = 2 * Math.PI * radius;
        break;
      }
    }
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
    const portal = portalPanel();
    if (portal) attach(portal);
  };
  // Scoped to the burst: the ring's dialog and tooltip are rare nodes, and the body-wide pair of
  // attribute queries this used to run every dirty frame cost 0.4 ms on a 30k-node conversation,
  // paid on every frame of every streaming turn to find, almost always, nothing.
  // The per-frame scan: re-check changed elements and repaint the ring.
  onBodyMutation((records) => {
    if (records === undefined) scan(document.body);
    else for (const node of changedElements(records)) scan(node);
    paintRing();
  });
  scan(document.body);
  paintRing();
  // The usage block and the ring's tooltip line are built by hand, so a language switch does not
  // reach them. Drop them and scan again: an open panel gets a fresh block in the new language at
  // once, and the ring's label follows on the next repaint.
  whenContextGone(
    onLocaleSwitch(() => {
      for (const el of document.querySelectorAll(`[${MARK}]`)) el.remove();
      scan(document.body);
      paintRing();
    }),
  );
}

type SpinnerVerbSetting = { mode: "append" | "replace"; verbs: string[] };
let spinnerSettings:
  | Promise<{ setting?: SpinnerVerbSetting; frameSet: typeof DEFAULT_FRAMES }>
  | undefined;
/** Fetch Claude Code's settings.json text and extract spinnerVerbs if present. The setting comes
 *  back unmerged: the defaults it adds to depend on the language when the row is drawn, not when
 *  the page loaded. */
const loadSpinnerSettings = async (): Promise<{
  setting?: SpinnerVerbSetting;
  frameSet: typeof DEFAULT_FRAMES;
}> => {
  try {
    const body = await readJson<SettingsFile>(await fetch(`${ROUTE}/settings`));
    const parsed = JSON.parse(body.text);
    if (!isObj(parsed)) return { frameSet: [...DEFAULT_FRAMES] };
    const sv = parsed.spinnerVerbs;
    // SAFETY: spinnerVerbs comes from parsed JSON (a JsonObject); the cast is to read its known keys.
    if (!isObj(sv) || !Array.isArray((sv as { verbs?: unknown }).verbs))
      return { frameSet: [...DEFAULT_FRAMES] };
    // SAFETY: mode is a string key on the JsonObject; we validate the value below.
    const mode = (sv as { mode?: string }).mode;
    if (mode !== "append" && mode !== "replace") return { frameSet: [...DEFAULT_FRAMES] };
    // SAFETY: mode and verbs have been validated above; the cast narrows to the expected shape.
    return { setting: sv as SpinnerVerbSetting, frameSet: [...DEFAULT_FRAMES] };
  } catch {
    return { frameSet: [...DEFAULT_FRAMES] };
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
  // paints from its blue `--dsw-alias-state-business-primary`. The label and its underline draw
  // from the same token but as `color` and `background`, so both are overridden. Gated on the same
  // body attribute, so a session that switches off a Claude mount hands the tab straight back to
  // dsh's blue on the next paint. ponytail: `[role=tablist] > [role=tab]` catches any dsh view-tab
  // switcher; if a non-conversation one should stay blue, narrow it the day one appears.
  //
  // Then what the markdown draws in a colour of its own inside a Claude session. Two in dsh's
  // blue: a link, with its underline at a lighter weight and the shimmer on hover, and a task
  // checkbox, whose tick is the platform accent. Two in a flat grey: a blockquote's left bar
  // (`--dsw-alias-label-caption`) and a rule's hairline (`--dsw-alias-border-l2`). All are accents
  // rather than text, so they take the orange. The bar is at half strength, the rule at a third,
  // since it runs the whole width and a solid orange band across a message reads as a warning.
  // Code highlighting keeps its own palette: those colours mean token kinds, not the brand. Swept
  // 2026-09-09 with a computed-style pass over the conversation column: nothing else is blue there.
  // Missed by that sweep because it only exists while a run is open: a workflow-run card's member
  // row is a button in `--dsw-alias-link` blue while its child session is still running (dsh's
  // ui-workflow-run package, `memberButton`); once the member finishes it becomes a plain grey row.
  // The data attributes are dsh's own, the hashed class name is not.
  // The chasing dots dsh draws while something runs (its `StateDot` at `state="ongoing"`: eight
  // rects around a ring, each fading a beat after the last). They stayed dsh's blue wherever they
  // appear away from the turn status row. The subagent switcher's dropdown is where it shows, since
  // a Claude session's children are listed there with one running dot each. The colour comes from
  // `--dsh-state-ongoing`, which dsh declared on the element itself up to 0.1.6, so a value
  // inherited from
  // `body` loses to it; the override has to land on the same element. 0.1.7 dropped that property
  // and strokes the spinner with `currentColor` instead, so the rule sets `color` as well and one
  // of the two takes on whichever dsh is installed. `svg[data-state="ongoing"]`
  // does that on dsh's own attribute rather than its hashed class name, and outweighs the single
  // class dsh sets it with, so no `!important` is needed. Under the row switch with the status row,
  // which is the same idea in another place.
  // The stats row under the composer (`data-composer-stats`) is padded to the composer's side
  // clearance, which leaves its pills 653px in a 717px column. dsh's two fill that; ours as a
  // third clips all three to an ellipsis by a few pixels. The pills are centred, so the padding
  // does no aligning; take it down to the row's rounded corners and the three fit.
  styleEl.textContent = `${gated("row", '[role="status"][aria-live="polite"]:not([class*="visuallyHidden"])')},${gated("row", "[data-dsh-oh-my-claude-turn]", false)}{background-image:var(--omc-row-bg,linear-gradient(90deg,var(--omc-accent) 0%,var(--omc-accent) 40%,var(--omc-shimmer) 50%,var(--omc-accent) 60%,var(--omc-accent) 100%))}@keyframes omc-word{from{-webkit-text-fill-color:var(--omc-word-lo)}to{-webkit-text-fill-color:var(--omc-word-hi)}}[data-omc-turn-word]{animation:omc-word 1s ease-in-out 3s infinite alternate}@media (prefers-reduced-motion:reduce){[data-omc-turn-word]{animation:none}}[data-dsh-oh-my-claude-turn]>span[aria-hidden]{display:inline-block;width:1.3em;text-align:start;flex:none}[data-dsh-oh-my-claude-turn]{max-width:100%;min-width:0}[data-omc-turn-detail]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}button[data-turn-process]:has([data-omc-turn-line])>span:not([data-omc-turn-line]){display:none}[data-omc-turn-line]{background-clip:text;-webkit-background-clip:text;color:transparent;-webkit-text-fill-color:transparent;background-size:200% 100%;animation:omc-verb-sheen 2.6s linear infinite;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-flex;align-items:center;gap:2px}@keyframes omc-verb-sheen{from{background-position:200% 0}to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){[data-omc-turn-line]{animation:none}}button[data-turn-process]:has([data-omc-turn-line]){min-width:0;max-width:100%}${gated("panel", "[data-omc-login-card] button:hover", false)},${gated("panel", "[data-omc-login-card] button:focus-visible", false)},${gated("panel", "[data-omc-update-card] button:not(:disabled):hover", false)},${gated("panel", "[data-omc-update-card] button:focus-visible", false)}{color:var(--omc-accent)!important;border-color:var(--omc-accent)!important}${controlStatesCss("[data-omc-settings]")}${controlStatesCss('[role="dialog"][aria-label="Oh My Claude"]')}${/* !important: the buttons carry their border inline (`btn`), which beats any sheet rule. */ ""}${gated("panel", '[data-omc-settings] button:not([role="switch"]):not([aria-expanded]):not(:disabled):hover', false)},${gated("panel", '[data-omc-settings] button:not([role="switch"]):not([aria-expanded]):focus-visible', false)},${gated("panel", '[role="dialog"][aria-label="Oh My Claude"] button:not([role="switch"]):not([aria-expanded]):not(:disabled):hover', false)},${gated("panel", '[role="dialog"][aria-label="Oh My Claude"] button:not([role="switch"]):not([aria-expanded]):focus-visible', false)}{color:var(--omc-accent)!important;border-color:var(--omc-accent)!important}[data-omc-card]:hover{border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.5))}[data-omc-card]>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:-2px}[data-omc-card]>button:hover{background:none}@keyframes omc-sheen{from{background-position:200% 0}to{background-position:-200% 0}}[data-omc-skeleton]{border-radius:6px;background:linear-gradient(90deg,${T.border} 30%,${T.hover} 50%,${T.border} 70%);background-size:200% 100%;animation:omc-sheen 1.4s linear infinite}@keyframes omc-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@keyframes omc-drain{from{width:100%}to{width:0}}[data-omc-arrived]{animation:omc-rise .18s ease-out}@media (prefers-reduced-motion:reduce){[data-omc-skeleton],[data-omc-arrived]{animation:none}}${gated("prose", '[role="tablist"]>[role="tab"][aria-selected="true"]')}{color:var(--omc-accent)}${gated("prose", '[role="tablist"]>[role="tab"][aria-selected="true"]::after')}{background:var(--omc-accent)}${gated("prose", '[class*="_markdown"] blockquote')}{border-left-color:color-mix(in srgb,var(--omc-accent) 50.2%,transparent)}${gated("prose", '[class*="_markdown"] hr')}{background:color-mix(in srgb,var(--omc-accent) 34.9%,transparent)}${gated("prose", '[class*="_markdown"] a')}{color:var(--omc-accent);text-decoration-color:color-mix(in srgb,var(--omc-accent) 40%,transparent)}${gated("prose", '[class*="_markdown"] a:hover')}{color:var(--omc-shimmer);text-decoration-color:var(--omc-shimmer)}${gated("prose", '[class*="_markdown"] input[type="checkbox"]')}{accent-color:var(--omc-accent)}${/* The chips dsh draws in a sent bubble for a skill it knows (`/ic-logos`) and for a file mention: its business blue and its link blue. Selected by dsh's own `data-ref-chip` hook, which names the kind, not by the hashed class. */ ""}${gated("prose", "[data-ref-chip]")}{color:var(--omc-accent)}${gated("prose", "[data-ref-chip]:hover")},${gated("prose", "[data-ref-chip]:focus")}{color:var(--omc-shimmer);text-decoration-color:var(--omc-shimmer)}${gated("prose", "[data-ref-chip]:focus-visible")}{box-shadow:0 0 0 2px var(--omc-accent)}${gated("prose", "[data-workflow-run] button[data-member-status] [data-member-label]")}{color:var(--omc-accent)}${/* The icon tile on dsh's changed-files card is dsh's link blue; `data-changed-files` is dsh's own hook, and the class is matched by its module suffix since the prefix is generated per build. */ ""}${gated("prose", '[data-changed-files] [class*="_tile"]')}{background:var(--omc-accent)}body[data-omc-panel-open] [data-width-handle]{pointer-events:none}body[data-omc-panel-open] [class*="_toBottomSlot"],body:has([data-omc-cost-dialog]) [class*="_toBottomSlot"]{opacity:0;pointer-events:none;transition:opacity .1s}@keyframes omc-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--omc-accent) 55%,transparent)}100%{box-shadow:0 0 0 12px transparent}}${gated("panel", 'button[aria-label="Oh My Claude"][data-omc-pulse]', false)}{animation:omc-pulse 1.1s ease-out 3}@media (prefers-reduced-motion:reduce){button[aria-label="Oh My Claude"][data-omc-pulse]{animation:none}}${gated("prose", "[data-produced-files-row] button")},${gated("prose", "[data-presented-files-row] button")}{color:var(--omc-accent)}${gated("prose", "[data-produced-files-row] button:hover")},${gated("prose", "[data-presented-files-row] button:hover")}{color:var(--omc-shimmer)}body[data-omc-claude] [data-composer-stats]{padding-left:8px;padding-right:8px}${gated("prose", '[class*="_optionLine"]>[class*="_badge"]')}{background:color-mix(in srgb,var(--omc-accent) 16%,transparent);color:var(--omc-accent)}[data-omc-cost-over]{color:var(--omc-accent)}${gated("row", 'svg[data-state="ongoing"]')}{--dsh-state-ongoing:var(--omc-accent);color:var(--omc-accent)}${RAINBOW_CSS}${COST_DIALOG_CSS}`;
  document.head.appendChild(styleEl);
};

/** One verb per running turn: the row remounts on every tool step and dsh rewrites its text, so a
 *  fresh pick each time reads as flicker. Keyed by session; forgotten after a short absence. */
const turnVerbs = new Map<string, { verb: string; seen: number }>();
const VERB_MEMORY_MS = 4000;
/** A token count the way the CLI's status line writes one: `1.2k` past a thousand, plain below. */
const shortCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Picks a verb for a running turn, reusing the session's previous one within a short window. */
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
/** Returns the CLI wording for a thinking burst of the given length, defaulting to "thinking". The
 *  thresholds mirror the CLI's `gr()` ladder (2.1.268); the words are read from the dictionary at
 *  call time so a language switch reaches them, not baked into a module-load constant. */
const thinkingWord = (ms: number): string =>
  ms >= 45_000
    ? t("main.turn.thinkingAlmostDone")
    : ms >= 30_000
      ? t("main.turn.thinkingSomeMore")
      : ms >= 20_000
        ? t("main.turn.thinkingMore")
        : ms >= 10_000
          ? t("main.turn.thinkingStill")
          : t("main.turn.thinking");

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
/** `n` held inside 0 to 1. */
const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1);
/** Blends two RGB colours by f (0 is a, 1 is b) and rounds each channel. */
const mixRgb = (a: Rgb, b: Rgb, f: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * f),
  Math.round(a[1] + (b[1] - a[1]) * f),
  Math.round(a[2] + (b[2] - a[2]) * f),
];
/** Serialises an RGB triple as an `rgb(r, g, b)` string. */
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
/** No-op frame callback, used where a beat changes nothing and so writes nothing. */
const noBeat = (): void => undefined;
/** What a turn's status could be drawn in, on either dsh line: the status row itself up to 0.1.6,
 *  and from 0.1.7 the button that heads the turn's process group. */
const TURN_ROW_SELECTOR = '[role="status"][aria-live="polite"], button[data-turn-process]';

/**
 * The element that shows this turn's status to the eye, or undefined when the candidate shows
 * nothing.
 *
 * Up to dsh 0.1.6 that was the `role="status"` row itself. dsh 0.1.7 moved the sentence into the
 * button heading the turn's process group ("Deep diving for 12s") and left the status row for
 * screen readers, clipped to a single pixel: the plugin kept painting the row, so its verb, spinner
 * and figures went out to assistive tech and nobody could see them (owner, 2026-09-22).
 *
 * A finished group is left alone. dsh drops `data-open` from the button once the turn ends and its
 * label becomes "Took 12s", which is a record of the turn, not a status, and not the plugin's to
 * overwrite.
 */
const turnStatusRow = (found: HTMLElement): HTMLElement | undefined => {
  if (found.matches("button[data-turn-process]")) {
    if (found.getAttribute("data-open") !== "true") return undefined;
    // A group whose turn ended keeps `data-open` when it failed or was stopped, and the scanner
    // runs on every frame: without this mark every teardown was followed by a fresh line with a
    // fresh verb, which is what read as "the verb keeps going" (owner, 2026-09-22, twice).
    if (found.hasAttribute("data-omc-turn-done")) return undefined;
    const label = found.querySelector<HTMLElement>(":scope > span:not([data-omc-turn-line])");
    if (label === null) return undefined;
    const already = found.querySelector<HTMLElement>(":scope > [data-omc-turn-line]");
    if (already !== null) return already;
    const line = document.createElement("span");
    line.setAttribute("data-omc-turn-line", "1");
    // dsh's sentence is a sibling, not an ancestor, so none of its own type styles are inherited
    // here: the line would take the button's instead and read at a different size from the one it
    // replaces. Copied from the node on screen rather than assumed, the way the bracket takes the
    // clock's face.
    const face = getComputedStyle(label);
    line.style.fontSize = face.fontSize;
    line.style.fontWeight = face.fontWeight;
    line.style.fontFamily = face.fontFamily;
    line.style.lineHeight = face.lineHeight;
    line.style.letterSpacing = face.letterSpacing;
    // A text node the verb is written into: `wireTurnStatus` takes the first one with text in it,
    // so the seed cannot be blank. It is replaced before the next frame.
    line.append(document.createTextNode("…"));
    found.append(line);
    return line;
  }
  if (found.getAttribute("role") !== "status" || found.getAttribute("aria-live") !== "polite")
    return undefined;
  // Clipped to a pixel for screen readers on 0.1.7; a row with a real box is 0.1.6 or earlier and
  // is the one to paint. The class name answers first, since it costs nothing; the measurement,
  // which forces layout, is only for a row the class does not settle.
  if (found.className.includes("visuallyHidden")) return undefined;
  return found.getBoundingClientRect().height > 2 ? found : undefined;
};

/** Give a 0.1.7 process group its own sentence back: removing the plugin's line is enough, because
 *  the rule that hides dsh's own only applies while that line is in the button. Called when the
 *  turn ends and when the bundle is disposed, and safe to call twice. */
const stopTurnLine = (el: HTMLElement): void => {
  if (!el.hasAttribute("data-omc-turn-line")) return;
  // Mark the group before removing the line, so the scan the removal itself triggers finds a
  // group that is done rather than one that wants wiring.
  el.closest("button[data-turn-process]")?.setAttribute("data-omc-turn-done", "1");
  el.remove();
};

/** Wire one turn-status element for a claude-code session: verb, ping-pong spinner and orange
 *  gradient. */
const wireTurnStatus = (
  el: HTMLElement,
  sessionId: string,
  verbs: string[],
  frames: readonly string[],
  /** dsh's own word on whether the session is running, read fresh on every beat. */
  isRunning: () => boolean = () => true,
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
      // 0.1.7 keeps the group's button on screen after the turn, relabelled "Took 12s". That is a
      // record, not a status, so the plugin's line comes down and dsh's own sentence goes back up.
      const group = el.closest("button[data-turn-process]");
      if (group !== null && group.getAttribute("data-open") !== "true") {
        stop();
        stopTurnLine(el);
        return;
      }
      // Nothing to paint for a tab nobody is looking at; the teardown checks above still run.
      if (document.hidden) return;
      tick();
      onTick();
    },
    // A reduced-motion spinner is one glyph that never changes, so its beat is the teardown check
    // and nothing else; 1s notices an unmounted row soon enough at an eighth of the wakeups.
    reduced ? 1000 : 120,
  );
  // The row can outlive the bundle that wired it, since a rebuild disposes the context while the
  // turn is still running. A connected row never trips the check above, so each reload left
  // one more beat animating the same spinner. The wired mark and the spinner go back with it: both
  // live on dsh's element, which outlives this bundle, and a row still wearing the mark is one the
  // next bundle refuses to wire.
  // Tear down this row: stop the spinner beat and poll, remove the wired mark and spinner, so a
  // row that outlives its bundle leaves nothing animating.
  whenContextGone(() => {
    stop();
    el.removeAttribute(TURN_MARK);
    spinner.remove();
    stopTurnLine(el);
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
  let relayName = "";
  let relayMs = -1;
  /** How long the turn has run, per the last poll. Only read where dsh draws no clock of its own
   *  (0.1.7 and later); -1 until the first answer. */
  let elapsedMs = -1;
  // What is on screen: the eased count in characters (the CLI eases its response length, and
  // shows it over four) and the two colour ramps, each chased 10% per 50ms like the CLI does.
  let shownChars = 0;
  let thinkIntensity = 0;
  let stallIntensity = 0;
  let lastBeat = Date.now();
  const palette = pageIsDark() ? SPINNER_DARK : SPINNER_LIGHT;
  // Read once per wired row: `accentRgb` is a getComputedStyle on the root, which forces a style
  // recalc, and the beat below paints eight times a second. The accent only moves when the Claude
  // look switch flips, and the next turn's row reads the new one.
  const claude = accentRgb(palette.claude);
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
    // dsh 0.1.6 and earlier draw a clock node beside the row and this reads it. 0.1.7 writes the
    // elapsed time into the same sentence as its own verb ("Deep diving for 12s"), which the verb
    // above replaces, so there is no node to read and the figure comes from the turn record.
    const polled = elapsedMs >= 0 ? elapsedMs + since : -1;
    const time = (clock?.textContent ?? "").trim() || (polled >= 0 ? fmtDuration(polled) : "");
    if (time) parts.push(time);
    // dsh's copy goes quiet only while ours is showing the same figure. Hiding it unconditionally is
    // what left the row reading just the verb when the read came back empty.
    if (clock) clock.style.display = time ? "none" : "";
    const shownTokens = Math.round(shownChars / 4);
    if (shownTokens > 0) parts.push(t("main.turn.tokens", { n: shortCount(shownTokens) }));
    // The CLI's gated `running tool for Ns`, with the dsh tool's name in place of "tool": the step
    // is closed while dsh runs it, so this is the one figure that moves during the wait.
    if (relayName && relayMs >= 0)
      parts.push(
        t("main.turn.runningFor", { name: relayName, n: Math.round((relayMs + since) / 1000) }),
      );
    // The CLI names the effort after the word when one was asked for, and once a burst closes
    // it says "thought for Ns" for two seconds, never sooner than two seconds after the burst
    // began.
    let word = "";
    if (burst >= 0)
      word = `${thinkingWord(burst)}${effort ? t("main.turn.withEffort", { effort }) : ""}`;
    else if (thoughtAgoMs >= 0) {
      const closedFor = thoughtAgoMs + since;
      const showAt = Math.max(0, 2000 - thoughtMs);
      if (closedFor >= showAt && closedFor < showAt + 2000)
        word = t("main.turn.thoughtFor", { n: Math.max(1, Math.round(thoughtMs / 1000)) });
    }
    const thinking = burst >= 0;
    // The CLI's colours. Verb and spinner: Claude orange, toward the warning shade by the thinking
    // ramp, toward its stall red by the stall ramp; the spinner goes bold past half. The word:
    // a slow grey pulse, itself pulled toward the warning shade by the thinking ramp. Time, count
    // and the brackets stay dim. Once either ramp is above zero the verb is one flat colour, no
    // shimmer: the CLI's glimmer only draws when neither ramp is up.
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
  /**
   * The two end signals dsh owns, read once a second here rather than on the 120 ms beat: the
   * session summary's `running`, which drops the moment a turn ends however it ended and in any
   * language, and whether this group is still the newest in the conversation, since Send now
   * cuts a turn and starts the next under the same session, where `running` alone would keep the
   * old line up. The newest-group read walks the document, which is why it is not on the beat.
   * Nothing else decides the end: the plugin's own turn record clears and remakes at tool
   * boundaries (it took the line down at 7 s of a 29 s turn), and a "sentence stopped ticking"
   * backstop would cut the line under a turn parked on an approval prompt (review, 2026-09-22).
   */
  const endedPerDsh = (): boolean => {
    const group = el.closest("button[data-turn-process]");
    if (group === null) return false;
    if (!isRunning()) return true;
    const groups = document.querySelectorAll("button[data-turn-process]");
    return groups[groups.length - 1] !== group;
  };
  const poll = async () => {
    if (!el.isConnected) return;
    if (endedPerDsh()) {
      stop();
      stopTurnLine(el);
      return;
    }
    // A hidden tab paints nothing, so its read would be a round trip for no one; the next beat
    // after it is shown again catches up.
    if (document.hidden) return;
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
        relayName?: string;
        relayMs?: number;
        elapsedMs?: number;
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
      relayName = b.relayName ?? "";
      relayMs = b.relayMs ?? -1;
      elapsedMs = b.elapsedMs ?? -1;
      polledAt = Date.now();
      // The adapter drops its turn record the moment a turn ends, however it ended, so an empty
      // answer after a live one is the end of the turn. dsh keeps `data-open` on a failed group,
      // which is why the button's own state cannot be the only signal: a turn that failed left the
      // line saying "Incubating…" under dsh's "Failed" (owner, 2026-09-22).
      // An empty answer is not an ending: the adapter registers the turn on its first frame and
      // clears and remakes the record at tool boundaries, so the figures simply pause. The end
      // of the turn is read off dsh in the beat above.
      if (b.elapsedMs === undefined) return;
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
  // The `at` of the last fallback announced per session, so a session that fell back once and then
  // ran clean turns does not re-announce the stale record on every later stop. `seenFallback` is in
  // memory, so a tab reload forgets it; the freshness window (FRESH_MS, beside announceStop) then
  // stops a record left over from a switch minutes ago from re-announcing on the next clean stop.
  const seenFallback: Record<string, number> = {};
  let recapPending: Record<string, number> = {};
  // Last tick's open prompts, for the diff. `null`, not `{}`: the first poll after a page load is
  // a baseline and must not fire, or a reload while a prompt is open re-announces a question the
  // person is already reading. Same rule `prev` above follows for `newlyWaiting`.
  let prevAwaiting: Record<string, AwaitingRow> | null = null;
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
    const current = openSessionId(ctx);
    // Copy the compared fields into fresh rows: dsh's store may reuse row objects between calls, and
    // a shared reference would make every field read `was === now`, so no transition would ever fire.
    const byId: NoticeSnapshot["byId"] = {};
    for (const [id, s] of Object.entries(snap.byId))
      byId[id] = { running: s.running, completed: s.completed, displayTitle: s.displayTitle };
    const next: NoticeSnapshot = { byId, current };
    const stopped = newlyWaiting(prev, next).filter((id) => isClaudeSession(ctx, id));
    for (const id of stopped) {
      waiting.add(id);
      void announceStop(ctx, id, snap.byId[id]?.displayTitle ?? id, seenFallback);
    }
    prev = next;
    // A session waiting on a permission prompt keeps its stream open, so it still reads as running
    // and `newlyWaiting` never sees it stop. Poll the adapter's own map instead, and only while a
    // Claude session is running: a running dsh session cannot hold a Claude prompt, and an idle box
    // should make no requests.
    const anyClaudeRunning = Object.entries(snap.byId).some(
      ([id, s]) => s.running === true && isClaudeSession(ctx, id),
    );
    // A hidden tab keeps its bookkeeping but makes no request: this was the one unconditional
    // one-a-second poll a background tab still paid.
    if (anyClaudeRunning && !document.hidden) {
      void fetch(`${ROUTE}/awaiting`)
        .then((r) => readJson<{ sessions?: Record<string, AwaitingRow> }>(r))
        .then((body) => {
          const nextAwaiting = body.sessions ?? {};
          for (const id of newlyAwaiting(prevAwaiting, nextAwaiting, openSessionId(ctx))) {
            if (!isClaudeSession(ctx, id)) continue;
            const prompt = nextAwaiting[id];
            // noUncheckedIndexedAccess makes this read `AwaitingRow | undefined`; a missing row is
            // not a transition to announce, so skip it rather than pass undefined to `notifyAwaiting`.
            if (!prompt) continue;
            waiting.add(id);
            notifyAwaiting(ctx, id, snap.byId[id]?.displayTitle ?? id, prompt);
          }
          prevAwaiting = nextAwaiting;
        })
        .catch(() => {
          // A failed poll says nothing. The next tick asks again; a prompt is not urgent enough to
          // report a network error over.
        });
    } else {
      prevAwaiting = null; // back to baseline: the next poll seeds it and does not fire
    }
    // Return recap: a session that stopped working while it was not the one on screen is asked for
    // one line when it is opened. Off by default; the switch is in Settings, under Oh My Claude.
    // `recapNext` clears the id as it fires, so a return asks once and a second open of the
    // same session asks nothing. Two things this accepts on purpose: the queue is cleared before
    // `recapOn()` is read, so turning the switch on mid-session waits for the next return rather than
    // firing for a session that already came back, and the fire trusts the open session for the tick
    // it runs in, so one that lags the screen by a tick can bill a recap for a session nobody left.
    // A spurious title mark is free; a spurious recap is a model call, which is why the switch is off
    // until asked for.
    const step = recapNext(
      recapPending,
      stopped,
      current,
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
        // `recap: true` lets the route drop this when another tab already asked for the same
        // return. Every open tab runs this watcher with its own queue, so the tab is not the place
        // the count can be held.
        body: JSON.stringify({ session, question: RECAP_QUESTION, recap: true }),
      }).catch(() => {
        // A recap nobody typed stays quiet when it fails. The route refuses before the ring is
        // touched when there is no live process, so there is nothing to clean up here either.
      });
    }
    // Reading it clears it: the open session, and everything else once the tab is looked at again.
    if (current !== undefined) waiting.delete(current);
    if (!document.hidden) waiting.clear();
    const wanted = markTitle(document.title, waiting.size);
    if (wanted !== document.title) document.title = wanted;
  };
  tick(); // take the baseline now, so the first interval already has something to compare against
  const beat = setInterval(guard(tick), 1000);
  whenContextGone(() => clearInterval(beat));
}

/** Post a 'Claude is waiting' notification for a stopped session, or none when notifications are
 *  off or ungranted, leaving the title mark to carry it. */
function notifyWaiting(ctx: ClientCtx, id: string, title: string) {
  // Permission is only ever asked for from the panel's own toggle, so an ungranted browser is the
  // normal case here and the title mark carries it alone.
  if (!noticesOn() || !("Notification" in window) || Notification.permission !== "granted") return;
  // `tag` per session: a session that finishes twice replaces its own notice rather than stacking.
  const note = new Notification(title, { body: t("main.notice.waiting"), tag: `omc-${id}` });
  note.addEventListener("click", () => {
    window.focus();
    openSession(ctx, id);
    note.close();
  });
}

/** Post a notification for a session waiting on a permission prompt, using the prompt kind in the
 *  body; returns without one when notifications are off or ungranted. */
function notifyAwaiting(ctx: ClientCtx, id: string, title: string, prompt: AwaitingRow) {
  // Permission is only ever asked for from the panel's own toggle, so an ungranted browser is the
  // normal case here and the title mark carries it alone.
  if (!noticesOn() || !("Notification" in window) || Notification.permission !== "granted") return;
  // A tag of its own per prompt: two tabs watching the same prompt collapse to one visible notice,
  // and a session that asks twice replaces its own rather than stacking.
  const note = new Notification(title, { body: awaitingBody(prompt.kind), tag: `omc-await-${id}` });
  note.addEventListener("click", () => {
    window.focus();
    openSession(ctx, id);
    note.close();
  });
}

// How recent a fallback record must be to announce: a tab reload forgets `seenFallback`, so without
// this a record left from a switch minutes ago would re-announce on the session's next clean stop.
const FRESH_MS = 5 * 60_000;

/** On a stop, read the session's fallback record once. A fresh one (newer than the last announced,
 *  and within FRESH_MS) fires the fallback notice and moves the picker; otherwise the generic
 *  waiting notice fires. One fetch per stop, never per second. */
async function announceStop(
  ctx: ClientCtx,
  id: string,
  title: string,
  seen: Record<string, number>,
) {
  let rec: FallbackRecord | null = null;
  try {
    const r = await fetch(`${ROUTE}/side-questions?session=${encodeURIComponent(id)}`);
    if (r.ok) {
      const body = await readJson<{ fallback?: FallbackRecord | null }>(r);
      rec = body.fallback ?? null;
    }
  } catch {
    rec = null;
  }
  if (rec && rec.at > (seen[id] ?? 0) && Date.now() - rec.at < FRESH_MS) {
    seen[id] = rec.at;
    movePickerToFallback(ctx, id, rec);
    notifyFallback(ctx, id, title, rec);
    return;
  }
  notifyWaiting(ctx, id, title);
}

/** The notice body: the CLI's own sentence when it sent one, else a plain line that names the model
 *  that answered and the safeguard category. Verified against every case in the plan. */
function fallbackNoticeBody(rec: FallbackRecord): string {
  if (rec.content) return rec.content;
  const cat = rec.category ?? t("main.fallback.safety");
  const from = rec.from || t("main.fallback.pickedModel");
  const to = rec.to || t("main.fallback.anotherModel");
  if (rec.kind === "model_refusal_no_fallback") return t("main.fallback.blocked", { from, cat });
  if ((rec.scope ?? "session") === "local") return t("main.fallback.subtask", { to, cat, from });
  if (rec.direction === "sticky") return t("main.fallback.sticky", { to, cat, from });
  if (rec.direction === "revert") return t("main.fallback.revert", { to, cat, from });
  return t("main.fallback.oneMessage", { to, cat, from });
}

/** Post the fallback notice body for a session that fell back, with the same permission guard as
 *  notifyWaiting, so an ungranted browser gets the title mark alone. */
function notifyFallback(ctx: ClientCtx, id: string, title: string, rec: FallbackRecord) {
  // Same guard as notifyWaiting: an ungranted browser gets the title mark alone.
  if (!noticesOn() || !("Notification" in window) || Notification.permission !== "granted") return;
  const note = new Notification(title, {
    body: fallbackNoticeBody(rec),
    tag: `omc-fallback-${id}`,
  });
  note.addEventListener("click", () => {
    window.focus();
    openSession(ctx, id);
    note.close();
  });
}

/** Move dsh's picker onto the model that answered, only for a sticky, session-scoped safety
 *  fallback: retry/revert are one-off, local is a subagent, and the other frame kinds do not swap
 *  the session model. Mirrors StaleModelRepair's reads and its not-running guard (a model change
 *  respawns the next turn). Matches the app, which keeps the picker on Opus until the person
 *  switches back. */
function movePickerToFallback(ctx: ClientCtx, sessionId: string, rec: FallbackRecord) {
  if (
    rec.kind !== "model_refusal_fallback" ||
    rec.direction !== "sticky" ||
    (rec.scope ?? "session") !== "session" ||
    !rec.to
  )
    return;
  let dir: ReturnType<ClientCtx["modelDirectories"]["directoryFor"]>;
  try {
    dir = ctx.modelDirectories.directoryFor(sessionId);
  } catch {
    return; // unbound in this tab
  }
  const snap = dir.store.getSnapshot();
  const cur = snap.current;
  if (!cur?.provider.startsWith("claude-code")) return;
  const offered = snap.groups?.find((g) => g.id === cur.provider)?.models.map((m) => m.id);
  if (!offered || offered.length === 0) return;
  if (ctx.sessions.list.getSnapshot()?.byId[sessionId]?.running) return;
  const living = livingModelId(rec.to, offered);
  if (living && dir.select)
    void dir.select({ provider: cur.provider, model: living }).catch(() => {});
}

/** Wire a running turn's status: attach dsh's [role=status][aria-live=polite] element to this
 *  session, keep the body marked to the active Claude session, and tear both down on unmount. */
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
  /** The newest process group on the page, read once per scan pass rather than once per
   *  candidate: a streaming turn dirties the page many times a frame, and each candidate group
   *  asking for itself made the scan quadratic in the length of the conversation. */
  let newestGroup: Element | null = null;
  const attach = (found: HTMLElement) => {
    // A row already wired, or a group already marked done, needs no further look and no layout.
    if (found.hasAttribute(TURN_MARK) || found.hasAttribute("data-omc-turn-done")) return;
    // Decide before wiring, not after. A reload draws every old group, and dsh leaves a stopped
    // or failed one open, so asking "is it open" wired a verb onto a turn that ended an hour ago
    // and took it down three polls later (owner, 2026-09-22). What is known up front: dsh's own
    // session summary says whether the session is running at all, and only the newest group in
    // the conversation can be the running turn.
    if (found.matches("button[data-turn-process]")) {
      const sid = activeClaudeSession(ctx);
      if (!sid) return;
      if (ctx.sessions.list.getSnapshot()?.byId[sid]?.running !== true) return;
      if (newestGroup !== found) return;
    }
    const el = turnStatusRow(found);
    if (el === undefined) return;
    // The wired mark is read here rather than inside `wireTurnStatus`: everything below allocates a
    // promise, and this runs for every status element on every dirty frame of a running turn.
    if (el.hasAttribute(TURN_MARK)) return;
    const activeId = activeClaudeSession(ctx);
    if (!activeId) return;
    if (!hasTheme("row")) return; // the Claude look's status row is off: dsh's own text stays
    spinnerSettings ??= loadSpinnerSettings(); // once per page load
    // The settings load once and resolve for good, so this is a microtask after the first frame.
    // The await used to be unhandled, so a throw inside `wireTurnStatus` became a rejection
    // `guard` never saw: the spinner simply never appeared, with nothing on the console to say why.
    void spinnerSettings.then((settings) => {
      if (!el.isConnected) return;
      const defaults = activeLocale().startsWith("zh") ? ZH_VERBS : DEFAULT_VERBS;
      wireTurnStatus(
        el,
        activeId,
        mergeVerbs(defaults, settings.setting),
        settings.frameSet,
        () => ctx.sessions.list.getSnapshot()?.byId[activeId]?.running === true,
      );
    }, console.error);
  };
  /** One document walk per mutation batch, shared by every scan in it. */
  const refreshNewest = () => {
    const groups = document.querySelectorAll("button[data-turn-process]");
    newestGroup = groups[groups.length - 1] ?? null;
  };
  const scan = (root: HTMLElement) => {
    attach(root);
    for (const el of root.querySelectorAll<HTMLElement>(TURN_ROW_SELECTOR)) attach(el);
  };
  // Once per dirty frame, and the cheapest check comes first: on a session that is not a Claude
  // mount there is nothing to attach, so bail before the querySelectorAll. attach is idempotent
  // (the status row carries a data-attr once wired), so re-scanning the body each frame is safe.
  onBodyMutation((records) => {
    if (!activeClaudeSession(ctx)) return;
    refreshNewest();
    if (records === undefined) return scan(document.body);
    for (const node of changedElements(records)) scan(node);
  });
  refreshNewest();
  scan(document.body);
}

/**
 * Tint dsh's running indicator (its state-dot matrix) Claude-orange for Claude sessions, both the
 * sidebar row dot and the job/subagent/plan dots inside the open conversation, leaving every other
 * provider dsh's own colour. dsh colours the `ongoing` dot from the
 * `--dsh-state-ongoing` custom property; an inline `color` on the svg overrides it, and clearing it
 * hands the row straight back to dsh. A session that switches off a Claude mount reverts on the
 * next pass.
 *
 * The row carries no session id in the DOM, so a running dot is matched to a session by the title
 * text beside it (dsh renders `displayTitle` there, the same string the list store holds).
 * ponytail: title match, not id; two running sessions with the same title share a tint. Swap for a
 * per-row id the day dsh puts one on the row.
 */
/** The title span sits next to the slot that holds the dot; the dot's nearest span ancestor is that
 *  slot, so its next sibling is the title. Structural, so no hashed class name is needed. */
const spinnerRowTitle = (dot: Element): string | null =>
  dot.closest("span")?.nextElementSibling?.textContent?.trim() ?? null;

/** The mark the slot paints on a running Claude session's row, so the scan reads a per-row flag
 *  instead of matching each dot to a session by title. Reuses the value the body carries
 *  (`data-omc-claude`), so one flag names both the open session and its running rows. */
const ROW_MARK = "data-omc-claude";
/** Whether the row-mark entry registered: the scan then reads the per-row mark, and falls back to
 *  the title match on a dsh without the row-action slot. */
let markActive = false;
/** displayTitles of the sessions that are both running and on a Claude mount this instant: the
 *  scan's title-match fallback on a dsh without the row-action slot. */
export const claudeRunningTitles = (ctx: ClientCtx): Set<string> => {
  const set = new Set<string>();
  const snap = ctx.sessions.list.getSnapshot();
  if (!snap) return set;
  for (const [id, s] of Object.entries(snap.byId))
    if (s.running && s.displayTitle && isClaudeSession(ctx, id)) set.add(s.displayTitle.trim());
  return set;
};
/**
 * The row-action occupant dsh mounts at the end of every session row (hidden until hover, mounted
 * at rest): it draws nothing and marks its own row with `data-omc-claude` while the session is
 * running on a Claude mount. The row is its nearest treeitem, found from the element it renders,
 * so the mark follows the session id dsh handed the slot and never a title. Re-read on every list
 * change (running flips, model switches), cleared on unmount and when the session stops qualifying.
 */
function RowMark({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const treeRow = ref.current?.closest('[role="treeitem"]');
    if (!treeRow) return;
    const refresh = () => {
      const s = ctx.sessions.list.getSnapshot()?.byId[sessionId];
      const want = s?.running === true && isClaudeSession(ctx, sessionId);
      if (want) treeRow.setAttribute(ROW_MARK, "1");
      else treeRow.removeAttribute(ROW_MARK);
    };
    refresh();
    const off = ctx.sessions.list.subscribe?.(refresh);
    return () => {
      off?.();
      treeRow.removeAttribute(ROW_MARK);
    };
  }, [sessionId, ctx]);
  return <span ref={ref} hidden data-omc-row-mark={sessionId} />;
}

/** The composer's primary send/stop button shares the local CSS-module class `_primary` with one
 *  button in a settings view, so class alone is not enough. The real one shares an ancestor with
 *  the message box (a contenteditable). Walk up until an ancestor holds one; null means it is not
 *  the composer button. Structural, so no hashed class is needed. */
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

/** Build a text range over the one character a rainbow match covers, so the highlight spans exactly
 *  that glyph. */
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
  //
  // The anchor key is `${turn}:${kind}${id}`, so the turn number leads and the kind is reached
  // through the colon. Read off a live 0.1.6 page on 2026-09-15: 88 keys, among them
  // `13:input-message9176508b-ece4-4d04-9f5f-427b5de867bc`, `14:assistant-step1:1` and
  // `12:turn-process1`. Substring, not prefix, and the same on 0.1.5. A `^=` form was briefly added
  // here on the belief that 0.1.6 had moved the kind to the front; it matched nothing, because
  // `locationIdentity` in dsh-client-ui-chat builds a different string than this attribute carries.
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
  // On teardown, disconnect the sweep observer and listeners and stop the shimmer, so an unmounted
  // ultrathink sweep makes no more queries.
  whenContextGone(() => {
    obs.disconnect();
    document.removeEventListener("input", request, true);
    document.removeEventListener("visibilitychange", request);
    stopSweep();
    clear();
  });
}

/** Tint this session's running Claude mounts' spinners orange, rescanning every second while the
 *  tab is visible, waking on visibilitychange, and leaving other providers' spinners alone. */
function watchSessionSpinners(ctx: ClientCtx) {
  const MARK = "data-omc-spinner";
  const SEND_MARK = "data-omc-send";
  const scan = () => {
    // A hidden tab is not being looked at, and this pass is two document-wide queries a second. The
    // visibility listener below runs it once the moment the tab comes back.
    if (document.hidden) return;
    // The running Claude rows carry the mark the slot paints, so this set is the fallback the scan
    // reads only when the slot is not live; the live path matches each dot to a row by that mark.
    const titles = claudeRunningTitles(ctx);
    // Every other ongoing matrix square renders inside the open conversation. That set is the
    // job-list dot in the session header and the same dot dsh shows for subagents, plans and
    // schedules, so it belongs to whichever session is open. Tint those when that session is a
    // Claude mount.
    const openClaude = activeClaudeSession(ctx) !== undefined;
    const openIsClaude = openClaude && hasTheme("row");
    for (const dot of document.querySelectorAll<SVGElement>('svg[data-state="ongoing"]')) {
      const inRow = dot.closest('[role="treeitem"]'); // a sidebar session row vs a dot elsewhere
      let want: boolean;
      if (inRow) {
        // The mark slot paints `data-omc-claude` on the running Claude rows, so the live path reads
        // it; the fallback matches the dot to a session by title, the identity the mark replaces.
        const title = spinnerRowTitle(dot);
        want = markActive ? inRow.hasAttribute(ROW_MARK) : title !== null && titles.has(title);
        want = want && hasTheme("row");
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
    // Only the composer's own button is wanted, so only its form is searched: a substring class
    // match over the whole document, once a second, is the kind of query a browser cannot index.
    const composerRoot = box?.closest("form") ?? document;
    for (const sendBtn of composerRoot.querySelectorAll<HTMLElement>('button[class*="_primary"]')) {
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
  // On teardown, stop the scan beat and the visibility wake, so nothing rescans once the context
  // is gone.
  whenContextGone(() => {
    clearInterval(beat);
    document.removeEventListener("visibilitychange", wake);
  });
}

/** Fold a native-tool code block into a one-line disclosure. dsh renders a tool step as a `<p>` whose
 *  text is an icon plus the tool's name (`❯ Bash`, `▤ Read`), set by the translator, followed by
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
  "❯": IconApiOutlineRegular,
  "▤": IconBrowseOutlineMedium,
  "✎": IconEditOutlineMedium,
  "⌕": IconSearchOutlineMedium,
  "✳": IconCodeOutlineMedium,
  "⤓": IconBrowseOutlineMedium,
  "☑": IconChecklistOutlineRegular,
  "⚙": IconAgentPresetOutlineMedium,
  "☰": IconListPenOutlineMedium,
  "⌘": IconSkillOutlineMedium,
  "◆": IconSparkleMedium,
  chevron: IconChevronDownOutlineRegular,
} satisfies Record<string, FC<{ size?: number }>>;

/** The hidden sprite sheet: one rendered copy of each dsh icon, cloned into the tool headers by the
 *  fold scan. Rendering them as ordinary children of a mounted component is what lets this plugin use
 *  dsh's React icons from plain DOM code, no react-dom import and no portal. The sheet costs
 *  one hidden div per session. */
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

/** Create or overwrite the tool-fold stylesheet, always rewriting it, so a hot reload's stale rules
 *  never survive in a page that still carries the old bundle. */
const ensureFoldStyle = () => {
  // Reuse the element but always rewrite it. A hot reload drops a new bundle into a page that still
  // carries the previous one's sheet, so returning early here left the old rules in force and the new
  // build's markup styled by them, which looks like the feature half-shipped until the tab is
  // reloaded by hand.
  const existing = document.getElementById("dsh-oh-my-claude-fold");
  const el = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  el.id = "dsh-oh-my-claude-fold";
  // The header reads as dsh's muted tool text, taking its secondary content size and label colour.
  // It sits flush-left like any prose line. The leading span is a fixed 16px box of both glyphs
  // stacked, so the row never shifts: the tool icon rests and the chevron sits on top
  // cross-fading on hover. This is how dsh draws its own tool rows (`iconIdle`/`chevronHover` in
  // dsh-client-ui-tool), secondary label colour, and the chevron never rotates. Expanding
  // is shown by the fence appearing, not by the marker turning. A `flat` header has no fence under it
  // (`▤ Read \`path\`` is the whole step), so it takes the muted type and the icon but neither the
  // pointer nor the chevron: there is nothing to disclose. The `body` prefix stays out of `lead` on
  // purpose. Pasted into a descendant position it would read as a `body` inside a `p` and match
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
    // `text-indent` inherits, and dsh renders inline code as an inline-block, a block container, so
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
    // two rows are never siblings and a `+` rule between them can never match. That margin
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

let foldClicksBound = false;
/** One delegated listener pair toggles a header. Bound once per bundle and dropped when this bundle
 *  retires: a flag on documentElement outlives the reload the listeners do not, which left a tab
 *  answering clicks from whichever bundle loaded first and every later one silently unbound. */
const bindFoldClicks = () => {
  if (foldClicksBound) return;
  foldClicksBound = true;
  const stop = new AbortController();
  // On teardown, abort the fold-click listeners, so a retired bundle stops answering header clicks.
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

/** Wire tool-step folding: ensure the fold styles, bind the delegated header-click listeners, and
 *  scan existing steps so already-open tool rows can fold. */
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
    // attributes, leaving a prose line wearing the header type, taking clicks, and hiding the
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
    // A header folded before its icon lands still opens on click or Enter. `setFoldState` is what
    // gives it the role and the tab stop, so the only thing missing for that frame is the glyph.
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
  // What a burst touched, as headers. A record's target is the node whose children changed,
  // either the paragraph itself when React rewrites its text or the markdown container when a
  // step gains its fence. Its added nodes are whole blocks that may hold headers of their own.
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
      const el = recordElement(rec);
      if (el) take(el);
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
/** The readout's own wrapper in dsh's row, so a later hook can clear an earlier one's node. */
const COST_SLOT = "data-omc-cost-slot";
/** `localStorage["omc-debug"] === "1"`, read once at load: the check used to run on every frame
 *  the cost hook fired, which is every dirty frame of a streaming turn while the row is lost. */
const COST_DEBUG = (() => {
  try {
    return localStorage.getItem("omc-debug") === "1";
  } catch {
    return false;
  }
})();
/** One of dsh's stats pills as the row holds it: an anchor span wrapping a popover button. */
const STATS_PILL = ':scope > span > button[aria-haspopup="dialog"]';
/** dsh 0.1.7's compact stats draw each stat as a bare `span` pill in the row, with no anchor span
 *  around it and no button; its detailed stats keep the anchor-and-button pair `STATS_PILL` finds.
 *  Its own class is what the cost pill copies there, and the plugin's own node is excluded by the
 *  slot attribute it carries. */
const STATS_PILL_SPAN = ':scope > span[class*="pill" i]:not([data-omc-cost-slot])';

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
  // dsh 0.1.6-alpha.2 draws the same pills and dropped the marker, so the row is recognised by the
  // shape instead: anchor spans holding one popover pill each. Asked for as direct children, which
  // is what keeps the footer that wraps the row from matching too. Appending into that footer is
  // how the readout ended up outside the row, as loose text behind a bar.
  if (el.querySelector(STATS_PILL)) return true;
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
  useLocale();
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  // What the poll compares against without listing `turns` as a dependency of its effect.
  const turnsRef = useRef<TurnRecord[]>([]);
  turnsRef.current = turns;
  const visibleRef = useRef(true);

  useEffect(() => {
    // No `activeClaudeSession` gate here. It reads the session's provider binding, which is briefly
    // undefined during a restart or a rebind; an effect that ran in that window returned before
    // installing the interval, with `[ctx, sessionId]` stable, never ran again. So the cost never
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
  // The footer pill is on unless the box turned it off, so an absent key still shows it. Only the
  // readout goes: the turn records behind it are collected either way, and the figure is back the
  // moment the switch returns.
  const [costOff] = useHintFlag("costOff");

  // dsh's current session blinks: a child session takes the slot for a moment, and a model
  // directory mid-rebind answers no provider at all. A blank answer used to read as "not mine" and
  // took the cost off the row under the pointer, so only another session's id gives it up.
  // Derived during render, committed after it: React throws renders away, and one that never
  // reached the screen used to latch this ref anyway. So a render for another session could leave
  // the cost of this one on the row.
  const mineRef = useRef(false);
  const current = openSessionId(ctx);
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
  const last = turns[turns.length - 1];
  const text = mine && !costOff && total > 0 && last ? costText(total, last.costUsd) : "";
  // Past the line the pill turns orange and the tooltip leads with the fact; every wording says
  // API-rate, since a subscription login is not billed by this figure.
  const over = mine && total > 0 && line !== undefined && total >= line;
  const base =
    mine && total > 0 && last
      ? t(turns.length === 1 ? "main.cost.tooltipOne" : "main.cost.tooltipOther", {
          total: fmtCost(total),
          last: fmtCost(last.costUsd),
          n: turns.length,
          ttft: fmtTtft(last.ttftMs),
        })
      : "";
  const title =
    over && line !== undefined ? t("main.cost.tooltipOver", { line: fmtCost(line), base }) : base;
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
    const v = guardDraft.trim();
    if (v === "") {
      setSessionLine(null);
      return;
    }
    const n = Number(v);
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
    // good. The row has to be hooked again each time it loses ours.
    // `localStorage.setItem("omc-debug", "1")` prints every hook, drop and repaint to the console;
    // the row lives in someone else's DOM, so this is the only way to watch what removed it.
    const debug = (...args: unknown[]) => {
      try {
        if (COST_DEBUG) console.debug("[oh-my-claude cost]", ...args);
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
        // called this back on every frame, 35 mutations a second under an idle pill, measured
        // 2026-09-10, for nothing.
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
        // The cost reads last in the row, after dsh's own stats. dsh rebuilds those children
        // whenever their shape changes — switching Performance and usage between Compact and
        // Detailed is one such rebuild — and the new ones land after this node, which left the
        // cost reading first (owner, 2026-09-22). Moving it back is one append, and it only runs
        // on the frame a rebuild happened.
        const host = inline.parentElement;
        if (host && inline.nextElementSibling !== null) host.append(inline);
        // The same rebuild can change the class the pill borrows, so it is re-copied when dsh's
        // own pill no longer matches.
        const live = host?.querySelector(STATS_PILL) ?? host?.querySelector(STATS_PILL_SPAN);
        if (live && trigger && live.className !== trigger.className) {
          trigger.className = live.className;
          inline.className =
            live.parentElement === host ? "" : (live.parentElement?.className ?? "");
        }
        return;
      }
      if (inline) debug("row dropped our span; hooking again");
      // Three tries, cheapest first. The row dsh re-rendered is usually the same element with new
      // children, so the one it was last found in is tried first. When dsh replaces the element,
      // which it does on a settled step, and that is exactly when this runs, the footer it hangs
      // in is still the same node, so the second try searches that instead of the document. Only a
      // conversation that was never hooked, or a footer that went away, pays for the full walk.
      // dsh 0.1.5 marks the row, so ask for it by name first: one indexed attribute query against
      // a conversation where the `div` walk below is thousands of nodes.
      const rowIn = (root: ParentNode) => {
        const marked = [...root.querySelectorAll<HTMLDivElement>("div[data-composer-stats]")].at(
          -1,
        );
        if (marked?.isConnected) return marked;
        const divs = [...root.querySelectorAll<HTMLDivElement>("div")];
        // A div holding dsh's own pills is the row itself; the containers around it can pass the
        // looser shape test, and appending into one of those is how the readout ended up beside
        // the row rather than in it. The looser test still answers for a dsh that draws no pills.
        return (
          divs.filter((div) => div.querySelector(STATS_PILL)).at(-1) ??
          divs.filter(isStatsRow).at(-1)
        );
      };
      // The anchor is rendered into the composer dock's slot, and the stats row is a child of that
      // same dock, so the dock is searched before the whole document: the document walk ran on
      // every dirty frame of a streaming turn for as long as the row was lost.
      const dock = anchorRef.current?.parentElement?.parentElement ?? undefined;
      const statsRow =
        lastRow && isStatsRow(lastRow)
          ? lastRow
          : ((lastHost?.isConnected === true ? rowIn(lastHost) : undefined) ??
            (dock ? rowIn(dock) : undefined) ??
            rowIn(document));
      lastRow = statsRow;
      lastHost = statsRow?.parentElement ?? lastHost;
      if (!statsRow) {
        debug("no stats row on screen");
        return;
      }
      inline = document.createElement("span");
      // Named so a hook can clear what an earlier one left. `drop` only ever knew the node in
      // hand, so a readout appended into a row dsh then replaced, or into a container that read
      // as the row before the pills arrived, stayed in the page, out of sight, for the tab's life.
      inline.setAttribute(COST_SLOT, "");
      for (const stale of document.querySelectorAll(`[${COST_SLOT}]`)) stale.remove();
      inline.style.whiteSpace = "nowrap";
      body = document.createElement("span");
      // The pill row: an anchor span holding a pill (button or span) whose first span is the
      // label. Ours borrows the three class names from dsh's first pill, so it takes the same
      // padding, radius and colour whatever the module hash is in this build. It is a button, as
      // dsh's are: the hover rule is `button._pill:hover`, a span never lights up, and a phone has
      // no hover at all. The tap opens the dialog, which is where the detail lives.
      // 0.1.5 marks the row and its first pill is the first grandchild; 0.1.6-alpha.2 drops the
      // marker but draws the same anchor-and-pill pair, so an unmarked row is asked for the pill
      // by shape. Copying its classes is also what gives the readout dsh's own phone behaviour:
      // the label carries `overflow:hidden;text-overflow:ellipsis` under a button capped at the
      // row's width, so it shortens as the row narrows and ends as the icon alone.
      const proto = statsRow.querySelector(STATS_PILL);
      // 0.1.7's pill is the span itself, so there is no anchor class to copy and the pill class
      // goes on the trigger. Reading `firstElementChild.firstElementChild` as the prototype, which
      // is what ran before, picked up that pill's icon instead and dressed the cost readout in an
      // `svg` class: a bordered box with the mark above the figure (owner, 2026-09-22).
      const protoSpan = proto === null ? statsRow.querySelector(STATS_PILL_SPAN) : null;
      if (proto?.parentElement || protoSpan) {
        pad = "";
        inline.className = proto?.parentElement?.className ?? "";
        trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = (proto ?? protoSpan)?.className ?? "";
        trigger.setAttribute("data-omc-cost-pill", "");
        trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-expanded", String(openRef.current));
        trigger.setAttribute("aria-label", titleRef.current);
        paintOver();
        trigger.addEventListener("click", () => setOpen((was) => !was));
        body.className = (proto ?? protoSpan)?.querySelector("span")?.className ?? "";
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
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a non-modal popover; <dialog> hides unless open and brings its own box
          role="dialog"
          aria-label={t("main.cost.dialogLabel")}
          data-omc-cost-dialog=""
          style={pos ?? MEASURE_STYLE}
        >
          <div data-omc-cost-title="">
            <span data-omc-cost-title-label="">
              <Spark size={14} />
              {t("main.cost.dialogLabel")}
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
              {t("main.cost.warnAt")}
              <input
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                aria-label={t("main.cost.warnAria")}
                data-omc-cost-guard-input=""
                value={guardDraft}
                placeholder={
                  numberOr(boxLine) === undefined ? t("main.cost.offPlaceholder") : String(boxLine)
                }
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
                {t("main.cost.clear")}
              </button>
            )}
            {subscription && <p data-omc-cost-note="">{t("main.cost.subscriptionNote")}</p>}
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
 * On a blank session, select the Claude mount and model this workspace last ran.
 *
 * Up to dsh 0.1.6 a new session arrived on whatever the picker last held, so this only had to
 * choose which Claude model. 0.1.7 makes each workspace's blank session ahead of time on the
 * deployment default (llama on this box) with no selection of its own, so the memory now sets
 * the provider as well: a workspace whose last Claude turn ran on a box's mount reopens on that
 * box, a local one reopens local (owner, 2026-09-22: "it should remember the last one used per
 * workspace, not reset to llama"). A blank the person has already switched by hand is left
 * alone, since a picked provider is a `next` selection dsh records. A row written before the
 * provider was stored names the model only and still needs the session to be Claude already.
 * Once per session id per tab, and never once the session has a message.
 */
function WorkspaceModelMemory({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useEffect(() => {
    const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId];
    if (!entry || entry.blank === false || !entry.cwd) return;
    const current = claudeProviderOf(ctx, sessionId);
    const picked = entry.projectionValues?.modelSelection?.next?.provider;
    if (appliedModel.has(sessionId)) return;
    appliedModel.add(sessionId);
    let live = true;
    const runApply = async () => {
      const hints = await loadHints();
      if (hints.workspaceModelOff === true || !live) return;
      const q = `cwd=${encodeURIComponent(entry.cwd ?? "")}`;
      const saved = await readJson<{ model?: string; provider?: string }>(
        await fetch(`${ROUTE}/workspace-model?${q}`),
      );
      if (!saved.model || !live) return;
      // The mount to open on: the session's own when it is already Claude, else the remembered
      // one, and only while nobody has picked a provider for this blank by hand. Read again here,
      // not only at mount: the two reads above are async, and a click in the picker during them
      // is a pick this must not overwrite.
      const pickedNow =
        ctx.sessions.list.getSnapshot()?.byId[sessionId]?.projectionValues?.modelSelection?.next
          ?.provider ?? picked;
      const provider =
        current ?? (saved.provider && !pickedNow ? claudeMount(saved.provider) : undefined);
      if (!provider) return;
      const dir = ctx.modelDirectories.directoryFor(sessionId);
      const now = dir.store.getSnapshot().current;
      if (now?.provider === provider && now.model === saved.model) return;
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
 * Put a session whose model id the lineup no longer has onto the form it still offers. The CLI
 * renames its picker rows between releases (2.1.274 lists Fable as `claude-fable-5-1` where 2.1.273
 * listed `claude-fable-5-1[1m]`), and a session keeps the id it was given in its own log, so its
 * composer seat read `claude-code/claude-fable-5-1[1m]`: dsh names a selection by finding it in the
 * catalog and prints the raw pair when it is not there (owner, 2026-09-17). Same model, new
 * spelling, so the repair is a plain select; never while a turn runs, since a model change makes the
 * next turn respawn the process. An id with no living form is left alone.
 */
function StaleModelRepair({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useEffect(() => {
    let dir: ReturnType<ClientCtx["modelDirectories"]["directoryFor"]>;
    try {
      dir = ctx.modelDirectories.directoryFor(sessionId);
    } catch {
      return; // unbound in this tab (see claudeProviderOf)
    }
    let settled = false;
    const repair = guard(() => {
      if (settled) return;
      const snap = dir.store.getSnapshot();
      const cur = snap.current;
      if (!cur?.provider.startsWith("claude-code")) return;
      const offered = snap.groups?.find((g) => g.id === cur.provider)?.models.map((m) => m.id);
      if (!offered || offered.length === 0) return; // the catalog has not loaded yet
      if (offered.includes(cur.model)) {
        settled = true;
        return;
      }
      if (ctx.sessions.list.getSnapshot()?.byId[sessionId]?.running) return;
      settled = true;
      const living = livingModelId(cur.model, offered);
      if (living && dir.select)
        void dir.select({ provider: cur.provider, model: living }).catch(() => {});
    });
    repair();
    // The directory store for the catalog arriving, the list store for the turn ending: a session
    // found mid-turn is repaired the moment it stops running.
    const offDir = dir.store.subscribe(repair);
    const offList = ctx.sessions.list.subscribe?.(repair);
    return () => {
      offDir();
      offList?.();
    };
  }, [ctx, sessionId]);
  return null;
}

/**
 * The prompt starter: a card above the composer on a session that has not been used yet, offering the
 * opening line saved for this session, or on a brand-new tab the last one saved anywhere, and
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
  useLocale();
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
    setNote(t("main.settings.saving"));
    void fetch(`${ROUTE}/starter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sessionId, text }),
    })
      .then((r) => {
        setNote(r.ok ? t("main.starter.saved") : t("main.starter.saveFailed"));
      })
      .catch(() => {
        setNote(t("main.starter.saveFailed"));
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
  const saveLabel =
    note !== "" ? note : busy ? t("main.starter.saveDraft") : t("main.starter.saved");

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
          <span style={clipped}>{t("main.starter.empty")}</span>
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
            <span style={clipped}>{t("main.starter.fills")}</span>
          </>
        )}
        <span style={{ flex: "1 1 auto" }} />
        <Slide open={draft !== ""}>
          <button
            type="button"
            style={chip}
            onClick={() => save(draft)}
            title={t("main.starter.saveTitle")}
            // Greyed while the composer already matches the saved opener, and while a save runs.
            disabled={!busy || note !== ""}
          >
            {/* Every label the chip can show shares one cell, so Saving… and Saved do not resize it. */}
            <span style={{ display: "inline-grid" }}>
              {[
                t("main.starter.saveDraft"),
                t("main.settings.saving"),
                t("main.starter.saved"),
                t("main.starter.saveFailed"),
              ].map((text) => (
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
            label={t("main.starter.forget")}
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
/** Reveal a starter-row chip with a slide animation, collapsing its neighbour via a zero-width
 *  column and dropping it from the tab order when closed. */
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
/** Fetch and parse the box-wide hints store once, memoising the promise and retrying on failure
 *  rather than caching the empty result. */
const loadHints = (): Promise<Record<string, boolean | number>> =>
  (hintsOnce ??= fetch(`${ROUTE}/hints`)
    .then((r) => readJson<Record<string, boolean | number>>(r))
    .catch(() => {
      hintsOnce = undefined; // a failed read is retried by the next reader, not cached
      return {};
    }));
/** One box-wide hint and its setter. Undefined until the first load. The setter posts to the box,
 *  null clears the hint, and every other reader in this tab re-reads once it lands. */
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

/**
 * Write several hints as one request.
 *
 * Two `set` calls in a row are two reads and two writes of the same file, and the second read can
 * predate the first write: picking Off wrote the off flag over a snapshot that still held the on
 * flag, so both came back set and the control stayed On. Keys that answer one question travel
 * together.
 */
function writeHints(next: Record<string, boolean | number | null>): void {
  void fetch(`${ROUTE}/hints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  }).finally(() => {
    hintsOnce = undefined;
    window.dispatchEvent(new Event(HINTS_EVENT));
  });
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

/** The settings row for plan limit warnings: one switch for both, and a Customize fold to keep one
 *  without the other. On by default; the flags live in the box's hints store like every switch. */
function LimitWarningsSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("limitWarningsOff");
  const [ringOff, setRingOff] = useHintFlag("limitRingOff");
  const [noticeOff, setNoticeOff] = useHintFlag("limitNoticeOff");
  return (
    <>
      <div
        data-omc-limit-warnings=""
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
          <div>{t("main.settingsUi.limitTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.limitDesc")}</div>
        </div>
        <Switch
          on={!off}
          onChange={(next) => setOff(!next)}
          label={t("main.settingsUi.limitTitle")}
        />
      </div>
      {!off && (
        <details data-omc-limit-custom="" style={NESTED}>
          <summary style={{ cursor: "pointer", color: T.muted }}>
            {t("main.settingsUi.customize")}
          </summary>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0 16px" }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                data-omc-limit-ring=""
                checked={!ringOff}
                onChange={(e) => setRingOff(!e.target.checked)}
              />
              {t("main.settingsUi.tintRing")}
              <span style={{ color: T.faint, fontSize: 12 }}>
                {t("main.settingsUi.tintRingHint")}
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                data-omc-limit-notice=""
                checked={!noticeOff}
                onChange={(e) => setNoticeOff(!e.target.checked)}
              />
              {t("main.settingsUi.noticeComposer")}
              <span style={{ color: T.faint, fontSize: 12 }}>
                {t("main.settingsUi.noticeHint")}
              </span>
            </label>
          </div>
        </details>
      )}
    </>
  );
}

/** The star nudge under the heading, hidden for good once dismissed. The flag is box-wide, not
 *  per-browser: someone who hid this line meant to hide it, not to hide it on one laptop. */
function StarLine() {
  const [off, setOff] = useHintFlag("starOff");
  if (off) return null;
  return <StarNudge onDismiss={() => setOff(true)} />;
}

/** The Claude look: the master switch first under the section title, then a fold with one checkbox
 *  per group and the accent colour. Box-wide in the hints store like the switches under it;
 *  applyTheme repaints on the hints event the setters dispatch, so nothing here touches the DOM. */
function ThemeSwitch() {
  useLocale();
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
          <div>{t("main.settingsUi.themeTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.themeDesc")}</div>
        </div>
        <Switch
          on={!off}
          onChange={(next) => setOff(!next)}
          label={t("main.settingsUi.themeTitle")}
        />
      </div>
      {!off && (
        <details data-omc-theme-custom="" style={NESTED}>
          <summary style={{ cursor: "pointer", color: T.muted }}>
            {t("main.settingsUi.customize")}
          </summary>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0 16px" }}
          >
            <ThemeGroupBox flag="themeRowOff" group="row" label={t("main.settingsUi.groupRow")} />
            <ThemeGroupBox
              flag="themeProseOff"
              group="prose"
              label={t("main.settingsUi.groupProse")}
            />
            <ThemeGroupBox
              flag="themeSendOff"
              group="send"
              label={t("main.settingsUi.groupSend")}
            />
            <ThemeGroupBox
              flag="themePanelOff"
              group="panel"
              label={t("main.settingsUi.groupPanel")}
            />
            <ThemeGroupBox
              flag="themeRainbowOff"
              group="rainbow"
              label={t("main.settingsUi.groupRainbow")}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              {t("main.settingsUi.accent")}
              <input
                type="color"
                data-omc-theme-accent=""
                aria-label={t("main.settingsUi.accentColour")}
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
                  {t("main.settingsUi.reset")}
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
  useLocale();
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
        <div>{t("main.settingsUi.starterTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.starterDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.starterTitle")}
      />
    </div>
  );
}

/** What each dsh block cost on the last turn in this workspace, in characters. Read once when the
 *  card renders, which is when Settings opens; nothing polls. A workspace that has not run a turn
 *  yet answers nothing, and a row with no number shows no number rather than a zero: zero would
 *  claim dsh sent nothing, and not knowing is not the same claim. */
function useContextSizes(ctx: ClientCtx): Record<string, number> | null {
  const [sizes, setSizes] = useState<Record<string, number> | null>(null);
  const snap = ctx.sessions.list.getSnapshot();
  const open = openSessionId(ctx);
  const cwd = (open ? snap?.byId[open]?.cwd : "") ?? "";
  useEffect(() => {
    if (!cwd) return;
    let live = true;
    const run = async () => {
      const reply = await readJson<{ sizes?: Record<string, number> }>(
        await fetch(`${ROUTE}/context-sizes?cwd=${encodeURIComponent(cwd)}`),
      );
      if (live) setSizes(reply.sizes ?? null);
    };
    // A box whose server predates this route answers an error; the card is still usable without
    // the numbers, so it stays quiet rather than showing the owner a failure they cannot act on.
    void run().catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd]);
  return sizes;
}

/** What Claude Code loads for itself in this workspace, and whether anything turns it off. Read
 *  once beside the sizes, from the same open. The whole answer is worked out on the box: the count
 *  and total come from the files, and the on/off from that box's settings files plus, for a local
 *  box, dsh's own environment. Null while it is in flight, on a card with no session behind it, or
 *  on a box whose server predates the route, and the row reads as loaded in all three: that is what
 *  a Claude Code session does on a fresh box. */
function useClaudeMd(ctx: ClientCtx): ClaudeMdState | null {
  const [state, setState] = useState<ClaudeMdState | null>(null);
  const snap = ctx.sessions.list.getSnapshot();
  const id = openSessionId(ctx) ?? "";
  const cwd = (id ? snap?.byId[id]?.cwd : "") ?? "";
  // A second account or a named ssh box keeps its own settings files, so the box has to be named;
  // `cwd` alone resolves a remote workspace but not which instance the session is bound to.
  const provider = id ? (claudeProviderOf(ctx, id) ?? "") : "";
  useEffect(() => {
    if (!cwd) return;
    let live = true;
    const run = async () => {
      const onBox = provider ? `&provider=${encodeURIComponent(provider)}` : "";
      const reply = await readJson<ClaudeMdState>(
        await fetch(`${ROUTE}/claude-md?cwd=${encodeURIComponent(cwd)}${onBox}`),
      );
      if (live) setState(reply);
    };
    void run().catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd, provider]);
  return state;
}

/** The sentence beside the CLAUDE.md row. Long only where it has to be: almost nobody disables
 *  these files, so the loaded state says the one thing a reader needs and the off states, which are
 *  the ones worth acting on, name the variable and where it was set. The key is named rather than
 *  linked on purpose: the settings editor below this card is mounted once per box, so a jump would
 *  have to guess which, and the name is greppable on a box this panel is not open on. */
function claudeMdWhy(state: ClaudeMdState | null): string {
  const by = state?.disabledBy;
  if (by === undefined) return t("main.settingsUi.claudeMdLoaded");
  const scope = SETTINGS_SCOPES.find((s) => s === by);
  return scope === undefined
    ? t("main.settingsUi.claudeMdOffEnv")
    : t("main.settingsUi.claudeMdOffScope", { scope: SCOPE_LABELS[scope] });
}

/** One measured size, beside the row it belongs to. Thousands are rounded to one decimal because
 *  the exact character count of a block nobody can edit is noise; the order of magnitude is the
 *  decision. */
function ContextSize({
  source,
  chars,
  files,
}: {
  source: string;
  chars: number | undefined;
  /** Shown before the size where one block is really several files. It is the whole explanation for
   *  a total larger than the file the reader is thinking of, without listing paths the Instructions
   *  tab already lists. */
  files?: number;
}) {
  useLocale();
  if (chars === undefined) return null;
  const shown = chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars);
  const howMany =
    files === undefined
      ? ""
      : t(files === 1 ? "main.settingsUi.filesOne" : "main.settingsUi.filesOther", { n: files });
  return (
    <span data-omc-context-size={source} style={{ color: T.faint, fontSize: 12 }}>
      {" "}
      {howMany}
      {t("main.settingsUi.chars", { n: shown })}
    </span>
  );
}

/** One block the switches can withhold: checked means dsh sends it, and the flag is that block's
 *  off key, so a box that has never opened this card behaves as it did before the card existed. */
function ContextBox({
  source,
  label,
  flag,
  chars,
}: {
  source: string;
  label: string;
  flag: string;
  chars: number | undefined;
}) {
  const [off, setOff] = useHintFlag(flag);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <input
        type="checkbox"
        data-omc-context={source}
        checked={!off}
        onChange={(e) => setOff(!e.target.checked)}
      />
      <span>
        {label}
        <ContextSize source={source} chars={chars} />
      </span>
    </label>
  );
}

/** A block this card cannot move, drawn disabled with the reason beside it rather than in a title,
 *  so it is not mouse-only. Listing it is the point: a block that vanishes from the list is worse
 *  than one the owner can see and not turn off. Checked means it reaches Claude Code; the one row
 *  that draws clear is dsh's system prompt, which the adapter has always dropped. It is backed by
 *  no hint key at all, so there is nothing here for a later edit to wire up by mistake. */
function ContextFixed({
  source,
  label,
  why,
  chars,
  files,
  checked = true,
}: {
  source: string;
  label: string;
  why: string;
  chars: number | undefined;
  files?: number;
  checked?: boolean;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.muted }}>
      <input
        type="checkbox"
        data-omc-context={source}
        checked={checked}
        disabled
        aria-disabled="true"
        readOnly
      />
      <span>
        {label}
        <ContextSize source={source} chars={chars} files={files} />
        <span style={{ color: T.faint, fontSize: 12 }}>: {why}</span>
      </span>
    </label>
  );
}

/** What dsh adds to every prompt besides what the owner typed: the master switch, then a fold with
 *  one checkbox per block the plugin can withhold and one disabled row per block it cannot. The
 *  keys go to the box's hints store, and the adapter reads them when it assembles a turn, so a
 *  session already running keeps whatever it was sent before the switch moved. */
function ContextSwitch({ ctx }: { ctx: ClientCtx }) {
  useLocale();
  const [on, setOn] = useHintFlag(MASTER_KEY);
  const off = !on;
  const sizes = useContextSizes(ctx);
  const claudeMd = useClaudeMd(ctx);
  // The two switchable blocks and nothing else. The runtime snapshot, the tools guidance and the
  // CLAUDE.md copy are all still sent (or already dropped) whatever this switch says, so counting
  // them here would promise a saving the switch cannot deliver.
  const savable =
    sizes && (sizes.instructions !== undefined || sizes.skills !== undefined)
      ? (sizes.instructions ?? 0) + (sizes.skills ?? 0)
      : undefined;
  return (
    <>
      <div
        data-omc-context-switch=""
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
          <div>{t("main.settingsUi.contextTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.contextDesc")}</div>
          {/* The sizes are measured before any switch drops a block, so the number holds in both
              states and only the tense changes: off, it is what the switch is already keeping out.
              "Going by" rather than "on", because the switch may have moved since that turn ran. */}
          {savable !== undefined && (
            <div style={{ color: T.faint, fontSize: 12, marginTop: 2 }}>
              {off ? t("main.settingsUi.offIsSaving") : t("main.settingsUi.offWouldSave")}
              <ContextSize source="total" chars={savable} />
              {t("main.settingsUi.aTurnGoingBy")}
            </div>
          )}
        </div>
        <Switch on={on} onChange={setOn} label={t("main.settingsUi.contextTitle")} />
      </div>
      {!off && (
        <details data-omc-context-custom="" style={NESTED}>
          <summary style={{ cursor: "pointer", color: T.muted }}>
            {t("main.settingsUi.customize")}
          </summary>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0 16px" }}
          >
            <div style={{ color: T.muted, fontSize: 12 }}>{t("main.settingsUi.whatDshAdds")}</div>
            <ContextBox
              source="instructions"
              flag={OFF_KEY.instructions}
              label={t("main.settingsUi.ctxInstructions")}
              chars={sizes?.instructions}
            />
            <ContextBox
              source="skills"
              flag={OFF_KEY.skills}
              label={t("main.settingsUi.ctxSkills")}
              chars={sizes?.skills}
            />
            <ContextFixed
              source="runtime"
              label={t("main.settingsUi.ctxRuntime")}
              why={t("main.settingsUi.ctxRuntimeWhy")}
              chars={sizes?.runtime}
            />
            <ContextFixed
              source="tools"
              label={t("main.settingsUi.ctxTools")}
              why={t("main.settingsUi.ctxToolsWhy")}
              chars={sizes?.tools}
            />
            <div style={{ color: T.muted, fontSize: 12, marginTop: 6 }}>
              {t("main.settingsUi.whatClaudeLoads")}
            </div>
            <ContextFixed
              source="claudemd"
              label={t("main.settingsUi.ctxClaudeMd")}
              why={claudeMdWhy(claudeMd)}
              chars={claudeMd?.chars}
              files={claudeMd?.files}
              checked={claudeMd?.disabledBy === undefined}
            />
            <div style={{ color: T.muted, fontSize: 12, marginTop: 6 }}>
              {t("main.settingsUi.whatDshWritesNeverSends")}
            </div>
            <ContextFixed
              source="system"
              label={t("main.settingsUi.ctxSystem")}
              why={t("main.settingsUi.ctxSystemWhy")}
              chars={undefined}
              checked={false}
            />
            <div style={{ color: T.faint, fontSize: 12, marginTop: 6 }}>
              {t("main.settingsUi.ctxCaption")}
            </div>
          </div>
        </details>
      )}
    </>
  );
}

/** The part of dsh's chat publication the row mask reads: the render order, and a keyed reader for
 *  the rows. dsh ships the full contract to its own packages only, so the shape is named here. */
type ChatFlow = {
  readonly order: readonly string[];
  readonly nodes: { get: (key: string) => ChatFlowNode | undefined };
};

/** Stable empty order, so a mount without the chat hook does not hand `useMemo` a new array. */
const NO_ROWS: readonly string[] = [];

const ROW_MASK_STYLE_ID = "dsh-oh-my-claude-context-rows";

/**
 * Fold away the chat rows that describe context Claude Code never received. dsh logs every block it
 * assembled and draws a row per block, so a session with the switches off still shows an
 * "Instructions from" row and a "System prompt" row for text this plugin dropped at the seam. That
 * reads as a receipt and it is not one.
 *
 * Renderless, and it writes one sheet rather than touching dsh's DOM: the rows are named by
 * `data-chat-flow-key`, the key dsh's own projection put on the row, so nothing here depends on a
 * generated class name or on the row's text. Only a session running on this plugin's provider is
 * masked; dsh sends all of it to everyone else, and their rows are true.
 */

function ContextRowMask({
  sessionId,
  ctx,
  useChat,
}: {
  sessionId?: string;
  ctx: ClientCtx;
  useChat?: <S>(select: (chat: ChatFlow) => S, eq?: (a: S, b: S) => boolean) => S;
}) {
  const [on] = useHintFlag(MASTER_KEY);
  const [instructionsOff] = useHintFlag(OFF_KEY.instructions);
  const [skillsOff] = useHintFlag(OFF_KEY.skills);
  const order = useChat?.((chat) => chat.order) ?? NO_ROWS;
  const nodes = useChat?.((chat) => chat.nodes);
  const mine = sessionId !== undefined && isClaudeSession(ctx, sessionId);
  // The node map is a new object on every streamed chunk, and the walk below visits every row in
  // the conversation, so keying the memo on the map made a long turn quadratic in the length of
  // the transcript. What decides a row's masking is its source kind, fixed when the row is made,
  // so the walk re-runs when a row is added or removed (`order`) and not when one grows.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const haveNodes = nodes !== undefined;
  const masked = useMemo(() => {
    const current = nodesRef.current;
    if (!mine || current === undefined) return [];
    const drops = contextDrops({
      [MASTER_KEY]: on,
      [OFF_KEY.instructions]: instructionsOff,
      [OFF_KEY.skills]: skillsOff,
    });
    return maskedRows(order, (key) => current.get(key), drops);
  }, [mine, order, haveNodes, on, instructionsOff, skillsOff]);
  useEffect(() => {
    const existing = document.getElementById(ROW_MASK_STYLE_ID);
    const el = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
    el.id = ROW_MASK_STYLE_ID;
    // A key is dsh's to shape, so it is escaped for the attribute string rather than trusted.
    const css =
      masked.length === 0
        ? ""
        : `${masked
            .map((key) => `[data-chat-flow-key="${key.replace(/["\\]/g, "\\$&")}"]`)
            .join(",")}{display:none}`;
    if (el.textContent !== css) el.textContent = css;
    if (!existing) document.head.appendChild(el);
    // Cleared rather than removed on unmount: leaving the rules behind would hide rows in whatever
    // session the tab moves to next, which may be another provider's.
    return () => {
      el.textContent = "";
    };
  }, [masked]);
  return null;
}

/** The settings switch for the update notice. The flag lives in the box's hints store, which the
 *  server reads before it asks npm: off means no registry read at all, not a hidden pill. */
function UpdateNoticeSwitch() {
  useLocale();
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
        <div>{t("main.settingsUi.updateNoticeTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.updateNoticeDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.updateNoticeTitle")}
      />
    </div>
  );
}

/** A fold nested under a Settings row: indented behind a thin rule, the look the update options
 *  have, so what belongs to the row above reads as its child. */
const NESTED: CSSProperties = { ...nested, marginBottom: 12, fontSize: 13 };

/** The settings switch for the whole Claude Code update feature, with its channel, auto-update and
 *  history under it while it is on. The flag lives in the box's hints store and the server reads it
 *  before every check: off means no pointer read, no card and no install, on every box. */
function ClaudeUpdateSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("claudeUpdateOff");
  return (
    <>
      <div
        data-omc-claude-update-switch=""
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
          <div>{t("main.settingsUi.claudeUpdateTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.claudeUpdateDesc")}
          </div>
        </div>
        <Switch
          on={!off}
          onChange={(next) => setOff(!next)}
          label={t("main.settingsUi.claudeUpdateTitle")}
        />
      </div>
      {!off && <ClaudeUpdateDetails />}
    </>
  );
}

/**
 * The settings control for a proxy in front of api.anthropic.com: Auto, On or Off.
 *
 * Auto asks the base URL itself, so the common case needs no decision: a proxy that forwards
 * answers an unauthenticated request with Anthropic's own error and request id. The other two are
 * answers a person gave, and detection never overrides one: an endpoint that starts reading as
 * Anthropic must not turn this back on for someone who turned it off.
 */
function ProxyFirstPartySwitch() {
  useLocale();
  const [on] = useHintFlag("proxyFirstParty");
  const [off] = useHintFlag("proxyFirstPartyOff");
  const mode = on ? "on" : off ? "off" : "auto";
  // Both keys in one write: `false` clears a key, and the pair only ever holds the chosen answer.
  const choose = (next: string) =>
    writeHints({ proxyFirstParty: next === "on", proxyFirstPartyOff: next === "off" });
  return (
    <>
      <div
        data-omc-proxy-first-party-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: 4,
        }}
      >
        <div>
          <div>{t("main.settingsUi.proxyTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.proxyDescBefore")}
            <a
              data-omc-headroom-link=""
              href="https://github.com/headroomlabs-ai/headroom"
              target="_blank"
              rel="noreferrer"
              style={{ color: ACCENT }}
            >
              Headroom
            </a>
            {t("main.settingsUi.proxyDescAfter")}
          </div>
        </div>
        <select
          data-omc-proxy-first-party-mode=""
          aria-label={t("main.settingsUi.proxyTitle")}
          value={mode}
          onChange={(e) => choose(e.target.value)}
          // `0 0 auto` because the row is flex and a shrinkable select collapsed here until only
          // the first letter of "Auto" showed; `fieldSizing: content` then takes the width from
          // the word on show rather than from the longest option, so Off sits narrower than Auto.
          // A browser without it falls back to sizing by the longest option, which is the old look.
          style={{ ...select, flex: "0 0 auto", fieldSizing: "content", minWidth: 0 }}
        >
          <option value="auto">{t("main.settingsUi.auto")}</option>
          <option value="on">{t("main.usage.on")}</option>
          <option value="off">{t("main.usage.off")}</option>
        </select>
      </div>
      <details data-omc-proxy-details="" style={NESTED}>
        <summary style={{ cursor: "pointer", color: T.muted }}>
          {t("main.settingsUi.details")}
        </summary>
        <div style={{ color: T.faint, fontSize: 12, padding: "8px 0 0 16px" }}>
          {t("main.settingsUi.proxyDetails")}
        </div>
      </details>
    </>
  );
}

/** The settings switch for remembering which Claude model a workspace last ran. */
function WorkspaceModelSwitch() {
  useLocale();
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
        <div>{t("main.settingsUi.wsModelTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.wsModelDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.wsModelTitle")}
      />
    </div>
  );
}

/**
 * The settings switch between dsh's native tool rows and inline text for Claude's tool activity.
 * A bridge setting, not a Claude Code one, which is why it sits here and not in the Tune tab.
 * Box-wide, through the plugin's own tool-mode route; the row says why rows are off on a dsh
 * that will not load them, and is disabled then.
 */
function ToolRowsSwitch() {
  useLocale();
  const [info, setInfo] = useState<ToolModeInfo | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/tool-mode`)
      .then((r) => readJson<ToolModeInfo>(r))
      .then((b) => live && setInfo(b))
      .catch(() => live && setErr(t("tune.errToolMode")));
    return () => {
      live = false;
    };
  }, []);
  const locked = info?.rows.ok === false;
  const pick = async (mode: ToolMode) => {
    setErr("");
    try {
      setInfo(
        await readJson<ToolModeInfo>(
          await fetch(`${ROUTE}/tool-mode`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode }),
          }),
        ),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div
      data-omc-tool-rows-switch=""
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
        <div>{t("main.settingsUi.toolRowsTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>
          {err
            ? err
            : locked
              ? t("tune.rowsLocked", { reason: info?.rows.reason ?? "" })
              : t("main.settingsUi.toolRowsDesc")}
        </div>
      </div>
      <Switch
        on={info?.mode === "rows"}
        disabled={info === null || locked}
        onChange={(next) => void pick(next ? "rows" : "inline")}
        label={t("main.settingsUi.toolRowsTitle")}
      />
    </div>
  );
}

/** The settings switch for the cost pill in dsh's footer row. On unless it is turned off. */
function CostSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("costOff");
  return (
    <div
      data-omc-cost-switch=""
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
        <div>{t("main.settingsUi.costTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.costDesc")}</div>
      </div>
      <Switch on={!off} onChange={(next) => setOff(!next)} label={t("main.settingsUi.costTitle")} />
    </div>
  );
}

/**
 * The settings switch for the one-line recap on returning to a finished session, and the away bar
 * under it. Both are hints: the answer lands in the Asides ring, which is the box's, so whether to
 * spend the call is the box's question and not this browser's.
 */
function ReturnRecapSwitch() {
  useLocale();
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
          <div>{t("main.settingsUi.recapTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.recapDesc")}</div>
        </div>
        <Switch on={on} onChange={setOn} label={t("main.settingsUi.recapTitle")} />
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
          <span style={{ color: T.muted }}>{t("main.settingsUi.awayAtLeast")}</span>
          <select
            style={select}
            aria-label={t("main.settingsUi.awayAria")}
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
    minutes >= 60
      ? t("main.settingsUi.hour", { n: minutes / 60 })
      : t(minutes === 1 ? "main.settingsUi.minuteOne" : "main.settingsUi.minuteOther", {
          n: minutes,
        });
  return ms === RECAP_AWAY_MS ? t("main.settingsUi.defaultSuffix", { text }) : text;
};

/** Box-wide spend warning: a dollar figure that turns the cost pill orange once a session passes it. */
function SpendGuardField() {
  useLocale();
  const [stored, setStored] = useHintValue("spendWarnUsd");
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(numberOr(stored) === undefined ? "" : String(stored));
  }, [stored]);
  const save = () => {
    const v = draft.trim();
    if (v === "") {
      setStored(null);
      return;
    }
    const n = Number(v);
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
        <div>{t("main.settingsUi.spendTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.spendDesc")}</div>
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
          aria-label={t("main.settingsUi.spendAria")}
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
  useLocale();
  const [on, setOn] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/terminal-sync`)
      .then((r) => readJson<{ enabled: boolean }>(r))
      .then((b) => live && setOn(b.enabled))
      .catch(() => live && setErr(t("main.settingsUi.terminalReadErr")));
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
          {t("main.settingsUi.terminalTitle")}{" "}
          <span style={{ color: T.err }}>{t("main.settingsUi.experimental")}</span>
        </div>
        <div style={{ color: T.faint, fontSize: 12 }}>
          {err || t("main.settingsUi.terminalDesc")}
        </div>
      </div>
      <Switch
        on={on ?? false}
        onChange={(next) => void toggle(next)}
        label={t("main.settingsUi.terminalTitle")}
      />
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

/** Mirrors the server's LoginNeed: the box the failed turn ran on (empty for this box) and its name. */
interface LoginNeed {
  host: string;
  label: string;
}
/** Compare two LoginNeeds by identity or by matching host and label, so a re-rendered need counts
 *  the same one. */
const sameNeed = (a: LoginNeed | null, b: LoginNeed | null): boolean =>
  a === b || (a !== null && b !== null && a.host === b.host && a.label === b.label);

/** A bare control in a dock card's header: the copy and close buttons, the update card's close. */
const iconBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "0 2px",
  lineHeight: 1,
  flex: "0 0 auto",
} as const;

/** A dock card's fold toggle: a real button laid out as the header bar it replaced. The resets take
 *  back what a `<button>` brings (border, background, font, centred text), and `minWidth: 0` lets a
 *  long label truncate instead of pushing the close off the card. */
const HEADER_TOGGLE = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flex: 1,
  minWidth: 0,
  margin: 0,
  background: "none",
  border: "none",
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
} as const;

/** How long the update card stays after a success before closing on its own. */
const CLOSE_AFTER_S = 10;

/** Mirrors the server's `ClaudeUpdateCard`: the box a session runs on and the two versions. */
interface ClaudeUpdateCardData {
  host: string;
  label: string;
  installed: string;
  latest: string;
  folded: boolean;
}
/** Compare two update-card data objects by identity or by host, installed and latest versions, so a
 *  re-rendered card matches the last drawn one. */
const sameCard = (a: ClaudeUpdateCardData | null, b: ClaudeUpdateCardData | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.host === b.host &&
    a.installed === b.installed &&
    a.latest === b.latest &&
    a.folded === b.folded);

/** The release's entry on Claude Code's changelog page: its anchors are the version with dots as
 *  hyphens, `#2-1-277`. */
const claudeReleaseNotes = (version: string): string =>
  `https://code.claude.com/docs/en/changelog#${version.replace(/\./g, "-")}`;

/** The model a session has picked in dsh's selector, or undefined when dsh has not bound the
 *  session yet (its model directory throws until then). */
const sessionModelOf = (ctx: ClientCtx, sessionId: string): string | undefined => {
  try {
    return ctx.modelDirectories.directoryFor(sessionId).store.getSnapshot().current?.model;
  } catch {
    return undefined;
  }
};

/** The loudest plan limit the session's model counts against, rechecked every minute through the
 *  usage route's own one-minute cache, so a model switched mid-session is picked up on the next
 *  read. Undefined while nothing binding is past normal, or when usage cannot be read. */
function useBindingLimit(sessionId: string, ctx: ClientCtx) {
  const [limit, setLimit] = useState<ReturnType<typeof worstLimit>>(undefined);
  useEffect(() => {
    let live = true;
    const read = () =>
      loadUsage(claudeProviderOf(ctx, sessionId)).then(
        (r) =>
          live &&
          setLimit(r.ok ? worstLimit(r.windows, sessionModelOf(ctx, sessionId)) : undefined),
        () => {},
      );
    void read();
    const timer = setInterval(read, 60_000);
    // A model switch changes which limits count, so it rereads at once rather than on the clock;
    // usage itself comes from the route's cache, so this costs no request.
    let off: (() => void) | undefined;
    try {
      off = ctx.modelDirectories.directoryFor(sessionId).store.subscribe(() => void read());
    } catch {
      // Not bound in this tab yet: the clock still covers it.
    }
    return () => {
      live = false;
      clearInterval(timer);
      off?.();
    };
  }, [sessionId, ctx]);
  return limit;
}

/** A typed steer still in Claude's queue, as the side-questions poll lists it. */
interface WaitingSteerRow {
  id: string;
  text: string;
  at: number;
}

/** Steers taken back from Claude for an edit: one hold, possibly several messages joined. */
interface HeldSteerRow {
  id: string;
  text: string;
}

/** The steer card's half of the side-questions poll. */
interface SteerCardData {
  waiting: WaitingSteerRow[];
  held: HeldSteerRow[];
}

/** One request to the steer-edit route, as its validation accepts them. */
type SteerAction =
  | { action: "hold" | "remove" | "sendNow"; ids: string[] }
  | { action: "save"; holdId: string; text: string }
  | { action: "restore" | "drop"; holdId: string };

/** What the steer-edit route answers when it refuses. */
type SteerEditFailure = { reason?: "sent" | "gone" | "error"; error?: string };

/** The line under a row when an edit or removal did not happen, in the reader's language. */
const steerFailureText = (f: SteerEditFailure): string =>
  f.reason === "gone"
    ? t("main.steer.gone")
    : f.reason === "error"
      ? t("main.steer.error", { error: f.error ?? t("common.unknownError") })
      : t("main.steer.sent");

/** The card above the composer for typed steers Claude has not read yet. Edit (or Edit all, joining
 *  them one per line, as Claude Code's up arrow does) takes them back from Claude first, so nothing
 *  goes out while the editor is open; Save sends one message with the new text, Cancel or Escape
 *  puts the originals back, Remove drops them. The editor is drawn from the server's hold, not local
 *  state, so a refresh mid-edit brings it back. `refresh` re-polls at once so the list follows. */
function SteerCard({
  steers,
  sessionId,
  refresh,
}: {
  steers: SteerCardData;
  sessionId: string;
  refresh: () => void;
}) {
  useLocale();
  // Typed text per hold. A hold's own text seeds it; a poll never overwrites what someone typed.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);

  /** Post one action for the row or hold `id`, then re-poll; a refusal leaves its line under it. */
  const act = async (id: string, body: SteerAction) => {
    setBusy(id);
    setFailed(null);
    try {
      const r = await fetch(`${ROUTE}/steer-edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, ...body }),
      });
      // SAFETY: our own JSON route; both answers carry these optional fields
      const reply = (await r.json()) as { ok?: boolean } & SteerEditFailure;
      if (!reply.ok) setFailed({ id, text: steerFailureText(reply) });
    } catch (e) {
      setFailed({
        id,
        text: t("main.steer.error", { error: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  /** Send a hold's typed text in its place, unless it is blank. */
  const save = (holdId: string, fallback: string) => {
    const text = drafts[holdId] ?? fallback;
    if (text.trim() !== "") void act(holdId, { action: "save", holdId, text });
  };

  const buttonStyle = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0 4px",
    color: T.faint,
    fontSize: 12,
  } as const;
  /** The line under a row or hold when its last action was refused. */
  const failure = (id: string) =>
    failed?.id === id ? (
      <div role="alert" style={{ color: T.err, fontSize: 12, marginTop: 2 }}>
        {failed.text}
      </div>
    ) : null;

  return (
    <section
      data-omc-steer-card=""
      aria-label={t("main.steer.title")}
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ flex: 1, color: T.faint, fontSize: 12 }}>
          {t("main.steer.title")} ·{" "}
          {steers.held.length > 0 ? t("main.steer.heldHint") : t("main.steer.hint")}
        </span>
        {steers.waiting.length > 1 && (
          <button
            type="button"
            data-omc-steer-edit-all=""
            aria-label={t("main.steer.editAllAria")}
            disabled={busy !== null}
            onClick={() =>
              void act("all", { action: "hold", ids: steers.waiting.map((w) => w.id) })
            }
            style={buttonStyle}
          >
            {t("main.steer.editAll")}
          </button>
        )}
      </div>
      {failure("all")}
      {steers.held.map((h) => {
        const disabled = busy === h.id;
        const value = drafts[h.id] ?? h.text;
        return (
          <div key={h.id} data-omc-steer-hold={h.id} style={{ padding: "4px 0" }}>
            <textarea
              data-omc-steer-input=""
              aria-label={t("main.steer.inputAria")}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
              autoFocus
              value={value}
              disabled={disabled}
              rows={Math.min(8, Math.max(2, value.split("\n").length))}
              onChange={(e) => setDrafts((d) => ({ ...d, [h.id]: e.target.value }))}
              onKeyDown={(e) => {
                // dsh's QueueDock keys: Enter saves, Shift+Enter is a newline, Escape backs out.
                if (e.key === "Escape") {
                  e.preventDefault();
                  void act(h.id, { action: "restore", holdId: h.id });
                } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save(h.id, h.text);
                }
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: T.field,
                color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: "4px 6px",
                font: "inherit",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
              <button
                type="button"
                data-omc-steer-remove=""
                aria-label={t("main.steer.removeAria")}
                disabled={disabled}
                onClick={() => void act(h.id, { action: "drop", holdId: h.id })}
                style={buttonStyle}
              >
                {t("common.remove")}
              </button>
              <button
                type="button"
                data-omc-steer-cancel=""
                disabled={disabled}
                onClick={() => void act(h.id, { action: "restore", holdId: h.id })}
                style={buttonStyle}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                data-omc-steer-save=""
                disabled={disabled || value.trim() === ""}
                onClick={() => save(h.id, h.text)}
                style={{ ...buttonStyle, color: T.text }}
              >
                {t("save")}
              </button>
            </div>
            {failure(h.id)}
          </div>
        );
      })}
      {steers.waiting.map((s) => {
        const disabled = busy !== null;
        return (
          <div key={s.id} data-omc-steer-row={s.id} style={{ padding: "4px 0" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span
                style={{
                  flex: 1,
                  color: T.text,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {s.text}
              </span>
              <button
                type="button"
                data-omc-steer-edit=""
                aria-label={t("main.steer.editAria")}
                disabled={disabled}
                onClick={() => void act(s.id, { action: "hold", ids: [s.id] })}
                style={buttonStyle}
              >
                {t("edit")}
              </button>
              <button
                type="button"
                data-omc-steer-remove=""
                aria-label={t("main.steer.removeAria")}
                disabled={disabled}
                onClick={() => void act(s.id, { action: "remove", ids: [s.id] })}
                style={buttonStyle}
              >
                {t("common.remove")}
              </button>
              <button
                type="button"
                data-omc-steer-send-now=""
                aria-label={t("main.steer.sendNowAria")}
                title={t("main.steer.sendNowTitle")}
                disabled={disabled}
                onClick={() => void act(s.id, { action: "sendNow", ids: [s.id] })}
                style={buttonStyle}
              >
                {t("main.steer.sendNow")}
              </button>
            </div>
            {failure(s.id)}
          </div>
        );
      })}
    </section>
  );
}

/** The one-line notice above the composer when a limit the session's model counts against is
 *  reached. Dismissing it hides it until that limit resets, box-wide, since the reset is the next
 *  time the notice could say something new. */
function LimitCard({
  label,
  resetsAt,
  onDismiss,
}: {
  label: string;
  resetsAt: number | null;
  onDismiss: () => void;
}) {
  useLocale();
  return (
    <div
      data-omc-limit-card=""
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
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
        <span style={{ color: T.err, flex: "0 0 auto" }} aria-hidden="true">
          ●
        </span>
        <span style={{ flex: 1 }}>
          {t("main.limit.reached", { label })}
          {resetsAt === null ? (
            ""
          ) : (
            <span style={{ color: T.faint }}> · {resetText(resetsAt)}</span>
          )}
        </span>
        <button
          type="button"
          aria-label={t("main.limit.dismissAria")}
          title={t("main.limit.dismissAria")}
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
    </div>
  );
}

/** The card above the composer after a turn failed for want of a login on its box: the same login
 *  the Boxes row runs, here so nobody has to find Settings. It only ever follows a failed turn, so a
 *  box nobody uses never asks. Once the token is stored the server clears the need and the next poll
 *  takes the card down; until then it says what to do next. */
function LoginCard({ need, onDismiss }: { need: LoginNeed; onDismiss: () => void }) {
  useLocale();
  const [done, setDone] = useState(false);
  const { login, setLogin, startLogin, submitLogin } = useLoginFlow(() => setDone(true));
  const where = need.host ? need.label : t("main.boxes.thisBoxLower");
  return (
    <div
      data-omc-login-card={need.host || "this-box"}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
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
          {done ? t("main.loginCard.loggedIn") : t("main.loginCard.loggedOut", { where })}
        </span>
        {!done && !login && (
          <button
            type="button"
            style={btn}
            data-testid="dsh-oh-my-claude-card-login"
            onClick={() => startLogin(need.host)}
          >
            {t("main.boxes.logIn")}
          </button>
        )}
        <button
          type="button"
          aria-label={t("main.loginCard.dismissAria")}
          title={t("main.loginCard.dismiss")}
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

/** One run of `claude update` as the GET answers it in the box's log. */
interface UpdateOutcome {
  ok: boolean;
  from: string | null;
  to: string | null;
  note?: string;
}

/** The card above the composer when a newer Claude Code is out for the box this session runs on.
 *  A headless claude never updates itself, so the button runs `claude update` there from dsh. The
 *  POST answers at once and the card follows the run through the GET every 3 s, since a request
 *  held open for the download would be cut by the reverse proxy this box is reached through. Once
 *  clicked the card owns its own life until ×: the dock's poll would otherwise take it down the
 *  moment `installed` moves, before anyone has read what happened. */
function ClaudeUpdateCard({
  update,
  sessionId,
  onAct,
  onGone,
}: {
  update: ClaudeUpdateCardData;
  sessionId: string;
  onAct: () => void;
  onGone: () => void;
}) {
  useLocale();
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "declined" | "failed">("idle");
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);
  const where = update.host ? update.label : t("main.boxes.thisBoxLower");
  const Where = update.host ? update.label : t("main.sessions.thisBox");
  // `host` is the box this card is about, so its Update button never lands on another one: the
  // card is drawn from the picked mount, and the run has to follow the card.
  const url = `${ROUTE}/claude-update?session=${encodeURIComponent(sessionId)}&host=${encodeURIComponent(update.host)}`;
  const fail = (note: string) => {
    setOutcome({ ok: false, from: update.installed, to: null, note });
    setPhase("failed");
  };
  const start = (body: { run: true; auto?: true }) => {
    onAct();
    setPhase("busy");
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => readJson<{ busy: boolean }>(r))
      .catch((e: Error) => fail(e.message));
  };
  const dismiss = () => {
    onAct();
    if (phase === "idle")
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skip: update.latest }),
      }).catch(() => {});
    onGone();
  };
  // Follow the run: the GET until `busy` is false, then the newest log entry is the outcome.
  useEffect(() => {
    if (phase !== "busy") return;
    let live = true;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const s = await readJson<{ busy: boolean; log: UpdateOutcome[] }>(await fetch(url));
        if (!live) return;
        if (s.busy) {
          if (Date.now() - startedAt > 200_000) fail(t("main.update.noAnswer200"));
          return;
        }
        const last = s.log[s.log.length - 1];
        if (!last) return fail(t("main.update.noRun"));
        setOutcome(last);
        setPhase(last.ok ? "done" : last.to !== null && last.note ? "declined" : "failed");
      } catch {
        // a missed poll is retried on the next tick
      }
    };
    const id = setInterval(() => void tick(), 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [phase, url]);
  const text =
    phase === "done"
      ? t("main.update.cardDone", {
          where,
          to: outcome?.to ?? update.latest,
          installed: update.installed,
        })
      : phase === "declined"
        ? t("main.update.cardDeclined", { note: outcome?.note ?? t("main.update.noReason") })
        : phase === "failed"
          ? t("main.update.cardFailed", { note: outcome?.note ?? t("main.update.noAnswerShort") })
          : null;
  const narrow = useNarrow();
  const label =
    phase === "busy"
      ? t("main.update.updating")
      : phase === "done"
        ? t("main.update.updated")
        : phase === "declined"
          ? t("main.update.notUpdated")
          : phase === "failed"
            ? t("main.update.retryShort")
            : t("main.update.update");
  // Folded, the card is its header line, the way a side-question card folds: the label, the
  // chevron and the close. Open, the sentence and the buttons. A fold is recorded on the box for
  // this release, beside the skip: a session switch used to remount the card open (owner,
  // 2026-09-18), and a fold in one tab now reaches the others on the next poll. The close is what
  // records a skip until the next release.
  const [open, setOpen] = useState(!update.folded);
  useEffect(() => setOpen(!update.folded), [update.folded]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fold: next ? null : update.latest }),
    }).catch(() => {});
  };
  // After a success the card closes on its own: a thin accent bar along its bottom edge drains
  // over CLOSE_AFTER_S seconds as one CSS animation, so the close is seen coming without a number
  // ticking. The pointer over the card, or focus inside it, pauses the animation where it is (a
  // paused animation holds its frame; a transition cut short would jump to its end), and the close
  // fires from the animation's own end event, so a pause delays it by exactly the pause. The card
  // then fades for a moment rather than popping out. A decline or a failure stays until it is read
  // and closed.
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => goneRef.current(), 250);
    return () => clearTimeout(id);
  }, [leaving]);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover and focus only pause the auto-dismiss; every action is a real button inside
    <div
      data-omc-update-card={update.latest}
      data-omc-update-phase={phase}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      // Focus holds the card too, so someone tabbing to its buttons is not raced by the timer.
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
          setHeld(false);
      }}
      style={{
        position: "relative",
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        overflow: "hidden",
        fontSize: 13,
        opacity: leaving ? 0 : 1,
        transition: "opacity .25s ease",
      }}
    >
      {phase === "done" && (
        <div
          data-omc-update-closing={held ? "held" : "running"}
          aria-hidden="true"
          title={held ? t("main.update.held") : t("main.update.closesIn", { n: CLOSE_AFTER_S })}
          onAnimationEnd={() => setLeaving(true)}
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 2,
            background: ACCENT,
            animation: `omc-drain ${CLOSE_AFTER_S}s linear forwards`,
            animationPlayState: held ? "paused" : "running",
          }}
        />
      )}
      {/* The header row holds two siblings, the fold toggle and the close, so neither button sits
          inside the other. The row keeps the old 6 px gap and 8 px right edge; the toggle carries
          the rest of the old padding so the whole bar left of the close is still one click. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 8 }}>
        <button
          type="button"
          aria-expanded={open}
          data-omc-update-toggle=""
          onClick={toggle}
          style={{ ...HEADER_TOGGLE, padding: "6px 0 6px 8px" }}
        >
          <Spark size={12} />
          {/* The label alone: the sentence lives in the body, where a phone shows it whole. */}
          <span style={{ color: ACCENT, fontWeight: 600, fontSize: 12, flex: 1 }}>
            {t("main.update.cardTitle")}
          </span>
          <Chevron open={open} />
        </button>
        <button
          type="button"
          aria-label={phase === "idle" ? t("main.update.dismissNextRelease") : t("close")}
          title={phase === "idle" ? t("main.update.dismissNextRelease") : t("close")}
          onClick={() => dismiss()}
          style={{ ...iconBtn, color: T.muted, fontSize: 12 }}
        >
          ✕
        </button>
      </div>
      {open ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            // Flush with the spark above, not indented under the label as a side question's
            // answer is: the buttons are the body, not a quote.
            padding: "0 8px 8px",
          }}
        >
          {/* On a phone the sentence takes its own line and the buttons the next; wider, one line. */}
          <span
            style={{
              flex: narrow ? "1 1 100%" : 1,
              minWidth: 0,
              color: phase === "failed" ? T.err : phase === "declined" ? T.faint : undefined,
            }}
          >
            {text ?? (
              <>
                {t("main.update.outBefore")}
                <a
                  data-omc-update-notes=""
                  href={claudeReleaseNotes(update.latest)}
                  target="_blank"
                  rel="noreferrer"
                  title={t("main.update.notesTitle")}
                  style={{ color: ACCENT }}
                >
                  {update.latest}
                </a>
                {t("main.update.outAfter", { where: Where, installed: update.installed })}
              </>
            )}
          </span>
          <button
            type="button"
            style={btn}
            data-testid="dsh-oh-my-claude-card-update"
            disabled={phase === "busy" || phase === "done" || phase === "declined"}
            aria-busy={phase === "busy" ? "true" : undefined}
            onClick={() => start({ run: true })}
          >
            {label}
          </button>
          {phase === "idle" && (
            <button
              type="button"
              aria-label={t("main.update.alwaysAria")}
              title={t("main.update.alwaysTitle")}
              onClick={() => start({ run: true, auto: true })}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0 2px",
                color: T.faint,
                textDecoration: "underline",
                fontSize: 12,
              }}
            >
              {t("main.update.always")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Render this session's aside items as a collapsible stack, polling `/side-questions` every few
 *  seconds: questions, a login need and a Claude update card, or nothing when the poll is empty. */
function AsideBubble({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const [items, setItems] = useState<AsideItem[]>([]);
  // What the poll compares its answer against, without listing `items` as a dependency of its effect.
  const itemsRef = useRef<AsideItem[]>([]);
  const [steers, setSteers] = useState<SteerCardData>({ waiting: [], held: [] });
  // What the poll compares its steers against, the same way `itemsRef` serves `items`.
  const steersRef = useRef<SteerCardData>({ waiting: [], held: [] });
  steersRef.current = steers;
  // The poll itself, so the steer card can re-poll the moment an edit lands instead of in 3 s.
  const pollRef = useRef<() => void>(() => {});
  itemsRef.current = items;
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  /** The box whose login the last turn wanted, from the same poll; null once a turn or a login
   *  clears it on the server. Dismissal is this tab's alone. */
  const [need, setNeed] = useState<LoginNeed | null>(null);
  const [needDismissed, setNeedDismissed] = useState<string | null>(null);
  /** A newer Claude Code for the box this session runs on, from the same poll; null once it is
   *  installed, skipped or set to install on its own. */
  const [claudeUpdate, setClaudeUpdate] = useState<ClaudeUpdateCardData | null>(null);
  // Once the card has been clicked it owns its own life: the server answers null the moment
  // `installed` moves, and the person still has to read what happened. Holds the release acted
  // on; the poll drops it when the server stops naming that release (installed, skipped) or names
  // a newer one, so a dismissal cannot flicker back on the one poll that raced the skip.
  const actedRef = useRef<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Only the newest card starts open; the rest fold to their header row, so a stack of answers costs
  // the composer one line each rather than a screen. A click flips a card either way.
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const visibleRef = useRef(true);

  useEffect(() => {
    // Poll this session's asides unconditionally. Do NOT gate on `activeClaudeSession`. That reads
    // the session's provider binding, which is briefly undefined during a restart/reattach; gating
    // the poll on it here meant that if the effect ran in that window the interval never installed
    // and, with deps `[ctx, sessionId]` stable, never retried, so the card died for good ("gone with
    // no way to get it back"). The card only mounts for the open composer's session and its data is
    // this session's own server-persisted asides, so an unconditional per-session poll is correct.
    let alive = true;
    const fetchItems = async () => {
      try {
        // `provider` is the mount the model picker names, so the update card reports the Claude
        // Code that was chosen rather than whichever box this session's turns happen to run on.
        // Switching model repoints the card on the next poll. The read is one store snapshot on a
        // poll that was already happening: no extra request, and the server answers it with a map
        // lookup against updaters its own tick keeps fresh, so nothing here probes a box.
        const picked = claudeProviderOf(ctx, sessionId);
        const r = await fetch(
          `${ROUTE}/side-questions?session=${encodeURIComponent(sessionId)}${
            picked === undefined ? "" : `&provider=${encodeURIComponent(picked)}`
          }`,
        );
        if (!r.ok) return;
        // SAFETY: our own JSON route; the union names both shapes the caller checks.
        const body = (await r.json()) as
          | {
              items: AsideItem[];
              loginNeeded?: LoginNeed | null;
              claudeUpdate?: ClaudeUpdateCardData | null;
              steers?: SteerCardData;
            }
          | { error: string };
        if ("error" in body) return;
        if (alive) {
          const nextNeed = body.loginNeeded ?? null;
          setNeed((cur) => (sameNeed(cur, nextNeed) ? cur : nextNeed));
          const nextUpd = body.claudeUpdate ?? null;
          // A card that was acted on stays until it says it is gone (its own countdown after a
          // success, the close otherwise): the server stops naming the release the moment the
          // install lands, and dropping the card on that poll left "Updated" on screen for a
          // blink. Only a newer release takes it over.
          if (nextUpd !== null && nextUpd.latest !== actedRef.current) actedRef.current = null;
          setClaudeUpdate((cur) =>
            actedRef.current !== null ? cur : sameCard(cur, nextUpd) ? cur : nextUpd,
          );
        }
        // A fresh array every three seconds re-rendered the dock in every conversation forever,
        // answer or no answer; only a list that actually moved is worth a render.
        const next = body.items ?? [];
        if (alive && JSON.stringify(next) !== JSON.stringify(itemsRef.current)) setItems(next);
        const nextSteers = body.steers ?? { waiting: [], held: [] };
        if (alive && JSON.stringify(nextSteers) !== JSON.stringify(steersRef.current))
          setSteers(nextSteers);
      } catch {
        // network error: keep the last items on screen
      }
    };
    pollRef.current = () => void fetchItems();
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
  const limit = useBindingLimit(sessionId, ctx);
  const [warningsOff] = useHintFlag("limitWarningsOff");
  const [noticeOff] = useHintFlag("limitNoticeOff");
  const [limitDismissed, setLimitDismissed] = useHintValue("limitNoticeDismissed");
  const limitCard =
    limit?.level === "critical" &&
    !warningsOff &&
    !noticeOff &&
    (limit.window.resetsAt === null || limitDismissed !== limit.window.resetsAt)
      ? limit.window
      : null;
  const shown = items.filter((it) => !it.dismissed && !dismissed.has(it.id));
  // No `activeClaudeSession` gate here either: the card shows this session's own persisted asides,
  // which only exist for a Claude session, so an empty list is the only reason to hide it. Reading
  // the provider binding at render blinked the card out whenever the binding reloaded.
  const loginCard = need && needDismissed !== need.host ? need : null;
  const anySteers = steers.waiting.length > 0 || steers.held.length > 0;
  if (shown.length === 0 && !loginCard && !claudeUpdate && !limitCard && !anySteers) return null;

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

  return (
    <div {...{ [DOCK_ATTR]: "1" }} style={DOCK_CARD}>
      {claudeUpdate && (
        <ClaudeUpdateCard
          update={claudeUpdate}
          sessionId={sessionId}
          onAct={() => {
            actedRef.current = claudeUpdate.latest;
          }}
          onGone={() => setClaudeUpdate(null)}
        />
      )}
      {loginCard && (
        <LoginCard need={loginCard} onDismiss={() => setNeedDismissed(loginCard.host)} />
      )}
      {limitCard && (
        <LimitCard
          label={windowLabel(limitCard)}
          resetsAt={limitCard.resetsAt}
          // The reset time is the key: a later limit, or the same one after it resets, shows again.
          onDismiss={() => limitCard.resetsAt !== null && setLimitDismissed(limitCard.resetsAt)}
        />
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
            {/* The header row holds the fold toggle and, beside it, Copy and close, so no button sits
                inside another. The chevron ends the toggle, just before the actions, as on the
                update card. The toggle carries the old left padding so the bar is one click. */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 8 }}>
              <button
                type="button"
                aria-expanded={open}
                data-omc-aside-toggle={it.id}
                onClick={() => toggle(it.id)}
                style={{ ...HEADER_TOGGLE, padding: "6px 0 6px 8px" }}
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
                  {t("main.aside.title")}
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
                {/* Up when collapsed, down when open, the same convention as the queue dock. */}
                <Chevron open={open} />
              </button>
              <button
                type="button"
                onClick={() => copy(it)}
                aria-label={t("main.aside.copyAria")}
                style={{
                  ...iconBtn,
                  color: copied === it.id ? ACCENT : T.muted,
                  fontSize: 11,
                }}
              >
                {copied === it.id ? t("copied") : t("copy")}
              </button>
              <button
                type="button"
                onClick={() => dismissAside(it.id)}
                aria-label={t("main.aside.dismissAria")}
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
                    {t("main.aside.thinking")}
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
      {anySteers && (
        <SteerCard steers={steers} sessionId={sessionId} refresh={() => pollRef.current()} />
      )}
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
  return t("main.cost.ttft", { shown });
};

/** `$18.21 · $0.42 last`: the session total and the newest turn. The Claude mark goes in front of
 *  it by whoever draws it: the spark SVG in the pill, the glyph in a text row.
 *
 *  The cached-token count used to close the line, which made this the longest pill in dsh's row,
 *  and dsh's own neighbouring pill already reports the session's tokens and cache hit rate. The
 *  dialog behind the pill still breaks the cache reads and writes out in full. */
const costText = (total: number, last: number) =>
  t("main.cost.pill", { total: fmtCost(total), last: fmtCost(last) });

/** A token count for the dialog: `0` rather than the readout's blank for none. */
const fmtTokens = (n: number): string => formatCacheRead(n) || "0";

/**
 * The rows of the cost dialog, label and value, from the session's turn records.
 * ponytail: the token rows are the result frame's `usage`, which is the main agent loop only.
 * a Task subagent's tokens are not in them, while the cost above them covers the whole pipeline.
 * The frame's `modelUsage` has the pipeline totals per model; read those instead the day the gap
 * between the money and the tokens beside it matters.
 */
export const costDetails = (turns: TurnRecord[]): [string, string][] => {
  const sum = (pick: (r: TurnRecord) => number) => turns.reduce((s, r) => s + pick(r), 0);
  const last = turns[turns.length - 1];
  const totals = {
    input: sum((r) => r.input),
    cacheRead: sum((r) => r.cacheRead),
    cacheWrite: sum((r) => r.cacheWrite),
  };
  const rows: [string, string][] = [
    [t("main.cost.lastTurn"), fmtCost(last?.costUsd ?? 0)],
    [t("main.cost.turns"), String(turns.length)],
    [t("main.cost.wallTime"), fmtDuration(sum((r) => r.durationMs))],
    [t("main.cost.apiTime"), fmtDuration(sum((r) => r.apiMs))],
    [t("main.cost.input"), fmtTokens(totals.input)],
    [t("main.cost.cacheRead"), fmtTokens(totals.cacheRead)],
  ];
  if (totals.cacheWrite > 0) rows.push([t("main.cost.cacheWrite"), fmtTokens(totals.cacheWrite)]);
  rows.push([t("main.cost.output"), fmtTokens(sum((r) => r.output))]);
  if (totals.input + totals.cacheRead + totals.cacheWrite > 0)
    rows.push([t("main.cost.cacheHit"), `${Math.round(cacheShare(totals) * 100)}%`]);
  if (last?.ttftMs !== undefined && last.ttftMs > 0)
    rows.push([
      t("main.cost.firstToken"),
      last.ttftMs < 1000 ? `${Math.round(last.ttftMs)}ms` : `${(last.ttftMs / 1000).toFixed(1)}s`,
    ]);
  return rows;
};

/** dsh's `stat-dialog.module.css` (ui-chat), rule for rule, on this plugin's own hooks: the hashed
 *  class names change with every dsh build, the design tokens do not.
 *
 *  The cap is 320px rather than dsh's own so the API-rate footnote wraps instead of setting the
 *  width: at 440 it was the widest line in the dialog and made this panel half again as wide as
 *  the stats dialog beside it (440 against 300, measured on dsh 0.1.6-alpha.2). */
const COST_DIALOG_CSS =
  "[data-omc-cost-dialog]{z-index:1100;box-sizing:border-box;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(320px,100vw - 24px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:16px;font-size:12px;line-height:18px;position:fixed}" +
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
  useLocale();
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
        {t("main.idle.stopping", { n: seconds })}
      </span>
      <button type="button" style={btn} onClick={extend}>
        {t("main.idle.extend")}
      </button>
    </span>
  );
}

/** Wire the plugin into a mounted dsh context: follow deep links and start every watcher, so a
 *  fresh session gets turn status, notices, folds and hints. */
export function apply(ctx: ClientCtx) {
  // A context applied after an earlier one of this same module was disposed starts live, and dsh's
  // own dispose is what ends it.
  revive();
  ctx.effect?.(() => retire);
  // First, so every string drawn below is already in the language the person picked.
  whenContextGone(installLocale(ctx));
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
    useLocale();
    const [boxes, setBoxes] = useState<BoxData[]>([]);
    const [openBoxes, setOpenBoxes] = useState(true);
    const [openSessions, setOpenSessions] = useState(false);
    const [openChangelog, setOpenChangelog] = useState(false);
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
        <StarLine />
        <ThemeSwitch />
        <StarterSwitch />
        <UpdateNoticeSwitch />
        <ClaudeUpdateSwitch />
        <CostSwitch />
        <LimitWarningsSwitch />
        <WorkspaceModelSwitch />
        <ToolRowsSwitch />
        {/* The switches that start off sit together after the ones that start on, so the card reads
            as what the plugin does by default first, then what you can add to it. The proxy control
            keeps company with them rather than with the spend field it used to precede: it answers
            a switch's question, not a number's. Terminal mirror stays last, on its own, because it
            is the one experiment here. */}
        <ContextSwitch ctx={ctx} />
        <ReturnRecapSwitch />
        <SpendGuardField />
        <ProxyFirstPartySwitch />
        <TerminalSyncSwitch />
        {error && <p style={{ color: T.err, fontSize: 13 }}>{error}</p>}
        {boxes !== null && (
          <Card
            id="dsh-oh-my-claude-sessions-card"
            title={t("main.section.sessionsTitle")}
            summary={t("main.section.sessionsSummary")}
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
          id="dsh-oh-my-claude-changelog-card"
          title={t("main.section.changelogTitle")}
          summary={t("main.section.changelogSummary")}
          open={openChangelog}
          onToggle={() => setOpenChangelog((v) => !v)}
        >
          <ChangelogBlock />
        </Card>
        <Card
          id="dsh-oh-my-claude-report-card"
          title={t("main.section.reportTitle")}
          summary={t("main.section.reportSummary")}
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
    // Renderless: folds away the chat rows for context this plugin withheld from the CLI.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-context-rows", order: 48 },
      (props) => <ContextRowMask {...props} ctx={ctx} />,
    );
    // Renderless: applies the workspace's remembered Claude model to a blank session.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-workspace-model", order: 47 },
      (props) =>
        props.sessionId ? <WorkspaceModelMemory sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    // Renderless: moves a session off a model id the CLI has since renamed.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-stale-model", order: 49 },
      (props) =>
        props.sessionId ? <StaleModelRepair sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    return null;
  });

  // Add workspace, with a box to pick it on. Renderless until dsh's sidebar "+" is clicked, and
  // dormant unless an SSH box is saved; the sidebar footer is where a root-scoped entry stays
  // mounted whether the sidebar is wide or collapsed.
  // The directory picker as a slot occupant in both the sidebar and the hero, so the dialog is
  // ours on every dsh. Shadowing is per cell, not per session; priority -1 replaces dsh's picker.
  // On an older dsh that refuses a second occupant of a cell the register throws, and we take the
  // sidebar "+" over by click instead until an upgrade.
  try {
    ctx.slots.inject("sidebar.workspaces.directoryFlow", () => {
      ctx.slots.register(
        {
          name: "sidebar.workspaces.directoryFlow",
          id: "oh-my-claude-workflow",
          order: 300,
          priority: -1,
        },
        // SAFETY: `DshSlots.register` types the owner props as the generic session shape, but dsh's
        // directory-flow slots hand the DirectoryFlowOwnerProps contract; the cast names the truth.
        (props) => <AddWorkflow {...(props as DirectoryFlowOwnerProps)} ctx={ctx} />,
      );
      return null;
    });
    ctx.slots.inject("conversation.hero.workspace.directoryFlow", () => {
      ctx.slots.register(
        {
          name: "conversation.hero.workspace.directoryFlow",
          id: "oh-my-claude-workflow-hero",
          order: 300,
          priority: -1,
        },
        // SAFETY: `DshSlots.register` types the owner props as the generic session shape, but dsh's
        // directory-flow slots hand the DirectoryFlowOwnerProps contract; the cast names the truth.
        (props) => <AddWorkflow {...(props as DirectoryFlowOwnerProps)} ctx={ctx} />,
      );
      return null;
    });
  } catch {
    // Older dsh refuses a second occupant of a cell; take the sidebar "+" over by click until an
    // upgrade, when the slot occupant takes over again on the next restart.
    ctx.slots.inject("sidebar.footer.action", () => {
      ctx.slots.register(
        { name: "sidebar.footer.action", id: "claude-add-workspace", order: 90 },
        () => <AddWorkspaceFlow ctx={ctx} />,
      );
      return null;
    });
  }

  // Header chips in the session header.
  ctx.slots.inject("conversation.session.header.actions", () => {
    ctx.slots.register(
      { name: "conversation.session.header.actions", id: "claude-idle-warn", order: 31 },
      (props) => (props.sessionId ? <IdleChip sessionId={props.sessionId} /> : null),
    );
    return null;
  });

  // One Oh My Claude control in the composer's left group.
  ctx.slots.inject("conversation.input.left", () => {
    ctx.slots.register(
      { name: "conversation.input.left", id: "oh-my-claude", order: 50 },
      // Session-scoped slots receive `sessionId` (dsh-client-ui-jobs reads it the same way).
      (props) =>
        props.sessionId ? <OhMyClaudeControl sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    return null;
  });

  // The running Claude rows carry `data-omc-claude`, which the spinner scan reads instead of
  // matching each dot to a session by title. dsh's row-action strip is a list slot fed the row's
  // session id, so one renderless entry per row can mark its own row. A dsh without that slot
  // never runs the inject callback, and the scan keeps its title match.
  ctx.slots.inject("sidebar.workspaces.session.row.action", () => {
    try {
      ctx.slots.register(
        { name: "sidebar.workspaces.session.row.action", id: "oh-my-claude-mark", order: 300 },
        (props) => (props.sessionId ? <RowMark sessionId={props.sessionId} ctx={ctx} /> : null),
      );
      markActive = true;
    } catch {
      // A dsh that refuses the entry leaves the scan on its title match.
    }
    return null;
  });

  // The permission control takes over dsh's composer permission slot (a single cell). Shadowing is
  // per cell, not per session, so this would also replace dsh's control in a non-Claude session;
  // register the entry only while the current session is Claude and dispose it otherwise, following
  // the model picker the way useActiveClaude does. On an older dsh that refuses a second occupant
  // of the cell the register throws, and we fall back to the DOM-mutating AccessShield in
  // conversation.input.left.
  ctx.slots.inject("conversation.input.permission", () => {
    let dispose: (() => void) | undefined;
    // The active session's model-directory store, so a model switch off a Claude mount re-reads.
    // Subscribed once per session, never re-subscribed from inside its own notification: a
    // listener that leaves and rejoins a Set while it is being iterated is visited again, and the
    // tab spins forever.
    let providerOff: (() => void) | undefined;
    let providerFor: string | undefined;
    const stopProvider = () => {
      try {
        providerOff?.();
      } catch {
        // A disposed context retires the bundle on its own.
      }
      providerOff = undefined;
      providerFor = undefined;
    };
    const sync = () => {
      const active = activeClaudeSession(ctx);
      if (active !== providerFor) {
        stopProvider();
        if (active) {
          providerFor = active;
          try {
            providerOff = ctx.modelDirectories.directoryFor(active).store.subscribe(sync);
          } catch {
            // Unbound in this tab; the list store below still reports the session identity.
          }
        }
      }
      if (active && !dispose) {
        try {
          dispose = ctx.slots.register(
            {
              name: "conversation.input.permission",
              id: "oh-my-claude-access",
              order: 30,
              priority: -1,
            },
            (props) => <AccessTrigger sessionId={props.sessionId ?? active} ctx={ctx} />,
          );
        } catch {
          // Older dsh refuses a second occupant of the cell; keep the old AccessShield.
          dispose = ctx.slots.register(
            { name: "conversation.input.left", id: "claude-access", order: 40 },
            (props) =>
              props.sessionId ? <AccessShield sessionId={props.sessionId} ctx={ctx} /> : null,
          );
        }
      } else if (!active && dispose) {
        dispose();
        dispose = undefined;
      }
    };
    const listOff = ctx.sessions.list.subscribe?.(sync);
    sync();
    ctx.effect?.(
      () => () => {
        listOff?.();
        stopProvider();
        dispose?.();
      },
      "permission-access-sync",
    );
    return null;
  });
}
