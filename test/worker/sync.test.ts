import { describe, expect, it } from "vitest";
import type { MutationResult, SyncResponse } from "../../shared/entities";
import { cookieHeader, jsonRequest, registerAndLogin, request } from "./helpers";

let userSeq = 0;
async function login() {
  return (await registerAndLogin(`sync${++userSeq}@example.com`)).cookie;
}

const id = () => crypto.randomUUID();

function list(overrides: Record<string, unknown> = {}) {
  return { id: id(), name: "Groceries", color: "green", sort_order: 0, ...overrides };
}

function item(listId: string, overrides: Record<string, unknown> = {}) {
  return { id: id(), list_id: listId, title: "Milk", notes: "", due_date: null, due_time: null, completed_at: null, ...overrides };
}

function upsert(entity: string, record: Record<string, unknown>, opId = id()) {
  return { op_id: opId, entity, action: "upsert", record };
}

function del(entity: string, recordId: string, opId = id()) {
  return { op_id: opId, entity, action: "delete", record: { id: recordId } };
}

async function mutate(cookie: string, mutations: unknown[]): Promise<MutationResult[]> {
  const res = await jsonRequest("/mutations", "POST", { mutations }, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: MutationResult[] }).results;
}

async function sync(cookie: string, since = 0): Promise<SyncResponse> {
  const res = await request(`/sync?since=${since}`, { headers: cookieHeader(cookie) });
  expect(res.status).toBe(200);
  return (await res.json()) as SyncResponse;
}

