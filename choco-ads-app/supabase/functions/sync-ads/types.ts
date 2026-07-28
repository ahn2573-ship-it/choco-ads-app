// 광고 API 어댑터가 지켜야 하는 내부 표준 구조.
// API 스펙이 확정되면 Adapter 만 갈아끼우고 이 구조는 그대로 둔다.

export interface NormalizedRow {
  /** 소재 ID. API 응답에 없으면 '-' 로 채운다. */
  creativeId: string;
  /** 숫자형 상품 ID (쇼핑몰 상품ID). 없으면 null */
  mallProductId: string | null;
  /** 숫자형이 아닌 광고 유형 값 (파워링크, 브랜드 검색 등). 없으면 null */
  adTypeLabel: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  avgRank: number | null;
  convCount: number;
  convRevenue: number;
  totalConvCount: number;
  totalConvRevenue: number;
  /** YYYY-MM-DD, Asia/Seoul 기준 */
  statDate: string;
  raw?: Record<string, unknown>;
}

export interface FetchParams {
  statDate: string; // YYYY-MM-DD (Asia/Seoul)
  customerId?: string;
  accountId?: string;
}

export interface AdAdapter {
  name: string;
  fetchDaily(params: FetchParams): Promise<NormalizedRow[]>;
}
