import { ArrowLeft, ChevronRight, Pencil } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import type { Item } from "../../shared/entities";
import { newId } from "../../shared/ids";
import { orderItems } from "../../shared/items";
import { paletteVar } from "../components/ColorPicker";
import { useDropOnto, useShortcuts, useSwipe } from "../components/gestures";
import { IconButton } from "../components/IconButton";
import { useData, useNow } from "../data/hooks";
import { store } from "../data/instance";
import { ItemEditor } from "./ItemEditor";
import { ItemRow } from "./ItemRow";
import { ListEditor } from "./ListEditor";

// Parents whose subtasks are folded away: a view preference kept on this device only.
const COLLAPSED_KEY = "todo:collapsed";

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeCollapsed(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Private mode or blocked storage: the fold still works until the page reloads.
  }
}

export default function ListPage() {
  const { listId } = useParams();
  const { lists, items } = useData().tables;
  const now = useNow();
  const list = listId ? lists[listId] : undefined;
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingList, setEditingList] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const page = useRef<HTMLDivElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const openRows = useRef<HTMLUListElement>(null);
  useSwipe(page, () => navigate("/todo"), 24);
  useShortcuts({ n: () => addInput.current?.focus() });

  const { open, completed } = useMemo(
    () => orderItems(Object.values(items).filter((i) => i.list_id === listId)),
    [items, listId],
  );

  // Dropping an item onto another makes it a subtask; onto a subtask, a sibling of it (one level
  // deep). Dropping a subtask onto no item makes it top-level again. An item with subtasks stays put.
  const parentFor = (target: string) => items[target].parent_id ?? target;
  const hasSubtasks = (id: string) => Object.values(items).some((i) => i.parent_id === id);
  useDropOnto(
    openRows,
    open.map(({ item, nested }) => `${item.id}${nested ? ">" : ""}`).join(),
    (dragged, target) => {
      const parent = parentFor(target);
      return parent !== dragged && parent !== items[dragged].parent_id && !hasSubtasks(dragged);
    },
    (dragged, target) => {
      const item = items[dragged];
      const parent_id = target ? parentFor(target) : null;
      if (parent_id === item.parent_id) return;
      // Show where it went rather than folding it straight out of sight.
      if (parent_id) setFolded(parent_id, false);
      void store.upsert("items", { ...item, parent_id });
    },
  );

  const setFolded = (id: string, folded: boolean) =>
    setCollapsed((prev) => {
      if (prev.has(id) === folded) return prev;
      const next = new Set(prev);
      if (folded) next.add(id);
      else next.delete(id);
      writeCollapsed(next);
      return next;
    });
  const openSubtasks = new Map<string, number>();
  for (const { item, nested } of open) if (nested) openSubtasks.set(item.parent_id!, (openSubtasks.get(item.parent_id!) ?? 0) + 1);

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
      parent_id: null,
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
      <ul className="rows rows--large" ref={openRows}>
        {open.map(({ item, nested }) => {
          const hidden = nested && collapsed.has(item.parent_id!);
          const count = openSubtasks.get(item.id);
          return (
            <li key={item.id} data-id={item.id} className={hidden ? "rows__hidden" : undefined}>
              <ItemRow
                item={item}
                now={now}
                nested={nested}
                hidden={hidden}
                fold={count ? { count, collapsed: collapsed.has(item.id), onToggle: () => setFolded(item.id, !collapsed.has(item.id)) } : undefined}
                collapseOnDone
                onOpen={setEditing}
              />
            </li>
          );
        })}
      </ul>

      {completed.length > 0 && (
        <section className="completed">
          <button type="button" className="section-toggle" aria-expanded={showCompleted} onClick={() => setShowCompleted((v) => !v)}>
            <ChevronRight size={16} className="section-toggle__chevron" aria-hidden="true" />
            Completed ({completed.length})
          </button>
          <div className={`collapse${showCompleted ? "" : " collapse--closed"}`} inert={!showCompleted}>
            <ul className="rows rows--large collapse__inner">
              {completed.map((item) => (
                <li key={item.id}>
                  <ItemRow item={item} now={now} context={item.parent_id ? items[item.parent_id]?.title : undefined} onOpen={setEditing} />
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
