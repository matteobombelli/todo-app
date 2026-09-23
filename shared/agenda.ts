import type { Item } from "./entities";
import { compareItems, type Now } from "./items";
import type { Occurrence } from "./recurrence";

export type StdStatus = "proposed" | "upcoming" | "saved";

/** A read-only save-the-date entry. */
export interface ExternalEvent {
  id: string;
  source: "save-the-date";
  title: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  status: StdStatus;
  location: string | null;
}

export type TimedEntry =
  | { kind: "event"; time: string; occurrence: Occurrence }
  | { kind: "external"; time: string; event: ExternalEvent }
  | { kind: "item"; time: string; item: Item };

export type BarEntry = { kind: "event"; occurrence: Occurrence } | { kind: "external"; event: ExternalEvent };

export interface DayAgenda {
  date: string;
  /**
   * Uncompleted items due before this date; only filled when the date is today. Today's items whose
   * time has passed stay in `timed`, where isOverdue() marks them.
   */
  overdue: Item[];
  /** All-day and multi-day entries. */
  bars: BarEntry[];
  /** Single-day timed events and timed due items, by start time. */
  timed: TimedEntry[];
  /** Items due this date without a time, completed ones included. */
  untimed: Item[];
}

/**
 * One day's agenda. occurrences and external may cover more than the day; entries that do not
 * touch it are ignored.
 */
export function buildAgenda(
  date: string,
  occurrences: Occurrence[],
  external: ExternalEvent[],
  items: Item[],
  now: Now,
): DayAgenda {
  const live = items.filter((i) => i.deleted_at === null);
  const bars: BarEntry[] = [];
  const timed: TimedEntry[] = [];

  for (const occurrence of occurrences) {
    if (occurrence.start_date > date || occurrence.end_date < date) continue;
    if (occurrence.all_day || occurrence.start_date !== occurrence.end_date) bars.push({ kind: "event", occurrence });
    else timed.push({ kind: "event", time: occurrence.start_time ?? "00:00", occurrence });
  }
  for (const event of external) {
    if (event.start_date > date || event.end_date < date) continue;
    if (event.start_time === null || event.start_date !== event.end_date) bars.push({ kind: "external", event });
    else timed.push({ kind: "external", time: event.start_time, event });
  }
  const due = live.filter((i) => i.due_date === date).sort(compareItems);
  for (const item of due) if (item.due_time !== null) timed.push({ kind: "item", time: item.due_time, item });
  // Stable sort keeps events ahead of items at the same time.
  timed.sort((a, b) => a.time.localeCompare(b.time));

  return {
    date,
    overdue:
      date === now.date
        ? live.filter((i) => i.completed_at === null && i.due_date !== null && i.due_date < date).sort(compareItems)
        : [],
    bars,
    timed,
    untimed: due.filter((i) => i.due_time === null),
  };
}
