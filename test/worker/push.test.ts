import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dueReminders, sendReminders } from "../../worker/services/push";
import { jsonRequest, registerAndLogin, request } from "./helpers";

let userSeq = 0;
const id = () => crypto.randomUUID();

/** A user in Europe/Rome (UTC+2 in September) with one subscription and one list. */
async function setup(settings: Record<string, unknown> = {}) {
  const { cookie, user } = await registerAndLogin(`push${++userSeq}@example.com`);
  await jsonRequest("/settings", "PATCH", { timezone: "Europe/Rome", ...settings }, cookie);
  const endpoint = `https://push.example.com/${id()}`;
  expect((await jsonRequest("/push/subscribe", "POST", await subscription(endpoint), cookie)).status).toBe(204);
  const listId = id();
  await mutate(cookie, [upsert("lists", { id: listId, name: "Errands", color: "green", sort_order: 0 })]);
  return { cookie, userId: user.id, endpoint, listId };
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What a browser's PushSubscription.toJSON() gives, with real keys so encryption succeeds. */
async function subscription(endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = b64url((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return { endpoint, keys: { p256dh, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
}

function upsert(entity: string, record: Record<string, unknown>) {
  return { op_id: id(), entity, action: "upsert", record };
}

async function mutate(cookie: string, mutations: unknown[]) {
  const res = await jsonRequest("/mutations", "POST", { mutations }, cookie);
  const { results } = (await res.json()) as { results: { status: string }[] };
  expect(results.every((r) => r.status === "applied")).toBe(true);
}

function item(listId: string, overrides: Record<string, unknown>) {
  return { id: id(), list_id: listId, title: "Call the bank", notes: "", due_date: null, due_time: null, completed_at: null, ...overrides };
}

function event(overrides: Record<string, unknown>) {
  return { id: id(), title: "Standup", notes: "", color: "blue", all_day: false, rrule: null, ...overrides };
}

async function remindersFor(userId: string, at: string) {
  return (await dueReminders(env.DB, new Date(at))).filter((r) => r.userId === userId);
}

describe("push routes", () => {
  it("require a session", async () => {
    expect((await request("/push/key")).status).toBe(401);
    expect((await jsonRequest("/push/subscribe", "POST", await subscription("https://push.example.com/x"))).status).toBe(401);
    expect((await jsonRequest("/push/unsubscribe", "POST", { endpoint: "https://push.example.com/x" })).status).toBe(401);
  });

  it("hands out the public key", async () => {
    const { cookie } = await setup();
    const res = await request("/push/key", { headers: { Cookie: cookie } });
    expect(await res.json()).toEqual({ key: env.VAPID_PUBLIC_KEY });
  });

  it("rejects a non-https endpoint", async () => {
    const { cookie } = await setup();
    const res = await jsonRequest("/push/subscribe", "POST", await subscription("http://push.example.com/x"), cookie);
    expect(res.status).toBe(400);
  });

  it("moves an endpoint to the account that subscribed it last, and only its owner can remove it", async () => {
    const a = await setup();
    const b = await setup();
    await jsonRequest("/push/subscribe", "POST", await subscription(a.endpoint), b.cookie);
    const owner = () =>
      env.DB.prepare("SELECT user_id FROM push_subscriptions WHERE endpoint = ?").bind(a.endpoint).first<{ user_id: string }>();
    expect((await owner())?.user_id).toBe(b.userId);

    await jsonRequest("/push/unsubscribe", "POST", { endpoint: a.endpoint }, a.cookie);
    expect(await owner()).not.toBeNull();
    await jsonRequest("/push/unsubscribe", "POST", { endpoint: a.endpoint }, b.cookie);
    expect(await owner()).toBeNull();
  });
});

describe("dueReminders", () => {
  it("finds an open timed item at its due time in the user's timezone, for five minutes", async () => {
    const { cookie, userId, listId } = await setup({ item_reminder_time: null });
    const due = item(listId, { due_date: "2026-09-26", due_time: "09:00" });
    await mutate(cookie, [
      upsert("items", due),
      upsert("items", item(listId, { due_date: "2026-09-26", due_time: "09:00", completed_at: 1 })),
      upsert("items", item(listId, { due_date: "2026-09-26", due_time: null })),
    ]);
    expect(await remindersFor(userId, "2026-09-26T06:59:00Z")).toEqual([]);
    const expected = {
      userId,
      key: `item:${due.id}:2026-09-26T09:00`,
      title: "Call the bank",
      body: "Due 09:00 · Errands",
      url: `/todo/${listId}`,
    };
    expect(await remindersFor(userId, "2026-09-26T07:00:00Z")).toEqual([expected]);
    expect(await remindersFor(userId, "2026-09-26T07:04:00Z")).toEqual([expected]);
    expect(await remindersFor(userId, "2026-09-26T07:05:00Z")).toEqual([]);
  });

  it("reminds of an item due on a date alone at the user's item reminder time, by default 09:00", async () => {
    const { cookie, userId, listId } = await setup();
    const due = item(listId, { due_date: "2026-09-26" });
    await mutate(cookie, [upsert("items", due), upsert("items", item(listId, { due_date: "2026-09-27" }))]);
    // 09:00 in Rome.
    expect(await remindersFor(userId, "2026-09-26T07:00:00Z")).toEqual([
      { userId, key: `item:${due.id}:2026-09-26Tday`, title: "Call the bank", body: "Due today · Errands", url: `/todo/${listId}` },
    ]);

    await jsonRequest("/settings", "PATCH", { item_reminder_time: "18:00" }, cookie);
    expect(await remindersFor(userId, "2026-09-26T07:00:00Z")).toEqual([]);
    expect((await remindersFor(userId, "2026-09-26T16:00:00Z")).map((r) => r.key)).toEqual([`item:${due.id}:2026-09-26Tday`]);

    await jsonRequest("/settings", "PATCH", { item_reminder_time: null }, cookie);
    expect(await remindersFor(userId, "2026-09-26T16:00:00Z")).toEqual([]);
  });

  it("skips users without a subscription", async () => {
    const { cookie, userId, endpoint, listId } = await setup();
    await mutate(cookie, [upsert("items", item(listId, { due_date: "2026-09-26", due_time: "09:00" }))]);
    await jsonRequest("/push/unsubscribe", "POST", { endpoint }, cookie);
    expect(await remindersFor(userId, "2026-09-26T07:00:00Z")).toEqual([]);
  });

  it("reminds of an event the lead time early, across midnight", async () => {
    const { cookie, userId } = await setup({ event_reminder_minutes: 30 });
    const e = event({ start_date: "2026-09-27", start_time: "00:15", end_date: "2026-09-27", end_time: "01:00" });
    await mutate(cookie, [upsert("events", e)]);
    // 23:45 in Rome on the 26th.
    expect(await remindersFor(userId, "2026-09-26T21:45:00Z")).toEqual([
      {
        userId,
        key: `event:${e.id}:2026-09-27:2026-09-27T00:15`,
        title: "Standup",
        body: "In 30 min · 00:15–01:00",
        url: "/calendar",
      },
    ]);
  });

  it("follows recurrence and cancelled occurrences, and ignores all-day events", async () => {
    const { cookie, userId } = await setup();
    const e = event({ start_date: "2026-09-01", start_time: "08:00", end_date: "2026-09-01", end_time: "08:15", rrule: "FREQ=DAILY" });
    await mutate(cookie, [
      upsert("events", e),
      upsert("events", event({ all_day: true, start_date: "2026-09-26", start_time: null, end_date: "2026-09-26", end_time: null })),
      upsert("event_exceptions", {
        id: id(),
        event_id: e.id,
        occurrence_date: "2026-09-26",
        cancelled: true,
        title: null,
        notes: null,
        color: null,
        all_day: null,
        start_date: null,
        start_time: null,
        end_date: null,
        end_time: null,
      }),
    ]);
    expect(await remindersFor(userId, "2026-09-26T06:00:00Z")).toEqual([]);
    expect((await remindersFor(userId, "2026-09-27T06:00:00Z")).map((r) => r.key)).toEqual([
      `event:${e.id}:2026-09-27:2026-09-27T08:00`,
    ]);
  });
});

describe("sendReminders", () => {
  afterEach(() => vi.restoreAllMocks());

  it("pushes once per reminder, re-notifies a rescheduled item, and drops gone subscriptions", async () => {
    const { cookie, userId, endpoint, listId } = await setup();
    const gone = `https://push.example.com/${id()}`;
    await jsonRequest("/push/subscribe", "POST", await subscription(gone), cookie);
    const due = item(listId, { due_date: "2026-09-26", due_time: "09:00" });
    await mutate(cookie, [upsert("items", due)]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => new Response(null, { status: String(input) === gone ? 410 : 201 }));
    const pushedTo = () => fetchSpy.mock.calls.map(([input]) => String(input)).filter((url) => url === endpoint || url === gone);

    await sendReminders(env, new Date("2026-09-26T07:00:00Z"));
    expect(pushedTo().sort()).toEqual([endpoint, gone].sort());
    const init = fetchSpy.mock.calls.find(([input]) => String(input) === endpoint)![1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${env.VAPID_PUBLIC_KEY}$`));
    expect(init.headers["content-encoding"]).toBe("aes128gcm");
    expect(
      await env.DB.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id = ?").bind(userId).all(),
    ).toMatchObject({ results: [{ endpoint }] });

    fetchSpy.mockClear();
    await sendReminders(env, new Date("2026-09-26T07:01:00Z"));
    expect(pushedTo()).toEqual([]);

    await mutate(cookie, [upsert("items", { ...due, due_time: "09:30" })]);
    await sendReminders(env, new Date("2026-09-26T07:30:00Z"));
    expect(pushedTo()).toEqual([endpoint]);
  });

  it("sends once when two runs overlap", async () => {
    const { cookie, endpoint, listId } = await setup();
    await mutate(cookie, [upsert("items", item(listId, { due_date: "2026-09-26", due_time: "10:00" }))]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 201 }));
    const at = new Date("2026-09-26T08:00:00Z");
    await Promise.all([sendReminders(env, at), sendReminders(env, at)]);
    expect(fetchSpy.mock.calls.filter(([input]) => String(input) === endpoint)).toHaveLength(1);
  });
});
