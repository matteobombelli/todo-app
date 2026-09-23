// Floating calendar dates ('YYYY-MM-DD') and times ('HH:MM'): no timezone, compared as strings.
// Arithmetic goes through day numbers (days since 1970-01-01), computed in UTC so DST never shifts them.

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= daysInMonth(Number(m[1]), month);
}

export function isTime(s: string): boolean {
  return TIME_RE.test(s);
}

export function toDayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(date: string): number {
  return (toDayNumber(date) + 3) % 7;
}

/** The Sunday on or before `date`: the calendar's weeks run Sunday to Saturday. */
export function weekStart(date: string): string {
  return addDays(date, -((toDayNumber(date) + 4) % 7));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function makeDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Minutes since midnight. */
export function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Today's date and the current time on the wall clock of an IANA timezone. */
export function nowIn(timeZone: string, at = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
