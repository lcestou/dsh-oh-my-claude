import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { bodyFlow, meta, T, readJson, ROUTE, inputStyle, select, useNarrow } from "./shared.js";

/** The settings.json keys this tab owns. Everything else in the file is left untouched. */
interface Tunables {
  outputStyle?: string;
  alwaysThinkingEnabled?: boolean;
  showThinkingSummaries?: boolean;
  autoCompactWindow?: number;
}
type TuneKey = keyof Tunables;
/** A settings document as this tab handles it: every key open, since it edits four and keeps the rest. */
type Settings = { [key: string]: string | number | boolean | null | undefined };

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

/** Read the four keys out of the file; anything of the wrong type reads as unset. */
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
export function TuneBody(): React.ReactElement {
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

  const write = async (key: TuneKey, value: string | number | boolean | undefined) => {
    setBusy(true);
    setError("");
    try {
      // Re-read first: another tab, the CLI or an editor may have written since this render.
      const fresh = await read();
      if (fresh.mtime !== file.mtime) {
        setFile(fresh);
        setError("settings.json changed on disk; the tab now shows the new values, try again");
        return;
      }
      const next = updateSettings(fresh.text, key, value);
      if (next.error !== undefined) {
        setError(next.error);
        return;
      }
      setFile(
        await readJson<SettingsFile>(
          await fetch(`${ROUTE}/settings`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: next.text }),
          }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
    </div>
  );
}
