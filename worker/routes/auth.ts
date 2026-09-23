import { DEFAULT_TIMEZONE, LoginBody, RegisterBody, SettingsBody, type User } from "../../shared/api";
import { newId } from "../../shared/ids";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../auth/password";
import { createSession, destroySession, requireUser } from "../auth/session";
import { json, parseJson } from "../http";
import { HttpError, type Router } from "../router";

interface UserRow {
  id: string;
  email: string;
  timezone: string;
  password_hash: string;
}

export function registerAuthRoutes(r: Router): void {
  r.post("/auth/register", async (c) => {
    const body = await parseJson(c.req, RegisterBody);
    if (body.inviteCode !== c.env.REGISTRATION_SECRET) throw new HttpError(403, "Invalid invite code");
    const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(body.email).first();
    if (existing) throw new HttpError(409, "Email already registered");
    const user: User = { id: newId(), email: body.email, timezone: DEFAULT_TIMEZONE };
    try {
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO users (id, email, password_hash, timezone, created_at) VALUES (?, ?, ?, ?, ?)").bind(
          user.id,
          user.email,
          await hashPassword(body.password),
          user.timezone,
          Date.now(),
        ),
        c.env.DB.prepare("INSERT INTO user_seq (user_id, value) VALUES (?, 0)").bind(user.id),
      ]);
    } catch (err) {
      // Two concurrent registrations can both pass the SELECT above; the UNIQUE index settles it.
      if (err instanceof Error && err.message.includes("UNIQUE")) throw new HttpError(409, "Email already registered");
      throw err;
    }
    await createSession(c, user.id);
    return json({ user }, 201);
  });

  r.post("/auth/login", async (c) => {
    const body = await parseJson(c.req, LoginBody);
    const row = await c.env.DB.prepare("SELECT id, email, timezone, password_hash FROM users WHERE email = ?")
      .bind(body.email)
      .first<UserRow>();
    const ok = await verifyPassword(body.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, "Invalid email or password");
    await createSession(c, row.id);
    return json({ user: { id: row.id, email: row.email, timezone: row.timezone } satisfies User });
  });

  r.post("/auth/logout", async (c) => {
    await requireUser(c);
    await destroySession(c);
    return new Response(null, { status: 204 });
  });

  r.get("/auth/me", async (c) => {
    const user = await requireUser(c);
    return json({ user });
  });

  r.patch("/settings", async (c) => {
    const user = await requireUser(c);
    const body = await parseJson(c.req, SettingsBody);
    await c.env.DB.prepare("UPDATE users SET timezone = ? WHERE id = ?").bind(body.timezone, user.id).run();
    return json({ user: { ...user, timezone: body.timezone } satisfies User });
  });
}
