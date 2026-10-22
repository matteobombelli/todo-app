import { ChevronRight, Lock, Plus } from "lucide-react";
import { ShellActions } from "../Shell";
import { useState, type CSSProperties } from "react";
import { Link } from "react-router";
import type { Goal, GoalEntry } from "../../shared/entities";
import { canLog, daysLogged, expectedDays, goalPhase, isLocked, pace, scorePercent } from "../../shared/goals";
import { paletteVar } from "../components/ColorPicker";
import { setNavDirection } from "../components/motion";
import { useGoalEntries, useGoals, useGoalToday } from "../data/hooks";
import { formatRelativeDate, formatShortDate } from "../format";
import { EffortControl, formatAmount, GoalRing, PaceBar, paceLabel } from "./effort";
import { GoalEditor } from "./GoalEditor";

export function goalStyle(goal: Goal): CSSProperties {
  return { "--goal": paletteVar(goal.color) } as CSSProperties;
}

function GoalCard({ goal, entries, today }: { goal: Goal; entries: GoalEntry[]; today: string }) {
  const logged = daysLogged(goal, entries);
  const score = scorePercent(logged, goal.target_days);
  const upcoming = today < goal.start_date;
  const p = paceLabel(pace(logged, goal, today));
  return (
    <li className="goal-card" style={goalStyle(goal)}>
      <Link to={`/goals/${goal.id}`} className="goal-card__head" viewTransition onClick={() => setNavDirection("push")}>
        <GoalRing score={score} />
        <span className="goal-card__text">
          <span className="goal-card__title">{goal.title}</span>
          <span className="goal-card__meta">
            {formatAmount(logged)} of {formatAmount(goal.target_days)} days · {formatShortDate(goal.start_date, today)} – {formatShortDate(goal.end_date, today)}
          </span>
        </span>
        {isLocked(goal, Date.now()) && <Lock className="goal-card__lock" size={14} aria-label="Locked" />}
        <ChevronRight className="row__chevron" size={18} aria-hidden="true" />
      </Link>
      <PaceBar logged={logged} expected={expectedDays(goal, today)} target={goal.target_days} />
      <div className="goal-card__foot">
        {upcoming ? (
          <span className="goal-card__pace">Starts {formatRelativeDate(goal.start_date, today)}</span>
        ) : (
          <span className={`goal-card__pace goal-card__pace--${p.tone}`}>{p.text}</span>
        )}
        {canLog(goal, today, today) && <EffortControl goal={goal} date={today} entries={entries} label={`Effort today on ${goal.title}`} />}
      </div>
    </li>
  );
}

function GoalRow({ goal, meta }: { goal: Goal; meta: string }) {
  return (
    <li>
      <Link to={`/goals/${goal.id}`} className="row row--link" style={goalStyle(goal)} viewTransition onClick={() => setNavDirection("push")}>
        <span className="dot" style={{ background: paletteVar(goal.color) }} aria-hidden="true" />
        <span className="row__title">{goal.title}</span>
        <span className="row__meta">{meta}</span>
        <ChevronRight className="row__chevron" size={18} aria-hidden="true" />
      </Link>
    </li>
  );
}

export default function GoalsPage() {
  const goals = useGoals();
  const entries = useGoalEntries();
  const today = useGoalToday();
  const [creating, setCreating] = useState(false);

  const by = (...phases: string[]) => goals.filter((g) => phases.includes(goalPhase(g, today)));
  const running = by("active", "upcoming");
  const review = by("review");
  const drafts = by("draft");
  const past = by("closed", "abandoned").reverse();

  return (
    <div className="page page--goals">
      <div className="nav-bar">
        <ShellActions />
        <button type="button" className="button--plain button--icon nav-bar__end" onClick={() => setCreating(true)}>
          <Plus size={20} aria-hidden="true" />
          New Goal
        </button>
      </div>
      <h1 className="large-title">Goals</h1>
      {goals.length === 0 && (
        <p className="empty">
          Set a SMART goal, commit to a number of days of effort, and log each day you put the work in.
        </p>
      )}
      {running.length > 0 && (
        <section aria-label="Active goals">
          <ul className="goal-cards">
            {running.map((g) => (
              <GoalCard key={g.id} goal={g} entries={entries} today={today} />
            ))}
          </ul>
        </section>
      )}
      {review.length > 0 && (
        <section className="goal-section">
          <h2 className="goal-section__heading">Needs Review</h2>
          <ul className="rows rows--large">
            {review.map((g) => (
              <GoalRow key={g.id} goal={g} meta={`Ended ${formatShortDate(g.end_date, today)}`} />
            ))}
          </ul>
        </section>
      )}
      {drafts.length > 0 && (
        <section className="goal-section">
          <h2 className="goal-section__heading">Drafts</h2>
          <ul className="rows rows--large">
            {drafts.map((g) => (
              <GoalRow key={g.id} goal={g} meta="Not committed" />
            ))}
          </ul>
        </section>
      )}
      {past.length > 0 && (
        <section className="goal-section">
          <h2 className="goal-section__heading">Past</h2>
          <ul className="rows rows--large">
            {past.map((g) => {
              const score = scorePercent(daysLogged(g, entries), g.target_days);
              return <GoalRow key={g.id} goal={g} meta={g.status === "abandoned" ? `${score}% · abandoned` : `${score}%`} />;
            })}
          </ul>
        </section>
      )}
      {creating && <GoalEditor goal={null} onClose={() => setCreating(false)} />}
    </div>
  );
}
