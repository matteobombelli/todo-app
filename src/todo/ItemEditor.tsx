import { useMemo, useState, type FormEvent } from "react";
import type { Item } from "../../shared/entities";
import { newId } from "../../shared/ids";
import { Modal, useModal } from "../components/Modal";
import { RepeatFields, repeatFromRRule, repeatToRRule, type RepeatForm } from "../components/RepeatFields";
import { localNow, useData, useLists } from "../data/hooks";
import { store } from "../data/instance";
import { deleteItem } from "./itemMenu";

/**
 * An item's details. Saves as it closes (Done, a tap outside, Escape or a swipe down), so there is
 * no Save or Cancel; a blank title keeps the old one. With `item` null it creates one from `initial`
 * (the calendar's new to-do), and closing with no title adds nothing.
 */
export function ItemEditor({
  item,
  initial,
  onClose,
}: {
  item: Item | null;
  initial?: { list_id: string; due_date: string | null; due_time: string | null };
  onClose: () => void;
}) {
  const lists = useLists();
  const { items } = useData().tables;
  const [id] = useState(() => item?.id ?? newId());
  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [dueDate, setDueDate] = useState(item?.due_date ?? initial?.due_date ?? "");
  const [dueTime, setDueTime] = useState(item?.due_time ?? initial?.due_time ?? "");
  const [repeat, setRepeat] = useState(() => repeatFromRRule(item?.rrule ?? null, item?.due_date ?? initial?.due_date ?? localNow().date));
  const [listId, setListId] = useState(item?.list_id ?? initial?.list_id ?? lists[0]?.id ?? "");
  const [modal, close] = useModal(onClose);

  const subtaskCount = useMemo(() => Object.values(items).filter((i) => i.parent_id === id).length, [items, id]);
  const parentId = item?.parent_id ?? null;

  // Repeating items are never subtasks or parents (see completeItem).
  const canRepeat = parentId === null && subtaskCount === 0 && dueDate !== "";

  function save() {
    // The record as it is now: a sync, or a swipe in the list behind, may have changed it.
    const current = store.get("items", id);
    if (item && !current) return; // Deleted meanwhile.
    const trimmed = title.trim();
    if (!trimmed && !current) return;
    const next = {
      id,
      completed_at: null,
      position: null,
      ...current,
      title: trimmed || current!.title,
      notes,
      due_date: dueDate || null,
      due_time: dueDate && dueTime ? dueTime : null,
      rrule: canRepeat ? repeatToRRule(repeat) : null,
      list_id: listId,
      // A subtask moved to another list on its own leaves its parent behind.
      parent_id: current && listId === current.list_id ? current.parent_id : null,
    };
    const changed =
      !current ||
      (["title", "notes", "due_date", "due_time", "rrule", "list_id", "parent_id"] as const).some((k) => next[k] !== current[k]);
    if (changed && listId) void store.upsert("items", next);
  }

  function done() {
    save();
    close();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    done();
  }

  function onDelete() {
    const current = store.get("items", id);
    if (current) deleteItem(current);
    close();
  }

  return (
    <Modal {...modal} onClose={done} done title={item ? "Details" : "New to-do"}>
      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">Title</span>
          <input autoFocus={!item} maxLength={500} enterKeyHint="done" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Notes</span>
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Time (optional)</span>
            <input type="time" value={dueTime} disabled={!dueDate} onChange={(e) => setDueTime(e.target.value)} />
          </label>
        </div>
        {canRepeat && (
          <RepeatFields repeat={repeat} startDate={dueDate} onChange={(patch: Partial<RepeatForm>) => setRepeat((r) => ({ ...r, ...patch }))} />
        )}
        <label className="field">
          <span className="field__label">List</span>
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {item && (
          <div className="form__actions">
            <button type="button" className="button--danger form__actions-start" onClick={onDelete}>
              Delete
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
