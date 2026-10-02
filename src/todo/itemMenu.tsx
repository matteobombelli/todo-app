import { CalendarArrowUp, CalendarX, FolderInput, ListIndentDecrease, Pencil, Sun, Sunrise, Trash2 } from "lucide-react";
import { addDays } from "../../shared/dates";
import type { Item, List } from "../../shared/entities";
import { paletteVar } from "../components/ColorPicker";
import type { MenuEntry } from "../components/Menu";
import { localNow } from "../data/hooks";
import { store } from "../data/instance";

/**
 * An item's context menu: edit its details, reschedule it, move it, take it out of its parent, or
 * delete it. `confirm` is asked only when deleting would take subtasks with it.
 */
export function itemMenu(
  item: Item,
  {
    lists,
    items,
    onEdit,
    confirm,
  }: {
    lists: List[];
    items: Record<string, Item>;
    onEdit: (item: Item) => void;
    confirm: (title: string, message: string, action: string) => Promise<boolean>;
  },
): MenuEntry[] {
  const today = localNow().date;
  const write = (patch: Partial<Item>) => {
    // The menu was built from a snapshot; a sync may have changed the record since.
    const current = store.get("items", item.id);
    if (current) void store.upsert("items", { ...current, ...patch });
  };
  const reschedule = (date: string) => () => write({ due_date: date });
  const subtasks = Object.values(items).filter((i) => i.parent_id === item.id).length;
  const others = lists.filter((l) => l.id !== item.list_id);

  const dates: MenuEntry[] = [
    ...(item.due_date !== today ? [{ label: "Today", icon: Sun, onSelect: reschedule(today) }] : []),
    ...(item.due_date !== addDays(today, 1)
      ? [{ label: "Tomorrow", icon: Sunrise, onSelect: reschedule(addDays(today, 1)) }]
      : []),
    { label: "Next Week", icon: CalendarArrowUp, onSelect: reschedule(addDays(today, 7)) },
    // A repeating item needs its date.
    ...(item.due_date && !item.rrule
      ? [{ label: "Remove Date", icon: CalendarX, onSelect: () => write({ due_date: null, due_time: null }) }]
      : []),
  ];

  return [
    { label: "Edit Details", icon: Pencil, onSelect: () => onEdit(item) },
    "separator",
    ...dates,
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
    {
      label: "Delete",
      icon: Trash2,
      destructive: true,
      onSelect: () =>
        void (async () => {
          const detail = subtasks === 1 ? "its subtask" : `its ${subtasks} subtasks`;
          if (subtasks && !(await confirm("Delete item?", `"${item.title}" and ${detail} will be deleted.`, "Delete"))) return;
          await store.remove("items", item.id);
        })(),
    },
  ].filter((e, i, all) => e !== "separator" || (i > 0 && all[i - 1] !== "separator")) as MenuEntry[];
}
