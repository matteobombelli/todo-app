import { EventFields, EventExceptionFields } from "../../shared/entities";
import { addDays, daysBetween } from "../../shared/dates";
import { newId } from "../../shared/ids";
import type { PaletteKey } from "../../shared/palette";
import { shiftRRule, type Occurrence } from "../../shared/recurrence";
import { repeatProblem, repeatToRRule, type RepeatForm } from "../components/RepeatFields";
import { offerUndo, removeWithUndo } from "../components/UndoToast";
import { store } from "../data/instance";

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
  const repeat = repeatProblem(form.repeat, form.start_date);
  if (repeat) return repeat;
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

/**
 * Writes the editor's form. `initial` is the form as it opened: a series edit writes only what the
 * user changed onto the event as it is now, so an edit made elsewhere meanwhile (by Claude, say)
 * isn't overwritten with the old values.
 */
export async function saveEvent(form: EventForm, occurrence: Occurrence | null, scope: Scope, initial: EventForm): Promise<void> {
  const fields = { title: form.title.trim(), notes: form.notes, color: form.color };
  const event = occurrence ? store.get("events", occurrence.event_id) : undefined;

  if (!occurrence) {
    await store.upsert("events", { id: newId(), ...fields, ...schedule(form), rrule: repeatToRRule(form.repeat) });
    return;
  }
  // Deleted meanwhile: saving would bring it back as a new event.
  if (!event) return;

  if (scope === "series" || !occurrence.recurring) {
    const s = schedule(form);
    const scheduleEdited =
      s.all_day !== occurrence.all_day ||
      s.start_date !== occurrence.start_date ||
      s.start_time !== occurrence.start_time ||
      s.end_date !== occurrence.end_date ||
      s.end_time !== occurrence.end_time;
    const rule = repeatToRRule(form.repeat);
    const ruleChanged = rule !== repeatToRRule(initial.repeat);
    // No longer repeating: the event becomes the occurrence the form shows, not the series' first.
    const detach = ruleChanged && rule === null && event.rrule !== null;
    // The form shows one occurrence; moving it moves the whole series by the same number of days.
    const shift = scheduleEdited && !detach ? daysBetween(occurrence.start_date, form.start_date) : 0;
    const start = addDays(event.start_date, shift);
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => form[k] !== initial[k]);
    await store.upsert("events", {
      ...event,
      ...Object.fromEntries(changed.map((k) => [k, fields[k]])),
      ...(detach
        ? s
        : scheduleEdited
          ? { ...s, start_date: start, end_date: addDays(start, daysBetween(form.start_date, form.end_date)) }
          : {}),
      // Weekdays turn with the move, unless the user chose a new rule in the form.
      rrule: ruleChanged ? rule : shiftRRule(event.rrule, shift),
    });
    // Exceptions are keyed by the date the rule generated, which moved with the series.
    if (shift && event.rrule && !ruleChanged) {
      const moved = Object.values(store.getSnapshot().tables.event_exceptions)
        .filter((x) => x.event_id === event.id && x.deleted_at === null)
        // Furthest along first, so no move lands on a date another hasn't left yet (one live
        // exception per occurrence).
        .sort((a, b) => (shift > 0 ? b.occurrence_date.localeCompare(a.occurrence_date) : a.occurrence_date.localeCompare(b.occurrence_date)))
        .map((x) => ({ ...x, occurrence_date: addDays(x.occurrence_date, shift) }));
      if (moved.length) await store.upsertMany("event_exceptions", moved);
    }
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

/** Deletes an occurrence (by cancelling it) or the whole event, with an Undo toast. */
export async function deleteEvent(occurrence: Occurrence, scope: Scope): Promise<void> {
  const message = `Deleted "${occurrence.title}"`;
  if (scope === "series" || !occurrence.recurring) {
    removeWithUndo("events", occurrence.event_id, message);
    return;
  }
  const existing = occurrence.exception_id ? store.get("event_exceptions", occurrence.exception_id) : undefined;
  const cancelled = await store.upsert("event_exceptions", {
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
  offerUndo(message, () => void (existing ? store.upsert("event_exceptions", existing) : store.remove("event_exceptions", cancelled.id)));
}
