import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { addDays, addMonths, weekday } from "../../shared/dates";
import { monthWeeks } from "../calendar/layout";
import { localNow } from "../data/hooks";
import { formatLongDate, formatMonthYear, formatRelativeDate, formatShortWeekday, formatTime } from "../format";
import { IconButton } from "./IconButton";
import { usePresence } from "./motion";
import { localeDayFirst, localeHour12, parseDate, parseTime } from "./parse";

// Dates and times as in iOS's editors: a row shows the value as a tinted pill, and tapping it opens a
// picker inline beneath the row (a month grid, or hour and minute buttons), with a field to type the
// value instead ("fri", "2:30p"). One picker is open at a time within a PickerScope.

const OpenPicker = createContext<[string | null, (id: string | null) => void] | null>(null);

/** Keeps one picker open at a time among the rows inside it (an editor's form). */
export function PickerScope({ children }: { children: ReactNode }) {
  const state = useState<string | null>(null);
  return <OpenPicker.Provider value={state}>{children}</OpenPicker.Provider>;
}

function useOpen(id: string): [open: boolean, set: (open: boolean) => void] {
  // PickerRow provides a scope when there's none around it.
  const [openId, setOpenId] = useContext(OpenPicker)!;
  return [openId === id, (open) => setOpenId(open ? id : openId === id ? null : openId)];
}

const finePointer = () => window.matchMedia("(pointer: fine)").matches;

// ---------------------------------------------------------------------------------------------
// Month grid

const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * A month of days to pick from, Sunday first, with today in red and `selected` filled. Arrow keys
 * move between days and across months. Days outside min..max can't be picked.
 */
