import { useEffect, useMemo, useState } from "react";
import type { ExternalEvent } from "../../shared/agenda";
import { occurrencesInRange, type Occurrence } from "../../shared/recurrence";
import { api } from "../api/client";
import { useData } from "../data/hooks";
import { store } from "../data/instance";

export const STD_APP_URL = "https://apps.matteob.dev/projects/savethedate/";

export function useOccurrences(from: string, to: string): Occurrence[] {
  const { events, event_exceptions } = useData().tables;
  return useMemo(
    () => occurrencesInRange(Object.values(events), Object.values(event_exceptions), from, to),
    [events, event_exceptions, from, to],
  );
}

/** Save-the-date entries overlapping [from, to]; the last fetch of the same range while offline. */
export function useStdDates(from: string, to: string): ExternalEvent[] {
  const key = `${from}..${to}`;
  const [state, setState] = useState<{ key: string; events: ExternalEvent[] }>({ key, events: [] });

  useEffect(() => {
    let cancelled = false;
    const show = (events: ExternalEvent[]) => {
      if (!cancelled) setState({ key, events });
    };
    void store.cacheGet<ExternalEvent[]>(key).then((cached) => cached && show(cached));
    api<{ events: ExternalEvent[] }>(`/std/dates?from=${from}&to=${to}`)
      .then(({ events }) => {
        show(events);
        return store.cachePut(key, events);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, from, to]);

  return state.key === key ? state.events : [];
}
