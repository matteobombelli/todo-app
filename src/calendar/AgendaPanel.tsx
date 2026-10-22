import { Ellipsis } from "lucide-react";
import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { buildAgenda, type ExternalEvent } from "../../shared/agenda";
import type { Goal, GoalEntry, Item } from "../../shared/entities";
import { canLog } from "../../shared/goals";
import type { Now } from "../../shared/items";
import type { Occurrence } from "../../shared/recurrence";
import { STD_COLOR } from "../../shared/palette";
import { paletteVar } from "../components/ColorPicker";
import { IconButton } from "../components/IconButton";
import { Link } from "react-router";
import { setNavDirection } from "../components/motion";
import { useData, useGoalToday } from "../data/hooks";
import { formatLongDate, formatTime } from "../format";
import { EffortControl, formatDays } from "../goals/effort";
import { ItemRow } from "../todo/ItemRow";

export type CalendarTarget =
  | { kind: "event"; occurrence: Occurrence }
  | { kind: "external"; event: ExternalEvent }
  | { kind: "item"; item: Item };

export interface CalendarHandlers {
  onEvent: (o: Occurrence) => void;
  onExternal: (e: ExternalEvent) => void;
  onItem: (i: Item) => void;
  /** Opens the actions for an entry, from a right-click or its kebab. */
  onMenu: (e: MouseEvent, target: CalendarTarget) => void;
}

function timeRange(o: Occurrence): string {
  if (o.all_day) return o.start_date === o.end_date ? "All day" : "Multi-day";
  return `${formatTime(o.start_time!)} to ${formatTime(o.end_time!)}`;
}

function externalTimes(e: ExternalEvent): string {
  if (!e.start_time) return "Save the Date";
  if (e.start_date !== e.end_date || !e.end_time) return formatTime(e.start_time);
  return `${formatTime(e.start_time)} to ${formatTime(e.end_time)}`;
}

/** An agenda entry: tapping opens it; a right-click or the kebab shows its actions. */
function EntryRow({
  title,
  onOpen,
  onMenu,
  children,
}: {
  title: string;
  onOpen: () => void;
  onMenu: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="row agenda-event" onContextMenu={onMenu}>
      <button type="button" className="item__body" onClick={onOpen}>
        {children}
      </button>
      <IconButton icon={Ellipsis} label={`Actions for "${title}"`} className="row__kebab" ariaHasPopup="menu" onClick={onMenu} />
    </div>
  );
}

function EventRow({ occurrence, handlers }: { occurrence: Occurrence; handlers: CalendarHandlers }) {
  return (
    <EntryRow
      title={occurrence.title}
      onOpen={() => handlers.onEvent(occurrence)}
      onMenu={(e) => handlers.onMenu(e, { kind: "event", occurrence })}
    >
      <span className="agenda-event__bar" style={{ background: paletteVar(occurrence.color) }} aria-hidden="true" />
      <span className="row__title">{occurrence.title}</span>
      <span className="row__meta">{timeRange(occurrence)}</span>
    </EntryRow>
  );
}

function ExternalRow({ event, handlers }: { event: ExternalEvent; handlers: CalendarHandlers }) {
  return (
    <EntryRow title={event.title} onOpen={() => handlers.onExternal(event)} onMenu={(e) => handlers.onMenu(e, { kind: "external", event })}>
      <span
        className={`agenda-event__bar${event.status === "proposed" ? " hatched" : ""}`}
        style={{ backgroundColor: STD_COLOR }}
        aria-hidden="true"
      />
      <span className="row__title">{event.title}</span>
      <span className="row__meta">{externalTimes(event)}</span>
    </EntryRow>
  );
}

/** A goal running on the day: effort can be set while the day can be logged, and is shown after. */
function GoalRow({ goal, entry, date, entries }: { goal: Goal; entry: GoalEntry | null; date: string; entries: GoalEntry[] }) {
  const today = useGoalToday();
  return (
    <div className="row agenda-goal">
      <Link to={`/goals/${goal.id}`} className="item__body" viewTransition onClick={() => setNavDirection("push")}>
        <span className="agenda-event__bar" style={{ background: paletteVar(goal.color) }} aria-hidden="true" />
        <span className="row__title">{goal.title}</span>
      </Link>
      {canLog(goal, date, today) ? (
        <span style={{ "--goal": paletteVar(goal.color) } as CSSProperties}>
          <EffortControl goal={goal} date={date} entries={entries} label={`Effort on ${goal.title}`} />
        </span>
      ) : (
        date <= today && <span className="row__meta">{entry ? formatDays(entry.amount) : "Nothing logged"}</span>
      )}
    </div>
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
  const { items, lists, goals, goal_entries } = useData().tables;
  const entries = useMemo(() => Object.values(goal_entries), [goal_entries]);
  const agenda = useMemo(
    () => buildAgenda(date, occurrences, external, Object.values(items), now, Object.values(goals), entries),
    [date, occurrences, external, items, now, goals, entries],
  );
  const itemRow = (item: Item) => (
    <li key={item.id}>
      <ItemRow
        item={item}
        now={now}
        list={lists[item.list_id]}
        due="time"
        onTap={handlers.onItem}
        onMenu={(e, i) => handlers.onMenu(e, { kind: "item", item: i })}
      />
    </li>
  );
  const empty = !agenda.overdue.length && !agenda.bars.length && !agenda.timed.length && !agenda.untimed.length && !agenda.goals.length;

  return (
    <section className="agenda" aria-label={`Agenda for ${formatLongDate(date)}`}>
      <h2 className="agenda__date">{formatLongDate(date)}</h2>
      {agenda.overdue.length > 0 && (
        <>
          <h3 className="agenda__heading agenda__heading--overdue">Overdue</h3>
          <ul className="rows">
            {agenda.overdue.map((item) => (
              <li key={item.id}>
                <ItemRow
                  item={item}
                  now={now}
                  list={lists[item.list_id]}
                  onTap={handlers.onItem}
                  onMenu={(e, i) => handlers.onMenu(e, { kind: "item", item: i })}
                />
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
              <EventRow occurrence={b.occurrence} handlers={handlers} />
            ) : (
              <ExternalRow event={b.event} handlers={handlers} />
            )}
          </li>
        ))}
        {agenda.timed.map((t) =>
          t.kind === "item" ? (
            itemRow(t.item)
          ) : (
            <li key={t.kind === "event" ? `${t.occurrence.event_id}:${t.occurrence.occurrence_date}` : t.event.id}>
              {t.kind === "event" ? (
                <EventRow occurrence={t.occurrence} handlers={handlers} />
              ) : (
                <ExternalRow event={t.event} handlers={handlers} />
              )}
            </li>
          ),
        )}
        {agenda.untimed.map(itemRow)}
      </ul>
      {agenda.goals.length > 0 && (
        <>
          <h3 className="agenda__heading">Goals</h3>
          <ul className="rows">
            {agenda.goals.map(({ goal, entry }) => (
              <li key={goal.id}>
                <GoalRow goal={goal} entry={entry} date={date} entries={entries} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