export function MonthGrid({
  selected,
  onPick,
  min,
  max,
  autoFocus,
}: {
  selected: string | null;
  onPick: (date: string) => void;
  min?: string;
  max?: string;
  autoFocus?: boolean;
}) {
  const today = localNow().date;
  // The day the arrow keys move from; its month is the one shown.
  const [cursor, setCursor] = useState(selected ?? (min && min > today ? min : today));
  const grid = useRef<HTMLDivElement>(null);
  const keyed = useRef(false);
  // The selected day takes focus as the grid opens, not each time its month comes round again.
  const opening = useRef(true);
  useEffect(() => {
    opening.current = false;
  }, []);
  const weeks = monthWeeks(cursor);
  const month = cursor.slice(0, 7);

  useEffect(() => {
    if (!keyed.current) return;
    keyed.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-date="${cursor}"]`)?.focus();
  }, [cursor]);

  function onKeyDown(e: KeyboardEvent) {
    const step = ARROWS[e.key];
    if (!step) return;
    e.preventDefault();
    keyed.current = true;
    setCursor((c) => addDays(c, step));
  }

  return (
    <div className="month-grid">
      <div className="month-grid__header">
        <span className="month-grid__month" aria-live="polite">
          {formatMonthYear(cursor)}
        </span>
        <IconButton icon={ChevronLeft} label="Previous month" onClick={() => setCursor((c) => addMonths(c, -1))} />
        <IconButton icon={ChevronRight} label="Next month" onClick={() => setCursor((c) => addMonths(c, 1))} />
      </div>
      <div role="grid" aria-label={formatMonthYear(cursor)} ref={grid} onKeyDown={onKeyDown}>
        <div className="month-grid__row" role="row">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} role="columnheader" className="month-grid__weekday">
              {formatShortWeekday(addDays(weeks[0], i))}
            </span>
          ))}
        </div>
        {weeks.map((start) => (
          <div key={start} className="month-grid__row" role="row">
            {Array.from({ length: 7 }, (_, i) => {
              const date = addDays(start, i);
              const classes = [
                "month-grid__day",
                date.slice(0, 7) !== month && "month-grid__day--outside",
                date === today && "month-grid__day--today",
              ];
              return (
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  data-date={date}
                  className={classes.filter(Boolean).join(" ")}
                  aria-selected={date === selected}
                  aria-label={formatLongDate(date)}
                  disabled={(min !== undefined && date < min) || (max !== undefined && date > max)}
                  // One tab stop in the grid; the arrow keys move within it.
                  tabIndex={date === cursor ? 0 : -1}
                  autoFocus={autoFocus && opening.current && date === cursor}
                  onClick={() => onPick(date)}
                >
                  <span className="month-grid__num">{Number(date.slice(8))}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Typing a value

/**
 * A field to type a date or time into, showing what it reads as; Return picks it. `parse` turns the
 * text into a value or null.
 */
function TypeIn({
  label,
  placeholder,
  parse,
  describe,
  onPick,
  autoFocus,
}: {
  label: string;
  placeholder: string;
  parse: (text: string) => string | null;
  describe: (value: string) => string;
  onPick: (value: string) => void;
  autoFocus: boolean;
}) {
  const [text, setText] = useState("");
  const value = text.trim() ? parse(text) : null;
  const hintId = useId();
  return (
    <div className="type-in">
      <input
        className="type-in__input"
        aria-label={label}
        aria-describedby={hintId}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="done"
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          // Return never submits the editor's form from here.
          e.preventDefault();
          if (value) onPick(value);
        }}
      />
      <span id={hintId} className={`type-in__hint${text.trim() && !value ? " type-in__hint--bad" : ""}`} aria-live="polite">
        {!text.trim() ? "" : value ? describe(value) : "Not recognised"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Date panel

/** Shortcuts above the grid; each is offered only when it falls inside min..max. */
function quickDates(today: string): { label: string; date: string }[] {
  const saturday = addDays(today, (5 - weekday(today) + 7) % 7 || 7);
  return [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "This Weekend", date: saturday },
    { label: "Next Week", date: addDays(today, 7) },
  ];
}

/** Choosing a date: shortcuts, a field to type one in, and the month grid. */
export function DatePanel({
  value,
  onPick,
  min,
  max,
  focus,
}: {
  value: string | null;
  onPick: (date: string) => void;
  min?: string;
  max?: string;
  /** Where focus goes as it opens: the type-in field (pointers with a keyboard), the grid, or nowhere. */
  focus?: "type" | "grid";
}) {
  const today = localNow().date;
  const dayFirst = useMemo(localeDayFirst, []);
  const inRange = (d: string) => (min === undefined || d >= min) && (max === undefined || d <= max);
  return (
    <div className="date-panel">
      <div className="quick-row">
        {quickDates(today)
          .filter((q) => inRange(q.date))
          .map((q) => (
            <button key={q.label} type="button" className="quick" aria-pressed={q.date === value} onClick={() => onPick(q.date)}>
              {q.label}
            </button>
          ))}
      </div>
      <TypeIn
        label="Type a date"
        placeholder="Type a date: fri, nov 4, in 2 weeks"
        parse={(t) => {
          const d = parseDate(t, today, dayFirst);
          return d && inRange(d) ? d : null;
        }}
        describe={(d) => formatLongDate(d)}
        onPick={onPick}
        autoFocus={focus === "type"}
      />
      <MonthGrid selected={value} onPick={onPick} min={min} max={max} autoFocus={focus === "grid"} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Time panel

const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Choosing a time: a field to type one in, then an hour (and AM or PM) and minutes. Picking the
 * hour keeps the minutes; picking minutes completes the time. `extra` goes on top (durations).
 */
export function TimePanel({
  value,
  onPick,
  onDone,
  extra,
  focus,
}: {
  value: string | null;
  /** Sets the time; the panel stays open. */
  onPick: (time: string) => void;
  /** Sets the time and closes the panel. */
  onDone: (time: string) => void;
  extra?: ReactNode;
  focus?: "type";
}) {
  const hour12 = useMemo(localeHour12, []);
  const hour = value ? Number(value.slice(0, 2)) : null;
  const minute = value ? Number(value.slice(3, 5)) : null;
  const pm = hour !== null && hour >= 12;

  // A first hour with no AM or PM chosen yet: the afternoon for 12 to 6, as with typed times.
  const pickHour = (h: number) => {
    const h24 = !hour12 ? h : hour === null ? (h === 12 || h <= 6 ? (h % 12) + 12 : h) : (h % 12) + (pm ? 12 : 0);
    onPick(`${pad(h24)}:${pad(minute ?? 0)}`);
  };
  const pickPeriod = (toPm: boolean) => {
    const h = hour ?? 9;
    onPick(`${pad((h % 12) + (toPm ? 12 : 0))}:${pad(minute ?? 0)}`);
  };

  const hours = hour12 ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : Array.from({ length: 24 }, (_, i) => i);
  const shownHour = hour === null ? null : hour12 ? hour % 12 || 12 : hour;

  return (
    <div className="time-panel">
      {extra}
      <TypeIn
        label="Type a time"
        placeholder={hour12 ? "Type a time: 2:30p, 1430, noon" : "Type a time: 14:30, 1430"}
        parse={(t) => parseTime(t, hour12)}
        describe={formatTime}
        onPick={onDone}
        autoFocus={focus === "type"}
      />
      <div className="time-panel__head">
        <span className="time-panel__heading">Hour</span>
        {hour12 && (
          <div className="segmented time-panel__period" role="radiogroup" aria-label="AM or PM" style={{ "--count": 2, "--index": pm ? 1 : 0 } as CSSProperties}>
            <button type="button" role="radio" aria-checked={hour !== null && !pm} onClick={() => pickPeriod(false)}>
              AM
            </button>
            <button type="button" role="radio" aria-checked={pm} onClick={() => pickPeriod(true)}>
              PM
            </button>
          </div>
        )}
      </div>
      <div className="time-panel__grid" role="group" aria-label="Hour">
        {hours.map((h) => (
          <button key={h} type="button" className="time-chip" aria-pressed={h === shownHour} onClick={() => pickHour(h)}>
            {hour12 ? h : pad(h)}
          </button>
        ))}
      </div>
      <span className="time-panel__heading">Minutes</span>
      <div className="time-panel__grid" role="group" aria-label="Minutes">
        {MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            className="time-chip"
            aria-pressed={m === minute}
            aria-label={`${pad(m)} minutes`}
            onClick={() => onDone(`${pad(hour ?? 9)}:${pad(m)}`)}
          >
            :{pad(m)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Rows

interface DatePick {
  kind: "date";
  /** The pill's accessible name ("Due date"), read with its value. */
  name: string;
  value: string;
  onChange: (date: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
}

interface TimePick {
  kind: "time";
  name: string;
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
  /** Shown above the hours: shortcuts such as durations. Given `close`, which closes the panel. */
  extra?: (close: () => void) => ReactNode;
}

type Pick = DatePick | TimePick;

/**
 * A form row with a label and one or more pills (a date, a time, or both), each opening its picker
 * beneath the row. `onClear` adds a clear button once there's a value. Goes inside a `.group`.
 */
export function PickerRow({
  label,
  picks,
  onClear,
  clearLabel,
}: {
  label: ReactNode;
  picks: Pick[];
  onClear?: () => void;
  clearLabel?: string;
}) {
  const scoped = useContext(OpenPicker) !== null;
  const row = (
    <>
      <div className="group__row picker-row">
        <span className="group__name">{label}</span>
        <span className="picker-row__pills">
          {picks.map((p) => (
            <Pill key={p.name} pick={p} />
          ))}
        </span>
        {onClear && picks.some((p) => p.value) && (
          <button type="button" className="field__clear" aria-label={clearLabel} onClick={onClear}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {picks.map((p) => (
        <Panel key={p.name} pick={p} />
      ))}
    </>
  );
  return scoped ? row : <PickerScope>{row}</PickerScope>;
}

/** Which panel each pill controls: the pill and its panel find each other by name within the scope. */
function panelId(pick: Pick) {
  return `picker:${pick.name}`;
}

function Pill({ pick }: { pick: Pick }) {
  const [open, setOpen] = useOpen(panelId(pick));
  const today = localNow().date;
  const text = pick.value ? (pick.kind === "date" ? formatRelativeDate(pick.value, today) : formatTime(pick.value)) : (pick.placeholder ?? "None");
  return (
    <button
      type="button"
      className={`pill${pick.value ? "" : " pill--empty"}`}
      aria-expanded={open}
      aria-label={`${pick.name}: ${text}`}
      onClick={() => setOpen(!open)}
    >
      {text}
    </button>
  );
}

function Panel({ pick }: { pick: Pick }) {
  const [open, setOpen] = useOpen(panelId(pick));
  const el = useRef<HTMLDivElement>(null);
  const present = usePresence(open, el);
  // Read as the panel opens: a mouse or trackpad user gets the type-in field focused.
  const focus = useMemo(() => (open && finePointer() ? "type" : undefined), [open]);
  if (!present) return null;
  const close = () => setOpen(false);
  return (
    <div
      ref={el}
      className={`picker-panel${open ? "" : " picker-panel--closing"}`}
      inert={!open}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Escape closes the picker, not the editor around it.
        e.stopPropagation();
        close();
      }}
    >
      <div className="picker-panel__inner">
        {pick.kind === "date" ? (
          <DatePanel
            value={pick.value || null}
            min={pick.min}
            max={pick.max}
            focus={focus}
            onPick={(d) => {
              pick.onChange(d);
              close();
            }}
          />
        ) : (
          <TimePanel
            value={pick.value || null}
            focus={focus}
            extra={pick.extra?.(close)}
            onPick={pick.onChange}
            onDone={(t) => {
              pick.onChange(t);
              close();
            }}
          />
        )}
      </div>
    </div>
  );
}
