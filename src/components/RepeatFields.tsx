import { addDays, isDate, weekday } from "../../shared/dates";
import { PickerRow } from "./Pickers";
import { WEEKDAY_CODES, parseRRule, serializeRRule, type Freq } from "../../shared/recurrence";

const FREQ_UNITS = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" } as const;
const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export interface RepeatForm {
  freq: Freq | "NONE";
  interval: number;
  byDay: number[];
  end: "never" | "until" | "count";
  until: string;
  count: number;
}

export function repeatFromRRule(rrule: string | null, startDate: string): RepeatForm {
  const base: RepeatForm = { freq: "NONE", interval: 1, byDay: [], end: "never", until: addDays(startDate, 30), count: 10 };
  if (!rrule) return base;
  const r = parseRRule(rrule);
  return {
    ...base,
    freq: r.freq,
    interval: r.interval,
    // A weekly rule without BYDAY repeats on its start's weekday; showing it pressed keeps a tap
    // on another day from replacing it instead of adding one.
    byDay: r.freq === "WEEKLY" && !r.byDay.length && isDate(startDate) ? [weekday(startDate)] : r.byDay,
    end: r.until ? "until" : r.count ? "count" : "never",
    until: r.until ?? base.until,
    count: r.count ?? base.count,
  };
}

export function repeatToRRule(repeat: RepeatForm): string | null {
  if (repeat.freq === "NONE") return null;
  return serializeRRule({
    freq: repeat.freq,
    interval: Math.max(1, Math.floor(repeat.interval) || 1),
    byDay: repeat.freq === "WEEKLY" ? [...repeat.byDay].sort((a, b) => a - b) : [],
    until: repeat.end === "until" ? repeat.until : null,
    count: repeat.end === "count" ? Math.max(1, Math.floor(repeat.count) || 1) : null,
  });
}

/**
 * The repeat after its start date moves: weekly days still set to the old start's weekday follow
 * the start (days the user picked stay), so the start stays one of its occurrences.
 */
export function followStart(repeat: RepeatForm, oldStart: string, newStart: string): RepeatForm {
  if (repeat.freq !== "WEEKLY" || !isDate(oldStart) || !isDate(newStart)) return repeat;
  if (repeat.byDay.length !== 1 || repeat.byDay[0] !== weekday(oldStart)) return repeat;
  return { ...repeat, byDay: [weekday(newStart)] };
}

/** What's wrong with the repeat's end, for the editors to show, or null. */
export function repeatProblem(repeat: RepeatForm, startDate: string): string | null {
  if (repeat.freq === "NONE" || repeat.end !== "until") return null;
  if (!isDate(repeat.until)) return "Choose when the repeat ends";
  if (isDate(startDate) && repeat.until < startDate) return "The repeat must end on or after its first date";
  return null;
}

/**
 * The Repeat rows of the event and item editors, inside their `.group`. `startDate` picks the
 * default weekday.
 */
export function RepeatFields({
  repeat,
  startDate,
  onChange,
}: {
  repeat: RepeatForm;
  startDate: string;
  onChange: (patch: Partial<RepeatForm>) => void;
}) {
  return (
    <>
      <label className="group__row">
        <span className="group__name">Repeat</span>
        <select
          aria-label="Repeat"
          value={repeat.freq}
          onChange={(e) =>
            onChange({
              freq: e.target.value as RepeatForm["freq"],
              byDay: repeat.byDay.length || !isDate(startDate) ? repeat.byDay : [weekday(startDate)],
            })
          }
        >
          <option value="NONE">Never</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </select>
      </label>
      {repeat.freq !== "NONE" && (
        <label className="group__row">
          <span className="group__name">Every</span>
          <span className="group__value">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              className="input--narrow"
              aria-label="Every"
              value={repeat.interval}
              onChange={(e) => onChange({ interval: Number(e.target.value) })}
            />
            {FREQ_UNITS[repeat.freq]}
            {repeat.interval === 1 ? "" : "s"}
          </span>
        </label>
      )}
      {repeat.freq === "WEEKLY" && (
        <div className="group__row">
          <div className="weekday-picker" role="group" aria-label="On">
            {WEEKDAY_LETTERS.map((letter, day) => (
              <button
                key={day}
                type="button"
                aria-pressed={repeat.byDay.includes(day)}
                aria-label={WEEKDAY_CODES[day]}
                onClick={() =>
                  onChange({
                    byDay: repeat.byDay.includes(day) ? repeat.byDay.filter((d) => d !== day) : [...repeat.byDay, day],
                  })
                }
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
      )}
      {repeat.freq !== "NONE" && (
        <label className="group__row">
          <span className="group__name">End Repeat</span>
          <select
            aria-label="Repeat ends"
            value={repeat.end}
            onChange={(e) => {
              const end = e.target.value as RepeatForm["end"];
              // The default end was set when the editor opened; keep it after a start moved since.
              const stale = end === "until" && isDate(startDate) && (!isDate(repeat.until) || repeat.until < startDate);
              onChange(stale ? { end, until: addDays(startDate, 30) } : { end });
            }}
          >
            <option value="never">Never</option>
            <option value="until">On Date</option>
            <option value="count">After</option>
          </select>
        </label>
      )}
      {repeat.freq !== "NONE" && repeat.end === "until" && (
        <PickerRow
          label="Until"
          picks={[{ kind: "date", name: "Repeats until", value: repeat.until, onChange: (until) => onChange({ until }) }]}
        />
      )}
      {repeat.freq !== "NONE" && repeat.end === "count" && (
        <label className="group__row">
          <span className="group__name">Occurrences</span>
          <span className="group__value">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              className="input--narrow"
              aria-label="Occurrences"
              value={repeat.count}
              onChange={(e) => onChange({ count: Number(e.target.value) })}
            />
            times
          </span>
        </label>
      )}
    </>
  );
}
