import type { z } from "zod";
import { HttpError } from "./router";

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export async function parseJson<T>(req: Request, schema: z.ZodType<T>, maxBytes = 2 * 1024 * 1024): Promise<T> {
  // Forms cannot send this type and a cross-origin fetch with it needs a preflight, which blocks CSRF.
  const contentType = (req.headers.get("Content-Type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw new HttpError(415, "Expected application/json");
  const declared = Number(req.headers.get("Content-Length"));
  if (declared > maxBytes) throw new HttpError(413, "Payload too large");
  const text = new TextDecoder().decode(await readBounded(req.body, maxBytes, declared));
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  return schema.parse(data);
}

// Reads the whole stream but stops as soon as the running total exceeds the cap, so an
// oversized body with a lying Content-Length is never buffered in full. Each chunk is copied
// into the output as it arrives and then dropped, so the body is only ever held once.
// declaredBytes only sizes the first buffer; the cap still decides what is accepted.
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  declaredBytes = 0,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  let out = new Uint8Array(declaredBytes > 0 && declaredBytes <= maxBytes ? declaredBytes : 0);
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const next = total + value.byteLength;
    if (next > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Payload too large");
    }
    if (next > out.byteLength) {
      let capacity = Math.max(out.byteLength, 64 * 1024);
      while (capacity < next) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(out);
      out = grown;
    }
    out.set(value, total);
    total = next;
  }
  return out.byteLength === total ? out : out.subarray(0, total);
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
