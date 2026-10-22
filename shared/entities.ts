import { z } from "zod";
import { daysBetween, isDate, isTime } from "./dates";
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

/** Whether a repeat rule ends before its first date, leaving it with no occurrences at all. */
function endsBefore(rrule: string | null, start: string | null): boolean {
  if (rrule === null || start === null) return false;
  try {
    const until = parseRRule(rrule).until;
    return until !== null && until < start;
  } catch {
    return false; // An unparseable rule is reported by its own field.
  }
}

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
    // Repeats from due_date: completing the item moves it to the next occurrence (see completeItem).
    rrule: RRule.nullable().default(null),
    // Order among items with the same due date and time, in created_at's units; null means
    // created_at (see itemRank). Set when an item is added below another.
    position: z.number().finite().nullable().default(null),
  })
  .refine((i) => i.due_time === null || i.due_date !== null, { message: "due_time needs due_date", path: ["due_time"] })
  .refine((i) => i.rrule === null || i.due_date !== null, { message: "A repeating item needs a due date", path: ["rrule"] })
  .refine((i) => i.rrule === null || i.parent_id === null, { message: "A subtask can't repeat", path: ["rrule"] })
  .refine((i) => !endsBefore(i.rrule, i.due_date), { message: "The repeat ends before the due date", path: ["rrule"] });

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
  })
  .refine((e) => !endsBefore(e.rrule, e.start_date), { message: "The repeat ends before the event starts", path: ["rrule"] });

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

export const GOAL_STATUSES = ["draft", "active", "abandoned", "closed"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

const LongText = z.string().max(2_000);
const Half = (n: number) => Number.isInteger(n * 2);

// A goal's SMART answers: Specific, Achievable and Relevant are text; Measurable is target_days
// plus an optional metric moving from metric_baseline to metric_target; Time-bound is the dates.
// What may change, and when, is in shared/goals.ts (goalProblem).
export const GoalFields = z
  .object({
    id: Id,
    title: z.string().trim().min(1).max(200),
    color: Color,
    specific: LongText,
    achievable: LongText,
    relevant: LongText,
    start_date: DateStr,
    end_date: DateStr,
    target_days: z.number().positive().refine(Half, "Whole or half days"),
    metric_label: z.string().trim().min(1).max(120).nullable(),
    metric_unit: z.string().trim().max(40).nullable(),
    metric_baseline: z.number().finite().nullable(),
    metric_target: z.number().finite().nullable(),
    before_note: LongText,
    after_value: z.number().finite().nullable(),
    after_note: LongText.nullable(),
    status: z.enum(GOAL_STATUSES),
    // Server-owned: the client's value is ignored (see stampGoal).
    committed_at: z.number().int().nullable(),
    closed_at: z.number().int().nullable(),
  })
  .refine((g) => g.end_date >= g.start_date, { message: "The goal ends before it starts", path: ["end_date"] })
  .refine((g) => g.end_date < g.start_date || g.target_days <= periodLength(g), {
    message: "The target is more days than the goal lasts",
    path: ["target_days"],
  })
  .refine(
    (g) =>
      g.metric_label === null
        ? g.metric_unit === null && g.metric_baseline === null && g.metric_target === null && g.after_value === null
        : g.metric_baseline !== null && g.metric_target !== null,
    { message: "A metric needs a label, a starting value and a target", path: ["metric_label"] },
  );

// A day's effort on a goal: half or a full day. Zero is no entry.
export const GoalEntryFields = z.object({
  id: Id,
  goal_id: Id,
  date: DateStr,
  amount: z.union([z.literal(0.5), z.literal(1)]),
  note: z.string().max(500),
});

/** Days from start_date to end_date, both included. */
export function periodLength(g: { start_date: string; end_date: string }): number {
  return daysBetween(g.start_date, g.end_date) + 1;
}

export type ListFields = z.infer<typeof ListFields>;
export type ItemFields = z.infer<typeof ItemFields>;
export type EventFields = z.infer<typeof EventFields>;
export type EventExceptionFields = z.infer<typeof EventExceptionFields>;
export type GoalFields = z.infer<typeof GoalFields>;
export type GoalEntryFields = z.infer<typeof GoalEntryFields>;

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
export type Goal = GoalFields & Meta;
export type GoalEntry = GoalEntryFields & Meta;

export const ENTITIES = ["lists", "items", "events", "event_exceptions", "goals", "goal_entries"] as const;
export type Entity = (typeof ENTITIES)[number];

export interface EntityRecord {
  lists: List;
  items: Item;
  events: CalendarEvent;
  event_exceptions: EventException;
  goals: Goal;
  goal_entries: GoalEntry;
}

/** What a client sends for a record: everything but the server-owned Meta fields. */
export type Fields<E extends Entity> = Omit<EntityRecord[E], keyof Meta>;

/** Rows whose deletion follows their parent's, on the server and in the client mirror. */
export const CHILDREN: Partial<Record<Entity, { entity: Entity; column: string }[]>> = {
  lists: [{ entity: "items", column: "list_id" }],
  items: [{ entity: "items", column: "parent_id" }],
  events: [{ entity: "event_exceptions", column: "event_id" }],
  goals: [{ entity: "goal_entries", column: "goal_id" }],
};

export const FIELD_SCHEMAS = {
  lists: ListFields,
  items: ItemFields,
  events: EventFields,
  event_exceptions: EventExceptionFields,
  goals: GoalFields,
  goal_entries: GoalEntryFields,
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
  goals: Goal[];
  goal_entries: GoalEntry[];
}
