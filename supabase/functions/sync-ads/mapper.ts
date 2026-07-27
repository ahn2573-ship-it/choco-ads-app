import type { NormalizedRow } from "./types.ts";

/** 숫자만으로 이루어진 값인지 판정. '0' 은 유효한 상품 ID 로 보지 않는다. */
export function isNumericProductId(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return /^\d+$/.test(s) && s !== "0";
}

export function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * API 응답 한 줄을 내부 표준 구조로 바꾼다.
 * 필드명이 다른 API 로 교체될 때 FIELD_ALIASES 만 수정하면 된다.
 */
const FIELD_ALIASES = {
  creativeId: ["adId", "nccAdId", "소재", "creativeId", "adKeywordId"],
  productRef: ["productId", "상품번호(스마트스토어)", "productNo", "mallProductId", "adType"],
  impressions: ["impCnt", "노출수", "impressions"],
  clicks: ["clkCnt", "클릭수", "clicks"],
  cost: ["salesAmt", "총비용", "cost"],
  avgRank: ["avgRnk", "평균노출순위", "avgRank"],
  convCount: ["ccnt", "구매완료 전환수", "convCount", "purchaseConvCnt"],
  convRevenue: ["convAmt", "구매완료 전환매출액(원)", "convRevenue", "purchaseConvAmt"],
  totalConvCount: ["totalConvCnt", "총 전환수", "totalConvCount"],
  totalConvRevenue: ["totalConvAmt", "총 전환매출액(원)", "totalConvRevenue"],
  statDate: ["statDt", "날짜", "date", "statDate"],
} as const;

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
  }
  return undefined;
}

export function mapRow(
  row: Record<string, unknown>,
  fallbackDate: string,
): NormalizedRow {
  const productRef = pick(row, FIELD_ALIASES.productRef);
  const numeric = isNumericProductId(productRef);
  const rawDate = pick(row, FIELD_ALIASES.statDate);

  return {
    creativeId: String(pick(row, FIELD_ALIASES.creativeId) ?? "-").trim() || "-",
    mallProductId: numeric ? String(productRef).trim() : null,
    adTypeLabel: !numeric && productRef !== undefined && String(productRef).trim() !== "0"
      ? String(productRef).trim()
      : null,
    impressions: toNumber(pick(row, FIELD_ALIASES.impressions)),
    clicks: toNumber(pick(row, FIELD_ALIASES.clicks)),
    cost: toNumber(pick(row, FIELD_ALIASES.cost)),
    avgRank: pick(row, FIELD_ALIASES.avgRank) === undefined
      ? null
      : toNumber(pick(row, FIELD_ALIASES.avgRank)),
    convCount: toNumber(pick(row, FIELD_ALIASES.convCount)),
    convRevenue: toNumber(pick(row, FIELD_ALIASES.convRevenue)),
    totalConvCount: toNumber(pick(row, FIELD_ALIASES.totalConvCount)),
    totalConvRevenue: toNumber(pick(row, FIELD_ALIASES.totalConvRevenue)),
    statDate: normalizeDate(rawDate, fallbackDate),
    raw: row,
  };
}

/**
 * API 가 UTC 타임스탬프를 주든 YYYYMMDD 를 주든 Asia/Seoul 기준 날짜 문자열로 통일한다.
 */
export function normalizeDate(v: unknown, fallback: string): string {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return seoulDate(d);
  return fallback;
}

/** Date 객체를 Asia/Seoul 기준 YYYY-MM-DD 로 변환 */
export function seoulDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Asia/Seoul 기준 전일 */
export function seoulYesterday(): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 1);
  return seoulDate(now);
}

/**
 * 같은 응답 안에서 중복으로 들어온 행을 합친다.
 * 키: 소재 + 상품ID(또는 광고유형) + 날짜
 */
export function dedupeRows(rows: NormalizedRow[]): NormalizedRow[] {
  const map = new Map<string, NormalizedRow>();
  for (const r of rows) {
    const key = `${r.statDate}|${r.creativeId}|${r.mallProductId ?? r.adTypeLabel ?? "-"}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r });
      continue;
    }
    // 지표는 합산, 평균노출순위는 노출수 가중평균
    const totalImp = prev.impressions + r.impressions;
    prev.avgRank = totalImp > 0
      ? ((prev.avgRank ?? 0) * prev.impressions + (r.avgRank ?? 0) * r.impressions) / totalImp
      : prev.avgRank;
    prev.impressions = totalImp;
    prev.clicks += r.clicks;
    prev.cost += r.cost;
    prev.convCount += r.convCount;
    prev.convRevenue += r.convRevenue;
    prev.totalConvCount += r.totalConvCount;
    prev.totalConvRevenue += r.totalConvRevenue;
  }
  return [...map.values()];
}
