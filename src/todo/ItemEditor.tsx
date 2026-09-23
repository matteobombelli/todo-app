import { useState, type FormEvent } from "react";
import type { Item } from "../../shared/entities";
import { useConfirm } from "../components/ConfirmDialog";
import { Modal, useModal } from "../components/Modal";
import { useLists } from "../data/hooks";
import { store } from "../data/instance";

export function ItemEditor({ item, onClose }: { item: Item; onClose: () => void }) {
  const lists = useLists();
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const [dueDate, setDueDate] = useState(item.due_date ?? "");
  const [dueTime, setDueTime] = useState(item.due_time ?? "");
  const [listId, setListId] = useState(item.list_id);
  const [modal, close] = useModal(onClose);
  const [confirmDialog, confirm] = useConfirm();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await store.upsert("items", {
      ...item,
      title: title.trim(),
      notes,
      due_date: dueDate || null,
      due_time: dueDate && dueTime ? dueTime : null,
      list_id: listId,
    });
    close();
  }

  async function onDelete() {
    if (!(await confirm("Delete item?", `"${item.title}" will be deleted.`, "Delete"))) return;
    await store.remove("items", item.id);
    close();
  }

  return (
    <Modal {...modal} title="Edit item">
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <label className="field">
          <span className="field__label">Title</span>
          <input required maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} />
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
        <div className="form__actions">
          <button type="button" className="button--danger form__actions-start" onClick={() => void onDelete()}>
            Delete
          </button>
          <button type="button" className="button--secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button--primary">
            Save
          </button>
        </div>
      </form>
      {confirmDialog}
    </Modal>
  );
}
