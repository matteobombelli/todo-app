import { useState, type FormEvent } from "react";
import { addDays, daysBetween, isDate, weekday } from "../../shared/dates";
import type { PaletteKey } from "../../shared/palette";
import { WEEKDAY_CODES, type Occurrence } from "../../shared/recurrence";
import { ColorPicker } from "../components/ColorPicker";
import { Modal } from "../components/Modal";
import { store } from "../data/instance";
import {
  deleteEvent,
  repeatFromRRule,
  repeatToRRule,
  saveEvent,
  validateEvent,
  type EventForm,
  type RepeatForm,
  type Scope,
} from "./eventActions";

const FREQ_UNITS = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" } as const;
const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function initialForm(occurrence: Occurrence | null, date: string): EventForm {
  if (!occurrence) {
    return {
      title: "",
      notes: "",
      color: "blue",
      all_day: false,
      start_date: date,
      start_time: "09:00",
      end_date: date,
      end_time: "10:00",
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

function ScopeDialog({ verb, onPick, onClose }: { verb: string; onPick: (s: Scope) => void; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`${verb} recurring event`}>
      <div className="form">
        <p className="muted">Apply to this event only, or to every event in the series?</p>
        <div className="form__actions">
          <button type="button" className="button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => onPick("occurrence")}>
            This event
          </button>
          <button type="button" className="button--primary" onClick={() => onPick("series")}>
            All events
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Creates an event on `date` when `occurrence` is null, otherwise edits or deletes that occurrence. */
export function EventEditor({ occurrence, date, onClose }: { occurrence: Occurrence | null; date: string; onClose: () => void }) {
  const [form, setForm] = useState(() => initialForm(occurrence, date));
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<"save" | "delete" | null>(null);
  const seriesRule = occurrence ? (store.get("events", occurrence.event_id)?.rrule ?? null) : null;

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
    setAsking(null);
    if (action === "save") await saveEvent(form, occurrence, scope);
    else if (occurrence) await deleteEvent(occurrence, scope);
    onClose();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const message = validateEvent(form);
    setError(message);
    if (message) return;
    // A changed repeat rule only makes sense for the series.
    if (occurrence?.recurring && repeatToRRule(form.repeat) === seriesRule) setAsking("save");
    else void run("save", "series");
  }

  function onDelete() {
    if (!occurrence) return;
    if (occurrence.recurring) setAsking("delete");
    else if (confirm(`Delete "${occurrence.title}"?`)) void run("delete", "series");
  }

  const { repeat } = form;
  return (
    <>
      <Modal open onClose={onClose} title={occurrence ? "Edit event" : "New event"}>
        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field__label">Title</span>
            <input autoFocus={!occurrence} maxLength={500} value={form.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <label className="check-field">
            <input type="checkbox" checked={form.all_day} onChange={(e) => set("all_day", e.target.checked)} />
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

          <fieldset className="repeat">
            <legend className="field__label">Repeat</legend>
            <div className="field-row">
              <select
                aria-label="Repeat"
                value={repeat.freq}
                onChange={(e) =>
                  setRepeat({
                    freq: e.target.value as RepeatForm["freq"],
                    byDay: repeat.byDay.length || !isDate(form.start_date) ? repeat.byDay : [weekday(form.start_date)],
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
                    onChange={(e) => setRepeat({ interval: Number(e.target.value) })}
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
                      setRepeat({
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
                <select aria-label="Ends" value={repeat.end} onChange={(e) => setRepeat({ end: e.target.value as RepeatForm["end"] })}>
                  <option value="never">Never ends</option>
                  <option value="until">Ends on</option>
                  <option value="count">Ends after</option>
                </select>
                {repeat.end === "until" && (
                  <input type="date" aria-label="End date" required value={repeat.until} onChange={(e) => setRepeat({ until: e.target.value })} />
                )}
                {repeat.end === "count" && (
                  <label className="inline-field">
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      className="input--narrow"
                      value={repeat.count}
                      onChange={(e) => setRepeat({ count: Number(e.target.value) })}
                    />
                    times
                  </label>
                )}
              </div>
            )}
          </fieldset>

          <div className="field">
            <span className="field__label">Colour</span>
            <ColorPicker value={form.color} onChange={(c) => set("color", c)} />
          </div>
          <label className="field">
            <span className="field__label">Notes</span>
            <textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
          {error && <p className="form__error">{error}</p>}
          <div className="form__actions">
            {occurrence && (
              <button type="button" className="button--danger form__actions-start" onClick={onDelete}>
                Delete
              </button>
            )}
            <button type="button" className="button--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button--primary">
              Save
            </button>
          </div>
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
