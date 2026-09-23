import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router";
import type { ExternalEvent } from "../../shared/agenda";
import { addDays, daysInMonth, isDate, makeDate, weekStart } from "../../shared/dates";
import type { Item, List } from "../../shared/entities";
import type { Occurrence } from "../../shared/recurrence";
import { isSliding, resetSlide, slide, useShortcuts, useSwipe } from "../components/gestures";
import { IconButton } from "../components/IconButton";
import type { Now } from "../../shared/items";
import { useData, useNow } from "../data/hooks";
import { formatDayMonth, formatLongDate, formatMonthYear } from "../format";
import { ItemEditor } from "../todo/ItemEditor";
import { AgendaPanel, type CalendarHandlers } from "./AgendaPanel";
import { useOccurrences, useStdDates } from "./data";
import { EventEditor } from "./EventEditor";
import { monthWeeks } from "./layout";
import { MonthView } from "./MonthView";
import { StdSheet } from "./StdSheet";
import { TimeGrid } from "./TimeGrid";

type View = "month" | "week" | "day";
const VIEWS: { value: View; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

function addMonths(date: string, n: number): string {
  const total = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return makeDate(year, month, Math.min(Number(date.slice(8)), daysInMonth(year, month)));
}

function range(view: View, date: string): { from: string; to: string } {
  if (view === "day") return { from: date, to: date };
  if (view === "week") return { from: weekStart(date), to: addDays(weekStart(date), 6) };
  const weeks = monthWeeks(date);
  return { from: weeks[0], to: addDays(weeks.at(-1)!, 6) };
}

function title(view: View, date: string): string {
  if (view === "month") return formatMonthYear(date);
  if (view === "day") return formatLongDate(date);
  const { from, to } = range("week", date);
  return `${formatDayMonth(from)} to ${formatDayMonth(to)}`;
}

function stepDate(view: View, date: string, dir: 1 | -1): string {
  return view === "month" ? addMonths(date, dir) : addDays(date, dir * (view === "week" ? 7 : 1));
}

/** Identifies the period containing `date`; periods are keyed by it so a swiped-to neighbour keeps its DOM. */
function periodKey(view: View, date: string): string {
  return `${view}:${range(view, date).from}`;
}

const OFFSETS = [-1, 0, 1] as const;

/**
 * One period's content. The neighbours either side of the current period are rendered too, off
 * screen, so a swipe drags them in. A period that mounts as the current one (a jump or a view
 * change) fades in; one reached by a swipe was already on screen.
 */
function Period({
  view,
  date,
  offset,
  now,
  items,
  lists,
  handlers,
  onSelect,
  onSelectDate,
}: {
  view: View;
  date: string;
  offset: -1 | 0 | 1;
  now: Now;
  items: Item[];
  lists: Record<string, List>;
  handlers: CalendarHandlers;
  onSelect: (date: string) => void;
  onSelectDate: (date: string) => void;
}) {
  const [entrance] = useState(offset === 0 ? " period--fade" : "");
  const { from, to } = range(view, date);
  const occurrences = useOccurrences(from, to);
  const external = useStdDates(from, to);
  const position = offset === 0 ? "" : offset < 0 ? " period--prev" : " period--next";

  return (
    <div className={`period${entrance}${position}`} inert={offset !== 0}>
      {view === "month" ? (
        <div className="cal-month">
          <MonthView
            selected={date}
            today={now.date}
            occurrences={occurrences}
            external={external}
            items={items}
            lists={lists}
            onSelect={onSelect}
          />
          <AgendaPanel key={date} date={date} now={now} occurrences={occurrences} external={external} handlers={handlers} />
        </div>
      ) : (
        <TimeGrid
          start={from}
          days={view === "week" ? 7 : 1}
          now={now}
          occurrences={occurrences}
          external={external}
          items={items}
          lists={lists}
          handlers={handlers}
          onSelectDate={onSelectDate}
        />
      )}
    </div>
  );
}

type Editing =
  | { kind: "event"; occurrence: Occurrence | null }
  | { kind: "item"; item: Item }
  | { kind: "external"; event: ExternalEvent };

export default function CalendarPage() {
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.value === params.get("view"))?.value ?? "month") as View;
  const rawDate = params.get("date") ?? "";
  const date = isDate(rawDate) ? rawDate : now.date;
  const [editing, setEditing] = useState<Editing | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const { items, lists } = useData().tables;
  const itemList = useMemo(() => Object.values(items), [items]);

  const go = (next: { view?: View; date?: string }) =>
    setParams({ view: next.view ?? view, date: next.date ?? date }, { replace: true });
  // Slides the neighbour in, then makes it the current period.
  const slideTo = (dir: 1 | -1, next: string) => {
    // One slide at a time: a tap during one would step from a date that is about to change.
    if (!track.current) go({ date: next });
    else if (!isSliding(track.current)) slide(track.current, `translateX(${-dir * 100}%)`, () => go({ date: next }));
  };
  const step = (dir: 1 | -1) => slideTo(dir, stepDate(view, date, dir));
  const goToday = () => {
    const target = periodKey(view, now.date);
    if (target === periodKey(view, stepDate(view, date, 1))) slideTo(1, now.date);
    else if (target === periodKey(view, stepDate(view, date, -1))) slideTo(-1, now.date);
    else go({ date: now.date });
  };
  const newEvent = () => setEditing({ kind: "event", occurrence: null });

  useSwipe(track, (dir) => go({ date: stepDate(view, date, dir) }));
  // A swipe or slide leaves the track moved onto a neighbour; the neighbour is now the current
  // period (same key, same DOM), so the track goes back without a visible jump.
  useLayoutEffect(() => {
    if (track.current) resetSlide(track.current);
  }, [view, date]);
  useShortcuts({
    n: newEvent,
    t: goToday,
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
  });
  const viewIndex = VIEWS.findIndex((v) => v.value === view);

  const handlers: CalendarHandlers = {
    onEvent: (occurrence) => setEditing({ kind: "event", occurrence }),
    onExternal: (event) => setEditing({ kind: "external", event }),
    onItem: (item) => setEditing({ kind: "item", item }),
  };

  return (
    <div className={`page page--calendar page--${view}`}>
      <div className="cal-header">
        <h1 className="cal-header__title">{title(view, date)}</h1>
        <div className="cal-header__nav">
          <IconButton icon={ChevronLeft} label="Previous" onClick={() => step(-1)} />
          <button type="button" onClick={goToday}>
            Today
          </button>
          <IconButton icon={ChevronRight} label="Next" onClick={() => step(1)} />
        </div>
        <div
          className="segmented"
          role="radiogroup"
          aria-label="View"
          style={{ "--count": VIEWS.length, "--index": viewIndex } as CSSProperties}
        >
          {VIEWS.map((v) => (
            <button key={v.value} type="button" role="radio" aria-checked={v.value === view} onClick={() => go({ view: v.value })}>
              {v.label}
            </button>
          ))}
        </div>
        <IconButton icon={Plus} label="New event" onClick={newEvent} className="cal-header__add" />
      </div>

      <div className="cal-swipe">
        <div className="cal-track" ref={track}>
          {OFFSETS.map((offset) => {
            const d = offset === 0 ? date : stepDate(view, date, offset);
            return (
              <Period
                key={periodKey(view, d)}
                view={view}
                date={d}
                offset={offset}
                now={now}
                items={itemList}
                lists={lists}
                handlers={handlers}
                onSelect={(sel) => go({ date: sel })}
                onSelectDate={(sel) => go({ view: "day", date: sel })}
              />
            );
          })}
        </div>
      </div>

      {editing?.kind === "event" && <EventEditor occurrence={editing.occurrence} date={date} onClose={() => setEditing(null)} />}
      {editing?.kind === "item" && <ItemEditor item={editing.item} onClose={() => setEditing(null)} />}
      {editing?.kind === "external" && <StdSheet event={editing.event} onClose={() => setEditing(null)} />}
    </div>
  );
}
