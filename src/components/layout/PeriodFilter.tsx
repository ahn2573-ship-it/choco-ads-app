import { CalendarDays } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import {
  COMPARE_LABELS, RANGE_LABELS, resolveRange, seoulToday, type CompareMode, type RangeKey,
} from "@/lib/dateRange";
import { Select } from "@/components/ui";
import { cn } from "@/lib/cn";

const PRESETS = Object.keys(RANGE_LABELS) as Array<Exclude<RangeKey, "custom">>;

export function PeriodFilter({ showCompare = true }: { showCompare?: boolean }) {
  const { range, setRange, compare, setCompare } = useAppState();
  const today = seoulToday();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
      <CalendarDays className="h-4 w-4 text-ink-faint" />

      <div className="flex flex-wrap gap-1">
        {PRESETS.map((key) => (
          <button
            key={key}
            onClick={() => setRange(resolveRange(key))}
            className={cn(
              "rounded px-2 py-1 text-xs transition-colors",
              range.key === key
                ? "bg-brand-500 font-medium text-white"
                : "text-ink-muted hover:bg-surface-sunken",
            )}
          >
            {RANGE_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={range.from}
          max={today}
          onChange={(e) => {
            const from = e.target.value;
            // 시작일이 종료일보다 뒤로 가면 종료일도 같이 맞춘다 (서로를 막지 않게)
            const to = from > range.to ? from : range.to;
            setRange({ ...range, from, to, key: "custom" });
          }}
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
          aria-label="시작일"
        />
        <span className="text-xs text-ink-faint">~</span>
        <input
          type="date"
          value={range.to}
          min={range.from}
          max={today}
          onChange={(e) => {
            const to = e.target.value;
            const from = to < range.from ? to : range.from;
            setRange({ ...range, from, to, key: "custom" });
          }}
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
          aria-label="종료일"
        />

        {showCompare && (
          <Select
            className="h-8 text-xs"
            value={compare}
            onChange={(e) => setCompare(e.target.value as CompareMode)}
            aria-label="비교 기간"
          >
            {(Object.keys(COMPARE_LABELS) as CompareMode[]).map((m) => (
              <option key={m} value={m}>{COMPARE_LABELS[m]}</option>
            ))}
          </Select>
        )}
      </div>
    </div>
  );
}
