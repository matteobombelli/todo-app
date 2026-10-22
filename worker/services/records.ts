import {
  CHILDREN,
  ENTITIES,
  FIELD_SCHEMAS,
  type Entity,
  type GoalEntryFields,
  type GoalFields,
  type EntityRecord,
  type Mutation,
  type MutationResult,
  type SyncResponse,
} from "../../shared/entities";
import { DEFAULT_TIMEZONE } from "../../shared/api";
import { nowIn } from "../../shared/dates";
import { entryDeleteProblem, entryProblem, goalDeleteProblem, goalProblem, stampGoal } from "../../shared/goals";
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

/**
 * Every row a batch reads (targets and parents, whoever owns them), its already-applied ops and the
 * user's timezone (goal rules go by their "today"), in one round trip.
 */
async function loadBatch(
  db: D1Database,
  userId: string,
  mutations: Mutation[],
): Promise<{ done: Map<string, { user_id: string; seq: number }>; rows: Map<string, Row>; timezone: string }> {
  const ids = new Map<Entity, Set<string>>();
  const want = (entity: Entity, id: unknown) => {
    if (typeof id !== "string") return;
    if (!ids.has(entity)) ids.set(entity, new Set());
    ids.get(entity)!.add(id);
  };
  const writtenItems: string[] = [];
  const entryGoals: string[] = [];
  const deletedEntries: string[] = [];
  for (const m of mutations) {
    want(m.entity, m.record.id);
    if (m.entity === "goal_entries" && m.action === "delete") deletedEntries.push(m.record.id);
    if (m.entity === "goal_entries" && m.action === "upsert" && typeof m.record.goal_id === "string") entryGoals.push(m.record.goal_id);
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
  // An entry is checked against its goal and the goal's other entries (one a day).
  for (const c of chunks([...new Set(entryGoals)])) {
    rowQueries.push({
      entity: "goal_entries",
      statement: db.prepare(`SELECT * FROM goal_entries WHERE goal_id IN (${c.map(() => "?").join(", ")}) AND deleted_at IS NULL`).bind(...c),
    });
  }
  for (const c of chunks([...new Set(deletedEntries)])) {
    rowQueries.push({
      entity: "goals",
      statement: db
        .prepare(`SELECT * FROM goals WHERE id IN (SELECT goal_id FROM goal_entries WHERE id IN (${c.map(() => "?").join(", ")}))`)
        .bind(...c),
    });
  }
  const userQuery = db.prepare("SELECT timezone FROM users WHERE id = ?").bind(userId);
  const results = await db.batch([...opQueries, ...rowQueries.map((q) => q.statement), userQuery]);
  const done = new Map<string, { user_id: string; seq: number }>();
  for (const r of results.slice(0, opQueries.length)) {
    for (const op of r.results as { op_id: string; user_id: string; seq: number }[]) done.set(op.op_id, op);
  }
  const rows = new Map<string, Row>();
  rowQueries.forEach((q, i) => {
    for (const row of results[opQueries.length + i].results as Row[]) rows.set(rowKey(q.entity, row.id), row);
  });
  const timezone = (results.at(-1)!.results[0] as { timezone: string } | undefined)?.timezone ?? DEFAULT_TIMEZONE;
  return { done, rows, timezone };
}

function subtasksOf(rows: Map<string, Row>, id: string): (Row & { list_id: string; completed_at: number | null })[] {
  return [...rows]
    .filter(([key, row]) => key.startsWith("items:") && row.parent_id === id && row.deleted_at === null)
    .map(([, row]) => row as Row & { list_id: string; completed_at: number | null });
}

/** Why an item can't have the parent it names, once that parent is known to be a live item. */
function subtaskProblem(
  item: { id: string; list_id: string; parent_id: string | null; rrule: string | null },
  rows: Map<string, Row>,
): string | null {
  if (item.rrule !== null && subtasksOf(rows, item.id).length) return "A repeating item can't have subtasks";
  if (item.parent_id === null) return null;
  if (item.parent_id === item.id) return "An item can't be its own subtask";
  const parent = rows.get(rowKey("items", item.parent_id))!;
  if (parent.rrule !== null) return "parent_id names a repeating item, and those can't have subtasks";
  if (parent.list_id !== item.list_id) return "parent_id names an item in another list";
  if (parent.parent_id !== null) return "parent_id names a subtask, and subtasks can't have their own";
  if (subtasksOf(rows, item.id).length) return "An item with subtasks can't become a subtask";
  return null;
}

function goalOf(rows: Map<string, Row>, id: string): GoalFields | null {
  const row = rows.get(rowKey("goals", id));
  return row && row.deleted_at === null ? toRecord<"goals">(row) : null;
}

export type BatchOutcome =
  | { applied: true; results: MutationResult[] }
  | { applied: false; rejected: { index: number; result: MutationResult }[] };

export async function applyMutation(db: D1Database, userId: string, m: Mutation, now?: number): Promise<MutationResult> {
  const outcome = await applyMutations(db, userId, [m], now);
  return outcome.applied ? outcome.results[0] : outcome.rejected[0].result;
}

/**
 * Applies the mutations in order, all or nothing: if any is rejected, none is written. Later ops see
 * earlier ones (an item in a list created by the same batch). The whole batch is one D1 batch with a
 * single user_seq bump, so its rows share one seq.
 */
export async function applyMutations(db: D1Database, userId: string, mutations: Mutation[], now = Date.now()): Promise<BatchOutcome> {
  const { done, rows, timezone } = await loadBatch(db, userId, mutations);
  const today = nowIn(timezone, new Date(now)).date;
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
        const problem =
          m.entity === "goals"
            ? goalDeleteProblem(current as GoalFields, now)
            : m.entity === "goal_entries"
              ? entryDeleteProblem(goalOf(rows, existing.goal_id as string), current as GoalEntryFields, today)
              : null;
        if (problem) return reject(problem, current);
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
    let fields = parsed.data as Record<string, unknown>;

    for (const parentRef of PARENTS[m.entity] ?? []) {
      const ref = fields[parentRef.column] as string | null;
      if (ref === null) continue;
      const parent = rows.get(rowKey(parentRef.entity, ref));
      if (!parent || parent.user_id !== userId || parent.deleted_at !== null) {
        return reject(`${parentRef.column} does not name a live ${parentRef.entity.slice(0, -1)}`, current);
      }
    }
    if (m.entity === "goals") {
      const stamped = stampGoal(current as GoalFields | null, fields as GoalFields, now);
      const problem = goalProblem(current as GoalFields | null, stamped, today, now);
      if (problem) return reject(problem, current);
      fields = stamped;
    }
    if (m.entity === "goal_entries") {
      const entry = fields as GoalEntryFields;
      const sameDay = [...rows]
        .filter(([key, row]) => key.startsWith("goal_entries:") && row.deleted_at === null && row.goal_id === entry.goal_id && row.date === entry.date)
        .map(([, row]) => toRecord<"goal_entries">(row));
      const problem = entryProblem(goalOf(rows, entry.goal_id)!, current as GoalEntryFields | null, entry, today, sameDay);
      if (problem) return reject(problem, current);
    }
    if (m.entity === "items") {
      const problem = subtaskProblem(fields as { id: string; list_id: string; parent_id: string | null; rrule: string | null }, rows);
      if (problem) return reject(problem, current);
    }

    const columns = COLUMNS[m.entity];
    // Records created together keep the order they were sent in: items with no position sort by
    // created_at, and a shared timestamp left them to their random ids.
    const createdAt = (existing?.created_at as number) ?? now + index;
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
    // event_exceptions: another live exception already covers an occurrence. D1 doesn't say which
    // statement failed, so every exception the batch writes is named, each answered with the live
    // exception for its occurrence (or its own row), which the client keeps instead of its copy.
    if (!(err instanceof Error && err.message.includes("UNIQUE") && err.message.includes("event_exceptions"))) throw err;
    const suspects = mutations.flatMap((m, index) =>
      m.entity === "event_exceptions" && m.action === "upsert" && !alreadyApplied.has(index) ? [{ m, index }] : [],
    );
    if (!suspects.length) throw err;
    const live = await db.batch(
      suspects.map(({ m }) =>
        db
          .prepare("SELECT * FROM event_exceptions WHERE user_id = ? AND event_id = ? AND occurrence_date = ? AND deleted_at IS NULL")
          .bind(userId, m.record.event_id ?? null, m.record.occurrence_date ?? null),
      ),
    );
    return {
      applied: false,
      rejected: suspects.map(({ m, index }, i) => {
        const row = live[i].results[0] as Row | undefined;
        return {
          index,
          result: {
            op_id: m.op_id,
            status: "rejected",
            error: "Conflicts with an existing record",
            current: row ? toRecord(row) : (before.get(index) ?? null),
          },
        };
      }),
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
