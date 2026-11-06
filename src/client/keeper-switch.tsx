// Settings → Oh My Claude: whether Claude Code runs under a keeper that outlives a dsh restart or
// as dsh's child that closes with it. The choice is the box-wide `keeperOff` hint (KEEPER_OFF in
// src/adapter/spawn-mode.ts); the server reads it once per turn, so a session switches on its next.
import { useEffect, useState } from "react";
import type { SpawnModeInfo } from "../adapter/spawn-mode.js";
import { useHintFlag } from "./hints.js";
import { t, useLocale } from "./i18n.js";
import { ROUTE, T, readJson } from "./shared.js";
import { Switch } from "./switch.js";

/**
 * The keeper switch. On, the default with the hint absent, keeps the keeper; off runs Claude
 * through dsh's subprocess seam. `spawn: node` or `spawn: dsh` in the plugin config wins over the
 * switch, so the switch is then disabled and names the configured mode (`spawn: keeper` is the old
 * default and locks nothing). Windows has no keeper: the switch still works there, between a plain
 * child (on) and the seam (off), and a note says so. The config facts are fetched once on mount:
 * they change only when dsh restarts, and a tab has to be reloaded after a restart anyway. The hint
 * follows other tabs through useHintFlag. A server without the route (an older plugin
 * mid-upgrade) leaves the switch unlocked.
 */
export function KeeperSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("keeperOff");
  // undefined until the facts arrive (the switch waits disabled, so a locked box never paints
  // unlocked); null when the route answered nothing usable.
  const [info, setInfo] = useState<SpawnModeInfo | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/spawn-mode`)
      .then((r) => readJson<SpawnModeInfo>(r))
      .then((b) => live && setInfo(b))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, []);
  const configured = info?.configured ?? null;
  const noKeeper = info !== undefined && info !== null && !info.keeper;
  // A configured mode is never the keeper, so a lock always shows off.
  const on = configured === null && !off;
  return (
    <div
      data-omc-keeper-switch=""
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
        <div>{t("main.settingsUi.keeperTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.keeperDesc")}</div>
        {configured && (
          <div data-omc-keeper-locked="" style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.keeperLocked", { mode: configured })}
          </div>
        )}
        {noKeeper && (
          <div data-omc-keeper-windows="" style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.keeperNoKeeper")}
          </div>
        )}
      </div>
      <Switch
        on={on}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.keeperTitle")}
        disabled={info === undefined || configured !== null}
      />
    </div>
  );
}
