// The Shortcuts group of the Settings card: the composer gestures borrowed from the Claude Code
// terminal, one switch each, with each description opening on the keys it takes. They sit
// together so the card has one place that says what the keyboard does, and dsh's own Keyboard
// shortcuts dialog lists the same rows (`shortcut-rows.ts`).
import { t, useLocale, type OmcKey } from "./i18n.js";
import { useHintFlag } from "./hints.js";
import { RecallSwitch } from "./settings-card.js";
import { Switch } from "./switch.js";
import { T } from "./shared.js";

/** One feature's row: a title, a description that names the keys, and a switch inverted over its
 *  `…Off` hint so a box with no hint reads as on, the way the terminal's keys are always there. */
function ShortcutRow({
  hint,
  title,
  desc,
  hook,
}: {
  hint: string;
  title: OmcKey;
  desc: OmcKey;
  hook: string;
}) {
  const [off, setOff] = useHintFlag(hint);
  return (
    <div
      {...{ [hook]: "" }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t(title)}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t(desc)}</div>
      </div>
      <Switch on={!off} onChange={(on) => setOff(!on)} label={t(title)} />
    </div>
  );
}

/** The group: a heading, then prompt recall, history search and edit last prompt. */
export function ShortcutSwitches() {
  useLocale();
  return (
    <fieldset
      data-omc-shortcut-switches=""
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      <legend style={{ padding: 0, fontSize: 13, marginBottom: 8 }}>
        <div>{t("main.settingsUi.shortcutsTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.shortcutsDesc")}</div>
      </legend>
      <RecallSwitch />
      <ShortcutRow
        hint="historySearchOff"
        title="main.settingsUi.historyTitle"
        desc="main.settingsUi.historyDesc"
        hook="data-omc-history-switch"
      />
      <ShortcutRow
        hint="editLastOff"
        title="main.settingsUi.editLastTitle"
        desc="main.settingsUi.editLastDesc"
        hook="data-omc-edit-last-switch"
      />
    </fieldset>
  );
}
