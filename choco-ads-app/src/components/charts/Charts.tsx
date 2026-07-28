import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { compact, num, roasPct, shortDate, won } from "@/lib/format";
import { Card, CardHeader, EmptyState, Skeleton } from "@/components/ui";
import type { DailyPoint } from "@/lib/types";

const GRID = "#E3E5EC";
const AXIS = { fontSize: 11, fill: "#8C90A0" };
export const SERIES_COLORS = ["#2F5FE0", "#0E8A5F", "#B5730E", "#C8352F", "#6B4FD8"];

function ChartFrame({
  title, description, loading, empty, children, height = 240, action,
}: {
  title: string; description?: string; loading?: boolean; empty?: boolean;
  children: React.ReactNode; height?: number; action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <div className="p-3" style={{ height }}>
        {loading
          ? <Skeleton className="h-full w-full" />
          : empty
            ? <EmptyState title="이 기간에는 데이터가 없습니다" />
            : <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 일별 추이 (여러 지표를 한 차트에 겹치지 않고 지표별로 하나씩)
// ---------------------------------------------------------------------------
export function DailyTrendChart({
  data, metric, title, description, loading, format = "int",
}: {
  data: DailyPoint[];
  metric: keyof DailyPoint;
  title: string;
  description?: string;
  loading?: boolean;
  format?: "int" | "won" | "roas";
}) {
  const fmt = (v: number) =>
    format === "won" ? won(v) : format === "roas" ? roasPct(v) : num(v);

  return (
    <ChartFrame title={title} description={description} loading={loading}
      empty={!loading && data.every((d) => Number(d[metric]) === 0)}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="stat_date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52}
          tickFormatter={(v) => format === "roas" ? `${Math.round(v * 100)}%` : compact(v)} />
        <Tooltip
          formatter={(v: number) => [fmt(v), title]}
          labelFormatter={(l) => l}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: `1px solid ${GRID}` }}
        />
        <Line type="monotone" dataKey={metric as string} stroke={SERIES_COLORS[0]}
          strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
      </LineChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// 범주형 가로 막대 (상품군별 / 상품 TOP N)
// ---------------------------------------------------------------------------
export function CategoryBarChart<T extends Record<string, any>>({
  data, nameKey, valueKey, title, description, loading, format = "won", onSelect, height = 300,
}: {
  data: T[];
  nameKey: keyof T & string;
  valueKey: keyof T & string;
  title: string;
  description?: string;
  loading?: boolean;
  format?: "int" | "won" | "roas";
  onSelect?: (row: T) => void;
  height?: number;
}) {
  const fmt = (v: number) =>
    format === "won" ? won(v) : format === "roas" ? roasPct(v) : num(v);

  return (
    <ChartFrame title={title} description={description} loading={loading}
      empty={!loading && data.length === 0} height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false}
          tickFormatter={(v) => format === "roas" ? `${Math.round(v * 100)}%` : compact(v)} />
        <YAxis type="category" dataKey={nameKey} width={140} tick={{ ...AXIS, width: 130 }}
          tickLine={false} axisLine={false}
          tickFormatter={(v: string) => v.length > 14 ? `${v.slice(0, 14)}…` : v} />
        <Tooltip
          formatter={(v: number) => [fmt(v), title]}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: `1px solid ${GRID}` }}
        />
        <Bar dataKey={valueKey} radius={[0, 3, 3, 0]}
          onClick={(d: any) => onSelect?.(d.payload)}
          cursor={onSelect ? "pointer" : "default"}>
          {data.map((_, i) => (
            <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// 광고비 대비 매출 (이중 막대)
// ---------------------------------------------------------------------------
export function CostRevenueChart({
  data, loading, onSelect,
}: {
  data: Array<{ name: string; cost: number; revenue: number }>;
  loading?: boolean;
  onSelect?: (row: { name: string }) => void;
}) {
  return (
    <ChartFrame title="상품군별 광고비 대비 구매완료 매출"
      description="막대를 클릭하면 상품군 상세로 이동합니다"
      loading={loading} empty={!loading && data.length === 0} height={320}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 40, left: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={{ ...AXIS }} interval={0} angle={-35} textAnchor="end"
          height={60} tickLine={false} axisLine={{ stroke: GRID }}
          tickFormatter={(v: string) => v.length > 10 ? `${v.slice(0, 10)}…` : v} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={compact} />
        <Tooltip formatter={(v: number, n) => [won(v), n === "cost" ? "광고비" : "구매완료 매출"]}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: `1px solid ${GRID}` }} />
        <Legend formatter={(v) => v === "cost" ? "광고비" : "구매완료 매출"} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="cost" fill={SERIES_COLORS[3]} fillOpacity={0.75} radius={[3, 3, 0, 0]}
          cursor={onSelect ? "pointer" : "default"}
          onClick={(d: any) => onSelect?.(d.payload)} />
        <Bar dataKey="revenue" fill={SERIES_COLORS[1]} fillOpacity={0.85} radius={[3, 3, 0, 0]}
          cursor={onSelect ? "pointer" : "default"}
          onClick={(d: any) => onSelect?.(d.payload)} />
      </BarChart>
    </ChartFrame>
  );
}
