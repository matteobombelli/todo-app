import {
  CHILDREN,
  ENTITIES,
  FIELD_SCHEMAS,
  type Entity,
  type EntityRecord,
  type Mutation,
  type MutationResult,
  type SyncResponse,
} from "../../shared/entities";
import { cascadeToSubtasks } from "../../shared/items";

// The single write path for synced records. Every write bumps the owner's user_seq and stamps the
// touched rows with the new value, inside one D1 batch (a transaction), so a sync reader holding
// cursor N has seen every row with seq <= N.

const COLUMNS = Object.fromEntries(ENTITIES.map((e) => [e, Object.keys(FIELD_SCHEMAS[e].shape)])) as Record<
  Entity,
  string[]
>;
const BOOLEAN_COLUMNS = new Set(["all_day", "cancelled"]);
const APPLIED_OPS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The records a row must point at while live (CHILDREN reversed); a null reference is allowed. */
const PARENTS: Partial<Record<Entity, { entity: Entity; column: string }[]>> = {};
for (const [parent, children] of Object.entries(CHILDREN)) {
  for (const child of children) (PARENTS[child.entity] ??= []).push({ entity: parent as Entity, column: child.column });
}

type Row = Record<string, unknown> & { id: string; user_id: string; deleted_at: number | null };

export function toRecord<E extends Entity>(row: Record<string, unknown>): EntityRecord[E] {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "user_id") continue;
    record[key] = BOOLEAN_COLUMNS.has(key) && value !== null ? value === 1 : value;
  }
  return record as unknown as EntityRecord[E];
}

function toColumn(value: unknown): unknown {
  return typeof value === "boolean" ? Number(value) : value;
}

/** Live records of one entity owned by the user. */
export async function listRecords<E extends Entity>(db: D1Database, userId: string, entity: E): Promise<EntityRecord[E][]> {
  const { results } = await db
    .prepare(`SELECT * FROM ${entity} WHERE user_id = ? AND deleted_at IS NULL`)
    .bind(userId)
    .all<Record<string, unknown>>();
  return results.map((r) => toRecord<E>(r));
}

/** Live or tombstoned records owned by the user, by id; ids they don't own are left out. */
export async function getRecords<E extends Entity>(
  db: D1Database,
  userId: string,
  entity: E,
  ids: string[],
): Promise<Map<string, EntityRecord[E]>> {
  if (!ids.length) return new Map();
  const results = await db.batch(
    chunks([...new Set(ids)], MAX_PARAMS - 1).map((c) =>
      db.prepare(`SELECT * FROM ${entity} WHERE user_id = ? AND id IN (${c.map(() => "?").join(", ")})`).bind(userId, ...c),
    ),
  );
  return new Map(results.flatMap((r) => (r.results as Row[]).map((row) => [row.id, toRecord<E>(row)] as const)));
}

export async function pruneAppliedOps(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM applied_ops WHERE created_at < ?").bind(Date.now() - APPLIED_OPS_TTL_MS).run();
}

/** D1's limit on bound parameters in one statement. */
const MAX_PARAMS = 100;

