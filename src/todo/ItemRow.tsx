import { ChevronRight, Ellipsis, Repeat } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import type { Item, List } from "../../shared/entities";
import { completeItem, isOverdue, type Now } from "../../shared/items";
import { Checkbox } from "../components/Checkbox";
import { paletteVar } from "../components/ColorPicker";
import { IconButton } from "../components/IconButton";
import { haptic, transitionMs } from "../components/motion";
import { localNow } from "../data/hooks";
import { store } from "../data/instance";
import { formatRelativeDate, formatTime } from "../format";

export function toggleItem(item: Item): void {
  void store.upsert("items", item.completed_at === null ? completeItem(item, localNow()) : { ...item, completed_at: null });
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
 * the item is completed. `nested` indents a subtask under its parent, and `hidden` folds it away with
 * its parent's subtasks; `fold` gives a parent the toggle for that. `context` is a short note after the
 * title (a subtask's parent, where it isn't shown). `onTap` is what tapping the row does (nothing when
 * left out); `onMenu` opens its actions, from a right-click or the row's kebab.
 */
export function ItemRow({
  item,
  now,
  list,
  due = "date",
  collapseOnDone,
  nested,
  hidden,
  fold,
  context,
  onTap,
  onMenu,
}: {
  item: Item;
  now: Now;
  list?: List;
  due?: "date" | "time" | "none";
  collapseOnDone?: boolean;
  nested?: boolean;
  hidden?: boolean;
  fold?: { count: number; collapsed: boolean; onToggle: () => void };
  context?: string;
  onTap?: (item: Item) => void;
  onMenu?: (e: MouseEvent, item: Item) => void;
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

  const body = (
    <>
      {list && <span className="dot" style={{ background: paletteVar(list.color) }} aria-hidden="true" />}
      <span className="row__title">{item.title}</span>
      {item.rrule && <Repeat size={14} className="item__repeat" aria-label="Repeats" />}
      {chip && <span className={`chip${isOverdue(item, now) ? " chip--overdue" : ""}`}>{chip}</span>}
      {context && <span className="row__meta">{context}</span>}
    </>
  );

  return (
    <div
      ref={wrapper}
      className={`collapse${leaving ? " collapse--delayed collapse--closed" : hidden ? " collapse--closed" : ""}`}
      inert={hidden}
    >
      <div className="collapse__inner">
        <div
          className={`row item${nested ? " item--subtask" : ""}${done || leaving ? " item--done" : ""}`}
          onContextMenu={onMenu && ((e) => onMenu(e, item))}
        >
          <Checkbox
            checked={done || leaving}
            onChange={() => leaving || onToggle()}
            label={done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
          />
          {onTap ? (
            <button type="button" className="item__body" onClick={() => onTap(item)}>
              {body}
            </button>
          ) : (
            <span className="item__body">{body}</span>
          )}
          {fold && (
            <button
              type="button"
              className="item__fold"
              aria-expanded={!fold.collapsed}
              aria-label={fold.collapsed ? `Show ${fold.count} subtasks` : "Hide subtasks"}
              onClick={fold.onToggle}
            >
              {fold.collapsed && <span className="row__meta">{fold.count}</span>}
              <ChevronRight size={18} className="item__fold-chevron" aria-hidden="true" />
            </button>
          )}
          {onMenu && (
            <IconButton
              icon={Ellipsis}
              label={`Actions for "${item.title}"`}
              className="row__kebab"
              ariaHasPopup="menu"
              onClick={(e) => onMenu(e, item)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
