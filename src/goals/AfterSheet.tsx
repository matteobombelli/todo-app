import { useState } from "react";
import type { Goal } from "../../shared/entities";
import { TextArea } from "../components/Fields";
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
          <section>
            <h3 className="group-label">Before</h3>
            <p className="before-quote group group--padded">{goal.before_note}</p>
          </section>
        )}
        {goal.metric_label !== null && (
          <section>
            <h3 className="group-label">
              {goal.metric_label}: started at {goal.metric_baseline}
              {unit}, aimed for {goal.metric_target}
              {unit}
            </h3>
            <div className="group">
              <label className="group__row">
                <span className="group__name">Ended at</span>
                <input
                  className="group__inline"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  autoFocus
                  aria-label={`${goal.metric_label} now`}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError(null);
                  }}
                />
              </label>
            </div>
          </section>
        )}
        <section>
          <h3 className="group-label">Where are you now?</h3>
          <div className="group">
            <TextArea
              className="group__input"
              aria-label="Where are you now?"
              rows={4}
              maxLength={2000}
              value={note}
              autoFocus={goal.metric_label === null}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <span className="group-hint">Closing the goal seals it: its score and entries can't change after this.</span>
        </section>
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
