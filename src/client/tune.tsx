import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  errText,
  btn,
  sectionHead,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  inputStyle,
  select,
  useNarrow,
  claudeProviderOf,
  codeInline,
} from "./shared.js";
import type { ClientCtx } from "./shared.js";
import {
  PERMISSION_KINDS,
  readPermissionRules,
  setPermissionRule,
  type PermissionKind,
} from "../permissions.js";
import { SCOPE_LABELS, type SettingsScopeInfo } from "./settings.js";
import type { ToolMode, ToolModeInfo } from "../rows-probe.js";
import { t, useLocale } from "./i18n.js";

/** What the usage route answers about extra usage. */
interface UsageReply {
  extraUsage?: boolean;
}

/** A Fable model, which is the family whose advisor bills to usage credits. */
export const isFable = (value: SettingsValue) => String(value ?? "").startsWith("claude-fable");

/** The settings.json keys this tab owns. Everything else in the file is left untouched. The three
 *  attribution fields are nested under one object in the file and flat here, one row each. */
export interface Tunables {
  outputStyle?: string;
  alwaysThinkingEnabled?: boolean;
  showThinkingSummaries?: boolean;
  autoCompactWindow?: number;
  promptCacheTtl?: string;
  subagentPromptCacheTtl?: string;
  advisorModel?: string;
  fallbackModel?: string;
  askUserQuestionTimeout?: string;
  dialogExpiry?: string;
  bashOutputMaxChars?: number;
  taskOutputMaxChars?: number;
  "attribution.commit"?: string;
  "attribution.pr"?: string;
  "attribution.sessionUrl"?: boolean;
  /** The release channel the CLI's updater and the plugin's update card follow. */
  autoUpdatesChannel?: "latest" | "stable" | "rc";
}
type TuneKey = keyof Tunables;
/** A settings document as this tab handles it: every key open, since it edits a dozen and keeps
 *  the rest. `attribution` is the one nested object, so a value may be a settings object itself. */
type SettingsValue = string | number | boolean | null | undefined | Settings;
type Settings = { [key: string]: SettingsValue };
/** The CLI's own pair of cache TTLs; anything else is not a value its resolver understands. */
const cacheTtl = (value: SettingsValue) => (value === "5m" || value === "1h" ? value : undefined);
/** True only for the two prompt-cache-TTL keys, so validation applies the CLI's own `5m`/`1h`
 *  rule to just those and leaves every other row to its own check. */
const isCacheTtlKey = (key: TuneKey) =>
  key === "promptCacheTtl" || key === "subagentPromptCacheTtl";

/** The CLI's deadline enum, shared by both waiting rows. `never` is a value, not an absent key. */
const DEADLINES = ["60s", "5m", "10m", "never"] as const;
/** True only when the value equals one of the four deadline strings, so a non-string or an
 *  unknown string fails the deadline check. */
const isDeadline = (value: SettingsValue) => DEADLINES.some((d) => d === value);
/** True only for the two deadline keys, so validation checks just those against the `60s`, `5m`,
 *  `10m`, `never` set and leaves the rest to its own check. */
const isDeadlineKey = (key: TuneKey) => key === "askUserQuestionTimeout" || key === "dialogExpiry";

/** What the CLI clamps the two output sizes to; a value outside it is silently pulled back in,
 *  so the row refuses it here instead of showing a number the model will never see. */
const OUTPUT_MIN = 4000;
const OUTPUT_MAX = 128_000;
/** True only for the two output-size keys, so validation applies the 4000 to 128000 range to just
 *  those and leaves every other row to its own check. */
const isOutputKey = (key: TuneKey) => key === "bashOutputMaxChars" || key === "taskOutputMaxChars";

/** Set a key, or drop it when the control returns to the CLI's own default (an absent key). */
export function updateSettings(
  text: string,
  key: TuneKey,
  value: string | number | boolean | undefined,
): { text: string; error?: undefined } | { error: string } {
  if (
    key === "autoCompactWindow" &&
    value !== undefined &&
    !(Number.isInteger(value) && Number(value) > 0)
  )
    return { error: t("tune.errCompact") };
  if (isCacheTtlKey(key) && value !== undefined && cacheTtl(value) === undefined)
    return { error: t("tune.errCacheTtl") };
  if (isDeadlineKey(key) && value !== undefined && !isDeadline(value))
    return { error: t("tune.errDeadline") };
  if (
    isOutputKey(key) &&
    value !== undefined &&
    !(Number.isInteger(value) && Number(value) >= OUTPUT_MIN && Number(value) <= OUTPUT_MAX)
  )
    return { error: t("tune.errOutput", { min: OUTPUT_MIN, max: OUTPUT_MAX }) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : t("tune.errNotJson") };
  }
  if (!(parsed instanceof Object) || Array.isArray(parsed))
    return { error: t("tune.errNotObject") };
  // SAFETY: the value parsed as a plain object, which is the shape the route also enforces.
  const obj = parsed as Settings;
  const [outer, inner] = key.split(".");
  if (inner === undefined) {
    if (value === undefined) delete obj[key];
    else obj[key] = value;
  } else {
    // An empty string is what hides a trailer, so only an absent value removes the field, and the
    // `attribution` object goes with its last field rather than being left behind empty.
    const held = obj[outer ?? ""];
    const nested: Settings = held instanceof Object && !Array.isArray(held) ? { ...held } : {};
    if (value === undefined) delete nested[inner];
    else nested[inner] = value;
    if (Object.keys(nested).length === 0) delete obj[outer ?? ""];
    else obj[outer ?? ""] = nested;
  }
  // Two spaces and a trailing newline: how Claude Code writes the file itself.
  return { text: `${JSON.stringify(obj, null, 2)}\n` };
}

