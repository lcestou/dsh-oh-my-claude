// The "<version> available" pill: the one thing about the plugin itself the panel points at.
// Neither npm nor dsh says when a plugin has moved on, so the pill does, wherever the plugin's
// own name is on screen: beside the Oh My Claude heading in Settings and on the panel's Runtime
// line. A click puts the update command on the clipboard and says so for a moment, or says the
// clipboard refused. The server reads the registry once a day; the pill never fetches npm itself.
import { useEffect, useState } from "react";
import { ACCENT, pill, readJson, T } from "./shared.js";
import { REPO_URL } from "../stars.js";

const ROUTE = "/dsh-oh-my-claude";

/** The "<version> available" pill: a button whose click copies the update `command` to the
 *  clipboard and flashes whether it copied or the clipboard refused. */
export function UpdatePill({ latest, command }: { latest: string; command: string }) {
  const [said, setSaid] = useState<"" | "command copied" | "copy blocked">("");
  const say = (what: "command copied" | "copy blocked") => {
    setSaid(what);
    setTimeout(() => setSaid(""), 1500);
  };
  const copy = () => {
    if (!navigator.clipboard) return say("copy blocked");
    navigator.clipboard.writeText(command).then(
      () => say("command copied"),
      () => say("copy blocked"),
    );
  };
  return (
    <button
      type="button"
      style={{
        ...pill(ACCENT),
        cursor: "pointer",
        background: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
      title={`${command}\nthen restart dsh. Click to copy the command.`}
      aria-label={`Plugin ${latest} available. Copy the update command.`}
      data-omc-update={latest}
      onClick={copy}
    >
      {/* An arrow onto a shelf: the upgrade glyph, drawn at the pill's stroke and colour. */}
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
      {said || `${latest} available`}
    </button>
  );
}

/** The status route's answer, shared for a moment: the heading and the Boxes card open together
 *  and would otherwise run the box's CLI probes twice. */
let statusOnce:
  | { at: number; p: Promise<{ latest?: string; update?: string; stars?: number }> }
  | undefined;
/** Fetches the status route once and shares the promise for ten seconds, so the Settings heading
 *  and the Boxes card that open together do not hit it twice. */
const loadStatus = (): Promise<{ latest?: string; update?: string; stars?: number }> => {
  if (statusOnce && Date.now() - statusOnce.at < 10_000) return statusOnce.p;
  const p = fetch(`${ROUTE}/status`)
    .then((r) => readJson<{ latest?: string; update?: string; stars?: number }>(r))
    .catch(() => ({}));
  statusOnce = { at: Date.now(), p };
  return p;
};

/** The pill beside the Settings heading, or nothing while the plugin is current. */
export function PluginUpdateBadge() {
  const [upd, setUpd] = useState<{ latest: string; command: string } | null>(null);
  useEffect(() => {
    let live = true;
    void loadStatus().then((s) => {
      if (live && s.latest && s.update) setUpd({ latest: s.latest, command: s.update });
    });
    return () => {
      live = false;
    };
  }, []);
  return upd ? <UpdatePill latest={upd.latest} command={upd.command} /> : null;
}

/** A quiet one-line nudge under the Settings heading: the live star count and a link to the repo,
 *  where the Star button is one click for anyone signed in to github.com. Nobody can star from
 *  here, so this is a link and not a button. Dismissible for good on this box. */
export function StarNudge({ onDismiss }: { onDismiss: () => void }) {
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
        Like Oh My Claude?{" "}
        <a href={REPO_URL} target="_blank" rel="noreferrer" data-omc-star-link="">
          Star it on GitHub
        </a>
        {count !== undefined ? ` (${count})` : ""}
      </span>
      <button
        type="button"
        data-omc-star-dismiss=""
        aria-label="Hide the star line"
        title="Hide this"
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
