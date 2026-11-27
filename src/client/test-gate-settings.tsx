// The test gate's row in Settings → Oh My Claude: on or off for the open session's workspace, the
// command, the tries and the time limit. Server-held per workspace (`/test-gate`), since the hook
// that reads it runs on the box.
import { useEffect, useState } from "react";
import { t, useLocale } from "./i18n.js";
import { subscribe } from "./events.js";
import { Switch } from "./switch.js";
import {
  ROUTE,
  T,
  btn,
  btnPrimary,
  inputStyle,
  openSessionId,
  readJson,
  select,
} from "./shared.js";
import type { ClientCtx } from "./shared.js";
import { TIMEOUT_DEFAULT_SEC, TRIES_DEFAULT, TRIES_MAX } from "../test-gate.js";
import type { TestGateConfig } from "../test-gate.js";

/** `GET /test-gate`: the saved gate, a guess from the project files, and whether the workspace is
 *  on this box (the only place the hook can run). */
interface GateReply {
  config: TestGateConfig | null;
  suggested: string | null;
  local: boolean;
}

/** The time limits offered, in minutes; five is the default the server falls back to. */
const TIMEOUTS_MIN = [1, 2, 5, 10, 20] as const;

/**
 * The row. Reads the workspace's gate when Settings opens and again whenever any tab saves one
 * (`test-gate-config`), so two open Settings never disagree. The switch saves at once when a
 * command is already saved; with none it only opens the fields, and Save turns the gate on.
 * Wrong case: with no session open there is no workspace to name, and the row says so.
 */
export function TestGateRow({ ctx }: { ctx: ClientCtx }) {
  useLocale();
  const id = openSessionId(ctx) ?? "";
  const cwd = (id ? ctx.sessions.list.getSnapshot()?.byId[id]?.cwd : "") ?? "";
  const [reply, setReply] = useState<GateReply | null>(null);
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState("");
  const [tries, setTries] = useState(TRIES_DEFAULT);
  const [timeoutSec, setTimeoutSec] = useState(TIMEOUT_DEFAULT_SEC);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!cwd) {
      return;
    }

    let live = true;

    const read = () =>
      fetch(`${ROUTE}/test-gate?cwd=${encodeURIComponent(cwd)}`)
        .then((r) => readJson<GateReply>(r))
        .then((r) => {
          if (!live) {
            return;
          }

          setReply(r);
          setCommand(r.config?.command || r.suggested || "");
          setTries(r.config?.tries ?? TRIES_DEFAULT);
          setTimeoutSec(r.config?.timeoutSec ?? TIMEOUT_DEFAULT_SEC);
        })
        .catch(() => {});

    void read();

    const off = subscribe("test-gate-config", (_s, d) => {
      if (d.cwd === cwd) {
        void read();
      }
    });

    return () => {
      live = false;
      off();
    };
  }, [cwd]);
  const saved = reply?.config ?? null;
  const shown = saved?.enabled === true || editing;

  const save = async (config: TestGateConfig) => {
    setNote("");

    try {
      const r = await fetch(`${ROUTE}/test-gate`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, config }),
      }).then((x) => readJson<{ config?: TestGateConfig; error?: string }>(x));

      if (r.error) {
        throw new Error(r.error);
      }

      setEditing(false);
      setNote(t("testGate.saved"));
    } catch {
      setNote(t("testGate.saveFailed"));
    }
  };

  const flip = (next: boolean) => {
    if (!next) {
      setEditing(false);

      if (saved?.enabled) {
        void save({ ...saved, enabled: false });
      }
    } else if (saved?.command) {
      void save({ ...saved, enabled: true });
    } else {
      setEditing(true);
    }
  };

  const blocked = !cwd || reply?.local === false;

  return (
    <div data-omc-test-gate-row="" style={{ fontSize: 13, marginBottom: 12 }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <div>{t("testGate.title")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>
            {!cwd ? t("testGate.noSession") : blocked ? t("testGate.remote") : t("testGate.desc")}
          </div>
        </div>
        <Switch
          on={shown && !blocked}
          onChange={flip}
          label={t("testGate.title")}
          disabled={blocked || reply === null}
        />
      </div>
      {shown && !blocked && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingLeft: 16,
            marginTop: 8,
          }}
        >
          <div style={{ color: T.faint, fontSize: 12, overflowWrap: "anywhere" }}>
            {t("testGate.workspace", { path: cwd })}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: T.muted }}>{t("testGate.command")}</span>
            <input
              data-omc-test-gate-command=""
              style={{ ...inputStyle, width: "100%", fontFamily: T.mono }}
              value={command}
              spellCheck={false}
              onChange={(e) => setCommand(e.target.value)}
            />
          </label>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("testGate.trust")}</div>
          {reply?.suggested && reply.suggested !== command && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                fontSize: 12,
              }}
            >
              <span style={{ color: T.muted }}>
                {t("testGate.suggested", { command: reply.suggested })}
              </span>
              <button
                type="button"
                data-omc-test-gate-use=""
                style={{ ...btn, padding: "2px 10px" }}
                onClick={() => setCommand(reply.suggested ?? "")}
              >
                {t("testGate.useSuggested")}
              </button>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: T.muted }}>{t("testGate.tries")}</span>
              <select
                data-omc-test-gate-tries=""
                style={select}
                value={String(tries)}
                onChange={(e) => setTries(Number(e.target.value))}
              >
                {Array.from({ length: TRIES_MAX }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: T.muted }}>{t("testGate.timeout")}</span>
              <select
                data-omc-test-gate-timeout=""
                style={select}
                value={String(timeoutSec)}
                onChange={(e) => setTimeoutSec(Number(e.target.value))}
              >
                {TIMEOUTS_MIN.map((m) => (
                  <option key={m} value={String(m * 60)}>
                    {t(m === 1 ? "main.settingsUi.minuteOne" : "main.settingsUi.minuteOther", {
                      n: m,
                    })}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              data-omc-test-gate-save=""
              style={btnPrimary}
              disabled={command.trim() === ""}
              onClick={() =>
                void save({ enabled: true, command: command.trim(), tries, timeoutSec })
              }
            >
              {t("save")}
            </button>
          </div>
        </div>
      )}
      {/* Always mounted: a live region that appears with its text is not announced. */}
      <div
        data-omc-test-gate-note=""
        aria-live="polite"
        style={{ color: T.faint, fontSize: 12, marginTop: note ? 4 : 0 }}
      >
        {note}
      </div>
    </div>
  );
}
