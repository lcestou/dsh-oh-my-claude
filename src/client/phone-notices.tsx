// Phone notices from the browser's side: the Settings block (switch, delay, this device's Web Push
// subscription, the device list, the webhook) and the watcher that opens the session a tapped
// notice names. The sending is the box's (src/adapter/notify.ts); this file only sets it up.
import { useCallback, useEffect, useState } from "react";
import { t, useLocale, activeLocale } from "./i18n.js";
import {
  ROUTE,
  T,
  btn,
  inputStyle,
  nested,
  readJson,
  select,
  openSession,
  whenContextGone,
} from "./shared.js";
import type { ClientCtx } from "./shared.js";
import { subscribe } from "./events.js";
import { useHintFlag, useHintValue } from "./hints.js";
import { Switch } from "./switch.js";

/** The worker and its scope. The scope covers no dsh page on purpose: push needs no controlled page,
 *  and a worker over dsh's own pages would sit in front of every request dsh makes. */
const SW_URL = `${ROUTE}/push/sw.js`;
const SW_SCOPE = `${ROUTE}/push/`;

/** The query the worker opens a new tab with; read and dropped on load. */
const OPEN_PARAM = "omc-open";

/** The delays the select offers, the server's NOTIFY_DELAY_CHOICES; 60 s is the default. */
const DELAYS = [0, 30_000, 60_000, 300_000] as const;
const DELAY_DEFAULT = 60_000;

/** ntfy's own inline-template form, a URL and not prose, so it is shown as written in both languages. */
const NTFY_EXAMPLE = "https://ntfy.sh/<your-topic>?tpl=1&t={{.title}}&m={{.message}}";

/** A device row as `GET /notify` lists it. */
interface DeviceRow {
  id: string;
  service: string;
  added: number;
}

/** What `GET /notify` and every write answer. */
interface NotifyState {
  webhookUrl: string | null;
  openUrl: string | null;
  devices: Array<DeviceRow>;
}

/** What the test button gets back. */
export interface TestReport {
  webhook: string;
  sent: number;
  failed: number;
  removed: number;
}

/** Whether this page can hold a push subscription at all: a secure context (HTTPS or localhost)
 *  with the three APIs. False on plain-HTTP LAN dsh, and in iOS Safari outside a Home Screen app. */
const pushSupported = (): boolean =>
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** A base64url string as bytes, the form `applicationServerKey` takes. */
const fromB64u = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

/** Resolve once `reg` has an active worker. `serviceWorker.ready` cannot be used: it waits for a
 *  worker controlling this page, and this scope controls none, so it would never resolve. */
function activeWorker(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) {
    return Promise.resolve();
  }

  const sw = reg.installing ?? reg.waiting;

  if (!sw) {
    return Promise.reject(new Error(t("main.phone.noWorker")));
  }

  return new Promise((resolve, reject) => {
    sw.addEventListener("statechange", () => {
      if (sw.state === "activated") {
        resolve();
      } else if (sw.state === "redundant") {
        reject(new Error(t("main.phone.noWorker")));
      }
    });
  });
}

/** This browser's current subscription under the worker's scope, or null. */
async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) {
    return null;
  }

  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);

  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** The id the box gives an endpoint (first 16 hex of its SHA-256), to mark this device's row. */
async function idOf(endpoint: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));

  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** Ask the box for `path` and read the JSON; a refusal rejects with the box's own sentence. */
const call = <R,>(path: string, init?: RequestInit): Promise<R> =>
  fetch(`${ROUTE}${path}`, init).then((r) => readJson<R>(r));

/** The two bodies this block sends: the webhook form, and a browser's push subscription. */
type NotifyBody = { webhookUrl: string; openUrl: string } | PushSubscriptionJSON;

/** A JSON request with `body`, for `call`. */
const jsonInit = (method: string, body: NotifyBody): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** The delay as the select shows it, the default named. */
export function delayLabel(ms: number): string {
  const text =
    ms === 0
      ? t("main.phone.delayNow")
      : ms < 60_000
        ? t("main.phone.delaySeconds", { n: ms / 1000 })
        : t(ms === 60_000 ? "main.settingsUi.minuteOne" : "main.settingsUi.minuteOther", {
            n: ms / 60_000,
          });

  return ms === DELAY_DEFAULT ? t("main.settingsUi.defaultSuffix", { text }) : text;
}

/** The test report as one sentence per channel that was tried. */
export function testSentence(r: TestReport): string {
  const total = r.sent + r.failed + r.removed;

  if (total === 0 && r.webhook === "none") {
    return t("main.phone.testNothing");
  }

  const parts: Array<string> = [];

  if (total > 0) {
    parts.push(t("main.phone.testDevices", { n: r.sent, total }));
  }

  if (r.webhook === "ok") {
    parts.push(t("main.phone.testWebhookOk"));
  } else if (r.webhook !== "none") {
    parts.push(t("main.phone.testWebhookFailed", { error: r.webhook }));
  }

  return parts.join(" ");
}

