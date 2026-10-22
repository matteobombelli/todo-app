import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEZONE } from "../../shared/api";
import { addDays, nowIn } from "../../shared/dates";
import type { Mutation } from "../../shared/entities";
import { LOCK_MS } from "../../shared/goals";
import { dueReminders } from "../../worker/services/push";
import { applyMutations, listRecords } from "../../worker/services/records";
import * as todo from "../../worker/services/todo";
import { jsonRequest, registerAndLogin } from "./helpers";

// Noon on 2026-10-10 in America/Los_Angeles, the default timezone.
const NOON = Date.parse("2026-10-10T19:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
let users = 0;

function goalRecord(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    title: "Run",
    color: "green",
    specific: "Run 3 km",
    achievable: "",
    relevant: "",
    start_date: "2026-10-10",
    end_date: "2026-11-08",
    target_days: 12,
    metric_label: null,
    metric_unit: null,
    metric_baseline: null,
    metric_target: null,
    before_note: "Out of breath by km 3",
    after_value: null,
    after_note: null,
    status: "active",
    committed_at: null,
    closed_at: null,
    ...patch,
  };
}

const upsert = (entity: "goals" | "goal_entries", record: Record<string, unknown> & { id: string }): Mutation => ({
  op_id: crypto.randomUUID(),
  entity,
  action: "upsert",
  record,
});

const remove = (entity: "goals" | "goal_entries", id: string): Mutation => ({ op_id: crypto.randomUUID(), entity, action: "delete", record: { id } });

const entry = (goalId: string, date: string, amount = 1, id: string = crypto.randomUUID()) => ({ id, goal_id: goalId, date, amount, note: "" });

/** A user with a goal committed at NOON, plus a way to write as them at any moment. */
async function setup(patch: Record<string, unknown> = {}) {
  const { user, cookie } = await registerAndLogin(`goals${++users}@example.com`);
  const goalId = crypto.randomUUID();
  const write = async (m: Mutation, now = NOON) => {
    const outcome = await applyMutations(env.DB, user.id, [m], now);
    return outcome.applied ? null : (outcome.rejected[0].result as { error: string }).error;
  };
  expect(await write(upsert("goals", goalRecord(goalId, patch)))).toBeNull();
  const goal = async () => (await listRecords(env.DB, user.id, "goals")).find((g) => g.id === goalId)!;
  return { user, cookie, goalId, write, goal };
}

