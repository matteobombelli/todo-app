import { describe, expect, it } from "vitest";
import { buildAgenda } from "../../shared/agenda";
import type { Goal, GoalEntry, GoalFields } from "../../shared/entities";
import {
  canLog,
  daysLogged,
  entryDeleteProblem,
  entryProblem,
  expectedDays,
  goalDeleteProblem,
  goalPhase,
  goalProblem,
  isLocked,
  LOCK_MS,
  pace,
  scorePercent,
  stampGoal,
} from "../../shared/goals";

const meta = { created_at: 0, updated_at: 0, seq: 0, deleted_at: null };
const NOW = 1_000_000_000_000;

const goal = (patch: Partial<GoalFields> = {}): Goal => ({
  id: "g1",
  title: "Run",
  color: "green",
  specific: "Run 3 km",
  achievable: "",
  relevant: "",
  start_date: "2026-10-01",
  end_date: "2026-10-30",
  target_days: 12,
  metric_label: null,
  metric_unit: null,
  metric_baseline: null,
  metric_target: null,
  before_note: "",
  after_value: null,
  after_note: null,
  status: "active",
  committed_at: NOW - 2 * LOCK_MS,
  closed_at: null,
  ...meta,
  ...patch,
});

const entry = (date: string, amount: 0.5 | 1, patch: Partial<GoalEntry> = {}): GoalEntry => ({
  id: `e-${date}`,
  goal_id: "g1",
  date,
  amount,
  note: "",
  ...meta,
  ...patch,
});

describe("scoring", () => {
  const entries = [entry("2026-10-02", 1), entry("2026-10-03", 0.5), entry("2026-09-30", 1), entry("2026-10-04", 1, { goal_id: "other" })];

  it("counts the goal's own entries inside its dates", () => {
    expect(daysLogged(goal(), entries)).toBe(1.5);
  });

  it("scores past 100%", () => {
    expect(scorePercent(15, 12)).toBe(125);
    expect(scorePercent(1.5, 12)).toBe(13);
  });

  it("expects an even pace through yesterday", () => {
    // 30 days, 12 target: 0.4 a day; 10 days gone by on the 11th.
    expect(expectedDays(goal(), "2026-10-11")).toBeCloseTo(4);
    expect(pace(5, goal(), "2026-10-11")).toBeCloseTo(1);
    expect(expectedDays(goal(), "2026-09-20")).toBe(0);
    expect(expectedDays(goal(), "2026-12-01")).toBe(12);
  });

  it("names the phase", () => {
    expect(goalPhase(goal({ status: "draft" }), "2026-10-05")).toBe("draft");
    expect(goalPhase(goal(), "2026-09-28")).toBe("upcoming");
    expect(goalPhase(goal(), "2026-10-05")).toBe("active");
    expect(goalPhase(goal(), "2026-10-31")).toBe("review");
    expect(goalPhase(goal({ status: "closed" }), "2026-10-31")).toBe("closed");
  });
});

