import { describe, expect, it } from "vitest";
import { weekStart } from "../../shared/dates";

describe("weekStart", () => {
  it("returns the Sunday on or before the date", () => {
    expect(weekStart("2026-09-20")).toBe("2026-09-20");
    expect(weekStart("2026-09-23")).toBe("2026-09-20");
    expect(weekStart("2026-09-26")).toBe("2026-09-20");
    expect(weekStart("2026-01-01")).toBe("2025-12-28");
  });
});
