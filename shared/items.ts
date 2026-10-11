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
 * The position that moves the open item `id` to `gap` in `open` (orderItems' display order), where
 * gap g is the slot between rows g-1 and g; a top-level item takes its subtasks along. It can only
 * move among its siblings (the other top-level items, or its parent's other subtasks) due at the same
 * date and time, since the rest of the order comes from due dates. Null when the gap is somewhere
 * else, or where the item already is.
 */
export function reorderPosition(open: { item: Item; nested: boolean }[], id: string, gap: number): number | null {
  const dragged = open.find((o) => o.item.id === id);
  if (!dragged) return null;
  const moving = (o: { item: Item; nested: boolean }) => o.item.id === id || (!dragged.nested && o.nested && o.item.parent_id === id);
  const prev = open.slice(0, gap).filter((o) => !moving(o)).at(-1);
  const next = open.slice(gap).find((o) => !moving(o));

  let before: Item | null;
  let after: Item | null;
  if (dragged.nested) {
    // Within its parent's subtasks: after the parent or one of them.
    const parent = dragged.item.parent_id;
    if (!prev || (prev.nested ? prev.item.parent_id !== parent : prev.item.id !== parent)) return null;
    before = prev.nested ? prev.item : null;
    after = next?.nested && next.item.parent_id === parent ? next.item : null;
  } else {
    // Never between a parent and its subtasks; after a block, the sibling above is its parent.
    if (next?.nested) return null;
    before = prev ? (prev.nested ? (open.find((o) => o.item.id === prev.item.parent_id)?.item ?? null) : prev.item) : null;
    after = next?.item ?? null;
  }
  const same = (i: Item | null) => i !== null && i.due_date === dragged.item.due_date && i.due_time === dragged.item.due_time;
  if (!same(before)) before = null;
  if (!same(after)) after = null;
  if (!before && !after) return null;
  const position = before && after ? (itemRank(before) + itemRank(after)) / 2 : before ? itemRank(before) + 1 : itemRank(after!) - 1;

  // Check that the order this gives is the one asked for, and that it changes anything.
  const ids = open.map((o) => o.item.id);
  const block = open.filter(moving).map((o) => o.item.id);
  const rest = open.filter((o) => !moving(o)).map((o) => o.item.id);
  const at = prev ? rest.indexOf(prev.item.id) + 1 : 0;
  const wanted = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  if (wanted.join() === ids.join()) return null;
  const got = orderItems(open.map((o) => (o.item.id === id ? { ...o.item, position } : o.item))).open.map((o) => o.item.id);
  return got.join() === wanted.join() ? position : null;
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
