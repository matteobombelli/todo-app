import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  CHILDREN,
  ENTITIES,
  type Entity,
  type Fields,
  type EntityRecord,
  type Item,
  type Mutation,
  type MutationResult,
  type SyncResponse,
} from "../../shared/entities";
import { newId } from "../../shared/ids";
import { cascadeToSubtasks } from "../../shared/items";

// Offline-first mirror of the user's records. Every write lands in memory and IndexedDB first, with
// a mutation queued in the outbox; sync() sends the outbox, then pulls rows past the stored cursor.
// Pulled rows never overwrite a record that still has a queued mutation: the server copy arrives
// on the pull after that mutation is applied.

interface OutboxEntry {
  op_id: string;
  entity: Entity;
  action: "upsert" | "delete";
  record: Record<string, unknown> & { id: string };
}

interface Schema extends DBSchema {
  lists: { key: string; value: EntityRecord["lists"] };
  items: { key: string; value: EntityRecord["items"] };
  events: { key: string; value: EntityRecord["events"] };
  event_exceptions: { key: string; value: EntityRecord["event_exceptions"] };
  outbox: { key: number; value: OutboxEntry };
  meta: { key: string; value: unknown };
  std_cache: { key: string; value: unknown };
}

export type Tables = { [E in Entity]: Readonly<Record<string, EntityRecord[E]>> };

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export interface Snapshot {
  tables: Tables;
  loaded: boolean;
  status: SyncStatus;
  pending: number;
}

const BATCH_SIZE = 100;
const STORES = [...ENTITIES, "outbox", "meta", "std_cache"] as const;

export interface StoreOptions {
  dbName?: string;
  fetch?: typeof fetch;
  apiBase?: string;
  onUnauthorized?: () => void;
  onWrite?: () => void;
}

export class DataStore {
  private db: Promise<IDBPDatabase<Schema>>;
  private fetch: typeof fetch;
  private apiBase: string;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = {
    tables: { lists: {}, items: {}, events: {}, event_exceptions: {} },
    loaded: false,
    status: "idle",
    pending: 0,
  };
  private running: Promise<void> | null = null;
  private rerun = false;