/** Read the seven keys out of the file; anything of the wrong type reads as unset. */
export function readTunables(text: string): Tunables {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!(parsed instanceof Object) || Array.isArray(parsed)) return {};
  // SAFETY: a plain object; each field is checked against its expected type before use.
  const obj = parsed as Settings;
  const out: Tunables = {};
  const style = obj.outputStyle;
  if (style !== null && style !== undefined && style !== "") out.outputStyle = String(style);
  if (obj.alwaysThinkingEnabled === true) out.alwaysThinkingEnabled = true;
  if (obj.showThinkingSummaries === true) out.showThinkingSummaries = true;
  if (Number.isInteger(obj.autoCompactWindow))
    out.autoCompactWindow = Number(obj.autoCompactWindow);
  const ttl = cacheTtl(obj.promptCacheTtl);
  if (ttl !== undefined) out.promptCacheTtl = ttl;
  const subagentTtl = cacheTtl(obj.subagentPromptCacheTtl);
  if (subagentTtl !== undefined) out.subagentPromptCacheTtl = subagentTtl;
  // A model id, so the same reading as outputStyle: an absent, empty or boolean value is no id.
  const advisor = obj.advisorModel;
  if (
    advisor !== null &&
    advisor !== undefined &&
    advisor !== "" &&
    advisor !== true &&
    advisor !== false
  )
    out.advisorModel = String(advisor);
  const fallback = obj.fallbackModel;
  if (
    fallback !== null &&
    fallback !== undefined &&
    fallback !== "" &&
    fallback !== true &&
    fallback !== false
  )
    out.fallbackModel = String(fallback);
  if (isDeadline(obj.askUserQuestionTimeout))
    out.askUserQuestionTimeout = String(obj.askUserQuestionTimeout);
  if (isDeadline(obj.dialogExpiry)) out.dialogExpiry = String(obj.dialogExpiry);
  if (Number.isInteger(obj.bashOutputMaxChars))
    out.bashOutputMaxChars = Number(obj.bashOutputMaxChars);
  if (Number.isInteger(obj.taskOutputMaxChars))
    out.taskOutputMaxChars = Number(obj.taskOutputMaxChars);
  // An empty string is a set value here: it is how the CLI is told to write no trailer at all.
  const attribution = obj.attribution;
  if (attribution instanceof Object && !Array.isArray(attribution)) {
    const commit = attribution.commit;
    const pr = attribution.pr;
    if (String(commit) === commit) out["attribution.commit"] = commit;
    if (String(pr) === pr) out["attribution.pr"] = pr;
    if (attribution.sessionUrl === true || attribution.sessionUrl === false)
      out["attribution.sessionUrl"] = attribution.sessionUrl;
  }
  const channel = obj.autoUpdatesChannel;
  if (channel === "latest" || channel === "stable" || channel === "rc")
    out.autoUpdatesChannel = channel;
  return out;
}

/** Whether the three attribution fields are all set to say nothing: no commit trailer, no PR
 *  text, no session link. The switch that writes all three reads back from this. */
export const noTrailers = (tunables: Tunables): boolean =>
  tunables["attribution.commit"] === "" &&
  tunables["attribution.pr"] === "" &&
  tunables["attribution.sessionUrl"] === false;

/** settings.json as the route reports it. */
export interface SettingsFile {
  path: string;
  exists: boolean;
  text: string;
  mtime: number;
}

/** Every settings call carries the session's own mount, so a session on a box edits that box's file. */
export const onBox = (provider: string | undefined) =>
  provider === undefined ? "" : `?provider=${encodeURIComponent(provider)}`;
/** The current settings.json for the Tune tab, fetched for the session's provider when one is
 *  given and resolved as a SettingsFile. */
export const read = (provider: string | undefined) =>
  fetch(`${ROUTE}/settings${onBox(provider)}`).then((r) => readJson<SettingsFile>(r));

/** Where a row's value comes from: the file when a key is set, the CLI's own default when not. */
const source = (set: boolean) => (set ? "settings.json" : t("tune.claudeDefault"));
/** The cursor a row shows: a pointer when its value can change, `not-allowed` when it is locked
 *  to the CLI default. */
const check = (on: boolean) => (on ? "pointer" : "not-allowed");

/** The shown label for a permission kind; the stored kind ("allow"/"deny"/"ask") is left untouched
 *  since the CLI reads it, and only the display is translated. */
