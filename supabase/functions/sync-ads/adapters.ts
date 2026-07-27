import type { AdAdapter, FetchParams, NormalizedRow } from "./types.ts";
import { mapRow, seoulDate } from "./mapper.ts";

// ---------------------------------------------------------------------------
// Mock 어댑터 — API 정보가 없어도 전체 파이프라인을 돌려볼 수 있게 한다.
// 실제 소재 ID 를 일부 섞어서 매핑 성공 케이스와 미매핑 케이스를 모두 만든다.
// ---------------------------------------------------------------------------
const MOCK_CREATIVES = [
  "nad-a001-01-000000202997465",
  "nad-a001-01-000000202487581",
  "nad-a001-01-000000202847128",
  "nad-a001-01-000000202997663",
  "nad-a001-01-000000203041877",
  "nad-a001-01-000000999999001", // 일부러 매핑 없는 신규 소재
];

const MOCK_AD_TYPES = ["파워링크", "브랜드 검색", "쇼핑브랜드형"];

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MockAdapter implements AdAdapter {
  name = "mock";

  fetchDaily({ statDate }: FetchParams): Promise<NormalizedRow[]> {
    const rnd = seededRandom(statDate);
    const rows: NormalizedRow[] = [];

    for (const creativeId of MOCK_CREATIVES) {
      const impressions = Math.floor(rnd() * 800) + 5;
      const clicks = Math.floor(impressions * (rnd() * 0.06));
      const cost = clicks * (Math.floor(rnd() * 1500) + 300);
      const convCount = clicks > 0 && rnd() > 0.6 ? Math.floor(rnd() * 4) : 0;
      const convRevenue = convCount * (Math.floor(rnd() * 60000) + 20000);
      rows.push(mapRow({
        adId: creativeId,
        impCnt: impressions,
        clkCnt: clicks,
        salesAmt: cost,
        avgRnk: Number((rnd() * 4 + 1).toFixed(1)),
        ccnt: convCount,
        convAmt: convRevenue,
        totalConvCnt: convCount + Math.floor(rnd() * 5),
        totalConvAmt: convRevenue + Math.floor(rnd() * 500000),
        statDt: statDate,
      }, statDate));
    }

    for (const label of MOCK_AD_TYPES) {
      const impressions = Math.floor(rnd() * 3000) + 100;
      const clicks = Math.floor(impressions * (rnd() * 0.04));
      rows.push(mapRow({
        adId: "-",
        productId: label,
        impCnt: impressions,
        clkCnt: clicks,
        salesAmt: clicks * (Math.floor(rnd() * 1200) + 200),
        ccnt: Math.floor(rnd() * 6),
        convAmt: Math.floor(rnd() * 700000),
        totalConvCnt: Math.floor(rnd() * 20),
        totalConvAmt: Math.floor(rnd() * 3000000),
        statDt: statDate,
      }, statDate));
    }

    return Promise.resolve(rows);
  }
}

