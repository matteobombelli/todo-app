import { expect, item, list, openTitles, pick, row, rowMenu, seed, serverState, tapTitle, test, today } from "./fixtures";

test.describe("items in a list", () => {
  test("Return adds items in order, leaving the field adds once and closes, Escape discards", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await page.goto(`/todo/${qa.id}`);
    await expect(page.getByRole("heading", { name: "QA" })).toBeVisible();

    await page.getByRole("button", { name: "New item" }).click();
    const draft = page.getByRole("textbox", { name: "New item" });
    await draft.fill("Alpha");
    await draft.press("Enter");
    await draft.fill("Bravo");
    await draft.press("Enter");
    await draft.fill("Charlie");
    // Leaving the field (the old duplicate bug: the row stayed open holding "Charlie").
    await page.getByRole("heading", { name: "QA" }).click();
    await expect(draft).toHaveCount(0);
    await expect.poll(() => openTitles(page)).toEqual(["Alpha", "Bravo", "Charlie"]);

    // Return in an inline edit opens a row below; rapid Returns chain in order.
    await tapTitle(page, "Alpha");
    await page.getByRole("textbox", { name: "Title" }).press("Enter");
    for (const t of ["A1", "A2", "A3"]) {
      await draft.fill(t);
      await draft.press("Enter");
    }
    await draft.fill("discard me");
    await draft.press("Escape");
    await expect(draft).toHaveCount(0);
    await expect.poll(() => openTitles(page)).toEqual(["Alpha", "A1", "A2", "A3", "Bravo", "Charlie"]);

    // Nothing was written twice.
    await expect
      .poll(async () => (await serverState(page.request)).items.filter((i) => !i.deleted_at).map((i) => i.title).sort())
      .toEqual(["A1", "A2", "A3", "Alpha", "Bravo", "Charlie"]);
    void account;
  });

  test("blurring a draft under an item, then refocusing, never duplicates it", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await seed(page.request, "items", [item(qa.id, "First"), item(qa.id, "Second")]);
    await page.goto(`/todo/${qa.id}`);
    await tapTitle(page, "First");
    await page.getByRole("textbox", { name: "Title" }).press("Enter");
    const draft = page.getByRole("textbox", { name: "New item" });
    await draft.fill("Between");
    await draft.evaluate((el: HTMLInputElement) => el.blur());
    await expect(draft).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect.poll(() => openTitles(page)).toEqual(["First", "Between", "Second"]);
    void account;
  });

  test("inline rename, emptied title deletes with Undo", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await seed(page.request, "items", [item(qa.id, "Old name"), item(qa.id, "Doomed")]);
    await page.goto(`/todo/${qa.id}`);

    await tapTitle(page, "Old name");
    const title = page.getByRole("textbox", { name: "Title" });
    await title.fill("New name");
    await title.press("Escape"); // Escape drops the edit
    await expect.poll(() => openTitles(page)).toEqual(["Old name", "Doomed"]);
    await tapTitle(page, "Old name");
    await title.fill("New name");
    await page.getByRole("heading", { name: "QA" }).click(); // blur saves
    await expect.poll(() => openTitles(page)).toEqual(["New name", "Doomed"]);

    await tapTitle(page, "Doomed");
    await title.fill("");
    await title.press("Enter");
    await expect.poll(() => openTitles(page)).toEqual(["New name"]);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => openTitles(page)).toEqual(["New name", "Doomed"]);
    void account;
  });

  test("checking off moves an item to Completed and back", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await seed(page.request, "items", [item(qa.id, "Task")]);
    await page.goto(`/todo/${qa.id}`);
    await page.getByRole("checkbox", { name: 'Mark "Task" done' }).check();
    await expect(page.getByRole("button", { name: "Completed (1)" })).toBeVisible();
    await expect.poll(() => openTitles(page)).toEqual([]);
    await page.getByRole("button", { name: "Completed (1)" }).click();
    // Reopening moves the row out of Completed, so click rather than uncheck (which re-reads it).
    await page.getByRole("checkbox", { name: 'Mark "Task" not done' }).click();
    await expect.poll(() => openTitles(page)).toEqual(["Task"]);
    await expect.poll(async () => (await serverState(page.request)).items[0].completed_at).toBeNull();
    void account;
  });

  test("a repeating item rolls to its next date instead of completing", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    const due = await today(page);
    await seed(page.request, "items", [item(qa.id, "Water plants", { due_date: due, rrule: "FREQ=DAILY" })]);
    await page.goto(`/todo/${qa.id}`);
    await expect(row(page, "Water plants")).toContainText("Today");
    await page.getByRole("checkbox", { name: 'Mark "Water plants" done' }).check();
    await expect(row(page, "Water plants")).toContainText("Tomorrow");
    await expect(page.getByRole("button", { name: /Completed/ })).toHaveCount(0);
    void account;
  });
});

