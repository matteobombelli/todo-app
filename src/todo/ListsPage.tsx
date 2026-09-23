import { ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { paletteVar } from "../components/ColorPicker";
import { useData, useLists } from "../data/hooks";
import { ListEditor } from "./ListEditor";

export default function ListsPage() {
  const lists = useLists();
  const { items } = useData().tables;
  const [creating, setCreating] = useState(false);

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
    <div className="page">
      <div className="page__header">
        <h1>Lists</h1>
        <button type="button" className="button--primary button--icon" onClick={() => setCreating(true)}>
          <Plus size={18} aria-hidden="true" />
          New list
        </button>
      </div>
      {lists.length === 0 ? (
        <p className="empty">No lists yet. Create one to start adding items.</p>
      ) : (
        <ul className="rows">
          {lists.map((list) => {
            const c = counts.get(list.id) ?? { open: 0, done: 0 };
            return (
              <li key={list.id}>
                <Link to={`/todo/${list.id}`} className="row row--link">
                  <span className="dot" style={{ background: paletteVar(list.color) }} aria-hidden="true" />
                  <span className="row__title">{list.name}</span>
                  <span className="row__meta" aria-label={`${c.open} open, ${c.done} completed`}>
                    {c.open} / {c.done}
                  </span>
                  <ChevronRight size={18} className="row__chevron" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {creating && (
        <ListEditor list={null} nextSortOrder={(lists.at(-1)?.sort_order ?? 0) + 1} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
