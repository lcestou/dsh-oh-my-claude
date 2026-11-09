// The "<version> available" pill: the one thing about the plugin itself the panel points at.
// Neither npm nor dsh says when a plugin has moved on, so the pill does, wherever the plugin's
// own name is on screen: beside the Oh My Claude heading in Settings and on the panel's Runtime
// line. Where dsh offers navigation to its Plugins page, a click opens this plugin's page there,
// whose Update button installs the release with dsh's own checks; a copy button beside it keeps the
// CLI command one click away. Without that navigation the pill copies the command, as it always
// did. The server reads the registry once a day; the pill never fetches npm itself.
import { useEffect, useState } from "react";
import { ACCENT, pill, readJson, T } from "./shared.js";
import { REPO_URL } from "../stars.js";
import { t, useLocale } from "./i18n.js";
import { usePluginsPage } from "./plugins-page.js";

const ROUTE = "/dsh-oh-my-claude";

/** An arrow onto a shelf: the upgrade glyph, drawn at the pill's stroke and colour. */
function UpgradeGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 8.2V2.4M2.4 5 5 2.4 7.6 5" />
      <path d="M1.6 1.2h6.8" />
    </svg>
  );
}

/** Two offset sheets, or a tick once the copy landed: the copy button's only content, at the
 *  pill's stroke so the two halves read as one control. */
function CopyGlyph({ done }: { done: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {done ? (
        <path d="M1.8 5.2 4 7.4 8.2 2.6" />
      ) : (
        <>
          <rect x="3.4" y="3.4" width="5.2" height="5.2" rx="1" />
          <path d="M6.6 1.4H2.4a1 1 0 0 0-1 1v4.2" />
        </>
      )}
    </svg>
  );
}

/** A pill-shaped button with no frame of its own: the halves of the split pill share one border.
 *  Each half rounds its own outer side, so the Settings theme's hover wash fills the pill's shape
 *  without the pill clipping its children, which would also clip dsh's focus ring. */
const half = {
  cursor: "pointer",
  background: "none",
  border: "none",
  color: "inherit",
  font: "inherit",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "1px 8px",
  lineHeight: "inherit",
} as const;

/**
 * The "<version> available" pill. With `needsDsh` (this box's dsh is below the release's floor) it
 * is plain text naming the dsh to update first, since nothing would install yet. Where dsh offers
 * navigation to its Plugins page the pill opens this plugin's page there and then calls `onOpen`
 * (Settings closes itself, so the page is not behind a dialog); `command`, when the install has
 * one, sits beside it as a copy button. Without that navigation the whole pill copies `command`,
 * and with neither (DSH Desktop on a dsh with no plugin manager) it is plain text.
 */
export function UpdatePill({
  latest,
  command,
  needsDsh,
  onOpen,
}: {
  latest: string;
  command?: string;
  needsDsh?: string;
  onOpen?: () => void;
}) {
  useLocale();
  const openPlugins = usePluginsPage();
  const [said, setSaid] = useState<"" | "copied" | "blocked">("");
  const say = (what: "copied" | "blocked") => {
    setSaid(what);
    setTimeout(() => setSaid(""), 1500);
  };
  const copy = (text: string) => {
    if (!navigator.clipboard) return say("blocked");
    navigator.clipboard.writeText(text).then(
      () => say("copied"),
      () => say("blocked"),
    );
  };
  if (needsDsh || (!command && !openPlugins))
    return (
      <span
        style={{ ...pill(T.muted), display: "inline-flex", alignItems: "center" }}
        title={
          needsDsh
            ? t("update.needsDshTitle", { latest, floor: needsDsh })
            : t("update.pluginsTitle", { latest })
        }
        data-omc-update={latest}
        data-omc-update-needs-dsh={needsDsh}
      >
        {needsDsh
          ? t("update.needsDsh", { latest, floor: needsDsh })
          : t("update.available", { latest })}
      </span>
    );
  // The copy outcome of the split pill, announced: its visible change is only a glyph, which a
  // screen reader does not see change on its own.
  const status = (
    <output
      aria-live="polite"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        clipPath: "inset(50%)",
      }}
    >
      {said === "copied" ? t("update.commandCopied") : said === "blocked" ? t("copy.failed") : ""}
    </output>
  );
  if (!openPlugins && command)
    return (
      <button
        type="button"
        style={{ ...pill(ACCENT), ...half, border: `1px solid ${ACCENT}`, padding: "1px 8px" }}
        title={t("update.pillTitle", { command })}
        aria-label={t("update.pillLabel", { latest })}
        data-omc-update={latest}
        onClick={() => copy(command)}
      >
        <UpgradeGlyph />
        {said === "copied"
          ? t("update.commandCopied")
          : said === "blocked"
            ? t("copy.failed")
            : t("update.available", { latest })}
      </button>
    );
  return (
    <span
      data-omc-update={latest}
      style={{
        ...pill(ACCENT),
        display: "inline-flex",
        alignItems: "stretch",
        padding: 0,
        position: "relative",
      }}
    >
      <button
        type="button"
        style={{ ...half, borderRadius: command ? "999px 0 0 999px" : 999 }}
        title={t("update.openTitle", { latest })}
        aria-label={t("update.openLabel", { latest })}
        data-omc-update-open=""
        onClick={() => {
          openPlugins?.();
          onOpen?.();
        }}
      >
        <UpgradeGlyph />
        {t("update.available", { latest })}
      </button>
      {command ? (
        <button
          type="button"
          style={{
            ...half,
            padding: "1px 7px",
            borderLeft: `1px solid ${ACCENT}`,
            borderRadius: "0 999px 999px 0",
          }}
          title={said === "blocked" ? t("copy.failed") : t("update.pillTitle", { command })}
          aria-label={t("update.copyLabel")}
          data-omc-update-copy=""
          onClick={() => copy(command)}
        >
          <CopyGlyph done={said === "copied"} />
        </button>
      ) : null}
      {status}
    </span>
  );
}

