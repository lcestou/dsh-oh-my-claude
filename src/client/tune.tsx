import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  inputStyle,
  select,
  useNarrow,
  claudeProviderOf,
} from "./shared.js";
import type { ClientCtx } from "./shared.js";
import {
  PERMISSION_KINDS,
  readPermissionRules,
  setPermissionRule,
  type PermissionKind,
} from "../permissions.js";

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
}
type TuneKey = keyof Tunables;
/** A settings document as this tab handles it: every key open, since it edits a dozen and keeps
 *  the rest. `attribution` is the one nested object, so a value may be a settings object itself. */
type SettingsValue = string | number | boolean | null | undefined | Settings;
type Settings = { [key: string]: SettingsValue };
/** The CLI's own pair of cache TTLs; anything else is not a value its resolver understands. */
const cacheTtl = (value: SettingsValue) => (value === "5m" || value === "1h" ? value : undefined);
const isCacheTtlKey = (key: TuneKey) =>
  key === "promptCacheTtl" || key === "subagentPromptCacheTtl";

/** The CLI's deadline enum, shared by both waiting rows. `never` is a value, not an absent key. */
const DEADLINES = ["60s", "5m", "10m", "never"] as const;
const isDeadline = (value: SettingsValue) => DEADLINES.some((d) => d === value);
const isDeadlineKey = (key: TuneKey) => key === "askUserQuestionTimeout" || key === "dialogExpiry";

/** What the CLI clamps the two output sizes to; a value outside it is silently pulled back in,
 *  so the row refuses it here instead of showing a number the model will never see. */
