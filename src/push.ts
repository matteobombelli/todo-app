import type { PushSubscriptionBody } from "../shared/api";
import { api } from "./api/client";

export type PushState = "unsupported" | "denied" | "off" | "on";

// The service worker is only registered in production builds (pwa.tsx). iOS exposes PushManager
// only to an app added to the Home Screen.
const supported = () => import.meta.env.PROD && "serviceWorker" in navigator && "PushManager" in window;

// Not `navigator.serviceWorker.ready`, which never settles when no worker registered (registration
// failed, or storage is blocked): that hung Settings and logging out.
async function registration(): Promise<ServiceWorkerRegistration | null> {
  const found = await navigator.serviceWorker.getRegistration();
  if (!found) return null;
  // Registered but still installing: ready settles once it activates.
  return found.active ? found : navigator.serviceWorker.ready;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  return (await registration())?.pushManager.getSubscription() ?? null;
}

function save(subscription: PushSubscription): Promise<void> {
  return api("/push/subscribe", { body: subscription.toJSON() as PushSubscriptionBody });
}

export async function pushState(): Promise<PushState> {
  if (!supported() || !(await navigator.serviceWorker.getRegistration())) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

/** Must run from a tap: iOS only shows the permission prompt for a user gesture. */
export async function enablePush(): Promise<PushState> {
  if ((await Notification.requestPermission()) !== "granted") return pushState();
  const reg = await registration();
  if (!reg) return "unsupported";
  const { key } = await api<{ key: string }>("/push/key");
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await save(subscription);
  return "on";
}

/**
 * The browser unsubscribes first, so the device goes quiet even when the server can't be reached;
 * a row left behind is deleted the first time its push service answers 410.
 */
export async function disablePush(): Promise<void> {
  if (!supported()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  await subscription.unsubscribe();
  await api("/push/unsubscribe", { body: { endpoint: subscription.endpoint } }).catch(() => undefined);
}

/**
 * Re-sends this browser's subscription, in case the server dropped it or the browser rotated it.
 * Harmless when nothing changed: the server upserts by endpoint.
 */
export async function refreshPush(): Promise<void> {
  if (!supported() || Notification.permission !== "granted") return;
  const subscription = await currentSubscription();
  if (subscription) await save(subscription);
}