// ---------------------------------------------------------------------------
// 네이버 검색광고 어댑터
// 공식 규격(https://api.naver.com) 기준으로 구현.
//
// 네이버는 성과(/stats)에 ID만 있고 이름/구조가 없어, 마스터를 따로 조회해 조인해야 한다.
// 이 서비스는 "소재(ad)" 단위 성과가 필요하므로(엑셀 result2 의 소재 기준):
//   1) /ncc/campaigns          → 캠페인 목록
//   2) /ncc/adgroups?nccCampaignId=... → 광고그룹 목록
//   3) /ncc/ads?nccAdgroupId=...       → 소재 목록 (nccAdId, 연결된 상품/링크 정보)
//   4) /stats?ids=[소재ID들] ...        → 소재별 일별 성과
// ID 타입은 섞을 수 없으므로 소재 ID 만 모아 배치로 조회한다.
// ---------------------------------------------------------------------------
async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NaverSearchAdAdapter implements AdAdapter {
  name = "naver_searchad";

  constructor(
    private baseUrl: string,      // https://api.naver.com
    private apiKey: string,
    private secretKey: string,
    private customerId: string,
  ) {}

  // 서명은 반드시 "경로(path)"만으로 만든다. 쿼리스트링은 제외.
  private async headers(method: string, path: string) {
    const ts = Date.now().toString();
    const signature = await hmacSha256Base64(this.secretKey, `${ts}.${method}.${path}`);
    return {
      "X-Timestamp": ts,
      "X-API-KEY": this.apiKey,
      "X-CUSTOMER": String(this.customerId),
      "X-Signature": signature,
      "Content-Type": "application/json; charset=UTF-8",
    };
  }

  private async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(query).toString();
    const url = `${this.baseUrl}${path}${qs ? "?" + qs : ""}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(url, { headers: await this.headers("GET", path) });
      if (res.status === 429) { await sleep(500 * attempt); continue; } // Rate limit
      if (!res.ok) {
        throw new Error(`네이버 API ${res.status} (${path}): ${(await res.text()).slice(0, 200)}`);
      }
      return await res.json() as T;
    }
    throw new Error(`네이버 API 재시도 초과: ${path}`);
  }

  async fetchDaily({ statDate }: FetchParams): Promise<NormalizedRow[]> {
    // 1) 캠페인
    const campaigns = await this.get<Array<{ nccCampaignId: string }>>("/ncc/campaigns");
    await sleep(300);

    // 2) 광고그룹 (캠페인별)
    const adgroupIds: string[] = [];
    for (const c of campaigns) {
      const groups = await this.get<Array<{ nccAdgroupId: string }>>(
        "/ncc/adgroups", { nccCampaignId: c.nccCampaignId },
      );
      for (const g of groups) adgroupIds.push(g.nccAdgroupId);
      await sleep(300);
    }

    // 3) 소재 (광고그룹별). 소재 → 연결 상품/링크 매핑도 여기서 수집.
    const adIds: string[] = [];
    const adMeta = new Map<string, { pcUrl?: string; mobileUrl?: string }>();
    for (const gid of adgroupIds) {
      const ads = await this.get<Array<{
        nccAdId: string;
        ad?: { pc?: { final?: string }; mobile?: { final?: string } };
      }>>("/ncc/ads", { nccAdgroupId: gid });
      for (const a of ads) {
        adIds.push(a.nccAdId);
        adMeta.set(a.nccAdId, {
          pcUrl: a.ad?.pc?.final,
          mobileUrl: a.ad?.mobile?.final,
        });
      }
      await sleep(300);
    }

    if (adIds.length === 0) return [];

    // 4) 소재별 통계. ids 는 한 번에 너무 많으면 안 되므로 배치로 나눈다.
    const fields = JSON.stringify([
      "impCnt", "clkCnt", "salesAmt", "avgRnk", "ccnt", "convAmt", "crto", "ror",
    ]);
    const timeRange = JSON.stringify({ since: statDate, until: statDate });

    const rows: NormalizedRow[] = [];
    const BATCH = 100;
    for (let i = 0; i < adIds.length; i += BATCH) {
      const batch = adIds.slice(i, i + BATCH);
      const stats = await this.get<{ data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
        "/stats",
        {
          ids: JSON.stringify(batch),
          fields,
          timeRange,
          timeIncrement: "1",
        },
      );
      const list = Array.isArray(stats) ? stats : (stats.data ?? []);
      for (const s of list) {
        // 소재에 연결된 상품ID는 최종 URL(스마트스토어 링크)에서 추출한다.
        const meta = adMeta.get(String((s as Record<string, unknown>).id ?? ""));
        const productId = extractProductId(meta?.pcUrl) ?? extractProductId(meta?.mobileUrl);
        rows.push(mapRow({
          adId: (s as Record<string, unknown>).id,
          // 상품ID 를 넣어두면 매퍼가 mallProductId 로 인식한다.
          productId: productId ?? undefined,
          impCnt: (s as Record<string, unknown>).impCnt,
          clkCnt: (s as Record<string, unknown>).clkCnt,
          salesAmt: (s as Record<string, unknown>).salesAmt,
          avgRnk: (s as Record<string, unknown>).avgRnk,
          ccnt: (s as Record<string, unknown>).ccnt,
          convAmt: (s as Record<string, unknown>).convAmt,
          statDt: statDate,
        }, statDate));
      }
      await sleep(400); // Rate limit 방지
    }
    return rows;
  }
}

// 스마트스토어/쇼핑 링크에서 상품번호를 뽑아낸다.
// 예: https://smartstore.naver.com/xxx/products/4141857911
function extractProductId(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/\/products\/(\d+)/) || url.match(/[?&]nvMid=(\d+)/) || url.match(/(\d{9,})/);
  return m ? m[1] : null;
}


export function createAdapter(env: Record<string, string | undefined>): AdAdapter {
  const mode = (env.AD_API_MODE ?? "mock").toLowerCase();
  if (mode === "mock") return new MockAdapter();

  const { AD_API_KEY, AD_API_SECRET, AD_API_CUSTOMER_ID } = env;
  // 네이버 검색광고 API 의 기본 주소는 https://api.naver.com 이다.
  const baseUrl = env.AD_API_BASE_URL || "https://api.naver.com";
  if (!AD_API_KEY || !AD_API_SECRET || !AD_API_CUSTOMER_ID) {
    throw new Error(
      "AD_API_MODE=live 인데 AD_API_KEY / AD_API_SECRET / AD_API_CUSTOMER_ID 가 비어 있습니다.",
    );
  }
  return new NaverSearchAdAdapter(
    baseUrl,
    AD_API_KEY,
    AD_API_SECRET,
    AD_API_CUSTOMER_ID,
  );
}

export { seoulDate };
