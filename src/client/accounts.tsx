// The accounts under This box in Settings → Boxes: one row per extra Claude Code login on this box,
// with Log in, Log out and Remove, and the Add account form. index.tsx hands this to the Boxes card,
// which renders it right under This box's row.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { defaultAccountDir } from "../accounts.js";
import { BoxRow, LoginSteps, useLoginFlow } from "./boxes.js";
import type { LoginRoutes } from "./boxes.js";
import { subscribe } from "./events.js";
import { t, useLocale } from "./i18n.js";
import { BOXES_EVENT } from "./picker.js";
import { ROUTE, T, btn, btnPrimary, inputStyle, maskEmail, meta, readJson, row } from "./shared.js";
import { ConfirmButton } from "./tune.js";
import { BoxColourSwatch, useBoxColours } from "./box-colour-swatch.js";

/** Where an account's login steps go: the accounts routes, naming the account by provider id. */
export const ACCOUNT_LOGIN: LoginRoutes = { base: "accounts/login", field: "provider" };

// A box or account added, removed, logged in or out in another tab or browser arrives as one
// `boxes` event; every view that lists boxes already re-reads on BOXES_EVENT, so hand it on.
// Module-level, like the hints bridge: a hot reload starts a fresh subscriber map.
subscribe("boxes", () => window.dispatchEvent(new Event(BOXES_EVENT)));

/** One row of `GET /accounts` (src/routes/accounts.ts, `AccountRow`). */
interface AccountRow {
  name: string;
  configDir: string;
  provider: string;
  source: "plugin" | "profile";
  mounted: boolean;
}

/** The part of a config dir's runtime status a row shows. */
interface AccountStatus {
  loggedIn: boolean;
  email?: string | null;
  running?: number;
}

