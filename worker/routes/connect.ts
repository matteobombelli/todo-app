import { STD_APP_URL } from "../../shared/std";
import { sessionUser } from "../auth/session";
import { redeemStdCode } from "../services/std";
import { escape, page } from "./authorize";

// GET /connect/save-the-date?code=… shows a consent page for the signed-in user (or sends them to
// log in first); POST from that page redeems the code with save-the-date, which then lists this
// account as connected, and sends the browser back there. Same cookie and Origin protections as
// /authorize: the SameSite=Lax session cookie never rides on a cross-site POST.

export const CONNECT_PATH = "/connect/save-the-date";

export async function handleConnect(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const user = await sessionUser(request, env.DB);
  if (!user) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", url.pathname + url.search);
    return Response.redirect(login.toString(), 302);
  }

  const code = url.searchParams.get("code");
  if (!code) return page("Connection failed", "<h1>Nothing to connect</h1><p>Start from the Todo app panel in Save the Date.</p>", 400);

  if (request.method === "POST") {
    if (request.headers.get("Origin") !== url.origin) return page("Connection failed", "<h1>Connection failed</h1><p>Bad origin.</p>", 403);
    const decision = (await request.formData()).get("decision");
    if (decision !== "allow") return Response.redirect(STD_APP_URL, 302);
    if (!(await redeemStdCode(env, code, user))) {
      return page(
        "Connection failed",
        "<h1>Connection failed</h1><p>The link is invalid or has expired. Start again from Save the Date.</p>",
        400,
      );
    }
    return Response.redirect(STD_APP_URL, 302);
  }

  return page(
    "Connect Save the Date",
    `<h1>Connect Save the Date?</h1>
<p>Its dates will show on your calendar and in your agenda. They stay read-only here, and Save the Date can disconnect this account at any time.</p>
<p class="muted">Signed in as ${escape(user.email)}</p>
<form method="post"><button name="decision" value="deny">Cancel</button><button name="decision" value="allow">Connect</button></form>`,
  );
}
