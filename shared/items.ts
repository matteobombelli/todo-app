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

/** Open items in display order, and completed ones most recently completed first. */
export function orderItems(items: Item[]): { open: Item[]; completed: Item[] } {
  const live = items.filter((i) => i.deleted_at === null);
  return {
    open: live.filter((i) => i.completed_at === null).sort(compareItems),
    completed: live
      .filter((i) => i.completed_at !== null)
      .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0)),
  };
}
