import { useMemo, useState, type FormEvent } from "react";
import type { Item } from "../../shared/entities";
import { newId } from "../../shared/ids";
import { TextArea } from "../components/Fields";
import { Modal, useModal } from "../components/Modal";
import { PickerRow, PickerScope } from "../components/Pickers";
import { followStart, RepeatFields, repeatFromRRule, repeatProblem, repeatToRRule, type RepeatForm } from "../components/RepeatFields";
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
  const [error, setError] = useState<string | null>(null);
  // The form as it opened, so saving writes only what the user changed (see save).
  const [opened] = useState(() => ({ title, notes, dueDate, dueTime, rrule: item?.rrule ? repeatToRRule(repeat) : null, listId }));

  const subtaskCount = useMemo(() => Object.values(items).filter((i) => i.parent_id === id).length, [items, id]);
  const parentId = item?.parent_id ?? null;

  // Repeating items are never subtasks or parents (see completeItem).
  const canRepeat = parentId === null && subtaskCount === 0 && dueDate !== "";

  function save() {
    // The record as it is now: a sync, or a swipe in the list behind, may have changed it.
    const current = store.get("items", id);
    if (item && !current) return; // Deleted meanwhile.
    const trimmed = title.trim();
    const rrule = canRepeat ? repeatToRRule(repeat) : null;
    if (!current) {
      if (trimmed && listId) {
        void store.upsert("items", {
          id,
          completed_at: null,
          position: null,
          parent_id: null,
          title: trimmed,
          notes,
          due_date: dueDate || null,
          due_time: dueDate && dueTime ? dueTime : null,
          rrule,
          list_id: listId,
        });
      }
      return;
    }
    // Only what the user changed goes onto the record as it is now: writing the whole form would
    // put back values changed elsewhere meanwhile (Claude rescheduling it, say).
    const patch: Partial<Item> = {};
    if (trimmed && trimmed !== opened.title) patch.title = trimmed;
    if (notes !== opened.notes) patch.notes = notes;
    if (dueDate !== opened.dueDate || dueTime !== opened.dueTime) {
      patch.due_date = dueDate || null;
      patch.due_time = dueDate && dueTime ? dueTime : null;
    }
    if (rrule !== opened.rrule) patch.rrule = rrule;
    if (listId && listId !== opened.listId) {
      patch.list_id = listId;
      // A subtask moved to another list on its own leaves its parent behind.
      if (listId !== current.list_id) patch.parent_id = null;
    }
    if (Object.keys(patch).length) void store.upsert("items", { ...current, ...patch });
  }

  function done() {
    const problem = canRepeat ? repeatProblem(repeat, dueDate) : null;
    setError(problem);
    if (problem) return;
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
    <Modal {...modal} onClose={done} done title={item ? "Details" : "New To-do"}>
      <form className="form" onSubmit={onSubmit}>
        <div className="group">
          <input
            className="group__input group__input--title"
            aria-label="Title"
            placeholder="Title"
            autoFocus={!item}
            maxLength={500}
            enterKeyHint="done"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextArea className="group__input" aria-label="Notes" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <PickerScope>
          <div className="group">
            <PickerRow
              label="Date"
              picks={[
                {
                  kind: "date",
                  name: "Due date",
                  value: dueDate,
                  placeholder: "Add date",
                  onChange: (date) => {
                    setRepeat((r) => followStart(r, dueDate, date));
                    setDueDate(date);
                  },
                },
              ]}
              clearLabel="Clear date"
              onClear={() => {
                setDueDate("");
                setDueTime("");
              }}
            />
            {dueDate && (
              <PickerRow
                label="Time"
                picks={[{ kind: "time", name: "Time", value: dueTime, placeholder: "Add time", onChange: setDueTime }]}
                clearLabel="Clear time"
                onClear={() => setDueTime("")}
              />
            )}
            {canRepeat && (
              <RepeatFields repeat={repeat} startDate={dueDate} onChange={(patch: Partial<RepeatForm>) => setRepeat((r) => ({ ...r, ...patch }))} />
            )}
          </div>
        </PickerScope>
        {error && (
          <div className="form__error" role="alert">
            <p>{error}</p>
            {/* Closing keeps trying to save; this is the way out without fixing the form. */}
            <button type="button" className="button--plain" onClick={close}>
              Discard changes
            </button>
          </div>
        )}
        <div className="group">
          <label className="group__row">
            <span className="group__name">List</span>
            <select value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {item && (
          <div className="group">
            <button type="button" className="group__button group__button--danger" onClick={onDelete}>
              Delete To-do
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
