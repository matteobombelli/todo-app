import type { Item, ItemFields } from "./entities";
import { nextOccurrence, parseRRule, serializeRRule } from "./recurrence";

export interface Now {
  date: string;
  time: string;
}

/** Uncompleted and past its due date, or due today at a time that has passed. */
export function isOverdue(item: Item, now: Now): boolean {
  if (item.completed_at !== null || item.due_date === null) return false;
  if (item.due_date !== now.date) return item.due_date < now.date;
  return item.due_time !== null && item.due_time < now.time;
}

/** An item's place among those due at the same date and time: its position, or when it was created. */
export function itemRank(item: Pick<Item, "position" | "created_at">): number {
  return item.position ?? item.created_at;
}

// Dated items by date then time, a date's untimed items after its timed ones, then undated items;
// items due at the same date and time by rank, so oldest first unless placed. Overdue items need no
// special case: they have the earliest dates.
export function compareItems(a: Item, b: Item): number {
  if (a.due_date === null || b.due_date === null) {
    if (a.due_date !== b.due_date) return a.due_date === null ? 1 : -1;
    return itemRank(a) - itemRank(b) || a.id.localeCompare(b.id);
  }
  return (
    a.due_date.localeCompare(b.due_date) ||
    (a.due_time ?? "24:00").localeCompare(b.due_time ?? "24:00") ||
    itemRank(a) - itemRank(b) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * The position for a new item due at `slot` that sorts straight after `anchor` among `items`. Null
 * (created_at, so after everything already there) when the anchor is last or due at another slot.
 */
export function positionAfter(anchor: Item, slot: Pick<Item, "due_date" | "due_time">, items: Item[]): number | null {
  const same = (i: Pick<Item, "due_date" | "due_time">) => i.due_date === slot.due_date && i.due_time === slot.due_time;
  if (!same(anchor)) return null;
  const rank = itemRank(anchor);
  const next = items
    .filter((i) => i.id !== anchor.id && same(i) && itemRank(i) > rank)
    .reduce<number | null>((min, i) => (min === null || itemRank(i) < min ? itemRank(i) : min), null);
  return next === null ? null : (rank + next) / 2;
}

/**
 * Open items in display order, each followed by its open subtasks (`nested`), and completed ones
 * most recently completed first. A subtask whose parent isn't open stands on its own.
 */
export function orderItems(items: Item[]): { open: { item: Item; nested: boolean }[]; completed: Item[] } {
  const live = items.filter((i) => i.deleted_at === null);
  const open = live.filter((i) => i.completed_at === null).sort(compareItems);
  const openIds = new Set(open.map((i) => i.id));
  const nested = (i: Item) => i.parent_id !== null && openIds.has(i.parent_id);
  return {
    open: open
      .filter((i) => !nested(i))
      .flatMap((parent) => [
        { item: parent, nested: false },
        ...open.filter((i) => i.parent_id === parent.id).map((item) => ({ item, nested: true })),
      ]),
    completed: live
      .filter((i) => i.completed_at !== null)
      .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0)),
  };
}

type Placement = Pick<Item, "list_id" | "completed_at">;

/**
 * What writing an item does to its subtasks: moving it moves them, and completing it completes the
 * open ones (reopening leaves them, as in Reminders). Returns only the subtasks that change.
 */
export function cascadeToSubtasks<T extends Placement>(before: Placement | null, after: Placement, subtasks: T[]): T[] {
  const completing = before !== null && before.completed_at === null && after.completed_at !== null;
  return subtasks.flatMap((sub) => {
    const completed_at = completing && sub.completed_at === null ? after.completed_at : sub.completed_at;
    return sub.list_id === after.list_id && completed_at === sub.completed_at ? [] : [{ ...sub, list_id: after.list_id, completed_at }];
  });
}

/**
 * The record to write when an open item is checked off. A repeating item moves to its next due date
 * and stays open; when the rule has no next date (UNTIL passed, COUNT used up) it completes like any
 * other item. COUNT is the occurrences left, this one included, so each roll takes one off.
 */
export function completeItem<T extends ItemFields>(item: T, now: Now, at = Date.now()): T {
  if (item.rrule === null || item.due_date === null) return { ...item, completed_at: at };
  const rule = parseRRule(item.rrule);
  if (rule.count === 1) return { ...item, completed_at: at };
  const next = nextOccurrence(rule, item.due_date, item.due_date > now.date ? item.due_date : now.date);
  if (next === null) return { ...item, completed_at: at };
  return {
    ...item,
    due_date: next,
    rrule: serializeRRule({ ...rule, count: rule.count === null ? null : rule.count - 1 }),
  };
}
