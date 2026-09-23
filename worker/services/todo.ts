import type { z } from "zod";
import { DEFAULT_TIMEZONE } from "../../shared/api";
import { buildAgenda, type ExternalEvent } from "../../shared/agenda";
import { addDays, daysBetween, nowIn, toMinutes } from "../../shared/dates";
import {
  CHILDREN,
  EventExceptionFields,
  EventFields,
  ItemFields,
  ListFields,
  type CalendarEvent,
  type Entity,
  type EntityRecord,
  type Fields,
  type EventException,
  type Item,
  type List,
  type Mutation,
} from "../../shared/entities";
import { newId } from "../../shared/ids";
import { cascadeToSubtasks, compareItems, isOverdue, type Now } from "../../shared/items";
import type { PaletteKey } from "../../shared/palette";
import { occurrencesInRange, parseRRule, ruleDates, shiftRRule, type Occurrence } from "../../shared/recurrence";
import { applyMutations, getRecords, listRecords } from "./records";
import { StdNotConnectedError, StdUnavailableError, fetchStdDates } from "./std";

// Record-level operations for the MCP tools. Writes go through applyMutations, the same path as
// the app's sync, so seq bumping, validation and cascades behave identically. Each write tool takes
// one or many inputs and applies them together: all or nothing.

/** A failure worth showing to the caller as-is. */
export class ToolError extends Error {}

export interface Scope {
  env: Env;
  userId: string;
}