describe("sync and mutations", () => {
  it("requires a session", async () => {
    expect((await request("/sync")).status).toBe(401);
    expect((await jsonRequest("/mutations", "POST", { mutations: [] })).status).toBe(401);
  });

  it("applies upserts in order and returns increasing seqs", async () => {
    const cookie = await login();
    const l = list();
    const i = item(l.id, { due_date: "2026-09-22", due_time: "09:00" });
    const results = await mutate(cookie, [upsert("lists", l), upsert("items", i)]);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(results.map((r) => (r.status === "applied" ? r.seq : 0))).toEqual([1, 2]);

    const s = await sync(cookie);
    expect(s.cursor).toBe(2);
    expect(s.lists).toEqual([{ ...l, created_at: expect.any(Number), updated_at: expect.any(Number), seq: 1, deleted_at: null }]);
    expect(s.items[0]).toMatchObject({ ...i, seq: 2 });
    expect(s.events).toEqual([]);
  });

  it("returns only rows past the cursor, including tombstones", async () => {
    const cookie = await login();
    const a = list({ name: "A" });
    const b = list({ name: "B" });
    await mutate(cookie, [upsert("lists", a), upsert("lists", b)]);
    const first = await sync(cookie);

    await mutate(cookie, [upsert("lists", { ...a, name: "A2" }), del("lists", b.id)]);
    const next = await sync(cookie, first.cursor);
    expect(next.cursor).toBe(first.cursor + 2);
    expect(next.lists.map((l) => [l.name, l.deleted_at === null])).toEqual([
      ["A2", true],
      ["B", false],
    ]);
    // A first sync leaves tombstones out.
    expect((await sync(cookie)).lists.map((l) => l.name)).toEqual(["A2"]);
    expect((await sync(cookie, next.cursor)).lists).toEqual([]);
  });

  it("keeps created_at and updates updated_at on edit", async () => {
    const cookie = await login();
    const l = list();
    await mutate(cookie, [upsert("lists", l)]);
    const before = (await sync(cookie)).lists[0];
    await mutate(cookie, [upsert("lists", { ...l, color: "red" })]);
    const after = (await sync(cookie)).lists[0];
    expect(after.created_at).toBe(before.created_at);
    expect(after.updated_at).toBeGreaterThanOrEqual(before.updated_at);
    expect(after.color).toBe("red");
  });

  it("is idempotent by op_id", async () => {
    const cookie = await login();
    const l = list();
    const op = upsert("lists", l);
    const [first] = await mutate(cookie, [op]);
    const [again] = await mutate(cookie, [{ ...op, record: { ...l, name: "Changed" } }]);
    expect(again).toEqual(first);
    const s = await sync(cookie);
    expect(s.cursor).toBe(1);
    expect(s.lists[0].name).toBe("Groceries");
  });

  it("cascades a list deletion to its items", async () => {
    const cookie = await login();
    const l = list();
    const i1 = item(l.id);
    const i2 = item(l.id, { title: "Eggs" });
    await mutate(cookie, [upsert("lists", l), upsert("items", i1), upsert("items", i2)]);
    const { cursor } = await sync(cookie);
    const [res] = await mutate(cookie, [del("lists", l.id)]);
    expect(res).toEqual({ op_id: expect.any(String), status: "applied", seq: cursor + 1 });
    const s = await sync(cookie, cursor);
    expect(s.items.every((i) => i.deleted_at !== null && i.seq === cursor + 1)).toBe(true);
    expect(s.items).toHaveLength(2);
  });

  it("cascades an event deletion to its exceptions", async () => {
    const cookie = await login();
    const e = {
      id: id(),
      title: "Gym",
      notes: "",
      color: "blue",
      all_day: false,
      start_date: "2026-09-01",
      start_time: "07:00",
      end_date: "2026-09-01",
      end_time: "08:00",
      rrule: "FREQ=WEEKLY;BYDAY=TU,TH",
    };
    const x = {
      id: id(),
      event_id: e.id,
      occurrence_date: "2026-09-03",
      cancelled: true,
      title: null,
      notes: null,
      color: null,
      all_day: null,
      start_date: null,
      start_time: null,
      end_date: null,
      end_time: null,
    };
    await mutate(cookie, [upsert("events", e), upsert("event_exceptions", x)]);
    const s0 = await sync(cookie);
    expect(s0.events[0]).toMatchObject({ all_day: false, rrule: e.rrule });
    expect(s0.event_exceptions[0]).toMatchObject({ cancelled: true, all_day: null });

    // A second exception for the same occurrence is rejected.
    const [dup] = await mutate(cookie, [upsert("event_exceptions", { ...x, id: id() })]);
    expect(dup).toMatchObject({ status: "rejected", current: null });

    await mutate(cookie, [del("events", e.id)]);
    const s1 = await sync(cookie, s0.cursor);
    expect(s1.event_exceptions[0].deleted_at).not.toBeNull();
  });

  it("rejects invalid records and returns the server copy", async () => {
    const cookie = await login();
    const l = list();
    await mutate(cookie, [upsert("lists", l)]);
    const results = await mutate(cookie, [
      upsert("lists", { ...l, color: "chartreuse" }),
      upsert("items", item(l.id, { due_date: null, due_time: "09:00" })),
      upsert("items", item(id())),
      upsert("events", {
        id: id(),
        title: "Bad",
        notes: "",
        color: "blue",
        all_day: false,
        start_date: "2026-09-02",
        start_time: "10:00",
        end_date: "2026-09-01",
        end_time: "11:00",
        rrule: null,
      }),
      upsert("events", {
        id: id(),
        title: "Bad rule",
        notes: "",
        color: "blue",
        all_day: true,
        start_date: "2026-09-02",
        start_time: null,
        end_date: "2026-09-02",
        end_time: null,
        rrule: "FREQ=HOURLY",
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected"]);
    expect(results[0]).toMatchObject({ current: { id: l.id, color: "green" } });
    expect(results[2]).toMatchObject({ error: expect.stringContaining("list_id"), current: null });
    expect((await sync(cookie)).cursor).toBe(1);
  });

  it("lets a deletion win over a later edit", async () => {
    const cookie = await login();
    const l = list();
    await mutate(cookie, [upsert("lists", l), del("lists", l.id)]);
    const [edit] = await mutate(cookie, [upsert("lists", { ...l, name: "Back" })]);
    expect(edit).toMatchObject({ status: "rejected", error: "Deleted", current: { id: l.id, deleted_at: expect.any(Number) } });
    // Deleting again is a successful no-op.
    const [again] = await mutate(cookie, [del("lists", l.id)]);
    expect(again.status).toBe("applied");
  });

  it("rejects items added to a deleted list", async () => {
    const cookie = await login();
    const l = list();
    await mutate(cookie, [upsert("lists", l), del("lists", l.id)]);
    const [res] = await mutate(cookie, [upsert("items", item(l.id))]);
    expect(res.status).toBe("rejected");
  });

  it("checks that a subtask's parent is a top-level item in the same list", async () => {
    const cookie = await login();
    const home = list();
    const away = list();
    const parent = item(home.id);
    const child = item(home.id, { parent_id: parent.id });
    const withSubtask = item(home.id);
    const itsSubtask = item(home.id, { parent_id: withSubtask.id });
    await mutate(cookie, [upsert("lists", home), upsert("lists", away), upsert("items", parent), upsert("items", child), upsert("items", withSubtask), upsert("items", itsSubtask)]);

    const errors = async (record: Record<string, unknown>) => {
      const [result] = await mutate(cookie, [upsert("items", record)]);
      return result.status === "rejected" ? result.error : "applied";
    };
    expect(await errors(item(away.id, { parent_id: parent.id }))).toBe("parent_id names an item in another list");
    expect(await errors(item(home.id, { parent_id: child.id }))).toBe("parent_id names a subtask, and subtasks can't have their own");
    expect(await errors({ ...parent, parent_id: parent.id })).toBe("An item can't be its own subtask");
    expect(await errors({ ...withSubtask, parent_id: parent.id })).toBe("An item with subtasks can't become a subtask");
    expect(await errors(item(home.id, { parent_id: id() }))).toBe("parent_id does not name a live item");
    // A client from before subtasks leaves parent_id out, which makes a top-level item.
    expect(await errors(item(home.id))).toBe("applied");
  });

  it("carries subtasks along when their parent moves, completes or is deleted", async () => {
    const cookie = await login();
    const home = list();
    const away = list();
    const parent = item(home.id);
    const open = item(home.id, { parent_id: parent.id });
    const done = item(home.id, { parent_id: parent.id, completed_at: 7 });
    await mutate(cookie, [upsert("lists", home), upsert("lists", away), upsert("items", parent), upsert("items", open), upsert("items", done)]);
    const { cursor } = await sync(cookie);

    await mutate(cookie, [upsert("items", { ...parent, list_id: away.id, completed_at: 20 })]);
    const pulled = await sync(cookie, cursor);
    const byId = new Map(pulled.items.map((i) => [i.id, i]));
    expect(byId.get(open.id)).toMatchObject({ list_id: away.id, completed_at: 20, parent_id: parent.id });
    expect(byId.get(done.id)).toMatchObject({ list_id: away.id, completed_at: 7 });

    await mutate(cookie, [del("items", parent.id)]);
    const after = await sync(cookie, pulled.cursor);
    expect(after.items.filter((i) => i.deleted_at !== null).map((i) => i.id).sort()).toEqual([parent.id, open.id, done.id].sort());
  });

  it("isolates users", async () => {
    const alice = await login();
    const bob = await login();
    const l = list();
    const i = item(l.id);
    await mutate(alice, [upsert("lists", l), upsert("items", i)]);

    expect((await sync(bob)).lists).toEqual([]);
    const results = await mutate(bob, [
      upsert("lists", { ...l, name: "Stolen" }),
      del("items", i.id),
      upsert("items", item(l.id)),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(results.every((r) => r.status === "rejected" && r.current === null)).toBe(true);

    const s = await sync(alice);
    expect(s.lists[0].name).toBe("Groceries");
    expect(s.items[0].deleted_at).toBeNull();
    expect((await sync(bob)).cursor).toBe(0);
  });

  it("validates the batch shape and the cursor", async () => {
    const cookie = await login();
    expect((await jsonRequest("/mutations", "POST", { mutations: [] }, cookie)).status).toBe(400);
    expect((await jsonRequest("/mutations", "POST", { mutations: [{ op_id: "x" }] }, cookie)).status).toBe(400);
    expect((await request("/sync?since=-1", { headers: cookieHeader(cookie) })).status).toBe(400);
  });
});