/** POST a JSON body to one of the accounts routes and read the reply, throwing its error. */
const post = <T,>(path: string, body: object): Promise<T> =>
  fetch(`${ROUTE}/accounts${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => readJson<T>(r));

/**
 * The account rows and the Add account line. Reads the list and each login on mount, whenever
 * `tick` changes (the card's Refresh) and on BOXES_EVENT, which a change here, in another tab or
 * in another browser all raise. Every write tells the other views through the same event.
 */
export function Accounts({ tick }: { tick: number }) {
  useLocale();
  const { colours } = useBoxColours();
  const [rows, setRows] = useState<Array<AccountRow> | null>(null);
  const [status, setStatus] = useState<Record<string, AccountStatus | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", configDir: "" });

  /** The list, then each account's login; a failed read keeps what is on screen. */
  const load = () => {
    fetch(`${ROUTE}/accounts`)
      .then((r) => readJson<{ accounts: Array<AccountRow> }>(r))
      .then((b) => {
        setRows(b.accounts);

        return b.accounts.length === 0
          ? undefined
          : fetch(`${ROUTE}/accounts/status`)
              .then((r) =>
                readJson<{ accounts: Array<{ provider: string; status: AccountStatus | null }> }>(
                  r,
                ),
              )
              .then((s) =>
                setStatus(Object.fromEntries(s.accounts.map((a) => [a.provider, a.status]))),
              );
      })
      .catch((error_: Error) => setError(error_.message));
  };

  useEffect(load, [tick]);
  useEffect(() => {
    window.addEventListener(BOXES_EVENT, load);

    return () => window.removeEventListener(BOXES_EVENT, load);
  }, []);

  /** Run one write, then re-read here and in every other view on this page. */
  const act = (job: Promise<unknown>) => {
    setBusy(true);
    setError("");

    return job
      .then(() => window.dispatchEvent(new Event(BOXES_EVENT)))
      .catch((error_: Error) => {
        setError(error_.message);
        throw error_;
      })
      .finally(() => setBusy(false));
  };

  const { login, setLogin, startLogin, submitLogin } = useLoginFlow(
    () => window.dispatchEvent(new Event(BOXES_EVENT)),
    ACCOUNT_LOGIN,
  );

  /** Submit the Add account form: POST the draft; on success clear and close the form, on a
   *  refusal keep it open with the server's text in the alert line. */
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    act(post("", { name: draft.name.trim(), configDir: draft.configDir.trim() })).then(
      () => {
        setDraft({ name: "", configDir: "" });
        setAdding(false);
      },
      () => {},
    );
  };

  const suggested = defaultAccountDir(draft.name);

  return (
    <div data-omc-accounts="">
      {error && (
        <p role="alert" style={{ color: T.err, fontSize: 13, margin: "4px 0" }}>
          {error}
        </p>
      )}
      {(rows ?? []).map((a) => {
        const st = status[a.provider];

        const facts: Array<ReactNode> = !a.mounted
          ? [
              <span key="off" style={{ color: T.err }}>
                {t("accounts.notMounted", { provider: a.provider })}
              </span>,
            ]
          : st === undefined
            ? [busy ? t("main.sessions.checking") : t("main.sessions.unchecked")]
            : [
                <span key="login" data-omc-account-login={st?.loggedIn ? "in" : "out"}>
                  {st?.loggedIn ? (
                    maskEmail(st.email ?? t("main.boxes.loggedIn"))
                  ) : (
                    <span style={{ color: T.err }}>{t("main.boxes.notLoggedIn")}</span>
                  )}
                </span>,
                ...(!st?.loggedIn && (st?.running ?? 0) > 0
                  ? [
                      <span key="running" data-omc-running={st?.running}>
                        {t(
                          st?.running === 1
                            ? "main.boxes.stillAnsweringOne"
                            : "main.boxes.stillAnsweringOther",
                          { n: st?.running ?? 0 },
                        )}
                      </span>,
                    ]
                  : []),
              ];

        return (
          <div key={a.provider} data-omc-account={a.provider} data-omc-account-source={a.source}>
            <BoxRow
              testId="dsh-oh-my-claude-account-row"
              title={a.name}
              swatch={
                a.mounted && colours.has(a.provider) ? (
                  <BoxColourSwatch
                    provider={a.provider}
                    name={a.name}
                    colour={colours.get(a.provider)}
                  />
                ) : undefined
              }
              kind={`${t("accounts.kind")} · ${a.configDir}`}
              tone={!a.mounted ? "err" : !st ? "faint" : st.loggedIn ? "ok" : "err"}
              facts={facts}
              note={a.source === "profile" ? t("accounts.fromProfile") : undefined}
              actions={
                <>
                  {a.mounted && st && !st.loggedIn && login?.host !== a.provider && (
                    <button
                      type="button"
                      style={btn}
                      disabled={busy}
                      data-omc-account-login-start={a.provider}
                      onClick={() => startLogin(a.provider)}
                    >
                      {t("main.boxes.logIn")}
                    </button>
                  )}
                  {a.mounted && st && (st.loggedIn || (st.running ?? 0) > 0) && (
                    <span data-omc-account-logout={a.provider}>
                      <ConfirmButton
                        label={t("main.boxes.logOut")}
                        ariaLabel={t("accounts.logOutAria", { name: a.name })}
                        style={btn}
                        disabled={busy}
                        onAct={() => {
                          act(post("/login/logout", { provider: a.provider })).catch(() => {});
                        }}
                      />
                    </span>
                  )}
                  {a.source === "plugin" && (
                    <span data-omc-account-remove={a.provider}>
                      <ConfirmButton
                        label={t("common.remove")}
                        ariaLabel={t("accounts.removeAria", { name: a.name, dir: a.configDir })}
                        style={btn}
                        disabled={busy}
                        onAct={() => {
                          act(post("/remove", { provider: a.provider })).catch(() => {});
                        }}
                      />
                    </span>
                  )}
                </>
              }
            >
              {login?.host === a.provider && (
                <LoginSteps login={login} setLogin={setLogin} submit={submitLogin} />
              )}
            </BoxRow>
          </div>
        );
      })}
      {adding ? (
        <form
          onSubmit={add}
          data-omc-account-form=""
          style={{ ...row, flexWrap: "wrap", alignItems: "center" }}
        >
          <input
            style={{ ...inputStyle, flex: "0 1 140px" }}
            placeholder={t("accounts.namePlaceholder")}
            aria-label={t("accounts.nameLabel")}
            data-omc-account-name=""
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            style={{ ...inputStyle, flex: "1 1 180px", fontFamily: T.mono }}
            placeholder={suggested || t("accounts.dirPlaceholder")}
            aria-label={t("accounts.dirLabel")}
            data-omc-account-dir=""
            value={draft.configDir}
            onChange={(e) => setDraft({ ...draft, configDir: e.target.value })}
          />
          <button
            type="submit"
            style={btnPrimary}
            disabled={busy || !draft.name.trim()}
            data-omc-account-add=""
          >
            {t("main.boxes.add")}
          </button>
          <button
            type="button"
            style={btn}
            data-omc-account-cancel=""
            onClick={() => setAdding(false)}
          >
            {t("cancel")}
          </button>
          <p style={{ ...meta, whiteSpace: "normal", flex: "1 1 100%", margin: 0 }}>
            {suggested ? t("accounts.formHint", { dir: suggested }) : t("accounts.formHintNoName")}
          </p>
        </form>
      ) : (
        <div style={{ ...row, flexWrap: "wrap" }}>
          <p style={{ ...meta, whiteSpace: "normal", flex: "1 1 220px", margin: 0 }}>
            {t("accounts.addHint")}
          </p>
          <button
            type="button"
            style={btn}
            disabled={busy}
            data-omc-account-open=""
            onClick={() => setAdding(true)}
          >
            {t("accounts.addAccount")}
          </button>
        </div>
      )}
    </div>
  );
}
