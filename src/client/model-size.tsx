// The context-window picker a model's row carries in the Models block, for the rows whose size is
// the user's to say: a router's alias, and a model added in Settings. The same list of sizes
// feeds the Add a model form. Where a size is stored is the caller's business; this draws the
// control and hands back a number.
import { useEffect, useState } from "react";
import { t, useLocale } from "./i18n.js";
import { inputStyle, select } from "./shared.js";

/** The window sizes offered by name; anything else is typed under "Other". */
export const WINDOWS = [128_000, 200_000, 256_000, 512_000, 1_000_000] as const;
/** The dropdown's value for "type an exact number". */
export const OTHER = "other";
/** The smallest and largest window the server takes (`checkCustomModels`). */
const MIN_WINDOW = 1000;
const MAX_WINDOW = 10_000_000;

/** A window size the way people say it: 128000 is "128k", 262144 is "262k", 1000000 is "1M". */
export const windowLabel = (tokens: number): string =>
  tokens >= 1_000_000 && tokens % 100_000 === 0
    ? `${tokens / 1_000_000}M`
    : `${Math.round(tokens / 1000)}k`;

/** Whether a size is one of the named ones. */
const isNamed = (tokens: number): boolean => WINDOWS.some((n) => n === tokens);

/**
 * One row's size: a dropdown of the common windows, "Default" for none stated, and "Other" for an
 * exact number, which opens a field beside it. A pick is handed to `onChange` at once; a typed
 * number when the field is left or Enter is pressed, and only when it is a whole number the
 * server would take, so a half-typed figure is never saved. `value` undefined means no size is
 * stored and the row runs on the default. A stored size that is not one of the named ones opens
 * as "Other" with the number in the field, so 262,144 stays 262,144 and is not rounded to a
 * neighbour. `name` is the model's, for the control's accessible name.
 */
export function SizeSelect({
  name,
  value,
  disabled = false,
  onChange,
}: {
  name: string;
  value: number | undefined;
  disabled?: boolean;
  onChange: (next: number | undefined) => void;
}) {
  useLocale();
  const stored = value === undefined ? "" : isNamed(value) ? String(value) : OTHER;
  // "Other" is a state of the control before it is a stored value: picking it shows the field
  // and stores nothing until a number is typed.
  const [typing, setTyping] = useState(stored === OTHER);
  const [tokens, setTokens] = useState(value === undefined ? "" : String(value));
  // A value changed elsewhere (another tab, the form below) moves the control with it.
  useEffect(() => {
    setTyping(value !== undefined && !isNamed(value));
    setTokens(value === undefined ? "" : String(value));
  }, [value]);
  /** Hand the typed number on, when it is one the server would take and not what is stored. */
  const commit = () => {
    const n = /^\d+$/.test(tokens.trim()) ? Number(tokens.trim()) : Number.NaN;
    if (Number.isInteger(n) && n >= MIN_WINDOW && n <= MAX_WINDOW && n !== value) onChange(n);
  };
  return (
    <span data-omc-model-size="" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select
        data-omc-model-size-pick=""
        aria-label={t("main.settingsUi.modelSizeNamed", { name })}
        style={{ ...select, flex: "none", maxWidth: "none", fontSize: 12 }}
        value={typing ? OTHER : stored}
        disabled={disabled}
        onChange={(e) => {
          const pick = e.target.value;
          setTyping(pick === OTHER);
          if (pick === OTHER) return;
          onChange(pick === "" ? undefined : Number(pick));
        }}
      >
        <option value="">{t("main.settingsUi.customWindowDefault")}</option>
        {WINDOWS.map((n) => (
          <option key={n} value={String(n)}>
            {windowLabel(n)}
          </option>
        ))}
        <option value={OTHER}>{t("main.settingsUi.customWindowOther")}</option>
      </select>
      {typing && (
        <input
          data-omc-model-size-tokens=""
          aria-label={t("main.settingsUi.modelSizeTokensNamed", { name })}
          style={{ ...inputStyle, flex: "none", width: 96, fontSize: 12 }}
          value={tokens}
          inputMode="numeric"
          disabled={disabled}
          onChange={(e) => setTokens(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      )}
    </span>
  );
}
