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

// The single write path for synced records. Every write bumps the owner's user_seq and stamps the
// touched rows with the new value, inside one D1 batch (a transaction), so a sync reader holding
// cursor N has seen every row with seq <= N.

const COLUMNS = Object.fromEntries(ENTITIES.map((e) => [e, Object.keys(FIELD_SCHEMAS[e].shape)])) as Record<
  Entity,
  string[]
>;
const BOOLEAN_COLUMNS = new Set(["all_day", "cancelled"]);
const APPLIED_OPS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PARENTS = Object.fromEntries(
  Object.entries(CHILDREN).map(([parent, child]) => [child.entity, { entity: parent as Entity, column: child.column }]),
) as Partial<Record<Entity, { entity: Entity; column: string }>>;

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

async function getRow(db: D1Database, entity: Entity, id: string): Promise<Row | null> {
  return db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).bind(id).first<Row>();
}

/** A live or tombstoned record owned by the user, or null. */
export async function getRecord<E extends Entity>(
  db: D1Database,
  userId: string,
  entity: E,
  id: string,
): Promise<EntityRecord[E] | null> {
  const row = await getRow(db, entity, id);
  return row && row.user_id === userId ? toRecord<E>(row) : null;
}

/** Live records of one entity owned by the user. */
export async function listRecords<E extends Entity>(db: D1Database, userId: string, entity: E): Promise<EntityRecord[E][]> {
  const { results } = await db
    .prepare(`SELECT * FROM ${entity} WHERE user_id = ? AND deleted_at IS NULL`)
    .bind(userId)
    .all<Record<string, unknown>>();
  return results.map((r) => toRecord<E>(r));
}

export async function pruneAppliedOps(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM applied_ops WHERE created_at < ?").bind(Date.now() - APPLIED_OPS_TTL_MS).run();
}

export async function applyMutation(db: D1Database, userId: string, m: Mutation): Promise<MutationResult> {
  const done = await db
    .prepare("SELECT user_id, seq FROM applied_ops WHERE op_id = ?")
    .bind(m.op_id)
    .first<{ user_id: string; seq: number }>();
  if (done) {
    return done.user_id === userId
      ? { op_id: m.op_id, status: "applied", seq: done.seq }
      : { op_id: m.op_id, status: "rejected", error: "Duplicate op_id", current: null };
  }

  const existing = await getRow(db, m.entity, m.record.id);
  if (existing && existing.user_id !== userId) {
    return { op_id: m.op_id, status: "rejected", error: "Not found", current: null };
  }
  const current = existing ? toRecord(existing) : null;
  const reject = (error: string): MutationResult => ({ op_id: m.op_id, status: "rejected", error, current });
  const now = Date.now();
  const seq = "(SELECT value FROM user_seq WHERE user_id = ?)";
  const bump = db.prepare("UPDATE user_seq SET value = value + 1 WHERE user_id = ?").bind(userId);
  const record = db
    .prepare(`INSERT INTO applied_ops (op_id, user_id, seq, created_at) VALUES (?, ?, ${seq}, ?)`)
    .bind(m.op_id, userId, userId, now);
  const readSeq = db.prepare("SELECT value FROM user_seq WHERE user_id = ?").bind(userId);

  if (m.action === "delete") {
    // Deleting what is already gone is a no-op that still succeeds.
    if (!existing || existing.deleted_at !== null) {
      const results = await db.batch([record, readSeq]);
      return { op_id: m.op_id, status: "applied", seq: (results[1].results[0] as { value: number }).value };
    }
    const statements = [
      bump,
      db
        .prepare(`UPDATE ${m.entity} SET deleted_at = ?, updated_at = ?, seq = ${seq} WHERE id = ?`)
        .bind(now, now, userId, m.record.id),
    ];
    const child = CHILDREN[m.entity];
    if (child) {
      statements.push(
        db
          .prepare(
            `UPDATE ${child.entity} SET deleted_at = ?, updated_at = ?, seq = ${seq} WHERE ${child.column} = ? AND user_id = ? AND deleted_at IS NULL`,
          )
          .bind(now, now, userId, m.record.id, userId),
      );
    }
    const results = await db.batch([...statements, record, readSeq]);
    return { op_id: m.op_id, status: "applied", seq: (results.at(-1)!.results[0] as { value: number }).value };
  }

  const parsed = FIELD_SCHEMAS[m.entity].safeParse(m.record);
  if (!parsed.success) return reject(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  // A deletion wins over a concurrent edit: the tombstone stays and the edit is dropped.
  if (existing?.deleted_at != null) return reject("Deleted");
  const fields = parsed.data as Record<string, unknown>;

  const parentRef = PARENTS[m.entity];
  if (parentRef) {
    const parent = await getRow(db, parentRef.entity, fields[parentRef.column] as string);
    if (!parent || parent.user_id !== userId || parent.deleted_at !== null) {
      return reject(`${parentRef.column} does not name a live ${parentRef.entity.slice(0, -1)}`);
    }
  }

  const columns = COLUMNS[m.entity];
  const upsert = db
    .prepare(
      `INSERT INTO ${m.entity} (id, user_id, ${columns.slice(1).join(", ")}, created_at, updated_at, seq, deleted_at)
       VALUES (?, ?, ${columns.slice(1).map(() => "?").join(", ")}, ?, ?, ${seq}, NULL)
       ON CONFLICT(id) DO UPDATE SET ${columns
         .slice(1)
         .map((c) => `${c} = excluded.${c}`)
         .join(", ")}, updated_at = excluded.updated_at, seq = excluded.seq
       WHERE ${m.entity}.user_id = excluded.user_id AND ${m.entity}.deleted_at IS NULL`,
    )
    .bind(fields.id, userId, ...columns.slice(1).map((c) => toColumn(fields[c])), (existing?.created_at as number) ?? now, now, userId);
  try {
    const results = await db.batch([bump, upsert, record, readSeq]);
    return { op_id: m.op_id, status: "applied", seq: (results[3].results[0] as { value: number }).value };
  } catch (err) {
    // event_exceptions: another exception already covers this occurrence.
    if (err instanceof Error && err.message.includes("UNIQUE")) return reject("Conflicts with an existing record");
    throw err;
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
