import { useRef, useState, type FormEvent } from "react";
import { addDays, daysBetween, isDate, isTime, toMinutes } from "../../shared/dates";
import type { PaletteKey } from "../../shared/palette";
import type { Occurrence } from "../../shared/recurrence";
import { ColorPicker } from "../components/ColorPicker";
import { followStart, RepeatFields, repeatFromRRule, repeatToRRule, type RepeatForm } from "../components/RepeatFields";
import { Switch, TextArea } from "../components/Fields";
import { Modal, useModal } from "../components/Modal";
import { PickerRow, PickerScope } from "../components/Pickers";
import { store } from "../data/instance";
import {
  deleteEvent,
  saveEvent,
  validateEvent,
  type EventForm,
  type Scope,
} from "./eventActions";

/** The date and time `minutes` after `date` at `time`. */
function shift(date: string, time: string, minutes: number): { date: string; time: string } {
  const total = toMinutes(time) + minutes;
  const days = Math.floor(total / 1440);
  const m = total - days * 1440;
  return { date: addDays(date, days), time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
}

/** Minutes from the event's start to its end (negative when it ends first). */
function duration(f: EventForm): number {
  return daysBetween(f.start_date, f.end_date) * 1440 + toMinutes(f.end_time) - toMinutes(f.start_time);
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : `${Math.floor(hours)}½`} hr`;
}

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
    repeat: repeatFromRRule(event?.rrule ?? null, occurrence.occurrence_date),
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
  const [modal, close] = useModal(onClose);
  // Set while a save or delete is being written, so a second Return or Done can't apply it twice.
  const running = useRef(false);

  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setRepeat = (patch: Partial<RepeatForm>) => setForm((f) => ({ ...f, repeat: { ...f.repeat, ...patch } }));

  function setStartDate(value: string) {
    // Keep the duration when the start moves.
    setForm((f) => {
      if (!isDate(value) || !isDate(f.start_date)) return { ...f, start_date: value };
      const span = f.end_date >= f.start_date ? daysBetween(f.start_date, f.end_date) : 0;
      return { ...f, start_date: value, end_date: addDays(value, span), repeat: followStart(f.repeat, f.start_date, value) };
    });
  }

  function setStartTime(value: string) {
    // Keep the duration when the start moves, as long as the event was the right way round.
    setForm((f) => {
      if (!isDate(f.start_date) || !isTime(f.start_time) || !isTime(f.end_time) || !isTime(value)) return { ...f, start_time: value };
      const length = duration(f);
      if (length < 0) return { ...f, start_time: value };
      const end = shift(f.start_date, value, length);
      return { ...f, start_time: value, end_date: end.date, end_time: end.time };
    });
  }

  async function run(action: "save" | "delete", scope: Scope) {
    if (running.current) return;
    running.current = true;
    try {
      if (action === "save") await saveEvent(form, occurrence, scope, initial);
      else if (occurrence) await deleteEvent(occurrence, scope);
    } catch (e) {
      // Not written: let it be tried again. On success it stays set while the editor closes.
      running.current = false;
      throw e;
    }
    close();
  }

  function done() {
    if (asking || running.current) return;
    // Untouched, or a new event never given a title: nothing to save.
    if (JSON.stringify(form) === JSON.stringify(initial) || (!occurrence && !form.title.trim())) return close();
    const message = validateEvent(form);
    setError(message);
    if (message) return;
    // A changed repeat rule only makes sense for the series.
    if (occurrence?.recurring && repeatToRRule(form.repeat) === repeatToRRule(initial.repeat)) setAsking("save");
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
  const length = isDate(form.start_date) && isDate(form.end_date) && isTime(form.start_time) && isTime(form.end_time) ? duration(form) : null;
  const durations = (closePanel: () => void) => (
    <div className="quick-row" role="group" aria-label="Duration">
      {DURATIONS.map((m) => (
        <button
          key={m}
          type="button"
          className="quick"
          aria-pressed={m === length}
          onClick={() => {
            const end = shift(form.start_date, form.start_time, m);
            setForm((f) => ({ ...f, end_date: end.date, end_time: end.time }));
            closePanel();
          }}
        >
          {formatDuration(m)}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <Modal {...modal} onClose={done} done title={occurrence ? "Edit Event" : "New Event"}>
        <form className="form" onSubmit={onSubmit}>
          <div className="group">
            <input
              className="group__input group__input--title"
              aria-label="Title"
              placeholder="Title"
              autoFocus={!occurrence}
              maxLength={500}
              enterKeyHint="done"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
          <PickerScope>
            <div className="group">
              <label className="group__row">
                <span className="group__name">All-day</span>
                <Switch checked={form.all_day} label="All day" onChange={(v) => set("all_day", v)} />
              </label>
              <PickerRow
                label="Starts"
                picks={[
                  { kind: "date", name: "Start date", value: form.start_date, onChange: setStartDate },
                  ...(form.all_day ? [] : [{ kind: "time" as const, name: "Start time", value: form.start_time, onChange: setStartTime }]),
                ]}
              />
              <PickerRow
                label="Ends"
                picks={[
                  { kind: "date", name: "End date", value: form.end_date, onChange: (v) => set("end_date", v) },
                  ...(form.all_day
                    ? []
                    : [{ kind: "time" as const, name: "End time", value: form.end_time, onChange: (v: string) => set("end_time", v), extra: durations }]),
                ]}
              />
              <RepeatFields repeat={repeat} startDate={form.start_date} onChange={setRepeat} />
            </div>
          </PickerScope>
          <div className="group group--padded">
            <ColorPicker value={form.color} onChange={(c) => set("color", c)} />
          </div>
          <div className="group">
            <TextArea className="group__input" aria-label="Notes" placeholder="Notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          {error && (
            <div className="form__error" role="alert">
              <p>{error}</p>
              {/* Closing keeps trying to save; this is the way out without fixing the form. */}
              <button type="button" className="button--plain" onClick={close}>
                Discard changes
              </button>
            </div>
          )}
          {occurrence && (
            <div className="group">
              <button type="button" className="group__button group__button--danger" onClick={onDelete}>
                Delete Event
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
