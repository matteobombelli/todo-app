import { describe, expect, it } from "vitest";
import type { Item } from "../../shared/entities";
import { completeItem } from "../../shared/items";
import { nextOccurrence, parseRRule } from "../../shared/recurrence";

const next = (rule: string, from: string, after: string) => nextOccurrence(parseRRule(rule), from, after);

describe("nextOccurrence", () => {
  it("returns the first date after `after`, counting from the start", () => {
    expect(next("FREQ=DAILY", "2026-09-01", "2026-09-01")).toBe("2026-09-02");
    expect(next("FREQ=DAILY;INTERVAL=3", "2026-09-01", "2026-09-05")).toBe("2026-09-07");
    expect(next("FREQ=WEEKLY;BYDAY=MO,TH", "2026-09-07", "2026-09-07")).toBe("2026-09-10");
    expect(next("FREQ=WEEKLY;BYDAY=MO,TH", "2026-09-07", "2026-09-10")).toBe("2026-09-14");
  });

  it("skips months lacking the day, and reaches the next Feb 29", () => {
    expect(next("FREQ=MONTHLY", "2026-01-31", "2026-01-31")).toBe("2026-03-31");
    expect(next("FREQ=YEARLY", "2024-02-29", "2024-02-29")).toBe("2028-02-29");
  });

  it("ignores COUNT and stops at UNTIL", () => {
    expect(next("FREQ=DAILY;COUNT=1", "2026-09-01", "2026-09-01")).toBe("2026-09-02");
    expect(next("FREQ=DAILY;UNTIL=20260901", "2026-09-01", "2026-09-01")).toBeNull();
  });
});

function item(overrides: Partial<Item>): Item {
  return {
    id: "i1",
    list_id: "l1",
    title: "Water plants",
    notes: "",
    due_date: "2026-09-10",
    due_time: null,
    completed_at: null,
    parent_id: null,
    rrule: "FREQ=WEEKLY",
    created_at: 1,
    updated_at: 1,
    seq: 1,
    deleted_at: null,
    ...overrides,
  };
}

const today = { date: "2026-09-12", time: "08:00" };

describe("completeItem", () => {
  it("completes an item that doesn't repeat", () => {
    expect(completeItem(item({ rrule: null }), today, 99)).toMatchObject({ completed_at: 99, due_date: "2026-09-10" });
  });

  it("jumps an overdue item past today", () => {
    expect(completeItem(item({}), today)).toMatchObject({ completed_at: null, due_date: "2026-09-17" });
  });

  it("moves an item finished early to the occurrence after its due date", () => {
    expect(completeItem(item({ due_date: "2026-09-20" }), today)).toMatchObject({ due_date: "2026-09-27" });
  });

  it("keeps the time", () => {
    expect(completeItem(item({ due_time: "18:30" }), today)).toMatchObject({ due_time: "18:30", due_date: "2026-09-17" });
  });

  it("counts occurrences down and completes on the last", () => {
    const rolled = completeItem(item({ rrule: "FREQ=WEEKLY;COUNT=2" }), today);
    expect(rolled).toMatchObject({ completed_at: null, rrule: "FREQ=WEEKLY;COUNT=1" });
    expect(completeItem(rolled, today, 99)).toMatchObject({ completed_at: 99 });
  });

  it("completes when UNTIL has passed", () => {
    expect(completeItem(item({ rrule: "FREQ=WEEKLY;UNTIL=20260915" }), today, 99)).toMatchObject({ completed_at: 99 });
  });
});
