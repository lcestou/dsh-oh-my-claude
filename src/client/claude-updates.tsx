// What sits under the Claude Code updates switch in Settings while it is on: which box, its release
// channel, whether it updates on its own, and its run history behind a fold. These used to be a
// block in Tune, but the panel's tabs are for how Claude answers, and keeping a box's CLI current is
// the plugin's job around Claude. With the switch off none of it applies, so none of it shows.
import { useEffect, useState } from "react";

import type { ClaudeUpdateState } from "../claude-update.js";
import { BOXES_EVENT } from "./picker.js";
import { btn, errText, meta, nested, readJson, ROUTE, select, T } from "./shared.js";
import { Switch } from "./switch.js";
import { onBox, read, readTunables, updateSettings } from "./tune.js";

/** The updater's reply, plus whether the Settings switch has turned the whole feature off. */
type UpdateReply = ClaudeUpdateState & { switchedOff?: boolean };

/** A box the picker offers: this one (empty host, no provider) or a saved ssh box. */
interface UpdateBox {
  name: string;
  host: string;
  provider?: string;
}

/** A child row under the switch: label left, control right, a note on its own line below. */
const row = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "4px 12px",
  fontSize: 13,
} as const;

/** A fold's toggle: plain text with a triangle, left-aligned, the summary allowed to wrap. */
const FOLD = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  fontSize: 13,
  color: "inherit",
  cursor: "pointer",
  textAlign: "left",
} as const;

/** A dropdown as wide as the choice on show, like the proxy switch's: `0 0 auto` so the flex row
 *  cannot squeeze it, and `fieldSizing: content` so the width follows the words, not the longest
 *  option. A browser without it sizes by the longest option. */
const pick = { ...select, flex: "0 0 auto", fieldSizing: "content", minWidth: 0 } as const;

/**
 * The rows under the Claude Code updates switch. Reads the box list (and rereads it when the Boxes
 * card saves), then the chosen box's updater state and its settings.json for the channel. The box
 * picker only appears with more than one box. A failed read or write shows its message under the
 * rows rather than hiding them.
 */