/** The status fields the pill and the star line read. */
type PillStatus = { latest?: string; update?: string; needsDsh?: string; stars?: number };
/** The status route's answer, shared for a moment: the heading and the Boxes card open together
 *  and would otherwise run the box's CLI probes twice. */
let statusOnce: { at: number; p: Promise<PillStatus> } | undefined;
/** Fetches the status route once and shares the promise for ten seconds, so the Settings heading
 *  and the Boxes card that open together do not hit it twice. */
const loadStatus = (): Promise<PillStatus> => {
  if (statusOnce && Date.now() - statusOnce.at < 10_000) return statusOnce.p;
  const p = fetch(`${ROUTE}/status`)
    .then((r) => readJson<PillStatus>(r))
    .catch(() => ({}));
  statusOnce = { at: Date.now(), p };
  return p;
};

/** The pill beside the Settings heading, or nothing while the plugin is current. `onOpen` runs
 *  after the pill opened the Plugins page: Settings passes its own close. */
export function PluginUpdateBadge({ onOpen }: { onOpen?: () => void }) {
  const [upd, setUpd] = useState<PillStatus | null>(null);
  useEffect(() => {
    let live = true;
    void loadStatus().then((s) => {
      // The server sends `latest` only with an offer: a command, the dsh it needs, or, on DSH
      // Desktop, which has no command, the release alone for the Plugins page to install.
      if (live && s.latest) setUpd(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return upd?.latest ? (
    <UpdatePill latest={upd.latest} command={upd.update} needsDsh={upd.needsDsh} onOpen={onOpen} />
  ) : null;
}

/** A quiet one-line nudge under the Settings heading: the live star count and a link to the repo,
 *  where the Star button is one click for anyone signed in to github.com. Nobody can star from
 *  here, so this is a link and not a button. Dismissible for good on this box. */
export function StarNudge({ onDismiss }: { onDismiss: () => void }) {
  useLocale();
  const [count, setCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadStatus().then((s) => {
      if (live) setCount(s.stars);
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div
      data-omc-star-nudge=""
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color: T.faint,
        marginBottom: 10,
        flexWrap: "wrap",
      }}
    >
      <span aria-hidden="true">★</span>
      <span>
        {t("star.like")}{" "}
        <a href={REPO_URL} target="_blank" rel="noreferrer" data-omc-star-link="">
          {t("star.link")}
        </a>
        {count !== undefined ? ` (${count})` : ""}
      </span>
      <button
        type="button"
        data-omc-star-dismiss=""
        aria-label={t("star.hideLabel")}
        title={t("star.hideTitle")}
        onClick={onDismiss}
        style={{
          marginLeft: "auto",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: T.faint,
        }}
      >
        ×
      </button>
    </div>
  );
}
