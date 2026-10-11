import { describe, expect, it } from "vitest";
import { buildAgenda, type ExternalEvent } from "../../shared/agenda";
import type { Item } from "../../shared/entities";
import { cascadeToSubtasks, isOverdue, orderItems, positionAfter, reorderPosition } from "../../shared/items";
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
    parent_id: null,
    rrule: null,
    position: null,
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
    end_time: null,
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
    expect(open.map(({ item }) => item.id)).toEqual([overdue.id, timed.id, dateOnly.id, undatedOld.id, undatedNew.id]);
    expect(completed.map((i) => i.id)).toEqual([doneLate.id, doneEarly.id]);
  });

  it("puts open subtasks under their parent, and a subtask whose parent is done on its own", () => {
    const first = item({ due_date: "2026-09-01" });
    const second = item();
    const late = item({ parent_id: first.id, due_date: "2026-09-30" });
    const early = item({ parent_id: first.id, due_date: "2026-09-02" });
    const doneParent = item({ completed_at: 5 });
    const stranded = item({ parent_id: doneParent.id });
    const { open } = orderItems([second, late, stranded, first, doneParent, early]);
    expect(open.map(({ item, nested }) => [item.id, nested])).toEqual([
      [first.id, false],
      [early.id, true],
      [late.id, true],
      [second.id, false],
      [stranded.id, false],
    ]);
  });
});

describe("positionAfter", () => {
  it("places a new item straight below the anchor among items due at the same slot, subtasks included", () => {
    const parent = item();
    const a = item({ parent_id: parent.id });
    const b = item({ parent_id: parent.id });
    const c = item({ parent_id: parent.id });
    const undated = { due_date: null, due_time: null };
    const afterA = item({ parent_id: parent.id, position: positionAfter(a, undated, [parent, a, b, c]), created_at: 100 });
    const afterThat = item({ parent_id: parent.id, position: positionAfter(afterA, undated, [parent, a, b, c, afterA]), created_at: 101 });
    const { open } = orderItems([parent, c, afterThat, b, afterA, a]);
    expect(open.map(({ item }) => item.id)).toEqual([parent.id, a.id, afterA.id, afterThat.id, b.id, c.id]);
  });

  it("leaves the order to created_at when the anchor is last or due at another slot", () => {
    const last = item();
    expect(positionAfter(last, { due_date: null, due_time: null }, [item({ created_at: 0 }), last])).toBeNull();
    expect(positionAfter(item({ due_date: "2026-09-01", due_time: "09:00" }), { due_date: "2026-09-01", due_time: null }, [])).toBeNull();
  });
});

describe("reorderPosition", () => {
  // Moves `id` to `gap` and returns the new display order, or null when the move is refused.
  function move(items: Item[], id: string, gap: number): string[] | null {
    const { open } = orderItems(items);
    const position = reorderPosition(open, id, gap);
    if (position === null) return null;
    return orderItems(items.map((i) => (i.id === id ? { ...i, position } : i))).open.map(({ item }) => item.id);
  }

  it("moves an undated item to the top, between two others and to the bottom", () => {
    const [a, b, c, d] = [item(), item(), item(), item()];
    const all = [a, b, c, d];
    expect(move(all, c.id, 0)).toEqual([c.id, a.id, b.id, d.id]);
    expect(move(all, a.id, 2)).toEqual([b.id, a.id, c.id, d.id]);
    expect(move(all, a.id, 4)).toEqual([b.id, c.id, d.id, a.id]);
  });

  it("refuses the gaps where the item already is", () => {
    const [a, b, c] = [item(), item(), item()];
    expect(move([a, b, c], b.id, 1)).toBeNull();
    expect(move([a, b, c], b.id, 2)).toBeNull();
  });

  it("moves among items due at the same date and time, but not into another slot", () => {
    const early = item({ due_date: "2026-09-01" });
    const [x, y] = [item({ due_date: "2026-09-02" }), item({ due_date: "2026-09-02" })];
    const timed = item({ due_date: "2026-09-02", due_time: "08:00" });
    const undated = item();
    const all = [early, x, y, timed, undated];
    // Order: early, timed, x, y, undated.
    expect(move(all, y.id, 2)).toEqual([early.id, timed.id, y.id, x.id, undated.id]);
    expect(move(all, y.id, 0)).toBeNull();
    expect(move(all, undated.id, 2)).toBeNull();
    expect(move(all, x.id, 5)).toBeNull();
  });

  it("keeps a parent's subtasks with it, and never drops an item inside another's subtasks", () => {
    const parent = item();
    const [s1, s2] = [item({ parent_id: parent.id }), item({ parent_id: parent.id })];
    const other = item();
    const all = [parent, s1, s2, other];
    // Order: parent, s1, s2, other.
    expect(move(all, other.id, 0)).toEqual([other.id, parent.id, s1.id, s2.id]);
    expect(move(all, parent.id, 4)).toEqual([other.id, parent.id, s1.id, s2.id]);
    expect(move(all, other.id, 1)).toBeNull();
    expect(move(all, other.id, 2)).toBeNull();
  });

  it("reorders a subtask within its parent only", () => {
    const parent = item();
    const [s1, s2, s3] = [item({ parent_id: parent.id }), item({ parent_id: parent.id }), item({ parent_id: parent.id })];
    const other = item();
    const all = [parent, s1, s2, s3, other];
    expect(move(all, s3.id, 1)).toEqual([parent.id, s3.id, s1.id, s2.id, other.id]);
    expect(move(all, s1.id, 4)).toEqual([parent.id, s2.id, s3.id, s1.id, other.id]);
    expect(move(all, s1.id, 0)).toBeNull();
    expect(move(all, s1.id, 5)).toBeNull();
  });

  it("orders placed items against unplaced ones by created_at", () => {
    const a = item({ created_at: 1000 });
    const b = item({ created_at: 2000, position: 500 });
    const c = item({ created_at: 3000 });
    // Order: b (500), a (1000), c (3000).
    expect(move([a, b, c], c.id, 1)).toEqual([b.id, c.id, a.id]);
  });
});

describe("cascadeToSubtasks", () => {
  const sub = (completed_at: number | null) => ({ id: `s${completed_at}`, list_id: "l1", completed_at });

  it("moves subtasks with their parent and completes the open ones with it", () => {
    const subs = [sub(null), sub(3)];
    expect(cascadeToSubtasks({ list_id: "l1", completed_at: null }, { list_id: "l2", completed_at: null }, subs)).toEqual([
      { id: "snull", list_id: "l2", completed_at: null },
      { id: "s3", list_id: "l2", completed_at: 3 },
    ]);
    expect(cascadeToSubtasks({ list_id: "l1", completed_at: null }, { list_id: "l1", completed_at: 9 }, subs)).toEqual([
      { id: "snull", list_id: "l1", completed_at: 9 },
    ]);
  });

  it("leaves subtasks alone when the parent is reopened or only edited", () => {
    const subs = [sub(null), sub(3)];
    expect(cascadeToSubtasks({ list_id: "l1", completed_at: 9 }, { list_id: "l1", completed_at: null }, subs)).toEqual([]);
    expect(cascadeToSubtasks({ list_id: "l1", completed_at: null }, { list_id: "l1", completed_at: null }, subs)).toEqual([]);
    expect(cascadeToSubtasks(null, { list_id: "l1", completed_at: 9 }, subs)).toEqual([]);
  });
});
