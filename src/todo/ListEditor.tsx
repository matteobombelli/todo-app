import { useRef, useState, type FormEvent } from "react";
import type { List } from "../../shared/entities";
import { newId } from "../../shared/ids";
import type { PaletteKey } from "../../shared/palette";
import { ColorPicker } from "../components/ColorPicker";
import { useConfirm } from "../components/ConfirmDialog";
import { Modal, useModal } from "../components/Modal";
import { store } from "../data/instance";

/** Creates a list when `list` is null, otherwise renames, recolours or deletes it. */
export function ListEditor({
  list,
  nextSortOrder,
  onClose,
}: {
  list: List | null;
  nextSortOrder: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(list?.name ?? "");
  const [color, setColor] = useState<PaletteKey>(list?.color ?? "blue");
  // Deleting waits for the exit animation: the list page unmounts (and this editor with it) as soon
  // as its list is gone.
  const deleting = useRef(false);
  const [modal, close] = useModal(() => {
    if (deleting.current && list) void store.remove("lists", list.id);
    onClose();
  });
  const [confirmDialog, confirm] = useConfirm();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await store.upsert("lists", {
      id: list?.id ?? newId(),
      name: name.trim(),
      color,
      sort_order: list?.sort_order ?? nextSortOrder,
    });
    close();
  }

  async function onDelete() {
    if (!list || !(await confirm("Delete list?", `"${list.name}" and all its items will be deleted.`, "Delete"))) return;
    deleting.current = true;
    close();
  }

  return (
    <Modal {...modal} title={list ? "Edit list" : "New list"}>
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <label className="field">
          <span className="field__label">Name</span>
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span className="field__label">Colour</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="form__actions">
          {list && (
            <button type="button" className="button--danger form__actions-start" onClick={() => void onDelete()}>
              Delete
            </button>
          )}
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