describe("logging window", () => {
  it("allows today and yesterday inside the goal's dates", () => {
    expect(canLog(goal(), "2026-10-10", "2026-10-10")).toBe(true);
    expect(canLog(goal(), "2026-10-09", "2026-10-10")).toBe(true);
    expect(canLog(goal(), "2026-10-08", "2026-10-10")).toBe(false);
    expect(canLog(goal(), "2026-10-11", "2026-10-10")).toBe(false);
    expect(canLog(goal(), "2026-10-30", "2026-10-31")).toBe(true);
    expect(canLog(goal(), "2026-10-31", "2026-10-31")).toBe(false);
    expect(canLog(goal({ status: "abandoned" }), "2026-10-10", "2026-10-10")).toBe(false);
  });

  it("rejects backfilled, future, duplicate and moved entries", () => {
    const g = goal();
    expect(entryProblem(g, null, entry("2026-10-10", 1), "2026-10-10", [])).toBeNull();
    expect(entryProblem(g, null, entry("2026-10-07", 1), "2026-10-10", [])).toMatch(/today or yesterday/);
    expect(entryProblem(g, null, entry("2026-10-11", 1), "2026-10-10", [])).toMatch(/today or yesterday/);
    expect(entryProblem(g, null, entry("2026-10-10", 1, { id: "new" }), "2026-10-10", [entry("2026-10-10", 0.5)])).toMatch(/already/);
    expect(entryProblem(g, entry("2026-10-09", 1), entry("2026-10-10", 1, { id: "e-2026-10-09" }), "2026-10-10", [])).toMatch(/can't change/);
    expect(entryProblem(goal({ status: "closed" }), null, entry("2026-10-10", 1), "2026-10-10", [])).toMatch(/isn't active/);
  });

  it("seals entries once their day has passed the window", () => {
    expect(entryDeleteProblem(goal(), entry("2026-10-09", 1), "2026-10-10")).toBeNull();
    expect(entryDeleteProblem(goal(), entry("2026-10-08", 1), "2026-10-10")).toMatch(/sealed/);
    expect(entryDeleteProblem(goal({ status: "closed" }), entry("2026-10-10", 1), "2026-10-10")).toMatch(/sealed/);
  });
});

describe("goal rules", () => {
  const draft = goal({ status: "draft", committed_at: null, start_date: "2026-10-10" });

  it("stamps committed_at and closed_at on the server's clock", () => {
    expect(stampGoal(draft, { ...draft, status: "active", committed_at: 5 }, NOW).committed_at).toBe(NOW);
    expect(stampGoal(null, { ...draft, committed_at: 5 }, NOW).committed_at).toBeNull();
    const active = goal();
    expect(stampGoal(active, { ...active, committed_at: NOW }, NOW + 1).committed_at).toBe(active.committed_at);
  });

  it("commits only forwards in time", () => {
    const commit = (start: string) => stampGoal(draft, { ...draft, start_date: start, status: "active" }, NOW);
    expect(goalProblem(draft, commit("2026-10-10"), "2026-10-10", NOW)).toBeNull();
    expect(goalProblem(draft, commit("2026-10-09"), "2026-10-10", NOW)).toMatch(/before the day/);
  });

  it("allows edits for a day after committing, then locks", () => {
    const fresh = goal({ committed_at: NOW - 1000, start_date: "2026-10-10" });
    expect(isLocked(fresh, NOW)).toBe(false);
    expect(goalProblem(fresh, { ...fresh, target_days: 20 }, "2026-10-10", NOW)).toBeNull();
    expect(goalProblem(fresh, { ...fresh, start_date: "2026-10-01" }, "2026-10-10", NOW)).toMatch(/before today/);
    const locked = goal();
    expect(goalProblem(locked, { ...locked, target_days: 6 }, "2026-10-10", NOW)).toMatch(/locked: target_days/);
    expect(goalProblem(locked, { ...locked, end_date: "2026-11-30" }, "2026-10-10", NOW)).toMatch(/locked/);
    expect(goalProblem(locked, { ...locked, title: "Run more", color: "teal" }, "2026-10-10", NOW)).toBeNull();
  });

  it("never goes back to draft or reopens", () => {
    expect(goalProblem(goal(), { ...goal(), status: "draft" }, "2026-10-10", NOW)).toMatch(/can't go/);
    const abandoned = goal({ status: "abandoned" });
    expect(goalProblem(abandoned, { ...abandoned, status: "active" }, "2026-10-10", NOW)).toMatch(/can't go/);
  });

  it("records the after only in the last week, and only by closing", () => {
    const g = goal({ metric_label: "5k", metric_baseline: 31, metric_target: 27 });
    const close = { ...g, status: "closed" as const, after_value: 28 };
    expect(goalProblem(g, close, "2026-10-20", NOW)).toMatch(/opens/);
    expect(goalProblem(g, close, "2026-10-24", NOW)).toBeNull();
    expect(goalProblem(g, { ...close, after_value: null }, "2026-10-24", NOW)).toMatch(/5k/);
    expect(goalProblem(g, { ...g, after_note: "early" }, "2026-10-24", NOW)).toMatch(/once/);
  });

  it("deletes only drafts and goals inside their grace period", () => {
    expect(goalDeleteProblem(goal({ status: "draft", committed_at: null }), NOW)).toBeNull();
    expect(goalDeleteProblem(goal({ committed_at: NOW - 1000 }), NOW)).toBeNull();
    expect(goalDeleteProblem(goal(), NOW)).toMatch(/abandon/);
    expect(goalDeleteProblem(goal({ status: "closed" }), NOW)).toMatch(/abandon/);
  });
});

describe("agenda", () => {
  it("lists committed goals running on the day with that day's entry", () => {
    const goals = [goal(), goal({ id: "g2", title: "Draft", status: "draft" }), goal({ id: "g3", title: "Later", start_date: "2026-11-01", end_date: "2026-11-30" })];
    const a = buildAgenda("2026-10-10", [], [], [], { date: "2026-10-10", time: "12:00" }, goals, [entry("2026-10-10", 0.5)]);
    expect(a.goals.map((g) => [g.goal.id, g.entry?.amount ?? 0])).toEqual([["g1", 0.5]]);
  });
});
