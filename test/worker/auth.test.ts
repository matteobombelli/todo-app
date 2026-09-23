import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hashToken } from "../../worker/auth/session";
import { cookieHeader, jsonRequest, registerAndLogin, request, sessionCookie } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

// D1 state persists across tests within a file, so every registration needs its own email.
let seq = 0;
function uniqueEmail(): string {
  return `u${++seq}@example.com`;
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function tokenOf(cookie: string): string {
  return cookie.slice("todo_session=".length);
}

describe("POST /auth/register", () => {
  it("creates the user and sets the session cookie", async () => {
    const res = await jsonRequest("/auth/register", "POST", {
      email: "New@Example.com ",
      password: "password123",
      inviteCode: "dev-invite",
    });
    expect(res.status).toBe(201);
    const { user } = (await res.json()) as { user: { id: string; email: string; timezone: string } };
    expect(user.email).toBe("new@example.com");
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(user).sort()).toEqual(["email", "id", "timezone"]);

    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    const cookie = cookies[0];
    expect(cookie).toMatch(/^todo_session=[A-Za-z0-9_-]{43}; /);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=7776000");
  });

  it("rejects a bad invite code", async () => {
    const res = await jsonRequest("/auth/register", "POST", {
      email: "a@example.com",
      password: "password123",
      inviteCode: "wrong",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Invalid invite code" });
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects a duplicate email", async () => {
    await registerAndLogin("dup@example.com");
    const res = await jsonRequest("/auth/register", "POST", {
      email: "DUP@example.com",
      password: "password123",
      inviteCode: "dev-invite",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Email already registered" });
  });

  it("validates the body", async () => {
    const res = await jsonRequest("/auth/register", "POST", {
      email: "not-an-email",
      password: "short",
      inviteCode: "dev-invite",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { properties?: Record<string, unknown> } };
    expect(body.error).toBe("Validation failed");
    expect(Object.keys(body.details.properties ?? {}).sort()).toEqual(["email", "password"]);
  });

  it("rejects a non-JSON body", async () => {
    const res = await request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
  });

  it("rejects a body over 2 MB", async () => {
    const res = await jsonRequest("/auth/register", "POST", {
      email: "big@example.com",
      password: "x".repeat(2 * 1024 * 1024 + 1),
      inviteCode: "dev-invite",
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Payload too large" });
  });
});

describe("POST /auth/login", () => {
  it("rejects a wrong password", async () => {
    const email = uniqueEmail();
    await registerAndLogin(email, "password123");
    const res = await jsonRequest("/auth/login", "POST", { email, password: "password124" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid email or password" });
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects an unknown email", async () => {
    const res = await jsonRequest("/auth/login", "POST", { email: "nobody@example.com", password: "password123" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid email or password" });
  });

  it("returns the user and a new session cookie", async () => {
    const email = uniqueEmail();
    const { cookie: first, user } = await registerAndLogin(email, "password123");
    const res = await jsonRequest("/auth/login", "POST", { email: email.toUpperCase(), password: "password123" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user });
    const cookie = sessionCookie(res);
    expect(cookie).not.toBe(first);
    expect(setCookies(res)[0]).toContain("Max-Age=7776000");

    const me = await request("/auth/me", { headers: cookieHeader(cookie) });
    expect(me.status).toBe(200);
  });
});

describe("GET /auth/me", () => {
  it("returns the current user", async () => {
    const { cookie, user } = await registerAndLogin(uniqueEmail());
    const res = await request("/auth/me", { headers: cookieHeader(cookie) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user });
    // A fresh session is not rolled.
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects a missing cookie", async () => {
    const res = await request("/auth/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects an unknown token", async () => {
    await registerAndLogin(uniqueEmail());
    const res = await request("/auth/me", { headers: cookieHeader("todo_session=garbage") });
    expect(res.status).toBe(401);
  });

  it("rejects an expired session and removes it", async () => {
    const { user } = await registerAndLogin(uniqueEmail());
    const token = "expired-token";
    const id = await hashToken(token);
    await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(id, user.id, Date.now() - 91 * DAY, Date.now() - DAY)
      .run();

    const res = await request("/auth/me", { headers: cookieHeader(`todo_session=${token}`) });
    expect(res.status).toBe(401);
    const row = await env.DB.prepare("SELECT id FROM sessions WHERE id = ?").bind(id).first();
    expect(row).toBeNull();
  });

  it("rolls a session last refreshed over a day ago", async () => {
    const { cookie } = await registerAndLogin(uniqueEmail());
    const id = await hashToken(tokenOf(cookie));
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(Date.now() + DAY, id).run();

    const before = Date.now();
    const res = await request("/auth/me", { headers: cookieHeader(cookie) });
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].split(";")[0]).toBe(cookie);
    expect(cookies[0]).toContain("Max-Age=7776000");

    const row = await env.DB.prepare("SELECT expires_at FROM sessions WHERE id = ?")
      .bind(id)
      .first<{ expires_at: number }>();
    expect(row?.expires_at).toBeGreaterThanOrEqual(before + 90 * DAY);
    expect(row?.expires_at).toBeLessThanOrEqual(Date.now() + 90 * DAY);
  });
});

describe("POST /auth/logout", () => {
  it("deletes the session and clears the cookie", async () => {
    const { cookie } = await registerAndLogin(uniqueEmail());
    const res = await request("/auth/logout", { method: "POST", headers: cookieHeader(cookie) });
    expect(res.status).toBe(204);
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^todo_session=; /);
    expect(cookies[0]).toContain("Max-Age=0");
    expect(cookies[0]).toContain("Path=/");
    expect(cookies[0]).toContain("HttpOnly");

    const me = await request("/auth/me", { headers: cookieHeader(cookie) });
    expect(me.status).toBe(401);
  });

  it("sends only the clearing cookie even when the session would have been rolled", async () => {
    const { cookie } = await registerAndLogin(uniqueEmail());
    const id = await hashToken(tokenOf(cookie));
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(Date.now() + DAY, id).run();

    const res = await request("/auth/logout", { method: "POST", headers: cookieHeader(cookie) });
    expect(res.status).toBe(204);
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("Max-Age=0");
  });

  it("requires a session", async () => {
    const res = await request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("router", () => {
  it("returns 404 for unknown API paths", async () => {
    const res = await request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 404 for a known path with the wrong method", async () => {
    const res = await request("/auth/me", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /settings", () => {
  it("defaults the timezone and updates it", async () => {
    const { cookie, user } = await registerAndLogin(uniqueEmail());
    expect(user.timezone).toBe("America/Los_Angeles");
    const res = await jsonRequest("/settings", "PATCH", { timezone: "Europe/Rome" }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { ...user, timezone: "Europe/Rome" } });
    const me = (await (await request("/auth/me", { headers: cookieHeader(cookie) })).json()) as { user: { timezone: string } };
    expect(me.user.timezone).toBe("Europe/Rome");
  });

  it("rejects an unknown timezone", async () => {
    const { cookie } = await registerAndLogin(uniqueEmail());
    const res = await jsonRequest("/settings", "PATCH", { timezone: "Mars/Olympus" }, cookie);
    expect(res.status).toBe(400);
  });
});