const OUTPUT_MIN = 4000;
const OUTPUT_MAX = 128_000;
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
    return { error: "auto-compact must be a positive whole number of tokens" };
  if (isCacheTtlKey(key) && value !== undefined && cacheTtl(value) === undefined)
    return { error: "cache TTL must be 5m or 1h" };
  if (isDeadlineKey(key) && value !== undefined && !isDeadline(value))
    return { error: "deadline must be 60s, 5m, 10m or never" };
  if (
    isOutputKey(key) &&
    value !== undefined &&
    !(Number.isInteger(value) && Number(value) >= OUTPUT_MIN && Number(value) <= OUTPUT_MAX)
  )
    return { error: `output limit must be a whole number between ${OUTPUT_MIN} and ${OUTPUT_MAX}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "settings.json is not valid JSON" };
  }
  if (!(parsed instanceof Object) || Array.isArray(parsed))
    return { error: "settings.json must be a JSON object" };
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
  return out;
}

/** Whether the three attribution fields are all set to say nothing: no commit trailer, no PR
 *  text, no session link. The switch that writes all three reads back from this. */
export const noTrailers = (t: Tunables): boolean =>
  t["attribution.commit"] === "" &&
  t["attribution.pr"] === "" &&
  t["attribution.sessionUrl"] === false;

/** settings.json as the route reports it. */
interface SettingsFile {
  path: string;
  exists: boolean;
  text: string;
  mtime: number;
}

/** Every settings call carries the session's own mount, so a session on a box edits that box's file. */
const onBox = (provider: string | undefined) =>
  provider === undefined ? "" : `?provider=${encodeURIComponent(provider)}`;
const read = (provider: string | undefined) =>
  fetch(`${ROUTE}/settings${onBox(provider)}`).then((r) => readJson<SettingsFile>(r));

/** Where a row's value comes from: the file when a key is set, the CLI's own default when not. */
const source = (set: boolean) => (set ? "settings.json" : "Claude Code default");
const check = (on: boolean) => (on ? "pointer" : "not-allowed");

/**
 * "Tune" body inside the ✻ panel: the settings.json keys that change how Claude answers, on the
 * surface that already shows the answer. Each row is label, control, and where the value comes
 * from; a change lands in settings.json and takes effect the next time Claude spawns.
 */
/** Edit the file through one mtime-checked read, write and refresh. Answers an error, or nothing. */
type Apply = (
  mutate: (text: string) => { text: string; error?: undefined } | { error: string },
) => Promise<string | undefined>;

/** Live thinking-budget tiers the selector offers, matching Claude Code's own keyword steps. null
 *  keeps the session default; 0 turns extended thinking off. Set live, not saved to settings.json. */
const THINKING_PRESETS: Array<{ label: string; tokens: number | null }> = [
  { label: "Session default", tokens: null },
  { label: "Off", tokens: 0 },
  { label: "Think · 4k", tokens: 4000 },
  { label: "Think hard · 10k", tokens: 10000 },
  { label: "Ultrathink · 32k", tokens: 31999 },
];

export function TuneBody({
  sessionId,
  ctx,
}: {
  sessionId: string;
  ctx: ClientCtx;
}): React.ReactElement {
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

  if (!file)
    return error ? (
      <span style={{ color: T.err, fontSize: 12 }}>{error}</span>
    ) : (
      <span style={{ ...meta, padding: "2px 4px" }}>Loading…</span>
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
        return "settings.json changed on disk; the tab now shows the new values, try again";
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
          ? `Cannot set a Fable advisor: the usage credit state could not be read (${creditsError}).`
          : "A Fable advisor bills to usage credits. Enable them from a terminal with /model fable first.",
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
      else setThinkErr(reply.error ?? "could not set the thinking budget");
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
    padding: "8px 6px",
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

  return (
    <div style={bodyFlow}>
      <span style={{ ...meta, padding: "2px 4px", whiteSpace: "normal" }}>
        Saved to Claude Code's settings.json; each takes effect the next time Claude spawns.
      </span>
      {error ? <span style={{ color: T.err, fontSize: 12, padding: "0 4px" }}>{error}</span> : null}

      <div style={rowStyle}>
        <span style={labelStyle}>Output style</span>
        <div style={controlStyle}>
          <select
            value={settings.outputStyle ?? ""}
            disabled={busy}
            aria-label="Output style"
            onChange={(e) => void write("outputStyle", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">Default</option>
            <option value="Explanatory">Explanatory</option>
            <option value="Learning">Learning</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.outputStyle !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Thinking</span>
        <div style={controlStyle}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: check(!busy) }}>
            <input
              type="checkbox"
              checked={thinking}
              disabled={busy}
              onChange={(e) => void write("alwaysThinkingEnabled", e.target.checked || undefined)}
              style={{ cursor: check(!busy) }}
            />
            <span style={{ fontSize: 12 }}>Always on</span>
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
            <span style={{ fontSize: 12 }}>Show summaries</span>
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
        <span style={labelStyle}>Thinking budget</span>
        <div style={controlStyle}>
          <select
            value={thinkBudget == null ? "" : String(thinkBudget)}
            disabled={thinkBusy}
            aria-label="Thinking budget for this session"
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
              <option key={p.label} value={p.tokens == null ? "" : String(p.tokens)}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <span style={sourceStyle}>
          {thinkErr ? <span style={{ color: T.err }}>{thinkErr}</span> : "live · this session"}
        </span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Auto-compact</span>
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
            placeholder="Claude Code default"
            aria-label="Auto-compact window in tokens"
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const typed = e.target.value.trim();
              const next = typed === "" ? undefined : Number(typed);
              if (next !== settings.autoCompactWindow) void write("autoCompactWindow", next);
            }}
            style={{ ...inputStyle, maxWidth: narrow ? "100%" : 140 }}
          />
          <span style={{ ...meta }}>tokens</span>
        </div>
        <span style={sourceStyle}>{source(settings.autoCompactWindow !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Cache TTL</span>
        <div style={controlStyle}>
          <select
            value={settings.promptCacheTtl ?? ""}
            disabled={busy}
            aria-label="Prompt cache TTL"
            onChange={(e) => void write("promptCacheTtl", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">Default</option>
            <option value="5m">5 minutes</option>
            <option value="1h">1 hour</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.promptCacheTtl !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Subagent cache TTL</span>
        <div style={controlStyle}>
          <select
            value={settings.subagentPromptCacheTtl ?? ""}
            disabled={busy}
            aria-label="Subagent prompt cache TTL"
            onChange={(e) => void write("subagentPromptCacheTtl", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">Default</option>
            <option value="5m">5 minutes</option>
            <option value="1h">1 hour</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.subagentPromptCacheTtl !== undefined)}</span>
      </div>
      <span style={{ ...meta, padding: "0 6px 2px", whiteSpace: "normal" }}>
        An hour keeps the cache warm across longer breaks, and hour-long cache writes are billed at
        a higher rate.
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>Advisor</span>
        <div style={controlStyle}>
          <select
            value={settings.advisorModel ?? ""}
            disabled={busy || models === null}
            aria-label="Advisor model"
            onChange={(e) => void write("advisorModel", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">Off</option>
            {models?.map((m) => {
              const blocked = isFable(m.id) && extraUsage !== true;
              return (
                <option key={m.id} value={m.id} disabled={blocked}>
                  {m.name}
                  {blocked ? " (needs usage credits)" : ""}
                </option>
              );
            })}
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.advisorModel !== undefined)}</span>
      </div>
      {modelsError && (
        <span style={{ color: T.err, fontSize: 12, padding: "0 4px" }}>
          Could not read the model list: {modelsError}
        </span>
      )}
      {creditsError ? (
        <span style={{ ...meta, padding: "0 6px 2px", whiteSpace: "normal" }}>
          The usage credit state could not be read ({creditsError}), so a Fable advisor stays off
          the list: with credits disabled the CLI refuses to start at all.
        </span>
      ) : extraUsage === false ? (
        <span style={{ ...meta, padding: "0 6px 2px", whiteSpace: "normal" }}>
          A Fable advisor bills to usage credits, which have to be enabled first. Open a terminal
          and run <code style={{ background: T.card, padding: "2px 4px" }}>/model fable</code> to
          review and enable them.
        </span>
      ) : null}
      <span style={{ ...meta, padding: "0 6px 2px", whiteSpace: "normal" }}>
        An advisor weaker than the main model is not used for the main conversation, though
        subagents may still use it.
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>Fallback model</span>
        <div style={controlStyle}>
          <select
            value={settings.fallbackModel ?? ""}
            disabled={busy || models === null}
            aria-label="Fallback model"
            onChange={(e) => void write("fallbackModel", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">Off</option>
            {models?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.fallbackModel !== undefined)}</span>
      </div>
      <span style={{ ...meta, padding: "0 6px 2px", whiteSpace: "normal" }}>
        Where the CLI goes when the main model is overloaded. With none set, an overload ends the
        turn; the swap itself is reported in the reasoning lane when it happens.
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>Question deadline</span>
        <div style={controlStyle}>
          <select
            value={settings.askUserQuestionTimeout ?? ""}
            disabled={busy}
            aria-label="Idle time before Claude's questions auto-continue"
            onChange={(e) => void write("askUserQuestionTimeout", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">Default (never)</option>
            <option value="60s">1 minute</option>
            <option value="5m">5 minutes</option>
            <option value="10m">10 minutes</option>
            <option value="never">Never</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.askUserQuestionTimeout !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Approval deadline</span>
        <div style={controlStyle}>
          <select
            value={settings.dialogExpiry ?? ""}
            disabled={busy}
            aria-label="How long a parked permission prompt waits for an answer"
            onChange={(e) => void write("dialogExpiry", e.target.value || undefined)}
            style={{
              ...select,
              flex: narrow ? "1 1 auto" : "0 0 auto",
              minWidth: narrow ? 0 : 160,
            }}
          >
            <option value="">Default (5 minutes)</option>
            <option value="60s">1 minute</option>
            <option value="5m">5 minutes</option>
            <option value="10m">10 minutes</option>
            <option value="never">Never</option>
          </select>
        </div>
        <span style={sourceStyle}>{source(settings.dialogExpiry !== undefined)}</span>
      </div>
      <span style={{ ...meta, padding: "0 6px 2px", whiteSpace: "normal" }}>
        A question left unanswered continues with whatever is selected so far; a permission prompt
        left unanswered is cancelled. At the question default, an unattended session waits forever.
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>Bash output</span>
        <div style={controlStyle}>
          <input
            key={file.mtime}
            type="number"
            min={OUTPUT_MIN}
            max={OUTPUT_MAX}
            step="1000"
            defaultValue={settings.bashOutputMaxChars ?? ""}
            disabled={busy}
            placeholder="Claude Code default"
            aria-label="Characters of bash output Claude receives"
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const typed = e.target.value.trim();
              const next = typed === "" ? undefined : Number(typed);
              if (next !== settings.bashOutputMaxChars) void write("bashOutputMaxChars", next);
            }}
            style={{ ...inputStyle, maxWidth: narrow ? "100%" : 140 }}
          />
          <span style={{ ...meta }}>characters</span>
        </div>
        <span style={sourceStyle}>{source(settings.bashOutputMaxChars !== undefined)}</span>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Task output</span>
        <div style={controlStyle}>
          <input
            key={file.mtime}
            type="number"
            min={OUTPUT_MIN}
            max={OUTPUT_MAX}
            step="1000"
            defaultValue={settings.taskOutputMaxChars ?? ""}
            disabled={busy}
            placeholder="Claude Code default"
            aria-label="Characters of subagent output Claude receives"
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const typed = e.target.value.trim();
              const next = typed === "" ? undefined : Number(typed);
              if (next !== settings.taskOutputMaxChars) void write("taskOutputMaxChars", next);
            }}
            style={{ ...inputStyle, maxWidth: narrow ? "100%" : 140 }}
          />
          <span style={{ ...meta }}>characters</span>
        </div>
        <span style={sourceStyle}>{source(settings.taskOutputMaxChars !== undefined)}</span>
      </div>
      <span style={{ ...meta, padding: "0 6px 2px", whiteSpace: "normal" }}>
        These two size what Claude receives, between {OUTPUT_MIN} and {OUTPUT_MAX} characters. The
        plugin's own tool text limit sizes only what this panel draws.
      </span>

      <div style={rowStyle}>
        <span style={labelStyle}>Attribution</span>
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
            <span style={{ fontSize: 12 }}>No AI trailers</span>
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
            {showTrailers ? "Hide custom text" : "Custom text"}
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
              ["attribution.commit", "Commit trailer", "Text Claude adds to commits it writes"],
              ["attribution.pr", "PR text", "Text Claude adds to pull request descriptions"],
            ] as const
          ).map(([key, label, hint]) => (
            <div key={key} style={rowStyle}>
              <span style={labelStyle}>{label}</span>
              <div style={{ ...controlStyle, flex: "1 1 auto" }}>
                <input
                  key={`${key}-${file.mtime}`}
                  type="text"
                  defaultValue={settings[key] ?? ""}
                  disabled={busy}
                  placeholder="Claude Code default"
                  aria-label={hint}
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
          <span style={{ ...meta, padding: "0 6px 2px", whiteSpace: "normal" }}>
            An empty box writes an empty string, which is how the CLI is told to add nothing. Clear
            the switch above to hand both back to Claude Code's own wording.
          </span>
        </>
      ) : null}

      <PermissionsBlock
        file={file}
        apply={apply}
        sessionId={sessionId}
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
 */
function PermissionsBlock({
  file,
  apply,
  sessionId,
  narrow,
  busy,
}: {
  file: SettingsFile;
  apply: Apply;
  sessionId: string;
  narrow: boolean;
  busy: boolean;
}) {
  const [kind, setKind] = useState<PermissionKind>("allow");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [asks, setAsks] = useState<string[]>([]);
  const rules = readPermissionRules(file.text);

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
    padding: "4px 4px",
    fontSize: 13,
    color: T.text,
  };
  const small: CSSProperties = {
    padding: "2px 8px",
    fontSize: 12,
    background: "transparent",
    color: T.text,
    border: `1px solid ${T.border}`,
    borderRadius: 3,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1,
  };

  return (
    <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 16, paddingTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 }}>
        Permissions
      </div>
      <span style={{ ...meta, padding: "0 4px 8px", whiteSpace: "normal" }}>
        Rules Claude Code answers a tool request with instead of asking. They apply wherever this
        settings.json is read, in dsh or in a terminal.
      </span>
      {error ? (
        <span style={{ color: T.err, fontSize: 12, padding: "0 4px", display: "block" }}>
          {error}
        </span>
      ) : null}

      {PERMISSION_KINDS.filter((k) => rules[k].length > 0).map((k) => (
        <div key={k} style={{ marginBottom: 8 }}>
          <div style={heading}>{k}</div>
          {rules[k].map((rule) => (
            <div key={rule} style={ruleRow}>
              <span style={{ flex: 1, wordBreak: "break-all", fontFamily: T.mono }}>{rule}</span>
              <button
                type="button"
                aria-label={`Remove ${rule}`}
                onClick={() => void change("remove", k, rule)}
                disabled={busy}
                style={small}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ))}

      {unused.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <div style={heading}>Asked about this session</div>
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
          aria-label="Rule kind"
          onChange={(e) => {
            // SAFETY: the options are the three kinds, so the value is one of them.
            setKind(e.target.value as PermissionKind);
          }}
          disabled={busy}
          style={{ ...select, flex: "0 0 auto", minWidth: 90, textTransform: "capitalize" }}
        >
          {PERMISSION_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={draft}
          aria-label="Rule"
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
          Add
        </button>
      </div>
    </div>
  );
}
