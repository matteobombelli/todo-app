import { expect, item, list, longPressDrag, openTitles, row, seed, serverState, swipe, tapTitle, test, today } from "./fixtures";

test.describe("long-press drag", () => {
  test("reorders undated items between rows, and nests onto a row's middle", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await seed(page.request, "items", ["A", "B", "C", "D"].map((t) => item(qa.id, t)));
    await page.goto(`/todo/${qa.id}`);
    await expect.poll(() => openTitles(page)).toEqual(["A", "B", "C", "D"]);

    await longPressDrag(page, row(page, "D"), row(page, "A"), 0.1);
    await expect.poll(() => openTitles(page)).toEqual(["D", "A", "B", "C"]);

    await longPressDrag(page, row(page, "D"), row(page, "B"), 0.9);
    await expect.poll(() => openTitles(page)).toEqual(["A", "B", "D", "C"]);

    // The middle of a row makes a subtask.
    await longPressDrag(page, row(page, "C"), row(page, "A"), 0.5);
    await expect
      .poll(async () => (await serverState(page.request)).items.find((i) => i.title === "C")?.parent_id)
      .toBe((await serverState(page.request)).items.find((i) => i.title === "A")?.id);
    await expect.poll(() => openTitles(page)).toEqual(["A", "C", "B", "D"]);

    // The order is stored, so it survives a reload.
    await page.reload();
    await expect.poll(() => openTitles(page)).toEqual(["A", "C", "B", "D"]);
    void account;
  });

  test("reorders items due the same day, but not into another day", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    const d = await today(page, 2);
    const e = await today(page, 3);
    await seed(page.request, "items", [
      item(qa.id, "D1", { due_date: d }),
      item(qa.id, "D2", { due_date: d }),
      item(qa.id, "E1", { due_date: e }),
    ]);
    await page.goto(`/todo/${qa.id}`);
    await expect.poll(() => openTitles(page)).toEqual(["D1", "D2", "E1"]);
    await longPressDrag(page, row(page, "D2"), row(page, "D1"), 0.1);
    await expect.poll(() => openTitles(page)).toEqual(["D2", "D1", "E1"]);
    // E1 dropped at D2's top edge: nothing to reorder there, so it nests (the only valid drop).
    await longPressDrag(page, row(page, "E1"), row(page, "D2"), 0.15);
    await expect.poll(() => openTitles(page)).toEqual(["D2", "E1", "D1"]);
    void account;
  });

  test("a tap right after a drag still works", async ({ page, account }) => {
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await seed(page.request, "items", ["A", "B"].map((t) => item(qa.id, t)));
    await page.goto(`/todo/${qa.id}`);
    await longPressDrag(page, row(page, "B"), row(page, "A"), 0.1);
    await expect.poll(() => openTitles(page)).toEqual(["B", "A"]);
    await tapTitle(page, "A");
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("A");
    void account;
  });
});

test.describe("swipes", () => {
  test("right checks off, left deletes with Undo", async ({ page, account, isMobile }) => {
    test.skip(!isMobile, "touch only");
    const qa = list("QA");
    await seed(page.request, "lists", [qa]);
    await seed(page.request, "items", ["Keep", "Done", "Gone"].map((t) => item(qa.id, t)));
    await page.goto(`/todo/${qa.id}`);
    await expect.poll(() => openTitles(page)).toEqual(["Keep", "Done", "Gone"]);

    await swipe(page, row(page, "Done"), 260);
    await expect.poll(() => openTitles(page)).toEqual(["Keep", "Gone"]);
    await swipe(page, row(page, "Gone"), -260);
    await expect.poll(() => openTitles(page)).toEqual(["Keep"]);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => openTitles(page)).toEqual(["Keep", "Gone"]);
    // A short swipe springs back and does nothing.
    await swipe(page, row(page, "Keep"), 40);
    await page.waitForTimeout(400);
    await expect.poll(() => openTitles(page)).toEqual(["Keep", "Gone"]);
    void account;
  });
});
