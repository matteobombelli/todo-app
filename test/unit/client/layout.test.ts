import { describe, expect, it } from "vitest";
import { monthWeeks, placeBars, placeBlocks } from "../../../src/calendar/layout";

describe("monthWeeks", () => {
  it("covers the month with Sunday-start weeks", () => {
    // September 2026 starts on a Tuesday and ends on a Wednesday.
    expect(monthWeeks("2026-09-15")).toEqual(["2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"]);
    // February 2026 starts on a Sunday and spans exactly four weeks.
    expect(monthWeeks("2026-02-01")).toEqual(["2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22"]);
    // August 2026 starts on a Saturday: six rows.
    expect(monthWeeks("2026-08-31")).toHaveLength(6);
  });
});

describe("placeBars", () => {
  it("clips spans to the row and packs lanes", () => {
    const bars = placeBars(
      [
        { id: "a", start_date: "2026-09-10", end_date: "2026-09-16" },
        { id: "b", start_date: "2026-09-14", end_date: "2026-09-14" },
        { id: "c", start_date: "2026-09-15", end_date: "2026-09-17" },
        { id: "d", start_date: "2026-09-16", end_date: "2026-09-16" },
        { id: "e", start_date: "2026-09-21", end_date: "2026-09-21" },
      ],
      "2026-09-14",
      7,
    );
    expect(bars.map((b) => [b.item.id, b.startCol, b.endCol, b.lane])).toEqual([
      ["a", 0, 2, 0],
      ["b", 0, 0, 1],
      ["c", 1, 3, 1],
      ["d", 2, 2, 2],
    ]);
  });
});

describe("placeBlocks", () => {
  const block = (id: string, start: string, end: string, startDate = "2026-09-14", endDate = startDate) => ({
    id,
    start_date: startDate,
    start_time: start,
    end_date: endDate,
    end_time: end,
  });

  it("puts overlapping events side by side and leaves separate clusters full width", () => {
    const placed = placeBlocks(
      [block("a", "09:00", "10:00"), block("b", "09:30", "11:00"), block("c", "10:00", "10:30"), block("d", "12:00", "13:00")],
      "2026-09-14",
    );
    expect(placed.map((p) => [p.item.id, p.top, p.bottom, p.column, p.columns])).toEqual([
      ["a", 540, 600, 0, 2],
      ["b", 570, 660, 1, 2],
      ["c", 600, 630, 0, 2],
      ["d", 720, 780, 0, 1],
    ]);
  });

  it("splits events across midnight and drops a zero-length tail", () => {
    const overnight = block("n", "22:00", "02:00", "2026-09-14", "2026-09-15");
    const toMidnight = block("m", "23:00", "00:00", "2026-09-14", "2026-09-15");
    expect(placeBlocks([overnight, toMidnight], "2026-09-14").map((p) => [p.item.id, p.top, p.bottom])).toEqual([
      ["n", 1320, 1440],
      ["m", 1380, 1440],
    ]);
    expect(placeBlocks([overnight, toMidnight], "2026-09-15").map((p) => [p.item.id, p.top, p.bottom])).toEqual([["n", 0, 120]]);
  });

  it("gives very short events a minimum height", () => {
    expect(placeBlocks([block("z", "09:00", "09:00")], "2026-09-14")[0]).toMatchObject({ top: 540, bottom: 560 });
  });
});
