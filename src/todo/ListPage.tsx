import { ChevronLeft, ChevronRight, Ellipsis, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import type { Item } from "../../shared/entities";
import { newId } from "../../shared/ids";
import { orderItems, positionAfter } from "../../shared/items";
import { paletteVar } from "../components/ColorPicker";
import { useDatePicker } from "../components/DatePicker";
import { useDropOnto, useShortcuts, useSwipe } from "../components/gestures";
import { IconButton } from "../components/IconButton";
import { useMenu } from "../components/Menu";
import { removeWithUndo } from "../components/UndoToast";
import { useData, useLists, useNow } from "../data/hooks";
import { store } from "../data/instance";
import { formatRelativeDate } from "../format";
import { ItemDraft } from "./ItemDraft";
import { ItemEditor } from "./ItemEditor";
import { dateEntries, itemMenu } from "./itemMenu";
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
  const allLists = useLists();
  // Where a new item is being typed: under the item with this id, or at the end (null). Right after
  // an item is added the draft moves under it, but stays under `before` until that item shows up.
  const [draft, setDraft] = useState<{ after: string | null; before?: string | null } | null>(null);
  // The item whose title is being edited in place, and the one whose details are open.
  const [inline, setInline] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingList, setEditingList] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const page = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [menu, showMenu] = useMenu();
  const [datePicker, pickDate] = useDatePicker();

  const openRows = useRef<HTMLUListElement>(null);
  // A tap on blank space that ends an edit (by taking focus from its field) only ends it.
  const fieldClosedAt = useRef(0);
  useSwipe(page, () => navigate("/todo"), 24);
  useShortcuts({ n: () => setDraft({ after: null }) });

  const { open, completed } = useMemo(
    () => orderItems(Object.values(items).filter((i) => i.list_id === listId)),
    [items, listId],
  );

  // Dropping an item onto another makes it a subtask; onto a subtask, a sibling of it (one level
  // deep). Dropping a subtask onto no item makes it top-level again. An item with subtasks stays put,
  // and repeating items are never subtasks or parents.
  const parentFor = (target: string) => items[target].parent_id ?? target;
  const hasSubtasks = (id: string) => Object.values(items).some((i) => i.parent_id === id);
  useDropOnto(
    openRows,
    open.map(({ item, nested }) => `${item.id}${nested ? ">" : ""}`).join(),
    (dragged, target) => {
      const parent = parentFor(target);
      return (
        parent !== dragged &&
        parent !== items[dragged].parent_id &&
        !hasSubtasks(dragged) &&
        !items[dragged].rrule &&
        !items[parent].rrule
      );
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

  // A new item goes in as a sibling of the one it follows: a subtask under a subtask, and due the
  // same day, so it sorts beside it; its position puts it straight below.
  const indexOf = (id: string | null | undefined) => (id ? open.findIndex((o) => o.item.id === id) : -1);
  let anchorIndex = indexOf(draft?.after);
  if (anchorIndex < 0) anchorIndex = indexOf(draft?.before);
  const anchor = anchorIndex >= 0 ? open[anchorIndex] : null;
  // Under a parent, the draft goes after its subtasks.
  let draftIndex = anchorIndex;
  if (anchor && !anchor.nested) while (open[draftIndex + 1]?.nested) draftIndex++;
  const inherited = {
    parent_id: anchor?.nested ? anchor.item.parent_id : null,
    due_date: anchor && !anchor.item.parent_id ? anchor.item.due_date : null,
  };

  function onAdd(title: string) {
    if (!list) return;
    const id = newId();
    const position = anchor
      ? positionAfter(anchor.item, { due_date: inherited.due_date, due_time: null }, open.map((o) => o.item))
      : null;
    void store.upsert("items", {
      id,
      list_id: list.id,
      title,
      notes: "",
      due_date: inherited.due_date,
      due_time: null,
      completed_at: null,
      parent_id: inherited.parent_id,
      rrule: null,
      position,
    });
    // The next one goes under this one.
    if (draft) setDraft({ after: id, before: anchor?.item.id ?? null });
  }

  const draftRow = draft && (
    <li key="draft" className="rows__draft">
      <ItemDraft
        nested={!!inherited.parent_id}
        chip={inherited.due_date && formatRelativeDate(inherited.due_date, now.date)}
        onAdd={onAdd}
        onClose={() => {
          closeField();
          setDraft((d) => (d === draft ? null : d));
        }}
      />
    </li>
  );

  const startDraft = (after: string | null) => {
    setInline(null);
    setDraft({ after });
  };
  const closeField = () => (fieldClosedAt.current = Date.now());
  const tapBlank = () => Date.now() - fieldClosedAt.current > 500 && startDraft(null);
  const onItemMenu = (e: MouseEvent, item: Item) => showMenu(e, itemMenu(item, { lists: allLists, onEdit: setEditing, pickDate }));
  const onDateMenu = (e: MouseEvent, item: Item) => showMenu(e, dateEntries(item, pickDate));

  const onListMenu = (e: MouseEvent) =>
    showMenu(e, [
      { label: "Edit List", icon: Pencil, onSelect: () => setEditingList(true) },
      ...(completed.length
        ? [
            {
              label: showCompleted ? "Hide Completed" : "Show Completed",
              icon: showCompleted ? EyeOff : Eye,
              onSelect: () => setShowCompleted((v) => !v),
            },
          ]
        : []),
      "separator",
      {
        label: "Delete List",
        icon: Trash2,
        destructive: true,
        onSelect: () => removeWithUndo("lists", list.id, `Deleted "${list.name}"`),
      },
    ]);

  return (
    <div
      className="page page--swipe"
      ref={page}
      style={{ "--list": paletteVar(list.color) } as CSSProperties}
      // Blank space below everything is a blank line too.
      onClick={(e) => e.target === e.currentTarget && !draft && !inline && tapBlank()}
    >
      <div className="nav-bar">
        <IconButton icon={ChevronLeft} label="All lists" to="/todo" nav="pop" className="page__back" />
        <IconButton icon={Ellipsis} label="List actions" ariaHasPopup="menu" className="nav-bar__end" onClick={onListMenu} />
      </div>
      <h1 className="large-title" onContextMenu={onListMenu}>
        {list.name}
      </h1>

      <ul className="rows rows--large" ref={openRows}>
        {open.flatMap(({ item, nested }, i) => {
          const hidden = nested && collapsed.has(item.parent_id!);
          const count = openSubtasks.get(item.id);
          const row = (
            <li key={item.id} data-id={item.id} className={hidden ? "rows__hidden" : undefined}>
              <ItemRow
                item={item}
                now={now}
                nested={nested}
                hidden={hidden}
                fold={count ? { count, collapsed: collapsed.has(item.id), onToggle: () => setFolded(item.id, !collapsed.has(item.id)) } : undefined}
                collapseOnDone
                swipe
                onTap={(tapped) => {
                  setDraft(null);
                  setInline(tapped.id);
                }}
                onMenu={onItemMenu}
                onDateMenu={onDateMenu}
                edit={
                  inline === item.id
                    ? {
                        onReturn: (edited) => startDraft(edited.id),
                        onDone: () => {
                          closeField();
                          setInline((id) => (id === item.id ? null : id));
                        },
                        onDetails: (edited) => {
                          setInline(null);
                          setEditing(store.get("items", edited.id) ?? edited);
                        },
                      }
                    : undefined
                }
              />
            </li>
          );
          // Flat and keyed, so the draft keeps its field (and the keyboard) as items land above it.
          return i === draftIndex && draftRow ? [row, draftRow] : [row];
        })}
        {draftIndex < 0 && draftRow}
      </ul>
      {/* The space under the rows: tapping it starts an item at the end, like a blank line. */}
      {!draft && (
        <button type="button" className={`rows__tail${open.length ? "" : " rows__tail--empty"}`} onClick={tapBlank}>
          {open.length === 0 && (
            <>
              <span className="check" aria-hidden="true">
                <span className="check__box" />
              </span>
              <span>New item</span>
            </>
          )}
          {open.length > 0 && <span className="sr-only">New item</span>}
        </button>
      )}

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
                  <ItemRow
                    item={item}
                    now={now}
                    context={item.parent_id ? items[item.parent_id]?.title : undefined}
                    swipe
                    onTap={setEditing}
                    onMenu={onItemMenu}
                  />
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
      {menu}
      {datePicker}
    </div>
  );
}
