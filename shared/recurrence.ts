import { addDays, daysBetween, daysInMonth, fromDayNumber, isDate, makeDate, toDayNumber, weekday } from "./dates";

// The supported RRULE subset: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (weekly only),
// and at most one of UNTIL (floating date, YYYYMMDD) or COUNT.
//
// Occurrences are the dates the rule generates on or after the event's start_date; start_date itself
// is only an occurrence when it matches (a weekly rule whose BYDAY omits its weekday skips it).
// Monthly and yearly rules skip periods lacking the start's day (the 31st, Feb 29), as RFC 5545 does.
// COUNT counts generated dates, so cancelled occurrences still use up the count.

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RRule {
  freq: Freq;
  interval: number;
  /** Weekdays for WEEKLY, 0 = Monday … 6 = Sunday, sorted. Empty means the start's weekday. */
  byDay: number[];
  until: string | null;
  count: number | null;
}

export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

export function parseRRule(s: string): RRule {
  const rule: RRule = { freq: "DAILY", interval: 1, byDay: [], until: null, count: null };
  const seen = new Set<string>();
  for (const part of s.replace(/^RRULE:/, "").split(";")) {
    const [key, value, extra] = part.split("=");
    if (!value || extra !== undefined || seen.has(key)) throw new Error(`Bad RRULE part: ${part}`);
    seen.add(key);
    switch (key) {
      case "FREQ":
        if (!FREQS.includes(value as Freq)) throw new Error(`Unsupported FREQ: ${value}`);
        rule.freq = value as Freq;
        break;
      case "INTERVAL":
        rule.interval = positiveInt(value, 999);
        break;
      case "COUNT":
        rule.count = positiveInt(value, 10_000);
        break;
      case "UNTIL": {
        const date = /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : "";
        if (!isDate(date)) throw new Error(`Bad UNTIL: ${value}`);
        rule.until = date;
        break;
      }
      case "BYDAY": {
        const days = value.split(",").map((code) => WEEKDAY_CODES.indexOf(code as (typeof WEEKDAY_CODES)[number]));
        if (days.includes(-1) || new Set(days).size !== days.length) throw new Error(`Bad BYDAY: ${value}`);
        rule.byDay = days.sort((a, b) => a - b);
        break;
      }
      default:
        throw new Error(`Unsupported RRULE part: ${key}`);
    }
  }
  if (!seen.has("FREQ")) throw new Error("RRULE needs FREQ");
  if (rule.until && rule.count) throw new Error("RRULE cannot have both UNTIL and COUNT");
  if (rule.byDay.length && rule.freq !== "WEEKLY") throw new Error("BYDAY is only supported with FREQ=WEEKLY");
  return rule;
}

function positiveInt(value: string, max: number): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1 || n > max) throw new Error(`Bad number: ${value}`);
  return n;
}

