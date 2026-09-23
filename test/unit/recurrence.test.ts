import { describe, expect, it } from "vitest";
import {
  expandOccurrences,
  parseRRule,
  ruleDates,
  serializeRRule,
  shiftRRule,
  type OccurrenceException,
  type RecurringEvent,
} from "../../shared/recurrence";

function event(overrides: Partial<RecurringEvent> = {}): RecurringEvent {
  return {
    id: "e1",
    title: "Standup",
    notes: "",
    color: "blue",
    all_day: false,
    start_date: "2026-09-01",
    start_time: "09:00",
    end_date: "2026-09-01",
    end_time: "09:30",
    rrule: null,
    ...overrides,
  };
}

function exception(overrides: Partial<OccurrenceException>): OccurrenceException {
  return {
    id: "x1",
    event_id: "e1",
    occurrence_date: "2026-09-01",
    cancelled: false,
    title: null,
    notes: null,
    color: null,
    all_day: null,
    start_date: null,
    start_time: null,
    end_date: null,
    end_time: null,
    deleted_at: null,
    ...overrides,
  };
}

const dates = (occ: { start_date: string }[]) => occ.map((o) => o.start_date);

describe("parseRRule / serializeRRule", () => {
  it("round-trips the supported subset", () => {
    for (const s of [
      "FREQ=DAILY",
      "FREQ=DAILY;INTERVAL=3;COUNT=10",
      "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231",
      "FREQ=MONTHLY;INTERVAL=2",
      "FREQ=YEARLY;COUNT=5",
    ]) {
      expect(serializeRRule(parseRRule(s))).toBe(s);
    }
  });

  it("normalises BYDAY order and drops INTERVAL=1", () => {
    expect(serializeRRule(parseRRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=FR,MO"))).toBe("FREQ=WEEKLY;BYDAY=MO,FR");
  });

  it("rejects what it does not support", () => {
    for (const s of [
      "",
      "INTERVAL=2",
      "FREQ=HOURLY",
      "FREQ=MONTHLY;BYDAY=MO",
      "FREQ=DAILY;COUNT=3;UNTIL=20261231",
      "FREQ=DAILY;UNTIL=20260231",
      "FREQ=DAILY;UNTIL=20261231T000000Z",
      "FREQ=DAILY;INTERVAL=0",
      "FREQ=WEEKLY;BYDAY=MO,MO",
      "FREQ=DAILY;BYMONTHDAY=1",
      "FREQ=DAILY;FREQ=WEEKLY",
    ]) {
      expect(() => parseRRule(s), s).toThrow();
    }
  });
});

describe("ruleDates", () => {
  it("daily with interval and until", () => {
    expect(ruleDates("2026-09-28", parseRRule("FREQ=DAILY;INTERVAL=2;UNTIL=20261004"), "2027-01-01")).toEqual([
      "2026-09-28",
      "2026-09-30",
      "2026-10-02",
      "2026-10-04",
    ]);
  });

  it("weekly on several weekdays, skipping days before the start", () => {
    // 2026-09-02 is a Wednesday.
    expect(ruleDates("2026-09-02", parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR"), "2026-09-14")).toEqual([
      "2026-09-02",
      "2026-09-04",
      "2026-09-07",
      "2026-09-09",
      "2026-09-11",
      "2026-09-14",
    ]);
  });

  it("weekly without BYDAY uses the start's weekday, every other week", () => {
    expect(ruleDates("2026-09-02", parseRRule("FREQ=WEEKLY;INTERVAL=2"), "2026-10-01")).toEqual([
      "2026-09-02",
      "2026-09-16",
      "2026-09-30",
    ]);
  });

  it("weekly whose BYDAY omits the start's weekday does not include the start", () => {
    expect(ruleDates("2026-09-02", parseRRule("FREQ=WEEKLY;BYDAY=TU"), "2026-09-16")).toEqual([
      "2026-09-08",
      "2026-09-15",
    ]);
  });

  it("monthly on the 31st skips short months", () => {
    expect(ruleDates("2026-01-31", parseRRule("FREQ=MONTHLY"), "2026-08-31")).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
      "2026-07-31",
      "2026-08-31",
    ]);
  });

  it("monthly COUNT counts only months that have the day", () => {
    expect(ruleDates("2026-01-30", parseRRule("FREQ=MONTHLY;COUNT=3"), "2030-01-01")).toEqual([
      "2026-01-30",
      "2026-03-30",
      "2026-04-30",
    ]);
  });

  it("yearly on Feb 29 only hits leap years, and not 2100", () => {
    expect(ruleDates("2024-02-29", parseRRule("FREQ=YEARLY"), "2104-12-31")).toEqual(
      expect.arrayContaining(["2024-02-29", "2028-02-29", "2096-02-29", "2104-02-29"]),
    );
    expect(ruleDates("2024-02-29", parseRRule("FREQ=YEARLY"), "2104-12-31")).not.toContain("2100-02-29");
    expect(ruleDates("2024-02-29", parseRRule("FREQ=YEARLY"), "2104-12-31")).toHaveLength(20);
  });

  it("monthly crosses year boundaries with an interval", () => {
    expect(ruleDates("2026-11-15", parseRRule("FREQ=MONTHLY;INTERVAL=3"), "2027-08-15")).toEqual([
      "2026-11-15",
      "2027-02-15",
      "2027-05-15",
      "2027-08-15",
    ]);
  });

  it("stops at COUNT even when the limit is later", () => {
    expect(ruleDates("2026-09-01", parseRRule("FREQ=DAILY;COUNT=3"), "2030-01-01")).toHaveLength(3);
  });
});

