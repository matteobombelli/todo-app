import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { Item, List, MutationResult, SyncResponse } from "../../../shared/entities";
import { DataStore } from "../../../src/data/store";

let dbCount = 0;

interface Call {
  path: string;
  body: unknown;
}

// A scripted server: each handler answers one request, in order.
function fakeServer(handlers: ((call: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { path: String(url).replace("http://test/api", ""), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const next = handlers.shift();
    if (!next) throw new Error(`unexpected request ${call.path}`);
    return next(call);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

function applyAll(call: Call): Response {
  const { mutations } = call.body as { mutations: { op_id: string }[] };
  return Response.json({
    results: mutations.map((m, i): MutationResult => ({ op_id: m.op_id, status: "applied", seq: i + 1 })),
  });
}

function syncResponse(partial: Partial<SyncResponse>): () => Response {
  return () => Response.json({ cursor: 0, lists: [], items: [], events: [], event_exceptions: [], ...partial });
}

function makeStore(fetch: typeof globalThis.fetch, dbName = `test-${++dbCount}`, extra = {}) {
  return new DataStore({ dbName, fetch, apiBase: "http://test", ...extra });
}

const listFields = (overrides: Partial<List> = {}) => ({
  id: crypto.randomUUID(),
  name: "Groceries",
  color: "green" as const,
  sort_order: 0,
  ...overrides,
});

function serverList(overrides: Partial<List> = {}): List {
  return { ...listFields(), created_at: 1, updated_at: 1, seq: 1, deleted_at: null, ...overrides };
}

describe("DataStore", () => {
  it("applies writes locally at once and keeps them across reloads", async () => {
    const { fetch } = fakeServer([]);
    const store = makeStore(fetch, "persist");
    await store.load("u1");
    const l = await store.upsert("lists", listFields());
    expect(store.getSnapshot().tables.lists[l.id]).toMatchObject({ name: "Groceries", deleted_at: null });
    expect(store.getSnapshot().pending).toBe(1);

    const reopened = makeStore(fetch, "persist");
    await reopened.load("u1");
    expect(reopened.getSnapshot().tables.lists[l.id].name).toBe("Groceries");
    expect(reopened.getSnapshot().pending).toBe(1);
  });

  it("clears the mirror when another user loads it", async () => {
    const { fetch } = fakeServer([]);
    const store = makeStore(fetch, "switch");
    await store.load("u1");
    await store.upsert("lists", listFields());
    const other = makeStore(fetch, "switch");
    await other.load("u2");
    expect(other.getSnapshot().tables.lists).toEqual({});
    expect(other.getSnapshot().pending).toBe(0);
  });

  it("flushes the outbox in order, then pulls from the stored cursor", async () => {
    const pulled = serverList({ name: "From Claude", seq: 3 });
    const { fetch, calls } = fakeServer([applyAll, syncResponse({ cursor: 3, lists: [pulled] }), syncResponse({ cursor: 3 })]);
    const store = makeStore(fetch);
    await store.load("u1");
    const l = await store.upsert("lists", listFields());
    await store.upsert("lists", { ...listFields(), id: l.id, name: "Renamed" });
    await store.sync();

    expect(calls.map((c) => c.path)).toEqual(["/mutations", "/sync?since=0"]);
    const sent = (calls[0].body as { mutations: { entity: string; action: string; record: { name: string } }[] }).mutations;
    expect(sent.map((m) => [m.entity, m.action, m.record.name])).toEqual([
      ["lists", "upsert", "Groceries"],
      ["lists", "upsert", "Renamed"],
    ]);
    const snap = store.getSnapshot();
    expect(snap.pending).toBe(0);
    expect(snap.status).toBe("idle");
    expect(snap.tables.lists[pulled.id].name).toBe("From Claude");

    await store.sync();
    expect(calls.at(-1)!.path).toBe("/sync?since=3");
  });

  it("keeps the outbox while offline and reports it", async () => {
    const { fetch, calls } = fakeServer([offline, applyAll, syncResponse({ cursor: 1 })]);
    const store = makeStore(fetch);
    await store.load("u1");
    await store.upsert("lists", listFields());
    await store.sync();
    expect(store.getSnapshot()).toMatchObject({ status: "offline", pending: 1 });

    await store.sync();
    expect(store.getSnapshot()).toMatchObject({ status: "idle", pending: 0 });
    expect(calls.map((c) => c.path)).toEqual(["/mutations", "/mutations", "/sync?since=0"]);
  });

  it("replaces rejected writes with the server copy, or drops them", async () => {
    const serverCopy = serverList({ name: "Server name" });
    const { fetch } = fakeServer([
      (call) => {
        const [a, b] = (call.body as { mutations: { op_id: string }[] }).mutations;
        return Response.json({
          results: [
            { op_id: a.op_id, status: "rejected", error: "Invalid", current: serverCopy },
            { op_id: b.op_id, status: "rejected", error: "Not found", current: null },
          ],
        });
      },
      syncResponse({ cursor: 1 }),
    ]);
    const store = makeStore(fetch);
    await store.load("u1");
    await store.upsert("lists", { ...listFields(), id: serverCopy.id, name: "Local name" });
    const doomed = await store.upsert("lists", listFields());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await store.sync();
    const lists = store.getSnapshot().tables.lists;
    expect(lists[serverCopy.id].name).toBe("Server name");
    expect(lists[doomed.id]).toBeUndefined();
  });

  it("does not let a pull overwrite a record with a queued write, and applies tombstones", async () => {
    const kept = serverList({ name: "Local" });
    const gone = serverList();
    const { fetch } = fakeServer([
      syncResponse({ cursor: 2, lists: [kept, gone] }),
      offline,
      // The flush fails, so this pull is never reached; the next sync pulls again.
    ]);
    const store = makeStore(fetch);
    await store.load("u1");
    // Seed via a pull with an empty outbox.
    await (store as unknown as { pull(): Promise<void> }).pull();
    await store.upsert("lists", { ...listFields(), id: kept.id, name: "Edited offline" });
    await store.sync();

    const { fetch: fetch2 } = fakeServer([
      syncResponse({ cursor: 4, lists: [{ ...kept, name: "Edited elsewhere", seq: 3 }, { ...gone, deleted_at: 9, seq: 4 }] }),
    ]);
    (store as unknown as { fetch: typeof globalThis.fetch }).fetch = fetch2;
    await (store as unknown as { pull(): Promise<void> }).pull();
    const lists = store.getSnapshot().tables.lists;
    expect(lists[kept.id].name).toBe("Edited offline");
    expect(lists[gone.id]).toBeUndefined();
  });

  it("cascades a list removal to its items locally", async () => {
    const { fetch } = fakeServer([]);
    const store = makeStore(fetch);
    await store.load("u1");
    const l = await store.upsert("lists", listFields());
    const other = await store.upsert("lists", listFields());
    const item = (listId: string): Omit<Item, "created_at" | "updated_at" | "seq" | "deleted_at"> => ({
      id: crypto.randomUUID(),
      list_id: listId,
      title: "x",
      notes: "",
      due_date: null,
      due_time: null,
      completed_at: null,
    });
    const doomed = await store.upsert("items", item(l.id));
    const survivor = await store.upsert("items", item(other.id));
    await store.remove("lists", l.id);
    const { tables, pending } = store.getSnapshot();
    expect(Object.keys(tables.items)).toEqual([survivor.id]);
    expect(tables.items[doomed.id]).toBeUndefined();
    expect(pending).toBe(5);
  });

  it("reports 401s and stops", async () => {
    const onUnauthorized = vi.fn();
    const { fetch } = fakeServer([() => Response.json({ error: "Unauthorized" }, { status: 401 })]);
    const store = makeStore(fetch, undefined, { onUnauthorized });
    await store.load("u1");
    await store.upsert("lists", listFields());
    await store.sync();
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({ status: "error", pending: 1 });
  });

  it("runs one sync at a time and reruns once for calls made during it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetch, calls } = fakeServer([
      async () => {
        await gate;
        return syncResponse({ cursor: 0 })();
      },
      syncResponse({ cursor: 0 }),
    ]);
    const store = makeStore(fetch);
    await store.load("u1");
    const first = store.sync();
    const second = store.sync();
    const third = store.sync();
    release();
    await Promise.all([first, second, third]);
    expect(calls.map((c) => c.path)).toEqual(["/sync?since=0", "/sync?since=0"]);
  });
});
