// The switches and fields on the Settings "Oh My Claude" card from the browser's side, plus the two
// dock components that read the same hints. The entry renders them inside the card it builds.
import { t, useLocale } from "./i18n.js";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ROUTE,
  T,
  btn,
  readJson,
  select,
  inputStyle,
  DOCK_ATTR,
  ACCENT,
  isClaudeSession,
  claudeProviderOf,
  claudeMount,
  type ClientCtx,
  openSessionId,
  numberOr,
  guard,
  nested,
  DOCK_CARD,
} from "./shared.js";
import { themeOf } from "./theme.js";
import { StarNudge } from "./update-pill.js";
import { livingModelId } from "../model-ids.js";
import { ConfirmButton } from "./tune.js";
import { ClaudeUpdateDetails } from "./claude-updates.js";
import { COMPACT_AT, COMPACT_AT_CHOICES, compactThreshold } from "./nudge.js";
import { Switch } from "./switch.js";
import type { ToolMode, ToolModeInfo } from "../rows-probe.js";
import { RECAP_AWAY_MS, RECAP_AWAY_CHOICES, recapAwayIn } from "./notices.js";
import { SETTINGS_SCOPES, SCOPE_LABELS } from "./settings.js";
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
import { loadHints, useHintValue, writeHints, useHintFlag } from "./hints.js";

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
export function WorkspaceModelMemory({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
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
export function StaleModelRepair({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
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
export function StarterCard({
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
export function LimitWarningsSwitch() {
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
export function StarLine() {
  const [off, setOff] = useHintFlag("starOff");
  if (off) return null;
  return <StarNudge onDismiss={() => setOff(true)} />;
}

/** The Claude look: the master switch first under the section title, then a fold with one checkbox
 *  per group and the accent colour. Box-wide in the hints store like the switches under it;
 *  applyTheme repaints on the hints event the setters dispatch, so nothing here touches the DOM. */
export function ThemeSwitch() {
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
              flag="themeComposerOff"
              group="composer"
              label={t("main.settingsUi.groupComposer")}
            />
            <ThemeGroupBox
              flag="themeModelsOff"
              group="models"
              label={t("main.settingsUi.groupModels")}
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

/** The settings switch for the selection bar, under the prompt-starter switch. Box-wide, like it. */
export function SelectionSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("selectionOff");
  return (
    <div
      data-omc-selection-switch=""
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
        <div>{t("main.settingsUi.selectionTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.selectionDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.selectionTitle")}
      />
    </div>
  );
}

/** The settings switch for the prompt-starter dock, under the Claude look switch. */
export function StarterSwitch() {
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
export function ContextSwitch({ ctx }: { ctx: ClientCtx }) {
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

export function ContextRowMask({
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
export function UpdateNoticeSwitch() {
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
export function ClaudeUpdateSwitch() {
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
export function ProxyFirstPartySwitch() {
  useLocale();
  const [on] = useHintFlag("proxyFirstParty");
  const [off] = useHintFlag("proxyFirstPartyOff");
  const mode = on ? "on" : off ? "off" : "auto";
  // Both keys in one write: `false` clears a key, and the pair only ever holds the chosen answer.
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- writeHints is an import now, so nothing here is captured from the component
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
export function WorkspaceModelSwitch() {
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

/** Settings > Oh My Claude: on by default, repeats the working line above the composer while the
 *  turn's own header line is off screen. Off leaves only dsh's header line. The switch stores the
 *  off state (`dockStatusOff`), so an unset box gets the line. */
export function DockStatusSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("dockStatusOff");
  return (
    <div
      data-omc-dock-status-switch=""
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
        <div>{t("main.settingsUi.dockStatusTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.dockStatusDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.dockStatusTitle")}
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
export function ToolRowsSwitch() {
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
export function CostSwitch() {
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

/** The suggestions switch, inverted over the `promptSuggestionsOff` hint so a box with no hint
 *  reads as on, the way the Claude Code terminal has it (owner, 2026-10-21: match the CLI; the
 *  call is mostly cache reads). Applies at the next spawn of a session's Claude, which the
 *  description says. */
export function SuggestionSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("promptSuggestionsOff");
  return (
    <div
      data-omc-suggestion-switch=""
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
        <div>{t("main.settingsUi.suggestTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.suggestDesc")}</div>
      </div>
      <Switch on={!off} onChange={(on) => setOff(!on)} label={t("main.settingsUi.suggestTitle")} />
    </div>
  );
}

/** The settings switch for the context nudge and, with it on, the percent it speaks at. Both are
 *  hints like the suggestion switch above: the threshold is the box's, so every tab agrees on when
 *  to speak up. The default is stored as absence, so a box that never touched it follows a moved
 *  default. */
export function CompactNudgeSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("compactNudgeOff");
  const [stored, setStored] = useHintValue("compactNudgeAt");
  const at = compactThreshold(stored);
  return (
    <>
      <div
        data-omc-compact-switch=""
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
          <div>{t("main.settingsUi.compactTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.compactDesc", { percent: at })}
          </div>
        </div>
        <Switch
          on={!off}
          onChange={(on) => setOff(!on)}
          label={t("main.settingsUi.compactTitle")}
        />
      </div>
      {!off && (
        <label
          data-omc-compact-at=""
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            marginBottom: 12,
            paddingLeft: 16,
          }}
        >
          <span style={{ color: T.muted }}>{t("main.settingsUi.compactAtLabel")}</span>
          <select
            style={select}
            aria-label={t("main.settingsUi.compactAtAria")}
            value={String(at)}
            onChange={(e) => {
              const next = Number(e.target.value);
              setStored(next === COMPACT_AT ? null : next);
            }}
          >
            {COMPACT_AT_CHOICES.map((pct) => (
              <option key={pct} value={String(pct)}>
                {pct === COMPACT_AT
                  ? t("main.settingsUi.defaultSuffix", { text: `${pct}%` })
                  : `${pct}%`}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/**
 * The settings switch for the one-line recap on returning to a finished session, and the away bar
 * under it. Both are hints: the answer lands in the Asides ring, which is the box's, so whether to
 * spend the call is the box's question and not this browser's.
 */
export function ReturnRecapSwitch() {
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
export function SpendGuardField() {
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
export function TerminalSyncSwitch() {
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
