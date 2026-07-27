import type { MetricBundle } from "./types";

/** 분모가 0이면 오류 대신 0. DB 의 safe_div 와 동작을 일치시킨다. */
export function safeDiv(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : 0;
}

export const ctr = (clicks: number, impressions: number) => safeDiv(clicks, impressions);
export const cpc = (cost: number, clicks: number) => safeDiv(cost, clicks);
export const roas = (revenue: number, cost: number) => safeDiv(revenue, cost);

export interface SumInput {
  impressions: number;
  clicks: number;
  cost: number;
  conv_count: number;
  conv_revenue: number;
  total_conv_count: number;
  total_conv_revenue: number;
}

/**
 * 원본 행들을 합산한 뒤 비율 지표를 다시 계산한다.
 * 비율의 평균을 내면 안 된다 — 상품군 집계에서 특히 중요하다.
 */
export function aggregate(rows: SumInput[]): MetricBundle {
  const sum = rows.reduce<SumInput>(
    (a, r) => ({
      impressions: a.impressions + (r.impressions || 0),
      clicks: a.clicks + (r.clicks || 0),
      cost: a.cost + (r.cost || 0),
      conv_count: a.conv_count + (r.conv_count || 0),
      conv_revenue: a.conv_revenue + (r.conv_revenue || 0),
      total_conv_count: a.total_conv_count + (r.total_conv_count || 0),
      total_conv_revenue: a.total_conv_revenue + (r.total_conv_revenue || 0),
    }),
    {
      impressions: 0, clicks: 0, cost: 0, conv_count: 0,
      conv_revenue: 0, total_conv_count: 0, total_conv_revenue: 0,
    },
  );

  return {
    ...sum,
    ctr: ctr(sum.clicks, sum.impressions),
    cpc: cpc(sum.cost, sum.clicks),
    conv_roas: roas(sum.conv_revenue, sum.cost),
    total_roas: roas(sum.total_conv_revenue, sum.cost),
  };
}

export const EMPTY_METRICS: MetricBundle = {
  impressions: 0, clicks: 0, ctr: 0, cpc: 0, cost: 0,
  conv_count: 0, conv_revenue: 0, conv_roas: 0,
  total_conv_count: 0, total_conv_revenue: 0, total_roas: 0,
};

/** 지표가 올라가는 게 좋은지 내려가는 게 좋은지 */
export type Direction = "up-good" | "down-good" | "neutral";

export const METRIC_DIRECTION: Record<string, Direction> = {
  impressions: "up-good",
  clicks: "up-good",
  ctr: "up-good",
  cost: "neutral",       // 광고비 증가 자체는 좋지도 나쁘지도 않다
  cpc: "down-good",
  conv_count: "up-good",
  conv_revenue: "up-good",
  conv_roas: "up-good",
  total_conv_count: "up-good",
  total_conv_revenue: "up-good",
  total_roas: "up-good",
};

export interface Delta {
  /** 변화율(%) — 이전 값이 0이면 null */
  pct: number | null;
  diff: number;
  tone: "good" | "bad" | "flat";
}

export function delta(current: number, previous: number, key: string): Delta {
  const diff = current - previous;
  const pct = previous === 0 ? null : (diff / Math.abs(previous)) * 100;
  const direction = METRIC_DIRECTION[key] ?? "neutral";

  let tone: Delta["tone"] = "flat";
  if (Math.abs(diff) > 1e-9 && direction !== "neutral") {
    const isUp = diff > 0;
    tone = (direction === "up-good") === isUp ? "good" : "bad";
  }
  return { pct, diff, tone };
}

/** 상품별/상품군별 목록에서 저성과 상품을 추린다. */
export function isUnderperforming(
  row: Pick<MetricBundle, "cost" | "conv_count" | "conv_roas">,
  opts: { minCost: number; targetRoas: number },
): boolean {
  if (row.cost < opts.minCost) return false;
  return row.conv_count === 0 || row.conv_roas * 100 < opts.targetRoas;
}
