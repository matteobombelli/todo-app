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
  const whenVisible = () => {
    if (document.visibilityState === "visible") run();
  };
  run();
  window.addEventListener("online", run);
  document.addEventListener("visibilitychange", whenVisible);
  const timer = setInterval(whenVisible, SYNC_INTERVAL_MS);
  return () => {
    window.removeEventListener("online", run);
    document.removeEventListener("visibilitychange", whenVisible);
    clearInterval(timer);
  };
}
