import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { List } from "../../shared/entities";
import type { Now } from "../../shared/items";
import { makeDate } from "../../shared/dates";
import { store } from "./instance";
import type { Snapshot } from "./store";

export function useData(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useLists(): List[] {
  const { lists } = useData().tables;
  return useMemo(
    () => Object.values(lists).sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at),
    [lists],
  );
}

/** The device's wall-clock date and time; floating dates are read in the device's timezone. */
export function localNow(d = new Date()): Now {
  return {
    date: makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate()),
    time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
  };
}

/** localNow, refreshed at the start of every minute. */
export function useNow(): Now {
  const [now, setNow] = useState(localNow);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow((prev) => {
        const next = localNow();
        return next.date === prev.date && next.time === prev.time ? prev : next;
      });
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return now;
}
