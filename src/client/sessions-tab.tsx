// The sessions tab from the browser's side: the grouped transcript list, its filters and paging, and
// the deep-link helpers the rows use.
import { t, useLocale } from "./i18n.js";
import { sessionLabel } from "./panel.js";
import { SearchField } from "./search-field.js";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ClientCtx,
  ROUTE,
  SessionData,
  T,
  ago,
  btn,
  btnPrimary,
  matchesQuery,
  meta,
  openHere,
  openSession,
  openSessionId,
  pill,
  readJson,
  resumeCommand,
  row,
  saveBlob,
  select,
} from "./shared.js";
import { BoxData, SkeletonRows } from "./boxes.js";

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
export const size = (bytes: number): string =>
  bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
/** `/home/me/Projects/app` → `Projects/app`, and the same for a Windows path; keeps the full path
 *  for the title attribute. */
const shortPath = (p: string | undefined): string => {
  if (!p) return "";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : p;
};

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

/** Link that opens a transcript on another box: its dsh, logged in via token if we hold one. */
const jumpUrl = (box: { url: string; token?: string }, s: { id: string; cwd?: string }): string =>
  `${box.url}/${box.token ? `?token=${encodeURIComponent(box.token)}` : ""}#${HASH_KEY}=${encodeURIComponent(s.id)}&cwd=${encodeURIComponent(s.cwd ?? "")}`;

interface RemoteSessionData extends SessionData {
  url: string;
  host?: string;
  ok?: boolean;
  error?: string;
  sessions?: SessionData[];
  name?: string;
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
export function Sessions({ ctx, boxes, close }: SessionsProps) {
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
