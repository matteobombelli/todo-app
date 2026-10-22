import { useState } from "react";
import type { Goal } from "../../shared/entities";
import { Modal, useModal } from "../components/Modal";
import { store } from "../data/instance";

/** Records where the goal ended up, next to where it started, and closes it for good. */
export function AfterSheet({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const [modal, close] = useModal(onClose);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const unit = goal.metric_unit ? ` ${goal.metric_unit}` : "";

  function save() {
    const current = store.get("goals", goal.id);
    if (!current) return close();
    const after = value.trim() === "" ? null : Number(value);
    if (goal.metric_label !== null && (after === null || !Number.isFinite(after))) return setError(`Enter where ${goal.metric_label} ended up`);
    void store.upsert("goals", { ...current, status: "closed", after_value: after, after_note: note.trim(), closed_at: Date.now() });
    close();
  }

  return (
    <Modal {...modal} variant="dialog" title="Record the After">
      <div className="form">
        {goal.before_note && (
          <div className="field">
            <span className="field__label">Before</span>
            <p className="before-quote">{goal.before_note}</p>
          </div>
        )}
        {goal.metric_label !== null && (
          <label className="field">
            <span className="field__label">
              {goal.metric_label}: started at {goal.metric_baseline}
              {unit}, aimed for {goal.metric_target}
              {unit}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
          </label>
        )}
        <label className="field">
          <span className="field__label">Where are you now?</span>
          <textarea rows={4} maxLength={2000} value={note} autoFocus={goal.metric_label === null} onChange={(e) => setNote(e.target.value)} />
          <span className="field__hint">Closing the goal seals it: its score and entries can't change after this.</span>
        </label>
        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          <button type="button" className="button--secondary" onClick={close}>
            Cancel
          </button>
          <button type="button" className="button--primary" onClick={save}>
            Close Goal
          </button>
        </div>
      </div>
    </Modal>
  );
}