export function check<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  throw new ToolError(parsed.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`).join("; "));
}

/** What an op hands back once written: a record to read back, or a value known up front. */
type Output = { written: Entity; id: string } | { value: unknown };

/**
 * One tool call's writes. The user's live records are loaded once and each op is planned against
 * them, so a later op sees an earlier one; the ops are then written in one applyMutations call.
 */
class Batch {
  private readonly tables = new Map<Entity, Map<string, EntityRecord[Entity]>>();
  private readonly mutations: Mutation[] = [];
  /** The input each mutation came from, to name it in errors. */
  private readonly sources: number[] = [];
  source = 0;

  private constructor(readonly s: Scope) {}

  static async open(s: Scope, entities: Entity[]): Promise<Batch> {
    const batch = new Batch(s);
    const loaded = await Promise.all(entities.map((e) => listRecords(s.env.DB, s.userId, e)));
    entities.forEach((e, i) => batch.tables.set(e, new Map(loaded[i].map((r) => [r.id, r]))));
    return batch;
  }

  private table<E extends Entity>(entity: E): Map<string, EntityRecord[E]> {
    const table = this.tables.get(entity);
    if (!table) throw new Error(`${entity} not loaded`);
    return table as Map<string, EntityRecord[E]>;
  }

  all<E extends Entity>(entity: E): EntityRecord[E][] {
    return [...this.table(entity).values()];
  }

  live<E extends Entity>(entity: E, id: string, label: string): EntityRecord[E] {
    const record = this.table(entity).get(id);
    if (!record) throw new ToolError(`No ${label} with id ${id}`);
    return record;
  }

  list(ref: string): List {
    return matchList(this.all("lists"), ref);
  }

  upsert<E extends Entity>(entity: E, fields: Fields<E>): Output {
    this.push({ op_id: newId(), entity, action: "upsert", record: fields as Fields<E> & { id: string } });
    const table = this.table(entity);
    const before = table.get(fields.id);
    table.set(fields.id, { ...before, ...fields } as EntityRecord[E]);
    // Later ops must start from the subtasks as the server will leave them.
    if (entity === "items") {
      const items = this.table("items");
      const subtasks = [...items.values()].filter((i) => i.parent_id === fields.id);
      for (const sub of cascadeToSubtasks((before as Item | undefined) ?? null, fields as Fields<"items">, subtasks)) items.set(sub.id, sub);
    }
    return { written: entity, id: fields.id };
  }

  remove(entity: Entity, id: string): void {
    this.push({ op_id: newId(), entity, action: "delete", record: { id } });
    this.table(entity).delete(id);
    for (const child of CHILDREN[entity] ?? []) {
      const children = this.tables.get(child.entity);
      for (const [childId, record] of children ?? []) {
        if ((record as unknown as Record<string, unknown>)[child.column] === id) children!.delete(childId);
      }
    }
  }

  private push(m: Mutation): void {
    this.mutations.push(m);
    this.sources.push(this.source);
  }

  /** Writes every planned op; returns, per input, why it was rejected (none on success). */
  async commit(): Promise<Map<number, string>> {
    const errors = new Map<number, string>();
    if (!this.mutations.length) return errors;
    const outcome = await applyMutations(this.s.env.DB, this.s.userId, this.mutations);
    if (outcome.applied) return errors;
    for (const { index, result } of outcome.rejected) {
      if (result.status === "rejected") errors.set(this.sources[index], result.error);
    }
    return errors;
  }
}

/**
 * Plans every input against one batch and writes them together. Any failure, while planning or
 * writing, changes nothing and names each failing input by its index.
 */
async function runBatch<I>(s: Scope, entities: Entity[], inputs: I[], plan: (b: Batch, input: I) => Output): Promise<unknown[]> {
  const batch = await Batch.open(s, entities);
  let errors = new Map<number, string>();
  const outputs = inputs.map((input, i) => {
    batch.source = i;
    try {
      return plan(batch, input);
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
      errors.set(i, err.message);
      return null;
    }
  });
  if (!errors.size) errors = await batch.commit();
  if (errors.size) {
    if (inputs.length === 1) throw new ToolError([...errors.values()][0]);
    throw new ToolError(`Nothing was changed. ${[...errors].map(([i, message]) => `[${i}] ${message}`).join("; ")}`);
  }

  const wanted = new Map<Entity, string[]>();
  for (const out of outputs) if (out && "written" in out) wanted.set(out.written, [...(wanted.get(out.written) ?? []), out.id]);
  const read = new Map(
    await Promise.all(
      [...wanted].map(async ([entity, ids]) => [entity, await getRecords(s.env.DB, s.userId, entity, ids)] as const),
    ),
  );
  return outputs.map((out) => (out && "written" in out ? read.get(out.written)!.get(out.id) : out?.value));
}

export async function userNow(s: Scope): Promise<Now & { timezone: string }> {
  const row = await s.env.DB.prepare("SELECT timezone FROM users WHERE id = ?").bind(s.userId).first<{ timezone: string }>();
  const timezone = row?.timezone ?? DEFAULT_TIMEZONE;
  return { ...nowIn(timezone), timezone };
}

// Lists

function matchList(lists: List[], ref: string): List {
  const needle = ref.trim().toLowerCase();
  const match = lists.find((l) => l.id === ref) ?? lists.find((l) => l.name.toLowerCase() === needle);
  if (!match) {
    const names = lists.map((l) => `"${l.name}"`).join(", ") || "none";
    throw new ToolError(`No list named or with id "${ref}". Lists: ${names}`);
  }
  return match;
}

export async function resolveList(s: Scope, ref: string): Promise<List> {
  return matchList(await listRecords(s.env.DB, s.userId, "lists"), ref);
}

export async function listLists(s: Scope) {
  const [lists, items] = await Promise.all([listRecords(s.env.DB, s.userId, "lists"), listRecords(s.env.DB, s.userId, "items")]);
  return lists
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at)
    .map((l) => {
      const mine = items.filter((i) => i.list_id === l.id);
      return {
        id: l.id,
        name: l.name,
        color: l.color,
        open: mine.filter((i) => i.completed_at === null).length,
        completed: mine.filter((i) => i.completed_at !== null).length,
      };
    });
}

export async function createList(s: Scope, name: string, color: PaletteKey = "blue"): Promise<List> {
  const [list] = await runBatch(s, ["lists"], [{ name, color }], (b, input) => {
    const sort_order = b.all("lists").reduce((max, l) => Math.max(max, l.sort_order), 0) + 1;
    return b.upsert("lists", check(ListFields, { id: newId(), ...input, sort_order }));
  });
  return list as List;
}

export async function updateList(s: Scope, ref: string, patch: { name?: string; color?: PaletteKey }): Promise<List> {
  const [list] = await runBatch(s, ["lists"], [patch], (b, input) => {
    const list = b.list(ref);
    return b.upsert("lists", check(ListFields, { ...list, ...input }));
  });
  return list as List;
}

export async function deleteList(s: Scope, ref: string): Promise<List> {
  const [list] = await runBatch(s, ["lists"], [ref], (b, input) => {
    const list = b.list(input);
    b.remove("lists", list.id);
    return { value: list };
  });
  return list as List;
}

// Items

export function summarizeItem(item: Item, lists: Map<string, List>, now: Now) {
  return {
    id: item.id,
    title: item.title,
    list: lists.get(item.list_id)?.name ?? null,
    list_id: item.list_id,
    ...(item.parent_id ? { parent_id: item.parent_id } : {}),
    notes: item.notes || undefined,
    due_date: item.due_date,
    due_time: item.due_time,
    completed: item.completed_at !== null,
    overdue: isOverdue(item, now),
  };
}

export async function listItems(
  s: Scope,
  filter: { list?: string; status?: "open" | "completed" | "all"; due_from?: string; due_to?: string },
) {
  const now = await userNow(s);
  const lists = new Map((await listRecords(s.env.DB, s.userId, "lists")).map((l) => [l.id, l]));
  const listId = filter.list ? (await resolveList(s, filter.list)).id : null;
  const status = filter.status ?? "open";
  return (await listRecords(s.env.DB, s.userId, "items"))
    .filter((i) => !listId || i.list_id === listId)
    .filter((i) => status === "all" || (status === "open") === (i.completed_at === null))
    .filter((i) => !filter.due_from || (i.due_date !== null && i.due_date >= filter.due_from))
    .filter((i) => !filter.due_to || (i.due_date !== null && i.due_date <= filter.due_to))
    .sort(compareItems)
    .map((i) => summarizeItem(i, lists, now));
}

export interface ItemInput {
  list: string;
  /** The parent item's id, making this a subtask. */
  parent?: string | null;
  title: string;
  notes?: string;
  due_date?: string | null;
  due_time?: string | null;
}

export interface ItemPatch {
  id: string;
  title?: string;
  notes?: string;
  due_date?: string | null;
  due_time?: string | null;
  completed?: boolean;
  list?: string;
  parent?: string | null;
}

export async function createItems(s: Scope, inputs: ItemInput[]): Promise<Item[]> {
  return (await runBatch(s, ["lists", "items"], inputs, (b, input) =>
    b.upsert(
      "items",
      check(ItemFields, {
        id: newId(),
        list_id: b.list(input.list).id,
        title: input.title,
        notes: input.notes ?? "",
        due_date: input.due_date ?? null,
        due_time: input.due_time ?? null,
        completed_at: null,
        parent_id: input.parent ?? null,
      }),
    ),
  )) as Item[];
}

export async function updateItems(s: Scope, patches: ItemPatch[]): Promise<Item[]> {
  return (await runBatch(s, ["lists", "items"], patches, (b, patch) => {
    const item = b.live("items", patch.id, "item");
    const listId = patch.list ? b.list(patch.list).id : item.list_id;
    const completedAt =
      patch.completed === undefined ? item.completed_at : patch.completed ? (item.completed_at ?? Date.now()) : null;
    const dueDate = patch.due_date === undefined ? item.due_date : patch.due_date;
    return b.upsert(
      "items",
      check(ItemFields, {
        ...item,
        title: patch.title ?? item.title,
        notes: patch.notes ?? item.notes,
        due_date: dueDate,
        // Clearing the date clears the time with it.
        due_time: dueDate === null ? null : patch.due_time === undefined ? item.due_time : patch.due_time,
        completed_at: completedAt,
        list_id: listId,
        // A subtask moved to another list on its own leaves its parent behind.
        parent_id: patch.parent !== undefined ? patch.parent : listId === item.list_id ? item.parent_id : null,
      }),
    );
  })) as Item[];
}

export async function deleteItems(s: Scope, ids: string[]): Promise<Item[]> {
  return (await runBatch(s, ["items"], ids, (b, id) => {
    const item = b.live("items", id, "item");
    b.remove("items", id);
    return { value: item };
  })) as Item[];
}

// Events

function summarizeOccurrence(o: Occurrence) {
  return {
    event_id: o.event_id,
    occurrence_date: o.occurrence_date,
    title: o.title,
    notes: o.notes || undefined,
    color: o.color,
    all_day: o.all_day,
    start_date: o.start_date,
    start_time: o.start_time,
    end_date: o.end_date,
    end_time: o.end_time,
    recurring: o.recurring,
  };
}

function summarizeExternal(e: ExternalEvent) {
  return { ...e, read_only: true };
}

async function stdDates(
  s: Scope,
  from: string,
  to: string,
): Promise<{ events: ExternalEvent[]; connected: boolean; unavailable: boolean }> {
  try {
    return { events: await fetchStdDates(s.env, s.userId, from, to), connected: true, unavailable: false };
  } catch (err) {
    if (err instanceof StdNotConnectedError) return { events: [], connected: false, unavailable: false };
    if (err instanceof StdUnavailableError) return { events: [], connected: true, unavailable: true };
    throw err;
  }
}

async function occurrences(s: Scope, from: string, to: string): Promise<Occurrence[]> {
  const [events, exceptions] = await Promise.all([
    listRecords(s.env.DB, s.userId, "events"),
    listRecords(s.env.DB, s.userId, "event_exceptions"),
  ]);
  return occurrencesInRange(events, exceptions, from, to);
}

export async function listEvents(s: Scope, from: string, to: string) {
  if (to < from || daysBetween(from, to) > 366) throw new ToolError("from..to must be ordered and at most 366 days");
  const [occ, std] = await Promise.all([occurrences(s, from, to), stdDates(s, from, to)]);
  return {
    events: occ.map(summarizeOccurrence),
    ...(std.connected ? { save_the_date: std.events.map(summarizeExternal) } : {}),
    ...(std.unavailable ? { save_the_date_unavailable: true } : {}),
  };
}

export async function getAgenda(s: Scope, date: string | undefined, days: number) {
  const now = await userNow(s);
  const from = date ?? now.date;
  const to = addDays(from, days - 1);
  const [occ, std, items, lists] = await Promise.all([
    occurrences(s, from, to),
    stdDates(s, from, to),
    listRecords(s.env.DB, s.userId, "items"),
    listRecords(s.env.DB, s.userId, "lists"),
  ]);
  const listMap = new Map(lists.map((l) => [l.id, l]));
  const item = (i: Item) => summarizeItem(i, listMap, now);
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const a = buildAgenda(d, occ, std.events, items, now);
    out.push({
      date: d,
      ...(a.overdue.length ? { overdue_items: a.overdue.map(item) } : {}),
      all_day: a.bars.map((b) => (b.kind === "event" ? summarizeOccurrence(b.occurrence) : summarizeExternal(b.event))),
      timed: a.timed.map((t) =>
        t.kind === "event"
          ? { kind: "event", ...summarizeOccurrence(t.occurrence) }
          : t.kind === "external"
            ? { kind: "save-the-date", ...summarizeExternal(t.event) }
            : { kind: "item", ...item(t.item) },
      ),
      items_due: a.untimed.map(item),
    });
  }
  return {
    timezone: now.timezone,
    today: now.date,
    now: now.time,
    days: out,
    ...(std.unavailable ? { save_the_date_unavailable: true } : {}),
  };
}

export interface ScheduleInput {
  all_day?: boolean;
  start_date?: string;
  start_time?: string | null;
  end_date?: string;
  end_time?: string | null;
}

function shift(date: string, time: string, minutes: number): { date: string; time: string } {
  const total = toMinutes(time) + minutes;
  const days = Math.floor(total / (24 * 60));
  const rest = total - days * 24 * 60;
  return { date: addDays(date, days), time: `${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}` };
}

/**
 * Fills a schedule from partial input over a base (the event or occurrence being changed). Without
 * a start time it is all-day. A timed event without an end time keeps the base's duration, or
 * lasts an hour; an end time earlier than the start means the next day.
 */
function completeSchedule(input: ScheduleInput, base?: ScheduleInput) {
  const start_date = input.start_date ?? base?.start_date;
  if (!start_date) throw new ToolError("start_date is required");
  const all_day = input.all_day ?? (input.start_time !== undefined ? input.start_time === null : (base?.all_day ?? true));
  if (all_day) {
    const span = base?.start_date && base.end_date ? daysBetween(base.start_date, base.end_date) : 0;
    return { all_day, start_date, start_time: null, end_date: input.end_date ?? addDays(start_date, span), end_time: null };
  }
  const start_time = input.start_time ?? base?.start_time;
  if (!start_time) throw new ToolError("start_time is required for a timed event");
  if (input.end_time) {
    const end_date = input.end_date ?? (input.end_time < start_time ? addDays(start_date, 1) : start_date);
    return { all_day, start_date, start_time, end_date, end_time: input.end_time };
  }
  const duration =
    base && !base.all_day && base.start_date && base.start_time && base.end_date && base.end_time
      ? daysBetween(base.start_date, base.end_date) * 24 * 60 + toMinutes(base.end_time) - toMinutes(base.start_time)
      : 60;
  const end = shift(start_date, start_time, duration);
  return { all_day, start_date, start_time, end_date: input.end_date ?? end.date, end_time: end.time };
}


export type EventInput = ScheduleInput & { title: string; notes?: string; color?: PaletteKey; rrule?: string | null };

export type EventPatch = ScheduleInput & {
  id: string;
  /** Defaults to "occurrence" when occurrence_date is given, else "series". */
  scope?: "occurrence" | "series";
  occurrence_date?: string;
  title?: string;
  notes?: string;
  color?: PaletteKey;
  rrule?: string | null;
};

export interface EventDeletion {
  id: string;
  scope?: "occurrence" | "series";
  occurrence_date?: string;
}

const EVENT_TABLES: Entity[] = ["events", "event_exceptions"];

function scopeOf(input: { scope?: "occurrence" | "series"; occurrence_date?: string }): "occurrence" | "series" {
  return input.scope ?? (input.occurrence_date ? "occurrence" : "series");
}

export async function createEvents(s: Scope, inputs: EventInput[]): Promise<CalendarEvent[]> {
  return (await runBatch(s, EVENT_TABLES, inputs, (b, input) =>
    b.upsert(
      "events",
      check(EventFields, {
        id: newId(),
        title: input.title,
        notes: input.notes ?? "",
        color: input.color ?? "blue",
        rrule: input.rrule ?? null,
        ...completeSchedule(input),
      }),
    ),
  )) as CalendarEvent[];
}

function exceptionFor(b: Batch, event: CalendarEvent, occurrenceDate: string): EventException | undefined {
  if (!event.rrule || !ruleDates(event.start_date, parseRRule(event.rrule), occurrenceDate).includes(occurrenceDate)) {
    throw new ToolError(`${occurrenceDate} is not an occurrence of this event`);
  }
  return b.all("event_exceptions").find((x) => x.event_id === event.id && x.occurrence_date === occurrenceDate);
}

export async function updateEvents(s: Scope, patches: EventPatch[]): Promise<(CalendarEvent | EventException)[]> {
  return (await runBatch(s, EVENT_TABLES, patches, (b, patch) => {
    const event = b.live("events", patch.id, "event");
    const occurrenceDate = patch.occurrence_date;
    const scheduleTouched = ["all_day", "start_date", "start_time", "end_date", "end_time"].some(
      (k) => patch[k as keyof ScheduleInput] !== undefined,
    );

    if (scopeOf(patch) === "series" || !event.rrule) {
      const schedule = scheduleTouched ? completeSchedule(patch, event) : null;
      const fields = check(EventFields, {
        ...event,
        title: patch.title ?? event.title,
        notes: patch.notes ?? event.notes,
        color: patch.color ?? event.color,
        // Moving the series start turns its weekdays with it, unless a new rule is given.
        rrule: patch.rrule !== undefined ? patch.rrule : shiftRRule(event.rrule, schedule ? daysBetween(event.start_date, schedule.start_date) : 0),
        ...schedule,
      });
      return b.upsert("events", fields);
    }

    if (!occurrenceDate) throw new ToolError("occurrence_date is required with scope \"occurrence\"");
    if (patch.rrule !== undefined) throw new ToolError("rrule can only change with scope \"series\"");
    const existing = exceptionFor(b, event, occurrenceDate);
    if (existing?.cancelled) throw new ToolError(`The ${occurrenceDate} occurrence was deleted`);
    const span = daysBetween(event.start_date, event.end_date);
    const current = existing?.all_day != null ? existing : { ...event, start_date: occurrenceDate, end_date: addDays(occurrenceDate, span) };
    const schedule = scheduleTouched
      ? completeSchedule(patch, current as ScheduleInput)
      : existing?.all_day != null
        ? { all_day: existing.all_day, start_date: existing.start_date, start_time: existing.start_time, end_date: existing.end_date, end_time: existing.end_time }
        : { all_day: null, start_date: null, start_time: null, end_date: null, end_time: null };
    const exception = check(EventExceptionFields, {
      id: existing?.id ?? newId(),
      event_id: event.id,
      occurrence_date: occurrenceDate,
      cancelled: false,
      title: patch.title ?? existing?.title ?? null,
      notes: patch.notes ?? existing?.notes ?? null,
      color: patch.color ?? existing?.color ?? null,
      ...schedule,
    });
    return b.upsert("event_exceptions", exception);
  })) as (CalendarEvent | EventException)[];
}

export async function deleteEvents(s: Scope, deletions: EventDeletion[]) {
  return runBatch(s, EVENT_TABLES, deletions, (b, { id, occurrence_date: occurrenceDate, ...rest }) => {
    const event = b.live("events", id, "event");
    if (scopeOf({ ...rest, occurrence_date: occurrenceDate }) === "series" || !event.rrule) {
      b.remove("events", id);
      return { value: { deleted: "series", event_id: id, title: event.title } };
    }
    if (!occurrenceDate) throw new ToolError("occurrence_date is required with scope \"occurrence\"");
    const existing = exceptionFor(b, event, occurrenceDate);
    b.upsert("event_exceptions", {
      id: existing?.id ?? newId(),
      event_id: event.id,
      occurrence_date: occurrenceDate,
      cancelled: true,
      title: existing?.title ?? null,
      notes: existing?.notes ?? null,
      color: existing?.color ?? null,
      all_day: existing?.all_day ?? null,
      start_date: existing?.start_date ?? null,
      start_time: existing?.start_time ?? null,
      end_date: existing?.end_date ?? null,
      end_time: existing?.end_time ?? null,
    });
    return { value: { deleted: "occurrence", event_id: id, occurrence_date: occurrenceDate, title: event.title } };
  });
}

export async function search(s: Scope, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) throw new ToolError("query is empty");
  const now = await userNow(s);
  const [items, events, lists] = await Promise.all([
    listRecords(s.env.DB, s.userId, "items"),
    listRecords(s.env.DB, s.userId, "events"),
    listRecords(s.env.DB, s.userId, "lists"),
  ]);
  const listMap = new Map(lists.map((l) => [l.id, l]));
  const hit = (...texts: string[]) => texts.some((t) => t.toLowerCase().includes(needle));
  return {
    items: items.filter((i) => hit(i.title, i.notes)).sort(compareItems).map((i) => summarizeItem(i, listMap, now)),
    events: events
      .filter((e) => hit(e.title, e.notes))
      .map((e) => ({
        id: e.id,
        title: e.title,
        notes: e.notes || undefined,
        all_day: e.all_day,
        start_date: e.start_date,
        start_time: e.start_time,
        end_date: e.end_date,
        end_time: e.end_time,
        rrule: e.rrule,
      })),
  };
}
