import { useState, type FormEvent } from "react";
import { addDays, daysBetween, isDate, toMinutes } from "../../shared/dates";
import type { PaletteKey } from "../../shared/palette";
import type { Occurrence } from "../../shared/recurrence";
import { ColorPicker } from "../components/ColorPicker";
import { RepeatFields, repeatFromRRule, repeatToRRule, type RepeatForm } from "../components/RepeatFields";
import { Checkbox } from "../components/Checkbox";
import { Modal, useModal } from "../components/Modal";
import { store } from "../data/instance";
import {
  deleteEvent,
  saveEvent,
  validateEvent,
  type EventForm,
  type Scope,
} from "./eventActions";

/** HH:MM an hour after `time`, stopping at the end of the day. */
function hourLater(time: string): string {
  const m = Math.min(toMinutes(time) + 60, 23 * 60 + 59);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function initialForm(occurrence: Occurrence | null, date: string, time: string | null | undefined): EventForm {
  if (!occurrence) {
    return {
      title: "",
      notes: "",
      color: "blue",
      // A new event from the all-day row (time null) is all day.
      all_day: time === null,
      start_date: date,
      start_time: time ?? "09:00",
      end_date: date,
      end_time: hourLater(time ?? "09:00"),
      repeat: repeatFromRRule(null, date),
    };
  }
  const event = store.get("events", occurrence.event_id);
  return {
    title: occurrence.title,
    notes: occurrence.notes,
    color: occurrence.color as PaletteKey,
    all_day: occurrence.all_day,
    start_date: occurrence.start_date,
    start_time: occurrence.start_time ?? "09:00",
    end_date: occurrence.end_date,
    end_time: occurrence.end_time ?? "10:00",
    repeat: repeatFromRRule(event?.rrule ?? null, occurrence.start_date),
  };
}

export function ScopeDialog({ verb, onPick, onClose }: { verb: string; onPick: (s: Scope) => void; onClose: () => void }) {
  const [modal, close] = useModal(onClose);
  const pick = (scope: Scope) => {
    close();
    onPick(scope);
  };
  return (
    <Modal {...modal} variant="dialog" title={`${verb} recurring event`}>
      <div className="form">
        <p className="muted">Apply to this event only, or to every event in the series?</p>
        <div className="form__actions">
          <button type="button" className="button--secondary" onClick={close}>
            Cancel
          </button>
          <button type="button" onClick={() => pick("occurrence")}>
            This event
          </button>
          <button type="button" className="button--primary" onClick={() => pick("series")}>
            All events
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Creates an event on `date` (at `time`, or all day when it's null) when `occurrence` is null,
 * otherwise edits or deletes that occurrence. Saves as it closes; a new event without a title is
 * dropped, and an invalid one stays open with the problem shown.
 */
export function EventEditor({
  occurrence,
  date,
  time,
  onClose,
}: {
  occurrence: Occurrence | null;
  date: string;
  time?: string | null;
  onClose: () => void;
}) {
  const [initial] = useState(() => initialForm(occurrence, date, time));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<"save" | "delete" | null>(null);
  const seriesRule = occurrence ? (store.get("events", occurrence.event_id)?.rrule ?? null) : null;
  const [modal, close] = useModal(onClose);

  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setRepeat = (patch: Partial<RepeatForm>) => setForm((f) => ({ ...f, repeat: { ...f.repeat, ...patch } }));

  function setStartDate(value: string) {
    // Keep the duration when the start moves.
    setForm((f) => {
      if (!isDate(value) || !isDate(f.start_date)) return { ...f, start_date: value };
      const span = f.end_date >= f.start_date ? daysBetween(f.start_date, f.end_date) : 0;
      return { ...f, start_date: value, end_date: addDays(value, span) };
    });
  }

  async function run(action: "save" | "delete", scope: Scope) {
    if (action === "save") await saveEvent(form, occurrence, scope);
    else if (occurrence) await deleteEvent(occurrence, scope);
    close();
  }

  function done() {
    if (asking) return;
    // Untouched, or a new event never given a title: nothing to save.
    if (JSON.stringify(form) === JSON.stringify(initial) || (!occurrence && !form.title.trim())) return close();
    const message = validateEvent(form);
    setError(message);
    if (message) return;
    // A changed repeat rule only makes sense for the series.
    if (occurrence?.recurring && repeatToRRule(form.repeat) === seriesRule) setAsking("save");
    else void run("save", "series");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    done();
  }

  function onDelete() {
    if (!occurrence) return;
    if (occurrence.recurring) setAsking("delete");
    else void run("delete", "series");
  }

  const { repeat } = form;
  return (
    <>
      <Modal {...modal} onClose={done} done title={occurrence ? "Edit event" : "New event"}>
        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field__label">Title</span>
            <input autoFocus={!occurrence} maxLength={500} enterKeyHint="done" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <label className="check-field">
            <Checkbox checked={form.all_day} onChange={(v) => set("all_day", v)} />
            All day
          </label>
          <div className="field-row">
            <label className="field">
              <span className="field__label">Starts</span>
              <input type="date" required value={form.start_date} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            {!form.all_day && (
              <label className="field">
                <span className="field__label">At</span>
                <input type="time" required value={form.start_time} onChange={(e) => set("start_time", e.target.value)} />
              </label>
            )}
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field__label">Ends</span>
              <input type="date" required value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </label>
            {!form.all_day && (
              <label className="field">
                <span className="field__label">At</span>
                <input type="time" required value={form.end_time} onChange={(e) => set("end_time", e.target.value)} />
              </label>
            )}
          </div>

          <RepeatFields repeat={repeat} startDate={form.start_date} onChange={setRepeat} />

          <div className="field">
            <span className="field__label">Colour</span>
            <ColorPicker value={form.color} onChange={(c) => set("color", c)} />
          </div>
          <label className="field">
            <span className="field__label">Notes</span>
            <textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
          {error && <p className="form__error">{error}</p>}
          {occurrence && (
            <div className="form__actions">
              <button type="button" className="button--danger form__actions-start" onClick={onDelete}>
                Delete
              </button>
            </div>
          )}
        </form>
      </Modal>
      {asking && (
        <ScopeDialog
          verb={asking === "save" ? "Edit" : "Delete"}
          onPick={(scope) => void run(asking, scope)}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}
