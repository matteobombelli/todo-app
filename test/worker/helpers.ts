import { exports } from "cloudflare:workers";

interface TestUser {
  id: string;
  email: string;
  timezone: string;
}

export const API = "https://todo.matteob.dev/api";

export function request(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(API + path, init));
}

export function cookieHeader(cookie: string): Record<string, string> {
  return { Cookie: cookie };
}

export function jsonRequest(
  path: string,
  method: string,
  body?: unknown,
  cookie?: string,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The "todo_session=<value>" pair from a Set-Cookie header, ready to send back as Cookie. */
export function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on response");
  const pair = setCookie.split(";")[0];
  if (!pair.startsWith("todo_session=")) throw new Error(`unexpected Set-Cookie: ${setCookie}`);
  return pair;
}

export async function registerAndLogin(
  email = "u1@example.com",
  password = "password123",
): Promise<{ cookie: string; user: TestUser }> {
  const res = await jsonRequest("/auth/register", "POST", {
    email,
    password,
    inviteCode: "dev-invite",
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const cookie = sessionCookie(res);
  const { user } = (await res.json()) as { user: TestUser };
  return { cookie, user };
}
