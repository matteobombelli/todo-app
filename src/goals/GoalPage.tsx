import { ChevronLeft, Ellipsis, Flag, Lock, Pencil, Trash2, X } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { addDays, addMonths, daysBetween, daysInMonth, makeDate, weekday } from "../../shared/dates";
import type { Goal, GoalEntry } from "../../shared/entities";
import {
  afterOpen,
  canLog,
  countedEntries,
  daysLogged,
  expectedDays,
  goalPhase,
  inLogWindow,
  isLocked,
  locksAt,
  pace,
  periodLength,
  scorePercent,
} from "../../shared/goals";
import { useConfirm } from "../components/ConfirmDialog";
import { IconButton } from "../components/IconButton";
import { useMenu, type MenuEntry } from "../components/Menu";
import { removeWithUndo } from "../components/UndoToast";
import { useData, useGoalEntries, useGoalToday } from "../data/hooks";
import { store } from "../data/instance";
import { formatMonthYear, formatRelativeDate } from "../format";
import { AfterSheet } from "./AfterSheet";
import { EffortControl, entryOn, formatAmount, formatDays, GoalRing, PaceBar, paceLabel } from "./effort";
import { GoalEditor } from "./GoalEditor";
import { goalStyle } from "./GoalsPage";

export default function GoalPage() {
  const { goalId } = useParams();
  const { tables, settled } = useData();
  if (!goalId || !tables.goals[goalId]) return settled ? <Navigate to="/goals" replace /> : null;
  return <GoalView key={goalId} goal={tables.goals[goalId]} />;
}

function formatValue(value: number | null, unit: string | null): string {
  return value === null ? "–" : `${value}${unit ? ` ${unit}` : ""}`;
}

function lockLine(goal: Goal, today: string, now: number): string {
  const phase = goalPhase(goal, today);
  if (phase === "draft") return "Draft · not committed yet";
  if (phase === "abandoned") return "Abandoned";
  if (phase === "closed") return `Closed ${goal.closed_at ? formatRelativeDate(new Date(goal.closed_at).toISOString().slice(0, 10), today) : ""}`;
  const lock = locksAt(goal);
  const grace = lock !== null && now < lock ? ` · editable for ${Math.ceil((lock - now) / 3_600_000)} more h` : "";
  if (phase === "upcoming") return `Committed · starts ${formatRelativeDate(goal.start_date, today)}${grace}`;
  if (phase === "review") return `Ended ${formatRelativeDate(goal.end_date, today)} · record where you ended up`;
  return `Day ${daysBetween(goal.start_date, today) + 1} of ${periodLength(goal)}${grace}`;
}

