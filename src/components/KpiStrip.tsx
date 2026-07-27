import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { delta } from "@/lib/metrics";
import { num, pct, roasPct, signedPct, won } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DailyPoint, PeriodSummary } from "@/lib/types";
import { Skeleton } from "@/components/ui";

type Fmt = "int" | "won" | "pct" | "roas";

interface KpiDef {
  key: keyof PeriodSummary;
  label: string;
  fmt: Fmt;
}

const KPIS: KpiDef[] = [
  { key: "impressions", label: "총 노출수", fmt: "int" },
  { key: "clicks", label: "총 클릭수", fmt: "int" },
  { key: "ctr", label: "CTR", fmt: "pct" },
  { key: "cost", label: "총 광고비", fmt: "won" },
  { key: "cpc", label: "CPC", fmt: "won" },
  { key: "conv_count", label: "구매완료 전환수", fmt: "int" },
  { key: "conv_revenue", label: "구매완료 매출", fmt: "won" },
  { key: "conv_roas", label: "구매완료 ROAS", fmt: "roas" },
  { key: "total_conv_count", label: "총 전환수", fmt: "int" },
  { key: "total_conv_revenue", label: "총 전환매출", fmt: "won" },
  { key: "total_roas", label: "총 전환 ROAS", fmt: "roas" },
];

function format(v: number, fmt: Fmt) {
  switch (fmt) {
    case "won": return won(v);
    case "pct": return pct(v);
    case "roas": return roasPct(v);
    default: return num(v);
  }
}

const TONE = {
  good: "text-good bg-good-soft",
  bad: "text-bad bg-bad-soft",
  flat: "text-ink-faint bg-surface-sunken",
};

export function KpiStrip({
  current, previous, series, compareLabel, loading,
}: {
  current?: PeriodSummary;
  previous?: PeriodSummary;
  series?: DailyPoint[];
  compareLabel: string;
  loading?: boolean;
}) {
  if (loading || !current) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
        {KPIS.map((k) => <Skeleton key={k.key} className="h-24 rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
      {KPIS.map((kpi) => {
        const value = Number(current[kpi.key] ?? 0);
        const prev = previous ? Number(previous[kpi.key] ?? 0) : null;
        const d = prev === null ? null : delta(value, prev, kpi.key as string);
        const spark = (series ?? []).map((p) => ({ v: Number(p[kpi.key] ?? 0) }));

        return (
          <div key={kpi.key} className="card relative overflow-hidden px-3.5 pb-2 pt-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-ink-faint">
              {kpi.label}
            </p>
            <p className="tnum mt-1 text-xl font-semibold leading-none">
              {format(value, kpi.fmt)}
            </p>

            {d && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className={cn(
                  "tnum inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-2xs font-medium",
                  TONE[d.tone],
                )}>
                  {d.tone === "flat"
                    ? <Minus className="h-2.5 w-2.5" />
                    : d.diff > 0
                      ? <ArrowUpRight className="h-2.5 w-2.5" />
                      : <ArrowDownRight className="h-2.5 w-2.5" />}
                  {signedPct(d.pct)}
                </span>
                <span className="truncate text-2xs text-ink-faint">{compareLabel}</span>
              </div>
            )}

            {spark.length > 1 && (
              <div className="-mx-3.5 -mb-2 mt-2 h-8 opacity-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="#2F5FE0"
                      strokeWidth={1.25}
                      fill="#2F5FE0"
                      fillOpacity={0.1}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
