import { Lock } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { addDays } from "../../shared/dates";
import { GoalFields, type Goal } from "../../shared/entities";
import { goalProblem, periodLength, requiredShare, stampGoal } from "../../shared/goals";
import { newId } from "../../shared/ids";
import type { PaletteKey } from "../../shared/palette";
import { ColorPicker } from "../components/ColorPicker";
import { Switch, TextArea } from "../components/Fields";
import { PickerRow, PickerScope } from "../components/Pickers";
import { Modal, useModal } from "../components/Modal";
import { useGoalToday } from "../data/hooks";
import { store } from "../data/instance";

interface Form {
  title: string;
  color: PaletteKey;
  specific: string;
  achievable: string;
  relevant: string;
  start_date: string;
  end_date: string;
  target_days: string;
  metric: boolean;
  metric_label: string;
  metric_unit: string;
  metric_baseline: string;
  metric_target: string;
  before_note: string;
}

function toForm(goal: Goal | null, today: string): Form {
  return {
    title: goal?.title ?? "",
    color: goal?.color ?? "green",
    specific: goal?.specific ?? "",
    achievable: goal?.achievable ?? "",
    relevant: goal?.relevant ?? "",
    start_date: goal?.start_date ?? today,
    end_date: goal?.end_date ?? addDays(today, 29),
    target_days: goal ? String(goal.target_days) : "12",
    metric: goal ? goal.metric_label !== null : false,
    metric_label: goal?.metric_label ?? "",
    metric_unit: goal?.metric_unit ?? "",
    metric_baseline: goal?.metric_baseline?.toString() ?? "",
    metric_target: goal?.metric_target?.toString() ?? "",
    before_note: goal?.before_note ?? "",
  };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

function toFields(form: Form, base: Goal | null, id: string, status: Goal["status"]): GoalFields {
  return {
    id,
    title: form.title.trim(),
    color: form.color,
    specific: form.specific.trim(),
    achievable: form.achievable.trim(),
    relevant: form.relevant.trim(),
    start_date: form.start_date,
    end_date: form.end_date,
    target_days: Number(form.target_days),
    metric_label: form.metric ? form.metric_label.trim() || null : null,
    metric_unit: form.metric ? form.metric_unit.trim() || null : null,
    metric_baseline: form.metric ? num(form.metric_baseline) : null,
    metric_target: form.metric ? num(form.metric_target) : null,
    before_note: form.before_note.trim(),
    after_value: base?.after_value ?? null,
    after_note: base?.after_note ?? null,
    status,
    committed_at: base?.committed_at ?? null,
    closed_at: base?.closed_at ?? null,
  };
}

/** One SMART answer: its letter and question over a group of fields, with an optional hint below. */
function Letter({ letter, label, hint, children }: { letter: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="smart-field">
      <h3 className="group-label">
        <span className="smart-field__letter" aria-hidden="true">
          {letter}
        </span>
        {label}
      </h3>
      <div className="group">{children}</div>
      {hint}
    </section>
  );
}

/**
 * Creates a goal (goal null), or edits a draft or a goal still inside its grace period. Closing saves
 * a new goal or a draft as a draft; committing is its own step, "Before you start", which records the
 * starting point and locks the goal a day later.
 */
export function GoalEditor({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const today = useGoalToday();
  const [form, setForm] = useState(() => toForm(goal, today));
  const [step, setStep] = useState<"smart" | "before">("smart");
  const [error, setError] = useState<string | null>(null);
  const [id] = useState(() => goal?.id ?? newId());
  const [modal, close] = useModal(onClose);
  const committed = goal !== null && goal.status !== "draft";

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  /** The goal as it would be written, or why it can't be. */
  function build(status: Goal["status"]): GoalFields | string {
    if (!form.title.trim()) return "Give the goal a title";
    const parsed = GoalFields.safeParse(toFields(form, goal, id, status));
    if (!parsed.success) return parsed.error.issues[0].message;
    const current = goal && store.get("goals", goal.id);
    const stamped = stampGoal(current ?? null, parsed.data, Date.now());
    return goalProblem(current ?? null, stamped, today, Date.now()) ?? parsed.data;
  }

  function done() {
    const current = goal && store.get("goals", goal.id);
    if (goal && !current) return close();
    // Nothing typed for a new goal: nothing to keep.
    if (!goal && !form.title.trim()) return close();
    const fields = build(current?.status ?? "draft");
    if (typeof fields === "string") return setError(fields);
    void store.upsert("goals", fields);
    close();
  }

  function commit() {
    const fields = build("active");
    if (typeof fields === "string") return setError(fields);
    void store.upsert("goals", { ...fields, committed_at: Date.now() });
    close();
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (committed) return done();
    const fields = build("draft");
    if (typeof fields === "string") return setError(fields);
    setStep("before");
  }

  const days = periodLength(form);
  const target = Number(form.target_days);
  const share = days > 0 && target > 0 ? requiredShare({ ...form, target_days: target }) : null;

  return (
    <Modal {...modal} onClose={done} done title={goal ? (committed ? "Edit Goal" : "Edit Draft") : "New Goal"}>
      {step === "smart" ? (
        <form className="form" onSubmit={next}>
          <div className="group">
            <input
              className="group__input group__input--title"
              aria-label="Title"
              placeholder="Title, e.g. Run 3x a week"
              autoFocus={!goal}
              maxLength={200}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
            <div className="group__row group__row--block">
              <ColorPicker value={form.color} onChange={(c) => set("color", c)} />
            </div>
          </div>
          <Letter letter="S" label="Specific: what exactly will you do?">
            <TextArea className="group__input" aria-label="Specific" maxLength={2000} value={form.specific} placeholder="e.g. Run at least 3 km, three times a week" onChange={(e) => set("specific", e.target.value)} />
          </Letter>
          <Letter letter="M" label="Measurable: how will you count it?">
            <label className="group__row">
              <span className="group__name">Days of effort</span>
              <input type="number" inputMode="decimal" min={0.5} step={0.5} max={days} className="group__inline" aria-label="Days of effort" value={form.target_days} onChange={(e) => set("target_days", e.target.value)} />
            </label>
            <label className="group__row">
              <span className="group__name">Track a number too</span>
              <Switch checked={form.metric} label="And a number to move" onChange={(v) => set("metric", v)} />
            </label>
            {form.metric && (
              <>
                <label className="group__row">
                  <span className="group__name">What</span>
                  <input className="group__inline" maxLength={120} value={form.metric_label} placeholder="5k time" onChange={(e) => set("metric_label", e.target.value)} />
                </label>
                <label className="group__row">
                  <span className="group__name">Unit</span>
                  <input className="group__inline" maxLength={40} value={form.metric_unit} placeholder="min" onChange={(e) => set("metric_unit", e.target.value)} />
                </label>
                <label className="group__row">
                  <span className="group__name">Now</span>
                  <input className="group__inline" type="number" inputMode="decimal" step="any" placeholder="0" value={form.metric_baseline} onChange={(e) => set("metric_baseline", e.target.value)} />
                </label>
                <label className="group__row">
                  <span className="group__name">Target</span>
                  <input className="group__inline" type="number" inputMode="decimal" step="any" placeholder="0" value={form.metric_target} onChange={(e) => set("metric_target", e.target.value)} />
                </label>
              </>
            )}
          </Letter>
          <Letter
            letter="A"
            label="Achievable: why can you do this?"
            hint={
              share !== null && (
                <span className={`group-hint${share > 0.85 ? " group-hint--warn" : ""}`}>
                  Needs {Math.round(share * 100)}% of days, about {Math.round(share * 70) / 10} a week
                  {share > 0.85 ? ". That leaves little room for a bad week." : ""}
                </span>
              )
            }
          >
            <TextArea className="group__input" aria-label="Achievable" maxLength={2000} value={form.achievable} placeholder="e.g. Ran twice a week all summer" onChange={(e) => set("achievable", e.target.value)} />
          </Letter>
          <Letter letter="R" label="Relevant: why does it matter?">
            <TextArea className="group__input" aria-label="Relevant" maxLength={2000} value={form.relevant} placeholder="e.g. Half-marathon in the spring" onChange={(e) => set("relevant", e.target.value)} />
          </Letter>
          <Letter letter="T" label="Time-bound" hint={days > 0 && <span className="group-hint">{days} days</span>}>
            <PickerScope>
              <PickerRow
                label="Starts"
                picks={[{ kind: "date", name: "Start date", value: form.start_date, min: committed ? undefined : today, onChange: (v) => set("start_date", v) }]}
              />
              <PickerRow
                label="Ends"
                picks={[{ kind: "date", name: "End date", value: form.end_date, min: form.start_date, onChange: (v) => set("end_date", v) }]}
              />
            </PickerScope>
          </Letter>
          {committed && (
            <section>
              <h3 className="group-label">Where you started</h3>
              <div className="group">
                <TextArea className="group__input" aria-label="Where you started" rows={3} maxLength={2000} value={form.before_note} onChange={(e) => set("before_note", e.target.value)} />
              </div>
            </section>
          )}
          {error && <ErrorLine error={error} onDiscard={close} />}
          {!committed && (
            <div className="form__actions">
              <button type="submit" className="button--primary">
                Next
              </button>
            </div>
          )}
        </form>
      ) : (
        <div className="form">
          {form.metric && (
            <p className="before-metric">
              {form.metric_label}: <strong>{form.metric_baseline}{form.metric_unit && ` ${form.metric_unit}`}</strong>, aiming for{" "}
              {form.metric_target}{form.metric_unit && ` ${form.metric_unit}`}
            </p>
          )}
          <section>
            <h3 className="group-label">Where are you now?</h3>
            <div className="group">
              <TextArea
                className="group__input"
                aria-label="Where are you now?"
                autoFocus
                rows={4}
                maxLength={2000}
                value={form.before_note}
                placeholder="e.g. Out of breath by km 3. Running alone, no plan."
                onChange={(e) => set("before_note", e.target.value)}
              />
            </div>
            <span className="group-hint">Your "after" opens in the last week and sits next to this.</span>
          </section>
          <div className="commit-warning" role="note">
            <strong>
              <Lock size={15} aria-hidden="true" /> Committing locks this goal
            </strong>
            <p>
              After 24 hours the target, dates and starting point can't change. Effort can be logged for today or
              yesterday only, and a committed goal can only be abandoned, not deleted.
            </p>
          </div>
          {error && <ErrorLine error={error} onDiscard={close} />}
          <div className="form__actions">
            <button type="button" className="button--secondary form__actions-start" onClick={() => setStep("smart")}>
              Back
            </button>
            <button type="button" className="button--secondary" onClick={done}>
              Save as Draft
            </button>
            <button type="button" className="button--primary" onClick={commit}>
              Commit to {form.target_days} {target === 1 ? "day" : "days"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ErrorLine({ error, onDiscard }: { error: string; onDiscard: () => void }) {
  return (
    <div className="form__error" role="alert">
      <p>{error}</p>
      {/* Closing keeps trying to save; this is the way out without fixing the form. */}
      <button type="button" className="button--plain" onClick={onDiscard}>
        Discard changes
      </button>
    </div>
  );
}
