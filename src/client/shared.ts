import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

export const ROUTE = "/dsh-oh-my-claude";
/** "m*****@gmail.com": first letter, stars, then the domain. Every surface that shows the login
 *  masks it — the panel and the diagnostics rows get screen-shared. */
export const maskEmail = (email: string): string => {
  const at = email.indexOf("@");
  if (at < 1) return email;
  return `${email[0]}${"*".repeat(Math.max(3, at - 1))}${email.slice(at)}`;
};
/** Format a turn's cost in USD with two decimals. */
export const fmtCost = (usd: number): string => `$${usd.toFixed(2)}`;
/** Format duration ms into a human string: "34s" or "1m 35s". */
export const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  if (sec === 0) return `${m}m`;
  return `${m}m ${sec}s`;
};
/** Cache share = cacheRead / (input + cacheRead + cacheWrite), clamped to [0,1]. */
export const cacheShare = ({
  input,
  cacheRead,
  cacheWrite,
}: {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}): number => {
  const denom = input + cacheRead + cacheWrite;
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, cacheRead / denom));
};

export const ago = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};

// dsh's design tokens (`--dsw-alias-*`) with plain fallbacks for any other host theme.
export const T = {
  text: "var(--dsw-alias-label-primary, inherit)",
  muted: "var(--dsw-alias-label-secondary, rgba(128,128,128,.9))",
  faint: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.7))",
  border: "var(--dsw-alias-border-l2, rgba(128,128,128,.22))",
  card: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))",
  field: "var(--dsw-alias-bg-base, transparent)",
  hover: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1))",
  brand: "var(--dsw-alias-brand-primary, #3b82f6)",
  ok: "var(--dsw-alias-state-success-primary, #22a06b)",
  warn: "var(--dsw-alias-state-warn-primary, #d9822b)",
  err: "var(--dsw-alias-state-error-primary, #d33)",
  mono: "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  onBrand: "var(--dsw-alias-label-primary-inverted, #fff)",
};

/** Claude's brand orange and its shimmer stop (the CLI theme table): the one accent this plugin adds. */
export const CLAUDE_ORANGE = "#D97757";
export const CLAUDE_SHIMMER = "#F59575";
/** Claude's own spinner glyph, used as the mark beside anything Claude-owned in dsh's chrome. */
export const CLAUDE_MARK = "✻";

export const card: CSSProperties = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: "14px 18px",
  marginTop: 14,
};
export const cardHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};
export const h3: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, color: T.text };
export const meta: CSSProperties = { color: T.faint, fontSize: 12, whiteSpace: "nowrap" };
export const row: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "9px 0",
  borderTop: `1px solid ${T.border}`,
};
export const btn: CSSProperties = {
  padding: "5px 12px",
  cursor: "pointer",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.text,
  fontSize: 13,
  whiteSpace: "nowrap",
};
export const btnPrimary: CSSProperties = {
  ...btn,
  background: T.brand,
  color: T.onBrand,
  border: "1px solid transparent",
};
export const pill = (color: string): CSSProperties => ({
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.2,
  color,
  border: `1px solid ${color}`,
  opacity: 0.9,
  whiteSpace: "nowrap",
});
export const chip = (active: boolean, disabled: boolean): CSSProperties => ({
  ...btn,
  padding: "3px 10px",
  fontSize: 12,
  borderRadius: 999,
  background: active ? T.brand : "transparent",
  color: active ? T.onBrand : disabled ? T.faint : T.text,
  border: `1px solid ${active ? "transparent" : T.border}`,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
});
export const select: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.field,
  color: T.text,
  fontSize: 13,
  maxWidth: 260,
};
export const inputStyle: CSSProperties = { ...select, minWidth: 0, flex: 1 };
export const code: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: 12,
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.field,
  color: T.text,
  fontFamily: T.mono,
  fontSize: 13,
  lineHeight: 1.5,
  tabSize: 2,
  whiteSpace: "pre",
};
/** A word of code inside a sentence: sits on the text line, no block padding or full width. */
export const codeInline: CSSProperties = {
  fontFamily: T.mono,
  fontSize: "0.9em",
  padding: "1px 5px",
  borderRadius: 5,
  border: `1px solid ${T.border}`,
  background: T.field,
  whiteSpace: "nowrap",
};