export function ClaudeUpdateDetails() {
  const [boxes, setBoxes] = useState<UpdateBox[]>([{ name: "This box", host: "" }]);
  const [host, setHost] = useState("");
  const [upd, setUpd] = useState<UpdateReply | null>(null);
  const [channel, setChannel] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [checkLine, setCheckLine] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  // Folded by default: open, the rows push the rest of Settings down by a screen's worth.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch(`${ROUTE}/ssh-boxes`)
        .then((r) => readJson<{ boxes?: UpdateBox[] }>(r))
        .then((b) => setBoxes([{ name: "This box", host: "" }, ...(b.boxes ?? [])]))
        .catch(() => {});
    void load();
    window.addEventListener(BOXES_EVENT, load);
    return () => window.removeEventListener(BOXES_EVENT, load);
  }, []);

  const box = boxes.find((b) => b.host === host) ?? boxes[0];
  const provider = box?.provider;
  const url = (extra = "") => `${ROUTE}/claude-update?host=${encodeURIComponent(host)}${extra}`;

  useEffect(() => {
    let live = true;
    setUpd(null);
    setCheckLine("");
    setErr("");
    fetch(`${ROUTE}/claude-update?host=${encodeURIComponent(host)}`)
      .then((r) => readJson<UpdateReply>(r))
      .then((s) => live && setUpd(s))
      .catch((e: Error) => live && setErr(e.message));
    read(provider)
      .then((f) => {
        if (!live) return;
        setChannel(readTunables(f.text).autoUpdatesChannel);
      })
      .catch(() => live && setChannel(undefined));
    return () => {
      live = false;
    };
  }, [host, provider]);

  /** One call to the updater route, its reply replacing the shown state. */
  const post = async (body: { auto?: boolean }) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(url(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setUpd(await readJson<UpdateReply>(r));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** A refresh of installed and latest, never an install: the route reads the pointer on `now=1`. */
  const checkNow = async () => {
    setBusy(true);
    setErr("");
    setCheckLine("");
    try {
      const s = await readJson<UpdateReply>(await fetch(url("&now=1")));
      setUpd(s);
      setCheckLine(
        s.latest
          ? `Installed ${s.installed ?? "unknown"}, newest ${s.latest}`
          : "Could not reach downloads.claude.ai",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Write the channel into the box's own settings.json, the key the CLI's updater reads too. The
   *  file is read fresh and sent back with its mtime, so an edit made meanwhile is not overwritten. */
  const writeChannel = async (next: string | undefined) => {
    setBusy(true);
    setErr("");
    try {
      const fresh = await read(provider);
      const out = updateSettings(fresh.text, "autoUpdatesChannel", next);
      if (out.error !== undefined) throw new Error(out.error);
      await readJson(
        await fetch(`${ROUTE}/settings${onBox(provider)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: out.text, mtime: fresh.mtime }),
        }),
      );
      setChannel(next);
      // The updater reads the channel before each check; ask for one so the card follows.
      setUpd(await readJson<UpdateReply>(await fetch(url("&now=1"))));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const history = (upd?.log ?? []).slice(-10).toReversed();
  const channelName =
    channel === "stable"
      ? "Stable"
      : channel === "rc"
        ? "Release candidate"
        : channel === "latest"
          ? "Latest"
          : "Default (latest)";
  const summary = [
    boxes.length > 1 ? (box?.name ?? "This box") : null,
    channelName,
    upd?.auto ? "installs on its own" : "by the card",
    `${upd?.log.length ?? 0} runs`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      data-omc-claude-update-details=""
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        margin: "-4px 0 14px",
        ...nested,
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        data-omc-update-options=""
        onClick={() => setOpen((v) => !v)}
        style={FOLD}
      >
        {`${open ? "▾" : "▸"}\u00a0Options`}
        <span style={{ ...meta, whiteSpace: "normal" }}> · {summary}</span>
      </button>
      {open && boxes.length > 1 && (
        <div style={row}>
          <span>Box</span>
          <select
            aria-label="Box to update"
            data-omc-update-box=""
            style={pick}
            value={host}
            disabled={busy}
            onChange={(e) => setHost(e.target.value)}
          >
            {boxes.map((b) => (
              <option key={b.host} value={b.host}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {open && (
        <>
          <div style={row} data-omc-update-channel="">
            <span>Release channel</span>
            <select
              aria-label="Release channel"
              style={pick}
              value={channel ?? ""}
              disabled={busy}
              onChange={(e) => void writeChannel(e.target.value || undefined)}
            >
              <option value="">Default (latest)</option>
              <option value="latest">Latest</option>
              <option value="stable">Stable, about a week behind</option>
              <option value="rc">Release candidate</option>
            </select>
            <span style={{ ...meta, flexBasis: "100%", whiteSpace: "normal" }}>
              Which releases the update card offers. Stable skips releases with known regressions.
            </span>
          </div>
          <div style={row} data-omc-update-auto="">
            <span>Update on its own</span>
            <Switch
              label="Update on its own"
              on={upd?.auto === true}
              disabled={upd === null || upd.off !== undefined || busy}
              onChange={(next) => void post({ auto: next })}
            />
            <span style={{ ...meta, flexBasis: "100%", whiteSpace: "normal" }}>
              {upd?.off
                ? `Off: ${upd.off} is set.`
                : "Install a new release as soon as this dsh sees one, without the card. Sessions already running finish on their version."}
            </span>
          </div>
          <div data-omc-update-history="">
            <div style={row}>
              <button
                type="button"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((v) => !v)}
                style={{ ...FOLD, whiteSpace: "nowrap" }}
              >
                {historyOpen ? "▾" : "▸"} History
                <span style={meta}> · {upd?.log.length ?? 0} runs</span>
              </button>
              <button
                type="button"
                style={btn}
                disabled={upd === null || busy}
                onClick={() => void checkNow()}
              >
                Check now
              </button>
            </div>
            {checkLine ? <div style={{ ...meta, marginTop: 4 }}>{checkLine}</div> : null}
            {historyOpen && (
              <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, fontSize: 12 }}>
                {history.length === 0 ? <li style={meta}>No updates from here yet.</li> : null}
                {history.map((e) => (
                  <li key={e.at} style={{ color: e.ok ? T.text : T.err }}>
                    {e.to ?? "?"} from {e.from ?? "?"} · {new Date(e.at).toLocaleString()} ·{" "}
                    {e.by === "button" ? "you" : "automatic"}
                    {!e.ok && e.note ? ` · ${e.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {err ? <span style={errText}>{err}</span> : null}
    </div>
  );
}
