// Loaded into the generated service worker with importScripts (vite.config.ts). Shows the reminders
// worker/services/push.ts sends, and opens the app where they point when tapped.
self.addEventListener("push", (event) => {
  const { title, body, tag, url } = event.data.json();
  event.waitUntil(self.registration.showNotification(title, { body, tag, icon: "/pwa-192.png", data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data.url, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(([open]) =>
      // navigate() rejects for a window this worker doesn't control yet; it is still focused.
      open ? open.focus().then((w) => w.navigate(url).catch(() => w)) : self.clients.openWindow(url),
    ),
  );
});
