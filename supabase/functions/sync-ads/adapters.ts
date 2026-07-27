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
// ---------------------------------------------------------------------------
// 네이버 검색광고 어댑터 — 대용량 보고서(StatReport) 방식
//
// 소재가 많아도 호출 몇 번으로 끝난다.
//   1) POST /stat-reports { reportTp: "AD", statDt: "YYYY-MM-DD" }  → 보고서 생성 요청
//   2) GET  /stat-reports/{id}  상태가 BUILT/DONE 될 때까지 폴링
//   3) 완성된 downloadUrl(TSV) 다운로드 → 파싱
//   4) 소재-상품 매핑은 별도 MasterReport(AD) 로 소재의 최종 URL 을 받아 상품번호 추출
//
// AD 보고서는 소재(nccAdId) 단위 일별 성과를 제공한다(엑셀 result2 와 동일 축).
// ---------------------------------------------------------------------------
async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// AD 통계 보고서(TSV)의 컬럼 순서. 네이버 문서 기준.
// customerId, date, campaignId, adgroupId, keywordId, adId,
// businessChannelId(=pcMobileType 등 버전별 상이) ... impCnt, clkCnt, cost, ...
// 버전에 따라 컬럼이 달라질 수 있어, 숫자열 위치를 라벨로 잡지 않고
// "소재ID 컬럼 + 뒤쪽 지표 컬럼" 을 유연하게 매핑한다.
interface StatReportMeta {
  id: string;
  status: string;
  downloadUrl?: string;
}

export class NaverSearchAdAdapter implements AdAdapter {
  name = "naver_searchad";

  constructor(
    private baseUrl: string,   // https://api.naver.com
    private apiKey: string,
    private secretKey: string,
    private customerId: string,
  ) {}

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

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: await this.headers(method, path),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`네이버 API ${res.status} (${method} ${path}): ${(await res.text()).slice(0, 200)}`);
    }
    return await res.json() as T;
  }

  // 지정 타입의 보고서를 생성하고, 완성될 때까지 폴링해 downloadUrl 을 돌려준다.
  // maxWaitSec: 폴링 총 대기 상한. 함수 실행 제한 안에 들어오도록 짧게 잡는다.
  private async buildReport(
    reportTp: string, statDate: string, maxWaitSec = 60,
  ): Promise<string | null> {
    const created = await this.req<StatReportMeta>("POST", "/stat-reports", {
      reportTp,
      statDt: `${statDate}T00:00:00.000Z`,
    });

    const intervalSec = 3;
    const tries = Math.floor(maxWaitSec / intervalSec);
    for (let i = 0; i < tries; i++) {
      await sleep(intervalSec * 1000);
      const meta = await this.req<StatReportMeta>("GET", `/stat-reports/${created.id}`);
      const st = (meta.status || "").toUpperCase();
      if (st === "BUILT" || st === "DONE") return meta.downloadUrl ?? null;
      if (st === "ERROR" || st === "NONE") {
        throw new Error(`보고서 생성 실패 (${reportTp}): status=${meta.status}`);
      }
    }
    throw new Error(`보고서 생성 시간 초과 (${reportTp}). 잠시 후 다시 시도하세요.`);
  }

  // downloadUrl 의 TSV 를 받아 행 배열로 반환.
  private async downloadTsv(url: string): Promise<string[][]> {
    // 다운로드 URL 은 절대경로일 수도, /report-download 상대경로일 수도 있다.
    const path = url.startsWith("http")
      ? new URL(url).pathname + new URL(url).search
      : url;
    const res = await fetch(url.startsWith("http") ? url : `${this.baseUrl}${url}`, {
      headers: await this.headers("GET", path.split("?")[0]),
    });
    if (!res.ok) throw new Error(`보고서 다운로드 실패 ${res.status}`);
    const text = await res.text();
    return text.split("\n").filter((l) => l.trim() !== "").map((l) => l.split("\t"));
  }

  async fetchDaily({ statDate }: FetchParams): Promise<NormalizedRow[]> {
    // 1) 소재 성과 보고서(AD)
    const adUrl = await this.buildReport("AD", statDate);
    if (!adUrl) return [];
    const adRows = await this.downloadTsv(adUrl);

    // 2) 소재 마스터(AD) — 소재의 최종 링크에서 상품번호를 얻는다. 실패해도 성과는 처리.
    const adToProduct = new Map<string, string>();
    try {
      const masterUrl = await this.buildReport("AD_DETAIL", statDate, 30);
      if (masterUrl) {
        const masterRows = await this.downloadTsv(masterUrl);
        for (const cols of masterRows) {
          const adId = cols.find((c) => /^nad-/.test(c));
          const link = cols.find((c) => /https?:\/\//.test(c));
          const pid = extractProductId(link);
          if (adId && pid) adToProduct.set(adId, pid);
        }
      }
    } catch (_) {
      // 마스터 실패는 치명적이지 않다 — 매핑은 나중에 소재매핑 화면에서 보완 가능.
    }

    // 3) AD 보고서 파싱.
    //    각 행에서 소재ID(nad-...)와 날짜(YYYYMMDD)를 찾고, 나머지 숫자열을 지표로 매핑.
    //    네이버 AD 보고서 표준 컬럼:
    //    [0]customerId [1]date [2]campaignId [3]adgroupId [4]keywordId(-) [5]adId
    //    [6]businessChannelId [7]media... 지표는 뒤쪽에.
    //    버전차를 흡수하기 위해 adId 위치를 기준으로 잡는다.
    const out: NormalizedRow[] = [];
    for (const cols of adRows) {
      const adIdIdx = cols.findIndex((c) => /^nad-/.test(c));
      if (adIdIdx === -1) continue;
      const adId = cols[adIdIdx];

      // 표준 AD 보고서 지표 순서(문서 기준):
      // impCnt, clkCnt, cost(salesAmt), sumAvgRnk/avgRnk, ccnt, convAmt ...
      // 지표는 adId 이후의 "순수 숫자" 컬럼들로 이어진다. 앞에서부터 6개를 취한다.
      const nums = cols.slice(adIdIdx + 1)
        .map((c) => c.replace(/,/g, ""))
        .filter((c) => c !== "" && /^-?\d+(\.\d+)?$/.test(c))
        .map(Number);

      const [impCnt = 0, clkCnt = 0, cost = 0, avgRnk = 0, ccnt = 0, convAmt = 0] = nums;

      out.push(mapRow({
        adId,
        productId: adToProduct.get(adId),
        impCnt, clkCnt, salesAmt: cost, avgRnk, ccnt, convAmt,
        statDt: statDate,
      }, statDate));
    }
    return out;
  }
}

// 스마트스토어/쇼핑 링크에서 상품번호를 뽑아낸다.
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
