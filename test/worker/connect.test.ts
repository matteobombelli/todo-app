import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { STD_APP_URL } from "../../shared/std";
import { STD_TEST_CODE } from "../std-mock";
import { ORIGIN, connectStd, cookieHeader, registerAndLogin, request } from "./helpers";

const PATH = `/connect/save-the-date?code=${STD_TEST_CODE}`;

function fetchApp(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(ORIGIN + path, { redirect: "manual", ...init }));
}

async function stdDates(cookie: string): Promise<unknown> {
  return (await request("/std/dates?from=2026-09-01&to=2026-09-30", { headers: cookieHeader(cookie) })).json();
}

describe("/connect/save-the-date", () => {
  it("sends a signed-out user to log in, then shows consent", async () => {
    const signedOut = await fetchApp(PATH);
    expect(signedOut.status).toBe(302);
    const login = new URL(signedOut.headers.get("Location")!);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("next")).toBe(PATH);

    const { cookie } = await registerAndLogin("connect-consent@example.com");
    const consent = await fetchApp(PATH, { headers: cookieHeader(cookie) });
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain("Connect Save the Date?");
  });

  it("refuses a cross-origin approval", async () => {
    const { cookie } = await registerAndLogin("connect-forged@example.com");
    const forged = await fetchApp(PATH, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" },
      body: "decision=allow",
    });
    expect(forged.status).toBe(403);
    expect(await stdDates(cookie)).toEqual({ connected: false, events: [] });
  });

  it("connects the account on approval and returns to save-the-date", async () => {
    const { cookie } = await registerAndLogin("connect-ok@example.com");
    expect(await stdDates(cookie)).toEqual({ connected: false, events: [] });

    const approved = await connectStd(cookie);
    expect(approved.status).toBe(302);
    expect(approved.headers.get("Location")).toBe(STD_APP_URL);

    const { events } = (await stdDates(cookie)) as { events: { title: string }[] };
    expect(events.map((e) => e.title)).toEqual(["Picnic", "Tahoe trip"]);
  });

  it("shows an error for a bad code and leaves the account unconnected", async () => {
    const { cookie } = await registerAndLogin("connect-bad@example.com");
    const failed = await connectStd(cookie, "nope");
    expect(failed.status).toBe(400);
    expect(await failed.text()).toContain("invalid or has expired");
    expect(await stdDates(cookie)).toEqual({ connected: false, events: [] });
  });
});