function chunks<T>(list: T[], size = MAX_PARAMS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const rowKey = (entity: Entity, id: string) => `${entity}:${id}`;

/** Every row a batch reads (targets and parents, whoever owns them) and its already-applied ops, in one round trip. */
async function loadBatch(
  db: D1Database,
  mutations: Mutation[],
): Promise<{ done: Map<string, { user_id: string; seq: number }>; rows: Map<string, Row> }> {
  const ids = new Map<Entity, Set<string>>();
  const want = (entity: Entity, id: unknown) => {
    if (typeof id !== "string") return;
    if (!ids.has(entity)) ids.set(entity, new Set());
    ids.get(entity)!.add(id);
  };
  const writtenItems: string[] = [];
  for (const m of mutations) {
    want(m.entity, m.record.id);
    if (m.action !== "upsert") continue;
    for (const parent of PARENTS[m.entity] ?? []) want(parent.entity, (m.record as Record<string, unknown>)[parent.column]);
    if (m.entity === "items") writtenItems.push(m.record.id);
  }
  const opQueries = chunks([...new Set(mutations.map((m) => m.op_id))]).map((c) =>
    db.prepare(`SELECT op_id, user_id, seq FROM applied_ops WHERE op_id IN (${c.map(() => "?").join(", ")})`).bind(...c),
  );
  const rowQueries = [...ids].flatMap(([entity, set]) =>
    chunks([...set]).map((c) => ({
      entity,
      statement: db.prepare(`SELECT * FROM ${entity} WHERE id IN (${c.map(() => "?").join(", ")})`).bind(...c),
    })),
  );
  // An item's subtasks follow it (see subtaskProblem and cascadeToSubtasks).
  for (const c of chunks([...new Set(writtenItems)])) {
    rowQueries.push({
      entity: "items",
      statement: db.prepare(`SELECT * FROM items WHERE parent_id IN (${c.map(() => "?").join(", ")}) AND deleted_at IS NULL`).bind(...c),
    });
  }
  const results = await db.batch([...opQueries, ...rowQueries.map((q) => q.statement)]);
  const done = new Map<string, { user_id: string; seq: number }>();
  for (const r of results.slice(0, opQueries.length)) {
    for (const op of r.results as { op_id: string; user_id: string; seq: number }[]) done.set(op.op_id, op);
  }
  const rows = new Map<string, Row>();
  rowQueries.forEach((q, i) => {
    for (const row of results[opQueries.length + i].results as Row[]) rows.set(rowKey(q.entity, row.id), row);
  });
  return { done, rows };
}

function subtasksOf(rows: Map<string, Row>, id: string): (Row & { list_id: string; completed_at: number | null })[] {
  return [...rows]
    .filter(([key, row]) => key.startsWith("items:") && row.parent_id === id && row.deleted_at === null)
    .map(([, row]) => row as Row & { list_id: string; completed_at: number | null });
}

/** Why an item can't have the parent it names, once that parent is known to be a live item. */
function subtaskProblem(item: { id: string; list_id: string; parent_id: string | null }, rows: Map<string, Row>): string | null {
  if (item.parent_id === null) return null;
  if (item.parent_id === item.id) return "An item can't be its own subtask";
  const parent = rows.get(rowKey("items", item.parent_id))!;
  if (parent.list_id !== item.list_id) return "parent_id names an item in another list";
  if (parent.parent_id !== null) return "parent_id names a subtask, and subtasks can't have their own";
  if (subtasksOf(rows, item.id).length) return "An item with subtasks can't become a subtask";
  return null;
}

export type BatchOutcome =
  | { applied: true; results: MutationResult[] }
  | { applied: false; rejected: { index: number; result: MutationResult }[] };

export async function applyMutation(db: D1Database, userId: string, m: Mutation): Promise<MutationResult> {
  const outcome = await applyMutations(db, userId, [m]);
  return outcome.applied ? outcome.results[0] : outcome.rejected[0].result;
}

/**
 * Applies the mutations in order, all or nothing: if any is rejected, none is written. Later ops see
 * earlier ones (an item in a list created by the same batch). The whole batch is one D1 batch with a
 * single user_seq bump, so its rows share one seq.
 */
export async function applyMutations(db: D1Database, userId: string, mutations: Mutation[]): Promise<BatchOutcome> {
  const { done, rows } = await loadBatch(db, mutations);
  const now = Date.now();
  const seq = "(SELECT value FROM user_seq WHERE user_id = ?)";
  const statements: D1PreparedStatement[] = [];
  const rejected: { index: number; result: MutationResult }[] = [];
  const alreadyApplied = new Map<number, MutationResult>();
  // Each op's record as it stood before the batch, for a rejection found only when writing.
  const before = new Map<number, EntityRecord[Entity] | null>();
  let writes = false;

  mutations.forEach((m, index) => {
    const reject = (error: string, current: EntityRecord[Entity] | null) =>
      void rejected.push({ index, result: { op_id: m.op_id, status: "rejected", error, current } });
    const prior = done.get(m.op_id);
    if (prior) {
      if (prior.user_id === userId) alreadyApplied.set(index, { op_id: m.op_id, status: "applied", seq: prior.seq });
      else reject("Duplicate op_id", null);
      return;
    }

    const existing = rows.get(rowKey(m.entity, m.record.id)) ?? null;
    if (existing && existing.user_id !== userId) return reject("Not found", null);
    const current = existing ? toRecord(existing) : null;
    before.set(index, current);
    const record = db
      .prepare(`INSERT INTO applied_ops (op_id, user_id, seq, created_at) VALUES (?, ?, ${seq}, ?)`)
      .bind(m.op_id, userId, userId, now);

    if (m.action === "delete") {
      // Deleting what is already gone is a no-op that still succeeds.
      if (existing && existing.deleted_at === null) {
        writes = true;
        existing.deleted_at = now;
        statements.push(
          db
            .prepare(`UPDATE ${m.entity} SET deleted_at = ?, updated_at = ?, seq = ${seq} WHERE id = ?`)
            .bind(now, now, userId, m.record.id),
        );
        for (const child of CHILDREN[m.entity] ?? []) {
          statements.push(
            db
              .prepare(
                `UPDATE ${child.entity} SET deleted_at = ?, updated_at = ?, seq = ${seq} WHERE ${child.column} = ? AND user_id = ? AND deleted_at IS NULL`,
              )
              .bind(now, now, userId, m.record.id, userId),
          );
          for (const [key, row] of rows) {
            if (key.startsWith(`${child.entity}:`) && row[child.column] === m.record.id && row.deleted_at === null) row.deleted_at = now;
          }
        }
      }
      statements.push(record);
      return;
    }

    const parsed = FIELD_SCHEMAS[m.entity].safeParse(m.record);
    if (!parsed.success) return reject(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), current);
    // A deletion wins over a concurrent edit: the tombstone stays and the edit is dropped.
    if (existing?.deleted_at != null) return reject("Deleted", current);
    const fields = parsed.data as Record<string, unknown>;

    for (const parentRef of PARENTS[m.entity] ?? []) {
      const ref = fields[parentRef.column] as string | null;
      if (ref === null) continue;
      const parent = rows.get(rowKey(parentRef.entity, ref));
      if (!parent || parent.user_id !== userId || parent.deleted_at !== null) {
        return reject(`${parentRef.column} does not name a live ${parentRef.entity.slice(0, -1)}`, current);
      }
    }
    if (m.entity === "items") {
      const problem = subtaskProblem(fields as { id: string; list_id: string; parent_id: string | null }, rows);
      if (problem) return reject(problem, current);
    }

    const columns = COLUMNS[m.entity];
    const createdAt = (existing?.created_at as number) ?? now;
    writes = true;
    statements.push(
      db
        .prepare(
          `INSERT INTO ${m.entity} (id, user_id, ${columns.slice(1).join(", ")}, created_at, updated_at, seq, deleted_at)
           VALUES (?, ?, ${columns.slice(1).map(() => "?").join(", ")}, ?, ?, ${seq}, NULL)
           ON CONFLICT(id) DO UPDATE SET ${columns
             .slice(1)
             .map((c) => `${c} = excluded.${c}`)
             .join(", ")}, updated_at = excluded.updated_at, seq = excluded.seq
           WHERE ${m.entity}.user_id = excluded.user_id AND ${m.entity}.deleted_at IS NULL`,
        )
        .bind(fields.id, userId, ...columns.slice(1).map((c) => toColumn(fields[c])), createdAt, now, userId),
      record,
    );
    if (m.entity === "items") {
      const before = existing as (Row & { list_id: string; completed_at: number | null }) | null;
      const after = fields as { list_id: string; completed_at: number | null };
      for (const sub of cascadeToSubtasks(before, after, subtasksOf(rows, m.record.id))) {
        statements.push(
          db
            .prepare(`UPDATE items SET list_id = ?, completed_at = ?, updated_at = ?, seq = ${seq} WHERE id = ?`)
            .bind(sub.list_id, sub.completed_at, now, userId, sub.id),
        );
        rows.set(rowKey("items", sub.id), { ...sub, updated_at: now });
      }
    }
    rows.set(rowKey(m.entity, m.record.id), {
      ...Object.fromEntries(columns.map((c) => [c, toColumn(fields[c])])),
      id: m.record.id,
      user_id: userId,
      created_at: createdAt,
      updated_at: now,
      seq: existing?.seq ?? 0,
      deleted_at: null,
    });
  });

  if (rejected.length) return { applied: false, rejected };
  const readSeq = db.prepare("SELECT value FROM user_seq WHERE user_id = ?").bind(userId);
  const bump = db.prepare("UPDATE user_seq SET value = value + 1 WHERE user_id = ?").bind(userId);
  try {
    const results = await db.batch([...(writes ? [bump] : []), ...statements, readSeq]);
    const value = (results.at(-1)!.results[0] as { value: number }).value;
    return {
      applied: true,
      results: mutations.map((m, i) => alreadyApplied.get(i) ?? { op_id: m.op_id, status: "applied", seq: value }),
    };
  } catch (err) {
    // event_exceptions: another exception already covers an occurrence. D1 doesn't say which
    // statement failed, so every exception the batch writes is named.
    if (!(err instanceof Error && err.message.includes("UNIQUE"))) throw err;
    const suspects = mutations.flatMap((m, index) =>
      m.entity === "event_exceptions" && m.action === "upsert" && !alreadyApplied.has(index) ? [{ m, index }] : [],
    );
    if (!suspects.length) throw err;
    return {
      applied: false,
      rejected: suspects.map(({ m, index }) => ({
        index,
        result: {
          op_id: m.op_id,
          status: "rejected",
          error: "Conflicts with an existing record",
          current: before.get(index) ?? null,
        },
      })),
    };
  }
}

export async function readSince(db: D1Database, userId: string, since: number): Promise<SyncResponse> {
  // A first sync has nothing to delete, so it skips tombstones.
  const tombstones = since > 0 ? "" : " AND deleted_at IS NULL";
  const results = await db.batch([
    db.prepare("SELECT value FROM user_seq WHERE user_id = ?").bind(userId),
    ...ENTITIES.map((e) =>
      db.prepare(`SELECT * FROM ${e} WHERE user_id = ? AND seq > ?${tombstones} ORDER BY seq`).bind(userId, since),
    ),
  ]);
  const cursor = (results[0].results[0] as { value: number } | undefined)?.value ?? 0;
  const out = { cursor } as SyncResponse;
  ENTITIES.forEach((e, i) => {
    (out[e] as unknown[]) = (results[i + 1].results as Record<string, unknown>[]).map((r) => toRecord(r));
  });
  return out;
}
