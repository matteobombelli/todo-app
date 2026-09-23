import { useLayoutEffect, useMemo, useRef } from "react";
import type { ExternalEvent } from "../../shared/agenda";
import { addDays, toMinutes } from "../../shared/dates";
import type { Item, List } from "../../shared/entities";
import type { Now } from "../../shared/items";
import { STD_COLOR } from "../../shared/palette";
import type { Occurrence } from "../../shared/recurrence";
import { paletteVar } from "../components/ColorPicker";
import { formatHour, formatShortWeekday, formatTime } from "../format";
import type { CalendarHandlers } from "./AgendaPanel";
import { placeBars, placeBlocks } from "./layout";

const HOUR_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

type BarItem =
  | { kind: "event"; start_date: string; end_date: string; occurrence: Occurrence }
  | { kind: "external"; start_date: string; end_date: string; event: ExternalEvent };

type BlockItem =
  | { kind: "event"; start_date: string; start_time: string | null; end_date: string; end_time: string | null; occurrence: Occurrence }
  | { kind: "external"; start_date: string; start_time: string | null; end_date: string; end_time: string | null; event: ExternalEvent };

function endOfHour(time: string): string {
  const m = Math.min(toMinutes(time) + 60, 24 * 60 - 1);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The 7-day and Day views: an all-day row, then an hourly grid of timed events and items. */
export function TimeGrid({
  start,
  days,
  now,
  occurrences,
  external,
  items,
  lists,
  handlers,
  onSelectDate,
}: {
  start: string;
  days: number;
  now: Now;
  occurrences: Occurrence[];
  external: ExternalEvent[];
  items: Item[];
  lists: Readonly<Record<string, List>>;
  handlers: CalendarHandlers;
  onSelectDate: (date: string) => void;
}) {
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const end = dates.at(-1)!;
  const scroller = useRef<HTMLDivElement>(null);
  const showsToday = now.date >= start && now.date <= end;

  const { bars, blocks } = useMemo(() => {
    const bars: BarItem[] = [];
    const blocks: BlockItem[] = [];
    for (const o of occurrences) {
      if (o.all_day) bars.push({ kind: "event", start_date: o.start_date, end_date: o.end_date, occurrence: o });
      else blocks.push({ kind: "event", ...o, occurrence: o });
    }
    for (const e of external) {
      if (e.start_time === null || e.start_date !== e.end_date) bars.push({ kind: "external", start_date: e.start_date, end_date: e.end_date, event: e });
      // Save-the-date only has a start time; show it as an hour.
      else blocks.push({ kind: "external", start_date: e.start_date, start_time: e.start_time, end_date: e.end_date, end_time: endOfHour(e.start_time), event: e });
    }
    return { bars, blocks };
  }, [occurrences, external]);

  const placedBars = placeBars(bars, start, days);
  const lanes = placedBars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
  const due = items.filter((i) => i.due_date !== null && i.due_date >= start && i.due_date <= end);

  // Scrolls once per mount to the current time, or to 8:00 when today is not shown.
  useLayoutEffect(() => {
    const minutes = showsToday ? toMinutes(now.time) - 60 : 8 * 60;
    scroller.current?.scrollTo({ top: Math.max(0, (minutes / 60) * HOUR_PX) });
  }, []);

  return (
    <div className="tgrid" style={{ "--days": days, "--hour": `${HOUR_PX}px` } as React.CSSProperties}>
      <div className="tgrid__head">
        <span />
        {dates.map((d) => (
          <button
            key={d}
            type="button"
            className={`tgrid__dayhead${d === now.date ? " tgrid__dayhead--today" : ""}`}
            onClick={() => onSelectDate(d)}
          >
            <span className="tgrid__weekday">{formatShortWeekday(d)}</span>
            <span className="tgrid__num">{Number(d.slice(8))}</span>
          </button>
        ))}
      </div>

      <div className="tgrid__allday">
        <span className="tgrid__gutter-label">all-day</span>
        {placedBars.map((b) => {
          const style = { gridColumn: `${b.startCol + 2} / ${b.endCol + 3}`, gridRow: b.lane + 1 };
          return b.item.kind === "event" ? (
            <button
              key={`${b.item.occurrence.event_id}:${b.item.occurrence.occurrence_date}`}
              type="button"
              className="tgrid__bar"
              style={{ ...style, backgroundColor: paletteVar(b.item.occurrence.color) }}
              onClick={() => b.item.kind === "event" && handlers.onEvent(b.item.occurrence)}
            >
              {b.item.occurrence.title}
            </button>
          ) : (
            <button
              key={b.item.event.id}
              type="button"
              className={`tgrid__bar${b.item.event.status === "proposed" ? " hatched" : ""}`}
              style={{ ...style, backgroundColor: STD_COLOR }}
              onClick={() => b.item.kind === "external" && handlers.onExternal(b.item.event)}
            >
              {b.item.event.title}
            </button>
          );
        })}
        {dates.map((d, i) => {
          const untimed = due.filter((item) => item.due_date === d && item.due_time === null);
          if (!untimed.length) return null;
          return (
            <div key={d} className="tgrid__items" style={{ gridColumn: i + 2, gridRow: lanes + 1 }}>
              {untimed.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`tgrid__item${item.completed_at !== null ? " tgrid__item--done" : ""}`}
                  style={{ borderColor: paletteVar(lists[item.list_id]?.color ?? "gray") }}
                  onClick={() => handlers.onItem(item)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="tgrid__scroll" ref={scroller}>
        <div className="tgrid__body">
          <div className="tgrid__hours" aria-hidden="true">
            {HOURS.map((h) => (
              <span key={h} className="tgrid__hour">
                {h > 0 && formatHour(h)}
              </span>
            ))}
          </div>
          {dates.map((d) => (
            <div key={d} className="tgrid__col">
              {placeBlocks(blocks, d).map((b) => {
                const item = b.item;
                const style = {
                  top: (b.top / 60) * HOUR_PX,
                  height: ((b.bottom - b.top) / 60) * HOUR_PX,
                  left: `${(b.column / b.columns) * 100}%`,
                  width: `${100 / b.columns}%`,
                };
                if (item.kind === "event") {
                  const o = item.occurrence;
                  return (
                    <button
                      key={`${o.event_id}:${o.occurrence_date}`}
                      type="button"
                      className="tgrid__block"
                      style={{ ...style, backgroundColor: paletteVar(o.color) }}
                      onClick={() => handlers.onEvent(o)}
                    >
                      <span className="tgrid__block-title">{o.title}</span>
                      <span className="tgrid__block-time">{formatTime(o.start_time!)}</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={item.event.id}
                    type="button"
                    className={`tgrid__block${item.event.status === "proposed" ? " hatched" : ""}`}
                    style={{ ...style, backgroundColor: STD_COLOR }}
                    onClick={() => handlers.onExternal(item.event)}
                  >
                    <span className="tgrid__block-title">{item.event.title}</span>
                    <span className="tgrid__block-time">{formatTime(item.event.start_time!)}</span>
                  </button>
                );
              })}
              {due
                .filter((item) => item.due_date === d && item.due_time !== null)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`tgrid__marker${item.completed_at !== null ? " tgrid__item--done" : ""}`}
                    style={{ top: (toMinutes(item.due_time!) / 60) * HOUR_PX, borderColor: paletteVar(lists[item.list_id]?.color ?? "gray") }}
                    onClick={() => handlers.onItem(item)}
                  >
                    {formatTime(item.due_time!)} {item.title}
                  </button>
                ))}
              {d === now.date && (
                <span className="tgrid__now" style={{ top: (toMinutes(now.time) / 60) * HOUR_PX }} aria-label="Now" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
