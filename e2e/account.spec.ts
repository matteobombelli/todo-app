import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, item, list, openTitles, seed, serverState, test } from "./fixtures";

const invite = () => /^REGISTRATION_SECRET=(.*)$/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))![1].trim();

test.describe("accounts", () => {
  test("sign up, log out, bad password, log in again", async ({ page }) => {
    const email = `e2e-${randomUUID()}@example.test`;
    const password = `pw-${randomUUID()}`;
    await page.goto("/todo");
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole("link", { name: "Register" }).click();
    await expect(page.getByRole("heading", { name: "Register" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByLabel("Invite code").fill("wrong-code");
    await page.getByRole("button", { name: /Register|Sign up|Create/ }).click();
    await expect(page.getByRole("alert").or(page.locator(".form__error"))).toBeVisible();
    await page.getByLabel("Invite code").fill(invite());
    await page.getByRole("button", { name: /Register|Sign up|Create/ }).click();
    await expect(page).not.toHaveURL(/\/(signup|login)/);

    await page.getByRole("button", { name: "Settings" }).first().click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert").or(page.locator(".form__error"))).toBeVisible();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("logging out clears the offline copy, so the next user sees only their own data", async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const makeUser = async (name: string) => {
      const creds = { email: `e2e-${randomUUID()}@example.test`, password: `pw-${randomUUID()}` };
      await page.request.post("/api/auth/register", { data: { ...creds, inviteCode: invite() } });
      const l = list(name);
      await seed(page.request, "lists", [l]);
      await seed(page.request, "items", [item(l.id, `${name} secret`)]);
      return { ...creds, list: l };
    };
    const first = await makeUser("First");
    await page.goto(`/todo/${first.list.id}`);
    await expect.poll(() => openTitles(page)).toEqual(["First secret"]);
    // On a phone Settings is on the top-level pages.
    await page.getByRole("link", { name: "Calendar" }).click();
    await page.getByRole("button", { name: "Settings" }).first().click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);

    const second = await makeUser("Second");
    await page.goto(`/todo/${first.list.id}`);
    // The first user's list isn't there for the second.
    await expect(page.getByText("First secret")).toHaveCount(0);
    await page.goto(`/todo/${second.list.id}`);
    await expect.poll(() => openTitles(page)).toEqual(["Second secret"]);
    await context.close();
  });

  test("settings persist", async ({ page, account }) => {
    await page.goto("/calendar");
    await page.getByRole("button", { name: "Settings" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("combobox").nth(1).selectOption("15");
    await dialog.getByRole("combobox").nth(2).selectOption("");
    await expect
      .poll(async () => (await (await page.request.get("/api/auth/me")).json()).user)
      .toMatchObject({ event_reminder_minutes: 15, item_reminder_time: null });
    await page.reload();
    await page.getByRole("button", { name: "Settings" }).first().click();
    await expect(dialog.getByRole("combobox").nth(1)).toHaveValue("15");
    await expect(dialog.getByRole("combobox").nth(2)).toHaveValue("");
    void account;
  });

  test("another user's records can't be read or written", async ({ page, account, browser }) => {
    const mine = list("Mine");
    await seed(page.request, "lists", [mine]);
    const other = await browser.newContext({ serviceWorkers: "block" });
    const otherPage = await other.newPage();
    await otherPage.request.post("/api/auth/register", {
      data: { email: `e2e-${randomUUID()}@example.test`, password: `pw-${randomUUID()}`, inviteCode: invite() },
    });
    // Overwriting my list by id, and adding an item to it, from another account.
    const res = await otherPage.request.post("/api/mutations", {
      data: {
        mutations: [
          { op_id: randomUUID(), entity: "lists", action: "upsert", record: { ...mine, name: "Hijacked" } },
          { op_id: randomUUID(), entity: "items", action: "upsert", record: item(mine.id, "Planted") },
          { op_id: randomUUID(), entity: "lists", action: "delete", record: { id: mine.id } },
        ],
      },
    });
    const results = (await res.json()).results as { status: string }[];
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect((await (await otherPage.request.get("/api/sync?since=0")).json()).lists).toEqual([]);
    const state = await serverState(page.request);
    expect(state.lists.map((l) => [l.name, l.deleted_at])).toEqual([["Mine", null]]);
    expect(state.items).toEqual([]);
    await other.close();
    void account;
  });
});

test.describe("sync", () => {
  test("a change from another device shows up; an offline edit syncs once back online", async ({ page, account, context }) => {
    const a = list("Shared");
    await seed(page.request, "lists", [a]);
    await page.goto(`/todo/${a.id}`);
    await seed(page.request, "items", [item(a.id, "From elsewhere")]);
    // The app pulls when it becomes visible again (and every minute).
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => openTitles(page), { timeout: 15_000 }).toEqual(["From elsewhere"]);

    await context.setOffline(true);
    await page.getByRole("button", { name: "New item" }).click();
    await page.getByRole("textbox", { name: "New item" }).fill("Written offline");
    await page.getByRole("textbox", { name: "New item" }).press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(() => openTitles(page)).toEqual(["From elsewhere", "Written offline"]);
    await page.waitForTimeout(800);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(async () => (await serverState(page.request)).items.map((i) => i.title).sort(), { timeout: 15_000 })
      .toEqual(["From elsewhere", "Written offline"]);
    void account;
  });
});
