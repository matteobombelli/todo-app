import { useEffect, useState } from "react";

/**
 * Registers the service worker and offers a reload once a new version is waiting. updateViaCache
 * "none" makes the browser fetch sw.js past the HTTP cache, so a deploy is noticed on the next check.
 *
 * Uses the plain service worker API rather than workbox-window, which stops listening for updates
 * once it sees one it didn't start (any found over a minute after load), so an app left open missed
 * every deploy after the first.
 */
export function UpdateToast() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    let reloading = false;
    // The generated worker never claims clients, so the controller only changes after SKIP_WAITING.
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    container.addEventListener("controllerchange", onControllerChange);

    let registration: ServiceWorkerRegistration | undefined;
    const watch = (sw: ServiceWorker) => {
      sw.addEventListener("statechange", () => {
        // Without a controller this is the first install, which activates on its own.
        if (sw.state === "installed" && registration?.waiting === sw && container.controller) setWaiting(sw);
        if (sw.state === "redundant") setWaiting((current) => (current === sw ? null : current));
      });
    };
    void container.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((reg) => {
      registration = reg;
      // A version left waiting from an earlier visit: the app has only just opened, so take it now.
      if (reg.waiting && container.controller) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      if (reg.installing) watch(reg.installing);
      reg.addEventListener("updatefound", () => {
        if (reg.installing) watch(reg.installing);
      });
    });

    // An installed app can stay open for days; look for a deploy whenever it comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      container.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div className="toast" role="status">
      New version available
      <button type="button" className="button--primary" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>
        Reload
      </button>
    </div>
  );
}