const kindLabel = (k: PermissionKind): string =>
  k === "allow" ? t("tune.kindAllow") : k === "deny" ? t("tune.kindDeny") : t("tune.kindAsk");

/** Edit the file through one mtime-checked read, write and refresh. Answers an error, or nothing. */
type Apply = (
  mutate: (text: string) => { text: string; error?: undefined } | { error: string },
) => Promise<string | undefined>;

const ARM_EASE = "color 150ms ease, border-color 150ms ease";
/**
 * A destructive button that asks before it acts. The first click arms it and the label becomes
 * "Sure?"; the second click within five seconds runs `onAct`, and anything slower disarms it. No
 * dialog: these rows are dense and a modal over a list of plugins costs more than the mistake it
 * prevents. The point is only that Remove is never one stray click away from uninstalling.
 * Shared by every remove in the plugin's UI: plugins, marketplaces, MCP servers, boxes, remote
 * workspaces, permission rules and the saved opener.
 */
export function ConfirmButton({
  label,
  ariaLabel,
  onAct,
  style,
  disabled,
  busyLabel,
}: {
  label: string;
  /** Accessible name when the visible label is shared by many rows ("Remove <rule>"). */
  ariaLabel?: string;
  onAct: () => void;
  style: CSSProperties;
  disabled: boolean;
  busyLabel?: string;
}) {
  useLocale();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);
  if (busyLabel !== undefined)
    return (
      <button type="button" style={style} disabled>
        {busyLabel}
      </button>
    );
  return (
    <button
      type="button"
      style={
        armed
          ? { ...style, color: T.err, borderColor: T.err, transition: ARM_EASE }
          : { ...style, transition: ARM_EASE }
      }
      disabled={disabled}
      aria-label={armed ? t("tune.confirm", { label: ariaLabel ?? label }) : (ariaLabel ?? label)}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onAct();
      }}
    >
      {/* Both labels share one grid cell so the button is as wide as the wider of the two and
          its neighbours stay put when it arms and when it reverts. */}
      <span style={{ display: "inline-grid" }}>
        <span style={{ gridArea: "1 / 1", visibility: armed ? "hidden" : "visible" }}>{label}</span>
        <span style={{ gridArea: "1 / 1", visibility: armed ? "visible" : "hidden" }}>
          {t("tune.sure")}
        </span>
      </span>
    </button>
  );
}

/** Live thinking-budget tiers the selector offers, matching Claude Code's own keyword steps. null
 *  keeps the session default; 0 turns extended thinking off. Set live, not saved to settings.json.
 *  `labelKey` names the dictionary entry drawn at render, so a language switch relabels the tiers. */
const THINKING_PRESETS = [
  { labelKey: "tune.think.default", tokens: null },
  { labelKey: "tune.think.off", tokens: 0 },
  { labelKey: "tune.think.4k", tokens: 4000 },
  { labelKey: "tune.think.10k", tokens: 10000 },
  { labelKey: "tune.think.32k", tokens: 31999 },
] as const;

/** The Tune tab body: the settings.json keys that change how Claude answers, on the surface that
 *  already shows the answer. Each row is a label, a control and where the value comes from; a
 *  change writes back to settings.json and takes effect the next time Claude spawns. */
