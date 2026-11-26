// The phone-notice service worker, served raw as JavaScript at PUSH_SW_PATH. It is a string rather
// than a .ts module because a browser loads a worker script by URL, on its own, outside the client
// bundle dsh concatenates; nothing here is type-checked, so it stays this small.
//
// push: show the notice, one per session (`tag`), replacing the older one.
// notificationclick: focus an open dsh tab and ask the plugin there to open the session, or open a
// new tab at /?omc-open=<id>, which the plugin's client reads on load.
/** The worker script. Uses only what every push-capable browser has; no imports. */
export const PUSH_SW_SOURCE = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  event.waitUntil(self.registration.showNotification(d.title || "Claude Code", {
    body: d.body || "",
    tag: d.session || "omc",
    renotify: true,
    icon: "/icon-192.png",
    data: { session: d.session || null },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const session = event.notification.data && event.notification.data.session;
  const url = new URL(session ? "/?omc-open=" + encodeURIComponent(session) : "/", self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs[0];
    if (tab) {
      await tab.focus();
      if (session) tab.postMessage({ omcOpen: session });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
`;
//# sourceMappingURL=push-sw.js.map