import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { ExternalEvent } from "../../shared/agenda";
import { addDays, daysInMonth, isDate, makeDate } from "../../shared/dates";
import type { Item } from "../../shared/entities";
import type { Occurrence } from "../../shared/recurrence";
import { useShortcuts, useSwipe } from "../components/gestures";
import { IconButton } from "../components/IconButton";
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
  { value: "week", label: "7 days" },
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
  if (view === "week") return { from: date, to: addDays(date, 6) };
  const weeks = monthWeeks(date);
  return { from: weeks[0], to: addDays(weeks.at(-1)!, 6) };
}

function title(view: View, date: string): string {
  if (view === "month") return formatMonthYear(date);
  if (view === "day") return formatLongDate(date);
  return `${formatDayMonth(date)} to ${formatDayMonth(addDays(date, 6))}`;
}

const SLIDE_CLASSES = { [-1]: "period--from-left", 0: "period--fade", 1: "period--from-right" } as const;

/** One period's content, keyed by the period. The slide direction is fixed at mount, so selecting a day inside it doesn't replay the entrance. */
function Period({ slide, children }: { slide: 1 | -1 | 0; children: ReactNode }) {
  const [entrance] = useState(SLIDE_CLASSES[slide]);
  return <div className={`period ${entrance}`}>{children}</div>;
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
  // Which way the next period slides in: from the right after "next", from the left after "previous".
  const [slide, setSlide] = useState<1 | -1 | 0>(0);
  const swipeArea = useRef<HTMLDivElement>(null);
  const { items, lists } = useData().tables;
  const itemList = useMemo(() => Object.values(items), [items]);

  const { from, to } = range(view, date);
  const occurrences = useOccurrences(from, to);
  const external = useStdDates(from, to);

  const go = (next: { view?: View; date?: string }, dir: 1 | -1 | 0 = 0) => {
    setSlide(dir);
    setParams({ view: next.view ?? view, date: next.date ?? date }, { replace: true });
  };
  const step = (dir: 1 | -1) =>
    go({ date: view === "month" ? addMonths(date, dir) : addDays(date, dir * (view === "week" ? 7 : 1)) }, dir);
  const newEvent = () => setEditing({ kind: "event", occurrence: null });

  useSwipe(swipeArea, step);
  useShortcuts({
    n: newEvent,
    t: () => go({ date: now.date }),
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
          <button type="button" onClick={() => go({ date: now.date })}>
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

      <div className="cal-swipe" ref={swipeArea}>
        <Period key={`${view}:${from}`} slide={slide}>
          {view === "month" ? (
            <div className="cal-month">
              <MonthView
                selected={date}
                today={now.date}
                occurrences={occurrences}
                external={external}
                items={itemList}
                lists={lists}
                onSelect={(d) => go({ date: d })}
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
              items={itemList}
              lists={lists}
              handlers={handlers}
              onSelectDate={(d) => go({ view: "day", date: d })}
            />
          )}
        </Period>
      </div>

      {editing?.kind === "event" && <EventEditor occurrence={editing.occurrence} date={date} onClose={() => setEditing(null)} />}
      {editing?.kind === "item" && <ItemEditor item={editing.item} onClose={() => setEditing(null)} />}
      {editing?.kind === "external" && <StdSheet event={editing.event} onClose={() => setEditing(null)} />}
    </div>
  );
}