test.describe("item menu", () => {
  test("every rescheduling entry, Choose Date sheet, Remove Time, Remove Date", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await seed(page.request, "items", [item(qa.id, "Task")]);
    await page.goto(`/todo/${qa.id}`);
    const due = async () => (await serverState(page.request)).items[0];

    await rowMenu(page, "Task", "Today");
    await expect.poll(async () => (await due()).due_date).toBe(await today(page));
    await rowMenu(page, "Task", "Tomorrow");
    await expect.poll(async () => (await due()).due_date).toBe(await today(page, 1));
    await rowMenu(page, "Task", "Next Week");
    await expect.poll(async () => (await due()).due_date).toBe(await today(page, 7));

    // Choose Date: an in-app sheet (iOS never opened the native picker from code).
    await rowMenu(page, "Task", "Choose Date…");
    const sheet = page.getByRole("dialog", { name: "Choose Date" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Next month" }).click();
    const target = await page.evaluate(() => {
      const d = new Date();
      const t = new Date(d.getFullYear(), d.getMonth() + 2, 3);
      return {
        iso: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-03`,
        label: t.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
      };
    });
    // Starts from the item's date (a week out), so one "Next month" may or may not reach it.
    if (!(await sheet.getByRole("gridcell", { name: target.label }).isVisible())) await sheet.getByRole("button", { name: "Next month" }).click();
    await sheet.getByRole("gridcell", { name: target.label }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(async () => (await due()).due_date).toBe(target.iso);

    // Escape leaves the date alone.
    await rowMenu(page, "Task", "Choose Date…");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    expect((await due()).due_date).toBe(target.iso);

    // A time, then Remove Time keeps the date.
    await rowMenu(page, "Task", "Edit Details");
    await pick(page.getByRole("dialog", { name: "Details" }), "Time", "14:30");
    await page.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => (await due()).due_time).toBe("14:30");
    await rowMenu(page, "Task", "Remove Time");
    await expect.poll(async () => (await due()).due_time).toBeNull();
    expect((await due()).due_date).toBe(target.iso);

    await rowMenu(page, "Task", "Remove Date");
    await expect.poll(async () => (await due()).due_date).toBeNull();
    void account;
  });

  test("move to another list, subtasks, remove from parent, delete with Undo", async ({ page, account }) => {
    const a = list("Home", 1);
    const b = list("Work", 2, "green");
    await seed(page.request, "lists", [a, b]);
    const parent = item(a.id, "Parent");
    await seed(page.request, "items", [parent, item(a.id, "Child", { parent_id: parent.id }), item(a.id, "Loose")]);
    await page.goto(`/todo/${a.id}`);
    await expect.poll(() => openTitles(page)).toEqual(["Parent", "Child", "Loose"]);

    await rowMenu(page, "Child", "Remove from Parent");
    await expect.poll(async () => (await serverState(page.request)).items.find((i) => i.title === "Child")?.parent_id).toBeNull();

    await rowMenu(page, "Loose", "Move to", "Work");
    await expect.poll(() => openTitles(page)).toEqual(["Parent", "Child"]);
    await expect.poll(async () => (await serverState(page.request)).items.find((i) => i.title === "Loose")?.list_id).toBe(b.id);

    await rowMenu(page, "Parent", "Delete");
    await expect.poll(() => openTitles(page)).toEqual(["Child"]);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => openTitles(page)).toEqual(["Parent", "Child"]);
    void account;
  });
});

test.describe("item editor", () => {
  test("clear buttons empty the time and the date", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    const due = await today(page, 3);
    await seed(page.request, "items", [item(qa.id, "Task", { due_date: due, due_time: "09:15" })]);
    await page.goto(`/todo/${qa.id}`);
    const saved = async () => (await serverState(page.request)).items[0];

    await rowMenu(page, "Task", "Edit Details");
    const dialog = page.getByRole("dialog", { name: "Details" });
    await dialog.getByRole("button", { name: "Clear time" }).click();
    await expect(dialog.getByRole("button", { name: /^Time:/ })).toHaveText("Add time");
    await expect(dialog.getByRole("button", { name: "Clear time" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => (await saved()).due_time).toBeNull();
    expect((await saved()).due_date).toBe(due);

    await rowMenu(page, "Task", "Edit Details");
    await dialog.getByRole("button", { name: "Clear date" }).click();
    await expect(dialog.getByRole("button", { name: /^Due date:/ })).toHaveText("Add date");
    await expect(dialog.getByRole("button", { name: /^Time:/ })).toHaveCount(0);
    await page.keyboard.press("Escape"); // closing saves too
    await expect.poll(async () => (await saved()).due_date).toBeNull();
    void account;
  });

  test("notes, list and repeat are saved as the editor closes", async ({ page, account }) => {
    const a = list("Home", 1);
    const b = list("Work", 2, "green");
    await seed(page.request, "lists", [a, b]);
    await seed(page.request, "items", [item(a.id, "Task")]);
    await page.goto(`/todo/${a.id}`);
    await rowMenu(page, "Task", "Edit Details");
    const dialog = page.getByRole("dialog", { name: "Details" });
    await dialog.getByLabel("Notes").fill("Some notes");
    await pick(dialog, "Due date", await today(page));
    await dialog.getByRole("combobox").first().selectOption("WEEKLY");
    await dialog.getByLabel("List").selectOption({ label: "Work" });
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect
      .poll(async () => {
        const i = (await serverState(page.request)).items[0];
        return [i.notes, i.list_id, i.rrule];
      })
      .toEqual(["Some notes", b.id, expect.stringMatching(/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/)]);
    void account;
  });
});

test.describe("editing safety", () => {
  test("Details keeps a title just typed in place", async ({ page, account, isMobile }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await seed(page.request, "items", [item(qa.id, "Old title")]);
    await page.goto(`/todo/${qa.id}`);
    await tapTitle(page, "Old title");
    await page.getByRole("textbox", { name: "Title" }).fill("New title");
    await page.getByRole("button", { name: "Details" }).click();
    const dialog = page.getByRole("dialog", { name: "Details" });
    await expect(dialog.getByLabel("Title")).toHaveValue("New title");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => (await serverState(page.request)).items[0].title).toBe("New title");
    void account;
    void isMobile;
  });

  test("closing an editor doesn't undo a change made elsewhere meanwhile", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    const task = item(qa.id, "Task", { due_date: await today(page, 1) });
    await seed(page.request, "items", [task]);
    await page.goto(`/todo/${qa.id}`);
    await rowMenu(page, "Task", "Edit Details");
    const dialog = page.getByRole("dialog", { name: "Details" });
    await dialog.getByLabel("Notes").fill("A note");
    // Claude moves it to next week while the editor is open; the app pulls the change.
    const moved = await today(page, 7);
    await seed(page.request, "items", [{ ...task, due_date: moved }]);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(row(page, "Task")).toContainText(/\w/, { timeout: 10_000 });
    await page.waitForTimeout(1000);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => (await serverState(page.request)).items[0]).toMatchObject({ notes: "A note", due_date: moved });
    void account;
  });

  test("a repeat ending before its date is refused, and can be discarded", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await seed(page.request, "items", [item(qa.id, "Task", { due_date: await today(page, 10) })]);
    await page.goto(`/todo/${qa.id}`);
    await rowMenu(page, "Task", "Edit Details");
    const dialog = page.getByRole("dialog", { name: "Details" });
    await dialog.getByLabel("Repeat", { exact: true }).selectOption("DAILY");
    await dialog.getByLabel("Repeat ends").selectOption("until");
    await pick(dialog, "Repeats until", await today(page, 2));
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog.getByRole("alert")).toContainText("repeat must end");
    await dialog.getByRole("button", { name: "Discard changes" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await serverState(page.request)).items[0].rrule).toBeNull();
    void account;
  });
});

