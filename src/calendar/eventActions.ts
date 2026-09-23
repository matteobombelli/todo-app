import { EventFields, EventExceptionFields } from "../../shared/entities";
import { addDays, daysBetween } from "../../shared/dates";
import { newId } from "../../shared/ids";
import type { PaletteKey } from "../../shared/palette";
import { parseRRule, serializeRRule, shiftRRule, type Freq, type Occurrence } from "../../shared/recurrence";
import { store } from "../data/instance";

export interface RepeatForm {
  freq: Freq | "NONE";
  interval: number;
  byDay: number[];
  end: "never" | "until" | "count";
  until: string;
  count: number;
}

export interface EventForm {
  title: string;
  notes: string;
  color: PaletteKey;
  all_day: boolean;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  repeat: RepeatForm;
}

export type Scope = "occurrence" | "series";

export function repeatFromRRule(rrule: string | null, startDate: string): RepeatForm {
  const base: RepeatForm = { freq: "NONE", interval: 1, byDay: [], end: "never", until: addDays(startDate, 30), count: 10 };
  if (!rrule) return base;
  const r = parseRRule(rrule);
  return {
    ...base,
    freq: r.freq,
    interval: r.interval,
    byDay: r.byDay,
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

function schedule(form: EventForm) {
  return {
    all_day: form.all_day,
    start_date: form.start_date,
    start_time: form.all_day ? null : form.start_time,
    end_date: form.end_date,
    end_time: form.all_day ? null : form.end_time,
  };
}

/** Validation message for the form, or null. Uses the shared schema so the server will accept it. */
export function validateEvent(form: EventForm): string | null {
  if (!form.title.trim()) return "Add a title";
  const parsed = EventFields.safeParse({
    id: newId(),
    title: form.title,
    notes: form.notes,
    color: form.color,
    rrule: repeatToRRule(form.repeat),
    ...schedule(form),
  });
  if (parsed.success) return null;
  return parsed.error.issues.some((i) => i.path.length === 0) ? "The end must be after the start" : "Check the dates and times";
}

export async function saveEvent(form: EventForm, occurrence: Occurrence | null, scope: Scope): Promise<void> {
  const fields = { title: form.title.trim(), notes: form.notes, color: form.color };
  const event = occurrence ? store.get("events", occurrence.event_id) : undefined;

  if (!occurrence || !event) {
    await store.upsert("events", { id: newId(), ...fields, ...schedule(form), rrule: repeatToRRule(form.repeat) });
    return;
  }

  if (scope === "series" || !occurrence.recurring) {
    const s = schedule(form);
    const scheduleEdited =
      s.all_day !== occurrence.all_day ||
      s.start_date !== occurrence.start_date ||
      s.start_time !== occurrence.start_time ||
      s.end_date !== occurrence.end_date ||
      s.end_time !== occurrence.end_time;
    // The form shows one occurrence; moving it moves the whole series by the same number of days.
    const shift = scheduleEdited ? daysBetween(occurrence.start_date, form.start_date) : 0;
    const start = addDays(event.start_date, shift);
    // Weekdays turn with the move, unless the user chose new ones in the form.
    const rule = repeatToRRule(form.repeat);
    await store.upsert("events", {
      ...event,
      ...fields,
      ...(scheduleEdited ? { ...s, start_date: start, end_date: addDays(start, daysBetween(form.start_date, form.end_date)) } : {}),
      rrule: rule === event.rrule ? shiftRRule(rule, shift) : rule,
    });
    return;
  }

  // One occurrence: store only what differs from the series, so later series edits still reach it.
  const span = daysBetween(event.start_date, event.end_date);
  const s = schedule(form);
  const scheduleChanged =
    s.all_day !== event.all_day ||
    s.start_date !== occurrence.occurrence_date ||
    s.end_date !== addDays(occurrence.occurrence_date, span) ||
    s.start_time !== event.start_time ||
    s.end_time !== event.end_time;
  const exception = EventExceptionFields.parse({
    id: occurrence.exception_id ?? newId(),
    event_id: event.id,
    occurrence_date: occurrence.occurrence_date,
    cancelled: false,
    title: fields.title !== event.title ? fields.title : null,
    notes: fields.notes !== event.notes ? fields.notes : null,
    color: fields.color !== event.color ? fields.color : null,
    ...(scheduleChanged ? s : { all_day: null, start_date: null, start_time: null, end_date: null, end_time: null }),
  });
  await store.upsert("event_exceptions", exception);
}

export async function deleteEvent(occurrence: Occurrence, scope: Scope): Promise<void> {
  if (scope === "series" || !occurrence.recurring) {
    await store.remove("events", occurrence.event_id);
    return;
  }
  const existing = occurrence.exception_id ? store.get("event_exceptions", occurrence.exception_id) : undefined;
  await store.upsert("event_exceptions", {
    title: null,
    notes: null,
    color: null,
    all_day: null,
    start_date: null,
    start_time: null,
    end_date: null,
    end_time: null,
    ...existing,
    id: existing?.id ?? newId(),
    event_id: occurrence.event_id,
    occurrence_date: occurrence.occurrence_date,
    cancelled: true,
  });
}
