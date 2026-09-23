import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Mutation } from "../../shared/entities";
import { applyMutations, listRecords } from "../../worker/services/records";
import { registerAndLogin } from "./helpers";

const list = (id: string, name: string): Mutation => ({
  op_id: crypto.randomUUID(),
  entity: "lists",
  action: "upsert",
  record: { id, name, color: "blue", sort_order: 1 },
});

const item = (listId: string, title: string): Mutation => ({
  op_id: crypto.randomUUID(),
  entity: "items",
  action: "upsert",
  record: { id: crypto.randomUUID(), list_id: listId, title, notes: "", due_date: null, due_time: null, completed_at: null },
});

const seqOf = async (userId: string) =>
  (await env.DB.prepare("SELECT value FROM user_seq WHERE user_id = ?").bind(userId).first<{ value: number }>())!.value;

describe("applyMutations", () => {
  it("lets a later op see an earlier one and stamps the batch with one seq", async () => {
    const { user } = await registerAndLogin("batch-ok@example.com");
    const listId = crypto.randomUUID();
    const outcome = await applyMutations(env.DB, user.id, [list(listId, "New"), item(listId, "In the new list")]);

    expect(outcome.applied).toBe(true);
    expect(await seqOf(user.id)).toBe(1);
    const items = await listRecords(env.DB, user.id, "items");
    expect(items.map((i) => [i.title, i.seq])).toEqual([["In the new list", 1]]);
  });

  it("writes nothing when one op is rejected", async () => {
    const { user } = await registerAndLogin("batch-rejected@example.com");
    const listId = crypto.randomUUID();
    const outcome = await applyMutations(env.DB, user.id, [list(listId, "Kept?"), item(crypto.randomUUID(), "Orphan")]);

    expect(outcome).toMatchObject({
      applied: false,
      rejected: [{ index: 1, result: { status: "rejected", error: "list_id does not name a live list" } }],
    });
    expect(await seqOf(user.id)).toBe(0);
    expect(await listRecords(env.DB, user.id, "lists")).toEqual([]);
  });

  it("rejects an op on a record the same batch deleted", async () => {
    const { user } = await registerAndLogin("batch-deleted@example.com");
    const listId = crypto.randomUUID();
    await applyMutations(env.DB, user.id, [list(listId, "Doomed")]);
    const outcome = await applyMutations(env.DB, user.id, [
      { op_id: crypto.randomUUID(), entity: "lists", action: "delete", record: { id: listId } },
      item(listId, "Too late"),
    ]);

    expect(outcome).toMatchObject({ applied: false, rejected: [{ index: 1 }] });
    expect((await listRecords(env.DB, user.id, "lists")).map((l) => l.name)).toEqual(["Doomed"]);
  });
});
