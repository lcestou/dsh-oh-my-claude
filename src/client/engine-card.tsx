// The Settings card for engine mode: which agent presets ("modes" in dsh's own words) run Claude
// Code as dsh's model engine, and which of engine mode's changes apply. Box-wide, in the hints
// store, under the keys `src/adapter/engine-mode.ts` reads on every turn.
import { useEffect, useState } from "react";
import { t, useLocale } from "./i18n.js";
import { ROUTE, T, nested, readJson } from "./shared.js";
import { useHintFlag } from "./hints.js";
import {
  ENGINE_OPTIONS,
  ENGINE_PRESET_PREFIX,
  ENGINE_SKIP_PREFIX,
  type EngineOption,
} from "../adapter/engine-mode.js";

/** One preset as the `/presets` route lists it. */
interface PresetRow {
  id: string;
  name: string;
}

/** Each engine option's label and hint, in the order Settings lists them. */
const OPTION_TEXT = {
  systemPrompt: [
    "main.settingsUi.engineOptSystemPrompt",
    "main.settingsUi.engineOptSystemPromptHint",
  ],
  builtinTools: [
    "main.settingsUi.engineOptBuiltinTools",
    "main.settingsUi.engineOptBuiltinToolsHint",
  ],
  toolLoading: ["main.settingsUi.engineOptToolLoading", "main.settingsUi.engineOptToolLoadingHint"],
  followToolSet: [
    "main.settingsUi.engineOptFollowToolSet",
    "main.settingsUi.engineOptFollowToolSetHint",
  ],
  verbatimPrompts: [
    "main.settingsUi.engineOptVerbatimPrompts",
    "main.settingsUi.engineOptVerbatimPromptsHint",
  ],
  isolate: ["main.settingsUi.engineOptIsolate", "main.settingsUi.engineOptIsolateHint"],
  thinkingDisplay: ["main.settingsUi.engineOptThinking", "main.settingsUi.engineOptThinkingHint"],
} as const satisfies Record<EngineOption, readonly [string, string]>;

/** A checkbox row: a label, and a fainter hint after it. */
const ROW = { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } as const;

/** dsh's own name for one of its built-in modes, which its registry lists by id alone; undefined
 *  for any other preset, which carries the name it was declared with. */
function builtInName(id: string): string | undefined {
  if (id === "standard") return t("main.settingsUi.engineModeStandard");
  if (id === "ptc") return t("main.settingsUi.engineModePtc");
  if (id === "minimal") return t("main.settingsUi.engineModeMinimal");
  if (id === "cordis") return t("main.settingsUi.engineModeCreator");
  return undefined;
}

/** One preset's checkbox; ticked means sessions started in that mode run Claude as dsh's engine. */
function PresetBox({ preset }: { preset: PresetRow }) {
  const [on, setOn] = useHintFlag(ENGINE_PRESET_PREFIX + preset.id);
  const name = builtInName(preset.id) ?? preset.name;
  return (
    <label style={ROW}>
      <input
        type="checkbox"
        data-omc-engine-preset={preset.id}
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
      />
      {name}
      {name !== preset.id && <span style={{ color: T.faint, fontSize: 12 }}>{preset.id}</span>}
    </label>
  );
}

/** One engine option's checkbox; ticked means it applies, which is the default (the hints store
 *  holds a skip flag, so a fresh box gets the whole bundle). */
function OptionBox({ option }: { option: EngineOption }) {
  const [skip, setSkip] = useHintFlag(ENGINE_SKIP_PREFIX + option);
  const [label, hint] = OPTION_TEXT[option];
  return (
    <label style={{ ...ROW, alignItems: "flex-start" }}>
      <input
        type="checkbox"
        data-omc-engine-option={option}
        checked={!skip}
        onChange={(e) => setSkip(!e.target.checked)}
        style={{ marginTop: 2 }}
      />
      {/* The hint under the label, not beside it: beside, a phone-width card squeezed both into
          two narrow columns. */}
      <span style={{ display: "flex", flexDirection: "column" }}>
        {t(label)}
        <span style={{ color: T.faint, fontSize: 12 }}>{t(hint)}</span>
      </span>
    </label>
  );
}

/**
 * The engine-mode card. The preset list is read once per mount: presets change only when the dsh
 * profile is edited, which reloads the plugin, and Settings mounts the card afresh each time it
 * opens. The ticks are hints-store flags and follow a change made in another tab. Undefined
 * presets (the read failed, or this dsh has no preset service) show a one-line note.
 */
export function EngineModeCard() {
  useLocale();
  const [presets, setPresets] = useState<PresetRow[] | undefined>();
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/presets`)
      .then((r) => readJson<{ presets?: PresetRow[] }>(r))
      .then((r) => live && setPresets(r.presets ?? []))
      .catch(() => live && setPresets([]));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div data-omc-engine="" style={{ fontSize: 13, marginBottom: 12 }}>
      <div>{t("main.settingsUi.engineTitle")}</div>
      <div style={{ color: T.faint, fontSize: 12, marginBottom: 6 }}>
        {t("main.settingsUi.engineDesc")}
      </div>
      <fieldset
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          border: 0,
          margin: 0,
          padding: "0 0 0 16px",
        }}
      >
        <legend style={{ color: T.muted, fontSize: 12, padding: 0, marginBottom: 4 }}>
          {t("main.settingsUi.enginePresets")}
        </legend>
        {presets === undefined ? null : presets.length === 0 ? (
          <span style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.engineNoPresets")}
          </span>
        ) : (
          presets.map((p) => <PresetBox key={p.id} preset={p} />)
        )}
      </fieldset>
      <details data-omc-engine-options="" style={{ ...nested, marginTop: 8 }}>
        <summary style={{ cursor: "pointer", color: T.muted }}>
          {t("main.settingsUi.engineOptions")}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0 16px" }}>
          {ENGINE_OPTIONS.map((o) => (
            <OptionBox key={o} option={o} />
          ))}
        </div>
      </details>
    </div>
  );
}
