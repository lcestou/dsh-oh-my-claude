// The Models block's line about where a box's Claude Code traffic goes, and the one switch that
// goes with it. The server decides the state (`Route` in src/adapter/routing.ts) and which rows
// the picker leaves out because of it; this file only says so in words.
import { useHintFlag } from "./hints.js";
import { t, useLocale } from "./i18n.js";
import { T } from "./shared.js";
import { Switch } from "./switch.js";

/** A box's route as `GET /models?all=1` sends it. Absent from a server older than this client:
 *  the client hot-reloads, the server waits for a restart. */
export interface BoxRoute {
  state: "direct" | "routed" | "unknown";
  host?: string;
}

/** The note a row carries when the picker leaves it out because of the route, by state: on a box
 *  that talks to Anthropic it is a model waiting for a router, on a routed box it is one of
 *  Claude's own set aside. `unknown` hides nothing, so it has no note. */
export const routeNote = (route: BoxRoute | undefined): string =>
  route?.state === "direct"
    ? t("main.settingsUi.modelOffDirect")
    : route?.state === "routed"
      ? t("main.settingsUi.modelOffRouted")
      : "";

/**
 * One box's line: which state it is in, in a sentence, when there is something to explain. A
 * routed box always gets one. A box talking to Anthropic gets one only while it has rows waiting
 * for a router (`waiting`), since otherwise nothing on screen needs explaining. A routed box
 * whose router renamed the aliases also gets the switch that keeps Claude's own rows listed
 * (`routedClaude:<provider>`, box-wide like every hint): shown while rows are set aside or the
 * switch is on, so it can be turned back off. The line is announced when it changes, which is
 * what happens when a router is switched on or off while Settings is open.
 */
export function RouteLine({
  provider,
  route,
  waiting,
}: {
  provider: string;
  route: BoxRoute | undefined;
  waiting: number;
}) {
  useLocale();
  const [claudeToo, setClaudeToo] = useHintFlag(`routedClaude:${provider}`);
  const host = route?.host ?? "";
  const routed = route?.state === "routed";
  const aside = routed && (waiting > 0 || claudeToo);
  const text = routed
    ? t(aside ? "main.settingsUi.routeRoutedNamed" : "main.settingsUi.routeRoutedPlain", { host })
    : route?.state === "direct" && waiting > 0
      ? t("main.settingsUi.routeDirectWaiting")
      : "";
  return (
    <div data-omc-route-line={route?.state ?? "unknown"} style={{ marginBottom: text ? 10 : 0 }}>
      <div aria-live="polite" style={{ color: T.muted, fontSize: 12 }}>
        {text}
      </div>
      {aside && (
        <div
          data-omc-route-claude-too=""
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 8,
            fontSize: 13,
          }}
        >
          <div>
            <div>{t("main.settingsUi.routeClaudeToo")}</div>
            <div style={{ color: T.faint, fontSize: 12 }}>
              {t("main.settingsUi.routeClaudeTooDesc")}
            </div>
          </div>
          <Switch
            on={claudeToo}
            onChange={setClaudeToo}
            label={t("main.settingsUi.routeClaudeToo")}
          />
        </div>
      )}
    </div>
  );
}
