import { useRef, useState, type FormEvent } from "react";
import type { List } from "../../shared/entities";
import { newId } from "../../shared/ids";
import type { PaletteKey } from "../../shared/palette";
import { ColorPicker } from "../components/ColorPicker";
import { Modal, useModal } from "../components/Modal";
import { removeWithUndo } from "../components/UndoToast";
import { store } from "../data/instance";

/**
 * Creates a list when `list` is null, otherwise renames, recolours or deletes it. Saves as it
 * closes; a blank name keeps the old one, or for a new list adds nothing.
 */
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
    if (deleting.current && list) removeWithUndo("lists", list.id, `Deleted "${list.name}"`);
    onClose();
  });

  function done() {
    const trimmed = name.trim();
    const current = list && store.get("lists", list.id);
    if (list && !current) return close();
    if ((trimmed || current) && (!current || trimmed !== current.name || color !== current.color)) {
      void store.upsert("lists", {
        id: current?.id ?? newId(),
        name: trimmed || current!.name,
        color,
        sort_order: current?.sort_order ?? nextSortOrder,
      });
    }
    close();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    done();
  }

  return (
    <Modal {...modal} onClose={done} done title={list ? "Edit list" : "New list"}>
      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">Name</span>
          <input autoFocus={!list} maxLength={120} enterKeyHint="done" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span className="field__label">Colour</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        {list && (
          <div className="form__actions">
            <button
              type="button"
              className="button--danger form__actions-start"
              onClick={() => {
                deleting.current = true;
                close();
              }}
            >
              Delete
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
