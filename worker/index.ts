import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { API_PREFIX } from "../shared/api";
import { json } from "./http";
import { mcpApiHandler } from "./mcp";
import { handleAuthorize } from "./routes/authorize";
import { registerAuthRoutes } from "./routes/auth";
import { CONNECT_PATH, handleConnect } from "./routes/connect";
import { registerStdRoutes } from "./routes/std";
import { registerSyncRoutes } from "./routes/sync";
import { Router } from "./router";

const router = new Router();

router.get("/health", async (c) => {
  const d1 = await c.env.DB.prepare("SELECT 1").first().then(() => true, () => false);
  return json({ ok: d1, d1 });
});

registerAuthRoutes(router);
registerSyncRoutes(router);
registerStdRoutes(router);

const app: ExportedHandler<Env> = {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) return router.handle(request, env, ctx);
    if (pathname === "/authorize") return handleAuthorize(request, env as Parameters<typeof handleAuthorize>[1]);
    if (pathname === CONNECT_PATH) return handleConnect(request, env);
    return env.ASSETS.fetch(request);
  },
};

// The provider owns /token, /register and /.well-known/*, checks bearer tokens on /mcp, and hands
// everything else to the app.
export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler,
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
});
