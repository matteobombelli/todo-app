import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEFAULT_TIMEZONE } from "../../shared/api";
import type { Goal, GoalEntry, List } from "../../shared/entities";
import type { Now } from "../../shared/items";
import { makeDate, nowIn } from "../../shared/dates";
import { useAuth } from "../auth/AuthProvider";
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

export function useGoals(): Goal[] {
  const { goals } = useData().tables;
  return useMemo(() => Object.values(goals).sort((a, b) => a.end_date.localeCompare(b.end_date) || a.created_at - b.created_at), [goals]);
}

export function useGoalEntries(): GoalEntry[] {
  const { goal_entries } = useData().tables;
  return useMemo(() => Object.values(goal_entries), [goal_entries]);
}

/**
 * Today for goals: in the account's timezone rather than the device's, since that's the day the
 * server lets effort be logged for.
 */
export function useGoalToday(): string {
  const { user } = useAuth();
  const now = useNow();
  return useMemo(() => {
    void now;
    return nowIn(user?.timezone ?? DEFAULT_TIMEZONE).date;
  }, [user?.timezone, now]);
}
