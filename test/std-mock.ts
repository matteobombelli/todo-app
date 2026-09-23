// Stands in for the save-the-date Worker behind the STD service binding in worker tests. Answers
// POST /api/todo/redeem and GET /api/dates like the real one: bearer token required, a redeemed
// user id joins the connected set, and only a connected X-Todo-User may read the rows overlapping
// [from, to]. Runs in the Node process, so the set outlives each test file's isolate.
export const STD_TEST_TOKEN = "test-std-token";
// Any other code is rejected. The real Worker also uses a code up; the mock does not.
export const STD_TEST_CODE = "test-connect-code";

export const STD_ROWS = [
  { id: 1, title: "Picnic", description: "Park", event_date: "2026-09-20", event_time: "12:30", location: "Golden Gate Park", maps_url: null, duration: null, proposee: "Hailey", status: "upcoming", created_at: "2026-09-01 10:00:00", cover_image_id: null, note_hailey: null, note_matteo: null },
  { id: 2, title: "Tahoe trip", description: "Cabin", event_date: "2026-09-25", event_time: null, location: null, maps_url: null, duration: 3, proposee: "Matteo", status: "proposed", created_at: "2026-09-02 10:00:00", cover_image_id: 7, note_hailey: null, note_matteo: null },
  { id: 3, title: "Old dinner", description: "Sushi", event_date: "2026-08-01", event_time: "19:00", location: null, maps_url: null, duration: null, proposee: "Matteo", status: "saved", created_at: "2026-07-01 10:00:00", cover_image_id: null, note_hailey: null, note_matteo: null },
  { id: 4, title: "Someday", description: "Undated", event_date: null, event_time: null, location: null, maps_url: null, duration: null, proposee: "Hailey", status: "proposed", created_at: "2026-07-01 10:00:00", cover_image_id: null, note_hailey: null, note_matteo: null },
];

const connected = new Set<string>();

function endOf(row: (typeof STD_ROWS)[number]): string {
  const d = new Date(`${row.event_date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (row.duration ?? 1) - 1);
  return d.toISOString().slice(0, 10);
}

export async function stdMock(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.headers.get("Authorization") !== `Bearer ${STD_TEST_TOKEN}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (url.pathname === "/api/todo/redeem" && request.method === "POST") {
    const body = (await request.json()) as { code?: string; user_id?: string; email?: string };
    if (body.code !== STD_TEST_CODE || !body.user_id || !body.email) {
      return Response.json({ error: "Invalid or expired code" }, { status: 400 });
    }
    connected.add(body.user_id);
    return Response.json({ ok: true });
  }
  if (url.pathname !== "/api/dates" || request.method !== "GET") return Response.json({ error: "Not found" }, { status: 404 });
  if (!connected.has(request.headers.get("X-Todo-User") ?? "")) return Response.json({ error: "Not connected" }, { status: 403 });
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const rows = STD_ROWS.filter((r) => r.event_date !== null && (!to || r.event_date <= to) && (!from || endOf(r) >= from));
  return Response.json(rows);
}
