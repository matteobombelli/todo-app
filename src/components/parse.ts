import { addDays, addMonths, isDate, makeDate, weekday } from "../../shared/dates";

// Typed dates and times for the pickers: "fri", "nov 4", "in 2 weeks", "2:30p", "1430", "noon".
// Pure, so the locale preferences come in as arguments (see dayFirst and hour12 below).

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** 0 = Monday, from a weekday name or a prefix of it, three letters or more ("thurs", "wed"). */
function weekdayIndex(word: string): number {
  return word.length < 3 ? -1 : WEEKDAYS.findIndex((w) => w.startsWith(word));
}

/** 1-12 from a month name or a prefix of it, three letters or more ("sept", "nov"). */
function monthIndex(word: string): number {
  return word.length < 3 ? 0 : MONTHS.findIndex((m) => m.startsWith(word)) + 1;
}

function fullYear(y: string | undefined, today: string): number | null {
  if (y === undefined) return null;
  const n = Number(y);
  return y.length <= 2 ? Math.floor(Number(today.slice(0, 4)) / 100) * 100 + n : n;
}

/** A month and day with no year: this year's, or next year's once this year's has passed. */
function upcoming(month: number, day: number, year: number | null, today: string): string | null {
  const y = year ?? Number(today.slice(0, 4));
  const date = makeDate(y, month, day);
  if (!isDate(date)) return null;
  if (year === null && date < today) {
    const next = makeDate(y + 1, month, day);
    return isDate(next) ? next : null;
  }
  return date;
}

/**
 * A date typed in words or numbers, relative to `today`, or null when it isn't one. Weekdays mean
 * the next one after today; dates without a year the next time they come round. `dayFirst` reads
 * 4/11 as the 4th of November.
 */
export function parseDate(input: string, today: string, dayFirst = false): string | null {
  const s = input.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return null;
  if (isDate(s)) return s;
  if (/^(today|tod|now)$/.test(s)) return today;
  if (/^(tomorrow|tmrw?|tom)$/.test(s)) return addDays(today, 1);
  if (s === "yesterday") return addDays(today, -1);
  if (/^next week$/.test(s)) return addDays(today, 7);
  if (/^next month$/.test(s)) return addMonths(today, 1);
  if (/^(this )?weekend$/.test(s)) return addDays(today, (5 - weekday(today) + 7) % 7 || 7);

  // "in 3 days", "3d", "+2w", "in a month"
  const rel = /^(?:in |\+)?(\d+|a|an) ?(d|days?|w|wks?|weeks?|m|mos?|months?|y|yrs?|years?)$/.exec(s);
  if (rel && (s.startsWith("in ") || s.startsWith("+") || /^\d+ ?[dwmy]/.test(s))) {
    const n = /^\d/.test(rel[1]) ? Number(rel[1]) : 1;
    const unit = rel[2][0];
    if (unit === "d") return addDays(today, n);
    if (unit === "w") return addDays(today, 7 * n);
    if (unit === "m") return addMonths(today, n);
    return addMonths(today, 12 * n);
  }
  const plus = /^\+(\d+)$/.exec(s);
  if (plus) return addDays(today, Number(plus[1]));

  // "fri" and "this fri": the next one. "next fri": that day in next week (Monday to Sunday).
  const wd = /^(?:(this|next|on) )?([a-z]+)$/.exec(s);
  if (wd) {
    const day = weekdayIndex(wd[2]);
    if (day >= 0 && wd[1] === "next") return addDays(today, 7 - weekday(today) + day);
    if (day >= 0) return addDays(today, (day - weekday(today) + 7) % 7 || 7);
  }

  // "nov 4", "november 4 2027", "4 nov", "4th of november"
  const words = s.replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/\bof\b/g, " ").replace(/\s+/g, " ").trim();
  const md = /^([a-z]+)\.? (\d{1,2})(?: (\d{2}|\d{4}))?$/.exec(words);
  if (md && monthIndex(md[1])) return upcoming(monthIndex(md[1]), Number(md[2]), fullYear(md[3], today), today);
  const dm = /^(\d{1,2}) ([a-z]+)\.?(?: (\d{2}|\d{4}))?$/.exec(words);
  if (dm && monthIndex(dm[2])) return upcoming(monthIndex(dm[2]), Number(dm[1]), fullYear(dm[3], today), today);

  // "11/4", "11/4/27", "11.4.2027"
  const num = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
  if (num) {
    const [a, b] = [Number(num[1]), Number(num[2])];
    const [month, day] = dayFirst ? [b, a] : [a, b];
    return upcoming(month, day, fullYear(num[3], today), today);
  }

  // "15": the next 15th.
  const dom = /^(\d{1,2})$/.exec(words);
  if (dom) {
    const day = Number(dom[1]);
    for (let i = 0; i < 3; i++) {
      const month = addMonths(`${today.slice(0, 7)}-01`, i);
      const date = makeDate(Number(month.slice(0, 4)), Number(month.slice(5, 7)), day);
      if (isDate(date) && date >= today) return date;
    }
  }
  return null;
}

/**
 * A time typed as "14:30", "1430", "2:30pm", "2p", "9.15" or "noon", as HH:MM, or null. With
 * `hour12` (the locale writes 2:30 PM), a bare 1-6 means the afternoon, as nobody plans much at 3 AM.
 */
export function parseTime(input: string, hour12 = false): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, ":");
  if (!s) return null;
  if (s === "noon" || s === "midday") return "12:00";
  if (s === "midnight") return "00:00";
  const m = /^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm|h)?$/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  // "930" reads as 9:30, not hour 930.
  if (m[2] === undefined && m[1].length > 2) return null;
  if (minute > 59) return null;
  const suffix = m[3];
  if (suffix === "a" || suffix === "am" || suffix === "p" || suffix === "pm") {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (suffix.startsWith("p") ? 12 : 0);
  } else {
    if (hour > 23) return null;
    if (hour12 && !m[2] && hour >= 1 && hour <= 6) hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Whether this browser's locale writes the day before the month (4/11 for November 4th). */
export function localeDayFirst(): boolean {
  const parts = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "numeric" }).formatToParts(new Date(Date.UTC(2000, 10, 4)));
  return parts.findIndex((p) => p.type === "day") < parts.findIndex((p) => p.type === "month");
}

/** Whether this browser's locale writes times with AM and PM. */
export function localeHour12(): boolean {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 ?? false;
}
