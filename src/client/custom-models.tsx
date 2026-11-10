// The Models block's "Add a model" form, and the one request that stores a box's added models.
// The list lives on the box (a file under the plugin's state, through `PUT /custom-models`), so
// every browser sees it. An added model shows once, as a row of the block with its size and a
// Remove on it (`ModelRow` in settings-card.tsx); this file keeps no copy beyond the form's draft.
import { useRef, useState } from "react";
import { t, useLocale } from "./i18n.js";
import { OTHER, WINDOWS, windowLabel } from "./model-size.js";
import { ACCENT, btnPrimary, inputStyle, readJson, ROUTE, select, T } from "./shared.js";

/** One model added in Settings, as the server stores it and `GET /models?all=1` returns it. */
export interface CustomModelEntry {
  model: string;
  label?: string;
  contextWindow?: number;
  efforts?: string[];
}

/** Store `models` as the whole list of added models for the mount `provider` names. Rejects with
 *  the server's sentence when it refuses the list (a bad id, a duplicate), and nothing is
 *  written then. */
export const putCustomModels = (provider: string, models: CustomModelEntry[]): Promise<void> =>
  fetch(`${ROUTE}/custom-models`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, models }),
  })
    .then((r) => readJson<{ models?: CustomModelEntry[] }>(r))
    .then(() => undefined);

/** The router this feature was asked for, named the way the proxy row names Headroom. */
const CC_SWITCH_URL = "https://github.com/farion1231/cc-switch";

/** The form's text as an entry to send. The window is left out when the field is empty. Text that
 *  is not all digits goes as 0, a number the server refuses with the sentence about windows; sent
 *  as `Number("12k")` it would be NaN, which JSON turns into null and the server cannot place. */
const draftEntry = (id: string, name: string, tokens: string): CustomModelEntry => {
  const entry: CustomModelEntry = { model: id.trim() };
  if (name.trim() !== "") entry.label = name.trim();
  if (tokens.trim() !== "")
    entry.contextWindow = /^\d+$/.test(tokens.trim()) ? Number(tokens.trim()) : 0;
  return entry;
};

/**
 * The form that adds a model to one box. `saved` is the box's list as the server last returned
 * it; an add sends the whole next list and then calls `onSaved`, which re-reads the block, so
 * the new model appears among the rows above. A refused save (a bad id, a duplicate) shows the
 * server's sentence and keeps the draft.
 */
export function CustomModelsEditor({
  provider,
  saved,
  onSaved,
}: {
  provider: string;
  saved: CustomModelEntry[];
  onSaved: () => void;
}) {
  useLocale();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  // The dropdown's pick: empty for the default, one of WINDOWS as text, or OTHER, which shows
  // the field `tokens` is typed into.
  const [size, setSize] = useState("");
  const [tokens, setTokens] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const idField = useRef<HTMLInputElement>(null);
  /** Store `next` as this box's whole list; resolves true when the server took it. */
  const save = (next: CustomModelEntry[]): Promise<boolean> => {
    setBusy(true);
    setError("");
    setDone("");
    return putCustomModels(provider, next)
      .then(() => {
        onSaved();
        return true;
      })
      .catch((e: Error) => {
        setError(e.message);
        return false;
      })
      .finally(() => setBusy(false));
  };
  const add = () => {
    const entry = draftEntry(id, name, size === OTHER ? tokens : size);
    void save([...saved, entry]).then((ok) => {
      if (!ok) return;
      setDone(t("main.settingsUi.customDidAdd", { name: entry.label ?? entry.model }));
      setId("");
      setName("");
      setSize("");
      setTokens("");
      idField.current?.focus();
    });
  };
  const field = { display: "grid", gap: 4, fontSize: 12, color: T.muted } as const;
  return (
    <div data-omc-custom-models={provider} style={{ marginTop: 12 }}>
      <details data-omc-custom-models-add="">
        <summary style={{ cursor: "pointer", color: T.muted, fontSize: 13 }}>
          {t("main.settingsUi.customAddTitle")}
        </summary>
        <form
          style={{ display: "grid", gap: 8, padding: "8px 0 0 16px" }}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.customDescBefore")}
            <a
              data-omc-cc-switch-link=""
              href={CC_SWITCH_URL}
              target="_blank"
              rel="noreferrer"
              style={{ color: ACCENT }}
            >
              CC Switch
            </a>
            {t("main.settingsUi.customDescAfter")}
          </div>
          <label style={field}>
            {t("main.settingsUi.customId")}
            <input
              ref={idField}
              data-omc-custom-model-id=""
              style={{ ...inputStyle, flex: "none", fontFamily: "monospace" }}
              value={id}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setId(e.target.value)}
            />
          </label>
          <label style={field}>
            {t("main.settingsUi.customName")}
            <input
              data-omc-custom-model-name=""
              style={{ ...inputStyle, flex: "none" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label style={field}>
            {t("main.settingsUi.customWindow")}
            <select
              data-omc-custom-model-window=""
              style={{ ...select, flex: "none", maxWidth: "none" }}
              value={size}
              onChange={(e) => setSize(e.target.value)}
            >
              <option value="">{t("main.settingsUi.customWindowDefault")}</option>
              {WINDOWS.map((n) => (
                <option key={n} value={String(n)}>
                  {windowLabel(n)}
                </option>
              ))}
              <option value={OTHER}>{t("main.settingsUi.customWindowOther")}</option>
            </select>
          </label>
          {size === OTHER && (
            <label style={field}>
              {t("main.settingsUi.customWindowTokens")}
              <input
                data-omc-custom-model-tokens=""
                style={{ ...inputStyle, flex: "none" }}
                value={tokens}
                inputMode="numeric"
                onChange={(e) => setTokens(e.target.value)}
              />
            </label>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="submit"
              data-omc-custom-model-add=""
              style={btnPrimary}
              disabled={busy || id.trim() === ""}
            >
              {t("main.settingsUi.customAdd")}
            </button>
            {error && (
              <div role="alert" data-omc-custom-model-error="" style={{ fontSize: 12 }}>
                {error}
              </div>
            )}
          </div>
        </form>
      </details>
      <div aria-live="polite" style={{ color: T.faint, fontSize: 12, minHeight: 0 }}>
        {done}
      </div>
    </div>
  );
}
