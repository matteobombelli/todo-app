import { AuthorizationError, type AuthRequest, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { sessionUser } from "../auth/session";
import type { McpProps } from "../mcp";

// GET /authorize shows a consent page for the signed-in user (or sends them to log in first);
// POST /authorize, submitted from that page to the same URL, grants or denies. The session cookie
// is SameSite=Lax, so a cross-site POST arrives without it and cannot grant anything.

type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:1rem;background:light-dark(#fff,#17171b);color:light-dark(#1b1b1f,#ececf1)}
main{max-width:22rem;display:flex;flex-direction:column;gap:.75rem;padding:1.5rem;border:1.5px solid light-dark(#e1e1e8,#33333d);border-radius:12px}
h1{font-size:1.2rem;margin:0}p{margin:0}.muted{color:light-dark(#6b6b76,#9a9aa6);font-size:.875rem}
form{display:flex;gap:.5rem;justify-content:flex-end}
button{font:inherit;padding:.45rem .9rem;border-radius:12px;border:1.5px solid light-dark(#e1e1e8,#33333d);background:transparent;color:inherit;cursor:pointer}
button[value=allow]{background:light-dark(#3b6fd6,#7fa6f0);border-color:transparent;color:light-dark(#fff,#17171b)}
</style></head><body><main>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Cache-Control": "no-store" } },
  );
}

function errorRedirect(req: AuthRequest, code: string): Response {
  const redirect = new URL(req.redirectUri);
  redirect.searchParams.set("error", code);
  if (req.state) redirect.searchParams.set("state", req.state);
  if (req.issuer) redirect.searchParams.set("iss", req.issuer);
  return Response.redirect(redirect.toString(), 302);
}

export async function handleAuthorize(request: Request, env: OAuthEnv): Promise<Response> {
  const url = new URL(request.url);
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (!error.redirectUri) return page("Authorization failed", `<h1>Authorization failed</h1><p>${escape(error.description)}</p>`, 400);
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set("error", error.code);
    redirect.searchParams.set("error_description", error.description);
    if (error.state) redirect.searchParams.set("state", error.state);
    if (error.issuer) redirect.searchParams.set("iss", error.issuer);
    return Response.redirect(redirect.toString(), 302);
  }

  const user = await sessionUser(request, env.DB);
  if (!user) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", url.pathname + url.search);
    return Response.redirect(login.toString(), 302);
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  const clientName = client?.clientName || "An MCP client";

  if (request.method === "POST") {
    if (request.headers.get("Origin") !== url.origin) return page("Authorization failed", "<h1>Authorization failed</h1><p>Bad origin.</p>", 403);
    const decision = (await request.formData()).get("decision");
    if (decision !== "allow") return errorRedirect(oauthRequest, "access_denied");
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthRequest,
      userId: user.id,
      metadata: { clientName },
      scope: oauthRequest.scope,
      props: { userId: user.id } satisfies McpProps,
    });
    return Response.redirect(redirectTo, 302);
  }

  return page(
    "Allow access",
    `<h1>Allow ${escape(clientName)}?</h1>
<p>It will be able to read and change your lists, items and calendar events, and read your Save the Date dates.</p>
<p class="muted">Signed in as ${escape(user.email)}</p>
<form method="post"><button name="decision" value="deny">Deny</button><button name="decision" value="allow">Allow</button></form>`,
  );
}
