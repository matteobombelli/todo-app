import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test as base, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { Entity, Fields, SyncResponse } from "../shared/entities";

// The invite code POST /api/auth/register wants, from the local secrets wrangler dev reads.
function inviteCode(): string {
  const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  const code = /^REGISTRATION_SECRET=(.*)$/m.exec(vars)?.[1]?.trim();
  if (!code) throw new Error("REGISTRATION_SECRET missing from .dev.vars");
  return code.replace(/^"(.*)"$/, "$1");
}

export interface Account {
  email: string;
  password: string;
}

/** Writes records straight through the mutations API, as another device would. */
export async function seed<E extends Entity>(request: APIRequestContext, entity: E, records: Fields<E>[]): Promise<void> {
  const res = await request.post("/api/mutations", {
    data: { mutations: records.map((record) => ({ op_id: randomUUID(), entity, action: "upsert", record })) },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { results } = (await res.json()) as { results: { status: string; error?: string }[] };
  for (const r of results) expect(r.status, r.error).toBe("applied");
}

export async function serverState(request: APIRequestContext): Promise<SyncResponse> {
  const res = await request.get("/api/sync?since=0");
  expect(res.ok()).toBe(true);
  return (await res.json()) as SyncResponse;
}

export function list(name: string, sort_order = 1, color: Fields<"lists">["color"] = "blue"): Fields<"lists"> {
  return { id: randomUUID(), name, color, sort_order };
}

export function item(list_id: string, title: string, extra: Partial<Fields<"items">> = {}): Fields<"items"> {
  return {
    id: randomUUID(),
    list_id,
    title,
    notes: "",
    due_date: null,
    due_time: null,
    completed_at: null,
    parent_id: null,
    rrule: null,
    position: null,
    ...extra,
  };
}

/** Today on the browser's clock (playwright.config pins the timezone), as the app reads it. */
export async function today(page: Page, offsetDays = 0): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, offsetDays);
}

/** The open items' titles, top to bottom, as the list shows them. */
export function openTitles(page: Page): Promise<string[]> {
  return page.locator(".rows--large").first().locator(":scope > li:not(.rows__draft) .row__title").allInnerTexts();
}

export function row(page: Page, title: string): Locator {
  return page.locator(".rows--large > li").filter({ has: page.locator(".row__title", { hasText: new RegExp(`^${escape(title)}$`) }) });
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Taps an item's title, which edits it in place. */
export async function tapTitle(page: Page, title: string): Promise<void> {
  await row(page, title).locator(".item__body").click();
}

/** Opens a row's actions menu (kebab) and picks an entry, following submenus. */
export async function rowMenu(page: Page, title: string, ...entries: string[]): Promise<void> {
  const target = row(page, title);
  await target.hover();
  await target.getByRole("button", { name: `Actions for "${title}"` }).click();
  for (const entry of entries) await page.getByRole("menu").getByRole("menuitem", { name: entry, exact: true }).click();
}

/**
 * Sets a date or time through its picker (Pickers.tsx): opens the pill named `name`, types `value`
 * ("2026-11-02", "14:30") into the picker's field and presses Return.
 */
export async function pick(scope: Locator, name: string, value: string): Promise<void> {
  await scope.getByRole("button", { name: new RegExp(`^${escape(name)}:`) }).click();
  const field = scope.getByRole("textbox", { name: /^Type a (date|time)$/ });
  await field.fill(value);
  await field.press("Enter");
  await expect(field).toHaveCount(0);
}

/** Long-press drag with a real pointer: hold still past the lift delay, then move and let go. */
export async function longPressDrag(page: Page, from: Locator, to: Locator, share: number): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const x = a.x + Math.min(120, a.width / 3);
  await page.mouse.move(x, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(550);
  const steps = 12;
  const y1 = b.y + b.height * share;
  for (let i = 1; i <= steps; i++) await page.mouse.move(x, a.y + a.height / 2 + ((y1 - a.y - a.height / 2) * i) / steps);
  await page.mouse.up();
}

/** A horizontal touch swipe across a row (the browser has no swipe helper), via CDP touch events. */
export async function swipe(page: Page, target: Locator, dx: number): Promise<void> {
  const box = (await target.boundingBox())!;
  const x0 = box.x + box.width / 2 - dx / 4;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", x0);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", x0 + (dx * i) / 10);
    await page.waitForTimeout(16);
  }
  await touch("touchEnd", x0 + dx);
  await cdp.detach();
}

export const test = base.extend<{ account: Account }>({
  // Signs up a fresh user; the session cookie lands in the page's context.
  account: async ({ page }, use) => {
    const account = { email: `e2e-${randomUUID()}@example.test`, password: `pw-${randomUUID()}` };
    const res = await page.request.post("/api/auth/register", { data: { ...account, inviteCode: inviteCode() } });
    expect(res.status(), await res.text()).toBe(201);
    await use(account);
  },
});

export { expect };