describe("expandOccurrences", () => {
  it("returns a non-recurring event when it overlaps the range", () => {
    const e = event();
    expect(dates(expandOccurrences(e, [], "2026-09-01", "2026-09-01"))).toEqual(["2026-09-01"]);
    expect(expandOccurrences(e, [], "2026-09-02", "2026-09-30")).toEqual([]);
    expect(expandOccurrences(e, [], "2026-09-01", "2026-09-01")[0]).toMatchObject({
      occurrence_date: "2026-09-01",
      recurring: false,
      exception_id: null,
    });
  });

  it("includes multi-day occurrences that started before the range", () => {
    const e = event({ all_day: true, start_time: null, end_time: null, end_date: "2026-09-03", rrule: "FREQ=WEEKLY" });
    const occ = expandOccurrences(e, [], "2026-09-10", "2026-09-10");
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ occurrence_date: "2026-09-08", start_date: "2026-09-08", end_date: "2026-09-10" });
  });

  it("carries a timed event across midnight via end_date", () => {
    const e = event({ start_time: "22:00", end_date: "2026-09-02", end_time: "01:00", rrule: "FREQ=DAILY" });
    const occ = expandOccurrences(e, [], "2026-09-05", "2026-09-05");
    expect(occ.map((o) => [o.start_date, o.end_date])).toEqual([
      ["2026-09-04", "2026-09-05"],
      ["2026-09-05", "2026-09-06"],
    ]);
  });

  it("drops cancelled occurrences, which still count toward COUNT", () => {
    const e = event({ rrule: "FREQ=DAILY;COUNT=3" });
    const x = exception({ occurrence_date: "2026-09-02", cancelled: true });
    expect(dates(expandOccurrences(e, [x], "2026-09-01", "2026-09-30"))).toEqual(["2026-09-01", "2026-09-03"]);
  });

  it("applies field overrides", () => {
    const e = event({ rrule: "FREQ=DAILY" });
    const x = exception({ occurrence_date: "2026-09-02", title: "Retro", color: "red" });
    const occ = expandOccurrences(e, [x], "2026-09-02", "2026-09-02");
    expect(occ).toEqual([
      expect.objectContaining({ title: "Retro", color: "red", exception_id: "x1", start_time: "09:00", recurring: true }),
    ]);
  });

  it("moves an occurrence into the range from outside it, and out of the range", () => {
    const e = event({ rrule: "FREQ=WEEKLY;COUNT=4" });
    const movedIn = exception({
      id: "x-in",
      occurrence_date: "2026-09-22",
      all_day: false,
      start_date: "2026-09-03",
      start_time: "14:00",
      end_date: "2026-09-03",
      end_time: "15:00",
    });
    const movedOut = exception({
      id: "x-out",
      occurrence_date: "2026-09-08",
      all_day: true,
      start_date: "2026-10-01",
      end_date: "2026-10-01",
    });
    const occ = expandOccurrences(e, [movedIn, movedOut], "2026-09-01", "2026-09-09");
    expect(occ.map((o) => [o.occurrence_date, o.start_date, o.start_time])).toEqual([
      ["2026-09-01", "2026-09-01", "09:00"],
      ["2026-09-22", "2026-09-03", "14:00"],
    ]);
  });

  it("ignores deleted exceptions, other events' exceptions and dates the rule does not generate", () => {
    const e = event({ rrule: "FREQ=WEEKLY" });
    const occ = expandOccurrences(
      e,
      [
        exception({ occurrence_date: "2026-09-08", cancelled: true, deleted_at: 1 }),
        exception({ occurrence_date: "2026-09-15", cancelled: true, event_id: "other" }),
        exception({ occurrence_date: "2026-09-09", cancelled: true }),
      ],
      "2026-09-01",
      "2026-09-15",
    );
    expect(dates(occ)).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
  });

  it("stops at UNTIL", () => {
    const e = event({ rrule: "FREQ=DAILY;UNTIL=20260903" });
    expect(dates(expandOccurrences(e, [], "2026-08-01", "2026-12-31"))).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });
});

describe("shiftRRule", () => {
  it("turns weekly weekdays with the start and leaves other rules alone", () => {
    expect(shiftRRule("FREQ=WEEKLY;BYDAY=MO,SU", 1)).toBe("FREQ=WEEKLY;BYDAY=MO,TU");
    expect(shiftRRule("FREQ=WEEKLY;BYDAY=MO", -1)).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(shiftRRule("FREQ=WEEKLY;BYDAY=MO", 7)).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(shiftRRule("FREQ=MONTHLY", 3)).toBe("FREQ=MONTHLY");
    expect(shiftRRule(null, 3)).toBeNull();
  });
});
