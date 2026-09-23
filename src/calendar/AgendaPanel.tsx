import { useMemo } from "react";
import { buildAgenda, type ExternalEvent } from "../../shared/agenda";
import type { Item } from "../../shared/entities";
import type { Now } from "../../shared/items";
import type { Occurrence } from "../../shared/recurrence";
import { STD_COLOR } from "../../shared/palette";
import { paletteVar } from "../components/ColorPicker";
import { useData } from "../data/hooks";
import { formatLongDate, formatTime } from "../format";
import { ItemRow } from "../todo/ItemRow";

export interface CalendarHandlers {
  onEvent: (o: Occurrence) => void;
  onExternal: (e: ExternalEvent) => void;
  onItem: (i: Item) => void;
}

function timeRange(o: Occurrence): string {
  if (o.all_day) return o.start_date === o.end_date ? "All day" : "Multi-day";
  return `${formatTime(o.start_time!)} to ${formatTime(o.end_time!)}`;
}

function EventRow({ occurrence, onEvent }: { occurrence: Occurrence; onEvent: (o: Occurrence) => void }) {
  return (
    <button type="button" className="row agenda-event" onClick={() => onEvent(occurrence)}>
      <span className="agenda-event__bar" style={{ background: paletteVar(occurrence.color) }} aria-hidden="true" />
      <span className="row__title">{occurrence.title}</span>
      <span className="row__meta">{timeRange(occurrence)}</span>
    </button>
  );
}

function ExternalRow({ event, onExternal }: { event: ExternalEvent; onExternal: (e: ExternalEvent) => void }) {
  return (
    <button type="button" className="row agenda-event" onClick={() => onExternal(event)}>
      <span
        className={`agenda-event__bar${event.status === "proposed" ? " hatched" : ""}`}
        style={{ backgroundColor: STD_COLOR }}
        aria-hidden="true"
      />
      <span className="row__title">{event.title}</span>
      <span className="row__meta">{event.start_time ? formatTime(event.start_time) : "Save the Date"}</span>
    </button>
  );
}

/** One day's agenda in the order shared/agenda.ts defines, so it matches what Claude reports. */
export function AgendaPanel({
  date,
  now,
  occurrences,
  external,
  handlers,
}: {
  date: string;
  now: Now;
  occurrences: Occurrence[];
  external: ExternalEvent[];
  handlers: CalendarHandlers;
}) {
  const { items, lists } = useData().tables;
  const agenda = useMemo(
    () => buildAgenda(date, occurrences, external, Object.values(items), now),
    [date, occurrences, external, items, now],
  );
  const itemRow = (item: Item) => (
    <li key={item.id}>
      <ItemRow item={item} now={now} list={lists[item.list_id]} due="time" onOpen={handlers.onItem} />
    </li>
  );
  const empty = !agenda.overdue.length && !agenda.bars.length && !agenda.timed.length && !agenda.untimed.length;

  return (
    <section className="agenda" aria-label={`Agenda for ${formatLongDate(date)}`}>
      <h2 className="agenda__date">{formatLongDate(date)}</h2>
      {agenda.overdue.length > 0 && (
        <>
          <h3 className="agenda__heading agenda__heading--overdue">Overdue</h3>
          <ul className="rows">
            {agenda.overdue.map((item) => (
              <li key={item.id}>
                <ItemRow item={item} now={now} list={lists[item.list_id]} onOpen={handlers.onItem} />
              </li>
            ))}
          </ul>
        </>
      )}
      {agenda.overdue.length > 0 && <h3 className="agenda__heading">Today</h3>}
      {empty && <p className="empty">Nothing planned.</p>}
      <ul className="rows">
        {agenda.bars.map((b) => (
          <li key={b.kind === "event" ? `${b.occurrence.event_id}:${b.occurrence.occurrence_date}` : b.event.id}>
            {b.kind === "event" ? (
              <EventRow occurrence={b.occurrence} onEvent={handlers.onEvent} />
            ) : (
              <ExternalRow event={b.event} onExternal={handlers.onExternal} />
            )}
          </li>
        ))}
        {agenda.timed.map((t) =>
          t.kind === "item" ? (
            itemRow(t.item)
          ) : (
            <li key={t.kind === "event" ? `${t.occurrence.event_id}:${t.occurrence.occurrence_date}` : t.event.id}>
              {t.kind === "event" ? (
                <EventRow occurrence={t.occurrence} onEvent={handlers.onEvent} />
              ) : (
                <ExternalRow event={t.event} onExternal={handlers.onExternal} />
              )}
            </li>
          ),
        )}
        {agenda.untimed.map(itemRow)}
      </ul>
    </section>
  );
}