export function serializeRRule(rule: RRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "WEEKLY" && rule.byDay.length) parts.push(`BYDAY=${rule.byDay.map((d) => WEEKDAY_CODES[d]).join(",")}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll("-", "")}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  return parts.join(";");
}

/**
 * The rule for a series whose start moves by `days`: weekly BYDAY turns with it, so a Monday series
 * moved one day later repeats on Tuesdays. Other rules follow the start date on their own.
 */
export function shiftRRule(rrule: string | null, days: number): string | null {
  if (!rrule || days % 7 === 0) return rrule;
  const rule = parseRRule(rrule);
  if (!rule.byDay.length) return rrule;
  return serializeRRule({ ...rule, byDay: rule.byDay.map((d) => (((d + days) % 7) + 7) % 7).sort((a, b) => a - b) });
}

/** Dates the rule generates from start through limit (inclusive), in order. */
export function ruleDates(start: string, rule: RRule, limit: string): string[] {
  const end = rule.until && rule.until < limit ? rule.until : limit;
  const out: string[] = [];
  let generated = 0;
  // Returns false once the series is exhausted; dates past `end` are counted but not kept.
  const emit = (date: string): boolean => {
    if (rule.count !== null && generated >= rule.count) return false;
    generated++;
    if (date > end) return false;
    out.push(date);
    return true;
  };

  const [y0, m0, d0] = start.split("-").map(Number);
  const startDay = toDayNumber(start);
  const endDay = toDayNumber(end);
  switch (rule.freq) {
    case "DAILY":
      for (let day = startDay; day <= endDay; day += rule.interval) if (!emit(fromDayNumber(day))) break;
      break;
    case "WEEKLY": {
      const days = rule.byDay.length ? rule.byDay : [weekday(start)];
      const monday = startDay - weekday(start);
      outer: for (let week = monday; week <= endDay; week += 7 * rule.interval) {
        for (const wd of days) {
          if (week + wd < startDay) continue;
          if (!emit(fromDayNumber(week + wd))) break outer;
        }
      }
      break;
    }
    case "MONTHLY":
      for (let i = 0; ; i += rule.interval) {
        const year = y0 + Math.floor((m0 - 1 + i) / 12);
        const month = ((m0 - 1 + i) % 12) + 1;
        if (makeDate(year, month, 1) > end) break;
        if (d0 <= daysInMonth(year, month) && !emit(makeDate(year, month, d0))) break;
      }
      break;
    case "YEARLY":
      for (let year = y0; makeDate(year, m0, 1) <= end; year += rule.interval) {
        if (d0 <= daysInMonth(year, m0) && !emit(makeDate(year, m0, d0))) break;
      }
      break;
  }
  return out;
}

type Schedule = Pick<
  RecurringEvent,
  "all_day" | "start_date" | "start_time" | "end_date" | "end_time"
>;

export interface RecurringEvent {
  id: string;
  title: string;
  notes: string;
  color: string;
  all_day: boolean;
  start_date: string;
  start_time: string | null;
  end_date: string;
  end_time: string | null;
  rrule: string | null;
}

export interface OccurrenceException {
  id: string;
  event_id: string;
  occurrence_date: string;
  cancelled: boolean;
  title: string | null;
  notes: string | null;
  color: string | null;
  all_day: boolean | null;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  deleted_at: number | null;
}

export interface Occurrence extends Schedule {
  event_id: string;
  /** The date the rule generated, which identifies the occurrence even after it is moved. */
  occurrence_date: string;
  recurring: boolean;
  exception_id: string | null;
  title: string;
  notes: string;
  color: string;
}

/** Occurrences of one event that overlap [from, to] (inclusive dates), sorted by start. */
export function expandOccurrences(
  event: RecurringEvent,
  exceptions: OccurrenceException[],
  from: string,
  to: string,
): Occurrence[] {
  const span = daysBetween(event.start_date, event.end_date);
  const at = (date: string): Occurrence => ({
    event_id: event.id,
    occurrence_date: date,
    recurring: event.rrule !== null,
    exception_id: null,
    title: event.title,
    notes: event.notes,
    color: event.color,
    all_day: event.all_day,
    start_date: date,
    start_time: event.start_time,
    end_date: addDays(date, span),
    end_time: event.end_time,
  });
  const overlaps = (o: Occurrence) => o.start_date <= to && o.end_date >= from;

  if (event.rrule === null) {
    const only = at(event.start_date);
    return overlaps(only) ? [only] : [];
  }

  const byDate = new Map<string, OccurrenceException>();
  for (const x of exceptions) if (x.event_id === event.id && x.deleted_at === null) byDate.set(x.occurrence_date, x);
  // A moved occurrence can land in range from an original date outside it, so generate far enough
  // to reach every exception.
  let limit = to;
  for (const date of byDate.keys()) if (date > limit) limit = date;

  const earliest = addDays(from, -span);
  const out: Occurrence[] = [];
  for (const date of ruleDates(event.start_date, parseRRule(event.rrule), limit)) {
    const x = byDate.get(date);
    if (!x) {
      if (date >= earliest && date <= to) out.push(at(date));
      continue;
    }
    if (x.cancelled) continue;
    const base = at(date);
    const occ: Occurrence = {
      ...base,
      exception_id: x.id,
      title: x.title ?? base.title,
      notes: x.notes ?? base.notes,
      color: x.color ?? base.color,
      ...(x.all_day !== null && x.start_date !== null && x.end_date !== null
        ? { all_day: x.all_day, start_date: x.start_date, start_time: x.start_time, end_date: x.end_date, end_time: x.end_time }
        : {}),
    };
    if (overlaps(occ)) out.push(occ);
  }
  return out.sort(compareOccurrences);
}

export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  return (
    a.start_date.localeCompare(b.start_date) ||
    Number(b.all_day) - Number(a.all_day) ||
    (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
    a.title.localeCompare(b.title)
  );
}

/** Occurrences of every live event overlapping [from, to], sorted by start. */
export function occurrencesInRange(
  events: (RecurringEvent & { deleted_at: number | null })[],
  exceptions: OccurrenceException[],
  from: string,
  to: string,
): Occurrence[] {
  return events
    .filter((e) => e.deleted_at === null)
    .flatMap((e) => expandOccurrences(e, exceptions, from, to))
    .sort(compareOccurrences);
}
