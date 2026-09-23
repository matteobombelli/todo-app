import { useEffect, useState } from "react";
import { Workbox } from "workbox-window";

/**
 * Registers the service worker and offers a reload once a new version is waiting. updateViaCache
 * "none" makes the browser fetch sw.js past the HTTP cache, so a deploy is noticed on the next check.
 */
export function UpdateToast() {
  const [wb, setWb] = useState<Workbox | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const workbox = new Workbox("/sw.js", { scope: "/", updateViaCache: "none" });
    workbox.addEventListener("waiting", () => setWaiting(true));
    workbox.addEventListener("controlling", () => window.location.reload());
    void workbox.register();
    setWb(workbox);
    // An installed app can stay open for days; look for a deploy whenever it comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible") void workbox.update();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (!waiting || !wb) return null;
  return (
    <div className="toast" role="status">
      New version available
      <button type="button" className="button--primary" onClick={() => wb.messageSkipWaiting()}>
        Reload
      </button>
    </div>
  );
}
