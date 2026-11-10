// The Models block's "Add a model" part: the models a person added for one box, each with a
// Remove, and the form that adds one. The list lives on the box (a file under the plugin's state,
// through `PUT /custom-models`), so every browser sees it; this file keeps no copy of its own
// beyond the form's draft.
import { useRef, useState } from "react";
import { t, useLocale } from "./i18n.js";
import { ACCENT, btn, btnPrimary, inputStyle, readJson, ROUTE, T } from "./shared.js";

/** One model added in Settings, as the server stores it and `GET /models?all=1` returns it. */
export interface CustomModelEntry {
  model: string;
  label?: string;
  contextWindow?: number;
  efforts?: string[];
}

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
 * The added models of one box and the form that adds another. `saved` is the box's list as the
 * server last returned it; every change sends the whole next list and then calls `onSaved`, which
 * re-reads the block, so the rows above and this list never disagree about what is stored. A
 * refused save (a bad id, a duplicate) shows the server's sentence and keeps the draft.
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
  const [tokens, setTokens] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const idField = useRef<HTMLInputElement>(null);
  const fold = useRef<HTMLElement>(null);
  /** Store `next` as this box's whole list; resolves true when the server took it. */
  const save = (next: CustomModelEntry[]): Promise<boolean> => {
    setBusy(true);
    setError("");
    setDone("");
    return fetch(`${ROUTE}/custom-models`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, models: next }),
    })
      .then((r) => readJson<{ models?: CustomModelEntry[] }>(r))
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
    const entry = draftEntry(id, name, tokens);
    void save([...saved, entry]).then((ok) => {
      if (!ok) return;
      setDone(t("main.settingsUi.customDidAdd", { name: entry.label ?? entry.model }));
      setId("");
      setName("");
      setTokens("");
      idField.current?.focus();
    });
  };
  const remove = (entry: CustomModelEntry) => {
    void save(saved.filter((m) => m.model !== entry.model)).then((ok) => {
      if (!ok) return;
      setDone(t("main.settingsUi.customDidRemove", { name: entry.label ?? entry.model }));
      // The button that had focus is gone with its row; the fold's summary is the nearest thing
      // that stays, so the keyboard does not fall back to the top of the page.
      fold.current?.focus();
    });
  };
  const field = { display: "grid", gap: 4, fontSize: 12, color: T.muted } as const;
  return (
    <div data-omc-custom-models={provider} style={{ marginTop: 12 }}>
      {saved.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          <div style={{ color: T.muted, fontSize: 12 }}>{t("main.settingsUi.customAdded")}</div>
          {saved.map((m) => (
            <div
              key={m.model}
              data-omc-custom-model={m.model}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div>{m.label ?? m.model}</div>
                <div style={{ color: T.faint, fontSize: 11, fontFamily: "monospace" }}>
                  {m.model}
                </div>
              </div>
              <button
                type="button"
                data-omc-custom-model-remove=""
                style={btn}
                disabled={busy}
                aria-label={t("main.settingsUi.customRemoveNamed", { name: m.label ?? m.model })}
                onClick={() => remove(m)}
              >
                {t("main.settingsUi.customRemove")}
              </button>
            </div>
          ))}
        </div>
      )}
      <details data-omc-custom-models-add="">
        <summary ref={fold} style={{ cursor: "pointer", color: T.muted, fontSize: 13 }}>
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
            <input
              data-omc-custom-model-window=""
              style={{ ...inputStyle, flex: "none" }}
              value={tokens}
              inputMode="numeric"
              onChange={(e) => setTokens(e.target.value)}
            />
          </label>
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
