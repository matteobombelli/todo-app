import { expect, item, list, longPressDrag, seed, serverState, test } from "./fixtures";

test.describe("lists", () => {
  test("create, rename and recolour, delete with Undo", async ({ page, account, isMobile }) => {
    await page.goto("/todo");
    if (isMobile) {
      await expect(page.getByText("No lists yet")).toBeVisible();
      await page.getByRole("button", { name: "New List", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "New list", exact: true }).click();
    }
    const editor = page.getByRole("dialog", { name: "New list" });
    await editor.getByLabel("Name").fill("Groceries");
    await editor.getByRole("radio", { name: "green" }).click();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editor).toHaveCount(0);

    // Desktop jumps to the list; on a phone, open it from the lists page.
    if (isMobile) await page.getByRole("link", { name: /Groceries/ }).click();
    await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
    await expect.poll(async () => (await serverState(page.request)).lists.map((l) => [l.name, l.color])).toEqual([["Groceries", "green"]]);

    await page.getByRole("button", { name: "List actions" }).click();
    await page.getByRole("menuitem", { name: "Edit List" }).click();
    const edit = page.getByRole("dialog", { name: "Edit list" });
    await edit.getByLabel("Name").fill("Shopping");
    await edit.getByRole("radio", { name: "purple" }).click();
    await edit.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("heading", { name: "Shopping" })).toBeVisible();
    await expect.poll(async () => (await serverState(page.request)).lists.map((l) => [l.name, l.color])).toEqual([["Shopping", "purple"]]);

    await page.getByRole("button", { name: "List actions" }).click();
    await page.getByRole("menuitem", { name: "Delete List" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await page.goto("/todo");
    if (isMobile) await expect(page.getByRole("link", { name: /Shopping/ })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Shopping" })).toBeVisible();
    void account;
  });

  test("deleting a list deletes its items once the Undo window passes", async ({ page, account }) => {
    const a = list("Temp");
    await seed(page.request, "lists", [a]);
    await seed(page.request, "items", [item(a.id, "One"), item(a.id, "Two")]);
    await page.goto(`/todo/${a.id}`);
    await page.getByRole("button", { name: "List actions" }).click();
    await page.getByRole("menuitem", { name: "Delete List" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(async () => {
        const s = await serverState(page.request);
        return [s.lists.filter((l) => !l.deleted_at).length, s.items.filter((i) => !i.deleted_at).length];
      })
      .toEqual([0, 0]);
    void account;
  });

  test("lists reorder by long-press drag", async ({ page, account, isMobile }) => {
    test.skip(!isMobile, "the phone lists page; the sidebar has its own rows");
    await seed(page.request, "lists", [list("One", 1), list("Two", 2), list("Three", 3)]);
    await page.goto("/todo");
    const names = () => page.locator(".rows--large .row--link .row__title").allInnerTexts();
    await expect.poll(names).toEqual(["One", "Two", "Three"]);
    const rowOf = (n: string) => page.locator(".rows--large > li").filter({ hasText: n });
    await longPressDrag(page, rowOf("Three"), rowOf("One"), 0.2);
    await expect.poll(names).toEqual(["Three", "One", "Two"]);
    await expect
      .poll(async () => (await serverState(page.request)).lists.sort((x, y) => x.sort_order - y.sort_order).map((l) => l.name))
      .toEqual(["Three", "One", "Two"]);
    void account;
  });
});
