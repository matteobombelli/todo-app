import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { List } from "../../shared/entities";
import { NavLink } from "react-router";
import { paletteVar } from "../components/ColorPicker";
import { useSortable } from "../components/gestures";
import { useMenu } from "../components/Menu";
import { setNavDirection } from "../components/motion";
import { removeWithUndo } from "../components/UndoToast";
import { useData, useLists } from "../data/hooks";
import { store } from "../data/instance";
import { ListEditor } from "./ListEditor";

/**
 * Every list with its counts, reordered by long-press and drag. `compact` is the sidebar version:
 * open count only, no chevron. Right-click a list to edit or delete it (undoably).
 */
export function ListRows({ compact }: { compact?: boolean }) {
  const lists = useLists();
  const { items } = useData().tables;
  const rows = useRef<HTMLUListElement>(null);
  const [menu, showMenu] = useMenu();
  const [editing, setEditing] = useState<List | null>(null);

  useSortable(rows, lists.map((l) => l.id).join(), (from, to) => {
    const next = [...lists];
    next.splice(to, 0, ...next.splice(from, 1));
    const moved = next.flatMap((list, i) => (list.sort_order === i + 1 ? [] : [{ ...list, sort_order: i + 1 }]));
    void store.upsertMany("lists", moved);
  });

  const counts = useMemo(() => {
    const out = new Map<string, { open: number; done: number }>();
    for (const item of Object.values(items)) {
      const c = out.get(item.list_id) ?? { open: 0, done: 0 };
      if (item.completed_at === null) c.open++;
      else c.done++;
      out.set(item.list_id, c);
    }
    return out;
  }, [items]);

  return (
    <>
      <ul ref={rows} className={compact ? "rows" : "rows rows--large"}>
        {lists.map((list) => {
          const c = counts.get(list.id) ?? { open: 0, done: 0 };
          return (
            <li key={list.id}>
              <NavLink
                to={`/todo/${list.id}`}
                className="row row--link"
                viewTransition
                onClick={() => setNavDirection("push")}
                onContextMenu={(e) =>
                  showMenu(e, [
                    { label: "Edit List", icon: Pencil, onSelect: () => setEditing(list) },
                    "separator",
                    {
                      label: "Delete List",
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => removeWithUndo("lists", list.id, `Deleted "${list.name}"`),
                    },
                  ])
                }
              >
                <span className="dot" style={{ background: paletteVar(list.color) }} aria-hidden="true" />
                <span className="row__title">{list.name}</span>
                {compact ? (
                  c.open > 0 && (
                    <span className="row__meta" aria-label={`${c.open} open`}>
                      {c.open}
                    </span>
                  )
                ) : (
                  <>
                    <span className="row__meta" aria-label={`${c.open} open, ${c.done} completed`}>
                      {c.open} / {c.done}
                    </span>
                    <ChevronRight size={18} className="row__chevron" aria-hidden="true" />
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
      {menu}
      {editing && <ListEditor list={editing} nextSortOrder={editing.sort_order} onClose={() => setEditing(null)} />}
    </>
  );
}
