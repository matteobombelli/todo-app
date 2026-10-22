import { randomUUID } from "node:crypto";
import { expect, item, list, pick, seed, serverState, test, today } from "./fixtures";

const live = <T extends { deleted_at: number | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);

test.describe("calendar", () => {
  test("views and navigation", async ({ page, account }) => {
    await page.goto("/calendar?view=month");
    const heading = page.getByRole("heading", { level: 1 });
    const month = await page.evaluate(() => new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }));
    await expect(heading).toHaveText(month);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(heading).not.toHaveText(month);
    await page.getByRole("button", { name: "Today" }).click();
    await expect(heading).toHaveText(month);
    await page.getByRole("radio", { name: "Week" }).click();
    await expect(page).toHaveURL(/view=week/);
    await page.getByRole("radio", { name: "Day" }).click();
    await expect(page).toHaveURL(/view=day/);
    await expect(page.getByLabel("Now")).toBeAttached();
    void account;
  });

  test("a new event saves once, even on a double Return; edit; delete with Undo", async ({ page, account }) => {
    await page.goto("/calendar?view=month");
    await page.getByRole("button", { name: "New event or to-do" }).click();
    await page.getByRole("menuitem", { name: "New Event" }).click();
    const editor = page.getByRole("dialog", { name: "New event" });
    await editor.getByLabel("Title").fill("Standup");
    await editor.getByLabel("Title").press("Enter");
    await page.keyboard.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => live((await serverState(page.request)).events).map((e) => e.title)).toEqual(["Standup"]);

    const agenda = page.getByRole("region", { name: /^Agenda for/ });
    await agenda.getByRole("button", { name: /Standup/ }).first().click();
    const edit = page.getByRole("dialog", { name: "Edit event" });
    await edit.getByLabel("Title").fill("Team standup");
    await edit.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => live((await serverState(page.request)).events).map((e) => e.title)).toEqual(["Team standup"]);

    await agenda.getByRole("button", { name: 'Actions for "Team standup"' }).click();
    await page.getByRole("menuitem", { name: "Delete Event" }).click();
    await expect(agenda.getByText("Team standup")).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(agenda.getByText("Team standup")).toBeVisible();
    void account;
  });

  test("an event ending before it starts is refused with a message", async ({ page, account }) => {
    await page.goto("/calendar?view=month");
    await page.getByRole("button", { name: "New event or to-do" }).click();
    await page.getByRole("menuitem", { name: "New Event" }).click();
    const editor = page.getByRole("dialog", { name: "New event" });
    await editor.getByLabel("Title").fill("Backwards");
    await pick(editor, "Start time", "15:00");
    await pick(editor, "End time", "14:00");
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor.locator(".form__error")).toBeVisible();
    await expect(editor).toBeVisible();
    expect(live((await serverState(page.request)).events)).toHaveLength(0);
    void account;
  });

  test("a recurring event: edit this occurrence only, delete all", async ({ page, account }) => {
    const start = await today(page);
    await seed(page.request, "events", [
      { id: randomUUID(), title: "Gym", notes: "", color: "red", all_day: false, start_date: start, start_time: "07:00", end_date: start, end_time: "08:00", rrule: "FREQ=DAILY" },
    ]);
    await page.goto("/calendar?view=month");
    const agenda = page.getByRole("region", { name: /^Agenda for/ });
    await agenda.getByRole("button", { name: /Gym/ }).first().click();
    const edit = page.getByRole("dialog", { name: "Edit event" });
    await edit.getByLabel("Title").fill("Gym (late)");
    await edit.getByRole("button", { name: "Done" }).click();
    await page.getByRole("dialog", { name: "Edit recurring event" }).getByRole("button", { name: "This event" }).click();
    await expect.poll(async () => live((await serverState(page.request)).event_exceptions).map((x) => x.title)).toEqual(["Gym (late)"]);
    expect(live((await serverState(page.request)).events).map((e) => e.title)).toEqual(["Gym"]);

    await agenda.getByRole("button", { name: 'Actions for "Gym (late)"' }).click();
    await page.getByRole("menuitem", { name: "Delete Event" }).click();
    await page.getByRole("dialog", { name: "Delete recurring event" }).getByRole("button", { name: "All events" }).click();
    await expect(agenda.getByText(/Gym/)).toHaveCount(0);
    void account;
  });

  test("new to-do from the calendar, and Choose Date from the agenda", async ({ page, account }) => {
    const a = list("Home");
    await seed(page.request, "lists", [a]);
    await seed(page.request, "items", [item(a.id, "Overdue thing", { due_date: await today(page, -3) })]);
    await page.goto("/calendar?view=month");
    const agenda = page.getByRole("region", { name: /^Agenda for/ });
    await expect(agenda.getByRole("heading", { name: "Overdue" })).toBeVisible();

    await page.getByRole("button", { name: "New event or to-do" }).click();
    await page.getByRole("menuitem", { name: "New To-do" }).click();
    const editor = page.getByRole("dialog", { name: "New to-do" });
    await editor.getByLabel("Title").fill("From calendar");
    await editor.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => live((await serverState(page.request)).items).find((i) => i.title === "From calendar")?.due_date).toBe(await today(page));

    await agenda.getByRole("button", { name: 'Actions for "Overdue thing"' }).click();
    await page.getByRole("menuitem", { name: "Choose Date…" }).click();
    const sheet = page.getByRole("dialog", { name: "Choose Date" });
    await sheet.getByRole("button", { name: "Tomorrow" }).click();
    await expect.poll(async () => live((await serverState(page.request)).items).find((i) => i.title === "Overdue thing")?.due_date).toBe(await today(page, 1));
    await expect(agenda.getByRole("heading", { name: "Overdue" })).toHaveCount(0);
    void account;
  });
  test("moving the start keeps the length; a duration sets the end; Escape closes only the picker", async ({ page, account }) => {
    await page.goto("/calendar?view=month");
    await page.getByRole("button", { name: "New event or to-do" }).click();
    await page.getByRole("menuitem", { name: "New Event" }).click();
    const editor = page.getByRole("dialog", { name: "New event" });
    await editor.getByLabel("Title").fill("Call");
    await pick(editor, "Start time", "2pm");
    await expect(editor.getByRole("button", { name: /^End time:/ })).toHaveText("3:00 PM");

    await editor.getByRole("button", { name: /^End time:/ }).click();
    await editor.getByRole("group", { name: "Duration" }).getByRole("button", { name: "30 min" }).click();
    await expect(editor.getByRole("button", { name: /^End time:/ })).toHaveText("2:30 PM");

    await editor.getByRole("button", { name: /^Start date:/ }).click();
    await editor.getByRole("textbox", { name: "Type a date" }).press("Escape");
    await expect(editor.getByRole("textbox", { name: "Type a date" })).toHaveCount(0);
    await expect(editor).toBeVisible();

    await editor.getByRole("button", { name: "Done" }).click();
    await expect
      .poll(async () => live((await serverState(page.request)).events).map((e) => [e.start_time, e.end_time]))
      .toEqual([["14:00", "14:30"]]);
    void account;
  });

  test("weekly days follow a moved start, and a repeat ending before it starts is refused", async ({ page, account }) => {
    await page.goto("/calendar?view=month");
    await page.getByRole("button", { name: "New event or to-do" }).click();
    await page.getByRole("menuitem", { name: "New Event" }).click();
    const editor = page.getByRole("dialog", { name: "New event" });
    await editor.getByLabel("Title").fill("Class");
    await pick(editor, "Start date", "2026-11-02"); // a Monday
    await editor.getByLabel("Repeat", { exact: true }).selectOption("WEEKLY");
    await expect(editor.getByRole("button", { name: "MO", exact: true })).toHaveAttribute("aria-pressed", "true");
    await pick(editor, "Start date", "2026-11-04"); // a Wednesday
    await expect(editor.getByRole("button", { name: "WE", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(editor.getByRole("button", { name: "MO", exact: true })).toHaveAttribute("aria-pressed", "false");

    await editor.getByLabel("Repeat ends").selectOption("until");
    await pick(editor, "Repeats until", "2026-11-01");
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor.getByRole("alert")).toContainText("repeat must end");
    await pick(editor, "Repeats until", "2026-12-31");
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor).toHaveCount(0);
    await expect
      .poll(async () => live((await serverState(page.request)).events).map((e) => [e.start_date, e.rrule]))
      .toEqual([["2026-11-04", "FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231"]]);
    void account;
  });
});
