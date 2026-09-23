import { Plus } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router";
import { useMediaQuery, WIDE } from "../components/motion";
import { useLists } from "../data/hooks";
import { ListEditor } from "./ListEditor";
import { ListRows } from "./ListRows";

export default function ListsPage() {
  const lists = useLists();
  const wide = useMediaQuery(WIDE);
  const [creating, setCreating] = useState(false);

  // Wide screens list the lists in the sidebar, so this page would only repeat it. The redirect
  // waits for an open editor, which would otherwise unmount before its exit animation.
  if (wide && lists.length > 0 && !creating) return <Navigate to={`/todo/${lists[0].id}`} replace />;

  return (
    <div className="page">
      <div className="page__header">
        <h1>Lists</h1>
        <button type="button" className="button--primary button--icon" onClick={() => setCreating(true)}>
          <Plus size={18} aria-hidden="true" />
          New list
        </button>
      </div>
      {lists.length === 0 ? <p className="empty">No lists yet. Create one to start adding items.</p> : <ListRows />}
      {creating && (
        <ListEditor list={null} nextSortOrder={(lists.at(-1)?.sort_order ?? 0) + 1} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
