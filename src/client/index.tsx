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
  card,
  cardHead,
  h3,
  row,
  pill,
  select,
  inputStyle,
  ago,
  btnPrimary,
  DOCK_ATTR,
  ensurePanelStyle,
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
  whenContextGone,
  guard,
} from "./shared.js";
import { Spark, sparkNode } from "./spark.js";
import { AccessShield, OhMyClaudeControl } from "./panel.js";
import { ConfirmButton } from "./tune.js";
import { AddWorkspaceFlow, canBrowseDirs, OPEN_EVENT } from "./picker.js";
import { markTitle, newlyWaiting, noticesOn, type NoticeSnapshot } from "./notices.js";
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

/** Disclosure chevron, 14px to match dsh's own todo/queue: up when closed, down when open. */
function Chevron({ open }: { open: boolean }) {
  return (
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
  );
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
          <Chevron open={open} />
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
  const [busyId, setBusyId] = useState("");
  // How many rows each box shows; every box starts at PAGE and grows by "Load more".
  const [shown, setShown] = useState<Record<string, number>>({});
  // Rows ticked for download, by their row key: the same id can sit on two boxes.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState("");
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
        const reply = await fetch(`${ROUTE}/transcript?${q.toString()}`);
        if (!reply.ok) throw new Error(`${r.s.id.slice(0, 8)}: ${reply.status}`);
        const url = URL.createObjectURL(await reply.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = `${r.s.title ? slugFile(r.s.title) : "claude"}-${r.s.id.slice(0, 8)}.jsonl`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving("");
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
          style={select}
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
            <div key={rowKey(r)} data-testid="dsh-oh-my-claude-session-row" style={row}>
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
function Boxes({ ctx, boxes, setBoxes, open, onToggle }: BoxesProps) {
  const [probe, setProbe] = useState<Record<string, ProbeEntry>>({});
  const [self, setSelf] = useState<{ plugin?: string } | null>(null);
  const [ssh, setSsh] = useState<SshBoxData[]>([]);
  const [sshProbe, setSshProbe] = useState<Record<string, SshProbeEntry>>({});
  const [kind, setKind] = useState<BoxKind>("ssh");
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
  const [login, setLogin] = useState<{
    host: string;
    url?: string;
    code: string;
    error?: string;
    busy?: boolean;
  } | null>(null);

  useEffect(() => {
    fetch(`${ROUTE}/ssh-boxes`)
      .then((r) => readJson<{ boxes?: SshBoxData[] }>(r))
      .then((b) => setSsh(b.boxes ?? []))
      .catch((e: Error) => setError(e.message));
    fetch(`${ROUTE}/status`)
      .then((r) => readJson<RuntimeStatus | null>(r))
      .then(setMe)
      .catch(() => {});
    fetch(`${ROUTE}/remote-workspaces`)
      .then((r) => readJson<{ workspaces?: RemoteWs[] }>(r))
      .then((b) => setRws(b.workspaces ?? []))
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

  const startLogin = (host: string) => {
    setLogin({ host, code: "", busy: true });
    fetch(`${ROUTE}/ssh-boxes/login/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host }),
    })
      .then((r) => readJson<{ url?: string; error?: string }>(r))
      .then((b) => setLogin({ host, code: "", url: b.url, error: b.error }))
      .catch((e: Error) => setLogin({ host, code: "", error: e.message }));
  };
  const submitLogin = () => {
    if (!login) return;
    const host = login.host;
    setLogin({ ...login, busy: true, error: undefined });
    fetch(`${ROUTE}/ssh-boxes/login/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host, code: login.code }),
    })
      .then((r) => readJson<{ done?: boolean; loggedIn?: boolean; error?: string }>(r))
      .then((b) => {
        if (b.error) return setLogin({ host, code: "", error: b.error });
        setLogin(null);
        refresh();
      })
      .catch((e: Error) => setLogin({ host, code: "", error: e.message }));
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
        This box plus any you add. <b>SSH</b>: this dsh drives Claude Code on the box over ssh, so
        it shows up in the model picker with no dsh needed there. <b>Link</b>: it runs its own dsh
        with this plugin, so its sessions show in the archive and Open hops there. Each keeps its
        own Claude Code login.
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
                <span style={pill(T.faint)}>{b.via ?? "ssh"}</span>
                <span style={{ fontFamily: T.mono }}>{b.host}</span>
                {!st && <span style={pill(T.faint)}>{busy ? "checking" : "unchecked"}</span>}
                {st?.error && !st.reach && <span style={pill(T.err)}>{st.error}</span>}
                {st?.reach && st.reach.stage !== "ok" && (
                  <span style={pill(T.err)} title={st.reach.detail}>
                    {reachLabel(st.reach.stage)}
                  </span>
                )}
                {up && (
                  <>
                    <span style={pill(st.binary ? T.ok : T.err)}>
                      {st.binary ? `claude ${st.version ?? ""}`.trim() : "no claude"}
                    </span>
                    <span style={pill(st.loggedIn ? T.ok : T.err)}>
                      {st.loggedIn ? maskEmail(st.email ?? "logged in") : "not logged in"}
                    </span>
                    {st.binary && !st.loggedIn && login?.host !== b.host && (
                      <button
                        type="button"
                        style={btn}
                        disabled={busy}
                        onClick={() => startLogin(b.host)}
                      >
                        Log in
                      </button>
                    )}
                  </>
                )}
              </div>
              {st?.reach && st.reach.stage !== "ok" && (
                <div style={{ ...meta, whiteSpace: "normal", marginTop: 4, color: T.muted }}>
                  {st.reach.hint.replaceAll("<host>", b.host)}
                </div>
              )}
              {login?.host === b.host && (
                <div
                  style={{ ...meta, marginTop: 6, whiteSpace: "normal", overflowWrap: "anywhere" }}
                >
                  {login.busy && !login.url && <span>starting login…</span>}
                  {login.url && (
                    <>
                      <div>
                        1. Open this URL, sign in, copy the code:{" "}
                        <a
                          href={login.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: CLAUDE_ORANGE }}
                        >
                          Claude sign-in
                        </a>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <input
                          style={inputStyle}
                          placeholder="paste code"
                          value={login.code}
                          disabled={login.busy}
                          onChange={(e) => setLogin({ ...login, code: e.target.value })}
                        />
                        <button
                          type="button"
                          style={btn}
                          disabled={login.busy || !login.code.trim()}
                          onClick={submitLogin}
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
              )}
            </div>
            <ConfirmButton
              label="Remove"
              style={btn}
              disabled={busy}
              onAct={() => removeSsh(b.host)}
            />
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
            <ConfirmButton
              label="Remove"
              style={btn}
              disabled={busy}
              onAct={() => removeDsh(b.url)}
            />
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
                  if (peer) setDraft({ ...draft, name: draft.name || peer.name, host: peer.host });
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
                  wg.peers.find((p) => draft.host === p.host || draft.host.endsWith(`@${p.host}`))
                    ?.host ?? ""
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
          style={btn}
          disabled={
            busy || !draft.name.trim() || (kind !== "dsh" ? !draft.host.trim() : !draft.url.trim())
          }
        >
          Add
        </button>
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
              <span style={pill(T.faint)}>not installed</span>
              Install Tailscale on this PC first (tailscale.com/download); the box side needs it
              too.
            </>
          ) : ts.loggedIn ? (
            <>
              <span style={pill(T.ok)}>on the tailnet</span>
              {ts.self && (
                <span style={{ fontFamily: T.mono }}>{ts.self.host || ts.self.name}</span>
              )}
              {ts.peers.length === 0 && "No peers yet: bring the box onto the tailnet and Refresh."}
            </>
          ) : (
            <>
              <span style={pill(T.warn)}>not connected</span>
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
                    style={{ color: CLAUDE_ORANGE }}
                  >
                    Approve this PC on your tailnet
                  </a>
                  <span>waiting for the approval…</span>
                </>
              ) : (
                <button type="button" style={btn} disabled={tsLogin?.busy} onClick={joinTailnet}>
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
              <span style={pill(T.faint)}>not installed</span>
              Install wireguard-tools and bring a tunnel up (wg-quick up); its peer address is the
              host.
            </>
          ) : wg.peers.length === 0 ? (
            <>
              <span style={pill(T.warn)}>no tunnel up</span>
              {wg.error
                ? wg.error
                : "Bring one up with wg-quick, or type the peer's tunnel address."}
            </>
          ) : (
            <>
              <span style={pill(T.ok)}>
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
            Key-based ssh, or Tailscale SSH on a tailnet. Not logged in there? The row offers a
            login; the panel tabs read the box the session runs on.
          </>
        ) : (
          <>
            Token: the box's dsh launch token (printed when dsh web starts, or already in its URL
            behind a proxy). Needed only when this browser has never logged into that box.
          </>
        )}
      </div>
      <div
        style={{
          borderTop: `1px solid ${T.border}`,
          marginTop: 12,
          paddingTop: 12,
        }}
      >
        <h3 style={h3}>Remote workspaces</h3>
        <p style={{ margin: "0 0 8px", color: T.muted, fontSize: 13 }}>
          A directory on an SSH box, pinned as a workspace. It shows in the left sidebar like any
          workspace; pick the box's Claude in the model picker and the session runs in that remote
          folder. No files are copied; the box's Claude reads them there.
        </p>
        {rws.map((w) => (
          <div key={`rw:${w.path}`} data-testid="dsh-oh-my-claude-remote-ws-row" style={row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: T.text, fontWeight: 600 }}>{w.name}</div>
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
                <span style={{ fontFamily: T.mono }}>{w.host}</span>
                <span style={{ fontFamily: T.mono }}>{w.remoteCwd}</span>
              </div>
            </div>
            <ConfirmButton
              label="Remove"
              style={btn}
              disabled={busy}
              onAct={() => removeRw(w.path)}
            />
          </div>
        ))}
        <div style={{ ...row, flexWrap: "wrap", paddingTop: 4 }}>
          <p style={{ ...meta, whiteSpace: "normal", flex: "1 1 220px", margin: 0 }}>
            {canAdd
              ? "Add one from the sidebar's Add workspace button: it browses whichever box you pick."
              : "Add an SSH box above first; the button then browses it."}
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
    const mark = sparkNode(12, CLAUDE_SHIMMER);
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
  styleEl.textContent = `body[data-omc-claude] [role="status"][aria-live="polite"],[data-dsh-oh-my-claude-turn]{background-image:linear-gradient(90deg,${CLAUDE_ORANGE} 0%,${CLAUDE_ORANGE} 40%,${CLAUDE_SHIMMER} 50%,${CLAUDE_ORANGE} 60%,${CLAUDE_ORANGE} 100%)}[data-dsh-oh-my-claude-turn]>span[aria-hidden]{display:inline-block;width:1.3em;text-align:start;flex:none}body[data-omc-claude] [role="tablist"]>[role="tab"][aria-selected="true"]{color:${CLAUDE_ORANGE}}body[data-omc-claude] [role="tablist"]>[role="tab"][aria-selected="true"]::after{background:${CLAUDE_ORANGE}}body[data-omc-claude] [class*="_markdown"] blockquote{border-left-color:${CLAUDE_ORANGE}80}body[data-omc-claude] [class*="_markdown"] hr{background:${CLAUDE_ORANGE}59}body[data-omc-claude] [class*="_markdown"] a{color:${CLAUDE_ORANGE};text-decoration-color:${CLAUDE_ORANGE}66}body[data-omc-claude] [class*="_markdown"] a:hover{color:${CLAUDE_SHIMMER};text-decoration-color:${CLAUDE_SHIMMER}}body[data-omc-claude] [class*="_markdown"] input[type="checkbox"]{accent-color:${CLAUDE_ORANGE}}body[data-omc-claude] [data-workflow-run] button[data-member-status] [data-member-label]{color:${CLAUDE_ORANGE}}body[data-omc-panel-open] [data-width-handle]{pointer-events:none}body[data-omc-claude] [data-produced-files-row] button{color:${CLAUDE_ORANGE}}body[data-omc-claude] [data-produced-files-row] button:hover{color:${CLAUDE_SHIMMER}}body[data-omc-claude] [data-composer-stats]{padding-left:8px;padding-right:8px}${COST_DIALOG_CSS}`;
  document.head.appendChild(styleEl);
};

