import { useRef, useState } from "react";
import type { Item, List } from "../../shared/entities";
import { isOverdue, type Now } from "../../shared/items";
import { Checkbox } from "../components/Checkbox";
import { paletteVar } from "../components/ColorPicker";
import { haptic, transitionMs } from "../components/motion";
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
 * `collapseOnDone` is for views that move completed items elsewhere: the row folds away first, then
 * the item is completed.
 */
export function ItemRow({
  item,
  now,
  list,
  due = "date",
  collapseOnDone,
  onOpen,
}: {
  item: Item;
  now: Now;
  list?: List;
  due?: "date" | "time" | "none";
  collapseOnDone?: boolean;
  onOpen: (item: Item) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const done = item.completed_at !== null;
  const chip =
    due === "date" ? dueLabel(item, now.date) : due === "time" && item.due_time ? formatTime(item.due_time) : null;

  function onToggle() {
    haptic();
    if (done || !collapseOnDone) return toggleItem(item);
    setLeaving(true);
    setTimeout(() => {
      // The record may have changed (a sync pull) while the row folded away.
      const current = store.get("items", item.id);
      if (current) toggleItem(current);
      setLeaving(false);
    }, wrapper.current ? transitionMs(wrapper.current) : 0);
  }

  return (
    <div ref={wrapper} className={`collapse collapse--delayed${leaving ? " collapse--closed" : ""}`}>
      <div className="collapse__inner">
        <div className={`row item${done || leaving ? " item--done" : ""}`}>
          <Checkbox
            checked={done || leaving}
            onChange={() => leaving || onToggle()}
            label={done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
          />
          <button type="button" className="item__body" onClick={() => onOpen(item)}>
            {list && <span className="dot" style={{ background: paletteVar(list.color) }} aria-hidden="true" />}
            <span className="row__title">{item.title}</span>
            {chip && <span className={`chip${isOverdue(item, now) ? " chip--overdue" : ""}`}>{chip}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
