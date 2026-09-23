import { addDays, daysBetween, daysInMonth, toMinutes, weekStart } from "../../shared/dates";

/** First days (Sundays) of the weeks that cover the month containing `date`. */
export function monthWeeks(date: string): string[] {
  const first = `${date.slice(0, 7)}-01`;
  const last = addDays(first, daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7))) - 1);
  const weeks: string[] = [];
  for (let start = weekStart(first); start <= last; start = addDays(start, 7)) weeks.push(start);
  return weeks;
}

export interface Span {
  start_date: string;
  end_date: string;
}

export interface PlacedBar<T> {
  item: T;
  /** 0-based first and last day columns within the row. */
  startCol: number;
  endCol: number;
  lane: number;
}

/** Clips spans to the `days`-long row starting at rowStart and packs them into the fewest lanes. */
export function placeBars<T extends Span>(items: T[], rowStart: string, days: number): PlacedBar<T>[] {
  const rowEnd = addDays(rowStart, days - 1);
  const visible = items
    .filter((i) => i.start_date <= rowEnd && i.end_date >= rowStart)
    .map((item) => ({
      item,
      startCol: Math.max(0, daysBetween(rowStart, item.start_date)),
      endCol: Math.min(days - 1, daysBetween(rowStart, item.end_date)),
    }))
    // Longer spans first at the same start, so they take the upper lanes.
    .sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol);
  const laneEnds: number[] = [];
  return visible.map((bar) => {
    let lane = laneEnds.findIndex((end) => end < bar.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = bar.endCol;
    return { ...bar, lane };
  });
}

export interface TimedSpan {
  start_date: string;
  start_time: string | null;
  end_date: string;
  end_time: string | null;
}

export interface PlacedBlock<T> {
  item: T;
  /** Minutes since midnight on this day. */
  top: number;
  bottom: number;
  column: number;
  columns: number;
}

const MIN_BLOCK_MINUTES = 20;

/**
 * Lays out one day's timed spans: each is clipped to the day (so events crossing midnight appear on
 * both days), and overlapping ones share the width side by side.
 */
export function placeBlocks<T extends TimedSpan>(items: T[], date: string): PlacedBlock<T>[] {
  const segments = items
    .filter((i) => i.start_date <= date && i.end_date >= date)
    .map((item) => {
      const top = item.start_date === date ? toMinutes(item.start_time ?? "00:00") : 0;
      const end = item.end_date === date ? toMinutes(item.end_time ?? "00:00") : 24 * 60;
      return { item, top, end };
    })
    // An event ending at midnight leaves nothing on the next day; a zero-length one still shows on its own.
    .filter((s) => s.end > s.top || s.item.start_date === date)
    .map((s) => ({ item: s.item, top: s.top, bottom: Math.min(24 * 60, Math.max(s.end, s.top + MIN_BLOCK_MINUTES)) }))
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  const out: PlacedBlock<T>[] = [];
  let cluster: PlacedBlock<T>[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];
  const closeCluster = () => {
    for (const block of cluster) block.columns = columnEnds.length;
    out.push(...cluster);
    cluster = [];
    columnEnds = [];
  };
  for (const s of segments) {
    if (s.top >= clusterEnd) closeCluster();
    let column = columnEnds.findIndex((end) => end <= s.top);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = s.bottom;
    cluster.push({ ...s, column, columns: 0 });
    clusterEnd = Math.max(clusterEnd, s.bottom);
  }
  closeCluster();
  return out;
}
