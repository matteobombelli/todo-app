import { addDays, daysBetween } from "./dates";
import { periodLength, type Goal, type GoalEntry, type GoalEntryFields, type GoalFields } from "./entities";

// Goals are scored by days of effort logged against target_days. They are meant to be hard to
// fudge, so the rules below are checked by the server on every write (worker/services/records.ts),
// and by the app to decide what it offers:
// - A goal locks LOCK_MS after it is committed: from then on only its title and colour change.
// - Effort can be logged for today or yesterday (in the user's timezone) only, inside the goal's
//   dates, once a day. An entry is sealed once its day leaves that window.
// - A committed goal can't be deleted once locked, only abandoned; the "after" opens in the goal's
//   last AFTER_OPENS_DAYS days, and recording it closes the goal for good.

export const LOCK_MS = 24 * 60 * 60 * 1000;
export const AFTER_OPENS_DAYS = 7;
export const AMOUNTS = [0, 0.5, 1] as const;

/** The fields that define what was committed to; frozen once the goal locks. */
const DEFINITION = [
  "specific",
  "achievable",
  "relevant",
  "start_date",
  "end_date",
  "target_days",
  "metric_label",
  "metric_unit",
  "metric_baseline",
  "metric_target",
  "before_note",
] as const satisfies readonly (keyof GoalFields)[];

const NEXT_STATUS: Record<GoalFields["status"], GoalFields["status"][]> = {
  draft: ["draft", "active"],
  active: ["active", "abandoned", "closed"],
  abandoned: ["abandoned"],
  closed: ["closed"],
};

export type GoalPhase = "draft" | "upcoming" | "active" | "review" | "closed" | "abandoned";

export { periodLength };

/** The days effort can be logged for: today and yesterday. */
export function logWindow(today: string): [string, string] {
  return [addDays(today, -1), today];
}

export function inLogWindow(date: string, today: string): boolean {
  const [from, to] = logWindow(today);
  return date >= from && date <= to;
}

/** Whether effort can be logged on `date` for this goal right now. */
export function canLog(goal: Pick<GoalFields, "status" | "start_date" | "end_date">, date: string, today: string): boolean {
  return goal.status === "active" && inLogWindow(date, today) && date >= goal.start_date && date <= goal.end_date;
}

export function isLocked(goal: Pick<GoalFields, "status" | "committed_at">, now: number): boolean {
  if (goal.status === "draft") return false;
  if (goal.status !== "active") return true;
  return goal.committed_at === null || now >= goal.committed_at + LOCK_MS;
}

/** When a committed goal locks, or null for a draft. */
export function locksAt(goal: Pick<GoalFields, "committed_at">): number | null {
  return goal.committed_at === null ? null : goal.committed_at + LOCK_MS;
}

export function afterOpen(goal: Pick<GoalFields, "status" | "end_date">, today: string): boolean {
  return goal.status === "active" && today >= addDays(goal.end_date, -(AFTER_OPENS_DAYS - 1));
}

export function goalPhase(goal: Pick<GoalFields, "status" | "start_date" | "end_date">, today: string): GoalPhase {
  if (goal.status !== "active") return goal.status;
  if (today < goal.start_date) return "upcoming";
  return today > goal.end_date ? "review" : "active";
}

/** Live entries that count towards a goal: its own, inside its dates. */
export function countedEntries(goal: Pick<Goal, "id" | "start_date" | "end_date">, entries: GoalEntry[]): GoalEntry[] {
  return entries.filter(
    (e) => e.goal_id === goal.id && e.deleted_at === null && e.date >= goal.start_date && e.date <= goal.end_date,
  );
}

export function daysLogged(goal: Pick<Goal, "id" | "start_date" | "end_date">, entries: GoalEntry[]): number {
  return countedEntries(goal, entries).reduce((sum, e) => sum + e.amount, 0);
}

/** Days logged over the target, as a whole percentage; past 100 when the target is beaten. */
export function scorePercent(logged: number, target: number): number {
  return Math.round((logged / target) * 100);
}

/** Days of the period gone by before today (today isn't over, so it doesn't count against you). */
export function daysElapsed(goal: Pick<GoalFields, "start_date" | "end_date">, today: string): number {
  return Math.min(Math.max(daysBetween(goal.start_date, today), 0), periodLength(goal));
}

