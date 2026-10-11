import { addDays, isDate, weekday } from "../../shared/dates";
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

/** The Repeat section of the event and item editors. `startDate` picks the default weekday. */
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
    <fieldset className="repeat">
      <legend className="field__label">Repeat</legend>
      <div className="field-row">
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
          <option value="NONE">Does not repeat</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </select>
        {repeat.freq !== "NONE" && (
          <label className="inline-field">
            every
            <input
              type="number"
              min={1}
              max={999}
              className="input--narrow"
              value={repeat.interval}
              onChange={(e) => onChange({ interval: Number(e.target.value) })}
            />
            {FREQ_UNITS[repeat.freq]}
            {repeat.interval === 1 ? "" : "s"}
          </label>
        )}
      </div>
      {repeat.freq === "WEEKLY" && (
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
      )}
      {repeat.freq !== "NONE" && (
        <div className="field-row">
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
            <option value="never">Never ends</option>
            <option value="until">Ends on</option>
            <option value="count">Ends after</option>
          </select>
          {repeat.end === "until" && (
            <input type="date" aria-label="End date" required value={repeat.until} onChange={(e) => onChange({ until: e.target.value })} />
          )}
          {repeat.end === "count" && (
            <label className="inline-field">
              <input
                type="number"
                min={1}
                max={10000}
                className="input--narrow"
                value={repeat.count}
                onChange={(e) => onChange({ count: Number(e.target.value) })}
              />
              times
            </label>
          )}
        </div>
      )}
    </fieldset>
  );
}
