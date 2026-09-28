import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import { addDays, nowIn, toDayNumber, toMinutes } from "../../shared/dates";
import type { Item } from "../../shared/entities";
import { occurrencesInRange } from "../../shared/recurrence";
import { listRecords, toRecord } from "./records";

// Push services require a contact in the VAPID token; a URL keeps an email address out of it.
const VAPID_SUBJECT = "https://todo.matteob.dev";
// Reminders due this many minutes back still go out, covering a late or skipped cron run.
// push_sent keeps the overlapping windows from notifying twice.
const WINDOW_MINUTES = 5;
const SENT_TTL_MS = 24 * 60 * 60 * 1000;
// A device offline for longer than this gets no stale reminder when it reconnects.
const PUSH_TTL_SECONDS = 60 * 60;

export interface Reminder {
  userId: string;
  /** Identifies the reminder in push_sent and as the notification tag. */
  key: string;
  title: string;
  body: string;
  url: string;
}

interface PushUser {
  id: string;
  timezone: string;
  event_reminder_minutes: number;
}

interface SubscriptionRow {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
}

/** A floating date and time as minutes on one continuous wall-clock scale. */
function minuteOf(date: string, time: string): number {
  return toDayNumber(date) * 1440 + toMinutes(time);
}

/** Reminders due at `at` for every user with a push subscription, minus those already sent. */
export async function dueReminders(db: D1Database, at: Date): Promise<Reminder[]> {
  const { results: users } = await db
    .prepare("SELECT id, timezone, event_reminder_minutes FROM users WHERE id IN (SELECT user_id FROM push_subscriptions)")
    .all<PushUser>();
  const out: Reminder[] = [];
  for (const user of users) out.push(...(await userReminders(db, user, at)));
  return out;
}

async function userReminders(db: D1Database, user: PushUser, at: Date): Promise<Reminder[]> {
  const now = nowIn(user.timezone, at);
  const end = minuteOf(now.date, now.time);
  const due = (date: string, time: string, lead = 0) => {
    const m = minuteOf(date, time) - lead;
    return m > end - WINDOW_MINUTES && m <= end;
  };
  // The window reaches back into yesterday at most, and a lead time (up to an hour) into tomorrow.
  const yesterday = addDays(now.date, -1);
  const lead = user.event_reminder_minutes;

  const [itemRows, events, exceptions, sentRows] = await Promise.all([
    db
      .prepare(
        `SELECT i.*, l.name AS list_name FROM items i JOIN lists l ON l.id = i.list_id
         WHERE i.user_id = ? AND i.deleted_at IS NULL AND i.completed_at IS NULL AND i.due_time IS NOT NULL
           AND i.due_date BETWEEN ? AND ?`,
      )
      .bind(user.id, yesterday, now.date)
      .all<Record<string, unknown> & { list_name: string }>(),
    listRecords(db, user.id, "events"),
    listRecords(db, user.id, "event_exceptions"),
    db.prepare("SELECT key FROM push_sent WHERE user_id = ?").bind(user.id).all<{ key: string }>(),
  ]);
  const sent = new Set(sentRows.results.map((r) => r.key));
  const out: Reminder[] = [];

  for (const { list_name, ...row } of itemRows.results) {
    const item = toRecord<"items">(row) as Item & { due_date: string; due_time: string };
    if (!due(item.due_date, item.due_time)) continue;
    out.push({
      userId: user.id,
      key: `item:${item.id}:${item.due_date}T${item.due_time}`,
      title: item.title,
      body: `Due ${item.due_time} · ${list_name}`,
      url: `/todo/${item.list_id}`,
    });
  }

  for (const o of occurrencesInRange(events, exceptions, yesterday, addDays(now.date, 1))) {
    if (o.all_day || o.start_time === null || !due(o.start_date, o.start_time, lead)) continue;
    const span = `${o.start_time}–${o.end_time}`;
    out.push({
      userId: user.id,
      key: `event:${o.event_id}:${o.occurrence_date}:${o.start_date}T${o.start_time}`,
      title: o.title,
      body: lead ? `In ${lead} min · ${span}` : span,
      url: "/calendar",
    });
  }

  return out.filter((r) => !sent.has(r.key));
}

/** The cron job: sends every due reminder to each of its user's subscribed browsers. */
export async function sendReminders(env: Env, at: Date): Promise<void> {
  await env.DB.prepare("DELETE FROM push_sent WHERE sent_at < ?").bind(at.getTime() - SENT_TTL_MS).run();
  const reminders = await dueReminders(env.DB, at);
  if (!reminders.length) return;
  // Recorded before sending, so a failed send is dropped instead of retried every minute. Only the
  // inserts that took are sent: an overlapping run may have claimed the rest.
  const claimed = await env.DB.batch(
    reminders.map((r) =>
      env.DB.prepare("INSERT OR IGNORE INTO push_sent (user_id, key, sent_at) VALUES (?, ?, ?)").bind(r.userId, r.key, at.getTime()),
    ),
  );
  const toSend = reminders.filter((_, i) => claimed[i].meta.changes === 1);

  const { results: subscriptions } = await env.DB.prepare("SELECT endpoint, user_id, p256dh, auth FROM push_subscriptions").all<SubscriptionRow>();
  const vapid: VapidKeys = { subject: VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const sends = toSend.flatMap((r) => subscriptions.filter((s) => s.user_id === r.userId).map((s) => send(env.DB, vapid, s, r)));
  for (const result of await Promise.allSettled(sends)) {
    if (result.status === "rejected") console.error("push failed", result.reason);
  }
}

async function send(db: D1Database, vapid: VapidKeys, sub: SubscriptionRow, r: Reminder): Promise<void> {
  const payload = await buildPushPayload(
    { data: { title: r.title, body: r.body, tag: r.key, url: r.url }, options: { ttl: PUSH_TTL_SECONDS, urgency: "high" } },
    { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    vapid,
  );
  const res = await fetch(sub.endpoint, payload);
  // The browser dropped the subscription (permission revoked, app uninstalled).
  if (res.status === 404 || res.status === 410) {
    await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
  } else if (!res.ok) {
    console.error("push rejected", res.status, await res.text());
  }
}
