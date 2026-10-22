import { describe, expect, it } from "vitest";
import { parseDate, parseTime } from "../../../src/components/parse";

// A Thursday.
const today = "2026-10-22";

describe("parseDate", () => {
  it.each([
    ["2026-11-04", "2026-11-04"],
    ["today", "2026-10-22"],
    ["Tomorrow", "2026-10-23"],
    ["tmr", "2026-10-23"],
    ["yesterday", "2026-10-21"],
    ["fri", "2026-10-23"],
    ["thursday", "2026-10-29"], // today is Thursday: the next one
    ["next mon", "2026-10-26"],
    ["next fri", "2026-10-30"], // tomorrow is this week's Friday
    ["this fri", "2026-10-23"],
    ["weekend", "2026-10-24"],
    ["in 3 days", "2026-10-25"],
    ["2w", "2026-11-05"],
    ["+10", "2026-11-01"],
    ["in a month", "2026-11-22"],
    ["next week", "2026-10-29"],
    ["nov 4", "2026-11-04"],
    ["November 4, 2027", "2027-11-04"],
    ["4th of nov", "2026-11-04"],
    ["sept 1", "2027-09-01"], // passed this year: next year's
    ["11/4", "2026-11-04"],
    ["11/4/27", "2027-11-04"],
    ["30", "2026-10-30"],
    ["15", "2026-11-15"],
  ])("%s → %s", (input, expected) => {
    expect(parseDate(input, today)).toBe(expected);
  });

  it("reads day first where the locale does", () => {
    expect(parseDate("4/11", today, true)).toBe("2026-11-04");
  });

  it.each(["", "soon", "feb 30", "13/45", "mo", "2026-02-30"])("rejects %j", (input) => {
    expect(parseDate(input, today)).toBeNull();
  });
});

describe("parseTime", () => {
  it.each([
    ["14:30", false, "14:30"],
    ["1430", false, "14:30"],
    ["930", false, "09:30"],
    ["2:30pm", false, "14:30"],
    ["2:30 p", false, "14:30"],
    ["12am", false, "00:00"],
    ["12pm", false, "12:00"],
    ["9.15", false, "09:15"],
    ["noon", false, "12:00"],
    ["3", true, "15:00"],
    ["3", false, "03:00"],
    ["9", true, "09:00"],
    ["3:15", true, "03:15"],
  ])("%s (12h: %s) → %s", (input, hour12, expected) => {
    expect(parseTime(input, hour12)).toBe(expected);
  });

  it.each(["", "25:00", "13pm", "9:75", "abc", "12345"])("rejects %j", (input) => {
    expect(parseTime(input)).toBeNull();
  });
});
