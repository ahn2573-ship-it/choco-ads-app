// 모든 날짜 계산은 Asia/Seoul 기준으로 한다.
// 브라우저 로컬 타임존이 무엇이든 결과가 같아야 한다.

const SEOUL = "Asia/Seoul";

export type RangeKey =
  | "today" | "yesterday" | "last7" | "last30"
  | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
  key: RangeKey;
}

export function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** YYYY-MM-DD 문자열 연산용 — 타임존 영향을 받지 않도록 UTC 정오를 쓴다. */
function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12));
}

export function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const dt = parse(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

export function addMonths(d: string, n: number): string {
  const dt = parse(d);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  return fmt(dt);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86400000);
}

/** 월요일 시작 기준 주의 첫날 */
function startOfWeek(d: string): string {
  const dt = parse(d);
  const dow = (dt.getUTCDay() + 6) % 7; // 월=0
  return addDays(d, -dow);
}

function startOfMonth(d: string): string {
  return d.slice(0, 8) + "01";
}

function endOfMonth(d: string): string {
  const dt = parse(startOfMonth(d));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCDate(0);
  return fmt(dt);
}

export const RANGE_LABELS: Record<Exclude<RangeKey, "custom">, string> = {
  today: "오늘",
  yesterday: "어제",
  last7: "최근 7일",
  last30: "최근 30일",
  thisWeek: "이번 주",
  lastWeek: "지난주",
  thisMonth: "이번 달",
  lastMonth: "지난달",
};

export function resolveRange(key: Exclude<RangeKey, "custom">, today = seoulToday()): DateRange {
  switch (key) {
    case "today":
      return { from: today, to: today, key };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y, key };
    }
    case "last7":
      return { from: addDays(today, -6), to: today, key };
    case "last30":
      return { from: addDays(today, -29), to: today, key };
    case "thisWeek":
      return { from: startOfWeek(today), to: today, key };
    case "lastWeek": {
      const s = addDays(startOfWeek(today), -7);
      return { from: s, to: addDays(s, 6), key };
    }
    case "thisMonth":
      return { from: startOfMonth(today), to: today, key };
    case "lastMonth": {
      const prev = addMonths(startOfMonth(today), -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev), key };
    }
  }
}

export type CompareMode = "prev_period" | "prev_week" | "prev_month" | "none";

export const COMPARE_LABELS: Record<CompareMode, string> = {
  prev_period: "직전 기간 대비",
  prev_week: "전주 동일 기간 대비",
  prev_month: "전월 동일 기간 대비",
  none: "비교 없음",
};

/** 비교 기간을 계산한다. 기간 길이는 항상 동일하게 유지한다. */
export function comparisonRange(range: DateRange, mode: CompareMode): DateRange | null {
  if (mode === "none") return null;
  const span = diffDays(range.from, range.to);

  if (mode === "prev_period") {
    const to = addDays(range.from, -1);
    return { from: addDays(to, -span), to, key: "custom" };
  }
  if (mode === "prev_week") {
    return { from: addDays(range.from, -7), to: addDays(range.to, -7), key: "custom" };
  }
  return { from: addMonths(range.from, -1), to: addMonths(range.to, -1), key: "custom" };
}

export function rangeLabel(r: DateRange): string {
  if (r.from === r.to) return r.from;
  return `${r.from} ~ ${r.to}`;
}
