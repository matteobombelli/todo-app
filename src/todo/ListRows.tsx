import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { NavLink } from "react-router";
import { paletteVar } from "../components/ColorPicker";
import { setNavDirection } from "../components/motion";
import { useData, useLists } from "../data/hooks";

/** Every list with its counts. `compact` is the sidebar version: open count only, no chevron. */
export function ListRows({ compact }: { compact?: boolean }) {
  const lists = useLists();
  const { items } = useData().tables;

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
    <ul className="rows">
      {lists.map((list) => {
        const c = counts.get(list.id) ?? { open: 0, done: 0 };
        return (
          <li key={list.id}>
            <NavLink to={`/todo/${list.id}`} className="row row--link" viewTransition onClick={() => setNavDirection("push")}>
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
  );
}
