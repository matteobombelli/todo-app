import { useState, type FormEvent } from "react";
import { addDays, daysBetween, isDate } from "../../shared/dates";
import type { PaletteKey } from "../../shared/palette";
import type { Occurrence } from "../../shared/recurrence";
import { ColorPicker } from "../components/ColorPicker";
import { RepeatFields, repeatFromRRule, repeatToRRule, type RepeatForm } from "../components/RepeatFields";
import { Checkbox } from "../components/Checkbox";
import { useConfirm } from "../components/ConfirmDialog";
import { Modal, useModal } from "../components/Modal";
import { store } from "../data/instance";
import {
  deleteEvent,
  saveEvent,
  validateEvent,
  type EventForm,
  type Scope,
} from "./eventActions";

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

/** Creates an event on `date` when `occurrence` is null, otherwise edits or deletes that occurrence. */
export function EventEditor({ occurrence, date, onClose }: { occurrence: Occurrence | null; date: string; onClose: () => void }) {
  const [form, setForm] = useState(() => initialForm(occurrence, date));
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<"save" | "delete" | null>(null);
  const seriesRule = occurrence ? (store.get("events", occurrence.event_id)?.rrule ?? null) : null;
  const [modal, close] = useModal(onClose);
  const [confirmDialog, confirm] = useConfirm();

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

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const message = validateEvent(form);
    setError(message);
    if (message) return;
    // A changed repeat rule only makes sense for the series.
    if (occurrence?.recurring && repeatToRRule(form.repeat) === seriesRule) setAsking("save");
    else void run("save", "series");
  }

  async function onDelete() {
    if (!occurrence) return;
    if (occurrence.recurring) setAsking("delete");
    else if (await confirm("Delete event?", `"${occurrence.title}" will be deleted.`, "Delete")) await run("delete", "series");
  }

  const { repeat } = form;
  return (
    <>
      <Modal {...modal} title={occurrence ? "Edit event" : "New event"}>
        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field__label">Title</span>
            <input maxLength={500} value={form.title} onChange={(e) => set("title", e.target.value)} />
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
          <div className="form__actions">
            {occurrence && (
              <button type="button" className="button--danger form__actions-start" onClick={() => void onDelete()}>
                Delete
              </button>
            )}
            <button type="button" className="button--secondary" onClick={close}>
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
      {confirmDialog}
    </>
  );
}
