import type { Item, List } from "../../shared/entities";
import { isOverdue, type Now } from "../../shared/items";
import { paletteVar } from "../components/ColorPicker";
import { store } from "../data/instance";
import { formatRelativeDate, formatTime } from "../format";

export function toggleItem(item: Item): void {
  void store.upsert("items", { ...item, completed_at: item.completed_at === null ? Date.now() : null });
}

export function dueLabel(item: Item, today: string): string | null {
  if (item.due_date === null) return null;
  const date = formatRelativeDate(item.due_date, today);
  return item.due_time ? `${date}, ${formatTime(item.due_time)}` : date;
}

/**
 * A checkable item. `list` adds its colour dot, for views that mix lists. `due` picks what the chip
 * shows: the full due date, only the time (views already grouped by day), or nothing.
 */
export function ItemRow({
  item,
  now,
  list,
  due = "date",
  onOpen,
}: {
  item: Item;
  now: Now;
  list?: List;
  due?: "date" | "time" | "none";
  onOpen: (item: Item) => void;
}) {
  const done = item.completed_at !== null;
  const chip =
    due === "date" ? dueLabel(item, now.date) : due === "time" && item.due_time ? formatTime(item.due_time) : null;
  return (
    <div className={`row item${done ? " item--done" : ""}`}>
      <input
        type="checkbox"
        className="item__check"
        checked={done}
        onChange={() => toggleItem(item)}
        aria-label={done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
      />
      <button type="button" className="item__body" onClick={() => onOpen(item)}>
        {list && <span className="dot" style={{ background: paletteVar(list.color) }} aria-hidden="true" />}
        <span className="row__title">{item.title}</span>
        {chip && <span className={`chip${isOverdue(item, now) ? " chip--overdue" : ""}`}>{chip}</span>}
      </button>
    </div>
  );
}
