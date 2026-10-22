import { CalendarPlus, Check, ChevronRight, Ellipsis, Info, Repeat, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
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
  }

  // Timed once the row has its leaving classes, so the fold's delay is part of the wait (measured
  // before, the item completed and the row jumped away mid-fold). Not cancelled on unmount: the
  // check-off still lands if the page changes meanwhile.
  useEffect(() => {
    if (!leaving) return;
    setTimeout(() => {
      // The record may have changed (a sync pull) while the row folded away.
      const current = store.get("items", item.id);
      if (current) toggleItem(current);
      setLeaving(false);
    }, wrapper.current ? transitionMs(wrapper.current) : 0);
  }, [leaving, item.id]);

  // While editing, the field's save, so Details opens with the title just typed.
  const saveTitle = useRef<(() => Item) | null>(null);

  useRowSwipe(swiper, swipe && !edit ? { right: onToggle, left: () => deleteItem(item) } : null);

  const chipClass = `chip${isOverdue(item, now) ? " chip--overdue" : ""}`;
  // Pressing these must not take focus from the title being edited, which would end the edit
  // and unmount them before the click lands.
  const keepFocus = (e: MouseEvent) => edit && e.preventDefault();
  const dateButton = onDateMenu && chip && (
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
  );
  const addDate = onDateMenu && !chip && edit && (
    <IconButton icon={CalendarPlus} label="Add a date" className="row__kebab item__add-date" ariaHasPopup="menu" onMouseDown={keepFocus} onClick={(e) => onDateMenu(e, item)} />
  );

  const title = (
    <>
      {list && <span className="dot" style={{ background: paletteVar(list.color) }} aria-hidden="true" />}
      <span className="row__title">{item.title}</span>
    </>
  );
  // What's known about the item besides its title: under it in the todo tab, beside it elsewhere.
  const meta = (dateButton || chip || item.rrule || context) && (
    <span className="item__meta">
      {dateButton || (chip && <span className={chipClass}>{chip}</span>)}
      {item.rrule && <Repeat size={13} className="item__repeat" aria-label="Repeats" />}
      {context && <span className="row__meta">{context}</span>}
    </span>
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
          <div className="item__main">
            {edit ? (
              <TitleField item={item} edit={edit} saveRef={saveTitle} />
            ) : onTap ? (
              <button type="button" className="item__body" onClick={() => onTap(item)}>
                {title}
              </button>
            ) : (
              <span className="item__body">{title}</span>
            )}
            {meta}
          </div>
          {addDate}
          {edit && (
            <IconButton
              icon={Info}
              label="Details"
              className="row__kebab item__info"
              ariaHasPopup="dialog"
              onMouseDown={keepFocus}
              onClick={() => edit.onDetails(saveTitle.current?.() ?? item)}
            />
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
function TitleField({
  item,
  edit,
  saveRef,
}: {
  item: Item;
  edit: NonNullable<Parameters<typeof ItemRow>[0]["edit"]>;
  saveRef: RefObject<(() => Item) | null>;
}) {
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

  // Tapping Details keeps focus here (so the edit doesn't end first) and then unmounts this field,
  // which fires no blur: it saves through this instead, and hands over the item as saved.
  useEffect(() => {
    saveRef.current = () => {
      const trimmed = title.trim();
      end(true, () => undefined);
      return trimmed ? { ...item, title: trimmed } : item;
    };
    return () => {
      saveRef.current = null;
    };
  });

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
        // Safari ends an IME composition with an Enter that isn't flagged isComposing (keyCode 229).
        const composing = e.nativeEvent.isComposing || e.keyCode === 229;
        if (e.key === "Enter" && !composing) {
          e.preventDefault();
          // An emptied title deletes the item, so there is nothing to add below.
          end(true, title.trim() ? () => edit.onReturn(item) : edit.onDone);
        } else if (e.key === "Escape" && !composing) {
          e.stopPropagation();
          end(false, edit.onDone);
        }
      }}
    />
  );
}
