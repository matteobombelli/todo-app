import { z } from "zod";
import { API_PREFIX } from "../shared/api";

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  exec: ExecutionContext;
  // Anything appended here (e.g. Set-Cookie) is merged onto the handler's Response by Router.handle.
  responseHeaders: Headers;
}

export type Handler = (c: Ctx) => Promise<Response> | Response;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Routes match exact paths; no route needs parameters.
interface Route {
  method: string;
  path: string;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  private add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, path: pattern, handler });
    return this;
  }

  get(pattern: string, h: Handler): this {
    return this.add("GET", pattern, h);
  }
  post(pattern: string, h: Handler): this {
    return this.add("POST", pattern, h);
  }
  patch(pattern: string, h: Handler): this {
    return this.add("PATCH", pattern, h);
  }

  async handle(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.slice(API_PREFIX.length);
    const c: Ctx = { req, env, url, exec, responseHeaders: new Headers() };
    try {
      const res = await this.dispatch(c, path);
      return mergeHeaders(res, c.responseHeaders);
    } catch (err) {
      return mergeHeaders(errorResponse(err), c.responseHeaders);
    }
  }

  private dispatch(c: Ctx, path: string): Promise<Response> | Response {
    const isHead = c.req.method === "HEAD";
    for (const route of this.routes) {
      if (route.method !== (isHead ? "GET" : c.req.method) || route.path !== path) continue;
      const res = route.handler(c);
      return isHead ? Promise.resolve(res).then(withoutBody) : res;
    }
    throw new HttpError(404, "Not found");
  }
}

// A HEAD answers exactly as the GET would, headers included, with the body dropped. Cancelling
// releases any upstream stream now instead of leaving it to be collected.
function withoutBody(res: Response): Response {
  void res.body?.cancel();
  return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const body = err.details === undefined ? { error: err.message } : { error: err.message, details: err.details };
    return Response.json(body, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return Response.json({ error: "Validation failed", details: z.treeifyError(err) }, { status: 400 });
  }
  console.error(err);
  return Response.json({ error: "Internal error" }, { status: 500 });
}

function mergeHeaders(res: Response, extra: Headers): Response {
  if ([...extra].length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of extra) {
    if (k.toLowerCase() === "set-cookie") continue;
    headers.append(k, v);
  }
  // Each Set-Cookie must stay a separate header; iterating a Headers object may fold them into one value.
  for (const cookie of extra.getSetCookie()) headers.append("Set-Cookie", cookie);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
