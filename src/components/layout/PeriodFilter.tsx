import { CalendarDays } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import {
  COMPARE_LABELS, RANGE_LABELS, resolveRange, type CompareMode, type RangeKey,
} from "@/lib/dateRange";
import { Select } from "@/components/ui";
import { cn } from "@/lib/cn";

const PRESETS = Object.keys(RANGE_LABELS) as Array<Exclude<RangeKey, "custom">>;

export function PeriodFilter({ showCompare = true }: { showCompare?: boolean }) {
  const { range, setRange, compare, setCompare } = useAppState();

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
          max={range.to}
          onChange={(e) => setRange({ ...range, from: e.target.value, key: "custom" })}
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
          aria-label="시작일"
        />
        <span className="text-xs text-ink-faint">~</span>
        <input
          type="date"
          value={range.to}
          min={range.from}
          onChange={(e) => setRange({ ...range, to: e.target.value, key: "custom" })}
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
