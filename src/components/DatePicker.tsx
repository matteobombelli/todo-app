import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { addDays, addMonths } from "../../shared/dates";
import { monthWeeks } from "../calendar/layout";
import { localNow } from "../data/hooks";
import { formatLongDate, formatMonthYear, formatShortWeekday } from "../format";
import { IconButton } from "./IconButton";
import { Modal, useModal } from "./Modal";

type OnPick = (date: string) => void;

/**
 * A date chosen from code (a menu entry) rather than from a visible field: a sheet with a month grid.
 * Not the browser's own picker, which iOS won't open from code. Render `node` somewhere on the page,
 * then call `pick(initial, onPick)`; `onPick` runs only when a day is chosen.
 */
export function useDatePicker(): [node: ReactNode, pick: (initial: string, onPick: OnPick) => void] {
  const [picking, setPicking] = useState<{ initial: string; onPick: OnPick; key: number } | null>(null);
  const pick = (initial: string, onPick: OnPick) => setPicking({ initial, onPick, key: Date.now() });
  const node = picking && (
    <DateSheet key={picking.key} initial={picking.initial} onPick={picking.onPick} onClose={() => setPicking(null)} />
  );
  return [node, pick];
}

const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

function DateSheet({ initial, onPick, onClose }: { initial: string; onPick: OnPick; onClose: () => void }) {
  const today = localNow().date;
  const [modal, close] = useModal(onClose);
  // The day the arrow keys move from; its month is the one shown.
  const [cursor, setCursor] = useState(initial);
  const grid = useRef<HTMLDivElement>(null);
  const keyed = useRef(false);
  // The initial day takes focus as the sheet opens, not each time its month comes round again.
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

  const choose = (date: string) => {
    close();
    onPick(date);
  };

  function onKeyDown(e: KeyboardEvent) {
    const step = ARROWS[e.key];
    if (!step) return;
    e.preventDefault();
    keyed.current = true;
    setCursor((c) => addDays(c, step));
  }

  return (
    <Modal {...modal} variant="dialog" title="Choose Date">
      <div className="date-sheet">
        <div className="date-sheet__header">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => setCursor((c) => addMonths(c, -1))} />
          <span className="date-sheet__month" aria-live="polite">
            {formatMonthYear(cursor)}
          </span>
          <IconButton icon={ChevronRight} label="Next month" onClick={() => setCursor((c) => addMonths(c, 1))} />
        </div>
        <div className="date-sheet__grid" role="grid" aria-label={formatMonthYear(cursor)} ref={grid} onKeyDown={onKeyDown}>
          <div className="date-sheet__row" role="row">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} role="columnheader" className="date-sheet__weekday">
                {formatShortWeekday(addDays(weeks[0], i))}
              </span>
            ))}
          </div>
          {weeks.map((start) => (
            <div key={start} className="date-sheet__row" role="row">
              {Array.from({ length: 7 }, (_, i) => {
                const date = addDays(start, i);
                const classes = [
                  "date-sheet__day",
                  date.slice(0, 7) !== month && "date-sheet__day--outside",
                  date === today && "date-sheet__day--today",
                ];
                return (
                  <button
                    key={date}
                    type="button"
                    role="gridcell"
                    data-date={date}
                    className={classes.filter(Boolean).join(" ")}
                    aria-selected={date === initial}
                    aria-label={formatLongDate(date)}
                    // One tab stop in the grid; the arrow keys move within it.
                    tabIndex={date === cursor ? 0 : -1}
                    autoFocus={opening.current && date === initial}
                    onClick={() => choose(date)}
                  >
                    <span className="date-sheet__num">{Number(date.slice(8))}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="date-sheet__quick">
          <button type="button" onClick={() => choose(today)}>
            Today
          </button>
          <button type="button" onClick={() => choose(addDays(today, 1))}>
            Tomorrow
          </button>
        </div>
      </div>
    </Modal>
  );
}
