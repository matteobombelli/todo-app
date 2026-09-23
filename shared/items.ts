import type { Item } from "./entities";

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

// Dated items by date then time, a date's untimed items after its timed ones, then undated items
// oldest first. Overdue items need no special case: they have the earliest dates.
export function compareItems(a: Item, b: Item): number {
  if (a.due_date === null || b.due_date === null) {
    if (a.due_date !== b.due_date) return a.due_date === null ? 1 : -1;
    return a.created_at - b.created_at || a.id.localeCompare(b.id);
  }
  return (
    a.due_date.localeCompare(b.due_date) ||
    (a.due_time ?? "24:00").localeCompare(b.due_time ?? "24:00") ||
    a.created_at - b.created_at ||
    a.id.localeCompare(b.id)
  );
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