/** Where the target says you should be by now. */
export function expectedDays(goal: Pick<GoalFields, "start_date" | "end_date" | "target_days">, today: string): number {
  return (goal.target_days * daysElapsed(goal, today)) / periodLength(goal);
}

/** Days ahead of (positive) or behind (negative) an even pace to the target. */
export function pace(logged: number, goal: Pick<GoalFields, "start_date" | "end_date" | "target_days">, today: string): number {
  return logged - expectedDays(goal, today);
}

/** The share of days the goal asks for, 0 to 1. */
export function requiredShare(goal: Pick<GoalFields, "start_date" | "end_date" | "target_days">): number {
  return goal.target_days / periodLength(goal);
}

/** Copies the server-owned fields over a client's goal: when it was committed and closed. */
export function stampGoal(prev: GoalFields | null, next: GoalFields, now: number): GoalFields {
  return {
    ...next,
    committed_at: prev?.committed_at ?? (next.status === "draft" ? null : now),
    closed_at: prev?.closed_at ?? (next.status === "closed" ? now : null),
  };
}

const same = (a: unknown, b: unknown) => a === b;

/** Why a goal can't be written as `next` (already stamped) over `prev`, or null when it can. */
export function goalProblem(prev: GoalFields | null, next: GoalFields, today: string, now: number): string | null {
  const from = prev?.status ?? "draft";
  if (!NEXT_STATUS[from].includes(next.status)) return `A goal can't go from ${from} to ${next.status}`;
  const committing = from === "draft" && next.status !== "draft";
  if (committing && next.status !== "active") return "A goal is committed before it can end";
  if (committing && next.start_date < today) return "A goal can't start before the day it's committed";

  const changed = DEFINITION.filter((k) => !same(prev?.[k] ?? null, next[k]));
  if (prev && changed.length) {
    if (isLocked(prev, now)) return `The goal is locked: ${changed.join(", ")} can't change`;
    // Moving the start back while unlocked would backdate it all the same.
    if (prev.status !== "draft" && changed.includes("start_date") && next.start_date < today) {
      return "A goal can't start before today";
    }
  }

  const closing = from === "active" && next.status === "closed";
  if (closing && !afterOpen(prev!, today)) return `The "after" opens ${AFTER_OPENS_DAYS} days before the goal ends`;
  if (closing && next.metric_label !== null && next.after_value === null) return `Record where ${next.metric_label} ended up`;
  if (!closing && (!same(prev?.after_value ?? null, next.after_value) || !same(prev?.after_note ?? null, next.after_note))) {
    return `The "after" is recorded once, when the goal is closed`;
  }
  return null;
}

/** Why a goal can't be deleted, or null when it can: only drafts and goals not yet locked. */
export function goalDeleteProblem(prev: GoalFields, now: number): string | null {
  return isLocked(prev, now) ? "A committed goal can't be deleted; abandon it instead" : null;
}

/** Why an entry can't be written as `next` over `prev`, or null when it can. */
export function entryProblem(
  goal: GoalFields,
  prev: GoalEntryFields | null,
  next: GoalEntryFields,
  today: string,
  sameDay: GoalEntryFields[],
): string | null {
  if (prev && (prev.goal_id !== next.goal_id || prev.date !== next.date)) return "An entry's goal and day can't change";
  if (goal.status !== "active") return "The goal isn't active";
  if (next.date < goal.start_date || next.date > goal.end_date) return "That day is outside the goal's dates";
  if (!inLogWindow(next.date, today)) return "Effort can only be logged for today or yesterday";
  if (sameDay.some((e) => e.id !== next.id && e.goal_id === next.goal_id && e.date === next.date)) {
    return "That day already has an entry";
  }
  return null;
}

/** Why an entry can't be deleted, or null when it can: only while its day can still be logged. */
export function entryDeleteProblem(goal: GoalFields | null, prev: GoalEntryFields, today: string): string | null {
  if (goal && goal.status !== "active") return "The goal is finished; its entries are sealed";
  return inLogWindow(prev.date, today) ? null : "That entry is sealed";
}
