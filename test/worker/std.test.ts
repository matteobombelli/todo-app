import { describe, expect, it } from "vitest";
import { cookieHeader, registerAndLogin, request } from "./helpers";

describe("GET /std/dates", () => {
  it("requires a session", async () => {
    expect((await request("/std/dates?from=2026-09-01&to=2026-09-30")).status).toBe(401);
  });

  it("maps save-the-date rows overlapping the range to read-only events", async () => {
    const { cookie } = await registerAndLogin("std1@example.com");
    const res = await request("/std/dates?from=2026-09-01&to=2026-09-30", { headers: cookieHeader(cookie) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      events: [
        {
          id: "std-1",
          source: "save-the-date",
          title: "Picnic",
          start_date: "2026-09-20",
          end_date: "2026-09-20",
          start_time: "12:30",
          status: "upcoming",
          location: "Golden Gate Park",
        },
        {
          id: "std-2",
          source: "save-the-date",
          title: "Tahoe trip",
          start_date: "2026-09-25",
          end_date: "2026-09-27",
          start_time: null,
          status: "proposed",
          location: null,
        },
      ],
    });
  });

  it("includes multi-day entries that started before the range", async () => {
    const { cookie } = await registerAndLogin("std2@example.com");
    const res = await request("/std/dates?from=2026-09-27&to=2026-10-31", { headers: cookieHeader(cookie) });
    const { events } = (await res.json()) as { events: { id: string }[] };
    expect(events.map((e) => e.id)).toEqual(["std-2"]);
  });

  it("validates the range", async () => {
    const { cookie } = await registerAndLogin("std3@example.com");
    for (const q of ["", "?from=2026-09-30&to=2026-09-01", "?from=2026-01-01&to=2028-01-01", "?from=nope&to=2026-09-01"]) {
      expect((await request(`/std/dates${q}`, { headers: cookieHeader(cookie) })).status, q).toBe(400);
    }
  });
});
