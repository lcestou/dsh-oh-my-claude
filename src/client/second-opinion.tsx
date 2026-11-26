// The second opinion on screen: the card above the composer that shows another model's review of
// the last Claude turn's changes, and the Settings row that picks that model. Server side in
// src/adapter/second-opinion.ts; the card follows the `second-opinion` event, the row the
// `second-opinion-setting` one, so a change made in any tab shows in every other.
import { useEffect, useState } from "react";
import { t, useLocale } from "./i18n.js";
import {
  ACCENT,
  DOCK_ATTR,
  DOCK_CARD,
  ROUTE,
  T,
  btn,
  fmtDuration,
  readJson,
  rowBtn,
  select,
} from "./shared.js";
import { subscribe, type OpinionCardData, type OpinionSettingData } from "./events.js";
import { HEADER_TOGGLE, iconBtn } from "./cards.js";
import { Chevron } from "./boxes.js";
import { secondOpinionSteer, type OpinionFinding } from "../prompts.js";

/** The composer actions dsh hands a `conversation.input.dock` entry; only these two are used. */
type Composer = {
  inputActions?: { setDraft: (text: string) => void };
  useInput?: <V>(select: (state: { draft: string }) => V) => V;
};

/** Posts one card action for the session; the card's new state arrives on the event stream. */
const post = (path: string, session: string): Promise<boolean> =>
  fetch(`${ROUTE}/second-opinion/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session }),
  })
    .then((r) => r.ok)
    .catch(() => false);

/** The words for one finding kind, as a short label before its text. */
const kindLabel = (kind: OpinionFinding["kind"]) =>
  kind === "bug"
    ? t("secondOpinion.kind.bug")
    : kind === "risk"
      ? t("secondOpinion.kind.risk")
      : t("secondOpinion.kind.note");

/** The card for one session. Draws nothing while the session has no card (feature off, or the last
 *  turn changed nothing). Starts folded once a review is done, so it takes one line until opened;
 *  Send to Claude adds the finding below whatever is already in the composer, never over it. */
export function SecondOpinionCard({
  sessionId,
  inputActions,
  useInput,
}: { sessionId: string } & Composer) {
  useLocale();
  const [card, setCard] = useState<OpinionCardData["card"]>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // Findings already put in the composer, keyed by the card's turn and index, so a second press
  // cannot add the same text twice.
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [, setTick] = useState(0);
  const running = card?.state === "running";
  useEffect(() => {
    if (!running) return;
    // A local review takes minutes; the elapsed time redraws every second so the card is not
    // mistaken for hung. Outside the live region, so the ticks are not announced.
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  // dsh hands every composer slot `useInput`; without it the draft reads empty and a send fills
  // the box as if nothing were typed.
  const draft = useInput?.((s) => s.draft) ?? "";
  useEffect(() => {
    let live = true;
    // Read once on mount, then follow the stream: every change to the card is published.
    fetch(`${ROUTE}/second-opinion?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<OpinionCardData>(r))
      .then((d) => live && setCard(d.card))
      .catch(() => {});
    const off = subscribe("second-opinion", (session, d) => {
      if (live && session === sessionId) setCard(d.card);
    });
    return () => {
      live = false;
      off();
    };
  }, [sessionId]);
  if (card === null) return null;
  const files = card.files.length;
  /** Adds the findings at `indexes` below the composer's draft (never over it) and marks them sent;
   *  ones already sent are skipped, and nothing is sent to Claude. */
  const send = (indexes: readonly number[]) => {
    if (!inputActions || card.state !== "done") return;
    const fresh = indexes.filter((i) => !sent.has(`${card.at}:${i}`));
    const findings = fresh.flatMap((i) => card.findings[i] ?? []);
    if (findings.length === 0) return;
    const text = secondOpinionSteer(card.model, findings);
    inputActions.setDraft(draft.trim() === "" ? text : `${draft.trimEnd()}\n\n${text}`);
    setSent(new Set([...sent, ...fresh.map((i) => `${card.at}:${i}`)]));
  };
  /** Posts Run, Cancel or Close; a refused post shows the alert line, the new card comes by event. */
  const act = (path: "run" | "cancel" | "dismiss") => {
    setFailed(false);
    void post(path, sessionId).then((ok) => setFailed(!ok));
  };
  let summary: string;
  if (card.state === "ready") summary = t("secondOpinion.ready", { count: files });
  else if (card.state === "running") summary = t("secondOpinion.running", { model: card.model });
  else if (card.state === "failed")
    summary = t(`secondOpinion.fail.${card.reason}`, {
      model: card.model,
      detail: card.detail ?? "",
    });
  else if (card.findings.length === 0) summary = t("secondOpinion.clean", { model: card.model });
  else
    summary = t("secondOpinion.found", {
      model: card.model,
      count: card.findings.length,
      took: fmtDuration(card.ms),
    });
  const foldable = card.state === "done" && card.findings.length > 0;
  return (
    <div {...{ [DOCK_ATTR]: "1" }} style={DOCK_CARD}>
      <section
        data-omc-second-opinion={card.state}
        aria-label={t("secondOpinion.title")}
        style={{
          boxSizing: "border-box",
          background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
          border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
          borderRadius: "12px 12px 0 0",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px 0 10px" }}>
          {/* The title folds the findings once there are some; before that it is only a label. */}
          {foldable ? (
            <button
              type="button"
              aria-expanded={open}
              data-omc-second-opinion-toggle=""
              onClick={() => setOpen((o) => !o)}
              style={{ ...HEADER_TOGGLE, flex: "0 0 auto", padding: "6px 0" }}
            >
              <span style={{ color: ACCENT, fontWeight: 600, fontSize: 12 }}>
                {t("secondOpinion.title")}
              </span>
              <Chevron open={open} />
            </button>
          ) : (
            <span style={{ color: ACCENT, fontWeight: 600, fontSize: 12, padding: "6px 0" }}>
              {t("secondOpinion.title")}
            </span>
          )}
          {/* The live region sits beside the toggle, not in it, so the button's name stays fixed
              and a review that finishes or fails is announced. */}
          <span
            aria-live="polite"
            data-omc-second-opinion-summary=""
            style={{
              color: card.state === "failed" ? T.err : T.muted,
              fontSize: 12,
              flex: "1 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {summary}
          </span>
          {card.state === "running" ? (
            <span data-omc-second-opinion-elapsed="" style={{ color: T.faint, fontSize: 11 }}>
              {fmtDuration(Date.now() - card.startedAt)}
            </span>
          ) : null}
          {card.state === "ready" || card.state === "failed" ? (
            <button
              type="button"
              data-omc-second-opinion-run=""
              style={{ ...rowBtn, width: "auto", fontSize: 12 }}
              onClick={() => act("run")}
            >
              {t("secondOpinion.run")}
            </button>
          ) : null}
          {card.state === "running" ? (
            <button
              type="button"
              data-omc-second-opinion-cancel=""
              style={{ ...rowBtn, width: "auto", fontSize: 12 }}
              onClick={() => act("cancel")}
            >
              {t("cancel")}
            </button>
          ) : (
            <button
              type="button"
              data-omc-second-opinion-dismiss=""
              aria-label={t("secondOpinion.dismissAria")}
              style={{ ...iconBtn, color: T.muted, fontSize: 12 }}
              onClick={() => act("dismiss")}
            >
              ✕
            </button>
          )}
        </div>
        {failed ? (
          <div role="alert" style={{ color: T.err, fontSize: 12, padding: "0 10px 6px" }}>
            {t("secondOpinion.actionFailed")}
          </div>
        ) : null}
        {foldable && open ? (
          <div style={{ padding: "0 10px 8px", maxHeight: "40vh", overflow: "auto" }}>
            {card.reviewed < files ? (
              <div style={{ color: T.faint, fontSize: 12, marginBottom: 6 }}>
                {t("secondOpinion.partial", { reviewed: card.reviewed, count: files })}
              </div>
            ) : null}
            <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {card.findings.map((f, i) => (
                <li
                  key={i}
                  data-omc-second-opinion-finding={f.kind}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    padding: "6px 0",
                    borderTop: i === 0 ? "none" : `0.5px solid ${T.border}`,
                  }}
                >
                  <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13, color: T.text }}>
                    <span
                      style={{
                        color: f.kind === "bug" ? T.err : f.kind === "risk" ? ACCENT : T.muted,
                        fontWeight: 600,
                        fontSize: 12,
                        marginRight: 6,
                      }}
                    >
                      {kindLabel(f.kind)}
                    </span>
                    {f.where ? (
                      <code style={{ fontSize: 12, color: T.muted, marginRight: 6 }}>
                        {f.where}
                      </code>
                    ) : null}
                    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {f.text}
                    </span>
                  </div>
                  {inputActions ? (
                    <button
                      type="button"
                      data-omc-second-opinion-send={i}
                      aria-label={t("secondOpinion.sendOneAria", { n: i + 1 })}
                      disabled={sent.has(`${card.at}:${i}`)}
                      style={{ ...rowBtn, width: "auto", fontSize: 12, flex: "0 0 auto" }}
                      onClick={() => send([i])}
                    >
                      {t("secondOpinion.send")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
            {inputActions && card.findings.length > 1 ? (
              <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 6 }}>
                <button
                  type="button"
                  data-omc-second-opinion-send-all=""
                  style={{ ...btn, fontSize: 12 }}
                  disabled={card.findings.every((_f, i) => sent.has(`${card.at}:${i}`))}
                  onClick={() => send(card.findings.map((_f, i) => i))}
                >
                  {t("secondOpinion.sendAll")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** One provider and its models, as `GET /second-opinion/setting` lists them. */
type Choice = { provider: string; name: string; models: Array<{ id: string; name: string }> };

/** Settings → Oh My Claude: the model that gives the second opinion (Off by default) and whether it
 *  reviews every turn on its own. Off means no snapshot, no card and no call. A saved model dsh no
 *  longer lists stays shown as unavailable, so the row never reads Off over a setting in effect.
 *  Writes on each change; a refused write shows under the row and keeps the old value. */
export function SecondOpinionRow() {
  useLocale();
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [setting, setSetting] = useState<OpinionSettingData["setting"]>(null);
  const [error, setError] = useState(false);
  /** Reads the saved value and dsh's model list. Runs on mount and again each time the list gets
   *  focus: a provider added in dsh's own settings has no event this row can hear, so opening the
   *  list is when it catches up. The server re-checks a pick on save, so a stale list cannot save
   *  a model dsh dropped. */
  const load = () =>
    fetch(`${ROUTE}/second-opinion/setting`)
      .then((r) => readJson<OpinionSettingData & { choices: Choice[] }>(r))
      .then((d) => {
        setChoices(d.choices);
        setSetting(d.setting);
      })
      .catch(() => setChoices((c) => c ?? []));
  useEffect(() => {
    let live = true;
    void load();
    // The saved value follows a save made in any tab.
    const off = subscribe("second-opinion-setting", (_s, d) => {
      if (live) setSetting(d.setting);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  /** Writes the setting; a refused or failed write shows the alert and keeps the old value. */
  const save = (next: OpinionSettingData["setting"]) => {
    setError(false);
    fetch(`${ROUTE}/second-opinion/setting`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next ?? {}),
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        setSetting(next);
      })
      .catch(() => setError(true));
  };
  const key = setting ? `${setting.provider}\n${setting.model}` : "";
  const listed = choices?.some((c) => c.models.some((m) => `${c.provider}\n${m.id}` === key));
  return (
    <div data-omc-second-opinion-row="" style={{ fontSize: 13, marginBottom: 12 }}>
      <div>{t("secondOpinion.title")}</div>
      <div style={{ color: T.faint, fontSize: 12, marginBottom: 6 }}>
        {t("secondOpinion.settingDesc")}
      </div>
      {choices !== null && choices.length === 0 && !setting ? (
        <div data-omc-second-opinion-none="" style={{ color: T.faint, fontSize: 12 }}>
          {t("secondOpinion.noModels")}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select
            aria-label={t("secondOpinion.modelAria")}
            data-omc-second-opinion-model=""
            value={key}
            style={select}
            onFocus={() => void load()}
            onChange={(e) => {
              const [provider, model] = e.target.value.split("\n");
              save(provider && model ? { provider, model, auto: setting?.auto } : null);
            }}
          >
            <option value="">{t("secondOpinion.off")}</option>
            {setting && choices !== null && !listed ? (
              <option value={key}>
                {t("secondOpinion.unavailable", { model: setting.model })}
              </option>
            ) : null}
            {(choices ?? []).map((c) => (
              <optgroup key={c.provider} label={c.name}>
                {c.models.map((m) => (
                  <option key={m.id} value={`${c.provider}\n${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              data-omc-second-opinion-auto=""
              disabled={!setting}
              checked={setting?.auto === true}
              onChange={(e) =>
                setting &&
                save({
                  provider: setting.provider,
                  model: setting.model,
                  auto: e.target.checked || undefined,
                })
              }
            />
            {t("secondOpinion.auto")}
          </label>
        </div>
      )}
      {error ? (
        <div role="alert" style={{ color: T.err, fontSize: 12, marginTop: 4 }}>
          {t("secondOpinion.saveFailed")}
        </div>
      ) : null}
    </div>
  );
}
