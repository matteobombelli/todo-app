import { addDays } from "../shared/dates";

// Floating dates and times are formatted as UTC instants so the device timezone cannot shift them.
const utc = (date: string, time = "00:00") => new Date(`${date}T${time}:00Z`);

const weekdayDay = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const withYear = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortWeekday = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone: "UTC" });

/** "Today", "Tomorrow", "Yesterday", "Mon, Sep 22", or with the year when it is not this year's. */
export function formatRelativeDate(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  return date.slice(0, 4) === today.slice(0, 4) ? weekdayDay.format(utc(date)) : withYear.format(utc(date));
}

export function formatTime(time: string): string {
  return timeFmt.format(utc("2000-01-01", time));
}

export function formatHour(hour: number): string {
  return hourFmt.format(utc("2000-01-01", `${String(hour).padStart(2, "0")}:00`));
}

export function formatMonthYear(date: string): string {
  return monthYear.format(utc(date));
}

export function formatLongDate(date: string): string {
  return longDate.format(utc(date));
}

export function formatShortWeekday(date: string): string {
  return shortWeekday.format(utc(date));
}

/** A range of days: "Oct 18 – 24", "Oct 28 – Nov 3", with the year when it is not this year's. */
export function formatDayRange(from: string, to: string, today: string): string {
  const year = to.slice(0, 4) === today.slice(0, 4) ? "" : `, ${to.slice(0, 4)}`;
  const end = from.slice(0, 7) === to.slice(0, 7) ? String(Number(to.slice(8))) : monthDay.format(utc(to));
  return `${monthDay.format(utc(from))} – ${end}${year}`;
}

/** "Oct 6", with the year when it is not this year's. */
export function formatShortDate(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? monthDay.format(utc(date)) : withYear.format(utc(date));
}
