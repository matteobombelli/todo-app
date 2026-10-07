import { CalendarPlus, Check, ChevronRight, Ellipsis, Info, Repeat, Trash2 } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import type { Item, List } from "../../shared/entities";
import { completeItem, isOverdue, type Now } from "../../shared/items";
import { Checkbox } from "../components/Checkbox";
import { paletteVar } from "../components/ColorPicker";
import { useRowSwipe } from "../components/gestures";
import { IconButton } from "../components/IconButton";
import { haptic, transitionMs } from "../components/motion";
import { localNow } from "../data/hooks";
import { store } from "../data/instance";
import { formatRelativeDate, formatTime } from "../format";
import { deleteItem } from "./itemMenu";

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
 * left out); `onMenu` opens its actions, from a right-click or the row's kebab. `onDateMenu` makes
 * the due date a button that opens rescheduling choices. `swipe` turns on touch swipes: right to
 * check the item off (or back on), left to delete it.
 *
 * With `edit`, the title is a field being edited in place, as in Reminders: Return saves it and
 * calls `onReturn` (to start a new item below), leaving the field saves it and calls `onDone`, and
 * Escape drops the change. Saving an empty title deletes the item. The row also offers its date and
 * its details (`onDetails`) while editing.
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
  onDateMenu,
  swipe,
  edit,
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
  onDateMenu?: (e: MouseEvent, item: Item) => void;
  swipe?: boolean;
  edit?: { onReturn: (item: Item) => void; onDone: () => void; onDetails: (item: Item) => void };
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const swiper = useRef<HTMLDivElement>(null);
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

  useRowSwipe(swiper, swipe && !edit ? { right: onToggle, left: () => deleteItem(item) } : null);

  const chipClass = `chip${isOverdue(item, now) ? " chip--overdue" : ""}`;
  // Pressing these must not take focus from the title being edited, which would end the edit
  // and unmount them before the click lands.
  const keepFocus = (e: MouseEvent) => edit && e.preventDefault();
  const dateButton =
    onDateMenu &&
    (chip ? (
      <button
        type="button"
        className={`${chipClass} chip--button`}
        aria-haspopup="menu"
        aria-label={`Due ${chip}, change`}
        onMouseDown={keepFocus}
        onClick={(e) => onDateMenu(e, item)}
      >
        {chip}
      </button>
    ) : (
      edit && (
        <IconButton icon={CalendarPlus} label="Add a date" className="row__kebab item__add-date" ariaHasPopup="menu" onMouseDown={keepFocus} onClick={(e) => onDateMenu(e, item)} />
      )
    ));

  const body = (
    <>
      {list && <span className="dot" style={{ background: paletteVar(list.color) }} aria-hidden="true" />}
      <span className="row__title">{item.title}</span>
      {item.rrule && <Repeat size={14} className="item__repeat" aria-label="Repeats" />}
      {chip && !onDateMenu && <span className={chipClass}>{chip}</span>}
      {context && <span className="row__meta">{context}</span>}
    </>
  );

  return (
    <div
      ref={wrapper}
      className={`collapse${leaving ? " collapse--delayed collapse--closed" : hidden ? " collapse--closed" : ""}`}
      inert={hidden}
    >
      <div className={`collapse__inner${swipe ? " swipe" : ""}`} ref={swiper}>
        {swipe && (
          <>
            <span className="swipe__action swipe__action--right" aria-hidden="true">
              <Check size={20} strokeWidth={2.25} />
            </span>
            <span className="swipe__action swipe__action--left" aria-hidden="true">
              <Trash2 size={20} />
            </span>
          </>
        )}
        <div
          className={`row item${nested ? " item--subtask" : ""}${done || leaving ? " item--done" : ""}${edit ? " item--editing" : ""}`}
          onContextMenu={onMenu && !edit ? (e) => onMenu(e, item) : undefined}
        >
          <Checkbox
            checked={done || leaving}
            onChange={() => leaving || onToggle()}
            label={done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
          />
          {edit ? (
            <TitleField item={item} edit={edit} />
          ) : onTap ? (
            <button type="button" className="item__body" onClick={() => onTap(item)}>
              {body}
            </button>
          ) : (
            <span className="item__body">{body}</span>
          )}
          {dateButton}
          {edit && (
            <IconButton icon={Info} label="Details" className="row__kebab item__info" ariaHasPopup="dialog" onMouseDown={keepFocus} onClick={() => edit.onDetails(item)} />
          )}
          {fold && !edit && (
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
          {onMenu && !edit && (
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

/** The title being edited in place (see ItemRow's `edit`). Saves once, however the edit ends. */
function TitleField({ item, edit }: { item: Item; edit: NonNullable<Parameters<typeof ItemRow>[0]["edit"]> }) {
  const [title, setTitle] = useState(item.title);
  const ended = useRef(false);

  function end(save: boolean, then: () => void) {
    if (ended.current) return;
    ended.current = true;
    const current = store.get("items", item.id);
    const trimmed = title.trim();
    if (save && current) {
      if (!trimmed) deleteItem(current);
      else if (trimmed !== current.title) void store.upsert("items", { ...current, title: trimmed });
    }
    then();
  }

  return (
    <input
      autoFocus
      className="item__input"
      aria-label="Title"
      maxLength={500}
      enterKeyHint="next"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => end(true, edit.onDone)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          // An emptied title deletes the item, so there is nothing to add below.
          end(true, title.trim() ? () => edit.onReturn(item) : edit.onDone);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          end(false, edit.onDone);
        }
      }}
    />
  );
}
