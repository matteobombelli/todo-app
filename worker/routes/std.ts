import { z } from "zod";
import { DateStr } from "../../shared/entities";
import { daysBetween } from "../../shared/dates";
import { requireUser } from "../auth/session";
import { json } from "../http";
import { HttpError, type Router } from "../router";
import { StdNotConnectedError, StdUnavailableError, fetchStdDates } from "../services/std";

const Range = z
  .object({ from: DateStr, to: DateStr })
  .refine((r) => r.from <= r.to && daysBetween(r.from, r.to) <= 400, "from..to must be ordered and at most 400 days");

export function registerStdRoutes(r: Router): void {
  r.get("/std/dates", async (c) => {
    const user = await requireUser(c);
    const { from, to } = Range.parse(Object.fromEntries(c.url.searchParams));
    try {
      return json({ events: await fetchStdDates(c.env, user.id, from, to) });
    } catch (err) {
      if (err instanceof StdNotConnectedError) return json({ connected: false, events: [] });
      if (err instanceof StdUnavailableError) throw new HttpError(502, "save-the-date is unavailable");
      throw err;
    }
  });
}