describe("goals on the server", () => {
  it("stamps committed_at itself, whatever the client sends", async () => {
    const { goal } = await setup({ committed_at: 5 });
    expect((await goal()).committed_at).toBe(NOON);
  });

  it("refuses to commit a goal that starts in the past", async () => {
    const { write } = await setup();
    expect(await write(upsert("goals", goalRecord(crypto.randomUUID(), { start_date: "2026-10-01" })))).toMatch(/before the day/);
  });

  it("lets the definition change for a day, then locks it", async () => {
    const { write, goal, goalId } = await setup();
    expect(await write(upsert("goals", goalRecord(goalId, { target_days: 15 })), NOON + 1000)).toBeNull();
    expect((await goal()).target_days).toBe(15);
    expect(await write(upsert("goals", goalRecord(goalId, { target_days: 5 })), NOON + LOCK_MS)).toMatch(/locked/);
    expect(await write(upsert("goals", goalRecord(goalId, { target_days: 15, title: "Run more" })), NOON + LOCK_MS)).toBeNull();
    expect((await goal()).title).toBe("Run more");
  });

  it("can't be deleted once locked, only abandoned", async () => {
    const { write, goal, goalId } = await setup();
    expect(await write(remove("goals", goalId), NOON + LOCK_MS)).toMatch(/abandon/);
    expect(await write(upsert("goals", goalRecord(goalId, { status: "abandoned" })), NOON + LOCK_MS)).toBeNull();
    expect((await goal()).status).toBe("abandoned");
    expect(await write(upsert("goals", goalRecord(goalId, { status: "active" })), NOON + LOCK_MS)).toMatch(/can't go/);
  });

  it("logs effort only for today or yesterday, once a day", async () => {
    const { write, goalId } = await setup();
    const later = NOON + 3 * DAY; // 2026-10-13
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-13")), later)).toBeNull();
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-12", 0.5)), later)).toBeNull();
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-11")), later)).toMatch(/today or yesterday/);
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-14")), later)).toMatch(/today or yesterday/);
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-13", 0.5)), later)).toMatch(/already/);
    expect(await write(upsert("goal_entries", { ...entry(goalId, "2026-10-13"), amount: 2 }), later)).toMatch(/amount/);
  });

  it("lets a misclick be taken back while the day is open, then seals it", async () => {
    const { write, goalId, user } = await setup();
    const id = crypto.randomUUID();
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-10", 1, id)))).toBeNull();
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-10", 0.5, id)))).toBeNull();
    expect(await write(remove("goal_entries", id))).toBeNull();
    expect(await listRecords(env.DB, user.id, "goal_entries")).toEqual([]);

    const kept = crypto.randomUUID();
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-10", 1, kept)))).toBeNull();
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-10", 0.5, kept)), NOON + 2 * DAY)).toMatch(/today or yesterday/);
    expect(await write(remove("goal_entries", kept), NOON + 2 * DAY)).toMatch(/sealed/);
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-11", 1, kept)), NOON + DAY)).toMatch(/can't change/);
  });

  it("opens the after in the last week, and closing seals the entries", async () => {
    const { write, goal, goalId } = await setup({ end_date: "2026-10-20", target_days: 6 });
    const close = (now: number) => write(upsert("goals", goalRecord(goalId, { end_date: "2026-10-20", target_days: 6, status: "closed", after_note: "Easy 5k" })), now);
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-14")), NOON + 4 * DAY)).toBeNull();
    expect(await close(NOON + 2 * DAY)).toMatch(/opens/);
    expect(await close(NOON + 4 * DAY)).toBeNull();
    expect((await goal()).closed_at).toBe(NOON + 4 * DAY);
    expect(await write(upsert("goal_entries", entry(goalId, "2026-10-14", 0.5)), NOON + 4 * DAY)).toMatch(/isn't active/);
  });

  it("applies the same rules through /api/mutations", async () => {
    const { cookie, goalId } = await setup();
    const res = await jsonRequest("/mutations", "POST", { mutations: [upsert("goal_entries", entry(goalId, "2020-01-01"))] }, cookie);
    const { results } = (await res.json()) as { results: { status: string; error?: string }[] };
    expect(results[0]).toMatchObject({ status: "rejected" });
  });
});

describe("goal MCP tools", () => {
  it("drafts goals, logs effort as the user, and reports progress", async () => {
    const { user } = await registerAndLogin(`goals${++users}@example.com`);
    const s = { env, userId: user.id } as todo.Scope;
    const today = nowIn(DEFAULT_TIMEZONE).date;
    const draft = await todo.createGoal(s, { title: "Read", start_date: today, end_date: addDays(today, 9), target_days: 5 });
    expect(draft.status).toBe("draft");
    await expect(todo.logGoalEffort(s, [{ goal: "Read", amount: 1 }])).rejects.toThrow(/isn't active/);

    await applyMutations(env.DB, user.id, [upsert("goals", { ...draft, status: "active" })]);
    await todo.logGoalEffort(s, [{ goal: "read", amount: 0.5, note: "Two chapters" }]);
    await todo.logGoalEffort(s, [{ goal: "Read", amount: 1 }]);
    expect((await todo.listGoals(s)).goals[0]).toMatchObject({ title: "Read", days_logged: 1, score_percent: 20, logged_today: 1 });
    const full = await todo.getGoal(s, draft.id);
    expect(full.entries).toEqual([{ date: today, amount: 1, note: "Two chapters" }]);

    await todo.logGoalEffort(s, [{ goal: "Read", amount: 0 }]);
    expect((await todo.listGoals(s)).goals[0].days_logged).toBe(0);
    await expect(todo.logGoalEffort(s, [{ goal: "Nope", amount: 1 }])).rejects.toThrow(/No goal/);
  });

  it("shows goals in the agenda", async () => {
    const { user } = await registerAndLogin(`goals${++users}@example.com`);
    const s = { env, userId: user.id } as todo.Scope;
    const today = nowIn(DEFAULT_TIMEZONE).date;
    const draft = await todo.createGoal(s, { title: "Stretch", start_date: today, end_date: addDays(today, 9), target_days: 5 });
    await applyMutations(env.DB, user.id, [upsert("goals", { ...draft, status: "active" })]);
    await todo.logGoalEffort(s, [{ goal: "Stretch", amount: 0.5 }]);
    const agenda = await todo.getAgenda(s, undefined, 1);
    expect(agenda.days[0].goals).toEqual([{ id: draft.id, title: "Stretch", logged: 0.5 }]);
  });
});

describe("goal reminder", () => {
  it("nudges once in the evening about goals not logged today", async () => {
    const { cookie, write, goalId, user } = await setup();
    await jsonRequest("/push/subscribe", "POST", await subscription(), cookie);
    const at = (time: string) => dueReminders(env.DB, new Date(`2026-10-10T${time}:00-07:00`)).then((r) => r.filter((x) => x.userId === user.id));
    expect(await at("19:00")).toEqual([]);
    expect(await at("20:00")).toMatchObject([{ key: "goals:2026-10-10", url: `/goals/${goalId}` }]);

    await write(upsert("goal_entries", entry(goalId, "2026-10-10")));
    expect(await at("20:00")).toEqual([]);
    await jsonRequest("/settings", "PATCH", { goal_reminder_time: null }, cookie);
  });
});

async function subscription() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return {
    endpoint: `https://push.example.com/${crypto.randomUUID()}`,
    keys: { p256dh: b64((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer), auth: b64(crypto.getRandomValues(new Uint8Array(16))) },
  };
}
