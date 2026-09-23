import { Plus } from "lucide-react";
import { useMemo } from "react";
import type { ExternalEvent } from "../../shared/agenda";
import { addDays } from "../../shared/dates";
import type { Item, List } from "../../shared/entities";
import { STD_COLOR } from "../../shared/palette";
import type { Occurrence } from "../../shared/recurrence";
import { paletteVar } from "../components/ColorPicker";
import { formatShortWeekday } from "../format";
import { monthWeeks, placeBars } from "./layout";

const MAX_LANES = 3;
const MAX_DOTS = 3;

interface Bar {
  key: string;
  start_date: string;
  end_date: string;
  label: string;
  color: string;
  hatched: boolean;
}

export function MonthView({
  selected,
  today,
  occurrences,
  external,
  items,
  lists,
  onSelect,
}: {
  selected: string;
  today: string;
  occurrences: Occurrence[];
  external: ExternalEvent[];
  items: Item[];
  lists: Readonly<Record<string, List>>;
  onSelect: (date: string) => void;
}) {
  const weeks = monthWeeks(selected);
  const month = selected.slice(0, 7);

  const bars = useMemo<Bar[]>(
    () => [
      ...occurrences.map((o) => ({
        key: `${o.event_id}:${o.occurrence_date}`,
        start_date: o.start_date,
        end_date: o.end_date,
        label: o.title,
        color: paletteVar(o.color),
        hatched: false,
      })),
      ...external.map((e) => ({
        key: e.id,
        start_date: e.start_date,
        end_date: e.end_date,
        label: e.title,
        color: STD_COLOR,
        hatched: e.status === "proposed",
      })),
    ],
    [occurrences, external],
  );

  const dotsByDate = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const item of items) {
      if (item.completed_at !== null || item.due_date === null) continue;
      const colors = out.get(item.due_date) ?? [];
      colors.push(lists[item.list_id]?.color ?? "gray");
      out.set(item.due_date, colors);
    }
    return out;
  }, [items, lists]);

  return (
    <div className="month" role="grid" aria-label="Month">
      <div className="month__weekdays" role="row">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} role="columnheader">
            {formatShortWeekday(addDays(weeks[0], i))}
          </span>
        ))}
      </div>
      {weeks.map((start) => {
        const placed = placeBars(bars, start, 7);
        return (
          <div key={start} className="month__week" role="row">
            {Array.from({ length: 7 }, (_, i) => {
              const date = addDays(start, i);
              const dots = dotsByDate.get(date) ?? [];
              const hidden = placed.filter((b) => b.lane >= MAX_LANES && b.startCol <= i && b.endCol >= i).length;
              const classes = ["month__day", date.slice(0, 7) !== month && "month__day--outside", date === today && "month__day--today"];
              return (
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  className={classes.filter(Boolean).join(" ")}
                  style={{ gridColumn: i + 1 }}
                  aria-selected={date === selected}
                  aria-label={date}
                  onClick={() => onSelect(date)}
                >
                  <span className="month__num">{Number(date.slice(8))}</span>
                  {dots.length > 0 && (
                    <span className="month__dots" aria-label={`${dots.length} due`}>
                      {dots.slice(0, MAX_DOTS).map((c, j) => (
                        <span key={j} className="dot dot--sm" style={{ background: paletteVar(c) }} />
                      ))}
                      {dots.length > MAX_DOTS && <Plus size={8} strokeWidth={3} className="month__plus" />}
                    </span>
                  )}
                  {hidden > 0 && <span className="month__more">+{hidden}</span>}
                </button>
              );
            })}
            {placed
              .filter((b) => b.lane < MAX_LANES)
              .map((b) => (
                <span
                  key={b.item.key}
                  className={`month__bar${b.item.hatched ? " hatched" : ""}`}
                  style={{ gridColumn: `${b.startCol + 1} / ${b.endCol + 2}`, gridRow: b.lane + 2, backgroundColor: b.item.color }}
                  aria-hidden="true"
                >
                  {b.item.label}
                </span>
              ))}
          </div>
        );
      })}
    </div>
  );
}