/**
 * The Settings block. The switch and the delay are hints (box-wide); the webhook and the devices
 * are `/notify` state, re-read whenever any tab or the phone changes them (the `notify` event), so
 * a phone subscribing while this is open shows up here without a reload. Subscribing is per
 * browser by nature: it is the one part that only acts on the browser it is clicked in.
 */
export function PhoneNoticesBlock() {
  useLocale();
  const [on, setOn] = useHintFlag("notifyOn");
  const [storedDelay, setStoredDelay] = useHintValue("notifyDelayMs");
  const delay = DELAYS.find((ms) => ms === storedDelay) ?? DELAY_DEFAULT;
  const [state, setState] = useState<NotifyState | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [hook, setHook] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();
  const blocked = supported && Notification.permission === "denied";

  /** Re-read the box's list and this browser's subscription. `reseed` also puts the saved webhook
   *  in the field: true on open and after a save, false on another tab's change, so a URL being
   *  typed here is not wiped when a phone subscribes elsewhere. */
  const load = useCallback(async (reseed: boolean) => {
    const next = await call<NotifyState>("/notify");
    setState(next);

    if (reseed) {
      setHook(next.webhookUrl ?? "");
    }

    const sub = await currentSubscription();
    setMine(sub ? await idOf(sub.endpoint) : null);
  }, []);

  useEffect(() => {
    if (!on) {
      return;
    }

    void load(true).catch((error: Error) => setStatus(error.message));

    return subscribe("notify", () => void load(false).catch(() => {}));
  }, [on, load]);

  /** Run one button's job with the buttons disabled; its string, or its error, goes to the status
   *  line. */
  const run = (job: () => Promise<string | void>) => {
    setBusy(true);
    setStatus("");
    void job()
      .then((msg) => msg && setStatus(msg))
      .catch((error: Error) => setStatus(error.message))
      .finally(() => setBusy(false));
  };

  /** Subscribe this browser and send the subscription to the box. */
  const addThis = () =>
    run(async () => {
      if ((await Notification.requestPermission()) !== "granted") {
        return t("main.phone.deviceBlocked");
      }

      try {
        const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
        await activeWorker(reg);
        // A subscription left from an older key pair (push-vapid.json was replaced) makes
        // subscribe() throw InvalidStateError; this browser is not on the list, so it is stale.
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        const { publicKey } = await call<{ publicKey: string }>("/notify/push-key");

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: fromB64u(publicKey),
        });

        const j = sub.toJSON();
        await call<NotifyState>(
          "/notify/devices",
          jsonInit("POST", { endpoint: j.endpoint, keys: j.keys }),
        );
      } catch (error) {
        return t("main.phone.deviceFailed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await load(false);
    });

  /** Take this browser off the box's list and end its subscription. */
  const dropThis = () =>
    run(async () => {
      const sub = await currentSubscription();

      if (sub) {
        await call<NotifyState>(`/notify/devices?id=${await idOf(sub.endpoint)}`, {
          method: "DELETE",
        });
        await sub.unsubscribe();
      }

      await load(false);
    });

  /** Delete one row; this browser's own row also ends its subscription. */
  const remove = (id: string) =>
    run(async () => {
      await call<NotifyState>(`/notify/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" });

      // Removing this browser's row from the list also ends its subscription, or the browser would
      // keep a subscription the box no longer sends to and the button would say Stop.
      if (id === mine) {
        await (await currentSubscription())?.unsubscribe();
      }

      await load(false);
    });

  /** Save the webhook with this browser's origin as the address its links open at. */
  const save = () =>
    run(async () => {
      await call<NotifyState>(
        "/notify",
        jsonInit("PUT", { webhookUrl: hook.trim(), openUrl: location.origin }),
      );
      await load(true);

      return t("main.phone.webhookSaved");
    });

  /** Send one notice everywhere now and say what took it. */
  const test = () =>
    run(async () => {
      // A test sent before any save still links to this browser's address.
      if (state?.openUrl == null) {
        await call<NotifyState>(
          "/notify",
          jsonInit("PUT", { webhookUrl: state?.webhookUrl ?? "", openUrl: location.origin }),
        );
      }

      return testSentence(await call<TestReport>("/notify/test", { method: "POST" }));
    });

  const row = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } as const;
  const head = { color: T.muted, fontSize: 12, marginTop: 10, marginBottom: 4 } as const;

  return (
    <>
      <div
        data-omc-phone-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: on ? 4 : 12,
        }}
      >
        <div>
          <div>{t("main.phone.title")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.phone.desc")}</div>
        </div>
        <Switch on={on} onChange={setOn} label={t("main.phone.title")} />
      </div>
      {/* Only with the feature on: setting up a channel for something that never fires is noise. */}
      {on && (
        <div data-omc-phone-options="" style={{ ...nested, marginBottom: 12, fontSize: 13 }}>
          <label style={row}>
            <span style={{ color: T.muted }}>{t("main.phone.delayLabel")}</span>
            <select
              data-omc-phone-delay=""
              style={select}
              aria-label={t("main.phone.delayAria")}
              value={String(delay)}
              // The default is stored as absence, the rule the recap's bar follows.
              onChange={(e) => {
                const next = Number(e.target.value);
                setStoredDelay(next === DELAY_DEFAULT ? null : next);
              }}
            >
              {DELAYS.map((ms) => (
                <option key={ms} value={String(ms)}>
                  {delayLabel(ms)}
                </option>
              ))}
            </select>
          </label>
          <div style={{ color: T.faint, fontSize: 12, marginTop: 2 }}>
            {t("main.phone.delayHint")}
          </div>

          <div style={head}>{t("main.phone.deviceHead")}</div>
          {supported ? (
            <div style={row}>
              <button
                type="button"
                data-omc-phone-device=""
                style={btn}
                disabled={busy || blocked}
                onClick={mine ? dropThis : addThis}
              >
                {mine ? t("main.phone.deviceOff") : t("main.phone.deviceOn")}
              </button>
              {blocked && (
                <span style={{ color: T.faint, fontSize: 12 }}>
                  {t("main.phone.deviceBlocked")}
                </span>
              )}
            </div>
          ) : (
            <div data-omc-phone-no-push="" style={{ color: T.faint, fontSize: 12 }}>
              {t("main.phone.deviceNoApi")}
            </div>
          )}

          <div style={head}>{t("main.phone.devicesHead")}</div>
          {state && state.devices.length === 0 && (
            <div style={{ color: T.faint, fontSize: 12 }}>{t("main.phone.devicesEmpty")}</div>
          )}
          {state && state.devices.length > 0 && (
            <ul data-omc-phone-devices="" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {state.devices.map((d) => {
                const date = new Date(d.added).toLocaleDateString(activeLocale());

                return (
                  <li
                    key={d.id}
                    data-omc-phone-device-row={d.id}
                    style={{ ...row, padding: "2px 0" }}
                  >
                    <span>
                      {t("main.phone.deviceRow", { service: d.service, date })}
                      {d.id === mine && ` ${t("main.phone.thisDeviceMark")}`}
                    </span>
                    <button
                      type="button"
                      style={{ ...btn, fontSize: 12, padding: "2px 10px" }}
                      disabled={busy}
                      aria-label={t("main.phone.removeAria", { service: d.service, date })}
                      onClick={() => remove(d.id)}
                    >
                      {t("delete")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div style={head}>{t("main.phone.webhookHead")}</div>
          <div style={row}>
            <input
              data-omc-phone-webhook=""
              type="url"
              style={{ ...inputStyle, flex: "1 1 240px" }}
              aria-label={t("main.phone.webhookLabel")}
              value={hook}
              onChange={(e) => setHook(e.target.value)}
            />
            <button type="button" data-omc-phone-save="" style={btn} disabled={busy} onClick={save}>
              {t("save")}
            </button>
          </div>
          <div style={{ color: T.faint, fontSize: 12, marginTop: 2 }}>
            {t("main.phone.webhookHint")}{" "}
            <code style={{ wordBreak: "break-all" }}>{NTFY_EXAMPLE}</code>
          </div>

          <div style={{ ...row, marginTop: 10 }}>
            <button type="button" data-omc-phone-test="" style={btn} disabled={busy} onClick={test}>
              {t("main.phone.test")}
            </button>
          </div>
          <output
            data-omc-phone-status=""
            aria-live="polite"
            style={{ display: "block", margin: "6px 0 0", fontSize: 12, color: T.muted }}
          >
            {status}
          </output>
        </div>
      )}
    </>
  );
}

/**
 * Open the session a tapped notice names. Two ways in: a new tab the worker opened at
 * `/?omc-open=<id>` (read once here, then dropped from the address so a reload does not reopen it),
 * and a message the worker posts to a dsh tab that was already open. Waits for dsh's session list
 * before opening, since a fresh tab may not have one yet; gives up after ten seconds.
 */
export function watchPhoneOpen(ctx: ClientCtx): void {
  /** Open `id` once dsh's session list exists, checking every 100 ms for up to 10 s. */
  const open = (id: string) => {
    let tries = 0;

    /** One check; schedules the next until the list is there or the tries run out. */
    const tick = () => {
      if (ctx.sessions.list.getSnapshot()) {
        return openSession(ctx, id);
      }

      if (++tries < 100) {
        setTimeout(tick, 100);
      }
    };

    tick();
  };

  const url = new URL(location.href);
  const id = url.searchParams.get(OPEN_PARAM);

  if (id) {
    url.searchParams.delete(OPEN_PARAM);
    history.replaceState(history.state, "", url.href);
    open(id);
  }

  if (!("serviceWorker" in navigator)) {
    return;
  }

  // The only sender on this scope is the plugin's own worker, which posts `{ omcOpen: id }`.
  /** A tapped notice's session, posted by the worker to this open tab. */
  const onMessage = (e: MessageEvent<{ omcOpen?: string } | null>) => {
    const target = e.data?.omcOpen;

    if (target) {
      open(String(target));
    }
  };

  navigator.serviceWorker.addEventListener("message", onMessage);
  whenContextGone(() => navigator.serviceWorker.removeEventListener("message", onMessage));
}
