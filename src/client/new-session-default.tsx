// The model and effort a new Claude session opens on. Two sources feed it: what the workspace last
// ran (the "Remember model per workspace" memory) and a box-wide default set here. The choice
// between them is a pure function so the order can be tested without a browser; the Settings row
// that writes the default lives beside it.
import { useEffect, useState } from "react";
import { t, useLocale } from "./i18n.js";
import { ROUTE, T, readJson, select } from "./shared.js";
import { HINTS_EVENT } from "./hints.js";
import { subscribe } from "./events.js";
import { BOXES_EVENT } from "./picker.js";

/** The efforts the CLI knows, lowest first; the same ladder the adapter caps per model. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** What the workspace memory answers for one workspace. */
export interface RememberedModel {
  model: string;
  provider?: string;
  effort?: string;
}

/** The box-wide default, as `/new-session-default` answers it. */
export interface SessionDefault {
  provider: string;
  model: string;
  effort?: string;
  /** Also pull a blank in a workspace that has never run Claude onto Claude. */
  all?: boolean;
}

/** One selection for dsh's model picker. */
export interface BlankTarget {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** The provider when it is a Claude mount, else undefined. */
const claude = (p: string | undefined) => (p?.startsWith("claude-code") === true ? p : undefined);

/** A selection with the effort only when there is one, so "model default" stays absent. */
const withEffort = (provider: string, model: string, effort: string | undefined): BlankTarget =>
  effort ? { provider, model, reasoningEffort: effort } : { provider, model };

/**
 * What a blank session should be switched to, or undefined to leave it as dsh made it. In order:
 * the workspace memory when it has a row; then the box default, on the box it names; else nothing.
 * `current` is the session's Claude mount when it is already Claude, and `picked` a provider
 * someone chose for this blank by hand. A hand pick of another provider always wins, and a blank that is not Claude is
 * only pulled onto Claude by the memory (it ran Claude here before) or by a default marked `all`.
 */
export function blankSessionTarget(args: {
  current: string | undefined;
  picked: string | undefined;
  saved: RememberedModel | undefined;
  def: SessionDefault | undefined;
}): BlankTarget | undefined {
  const { current, picked, saved, def } = args;
  // A provider picked by hand decides the mount: a Claude one is used as it is, any other leaves
  // the blank alone. `current` is read when the component mounts and `picked` just before the
  // apply, so a box chosen in between must not lose to the mount the blank started on.
  if (picked) {
    const mount = claude(picked);
    const model = saved?.model ?? def?.model;
    if (!mount || !model) return undefined;
    return withEffort(mount, model, saved ? saved.effort : def?.effort);
  }
  if (saved) {
    const provider = current ?? claude(saved.provider);
    return provider ? withEffort(provider, saved.model, saved.effort) : undefined;
  }
  if (def) {
    // The default names its box on purpose (the dropdown is grouped by box), so a blank that is
    // already Claude moves to that box. Opening it on the blank's own mount put a box's model id
    // on the local CLI, which may not list it.
    const provider = current
      ? (claude(def.provider) ?? current)
      : def.all
        ? claude(def.provider)
        : undefined;
    return provider ? withEffort(provider, def.model, def.effort) : undefined;
  }
  return undefined;
}

/** The box default, or undefined for none or a read that failed. */
export const loadSessionDefault = (): Promise<SessionDefault | undefined> =>
  fetch(`${ROUTE}/new-session-default`)
    .then((r) => readJson<Partial<SessionDefault>>(r))
    .then((d) =>
      // SAFETY: provider and model were just checked; effort and all are optional on the type
      d.provider && d.model ? (d as SessionDefault) : undefined,
    )
    .catch(() => undefined);

type PickerModel = { id: string; name: string; hidden: boolean };
type PickerBox = { provider: string; host: string | null; models: PickerModel[] };

/** Settings → Oh My Claude: the model and effort a new Claude session opens on where its
 *  workspace remembers none, plus the checkbox that also applies it to workspaces that never ran
 *  Claude. Empty by default, which leaves dsh's own default and the workspace memory as they were.
 *  Writes on each change; a failed write puts the error under the row and keeps the old value. */
export function NewSessionDefaultRow() {
  useLocale();
  const [boxes, setBoxes] = useState<PickerBox[]>([]);
  const [value, setValue] = useState<SessionDefault | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void loadSessionDefault().then((d) => live && setValue(d));
    // Only the newest read lands: two switches flipped in quick succession start two reads, and
    // the older answer arriving last would put back the lineup from before the second flip.
    let latest = 0;
    const loadModels = () => {
      const mine = ++latest;
      return fetch(`${ROUTE}/models?all=1`)
        .then((r) => readJson<{ models?: PickerBox[] }>(r))
        .then((b) => live && mine === latest && setBoxes(b.models ?? []))
        .catch(() => {});
    };
    void loadModels();
    // A model switched off or on in the Models block, and a box added or removed in the Boxes
    // card, change this list. Read once at mount, the dropdown kept the old lineup until Settings
    // was reopened (owner, 2026-11-04). The hints event fires after the hint is saved, so the
    // re-read sees the new hidden state.
    window.addEventListener(HINTS_EVENT, loadModels);
    window.addEventListener(BOXES_EVENT, loadModels);
    // A default saved from another tab or browser: take it, so a later change here does not
    // write back the model that tab replaced.
    const offDefault = subscribe("new-session-default", (_session, d) => {
      if (live)
        setValue(
          d.provider && d.model
            ? { provider: d.provider, model: d.model, effort: d.effort, all: d.all }
            : undefined,
        );
    });
    return () => {
      live = false;
      offDefault();
      window.removeEventListener(HINTS_EVENT, loadModels);
      window.removeEventListener(BOXES_EVENT, loadModels);
    };
  }, []);
  const save = (next: SessionDefault | undefined) => {
    setError("");
    fetch(`${ROUTE}/new-session-default`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next ?? {}),
    })
      .then(async (r) => {
        // The route's refusal text is English and for logs; the row says it in the UI's language.
        if (!r.ok) throw new Error(String(r.status));
        setValue(next);
      })
      .catch(() => setError(t("main.settingsUi.newDefaultSaveFailed")));
  };
  const key = value ? `${value.provider}\n${value.model}` : "";
  const many = boxes.length > 1;
  return (
    <div data-omc-new-session-default="" style={{ fontSize: 13, marginBottom: 12 }}>
      <div>{t("main.settingsUi.newDefaultTitle")}</div>
      <div style={{ color: T.faint, fontSize: 12, marginBottom: 6 }}>
        {t("main.settingsUi.newDefaultDesc")}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select
          aria-label={t("main.settingsUi.newDefaultModel")}
          data-omc-new-session-model=""
          value={key}
          style={select}
          onChange={(e) => {
            const [provider, model] = e.target.value.split("\n");
            save(
              provider && model
                ? { provider, model, effort: value?.effort, all: value?.all }
                : undefined,
            );
          }}
        >
          <option value="">{t("main.settingsUi.newDefaultNone")}</option>
          {/* A stored default whose box is no longer listed (removed, or not answering) still
              shows, so the row never reads "No default" over a default that applies. */}
          {value && !boxes.some((b) => b.provider === value.provider) ? (
            <option value={key}>{value.model}</option>
          ) : null}
          {boxes.map((box) => {
            // A hidden model stays listed while it is the stored default, so the row shows what is
            // in effect instead of reading "No default" over a default that still applies.
            const rows = box.models
              .filter((m) => !m.hidden || `${box.provider}\n${m.id}` === key)
              .map((m) => (
                <option key={`${box.provider}\n${m.id}`} value={`${box.provider}\n${m.id}`}>
                  {m.name}
                </option>
              ));
            return many ? (
              <optgroup key={box.provider} label={box.host ?? t("main.settingsUi.newDefaultLocal")}>
                {rows}
              </optgroup>
            ) : (
              rows
            );
          })}
        </select>
        <select
          aria-label={t("main.settingsUi.newDefaultEffort")}
          data-omc-new-session-effort=""
          value={value?.effort ?? ""}
          disabled={!value}
          style={select}
          onChange={(e) => value && save({ ...value, effort: e.target.value || undefined })}
        >
          <option value="">{t("main.settingsUi.newDefaultEffortModel")}</option>
          {EFFORTS.map((eff) => (
            <option key={eff} value={eff}>
              {t(`main.settingsUi.effort.${eff}`)}
            </option>
          ))}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            data-omc-new-session-all=""
            checked={value?.all === true}
            disabled={!value}
            onChange={(e) => value && save({ ...value, all: e.target.checked || undefined })}
          />
          {t("main.settingsUi.newDefaultAll")}
        </label>
      </div>
      {error ? (
        <div role="alert" style={{ color: T.err, fontSize: 12, marginTop: 4 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
