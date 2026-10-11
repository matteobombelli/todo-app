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

type Slot = Pick<Item, "due_date" | "due_time">;
const sameSlot = (a: Slot, b: Slot) => a.due_date === b.due_date && a.due_time === b.due_time;

/** Gap between ranks after respace: room for about 20 more halvings before the next respace. */
const STEP = 1024;

/**
 * New positions for `items` (already in order) spaced STEP apart from the first one's rank. Used
 * when two neighbours' ranks can't be told apart any more: repeated halving runs out of float
 * precision at epoch-millisecond scale, and records created together can share a rank.
 */
function respace(items: Item[]): Map<string, number> {
  const base = items.length ? itemRank(items[0]) : 0;
  return new Map(items.map((i, n) => [i.id, base + n * STEP]));
}

/** A rank strictly between two (either end open), or null when floats can't fit one there. */
function between(lo: number | null, hi: number | null): number | null {
  const p = lo !== null && hi !== null ? (lo + hi) / 2 : lo !== null ? lo + STEP : hi! - STEP;
  return (lo === null || p > lo) && (hi === null || p < hi) ? p : null;
}

/**
 * Where a new item due at `slot` goes to sort straight after `anchor`: its position (null to leave
 * it to created_at, when the anchor is last or due at another slot), plus positions to write first
 * for the slot's other items when there was no room left beside the anchor.
 */
export function placeAfter(anchor: Item, slot: Slot, items: Item[]): { position: number | null; respaced: Map<string, number> } {
  const position = positionAfter(anchor, slot, items);
  const none = new Map<string, number>();
  if (position === null) return { position, respaced: none };
  const rank = itemRank(anchor);
  const next = Math.min(...items.filter((i) => i.id !== anchor.id && sameSlot(i, slot) && itemRank(i) > rank).map(itemRank));
  if (position > rank && position < next) return { position, respaced: none };
  const ordered = items.filter((i) => sameSlot(i, slot)).sort(compareItems);
  const respaced = respace(ordered);
  const after = ordered[ordered.findIndex((i) => i.id === anchor.id) + 1];
  return { position: between(respaced.get(anchor.id)!, after ? respaced.get(after.id)! : null), respaced };
}

/**
 * The positions that move the open item `id` to `gap` in `open` (orderItems' display order), where
 * gap g is the slot between rows g-1 and g; a top-level item takes its subtasks along. It can only
 * move among its siblings (the other top-level items, or its parent's other subtasks) due at the same
 * date and time, since the rest of the order comes from due dates. Usually just the item's own
 * position; when its new neighbours' ranks leave no room, its slot's items are respaced too. Null
 * when the gap is somewhere else, or where the item already is.
 */
export function reorderPositions(open: { item: Item; nested: boolean }[], id: string, gap: number): Map<string, number> | null {
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
  const same = (i: Item | null) => i !== null && sameSlot(i, dragged.item);
  if (!same(before)) before = null;
  if (!same(after)) after = null;
  if (!before && !after) return null;

  const ids = open.map((o) => o.item.id);
  const block = open.filter(moving).map((o) => o.item.id);
  const rest = open.filter((o) => !moving(o)).map((o) => o.item.id);
  const at = prev ? rest.indexOf(prev.item.id) + 1 : 0;
  const wanted = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  if (wanted.join() === ids.join()) return null;
  // Whether these positions give the order asked for.
  const gives = (positions: Map<string, number>) =>
    orderItems(open.map((o) => (positions.has(o.item.id) ? { ...o.item, position: positions.get(o.item.id)! } : o.item)))
      .open.map((o) => o.item.id)
      .join() === wanted.join();

  const simple = between(before && itemRank(before), after && itemRank(after));
  if (simple !== null && gives(new Map([[id, simple]]))) return new Map([[id, simple]]);
  // No room: respace the slot's other items (keeping their order), then fit it between again.
  const respaced = respace(open.map((o) => o.item).filter((i) => i.id !== id && sameSlot(i, dragged.item)).sort(compareItems));
  const position = between(before && respaced.get(before.id)!, after && respaced.get(after.id)!);
  if (position === null) return null;
  respaced.set(id, position);
  return gives(respaced) ? respaced : null;
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
