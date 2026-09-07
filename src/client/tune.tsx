import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { bodyFlow, meta, T, readJson, ROUTE, inputStyle, select, useNarrow } from "./shared.js";
import {
  PERMISSION_KINDS,
  readPermissionRules,
  setPermissionRule,
  type PermissionKind,
} from "../permissions.js";

/** The settings.json keys this tab owns. Everything else in the file is left untouched. */
interface Tunables {
  outputStyle?: string;
  alwaysThinkingEnabled?: boolean;
  showThinkingSummaries?: boolean;
  autoCompactWindow?: number;
  promptCacheTtl?: string;
  subagentPromptCacheTtl?: string;
}
type TuneKey = keyof Tunables;
/** A settings document as this tab handles it: every key open, since it edits six and keeps the rest. */
type SettingsValue = string | number | boolean | null | undefined;
type Settings = { [key: string]: SettingsValue };
/** The CLI's own pair of cache TTLs; anything else is not a value its resolver understands. */
const cacheTtl = (value: SettingsValue) => (value === "5m" || value === "1h" ? value : undefined);
const isCacheTtlKey = (key: TuneKey) =>
  key === "promptCacheTtl" || key === "subagentPromptCacheTtl";

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
  if (value === undefined) delete obj[key];
  else obj[key] = value;
  // Two spaces and a trailing newline: how Claude Code writes the file itself.
  return { text: `${JSON.stringify(obj, null, 2)}\n` };
}

/** Read the six keys out of the file; anything of the wrong type reads as unset. */
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
  return out;
}

/** settings.json as the route reports it. */
interface SettingsFile {
  path: string;
  exists: boolean;
  text: string;
  mtime: number;
}

const read = () => fetch(`${ROUTE}/settings`).then((r) => readJson<SettingsFile>(r));

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

export function TuneBody({ sessionId }: { sessionId: string }): React.ReactElement {
  const narrow = useNarrow();
  const [file, setFile] = useState<SettingsFile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    read().then(
      (f) => live && setFile(f),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, []);

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
      const fresh = await read();
      if (fresh.mtime !== file.mtime) {
        setFile(fresh);
        return "settings.json changed on disk; the tab now shows the new values, try again";
      }
      const next = mutate(fresh.text);
      if (next.error !== undefined) return next.error;
      setFile(
        await readJson<SettingsFile>(
          await fetch(`${ROUTE}/settings`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: next.text }),
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

  const write = async (key: TuneKey, value: string | number | boolean | undefined) => {
    const failure = await apply((text) => updateSettings(text, key, value));
    if (failure) setError(failure);
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
