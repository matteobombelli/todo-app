import { UNAUTHORIZED_EVENT } from "../api/client";
import { DataStore } from "./store";

const SYNC_INTERVAL_MS = 60_000;
const WRITE_DEBOUNCE_MS = 300;

let writeTimer: ReturnType<typeof setTimeout> | undefined;

export const store = new DataStore({
  onUnauthorized: () => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)),
  onWrite: () => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => void store.sync(), WRITE_DEBOUNCE_MS);
  },
});

// No Background Sync API (iOS lacks it): sync on start, on reconnect, on return to the app, and
// every minute while visible, so changes made through MCP show up without a reload.
export function startSyncLoop(): () => void {
  const run = () => void store.sync();
  // Leaving the app may be the last chance to sync for a while (iOS suspends it, and the write
  // debounce never fires): deletions waiting on their undo go through, then everything is sent.
  const onHide = () => {
    clearTimeout(writeTimer);
    void store.commitRemovals().then(run);
  };
  const whenVisible = () => {
    if (document.visibilityState === "visible") run();
    else onHide();
  };
  run();
  window.addEventListener("online", run);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", whenVisible);
  const timer = setInterval(() => document.visibilityState === "visible" && run(), SYNC_INTERVAL_MS);
  return () => {
    window.removeEventListener("online", run);
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", whenVisible);
    clearInterval(timer);
    clearTimeout(writeTimer);
  };
}
