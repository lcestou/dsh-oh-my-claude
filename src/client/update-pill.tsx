// The "<version> available" pill: the one thing about the plugin itself the panel points at.
// Neither npm nor dsh says when a plugin has moved on, so the pill does, wherever the plugin's
// own name is on screen: beside the Oh My Claude heading in Settings and on the panel's Runtime
// line. A click puts the update command on the clipboard and says so for a moment, or says the
// clipboard refused. The server reads the registry once a day; the pill never fetches npm itself.
import { useEffect, useState } from "react";
import { CLAUDE_ORANGE, pill, readJson } from "./shared.js";

const ROUTE = "/dsh-oh-my-claude";

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
      style={{ ...pill(CLAUDE_ORANGE), cursor: "pointer", background: "none" }}
      title={`${command}\nthen restart dsh. Click to copy the command.`}
      aria-label={`Plugin ${latest} available. Copy the update command.`}
      data-omc-update={latest}
      onClick={copy}
    >
      {said || `${latest} available`}
    </button>
  );
}

/** The status route's answer, shared for a moment: the heading and the Boxes card open together
 *  and would otherwise run the box's CLI probes twice. */
let statusOnce: { at: number; p: Promise<{ latest?: string; update?: string }> } | undefined;
const loadStatus = (): Promise<{ latest?: string; update?: string }> => {
  if (statusOnce && Date.now() - statusOnce.at < 10_000) return statusOnce.p;
  const p = fetch(`${ROUTE}/status`)
    .then((r) => readJson<{ latest?: string; update?: string }>(r))
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
