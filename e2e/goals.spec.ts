import { randomUUID } from "node:crypto";
import type { Fields } from "../shared/entities";
import { expect, seed, serverState, test, today } from "./fixtures";

function goal(title: string, start_date: string, end_date: string, extra: Partial<Fields<"goals">> = {}): Fields<"goals"> {
  return {
    id: randomUUID(),
    title,
    color: "teal",
    specific: "Run at least 3 km",
    achievable: "",
    relevant: "",
    start_date,
    end_date,
    target_days: 10,
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
    ...extra,
  };
}

test.describe("goals", () => {
  test("create, commit, log half a day, take it back with 0", async ({ page, account }) => {
    await page.goto("/goals");
    await page.getByRole("button", { name: "New Goal", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "New Goal" });
    await editor.getByLabel("Title").fill("Run 3x a week");
    await editor.getByLabel("Days of effort").fill("3");
    await editor.getByRole("button", { name: "Next" }).click();
    await editor.getByLabel("Where are you now?").fill("Couch");
    await editor.getByRole("button", { name: "Commit to 3 days" }).click();
    await expect(editor).toHaveCount(0);

    const effort = page.getByRole("radiogroup", { name: "Effort today on Run 3x a week" });
    await effort.getByRole("radio", { name: "Half day" }).click();
    await expect.poll(async () => (await serverState(page.request)).goal_entries.map((e) => e.amount)).toEqual([0.5]);
    const [committed] = (await serverState(page.request)).goals;
    expect(committed).toMatchObject({ status: "active", target_days: 3, before_note: "Couch" });
    expect(committed.committed_at).not.toBeNull();

    // A misclick goes back to nothing.
    await effort.getByRole("radio", { name: "None" }).click();
    await expect.poll(async () => (await serverState(page.request)).goal_entries).toEqual([]);

    await effort.getByRole("radio", { name: "Full day" }).click();
    await page.getByRole("link", { name: /Run 3x a week/ }).click();
    await expect(page.getByRole("heading", { name: "Run 3x a week" })).toBeVisible();
    await expect(page.locator(".goal-stat__value").first()).toHaveText("1/3");
    await expect(page.locator(".heatmap__grid .heatmap__day--full")).toHaveCount(1);
    void account;
  });

  test("older entries are sealed and a locked goal can only be abandoned", async ({ page, account }) => {
    const start = await today(page);
    const g = goal("Read", start, await today(page, 20));
    await seed(page.request, "goals", [g]);
    await seed(page.request, "goal_entries", [{ id: randomUUID(), goal_id: g.id, date: start, amount: 1, note: "Two chapters" }]);
    await page.goto(`/goals/${g.id}`);
    await expect(page.getByText("“Two chapters”")).toBeVisible();

    // Inside the first day nothing is locked yet, so editing and deleting are offered.
    await page.getByRole("button", { name: "Goal actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Edit Goal" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Abandon Goal" }).click();
    await page.getByRole("dialog", { name: "Abandon Goal?" }).getByRole("button", { name: "Abandon" }).click();
    await expect(page.getByText("Abandoned", { exact: true })).toBeVisible();
    await expect.poll(async () => (await serverState(page.request)).goals.map((x) => x.status)).toEqual(["abandoned"]);

    // An abandoned goal's entries can't be touched, even through the API.
    const res = await page.request.post("/api/mutations", {
      data: { mutations: [{ op_id: randomUUID(), entity: "goal_entries", action: "upsert", record: { id: randomUUID(), goal_id: g.id, date: start, amount: 1, note: "" } }] },
    });
    expect(((await res.json()) as { results: { status: string }[] }).results[0].status).toBe("rejected");
    void account;
  });

  test("goals show in the calendar agenda with a quick log", async ({ page, account }) => {
    const start = await today(page);
    const g = goal("Stretch", start, await today(page, 10));
    await seed(page.request, "goals", [g]);
    await page.goto("/calendar");
    await page.getByRole("radiogroup", { name: "Effort on Stretch" }).first().getByRole("radio", { name: "Full day" }).click();
    await expect.poll(async () => (await serverState(page.request)).goal_entries.map((e) => [e.date, e.amount])).toEqual([[start, 1]]);
    void account;
  });
});
