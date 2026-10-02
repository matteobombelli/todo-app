import { ChevronLeft, ChevronRight, Ellipsis, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { Fragment, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import type { Item } from "../../shared/entities";
import { newId } from "../../shared/ids";
import { orderItems } from "../../shared/items";
import { paletteVar } from "../components/ColorPicker";
import { useConfirm } from "../components/ConfirmDialog";
import { useDropOnto, useShortcuts, useSwipe } from "../components/gestures";
import { IconButton } from "../components/IconButton";
import { useMenu } from "../components/Menu";
import { useData, useLists, useNow } from "../data/hooks";
import { store } from "../data/instance";
import { formatRelativeDate } from "../format";
import { ItemDraft } from "./ItemDraft";
import { ItemEditor } from "./ItemEditor";
import { itemMenu } from "./itemMenu";
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
  // Where a new item is being typed: under the item with this id, or at the end (null).
  const [draft, setDraft] = useState<{ after: string | null } | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingList, setEditingList] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const page = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [menu, showMenu] = useMenu();
  const [confirmDialog, confirm] = useConfirm();

  const openRows = useRef<HTMLUListElement>(null);
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

  // A new item goes in as a sibling of the one tapped: a subtask under a subtask, and due the same
  // day, so it sorts beside it. Its place in the list still comes from the usual order.
  const anchorIndex = draft?.after ? open.findIndex((o) => o.item.id === draft.after) : -1;
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
    void store.upsert("items", {
      id: newId(),
      list_id: list.id,
      title,
      notes: "",
      due_date: inherited.due_date,
      due_time: null,
      completed_at: null,
      parent_id: inherited.parent_id,
      rrule: null,
    });
  }

  const draftRow = draft && (
    <li key={`draft:${draft.after}`} className="rows__draft">
      <ItemDraft
        nested={!!inherited.parent_id}
        chip={inherited.due_date && formatRelativeDate(inherited.due_date, now.date)}
        onAdd={onAdd}
        onClose={() => setDraft((d) => (d === draft ? null : d))}
      />
    </li>
  );

  const onItemMenu = (e: MouseEvent, item: Item) =>
    showMenu(e, itemMenu(item, { lists: allLists, items, onEdit: setEditing, confirm }));

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
        onSelect: () =>
          void (async () => {
            if (await confirm("Delete list?", `"${list.name}" and all its items will be deleted.`, "Delete")) {
              await store.remove("lists", list.id);
            }
          })(),
      },
    ]);

  return (
    <div
      className="page page--swipe"
      ref={page}
      style={{ "--list": paletteVar(list.color) } as CSSProperties}
      // Blank space below everything is a blank line too.
      onClick={(e) => e.target === e.currentTarget && !draft && setDraft({ after: null })}
    >
      <div className="nav-bar">
        <IconButton icon={ChevronLeft} label="All lists" to="/todo" nav="pop" className="page__back" />
        <IconButton icon={Ellipsis} label="List actions" ariaHasPopup="menu" className="nav-bar__end" onClick={onListMenu} />
      </div>
      <h1 className="large-title" onContextMenu={onListMenu}>
        {list.name}
      </h1>

      <ul className="rows rows--large" ref={openRows}>
        {open.map(({ item, nested }, i) => {
          const hidden = nested && collapsed.has(item.parent_id!);
          const count = openSubtasks.get(item.id);
          return (
            <Fragment key={item.id}>
              <li data-id={item.id} className={hidden ? "rows__hidden" : undefined}>
                <ItemRow
                  item={item}
                  now={now}
                  nested={nested}
                  hidden={hidden}
                  fold={count ? { count, collapsed: collapsed.has(item.id), onToggle: () => setFolded(item.id, !collapsed.has(item.id)) } : undefined}
                  collapseOnDone
                  onTap={(tapped) => setDraft({ after: tapped.id })}
                  onMenu={onItemMenu}
                />
              </li>
              {i === draftIndex && draftRow}
            </Fragment>
          );
        })}
        {draftIndex < 0 && draftRow}
      </ul>
      {/* The space under the rows: tapping it starts an item at the end, like a blank line. */}
      {!draft && (
        <button type="button" className={`rows__tail${open.length ? "" : " rows__tail--empty"}`} onClick={() => setDraft({ after: null })}>
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
      {confirmDialog}
    </div>
  );
}
