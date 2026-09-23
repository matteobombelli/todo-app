import { MutationBatch, type MutationResult } from "../../shared/entities";
import { requireUser } from "../auth/session";
import { json, parseJson } from "../http";
import { HttpError, type Router } from "../router";
import { applyMutation, pruneAppliedOps, readSince } from "../services/records";

export function registerSyncRoutes(r: Router): void {
  r.get("/sync", async (c) => {
    const user = await requireUser(c);
    const since = Number(c.url.searchParams.get("since") ?? "0");
    if (!Number.isInteger(since) || since < 0) throw new HttpError(400, "Bad since");
    return json(await readSince(c.env.DB, user.id, since));
  });

  // Applied in order, one at a time, so a later op sees the earlier ones (an item after its list).
  r.post("/mutations", async (c) => {
    const user = await requireUser(c);
    const { mutations } = await parseJson(c.req, MutationBatch);
    const results: MutationResult[] = [];
    for (const m of mutations) results.push(await applyMutation(c.env.DB, user.id, m));
    c.exec.waitUntil(pruneAppliedOps(c.env.DB));
    return json({ results });
  });
}
