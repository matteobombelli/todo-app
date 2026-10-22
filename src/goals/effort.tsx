import type { CSSProperties } from "react";
import type { Goal, GoalEntry } from "../../shared/entities";
import { AMOUNTS } from "../../shared/goals";
import { newId } from "../../shared/ids";
import { haptic } from "../components/motion";
import { store } from "../data/instance";

export function formatAmount(amount: number): string {
  if (amount === 0) return "0";
  const whole = Math.floor(amount);
  const half = amount - whole === 0.5 ? "½" : "";
  return whole === 0 ? half : `${whole}${half}`;
}

export function formatDays(amount: number): string {
  return `${formatAmount(amount)} day${amount > 0 && amount <= 1 ? "" : "s"}`;
}

export function entryOn(entries: GoalEntry[], goalId: string, date: string): GoalEntry | undefined {
  return entries.find((e) => e.goal_id === goalId && e.date === date && e.deleted_at === null);
}

/** Sets a day's effort on a goal; 0 removes the day's entry. The server checks the day may be logged. */
export function logEffort(goal: Goal, date: string, amount: number, entries: GoalEntry[]): void {
  const existing = entryOn(entries, goal.id, date);
  if (amount === 0) {
    if (existing) void store.remove("goal_entries", existing.id);
    return;
  }
  if (existing?.amount === amount) return;
  void store.upsert("goal_entries", { id: existing?.id ?? newId(), goal_id: goal.id, date, amount: amount as 0.5 | 1, note: existing?.note ?? "" });
}

/** 0 / ½ / 1 for one day of one goal: a misclick goes back to 0 while the day can still be logged. */
export function EffortControl({ goal, date, entries, label }: { goal: Goal; date: string; entries: GoalEntry[]; label: string }) {
  const value = entryOn(entries, goal.id, date)?.amount ?? 0;
  return (
    <div
      className="segmented effort"
      role="radiogroup"
      aria-label={label}
      style={{ "--count": AMOUNTS.length, "--index": AMOUNTS.indexOf(value as (typeof AMOUNTS)[number]) } as CSSProperties}
    >
      {AMOUNTS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={a === value}
          aria-label={a === 0 ? "None" : a === 1 ? "Full day" : "Half day"}
          onClick={() => {
            if (a !== value) haptic();
            logEffort(goal, date, a, entries);
          }}
        >
          {formatAmount(a)}
        </button>
      ))}
    </div>
  );
}

/** Days logged against the target as a ring, with the score inside. Past 100% it stays full. */
export function GoalRing({ score, size = 48 }: { score: number; size?: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg className="goal-ring" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle className="goal-ring__track" cx="24" cy="24" r={r} />
      <circle
        className="goal-ring__fill"
        cx="24"
        cy="24"
        r={r}
        strokeDasharray={`${(Math.min(score, 100) / 100) * c} ${c}`}
        transform="rotate(-90 24 24)"
      />
      <text x="24" y="28" textAnchor="middle" className="goal-ring__text">
        {score}%
      </text>
    </svg>
  );
}

/** Logged so far against the target, with a tick where an even pace would be today. */
export function PaceBar({ logged, expected, target }: { logged: number; expected: number; target: number }) {
  return (
    <div className="pace-bar" aria-hidden="true">
      <div className="pace-bar__fill" style={{ width: `${Math.min(logged / target, 1) * 100}%` }} />
      <div className="pace-bar__tick" style={{ left: `${Math.min(expected / target, 1) * 100}%` }} />
    </div>
  );
}

export function paceLabel(pace: number): { text: string; tone: "ahead" | "behind" | "even" } {
  const days = Math.round(Math.abs(pace) * 10) / 10;
  if (days < 0.1) return { text: "On pace", tone: "even" };
  const n = `${days} day${days === 1 ? "" : "s"}`;
  return pace > 0 ? { text: `${n} ahead of pace`, tone: "ahead" } : { text: `${n} behind pace`, tone: "behind" };
}
