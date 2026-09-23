import { z } from "zod";
import { isDate, isTime } from "./dates";
import { PALETTE_KEYS } from "./palette";
import { parseRRule, serializeRRule } from "./recurrence";

// Synced records are the same shape in D1 (booleans aside), on the wire and in IndexedDB.
// A mutation carries the full record minus the server-owned Meta fields.

const Id = z.uuid();
export const DateStr = z.string().refine(isDate, "Expected YYYY-MM-DD");
export const TimeStr = z.string().refine(isTime, "Expected HH:MM");
const Color = z.enum(PALETTE_KEYS);
const Title = z.string().trim().min(1).max(500);
const Notes = z.string().max(10_000);
// Stored in canonical form, so equal rules compare equal as strings.
const RRule = z
  .string()
  .refine((s) => {
    try {
      parseRRule(s);
      return true;
    } catch {
      return false;
    }
  }, "Unsupported RRULE")
  .transform((s) => serializeRRule(parseRRule(s)));

export const ListFields = z.object({
  id: Id,
  name: z.string().trim().min(1).max(120),
  color: Color,
  sort_order: z.number().int(),
});

export const ItemFields = z
  .object({
    id: Id,
    list_id: Id,
    title: Title,
    notes: Notes,
    due_date: DateStr.nullable(),
    due_time: TimeStr.nullable(),
    completed_at: z.number().int().nullable(),
    // A subtask's parent item. Records and clients from before subtasks leave it out.
    parent_id: Id.nullable().default(null),
  })
  .refine((i) => i.due_time === null || i.due_date !== null, { message: "due_time needs due_date", path: ["due_time"] });

const eventTimesValid = (e: {
  all_day: boolean;
  start_date: string;
  start_time: string | null;
  end_date: string;
  end_time: string | null;
}) =>
  e.all_day
    ? e.start_time === null && e.end_time === null && e.end_date >= e.start_date
    : e.start_time !== null &&
      e.end_time !== null &&
      `${e.end_date}T${e.end_time}` >= `${e.start_date}T${e.start_time}`;

export const EventFields = z
  .object({
    id: Id,
    title: Title,
    notes: Notes,
    color: Color,
    all_day: z.boolean(),
    start_date: DateStr,
    start_time: TimeStr.nullable(),
    end_date: DateStr,
    end_time: TimeStr.nullable(),
    rrule: RRule.nullable(),
  })
  .refine(eventTimesValid, {
    message: "All-day events have no times; timed events need both, and the end cannot precede the start",
  });

// Override columns are all-or-nothing for the schedule: either every schedule field is null (keep
// the series' schedule) or they describe a full valid schedule.
export const EventExceptionFields = z
  .object({
    id: Id,
    event_id: Id,
    occurrence_date: DateStr,
    cancelled: z.boolean(),
    title: Title.nullable(),
    notes: Notes.nullable(),
    color: Color.nullable(),
    all_day: z.boolean().nullable(),
    start_date: DateStr.nullable(),
    start_time: TimeStr.nullable(),
    end_date: DateStr.nullable(),
    end_time: TimeStr.nullable(),
  })
  .refine(
    (x) =>
      x.all_day === null
        ? x.start_date === null && x.end_date === null && x.start_time === null && x.end_time === null
        : x.start_date !== null &&
          x.end_date !== null &&
          eventTimesValid({ ...x, all_day: x.all_day, start_date: x.start_date, end_date: x.end_date }),
    { message: "Schedule override must be complete and valid" },
  );

export type ListFields = z.infer<typeof ListFields>;
export type ItemFields = z.infer<typeof ItemFields>;
export type EventFields = z.infer<typeof EventFields>;
export type EventExceptionFields = z.infer<typeof EventExceptionFields>;

export interface Meta {
  created_at: number;
  updated_at: number;
  seq: number;
  deleted_at: number | null;
}

export type List = ListFields & Meta;
export type Item = ItemFields & Meta;
export type CalendarEvent = EventFields & Meta;
export type EventException = EventExceptionFields & Meta;

export const ENTITIES = ["lists", "items", "events", "event_exceptions"] as const;
export type Entity = (typeof ENTITIES)[number];

export interface EntityRecord {
  lists: List;
  items: Item;
  events: CalendarEvent;
  event_exceptions: EventException;
}

/** What a client sends for a record: everything but the server-owned Meta fields. */
export type Fields<E extends Entity> = Omit<EntityRecord[E], keyof Meta>;

/** Rows whose deletion follows their parent's, on the server and in the client mirror. */
export const CHILDREN: Partial<Record<Entity, { entity: Entity; column: string }[]>> = {
  lists: [{ entity: "items", column: "list_id" }],
  items: [{ entity: "items", column: "parent_id" }],
  events: [{ entity: "event_exceptions", column: "event_id" }],
};

export const FIELD_SCHEMAS = {
  lists: ListFields,
  items: ItemFields,
  events: EventFields,
  event_exceptions: EventExceptionFields,
} as const;

// Record left loose here: FIELD_SCHEMAS[entity] validates it once the entity is known.
export const Mutation = z.discriminatedUnion("action", [
  z.object({ op_id: Id, entity: z.enum(ENTITIES), action: z.literal("upsert"), record: z.looseObject({ id: Id }) }),
  z.object({ op_id: Id, entity: z.enum(ENTITIES), action: z.literal("delete"), record: z.object({ id: Id }) }),
]);
export type Mutation = z.infer<typeof Mutation>;

export const MutationBatch = z.object({ mutations: z.array(Mutation).min(1).max(200) });
export type MutationBatch = z.input<typeof MutationBatch>;

export type MutationResult =
  | { op_id: string; status: "applied"; seq: number }
  // current is the server's copy (possibly a tombstone) or null when it has none; the client
  // replaces its optimistic copy with it.
  | { op_id: string; status: "rejected"; error: string; current: EntityRecord[Entity] | null };

export interface SyncResponse {
  cursor: number;
  lists: List[];
  items: Item[];
  events: CalendarEvent[];
  event_exceptions: EventException[];
}
