import type { ExternalEvent, StdStatus } from "../../shared/agenda";
import { addDays } from "../../shared/dates";

// Read-only view of save-the-date through the STD service binding. Its Worker accepts STD_TOKEN as a
// bearer token for GET /api/dates only.

interface StdRow {
  id: number;
  title: string;
  event_date: string | null;
  event_time: string | null;
  location: string | null;
  duration: number | null;
  status: StdStatus;
}

export class StdUnavailableError extends Error {}

/** Dated save-the-date entries overlapping [from, to], mapped to ExternalEvent. */
export async function fetchStdDates(env: Env, from: string, to: string): Promise<ExternalEvent[]> {
  const url = new URL("https://save-the-date/api/dates");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("order", "asc");
  let res: Response;
  try {
    res = await env.STD.fetch(url, { headers: { Authorization: `Bearer ${env.STD_TOKEN}` } });
  } catch (err) {
    throw new StdUnavailableError(String(err));
  }
  if (!res.ok) throw new StdUnavailableError(`save-the-date answered ${res.status}`);
  const rows = (await res.json()) as StdRow[];
  return rows
    .filter((r): r is StdRow & { event_date: string } => r.event_date !== null)
    .map((r) => ({
      id: `std-${r.id}`,
      source: "save-the-date",
      title: r.title,
      start_date: r.event_date,
      end_date: addDays(r.event_date, Math.max(r.duration ?? 1, 1) - 1),
      start_time: r.event_time || null,
      status: r.status,
      location: r.location || null,
    }));
}
