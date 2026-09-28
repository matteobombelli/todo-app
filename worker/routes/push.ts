import { PushSubscriptionBody, PushUnsubscribeBody } from "../../shared/api";
import { requireUser } from "../auth/session";
import { json, parseJson } from "../http";
import type { Router } from "../router";

export function registerPushRoutes(r: Router): void {
  r.get("/push/key", async (c) => {
    await requireUser(c);
    return json({ key: c.env.VAPID_PUBLIC_KEY });
  });

  r.post("/push/subscribe", async (c) => {
    const user = await requireUser(c);
    const { endpoint, keys } = await parseJson(c.req, PushSubscriptionBody);
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
      .bind(endpoint, user.id, keys.p256dh, keys.auth, Date.now())
      .run();
    return new Response(null, { status: 204 });
  });

  r.post("/push/unsubscribe", async (c) => {
    const user = await requireUser(c);
    const { endpoint } = await parseJson(c.req, PushUnsubscribeBody);
    await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, user.id).run();
    return new Response(null, { status: 204 });
  });
}