/** Decode a reply from this plugin's own routes; a non-2xx status throws its `error` text. */
export const readJson = async <T>(r: Response): Promise<T> => {
  // SAFETY: the body comes from this plugin's own routes; the caller names the route's reply shape
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
};

export interface SessionData {
  id: string;
  title?: string;
  cwd?: string;
  modifiedAt: number;
  turns: number;
  turnsPartial?: boolean;
  bytes: number;
  dsh?: { archived?: boolean; id?: string };
}

/** A transcript already tracked by a live (not archived) dsh session: it is in the sidebar, skip it. */
export const isOwnedActive = (s: { dsh?: { id?: string; archived?: boolean } }): boolean =>
  !!s.dsh?.id && !s.dsh.archived;

/** Open a transcript row on this box: unarchive/open a dsh session, or import a terminal one. */
async function openHere(
  ctx: ClientCtx,
  s: { dsh?: { id?: string; archived?: boolean }; id: string; cwd?: string },
  cwd: string,
) {
  const known = () => ctx.sessions.list.getSnapshot()?.byId ?? {};
  const id = s.dsh?.id ?? s.id;
  if (s.dsh?.archived || (!s.dsh && !known()[id])) {
    await readJson(
      await fetch(`${ROUTE}/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, id: s.id }),
      }),
    );
    if (!s.dsh) {
      const ws = (ctx.workspaces.list.getSnapshot()?.items ?? []).find((w) => w.path === cwd);
      await ctx.sessions.create(
        ws ? { sessionId: id, workspaceId: ws.workspaceId } : { sessionId: id },
      );
    }
    // Unarchiving/importing lands server-side; the client's session store learns of the session
    // through its own subscription a beat later. Opening an id the store does not know yet is a
    // no-op — the restored session would never come to the foreground — so wait briefly for it.
    for (let i = 0; i < 40 && !known()[id]; i++) await new Promise((r) => setTimeout(r, 50));
    // If it never appeared (server-side open/import error), `open` below is a no-op and the row just
    // does nothing; leave a breadcrumb so a stuck restore is diagnosable rather than silent.
    if (!known()[id])
      console.warn(`[oh-my-claude] session ${id} did not appear after open; not opened`);
  }
  ctx.sessions.open(id);
}
export { openHere };

/**
 * Put the plan usage inside dsh's context-meter popover, above the "N% of context used" line,
 * and one compact line into the ring's hover tooltip.
 * The meter (dsh-client-ui-conversation ContextMeter) has no slot, so this watches the DOM for
 * its dialog: a `[role=dialog]` whose parent holds a `button[aria-haspopup=dialog]` with the ring.
 * ponytail: DOM hook on a structural selector; swap for a slot the day the meter grows one.
 */
export const isRingRoot = (el: HTMLElement | null) =>
  !!el?.querySelector(':scope > button[aria-haspopup="dialog"] circle + circle');

/** Whether a session, open or not, runs on one of this plugin's mounts (`claude-code*`). */
export const isClaudeSession = (ctx: ClientCtx, id: string): boolean => {
  try {
    const provider = ctx.modelDirectories.directoryFor(id).store.getSnapshot().current?.provider;
    return provider !== undefined && provider.startsWith("claude-code");
  } catch {
    return false; // no scope or binding yet: not ours
  }
};

/** The open session's provider when it is one of this plugin's mounts (`claude-code*`), else undefined. */
export const activeClaudeSession = (ctx: ClientCtx): string | undefined => {
  const id = ctx.sessions.list.getSnapshot()?.current;
  if (!id) return undefined;
  return isClaudeSession(ctx, id) ? id : undefined;
};
/** The open Claude session's own provider id (e.g. `claude-code` or `claude-code-prod`), else undefined. */
export const activeClaudeProvider = (ctx: ClientCtx): string | undefined => {
  const id = ctx.sessions.list.getSnapshot()?.current;
  if (!id) return undefined;
  try {
    const provider = ctx.modelDirectories.directoryFor(id).store.getSnapshot().current?.provider;
    return provider && provider.startsWith("claude-code") ? provider : undefined;
  } catch {
    return undefined; // no scope or binding yet: not ours
  }
};

interface RestoreButtonProps {
  sessionId: string;
  ctx: ClientCtx;
}
export type { RestoreButtonProps };

/** A popover anchored above a composer control, so a list never expands the composer bar. */
export const popover: CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 6px)",
  left: 0,
  width: 440,
  zIndex: 40,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 280,
  overflowY: "auto",
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: 6,
  boxShadow: "0 8px 24px rgba(0,0,0,.18)",
};

/** Body of one Oh My Claude tab: plain flow inside the host panel, which owns position and size. */
export const bodyFlow: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };

/** Close an open popover on an outside click or Escape. */
export function useDismiss(
  open: boolean,
  close: () => void,
  root: { current: HTMLElement | null },
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, root]);
}

/** Return true when the viewport is narrow enough to need fixed positioning for panels. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

type DshSlots = {
  inject: (slot: string, factory: () => ReactNode) => void;
  register: (
    spec: {
      name: string;
      id?: string;
      order?: number;
      label?: string;
      inject?: () => Record<string, never>;
    },
    // `sessionId` on session-scoped slots; `close` on `settings.section` (dsh-client-ui-settings-general
    // passes it so a section can dismiss the settings panel, e.g. after opening a restored session).
    // `inputActions` is the composer's own action face, handed to every entry of the session-scoped
    // composer slots (`conversation.input.dock` among them): `setDraft` writes the composer without
    // sending, which is what a prompt starter needs.
    Component: (props: {
      sessionId?: string;
      close?: () => void;
      inputActions?: { setDraft: (text: string) => void; submit?: () => void };
      // The composer's published state, read through dsh's snapshot-selector hook; `draft` is the
      // text in the box right now.
      useInput?: <T>(select: (state: { draft: string }) => T) => T;
    }) => ReactNode,
  ) => void;
};
/** The dsh client services this panel uses, the ones `inject` names. */
export interface ClientCtx {
  slots: DshSlots;
  sessions: {
    // `cwd`, `blank`, `running`, `completed` and `displayTitle` come from SessionSummary
    // (dsh-api-session-controller); the snapshot stores one per live session keyed by sessionId.
    // `completed` is dsh's own "finished while not selected and not yet opened" bit.
    list: {
      getSnapshot: () => {
        byId: Record<
          string,
          {
            id: string;
            cwd?: string;
            blank?: boolean;
            running?: boolean;
            completed?: boolean;
            displayTitle?: string;
          }
        >;
        phase?: string;
        current?: string;
      };
    };
    open: (id: string) => void;
    create: (opts: { sessionId: string; workspaceId?: string }) => Promise<void>;
    // When present, the host can forward dsh-style commands to a session's underlying CLI.
    binding?: (id: string) => {
      session?: {
        command: (line: string) => Promise<{
          ok: boolean;
          value?: { matched?: boolean };
          error?: { code?: string; message?: string };
        }>;
      };
    };
  };
  workspaces: {
    list: { getSnapshot: () => { items: Array<{ path: string; workspaceId: string }> } };
  };
  // From dsh-client-ui-model-selection (`ModelDirectoryResolver`, registered as `modelDirectories`).
  modelDirectories: {
    directoryFor: (sessionId: string) => {
      store: {
        subscribe: (fn: () => void) => () => void;
        getSnapshot: () => {
          current: { provider: string; model: string } | null;
          groups?: readonly { id: string; models: readonly { id: string }[] }[];
        };
      };
      // Bind a resumed session to a provider/model (dsh-client-ui-model-selection ModelDirectory).
      load?: () => Promise<{
        groups: readonly { id: string; models: readonly { id: string }[] }[];
      }>;
      select?: (sel: { provider: string; model: string }) => Promise<void>;
    };
  };
}
