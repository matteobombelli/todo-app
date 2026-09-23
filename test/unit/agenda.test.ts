import { describe, expect, it } from "vitest";
import { buildAgenda, type ExternalEvent } from "../../shared/agenda";
import type { Item } from "../../shared/entities";
import { isOverdue, orderItems } from "../../shared/items";
import type { Occurrence } from "../../shared/recurrence";

let n = 0;
function item(overrides: Partial<Item> = {}): Item {
  n++;
  return {
    id: `i${n}`,
    list_id: "l1",
    title: `Item ${n}`,
    notes: "",
    due_date: null,
    due_time: null,
    completed_at: null,
    created_at: n,
    updated_at: n,
    seq: n,
    deleted_at: null,
    ...overrides,
  };
}

function occ(overrides: Partial<Occurrence>): Occurrence {
  return {
    event_id: "e",
    occurrence_date: "2026-09-22",
    recurring: false,
    exception_id: null,
    title: "Event",
    notes: "",
    color: "blue",
    all_day: false,
    start_date: "2026-09-22",
    start_time: "10:00",
    end_date: "2026-09-22",
    end_time: "11:00",
    ...overrides,
  };
}

function std(overrides: Partial<ExternalEvent>): ExternalEvent {
  return {
    id: "std-1",
    source: "save-the-date",
    title: "Picnic",
    start_date: "2026-09-22",
    end_date: "2026-09-22",
    start_time: null,
    status: "upcoming",
    location: null,
    ...overrides,
  };
}

const NOW = { date: "2026-09-22", time: "12:00" };

describe("buildAgenda", () => {
  it("orders bars, then timed entries with items slotted in, then untimed items", () => {
    const allDay = occ({ event_id: "all", all_day: true, start_time: null, end_time: null });
    const multi = occ({ event_id: "multi", start_date: "2026-09-21", end_date: "2026-09-23" });
    const late = occ({ event_id: "late", start_time: "15:00", end_time: "16:00" });
    const early = occ({ event_id: "early", start_time: "08:00", end_time: "09:00" });
    const timedItem = item({ due_date: "2026-09-22", due_time: "09:30" });
    const sameTime = item({ due_date: "2026-09-22", due_time: "15:00" });
    const untimed = item({ due_date: "2026-09-22" });
    const done = item({ due_date: "2026-09-22", completed_at: 5 });
    const stdTimed = std({ id: "s2", start_time: "12:00" });
    const stdDay = std({ id: "s1" });

    const a = buildAgenda("2026-09-22", [late, allDay, early, multi], [stdTimed, stdDay], [untimed, sameTime, timedItem, done], NOW);

    expect(a.bars.map((b) => (b.kind === "event" ? b.occurrence.event_id : b.event.id))).toEqual(["all", "multi", "s1"]);
    expect(
      a.timed.map((t) => (t.kind === "event" ? t.occurrence.event_id : t.kind === "item" ? t.item.id : t.event.id)),
    ).toEqual(["early", timedItem.id, "s2", "late", sameTime.id]);
    expect(a.untimed.map((i) => i.id)).toEqual([untimed.id, done.id]);
  });

  it("ignores entries that do not touch the day, and deleted items", () => {
    const a = buildAgenda(
      "2026-09-22",
      [occ({ start_date: "2026-09-23", end_date: "2026-09-23" })],
      [std({ start_date: "2026-09-20", end_date: "2026-09-21" })],
      [item({ due_date: "2026-09-23" }), item({ due_date: "2026-09-22", deleted_at: 1 })],
      NOW,
    );
    expect(a).toEqual({ date: "2026-09-22", overdue: [], bars: [], timed: [], untimed: [] });
  });

  it("fills overdue only for today, with uncompleted items due earlier", () => {
    const old = item({ due_date: "2026-09-01" });
    const older = item({ due_date: "2026-08-01" });
    const doneOld = item({ due_date: "2026-09-01", completed_at: 1 });
    const today = buildAgenda("2026-09-22", [], [], [old, older, doneOld], NOW);
    expect(today.overdue.map((i) => i.id)).toEqual([older.id, old.id]);
    expect(buildAgenda("2026-09-23", [], [], [old], NOW).overdue).toEqual([]);
  });
});

describe("items", () => {
  it("isOverdue compares dates, and times on the current date", () => {
    expect(isOverdue(item({ due_date: "2026-09-21" }), NOW)).toBe(true);
    expect(isOverdue(item({ due_date: "2026-09-22" }), NOW)).toBe(false);
    expect(isOverdue(item({ due_date: "2026-09-22", due_time: "11:59" }), NOW)).toBe(true);
    expect(isOverdue(item({ due_date: "2026-09-22", due_time: "12:00" }), NOW)).toBe(false);
    expect(isOverdue(item({ due_date: "2026-09-21", completed_at: 1 }), NOW)).toBe(false);
    expect(isOverdue(item(), NOW)).toBe(false);
  });

  it("orders open items by due date and time, undated last by creation, completed apart", () => {
    const undatedNew = item();
    const undatedOld = item({ created_at: 0 });
    const dateOnly = item({ due_date: "2026-09-22" });
    const timed = item({ due_date: "2026-09-22", due_time: "08:00" });
    const overdue = item({ due_date: "2026-09-01" });
    const doneEarly = item({ completed_at: 10 });
    const doneLate = item({ completed_at: 20 });
    const deleted = item({ deleted_at: 1 });
    const { open, completed } = orderItems([undatedNew, dateOnly, doneEarly, timed, undatedOld, overdue, doneLate, deleted]);
    expect(open.map((i) => i.id)).toEqual([overdue.id, timed.id, dateOnly.id, undatedOld.id, undatedNew.id]);
    expect(completed.map((i) => i.id)).toEqual([doneLate.id, doneEarly.id]);
  });
});