/** One verb per running turn: the row remounts on every tool step and dsh rewrites its text, so a
 *  fresh pick each time reads as flicker. Keyed by session; forgotten after a short absence. */
const turnVerbs = new Map<string, { verb: string; seen: number }>();
const VERB_MEMORY_MS = 4000;
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
    // One message-box lookup for the pass: `inComposer` is asked about every primary button dsh
    // draws, and each ask used to run its own subtree query for the same element.
    const box = document.querySelector("[contenteditable]");
    for (const sendBtn of document.querySelectorAll<HTMLElement>('button[class*="_primary"]')) {
      const sendWant = openIsClaude && inComposer(sendBtn, box);
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
  const title =
    mine && total > 0 && last
      ? `Claude cost: ${fmtCost(total)} this session, ${fmtCost(last.costUsd)} last turn (${turns.length} turn${turns.length === 1 ? "" : "s"})${fmtTtft(last.ttftMs)}`
      : "";
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
    let pad = " "; // what sits between the bar and the text; nothing inside a pill
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

    const tryHook = () => {
      if (!anchorRef.current?.isConnected) return;
      if (inline?.isConnected) {
        // Already in the row: rewrite what it says instead of building it again.
        if (trigger) {
          trigger.setAttribute("aria-label", titleRef.current);
          trigger.setAttribute("aria-expanded", String(openRef.current));
        } else inline.title = titleRef.current;
        if (body) body.textContent = `${pad}${textRef.current}`;
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
        trigger.addEventListener("click", () => setOpen((was) => !was));
        body.className = proto.querySelector("span")?.className ?? "";
        body.textContent = textRef.current;
        trigger.append(body);
        inline.append(trigger);
        pillRef.current = inline;
      } else {
        pad = " ";
        inline.title = titleRef.current;
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
        <span
          title={title}
          style={{ display: "inline", fontSize: 14, color: T.faint, whiteSpace: "nowrap" }}
        >
          <span aria-hidden="true">|</span> {text}
        </span>
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
              <span aria-hidden="true">{CLAUDE_MARK}</span>Claude cost
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
  margin: "0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px)",
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

  const chip: CSSProperties = {
    ...btn,
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    border: `1px solid ${T.border}`,
    background: "transparent",
  };

  return (
    <div {...{ [DOCK_ATTR]: "1" }} style={DOCK_CARD}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          fontSize: 12,
          color: T.faint,
        }}
      >
        {opener === "" || busy ? (
          <span>Type a prompt to start. Save it here to open the next session with it.</span>
        ) : (
          <>
            <button type="button" style={chip} onClick={() => setDraft(opener)} title={opener}>
              {opener.length > 60 ? `${opener.slice(0, 60)}…` : opener}
            </button>
            <span>fills the composer; edit before sending.</span>
          </>
        )}
        <span style={{ flex: "1 1 auto" }} />
        {draft === "" ? null : (
          <button
            type="button"
            style={chip}
            onClick={() => save(draft)}
            title="Save what is in the composer as this session's opening prompt"
          >
            {note === "" ? "Save draft" : note}
          </button>
        )}
        {opener === "" ? null : (
          <ConfirmButton label="Forget" style={chip} disabled={false} onAct={() => save("")} />
        )}
      </div>
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
  if (sessionId === undefined || inputActions === undefined) return null;
  return (
    <StarterCard
      sessionId={sessionId}
      ctx={ctx}
      draft={draft}
      setDraft={(text) => inputActions.setDraft(text)}
    />
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
  dismissed?: boolean;
}

/**
 * The `/btw` aside bubble: a Claude-orange card docked above the composer, in the same slot and at
 * the same width as dsh's todo and goal panels, that shows each side question and the answer the
 * CLI returns off the transcript. Pending cards read as thinking; each is dismissed on its own. The
 * server keeps only the last few per session, so the list stays short.
 */
function AsideBubble({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const [items, setItems] = useState<AsideItem[]>([]);
  // What the poll compares its answer against, without listing `items` as a dependency of its effect.
  const itemsRef = useRef<AsideItem[]>([]);
  itemsRef.current = items;
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
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
        const body = (await r.json()) as { items: AsideItem[] } | { error: string };
        if ("error" in body) return;
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
  if (shown.length === 0) return null;

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
  `[data-omc-cost-title-label]>span{color:${CLAUDE_ORANGE}}` +
  "[data-omc-cost-title-value]{font-variant-numeric:tabular-nums}" +
  "[data-omc-cost-rule]{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}" +
  "[data-omc-cost-details]{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}" +
  "[data-omc-cost-details] dt,[data-omc-cost-details] dd{min-width:0;margin:0}" +
  "[data-omc-cost-details] dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}";

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
  watchToolFolds();

  function Section(props: { close?: () => void }) {
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
          <Spark size={16} />
          <h2 id="dsh-oh-my-claude-heading" style={{ margin: 0, fontSize: 18 }}>
            Oh My Claude
          </h2>
        </div>
        {error && <p style={{ color: T.err, fontSize: 13 }}>{error}</p>}
        {boxes !== null && (
          <Card
            id="dsh-oh-my-claude-sessions-card"
            title="Archived Sessions"
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
    // Above the aside so a fresh tab reads top-down: what to type first, then anything that answered
    // later. dsh hands composer-slot entries the composer's own `inputActions` and `useInput`, which
    // is what lets the card fill the box without sending it.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-starter", order: 44 },
      (props) => <StarterSlot {...props} ctx={ctx} />,
    );
    // The tool headers' icons are cloned out of this hidden sheet; it rides along with the dock
    // because that is mounted wherever a conversation is, which is the only place headers exist.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-tool-icons", order: 46 },
      () => <ToolIconSprites />,
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
