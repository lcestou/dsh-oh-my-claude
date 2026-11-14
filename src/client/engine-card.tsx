// The Settings card for engine mode: which agent presets ("modes" in dsh's own words) run Claude
// Code as dsh's model engine, and which of engine mode's changes apply. Box-wide, in the hints
// store, under the keys `src/adapter/engine-mode.ts` reads on every turn.
import { useEffect, useState } from "react";
import { t, useLocale } from "./i18n.js";
import { ROUTE, T, nested, readJson } from "./shared.js";
import { HINTS_EVENT, loadHints, useHintFlag } from "./hints.js";
import { Switch } from "./switch.js";
import {
  ENGINE_ON_KEY,
  ENGINE_OPTIONS,
  ENGINE_PRESET_PREFIX,
  engineSkipKey,
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

/** One preset's checkbox; ticked means sessions started in that mode run Claude as dsh's engine.
 *  A ticked mode shows its own folded "What it changes" set right under it. */
function PresetBox({ preset }: { preset: PresetRow }) {
  const [on, setOn] = useHintFlag(ENGINE_PRESET_PREFIX + preset.id);
  const name = builtInName(preset.id) ?? preset.name;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
      {on && (
        <details data-omc-engine-options={preset.id} style={{ ...nested, marginLeft: 24 }}>
          <summary style={{ cursor: "pointer", color: T.muted, fontSize: 12 }}>
            {t("main.settingsUi.engineOptions")}
          </summary>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0 16px" }}
          >
            {ENGINE_OPTIONS.map((o) => (
              <OptionBox key={o} option={o} preset={preset.id} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** One engine option's checkbox for one mode; ticked means it applies, which is the default (the
 *  hints store holds a skip flag, so a newly ticked mode gets the whole bundle). */
function OptionBox({ option, preset }: { option: EngineOption; preset: string }) {
  const [skip, setSkip] = useHintFlag(engineSkipKey(option, preset));
  const [label, hint] = OPTION_TEXT[option];
  return (
    <label style={{ ...ROW, alignItems: "flex-start" }}>
      <input
        type="checkbox"
        data-omc-engine-option={`${preset}:${option}`}
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

/** The preset ids ticked in the hints store, kept current through `HINTS_EVENT`, which also
 *  carries a tick made in another tab; empty until the first read lands. */
function useTickedPresets(): Set<string> {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    /** Re-reads the store and keeps the ids whose `enginePreset:` key is on. */
    const read = (): void =>
      void loadHints().then((h) => {
        if (!live) return;
        const ids = Object.keys(h)
          .filter((k) => k.startsWith(ENGINE_PRESET_PREFIX) && h[k] === true)
          .map((k) => k.slice(ENGINE_PRESET_PREFIX.length));
        setTicked(new Set(ids));
      });
    read();
    window.addEventListener(HINTS_EVENT, read);
    return () => {
      live = false;
      window.removeEventListener(HINTS_EVENT, read);
    };
  }, []);
  return ticked;
}

/**
 * The engine-mode card: a master switch, off by default, and under it, only while it is on, the
 * presets folded under one line that names the ticked ones, each with a tick. The preset list is
 * read on mount and again each time the fold opens: dsh applies a profile edit that adds, renames
 * or drops a preset live, with no restart and nothing sent to the page, so a list read once would
 * go stale under an open Settings. A preset that is gone drops off the list and the summary; its
 * tick stays in the store, so a preset that comes back under the same id is in engine mode again.
 * The ticks are hints-store flags and follow a change made in another tab. Undefined presets (the
 * read failed, or this dsh has no preset service) show a one-line note.
 */
export function EngineModeCard() {
  useLocale();
  const [presets, setPresets] = useState<PresetRow[] | undefined>();
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/presets`)
      .then((r) => readJson<{ presets?: PresetRow[] }>(r))
      .then((r) => live && setPresets(r.presets ?? []))
      .catch(() => live && setPresets([]));
    return () => {
      live = false;
    };
  }, [reads]);
  const [on, setOn] = useHintFlag(ENGINE_ON_KEY);
  const ticked = useTickedPresets();
  const tickedNames = (presets ?? [])
    .filter((p) => ticked.has(p.id))
    .map((p) => builtInName(p.id) ?? p.name);
  return (
    <>
      <div
        data-omc-engine=""
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
          <div>{t("main.settingsUi.engineTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.engineDesc")}</div>
        </div>
        <Switch on={on} onChange={setOn} label={t("main.settingsUi.engineTitle")} />
      </div>
      {on && (
        <details
          data-omc-engine-modes=""
          onToggle={(e) => e.currentTarget.open && setReads((n) => n + 1)}
          style={{ ...nested, margin: "0 0 12px", fontSize: 13 }}
        >
          <summary style={{ cursor: "pointer", color: T.muted }}>
            {tickedNames.length > 0
              ? t("main.settingsUi.engineModesOn", {
                  names: tickedNames.join(t("main.settingsUi.engineModesJoin")),
                })
              : t("main.settingsUi.engineModesNone")}
          </summary>
          <fieldset
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              border: 0,
              margin: 0,
              padding: "8px 0 0 16px",
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
        </details>
      )}
    </>
  );
}
