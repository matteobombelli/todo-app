import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { connectStd, registerAndLogin } from "./helpers";

const ORIGIN = "https://todo.matteob.dev";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function fetchApp(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(ORIGIN + path, { redirect: "manual", ...init }));
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function registerClient(): Promise<string> {
  const res = await fetchApp("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function authorizeUrl(clientId: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st4te",
  });
  return { path: `/authorize?${q}`, verifier };
}

/**
 * Runs the whole OAuth flow for a fresh user and returns an MCP access token. The user is also
 * connected to save-the-date unless `std` is false.
 */
async function connect(email: string, std = true): Promise<string> {
  const { cookie } = await registerAndLogin(email);
  if (std) expect((await connectStd(cookie)).status).toBe(302);
  const clientId = await registerClient();
  const { path, verifier } = await authorizeUrl(clientId);
  const approve = await fetchApp(path, {
    method: "POST",
    headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
    body: "decision=allow",
  });
  expect(approve.status).toBe(302);
  const code = new URL(approve.headers.get("Location")!).searchParams.get("code")!;
  const token = await fetchApp("/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }),
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}

let rpcId = 0;
async function rpc(token: string, method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  const res = await fetchApp("/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  const text = await res.text();
  // Streamable HTTP may answer with a single SSE event instead of plain JSON.
  const payload = res.headers.get("Content-Type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5))
        .join("")
    : text;
  const message = JSON.parse(payload) as { result?: Record<string, unknown>; error?: unknown };
  if (message.error) throw new Error(JSON.stringify(message.error));
  return message.result!;
}

async function call(token: string, name: string, args: Record<string, unknown> = {}): Promise<{ data: any; isError: boolean }> {
  const result = (await rpc(token, "tools/call", { name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const text = result.content[0].text;
  return { data: result.isError ? text : JSON.parse(text), isError: !!result.isError };
}

describe("OAuth", () => {
  it("publishes authorization server metadata", async () => {
    const res = await fetchApp("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
    });
  });

  it("rejects /mcp without a token", async () => {
    const res = await fetchApp("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("sends a signed-out user to log in, then shows consent", async () => {
    const { cookie } = await registerAndLogin("oauth-consent@example.com");
    const { path } = await authorizeUrl(await registerClient());

    const signedOut = await fetchApp(path);
    expect(signedOut.status).toBe(302);
    const login = new URL(signedOut.headers.get("Location")!);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("next")).toBe(path);

    const consent = await fetchApp(path, { headers: { Cookie: cookie } });
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain("Allow Claude?");
  });

  it("denies, and refuses a cross-origin approval", async () => {
    const { cookie } = await registerAndLogin("oauth-deny@example.com");
    const { path } = await authorizeUrl(await registerClient());
    const form = { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie };

    const denied = await fetchApp(path, { method: "POST", headers: { ...form, Origin: ORIGIN }, body: "decision=deny" });
    const location = new URL(denied.headers.get("Location")!);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("st4te");

    const forged = await fetchApp(path, { method: "POST", headers: { ...form, Origin: "https://evil.example" }, body: "decision=allow" });
    expect(forged.status).toBe(403);
  });
});

describe("MCP tools", () => {
  let token: string;

  beforeAll(async () => {
    token = await connect("mcp@example.com");
    await rpc(token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
  });

  it("lists every tool", async () => {
    const { tools } = (await rpc(token, "tools/list")) as { tools: { name: string }[] };
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "create_event",
        "create_item",
        "create_list",
        "delete_event",
        "delete_item",
        "delete_list",
        "get_agenda",
        "list_events",
        "list_items",
        "list_lists",
        "search",
        "update_event",
        "update_item",
        "update_list",
      ].sort(),
    );
  });

  it("manages lists and items, resolving lists by name", async () => {
    expect((await call(token, "create_list", { name: "Groceries", color: "green" })).data).toMatchObject({ name: "Groceries" });
    const item = (await call(token, "create_item", { list: "groceries", title: "Milk", due_date: "2026-09-20", due_time: "09:00" })).data;
    await call(token, "create_item", { list: "Groceries", title: "Eggs" });

    const lists = (await call(token, "list_lists")).data;
    expect(lists).toEqual([expect.objectContaining({ name: "Groceries", open: 2, completed: 0 })]);

    const done = (await call(token, "update_item", { id: item.id, completed: true })).data;
    expect(done.completed_at).toEqual(expect.any(Number));
    expect((await call(token, "list_items", { list: "Groceries" })).data.map((i: { title: string }) => i.title)).toEqual(["Eggs"]);
    expect((await call(token, "list_items", { status: "completed" })).data).toEqual([
      expect.objectContaining({ title: "Milk", list: "Groceries", completed: true }),
    ]);

    const cleared = (await call(token, "update_item", { id: item.id, due_date: null })).data;
    expect(cleared).toMatchObject({ due_date: null, due_time: null });

    const missing = await call(token, "create_item", { list: "Hardware", title: "Nails" });
    expect(missing).toEqual({ isError: true, data: 'No list named or with id "Hardware". Lists: "Groceries"' });

    const bad = await call(token, "create_item", { list: "Groceries", title: "Bad", due_time: "10:00" });
    expect(bad.isError).toBe(true);
  });

  it("creates, expands, edits and deletes recurring events", async () => {
    const standup = (
      await call(token, "create_event", { title: "Standup", start_date: "2026-09-14", start_time: "10:00", rrule: "FREQ=WEEKLY;BYDAY=MO,WE" })
    ).data;
    expect(standup).toMatchObject({ all_day: false, end_date: "2026-09-14", end_time: "11:00" });

    const late = (await call(token, "create_event", { title: "Late show", start_date: "2026-09-15", start_time: "23:30" })).data;
    expect(late).toMatchObject({ end_date: "2026-09-16", end_time: "00:30" });
    const trip = (await call(token, "create_event", { title: "Trip", start_date: "2026-09-17", end_date: "2026-09-19" })).data;
    expect(trip).toMatchObject({ all_day: true, start_time: null });

    const moved = await call(token, "update_event", {
      id: standup.id,
      scope: "occurrence",
      occurrence_date: "2026-09-16",
      start_time: "14:00",
      title: "Standup (moved)",
    });
    expect(moved.data).toMatchObject({ occurrence_date: "2026-09-16", start_time: "14:00", end_time: "15:00", title: "Standup (moved)" });
    await call(token, "delete_event", { id: standup.id, scope: "occurrence", occurrence_date: "2026-09-21" });

    const { events, save_the_date } = (await call(token, "list_events", { from: "2026-09-14", to: "2026-09-23" })).data;
    expect(events.filter((e: { event_id: string }) => e.event_id === standup.id).map((e: { start_date: string; start_time: string }) => [e.start_date, e.start_time])).toEqual([
      ["2026-09-14", "10:00"],
      ["2026-09-16", "14:00"],
      ["2026-09-23", "10:00"],
    ]);
    expect(save_the_date).toEqual([expect.objectContaining({ title: "Picnic", read_only: true, source: "save-the-date" })]);

    const notAnOccurrence = await call(token, "delete_event", { id: standup.id, scope: "occurrence", occurrence_date: "2026-09-15" });
    expect(notAnOccurrence).toEqual({ isError: true, data: "2026-09-15 is not an occurrence of this event" });

    // occurrence_date without scope means that occurrence; a deleted one cannot be edited.
    await call(token, "delete_event", { id: standup.id, occurrence_date: "2026-09-28" });
    expect((await call(token, "list_events", { from: "2026-09-28", to: "2026-09-28" })).data.events).toEqual([]);
    const ghost = await call(token, "update_event", { id: standup.id, occurrence_date: "2026-09-28", title: "Back" });
    expect(ghost).toEqual({ isError: true, data: "The 2026-09-28 occurrence was deleted" });

    // Rules are stored in canonical form.
    const odd = (await call(token, "create_event", { title: "Odd", start_date: "2026-10-05", rrule: "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=WE,MO" })).data;
    expect(odd.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    // Moving the series start a day later moves its weekdays too.
    const moved2 = (await call(token, "update_event", { id: odd.id, start_date: "2026-10-06" })).data;
    expect(moved2.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    await call(token, "delete_event", { id: odd.id });

    // A series edit that moves the start keeps the duration.
    const series = (await call(token, "update_event", { id: standup.id, scope: "series", start_time: "09:30" })).data;
    expect(series).toMatchObject({ start_time: "09:30", end_time: "10:30", rrule: "FREQ=WEEKLY;BYDAY=MO,WE" });

    expect((await call(token, "delete_event", { id: trip.id })).data).toMatchObject({ deleted: "series" });
    const after = (await call(token, "list_events", { from: "2026-09-17", to: "2026-09-19" })).data;
    expect(after.events).toEqual([]);
  });

  it("gives a day's rundown in agenda order", async () => {
    const other = await connect("agenda@example.com");
    await call(other, "create_list", { name: "Home" });
    await call(other, "create_item", { list: "Home", title: "Old bill", due_date: "2020-01-01" });
    await call(other, "create_item", { list: "Home", title: "Call mom", due_date: "2026-09-20", due_time: "11:00" });
    await call(other, "create_item", { list: "Home", title: "Laundry", due_date: "2026-09-20" });
    await call(other, "create_event", { title: "Brunch", start_date: "2026-09-20", start_time: "10:00" });
    await call(other, "create_event", { title: "Holiday", start_date: "2026-09-20" });

    const { days, timezone, today } = (await call(other, "get_agenda", { date: "2026-09-20" })).data;
    expect(timezone).toBe("America/Los_Angeles");
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [day] = days;
    expect(day.all_day.map((e: { title: string }) => e.title)).toEqual(["Holiday"]);
    expect(day.timed.map((t: { kind: string; title: string }) => [t.kind, t.title])).toEqual([
      ["event", "Brunch"],
      ["item", "Call mom"],
      ["save-the-date", "Picnic"],
    ]);
    expect(day.items_due.map((i: { title: string }) => i.title)).toEqual(["Laundry"]);
    // Overdue items only show on today's agenda.
    expect(day.overdue_items).toBeUndefined();

    // Relative to the real clock: items due on the 20th are overdue once that date has passed.
    const todays = (await call(other, "get_agenda")).data.days[0];
    const expected = today > "2026-09-20" ? ["Old bill", "Call mom", "Laundry"] : ["Old bill"];
    expect(todays.overdue_items.map((i: { title: string }) => i.title)).toEqual(expected);
  });

  it("searches items and events", async () => {
    const result = (await call(token, "search", { query: "STAND" })).data;
    expect(result.events.map((e: { title: string }) => e.title)).toEqual(["Standup"]);
    expect(result.items).toEqual([]);
  });

  it("scopes every tool to the token's user", async () => {
    const stranger = await connect("stranger@example.com", false);
    expect((await call(stranger, "list_lists")).data).toEqual([]);
    const { data: lists } = await call(token, "list_lists");
    const milk = (await call(token, "search", { query: "milk" })).data.items[0];
    expect((await call(stranger, "update_item", { id: milk.id, title: "Stolen" })).isError).toBe(true);
    expect((await call(stranger, "delete_list", { list: lists[0].id })).isError).toBe(true);
  });

  it("leaves save-the-date out for an account that is not connected", async () => {
    const alone = await connect("unconnected@example.com", false);
    const listed = (await call(alone, "list_events", { from: "2026-09-14", to: "2026-09-23" })).data;
    expect(listed).toEqual({ events: [] });
    const [day] = (await call(alone, "get_agenda", { date: "2026-09-20" })).data.days;
    expect(day.timed).toEqual([]);
    expect(day.all_day).toEqual([]);
  });
});

describe("MCP bulk writes", () => {
  let token: string;
  const seq = async () =>
    (await env.DB.prepare("SELECT value FROM user_seq JOIN users ON users.id = user_seq.user_id WHERE email = ?")
      .bind("bulk@example.com")
      .first<{ value: number }>())!.value;
  const titles = async (status = "open") =>
    (await call(token, "list_items", { status })).data.map((i: { title: string }) => i.title).sort();

  beforeAll(async () => {
    token = await connect("bulk@example.com", false);
    await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    await call(token, "create_list", { name: "Chores" });
    await call(token, "create_list", { name: "Errands" });
  });

  it("creates, updates and deletes many items in one write", async () => {
    const before = await seq();
    const created = await call(token, "create_item", {
      items: [
        { list: "chores", title: "Dishes" },
        { list: "Errands", title: "Post office", due_date: "2026-09-24" },
        { list: "Chores", title: "Laundry" },
      ],
    });
    expect(created.isError).toBe(false);
    expect(created.data.map((i: { title: string }) => i.title)).toEqual(["Dishes", "Post office", "Laundry"]);
    expect(await seq()).toBe(before + 1);

    const [dishes, post, laundry] = created.data as { id: string }[];
    const updated = await call(token, "update_item", {
      items: [
        { id: dishes.id, completed: true },
        { id: post.id, title: "Post office run", list: "Chores" },
        { id: post.id, due_date: null },
      ],
    });
    expect(updated.data[2]).toMatchObject({ title: "Post office run", due_date: null });
    expect(await titles()).toEqual(["Laundry", "Post office run"]);

    const deleted = await call(token, "delete_item", { items: [{ id: laundry.id }, { id: dishes.id }] });
    expect(deleted.data.map((i: { title: string }) => i.title)).toEqual(["Laundry", "Dishes"]);
    expect(await titles("all")).toEqual(["Post office run"]);
  });

  it("changes nothing when any entry fails, and names each failure", async () => {
    const before = await seq();
    const failed = await call(token, "create_item", {
      items: [
        { list: "Chores", title: "Vacuum" },
        { list: "Garden", title: "Weeding" },
        { list: "Chores", title: "Bad", due_time: "10:00" },
      ],
    });
    expect(failed.isError).toBe(true);
    expect(failed.data).toMatch(/^Nothing was changed\. \[1\] No list named or with id "Garden"\..*; \[2\] /);
    expect(await seq()).toBe(before);
    expect(await titles()).toEqual(["Post office run"]);
  });

  it("keeps the single form and refuses a mix of both", async () => {
    const one = await call(token, "create_item", { list: "Chores", title: "Mop" });
    expect(one.data).toMatchObject({ title: "Mop" });
    const mixed = await call(token, "create_item", { list: "Chores", title: "Sweep", items: [{ list: "Chores", title: "Dust" }] });
    expect(mixed).toEqual({ isError: true, data: "Give either one entry's fields or `items`, not both" });
    expect(await titles()).toEqual(["Mop", "Post office run"]);
  });

  it("plans later entries against subtasks as their parent's entry leaves them", async () => {
    const parent = (await call(token, "create_item", { list: "Errands", title: "Trip" })).data;
    const [open] = (await call(token, "create_item", { items: [{ list: "Errands", parent: parent.id, title: "Tickets" }] })).data;
    const result = await call(token, "update_item", {
      items: [
        { id: parent.id, completed: true, list: "Chores" },
        { id: open.id, title: "Train tickets" },
      ],
    });
    expect(result.isError).toBe(false);
    expect(result.data[1]).toMatchObject({ title: "Train tickets", list_id: result.data[0].list_id, parent_id: parent.id });
    expect(result.data[1].completed_at).toEqual(expect.any(Number));
  });

  it("creates and deletes many events, occurrences included", async () => {
    const created = (
      await call(token, "create_event", {
        events: [
          { title: "Gym", start_date: "2026-09-21", start_time: "07:00", rrule: "FREQ=DAILY;COUNT=5" },
          { title: "Dentist", start_date: "2026-09-22", start_time: "15:00" },
        ],
      })
    ).data as { id: string }[];
    await call(token, "delete_event", {
      events: [
        { id: created[0].id, occurrence_date: "2026-09-22" },
        { id: created[0].id, occurrence_date: "2026-09-23" },
        { id: created[1].id },
      ],
    });
    const listed = (await call(token, "list_events", { from: "2026-09-21", to: "2026-09-25" })).data.events;
    expect(listed.map((e: { title: string; occurrence_date: string }) => `${e.title} ${e.occurrence_date}`)).toEqual([
      "Gym 2026-09-21",
      "Gym 2026-09-24",
      "Gym 2026-09-25",
    ]);
  });
});
