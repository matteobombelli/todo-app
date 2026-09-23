import { API_PREFIX } from "../../shared/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiInit {
  method?: string;
  body?: unknown;
}

// Fired on any 401 so AuthProvider can drop the cached user.
export const UNAUTHORIZED_EVENT = "todo:unauthorized";

/** Online-only calls (auth, settings, save-the-date). Records go through the DataStore instead. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const err = (payload ?? {}) as { error?: string; details?: unknown };
    throw new ApiError(res.status, err.error ?? res.statusText, err.details);
  }
  return payload as T;
}
