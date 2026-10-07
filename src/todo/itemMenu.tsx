import { CalendarArrowUp, CalendarDays, CalendarX, FolderInput, ListIndentDecrease, Pencil, Sun, Sunrise, Trash2 } from "lucide-react";
import { addDays } from "../../shared/dates";
import type { Item, List } from "../../shared/entities";
import { paletteVar } from "../components/ColorPicker";
import type { MenuEntry } from "../components/Menu";
import { removeWithUndo } from "../components/UndoToast";
import { localNow } from "../data/hooks";
import { store } from "../data/instance";

/** Deletes an item, and its subtasks with it, with an Undo toast. */
export function deleteItem(item: Item): void {
  removeWithUndo("items", item.id, `Deleted "${item.title}"`);
}

/** Writes a patch over the item as it is now: menus are built from a snapshot a sync may have changed. */
function patchItem(id: string, patch: Partial<Item>): void {
  const current = store.get("items", id);
  if (current) void store.upsert("items", { ...current, ...patch });
}

/**
 * Rescheduling choices for an item: today, tomorrow, next week, any date (through `pickDate`, the
 * browser's picker; left out without it), or no date.
 */
export function dateEntries(item: Item, pickDate?: (initial: string, onPick: (date: string) => void) => void): MenuEntry[] {
  const today = localNow().date;
  const reschedule = (date: string) => () => patchItem(item.id, { due_date: date });
  return [
    ...(item.due_date !== today ? [{ label: "Today", icon: Sun, onSelect: reschedule(today) }] : []),
    ...(item.due_date !== addDays(today, 1)
      ? [{ label: "Tomorrow", icon: Sunrise, onSelect: reschedule(addDays(today, 1)) }]
      : []),
    { label: "Next Week", icon: CalendarArrowUp, onSelect: reschedule(addDays(today, 7)) },
    ...(pickDate
      ? [{ label: "Choose Date…", icon: CalendarDays, onSelect: () => pickDate(item.due_date ?? today, (date) => reschedule(date)()) }]
      : []),
    // A repeating item needs its date.
    ...(item.due_date && !item.rrule
      ? [{ label: "Remove Date", icon: CalendarX, onSelect: () => patchItem(item.id, { due_date: null, due_time: null }) }]
      : []),
  ];
}

/**
 * An item's context menu: edit its details, reschedule it, move it, take it out of its parent, or
 * delete it (with its subtasks, undoably).
 */
export function itemMenu(
  item: Item,
  {
    lists,
    onEdit,
    pickDate,
  }: {
    lists: List[];
    onEdit: (item: Item) => void;
    pickDate?: (initial: string, onPick: (date: string) => void) => void;
  },
): MenuEntry[] {
  const write = (patch: Partial<Item>) => patchItem(item.id, patch);
  const others = lists.filter((l) => l.id !== item.list_id);

  return [
    { label: "Edit Details", icon: Pencil, onSelect: () => onEdit(item) },
    "separator",
    ...dateEntries(item, pickDate),
    "separator",
    ...(others.length
      ? [
          {
            label: "Move to",
            icon: FolderInput,
            submenu: others.map((l) => ({
              label: l.name,
              icon: <span className="dot" style={{ background: paletteVar(l.color) }} aria-hidden="true" />,
              // A subtask moved on its own leaves its parent behind; its own subtasks follow it.
              onSelect: () => write({ list_id: l.id, parent_id: null }),
            })),
          },
        ]
      : []),
    ...(item.parent_id
      ? [{ label: "Remove from Parent", icon: ListIndentDecrease, onSelect: () => write({ parent_id: null }) }]
      : []),
    "separator",
    { label: "Delete", icon: Trash2, destructive: true, onSelect: () => deleteItem(item) },
  ].filter((e, i, all) => e !== "separator" || (i > 0 && all[i - 1] !== "separator")) as MenuEntry[];
}
