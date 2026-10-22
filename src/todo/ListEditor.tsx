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
    if (!current) {
      if (trimmed) void store.upsert("lists", { id: newId(), name: trimmed, color, sort_order: nextSortOrder });
    } else {
      // Only what changed here, over the list as it is now (a rename elsewhere stays otherwise).
      const name = trimmed && trimmed !== list!.name ? trimmed : current.name;
      const newColor = color !== list!.color ? color : current.color;
      if (name !== current.name || newColor !== current.color) void store.upsert("lists", { ...current, name, color: newColor });
    }
    close();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    done();
  }

  return (
    <Modal {...modal} onClose={done} done title={list ? "Edit List" : "New List"}>
      <form className="form" onSubmit={onSubmit}>
        <div className="group">
          <input
            className="group__input group__input--title"
            aria-label="Name"
            placeholder="List Name"
            autoFocus={!list}
            maxLength={120}
            enterKeyHint="done"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="group__row group__row--block">
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        {list && (
          <div className="group">
            <button
              type="button"
              className="group__button group__button--danger"
              onClick={() => {
                deleting.current = true;
                close();
              }}
            >
              Delete List
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