function GoalView({ goal }: { goal: Goal }) {
  const all = useGoalEntries();
  const today = useGoalToday();
  const navigate = useNavigate();
  const [menu, showMenu] = useMenu();
  const [confirmDialog, confirm] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const now = Date.now();
  const entries = useMemo(() => countedEntries(goal, all).sort((a, b) => b.date.localeCompare(a.date)), [goal, all]);
  const phase = goalPhase(goal, today);
  const locked = isLocked(goal, now);
  const logged = daysLogged(goal, all);
  const score = scorePercent(logged, goal.target_days);
  const p = pace(logged, goal, today);
  const draft = goal.status === "draft";

  async function abandon() {
    if (!(await confirm("Abandon Goal?", `"${goal.title}" stays in Past with its score of ${score}%. This can't be undone.`, "Abandon"))) return;
    const current = store.get("goals", goal.id);
    if (current) void store.upsert("goals", { ...current, status: "abandoned" });
  }

  const onMenu = (e: MouseEvent) => {
    const entries: MenuEntry[] = [];
    if (!locked) entries.push({ label: draft ? "Edit Draft" : "Edit Goal", icon: Pencil, onSelect: () => setEditing(true) });
    if (afterOpen(goal, today)) entries.push({ label: "Record the After", icon: Flag, onSelect: () => setClosing(true) });
    if (goal.status === "active") entries.push("separator", { label: "Abandon Goal", icon: X, destructive: true, onSelect: () => void abandon() });
    if (!locked) {
      entries.push("separator", {
        label: draft ? "Delete Draft" : "Delete Goal",
        icon: Trash2,
        destructive: true,
        onSelect: () => {
          navigate("/goals", { replace: true });
          removeWithUndo("goals", goal.id, `Deleted "${goal.title}"`);
        },
      });
    }
    if (entries.length) showMenu(e, entries);
  };

  return (
    <div className="page page--goal" style={goalStyle(goal)}>
      <div className="nav-bar">
        <IconButton icon={ChevronLeft} label="All goals" to="/goals" nav="pop" className="page__back" />
        <IconButton icon={Ellipsis} label="Goal actions" ariaHasPopup="menu" className="nav-bar__end" onClick={onMenu} />
      </div>
      <h1 className="large-title goal-title" onContextMenu={onMenu}>
        {goal.title}
      </h1>
      <p className="goal-status">
        {locked && <Lock size={13} aria-hidden="true" />}
        {lockLine(goal, today, now)}
      </p>

      {draft ? (
        <div className="goal-draft">
          <p className="muted">Commit to this goal to start tracking it. Until then you can change anything.</p>
          <button type="button" className="button--primary" onClick={() => setEditing(true)}>
            Review and Commit
          </button>
        </div>
      ) : (
        <>
          <div className="goal-stats">
            <GoalRing score={score} size={64} />
            <div className="goal-stat">
              <span className="goal-stat__label">Days</span>
              <span className="goal-stat__value">
                {formatAmount(logged)}
                <small>/{formatAmount(goal.target_days)}</small>
              </span>
            </div>
            <div className="goal-stat">
              <span className="goal-stat__label">Pace</span>
              <span className={`goal-stat__value goal-stat__value--${paceLabel(p).tone}`}>
                {p >= 0 ? "+" : "−"}
                {Math.round(Math.abs(p) * 10) / 10}
              </span>
            </div>
          </div>
          <PaceBar logged={logged} expected={expectedDays(goal, today)} target={goal.target_days} />

          {phase === "review" && (
            <button type="button" className="button--primary goal-after-button" onClick={() => setClosing(true)}>
              Record the After
            </button>
          )}

          {goal.status === "active" && (canLog(goal, today, today) || canLog(goal, addDays(today, -1), today)) && (
            <section className="goal-section" aria-label="Log effort">
              <h2 className="goal-section__heading">Log</h2>
              <ul className="rows">
                {[today, addDays(today, -1)]
                  .filter((d) => canLog(goal, d, today))
                  .map((d) => (
                    <LogRow key={d} goal={goal} date={d} today={today} entries={all} />
                  ))}
              </ul>
            </section>
          )}

          <Heatmap goal={goal} entries={entries} today={today} />
        </>
      )}

      <BeforeAfter goal={goal} today={today} />

      <section className="goal-section">
        <h2 className="goal-section__heading">SMART</h2>
        <dl className="details smart-details">
          <dt>Specific</dt>
          <dd>{goal.specific || "–"}</dd>
          <dt>Measurable</dt>
          <dd>
            {formatDays(goal.target_days)} of effort
            {goal.metric_label !== null &&
              `; ${goal.metric_label} from ${formatValue(goal.metric_baseline, goal.metric_unit)} to ${formatValue(goal.metric_target, goal.metric_unit)}`}
          </dd>
          <dt>Achievable</dt>
          <dd>{goal.achievable || "–"}</dd>
          <dt>Relevant</dt>
          <dd>{goal.relevant || "–"}</dd>
          <dt>Time-bound</dt>
          <dd>
            {formatRelativeDate(goal.start_date, today)} to {formatRelativeDate(goal.end_date, today)} ({periodLength(goal)} days)
          </dd>
        </dl>
      </section>

      {!draft && entries.length > 0 && (
        <section className="goal-section">
          <h2 className="goal-section__heading">History</h2>
          <ul className="rows goal-history">
            {entries.map((e) => (
              <li key={e.id} className="row">
                <span className="row__title">
                  {formatRelativeDate(e.date, today)} · {formatDays(e.amount)}
                  {e.note && <span className="goal-history__note"> “{e.note}”</span>}
                </span>
                {!(goal.status === "active" && inLogWindow(e.date, today)) && <Lock size={13} className="row__meta" aria-label="Sealed" />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && <GoalEditor goal={goal} onClose={() => setEditing(false)} />}
      {closing && <AfterSheet goal={goal} onClose={() => setClosing(false)} />}
      {menu}
      {confirmDialog}
    </div>
  );
}

/** One day that can still be logged: its effort, and a note once there's an entry. */
function LogRow({ goal, date, today, entries }: { goal: Goal; date: string; today: string; entries: GoalEntry[] }) {
  const entry = entryOn(entries, goal.id, date);
  const [note, setNote] = useState(entry?.note ?? "");
  const saveNote = () => {
    const current = entry && store.get("goal_entries", entry.id);
    if (current && current.note !== note.trim()) void store.upsert("goal_entries", { ...current, note: note.trim() });
  };
  const label = formatRelativeDate(date, today);
  return (
    <li className="log-row">
      <div className="log-row__main">
        <span className="row__title">{label}</span>
        <EffortControl goal={goal} date={date} entries={entries} label={`Effort ${label.toLowerCase()}`} />
      </div>
      {entry && (
        <input
          className="log-row__note"
          maxLength={500}
          value={note}
          placeholder="What did you do?"
          aria-label={`Note for ${label.toLowerCase()}`}
          enterKeyHint="done"
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      )}
    </li>
  );
}

/** Every day of the goal's period, month by month: full days solid, half days light. */
function Heatmap({ goal, entries, today }: { goal: Goal; entries: GoalEntry[]; today: string }) {
  const byDate = new Map(entries.map((e) => [e.date, e.amount]));
  const months: string[] = [];
  for (let m = goal.start_date.slice(0, 7) + "-01"; m <= goal.end_date; m = addMonths(m, 1)) months.push(m);
  return (
    <section className="goal-section" aria-label="Effort by day">
      <div className="heatmap">
        {months.map((first) => {
          const [y, mo] = first.split("-").map(Number);
          const lead = (weekday(first) + 1) % 7;
          return (
            <div key={first} className="heatmap__month">
              <span className="heatmap__name">{formatMonthYear(first)}</span>
              <div className="heatmap__grid">
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`lead${i}`} />
                ))}
                {Array.from({ length: daysInMonth(y, mo) }, (_, i) => {
                  const date = makeDate(y, mo, i + 1);
                  const amount = byDate.get(date) ?? 0;
                  const inside = date >= goal.start_date && date <= goal.end_date;
                  const state = !inside ? "out" : amount === 1 ? "full" : amount === 0.5 ? "half" : date > today ? "future" : "none";
                  return (
                    <span
                      key={date}
                      className={`heatmap__day heatmap__day--${state}${date === today ? " heatmap__day--today" : ""}`}
                      title={inside ? `${formatRelativeDate(date, today)}: ${formatDays(amount)}` : undefined}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="heatmap__legend" aria-hidden="true">
        <span>
          <i className="heatmap__day heatmap__day--full" /> Full day
        </span>
        <span>
          <i className="heatmap__day heatmap__day--half" /> Half day
        </span>
        <span>
          <i className="heatmap__day heatmap__day--none" /> None
        </span>
      </div>
    </section>
  );
}

function BeforeAfter({ goal, today }: { goal: Goal; today: string }) {
  if (!goal.before_note && goal.metric_label === null) return null;
  const closed = goal.status === "closed";
  const opens = addDays(goal.end_date, -6);
  return (
    <section className="goal-section">
      <div className="before-after">
        <div className="before-after__side">
          <span className="before-after__label">Before</span>
          {goal.metric_label !== null && <span className="before-after__value">{formatValue(goal.metric_baseline, goal.metric_unit)}</span>}
          {goal.before_note && <p className="before-quote">{goal.before_note}</p>}
        </div>
        <div className="before-after__side">
          <span className="before-after__label">{closed ? "After" : "After · target"}</span>
          {goal.metric_label !== null && (
            <span className="before-after__value">{formatValue(closed ? goal.after_value : goal.metric_target, goal.metric_unit)}</span>
          )}
          {closed ? (
            goal.after_note && <p className="before-quote">{goal.after_note}</p>
          ) : (
            goal.status === "active" &&
            today < opens && <p className="muted">Opens {formatRelativeDate(opens, today)}</p>
          )}
        </div>
      </div>
    </section>
  );
}
