// Loaded into the generated service worker with importScripts (vite.config.ts). Shows the reminders
// worker/services/push.ts sends, and opens the app where they point when tapped.
self.addEventListener("push", (event) => {
  // A push that isn't the server's JSON (a DevTools test, say) still shows something: Chrome warns
  // "site updated in the background" for a push that shows no notification.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data.text() };
  }
  const { title = "Todo", body, tag, url = "/" } = payload;
  event.waitUntil(self.registration.showNotification(title, { body, tag, icon: "/pwa-192.png", data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data.url, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(([open]) =>
      // navigate() rejects for a window this worker doesn't control yet (the first session after
      // install); that window is asked to go there itself (pwa.tsx).
      open
        ? open.focus().then((w) => w.navigate(url).catch(() => w.postMessage({ type: "navigate", url })))
        : self.clients.openWindow(url),
    ),
  );
});
