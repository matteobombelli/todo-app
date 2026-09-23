import type { ExternalEvent, StdStatus } from "../../shared/agenda";
import type { User } from "../../shared/api";
import { addDays } from "../../shared/dates";

// Read-only view of save-the-date through the STD service binding. Its Worker accepts STD_TOKEN as a
// bearer token for POST /api/todo/redeem and for GET /api/dates, the latter only on behalf of an
// account (X-Todo-User) that connected from save-the-date.

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
/** The account has not connected from save-the-date (it answered 403). */
export class StdNotConnectedError extends Error {}

const BASE = "https://save-the-date";

/** Dated save-the-date entries overlapping [from, to], mapped to ExternalEvent. */
export async function fetchStdDates(env: Env, userId: string, from: string, to: string): Promise<ExternalEvent[]> {
  const url = new URL(`${BASE}/api/dates`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("order", "asc");
  let res: Response;
  try {
    res = await env.STD.fetch(url, { headers: { Authorization: `Bearer ${env.STD_TOKEN}`, "X-Todo-User": userId } });
  } catch (err) {
    throw new StdUnavailableError(String(err));
  }
  if (res.status === 403) throw new StdNotConnectedError();
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

/** Uses up a connect code minted by save-the-date, which then lists the user as connected. */
export async function redeemStdCode(env: Env, code: string, user: User): Promise<boolean> {
  try {
    const res = await env.STD.fetch(`${BASE}/api/todo/redeem`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STD_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code, user_id: user.id, email: user.email }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