export function TuneBody({
  sessionId,
  ctx,
}: {
  sessionId: string;
  ctx: ClientCtx;
}): React.ReactElement {
  useLocale();
  const provider = claudeProviderOf(ctx, sessionId);
  const narrow = useNarrow();
  const [file, setFile] = useState<SettingsFile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [modelsError, setModelsError] = useState("");
  // Three states, and the unknown one counts as off: a credit state nobody could read is not a
  // licence to write an advisor whose first spawn the CLI would refuse.
  const [extraUsage, setExtraUsage] = useState<boolean | null>(null);
  const [creditsError, setCreditsError] = useState("");
  // The custom trailer texts stay behind a disclosure: the switch answers what almost everyone
  // came for, and the inputs are for the person who wants their own wording instead of none.
  const [showTrailers, setShowTrailers] = useState(false);
  // The live extended-thinking budget for THIS session, set over the control seam rather than
  // settings.json: null keeps the session default, 0 turns thinking off. Undefined until we read it.
  const [thinkBudget, setThinkBudget] = useState<number | null | undefined>(undefined);
  const [thinkBusy, setThinkBusy] = useState(false);
  // Tool activity for every session: inline text or dsh's native rows. The plugin holds it, not
  // settings.json: the CLI has no such key. Null until the first read answers.
  const [toolMode, setToolMode] = useState<ToolModeInfo | null>(null);
  const [toolModeErr, setToolModeErr] = useState("");
  const [thinkErr, setThinkErr] = useState("");

  useEffect(() => {
    let live = true;
    read(provider).then(
      (f) => live && setFile(f),
      (e: Error) => live && setError(e.message),
    );
    fetch(`${ROUTE}/models`)
      .then((r) => readJson<{ models?: Array<{ id: string; name: string }> }>(r))
      .then((b) => live && setModels(b.models ?? []))
      .catch((e: Error) => live && setModelsError(e.message));
    fetch(`${ROUTE}/usage`)
      .then((r) => readJson<UsageReply>(r))
      .then((b) => live && setExtraUsage(b.extraUsage === true))
      .catch((e: Error) => live && setCreditsError(e.message));
    fetch(`${ROUTE}/thinking?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<{ tokens: number | null | undefined }>(r))
      .then((b) => live && setThinkBudget(b.tokens))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sessionId]);

  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/tool-mode`)
      .then((r) => readJson<ToolModeInfo>(r))
      .then((b) => live && setToolMode(b))
      .catch(() => live && setToolModeErr(t("tune.errToolMode")));
    return () => {
      live = false;
    };
  }, []);

  if (!file)
    return error ? (
      <span style={errText}>{error}</span>
    ) : (
      <span style={{ ...meta, padding: "2px 0" }}>{t("loading")}</span>
    );

  const settings = readTunables(file.text);

  // Every write re-reads first: another tab, the CLI or an editor may have written since this
  // render, and a whole-file PUT would put their keys back the way this tab last saw them.
  const apply: Apply = async (mutate) => {
    setBusy(true);
    setError("");
    try {
      const fresh = await read(provider);
      if (fresh.mtime !== file.mtime) {
        setFile(fresh);
        return t("tune.errChangedOnDisk");
      }
      const next = mutate(fresh.text);
      if (next.error !== undefined) return next.error;
      setFile(
        await readJson<SettingsFile>(
          await fetch(`${ROUTE}/settings${onBox(provider)}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            // The mtime goes with the text: the check above is this tab's, and the file can still
            // move between that read and this write.
            body: JSON.stringify({ text: next.text, mtime: fresh.mtime }),
          }),
        ),
      );
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      setBusy(false);
    }
  };

  /** Several keys in one edit: one read, one mtime check, one write. Three sequential writes would
   *  each re-read the file and the second would see its own change as someone else's. */
  const writeAll = async (edits: Array<[TuneKey, string | number | boolean | undefined]>) => {
    const failure = await apply((text) => {
      let out: { text: string; error?: undefined } | { error: string } = { text };
      for (const [key, value] of edits) {
        if (out.error !== undefined) return out;
        out = updateSettings(out.text, key, value);
      }
      return out;
    });
    if (failure) setError(failure);
  };

  const write = async (key: TuneKey, value: string | number | boolean | undefined) => {
    // The guard is here, not only on the disabled option: a Fable advisor bills to usage credits,
    // and with them off the CLI refuses to start at all, which would take the next spawn down with
    // it. A credit state that could not be read is treated as off for the same reason.
    if (key === "advisorModel" && isFable(value) && extraUsage !== true) {
      setError(
        creditsError
          ? t("tune.errFableUnread", { error: creditsError })
          : t("tune.errFableCredits"),
      );
      return;
    }
    const failure = await apply((text) => updateSettings(text, key, value));
    if (failure) setError(failure);
  };

  /** Ride the control-request seam the CLI's own thinking hotkey uses: it lands on the running
   *  session at once, so there is no file to re-read and no next-spawn wait. Needs a live process. */
  const setThinking = async (tokens: number | null) => {
    setThinkBusy(true);
    setThinkErr("");
    try {
      const reply = await readJson<{ ok: boolean; tokens: number | null; error?: string }>(
        await fetch(`${ROUTE}/thinking`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, tokens }),
        }),
      );
      if (reply.ok) setThinkBudget(reply.tokens);
      else setThinkErr(reply.error ?? t("tune.errThinkBudget"));
    } catch (e) {
      setThinkErr(e instanceof Error ? e.message : String(e));
    } finally {
      setThinkBusy(false);
    }
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    padding: "8px 0",
    borderTop: `1px solid ${T.border}`,
    flexWrap: "wrap",
  };
  const labelStyle: CSSProperties = {
    fontSize: 13,
    color: T.text,
    flex: "0 0 auto",
    minWidth: 100,
  };
  const sourceStyle: CSSProperties = { ...meta, marginLeft: "auto" };
  const controlStyle: CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flex: narrow ? "1 1 auto" : "0 0 auto",
    minWidth: 0,
  };
  const thinking = settings.alwaysThinkingEnabled === true;

  const pickToolMode = async (mode: ToolMode) => {
    setToolModeErr("");
    try {
      setToolMode(
        await readJson<ToolModeInfo>(
          await fetch(`${ROUTE}/tool-mode`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode }),
          }),
        ),
      );
    } catch (e) {
      setToolModeErr(e instanceof Error ? e.message : String(e));
    }
  };

  // Rows are locked, not hidden, on a dsh that refuses to load them: the row says why, and the
  // same switch works again on a dsh that does, with nothing to update here.
  const rowsLocked = toolMode?.rows.ok === false;

  return (
    <div style={bodyFlow}>
      <span style={{ ...meta, padding: "2px 0", whiteSpace: "normal" }}>{t("tune.savedNote")}</span>
      {error ? <span style={errText}>{error}</span> : null}

      <div style={rowStyle} data-omc-tool-mode="">
        <span style={labelStyle}>{t("tune.toolActivity")}</span>
        <div style={controlStyle} role="radiogroup" aria-label={t("tune.toolActivity")}>
          {(["inline", "rows"] as const).map((mode) => {
            const locked = mode === "rows" && rowsLocked;
            const usable = toolMode !== null && !locked;
            return (
              <label
                key={mode}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: check(usable) }}
              >
                <input
                  type="radio"
                  name="omc-tool-mode"
                  checked={(toolMode?.mode ?? "inline") === mode}
                  disabled={!usable}
                  onChange={() => void pickToolMode(mode)}
                  style={{ cursor: check(usable) }}
                />
                <span style={{ fontSize: 12 }}>
                  {mode === "inline" ? t("tune.toolInline") : t("tune.toolRows")}
                </span>
              </label>
            );
          })}
        </div>
        <span style={{ ...meta, flexBasis: "100%", whiteSpace: "normal" }}>
          {toolModeErr
            ? toolModeErr
            : rowsLocked
              ? t("tune.rowsLocked", { reason: toolMode?.rows.reason ?? "" })
              : t("tune.toolHelp")}
        </span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.outputStyle")}</span>
        <div style={controlStyle}>
          <select
            value={settings.outputStyle ?? ""}
            disabled={busy}
            aria-label={t("tune.outputStyle")}
            onChange={(e) => void write("outputStyle", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">{t("tune.default")}</option>
            <option value="Concise">{t("tune.styleConcise")}</option>
            <option value="Explanatory">{t("tune.styleExplanatory")}</option>
            <option value="Learning">{t("tune.styleLearning")}</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.outputStyle !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.thinking")}</span>
        <div style={controlStyle}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: check(!busy) }}>
            <input
              type="checkbox"
              checked={thinking}
              disabled={busy}
              onChange={(e) => void write("alwaysThinkingEnabled", e.target.checked || undefined)}
              style={{ cursor: check(!busy) }}
            />
            <span style={{ fontSize: 12 }}>{t("tune.alwaysOn")}</span>
          </label>
          {/* Summaries are a display choice for thinking that is already on, so the second switch
              only means anything while the first one is set. */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: check(thinking && !busy),
              opacity: thinking ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              checked={settings.showThinkingSummaries === true}
              disabled={busy || !thinking}
              onChange={(e) => void write("showThinkingSummaries", e.target.checked || undefined)}
              style={{ cursor: check(thinking && !busy) }}
            />
            <span style={{ fontSize: 12 }}>{t("tune.showSummaries")}</span>
          </label>
        </div>
        <span style={sourceStyle}>
          {source(thinking || settings.showThinkingSummaries === true)}
        </span>
      </div>

      {/* A live control, not a saved setting: this rides the same control-request seam the CLI's
          thinking hotkey uses, so it lands on the running session at once and resets on respawn.
          Kept apart from the persisted "Thinking" row above, which is a next-spawn default. */}
      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.thinkingBudget")}</span>
        <div style={controlStyle}>
          <select
            value={thinkBudget == null ? "" : String(thinkBudget)}
            disabled={thinkBusy}
            aria-label={t("tune.thinkingBudgetAria")}
            onChange={(e) =>
              void setThinking(e.target.value === "" ? null : Number(e.target.value))
            }
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            {THINKING_PRESETS.map((p) => (
              <option key={p.labelKey} value={p.tokens == null ? "" : String(p.tokens)}>
                {t(p.labelKey)}
              </option>
            ))}
          </select>
        </div>
        <span style={sourceStyle}>
          {thinkErr ? <span style={{ color: T.err }}>{thinkErr}</span> : t("tune.liveThisSession")}
        </span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.autoCompact")}</span>
        <div style={controlStyle}>
          {/* Committed on blur and on Enter, never per keystroke: every write touches the file and
              moves its mtime, which the next keystroke would then read as someone else's edit. */}
          {/* Keyed on the file's mtime so a re-read remounts the field with the value now on disk:
              typing does not move the mtime, so this never clobbers a half-typed number. */}
          <input
            key={file.mtime}
            type="number"
            min="1"
            step="1000"
            defaultValue={settings.autoCompactWindow ?? ""}
            disabled={busy}
            placeholder={t("tune.claudeDefault")}
            aria-label={t("tune.autoCompactAria")}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const typed = e.target.value.trim();
              const next = typed === "" ? undefined : Number(typed);
              if (next !== settings.autoCompactWindow) void write("autoCompactWindow", next);
            }}
            style={{ ...inputStyle, maxWidth: narrow ? "100%" : 140 }}
          />
          <span style={{ ...meta }}>{t("tune.tokens")}</span>
        </div>
        <span style={sourceStyle}>{source(settings.autoCompactWindow !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.cacheTtl")}</span>
        <div style={controlStyle}>
          <select
            value={settings.promptCacheTtl ?? ""}
            disabled={busy}
            aria-label={t("tune.promptCacheTtlAria")}
            onChange={(e) => void write("promptCacheTtl", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">{t("tune.default")}</option>
            <option value="5m">{t("tune.min5")}</option>
            <option value="1h">{t("tune.hour1")}</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.promptCacheTtl !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.subagentCacheTtl")}</span>
        <div style={controlStyle}>
          <select
            value={settings.subagentPromptCacheTtl ?? ""}
            disabled={busy}
            aria-label={t("tune.subagentPromptCacheTtlAria")}
            onChange={(e) => void write("subagentPromptCacheTtl", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">{t("tune.default")}</option>
            <option value="5m">{t("tune.min5")}</option>
            <option value="1h">{t("tune.hour1")}</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.subagentPromptCacheTtl !== undefined)}</span>
      </div>
      <span style={{ ...meta, padding: "0 0 2px", whiteSpace: "normal" }}>
        {t("tune.cacheTtlHelp")}
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.advisor")}</span>
        <div style={controlStyle}>
          <select
            value={settings.advisorModel ?? ""}
            disabled={busy || models === null}
            aria-label={t("tune.advisorModelAria")}
            onChange={(e) => void write("advisorModel", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">{t("tune.off")}</option>
            {models?.map((m) => {
              const blocked = isFable(m.id) && extraUsage !== true;
              return (
                <option key={m.id} value={m.id} disabled={blocked}>
                  {m.name}
                  {blocked ? ` ${t("tune.needsCredits")}` : ""}
                </option>
              );
            })}
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.advisorModel !== undefined)}</span>
      </div>
      {modelsError && (
        <span style={errText}>{t("tune.modelListError", { error: modelsError })}</span>
      )}
      {creditsError ? (
        <span style={{ ...meta, padding: "0 0 2px", whiteSpace: "normal" }}>
          {t("tune.creditsUnreadable", { error: creditsError })}
        </span>
      ) : extraUsage === false ? (
        <span style={{ ...meta, padding: "0 0 2px", whiteSpace: "normal" }}>
          {t("tune.fableCreditsBefore")} <code style={codeInline}>/model fable</code>{" "}
          {t("tune.fableCreditsAfter")}
        </span>
      ) : null}
      <span style={{ ...meta, padding: "0 0 2px", whiteSpace: "normal" }}>
        {t("tune.advisorHelp")}
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.fallbackModel")}</span>
        <div style={controlStyle}>
          <select
            value={settings.fallbackModel ?? ""}
            disabled={busy || models === null}
            aria-label={t("tune.fallbackModel")}
            onChange={(e) => void write("fallbackModel", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">{t("tune.off")}</option>
            {models?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.fallbackModel !== undefined)}</span>
      </div>
      <span style={{ ...meta, padding: "0 0 2px", whiteSpace: "normal" }}>
        {t("tune.fallbackHelp")}
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.questionDeadline")}</span>
        <div style={controlStyle}>
          <select
            value={settings.askUserQuestionTimeout ?? ""}
            disabled={busy}
            aria-label={t("tune.questionDeadlineAria")}
            onChange={(e) => void write("askUserQuestionTimeout", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">{t("tune.defaultNever")}</option>
            <option value="60s">{t("tune.min1")}</option>
            <option value="5m">{t("tune.min5")}</option>
            <option value="10m">{t("tune.min10")}</option>
            <option value="never">{t("tune.never")}</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.askUserQuestionTimeout !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.approvalDeadline")}</span>
        <div style={controlStyle}>
          <select
            value={settings.dialogExpiry ?? ""}
            disabled={busy}
            aria-label={t("tune.approvalDeadlineAria")}
            onChange={(e) => void write("dialogExpiry", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">{t("tune.default5min")}</option>
            <option value="60s">{t("tune.min1")}</option>
            <option value="5m">{t("tune.min5")}</option>
            <option value="10m">{t("tune.min10")}</option>
            <option value="never">{t("tune.never")}</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.dialogExpiry !== undefined)}</span>
      </div>
      <span style={{ ...meta, padding: "0 0 2px", whiteSpace: "normal" }}>
        {t("tune.deadlineHelp")}
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.bashOutput")}</span>
        <div style={controlStyle}>
          <input
            key={file.mtime}
            type="number"
            min={OUTPUT_MIN}
            max={OUTPUT_MAX}
            step="1000"
            defaultValue={settings.bashOutputMaxChars ?? ""}
            disabled={busy}
            placeholder={t("tune.claudeDefault")}
            aria-label={t("tune.bashOutputAria")}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const typed = e.target.value.trim();
              const next = typed === "" ? undefined : Number(typed);
              if (next !== settings.bashOutputMaxChars) void write("bashOutputMaxChars", next);
            }}
            style={{ ...inputStyle, maxWidth: narrow ? "100%" : 140 }}
          />
          <span style={{ ...meta }}>{t("tune.characters")}</span>
        </div>
        <span style={sourceStyle}>{source(settings.bashOutputMaxChars !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.taskOutput")}</span>
        <div style={controlStyle}>
          <input
            key={file.mtime}
            type="number"
            min={OUTPUT_MIN}
            max={OUTPUT_MAX}
            step="1000"
            defaultValue={settings.taskOutputMaxChars ?? ""}
            disabled={busy}
            placeholder={t("tune.claudeDefault")}
            aria-label={t("tune.taskOutputAria")}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const typed = e.target.value.trim();
              const next = typed === "" ? undefined : Number(typed);
              if (next !== settings.taskOutputMaxChars) void write("taskOutputMaxChars", next);
            }}
            style={{ ...inputStyle, maxWidth: narrow ? "100%" : 140 }}
          />
          <span style={{ ...meta }}>{t("tune.characters")}</span>
        </div>
        <span style={sourceStyle}>{source(settings.taskOutputMaxChars !== undefined)}</span>
      </div>
      <span style={{ ...meta, padding: "0 0 2px", whiteSpace: "normal" }}>
        {t("tune.outputHelp", { min: OUTPUT_MIN, max: OUTPUT_MAX })}
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>{t("tune.attribution")}</span>
        <div style={controlStyle}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: check(!busy) }}>
            <input
              type="checkbox"
              checked={noTrailers(settings)}
              disabled={busy}
              onChange={(e) =>
                void writeAll(
                  e.target.checked
                    ? [
                        ["attribution.commit", ""],
                        ["attribution.pr", ""],
                        ["attribution.sessionUrl", false],
                      ]
                    : [
                        ["attribution.commit", undefined],
                        ["attribution.pr", undefined],
                        ["attribution.sessionUrl", undefined],
                      ],
                )
              }
              style={{ cursor: check(!busy) }}
            />
            <span style={{ fontSize: 12 }}>{t("tune.noAiTrailers")}</span>
          </label>
          <button
            type="button"
            onClick={() => setShowTrailers(!showTrailers)}
            aria-expanded={showTrailers}
            style={{
              ...meta,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {showTrailers ? t("tune.hideCustomText") : t("tune.customText")}
          </button>
        </div>
        <span style={sourceStyle}>
          {source(
            settings["attribution.commit"] !== undefined ||
              settings["attribution.pr"] !== undefined ||
              settings["attribution.sessionUrl"] !== undefined,
          )}
        </span>
      </div>
      {showTrailers ? (
        <>
          {(
            [
              ["attribution.commit", "tune.commitTrailer", "tune.commitTrailerHint"],
              ["attribution.pr", "tune.prText", "tune.prTextHint"],
            ] as const
          ).map(([key, labelKey, hintKey]) => (
            <div key={key} style={rowStyle}>
              <span style={labelStyle}>{t(labelKey)}</span>
              <div style={{ ...controlStyle, flex: "1 1 auto" }}>
                <input
                  key={`${key}-${file.mtime}`}
                  type="text"
                  defaultValue={settings[key] ?? ""}
                  disabled={busy}
                  placeholder={t("tune.claudeDefault")}
                  aria-label={t(hintKey)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  onBlur={(e) => {
                    const typed = e.target.value;
                    if (typed !== (settings[key] ?? "")) void write(key, typed);
                  }}
                  style={{ ...inputStyle, flex: "1 1 auto", minWidth: 0 }}
                />
              </div>
              <span style={sourceStyle}>{source(settings[key] !== undefined)}</span>
            </div>
          ))}
          <span style={{ ...meta, padding: "0 0 2px", whiteSpace: "normal" }}>
            {t("tune.trailerHelp")}
          </span>
        </>
      ) : null}

      <PermissionsBlock
        file={file}
        apply={apply}
        sessionId={sessionId}
        cwd={ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd ?? null}
        provider={provider}
        narrow={narrow}
        busy={busy}
      />
    </div>
  );
}

/**
 * Permission rules at the bottom of the Tune tab: the three lists as they stand, a row per rule
 * with a remove button, and an add form. The chips are the tool calls this session stopped to ask
 * about, already written as the rule that would have answered them, so promoting an approval to a
 * rule is a click and an edit rather than remembering the syntax.
 *
 * Only `~/.claude/settings.json` is written here, but the CLI merges four files, so the rules from
 * the other three are listed under it without a Remove button. Showing one file alone read as the
 * whole picture: 2 rules on screen while 15 were in force.
 */
function PermissionsBlock({
  file,
  apply,
  sessionId,
  cwd,
  provider,
  narrow,
  busy,
}: {
  file: SettingsFile;
  apply: Apply;
  sessionId: string;
  cwd: string | null;
  provider: string | undefined;
  narrow: boolean;
  busy: boolean;
}) {
  useLocale();
  const [kind, setKind] = useState<PermissionKind>("allow");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [asks, setAsks] = useState<string[]>([]);
  const [others, setOthers] = useState<SettingsScopeInfo[]>([]);
  const rules = readPermissionRules(file.text);

  useEffect(() => {
    // The other scopes are context, not the edit surface: a box or a route that cannot answer
    // leaves them out rather than putting an error over the rules this panel does own.
    let live = true;
    const query = new URLSearchParams();
    if (cwd !== null) query.set("cwd", cwd);
    if (provider !== undefined) query.set("provider", provider);
    const q = query.toString();
    fetch(`${ROUTE}/settings/scopes${q ? `?${q}` : ""}`)
      .then((r) => readJson<{ scopes?: SettingsScopeInfo[] }>(r))
      .then((body) => {
        if (live) setOthers((body.scopes ?? []).filter((sc) => sc.path !== file.path));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd, provider, file.path]);

  useEffect(() => {
    // Suggestions are a convenience: a session that has asked about nothing, or a server too old
    // for the route, leaves the chips out rather than showing an error over the rules.
    let live = true;
    fetch(`${ROUTE}/permission-asks?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<{ asks?: string[] }>(r))
      .then((body) => {
        if (live) setAsks(body.asks ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sessionId]);

  const change = async (action: "add" | "remove", ruleKind: PermissionKind, rule: string) => {
    setError("");
    const failure = await apply((text) => setPermissionRule(text, ruleKind, rule, action));
    if (failure) setError(failure);
    else if (action === "add") setDraft("");
  };

  const known = new Set([...rules.allow, ...rules.deny, ...rules.ask]);
  const unused = asks.filter((rule) => !known.has(rule));

  const heading: CSSProperties = { ...meta, marginBottom: 4, textTransform: "capitalize" };
  const ruleRow: CSSProperties = {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: "4px 0",
    fontSize: 13,
    color: T.text,
  };
  const small: CSSProperties = {
    ...btn,
    padding: "2px 8px",
    fontSize: 12,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1,
  };

  return (
    <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 16, paddingTop: 12 }}>
      <div style={{ ...sectionHead, paddingTop: 0 }}>{t("tune.permissions")}</div>
      <span style={{ ...meta, display: "block", padding: "0 0 8px", whiteSpace: "normal" }}>
        {t("tune.permissionsIntro", { scope: SCOPE_LABELS.user })}
      </span>
      {error ? <span style={{ ...errText, display: "block" }}>{error}</span> : null}

      {PERMISSION_KINDS.filter((k) => rules[k].length > 0).map((k) => (
        <div key={k} style={{ marginBottom: 8 }}>
          <div style={heading}>{kindLabel(k)}</div>
          {rules[k].map((rule) => (
            <div key={rule} style={ruleRow}>
              <span style={{ flex: 1, wordBreak: "break-all", fontFamily: T.mono }}>{rule}</span>
              <ConfirmButton
                label={t("common.remove")}
                ariaLabel={t("tune.removeRule", { rule })}
                onAct={() => void change("remove", k, rule)}
                disabled={busy}
                style={small}
              />
            </div>
          ))}
        </div>
      ))}

      {others.map((scope) => {
        const theirs = readPermissionRules(scope.text);
        const kinds = PERMISSION_KINDS.filter((k) => theirs[k].length > 0);
        if (kinds.length === 0) return null;
        return (
          <div key={scope.scope} style={{ marginBottom: 8 }}>
            <div style={{ ...heading, textTransform: "none" }}>
              {SCOPE_LABELS[scope.scope]} · {t("tune.readOnlyHere")}
            </div>
            {kinds.map((k) =>
              theirs[k].map((rule) => (
                <div key={`${k}:${rule}`} style={{ ...ruleRow, color: T.muted }}>
                  <span style={{ flex: 1, wordBreak: "break-all", fontFamily: T.mono }}>
                    {rule}
                  </span>
                  <span style={{ ...meta, textTransform: "capitalize" }}>{kindLabel(k)}</span>
                </div>
              )),
            )}
          </div>
        );
      })}

      {unused.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <div style={heading}>{t("tune.askedThisSession")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unused.map((rule) => (
              <button
                type="button"
                key={rule}
                onClick={() => {
                  setDraft(rule);
                  setError("");
                }}
                disabled={busy}
                style={{ ...small, fontFamily: T.mono }}
                title={rule}
              >
                {rule}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginTop: 8,
          flexWrap: narrow ? "wrap" : "nowrap",
        }}
      >
        <select
          value={kind}
          aria-label={t("tune.ruleKind")}
          onChange={(e) => {
            // SAFETY: the options are the three kinds, so the value is one of them.
            setKind(e.target.value as PermissionKind);
          }}
          disabled={busy}
          style={{ ...select, flex: "0 0 auto", minWidth: 90, textTransform: "capitalize" }}
        >
          {PERMISSION_KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={draft}
          aria-label={t("tune.rule")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) void change("add", kind, draft);
          }}
          placeholder="Bash(npm run:*)"
          disabled={busy}
          style={{ ...inputStyle, flex: 1, minWidth: narrow ? 0 : 200, fontFamily: T.mono }}
        />
        <button
          type="button"
          onClick={() => void change("add", kind, draft)}
          disabled={busy || draft.trim() === ""}
          style={{ ...small, padding: "6px 12px", opacity: busy || !draft.trim() ? 0.6 : 1 }}
        >
          {t("tune.add")}
        </button>
      </div>
    </div>
  );
}