  constructor(private options: StoreOptions = {}) {
    this.fetch = options.fetch ?? ((...args) => fetch(...args));
    this.apiBase = options.apiBase ?? "";
    this.db = openDB<Schema>(options.dbName ?? "todo-app", 1, {
      upgrade(db) {
        for (const e of ENTITIES) db.createObjectStore(e, { keyPath: "id" });
        db.createObjectStore("outbox", { autoIncrement: true });
        db.createObjectStore("meta");
        db.createObjectStore("std_cache");
      },
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private set(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private patchTables(changes: { entity: Entity; put?: EntityRecord[Entity]; remove?: string }[]): Tables {
    const tables = { ...this.snapshot.tables } as Record<Entity, Record<string, EntityRecord[Entity]>>;
    const copied = new Set<Entity>();
    for (const c of changes) {
      if (!copied.has(c.entity)) {
        tables[c.entity] = { ...tables[c.entity] };
        copied.add(c.entity);
      }
      if (c.put) tables[c.entity][c.put.id] = c.put;
      if (c.remove) delete tables[c.entity][c.remove];
    }
    return tables as Tables;
  }

  /** Loads the mirror into memory. Clears it first when it belongs to another user. */
  async load(userId: string): Promise<void> {
    const db = await this.db;
    if ((await db.get("meta", "user_id")) !== userId) {
      await this.clear();
      await db.put("meta", userId, "user_id");
    }
    const tables = {} as Record<Entity, Record<string, EntityRecord[Entity]>>;
    for (const e of ENTITIES) {
      // Items cached before subtasks existed have no parent_id.
      tables[e] = Object.fromEntries((await db.getAll(e)).map((r) => [r.id, e === "items" ? { parent_id: null, ...r } : r]));
    }
    this.set({ tables: tables as Tables, loaded: true, pending: await db.count("outbox") });
  }

  async clear(): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(STORES, "readwrite");
    await Promise.all([...STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
    this.set({ tables: { lists: {}, items: {}, events: {}, event_exceptions: {} }, pending: 0 });
  }

  get<E extends Entity>(entity: E, id: string): EntityRecord[E] | undefined {
    return this.snapshot.tables[entity][id] as EntityRecord[E] | undefined;
  }

  async upsert<E extends Entity>(entity: E, input: Fields<E>): Promise<EntityRecord[E]> {
    return (await this.upsertMany(entity, [input]))[0];
  }

  /** Several records in one transaction and one render, so a reorder never shows half applied. */
  async upsertMany<E extends Entity>(entity: E, inputs: Fields<E>[]): Promise<EntityRecord[E][]> {
    const now = Date.now();
    const writes = inputs.map((input) => {
      // Callers often spread a whole record; only the fields travel.
      const { created_at: _c, updated_at: _u, seq: _s, deleted_at: _d, ...fields } = input as EntityRecord[E];
      const existing = this.get(entity, fields.id);
      const record = {
        ...fields,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        seq: existing?.seq ?? 0,
        deleted_at: null,
      } as EntityRecord[E];
      return { fields, record, existing };
    });
    // Moving or completing an item carries its subtasks along. The server does the same when it
    // applies the item's mutation, so only that one is queued.
    const cascaded =
      entity === "items"
        ? writes.flatMap(({ record, existing }) => {
            // A subtask written by this same call keeps its own new copy.
            const subtasks = Object.values(this.snapshot.tables.items).filter(
              (i) => i.parent_id === record.id && !writes.some((w) => w.record.id === i.id),
            );
            return cascadeToSubtasks((existing as Item | undefined) ?? null, record as Item, subtasks).map((sub) => ({ ...sub, updated_at: now }));
          })
        : [];
    const db = await this.db;
    const tx = db.transaction([entity, "outbox"], "readwrite");
    await Promise.all([
      ...writes.flatMap(({ fields, record }) => [
        tx.objectStore(entity).put(record as never),
        tx.objectStore("outbox").add({ op_id: newId(), entity, action: "upsert", record: { ...fields } }),
      ]),
      ...cascaded.map((sub) => tx.objectStore(entity).put(sub as never)),
      tx.done,
    ]);
    this.set({
      tables: this.patchTables([
        ...writes.map(({ record }) => ({ entity, put: record })),
        ...cascaded.map((sub) => ({ entity: "items" as const, put: sub })),
      ]),
      pending: this.snapshot.pending + writes.length,
    });
    this.options.onWrite?.();
    return writes.map(({ record }) => record);
  }

  async remove(entity: Entity, id: string): Promise<void> {
    const orphans = (CHILDREN[entity] ?? []).flatMap((child) =>
      Object.values(this.snapshot.tables[child.entity])
        .filter((r) => (r as unknown as Record<string, unknown>)[child.column] === id)
        .map((r) => ({ entity: child.entity, id: r.id })),
    );
    const db = await this.db;
    const stores = [...new Set<Entity | "outbox">([entity, ...orphans.map((o) => o.entity), "outbox"])];
    const tx = db.transaction(stores, "readwrite");
    await Promise.all([
      tx.objectStore(entity).delete(id),
      ...orphans.map((o) => tx.objectStore(o.entity).delete(o.id)),
      tx.objectStore("outbox").add({ op_id: newId(), entity, action: "delete", record: { id } }),
      tx.done,
    ]);
    this.set({
      tables: this.patchTables([{ entity, remove: id }, ...orphans.map((o) => ({ entity: o.entity, remove: o.id }))]),
      pending: this.snapshot.pending + 1,
    });
    this.options.onWrite?.();
  }

  /** Flushes the outbox, then pulls. Concurrent calls share one run and trigger one more after it. */
  sync(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        this.set({ status: "syncing" });
        try {
          await this.flush();
          await this.pull();
          this.set({ status: "idle" });
        } catch (err) {
          this.set({ status: err instanceof NetworkError ? "offline" : "error" });
          if (!(err instanceof NetworkError) && !(err instanceof UnauthorizedError)) console.error(err);
          break;
        }
      } while (this.rerun);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetch(`${this.apiBase}/api${path}`, { credentials: "same-origin", ...init });
    } catch {
      throw new NetworkError();
    }
    if (res.status === 401) {
      this.options.onUnauthorized?.();
      throw new UnauthorizedError();
    }
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async flush(): Promise<void> {
    const db = await this.db;
    for (;;) {
      const tx = db.transaction("outbox");
      const [keys, entries] = await Promise.all([
        tx.store.getAllKeys(undefined, BATCH_SIZE),
        tx.store.getAll(undefined, BATCH_SIZE),
      ]);
      if (keys.length === 0) return;
      const { results } = await this.request<{ results: MutationResult[] }>("/mutations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations: entries satisfies Mutation[] }),
      });

      const entityOf = new Map(entries.map((e) => [e.op_id, e]));
      const changes: { entity: Entity; put?: EntityRecord[Entity]; remove?: string }[] = [];
      const write = db.transaction([...ENTITIES, "outbox"], "readwrite");
      const ops: Promise<unknown>[] = keys.map((k) => write.objectStore("outbox").delete(k));
      for (const r of results) {
        if (r.status !== "rejected") continue;
        const entry = entityOf.get(r.op_id)!;
        console.warn(`Sync rejected ${entry.action} on ${entry.entity}: ${r.error}`);
        if (r.current && r.current.deleted_at === null) {
          ops.push(write.objectStore(entry.entity).put(r.current as never));
          changes.push({ entity: entry.entity, put: r.current });
        } else {
          ops.push(write.objectStore(entry.entity).delete(entry.record.id));
          changes.push({ entity: entry.entity, remove: entry.record.id });
        }
      }
      await Promise.all([...ops, write.done]);
      this.set({ tables: this.patchTables(changes), pending: await db.count("outbox") });
    }
  }

  private async pull(): Promise<void> {
    const db = await this.db;
    const cursor = ((await db.get("meta", "cursor")) as number | undefined) ?? 0;
    const data = await this.request<SyncResponse>(`/sync?since=${cursor}`);

    // The outbox is read inside the write transaction, so a local write cannot slip in between the
    // check and the overwrite.
    const tx = db.transaction([...ENTITIES, "meta", "outbox"], "readwrite");
    const pending = new Set((await tx.objectStore("outbox").getAll()).map((e) => `${e.entity}:${e.record.id}`));
    const changes: { entity: Entity; put?: EntityRecord[Entity]; remove?: string }[] = [];
    const ops: Promise<unknown>[] = [];
    for (const e of ENTITIES) {
      for (const row of data[e]) {
        if (pending.has(`${e}:${row.id}`)) continue;
        if (row.deleted_at === null) {
          ops.push(tx.objectStore(e).put(row as never));
          changes.push({ entity: e, put: row });
        } else {
          ops.push(tx.objectStore(e).delete(row.id));
          changes.push({ entity: e, remove: row.id });
        }
      }
    }
    ops.push(tx.objectStore("meta").put(data.cursor, "cursor"));
    await Promise.all([...ops, tx.done]);
    if (changes.length) this.set({ tables: this.patchTables(changes) });
  }

  async cacheGet<T>(key: string): Promise<T | undefined> {
    return (await (await this.db).get("std_cache", key)) as T | undefined;
  }

  async cachePut(key: string, value: unknown): Promise<void> {
    await (await this.db).put("std_cache", value, key);
  }
}

export class NetworkError extends Error {}
export class UnauthorizedError extends Error {}
