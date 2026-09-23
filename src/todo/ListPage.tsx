import { ArrowLeft, ChevronRight, Pencil } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import type { Item } from "../../shared/entities";
import { newId } from "../../shared/ids";
import { orderItems } from "../../shared/items";
import { paletteVar } from "../components/ColorPicker";
import { useShortcuts, useSwipe } from "../components/gestures";
import { IconButton } from "../components/IconButton";
import { useData, useNow } from "../data/hooks";
import { store } from "../data/instance";
import { ItemEditor } from "./ItemEditor";
import { ItemRow } from "./ItemRow";
import { ListEditor } from "./ListEditor";

export default function ListPage() {
  const { listId } = useParams();
  const { lists, items } = useData().tables;
  const now = useNow();
  const list = listId ? lists[listId] : undefined;
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingList, setEditingList] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useSwipe(page, () => navigate("/todo"), 24);
  useShortcuts({ n: () => addInput.current?.focus() });

  const { open, completed } = useMemo(
    () => orderItems(Object.values(items).filter((i) => i.list_id === listId)),
    [items, listId],
  );

  if (!list) return <Navigate to="/todo" replace />;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title || !list) return;
    setDraft("");
    await store.upsert("items", {
      id: newId(),
      list_id: list.id,
      title,
      notes: "",
      due_date: null,
      due_time: null,
      completed_at: null,
    });
  }

  return (
    <div className="page page--swipe" ref={page}>
      <div className="page__header">
        <IconButton icon={ArrowLeft} label="All lists" to="/todo" nav="pop" className="page__back" />
        <span className="dot dot--lg" style={{ background: paletteVar(list.color) }} aria-hidden="true" />
        <h1 className="page__title">{list.name}</h1>
        <IconButton icon={Pencil} label="Edit list" onClick={() => setEditingList(true)} />
      </div>

      <form className="add-row" onSubmit={(e) => void onAdd(e)}>
        <input ref={addInput} placeholder="Add an item" aria-label="New item" maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </form>

      {open.length === 0 && completed.length === 0 && <p className="empty">Nothing here yet.</p>}
      <ul className="rows">
        {open.map((item) => (
          <li key={item.id}>
            <ItemRow item={item} now={now} collapseOnDone onOpen={setEditing} />
          </li>
        ))}
      </ul>

      {completed.length > 0 && (
        <section className="completed">
          <button type="button" className="section-toggle" aria-expanded={showCompleted} onClick={() => setShowCompleted((v) => !v)}>
            <ChevronRight size={16} className="section-toggle__chevron" aria-hidden="true" />
            Completed ({completed.length})
          </button>
          <div className={`collapse${showCompleted ? "" : " collapse--closed"}`} inert={!showCompleted}>
            <ul className="rows collapse__inner">
              {completed.map((item) => (
                <li key={item.id}>
                  <ItemRow item={item} now={now} onOpen={setEditing} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {editing && <ItemEditor item={editing} onClose={() => setEditing(null)} />}
      {editingList && (
        <ListEditor
          list={list}
          nextSortOrder={list.sort_order}
          onClose={() => setEditingList(false)}
        />
      )}
    </div>
  );
}
