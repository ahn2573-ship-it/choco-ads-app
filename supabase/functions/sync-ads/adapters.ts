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
    // statDt 는 "YYYY-MM-DD" 형식이어야 한다. 타임스탬프를 붙이면 11001 이 난다.
    const created = await this.req<Record<string, unknown>>("POST", "/stat-reports", {
      reportTp,
      statDt: statDate,
    });

    // 응답에서 보고서 ID 를 꺼낸다. 네이버는 버전에 따라 필드명이 다르므로 여러 후보를 시도.
    const reportId = pickId(created);
    if (!reportId) {
      throw new Error(
        `보고서 ID 를 응답에서 찾지 못함 (${reportTp}). 응답: ${JSON.stringify(created).slice(0, 300)}`,
      );
    }

    const intervalSec = 3;
    const tries = Math.floor(maxWaitSec / intervalSec);
    for (let i = 0; i < tries; i++) {
      await sleep(intervalSec * 1000);
      const meta = await this.req<Record<string, unknown>>("GET", `/stat-reports/${reportId}`);
      const st = String(meta.status ?? meta.statTp ?? "").toUpperCase();
      const url = (meta.downloadUrl ?? meta.downloadUri ?? meta.url) as string | undefined;
      if (st === "BUILT" || st === "DONE" || st === "REGIST" && url) return url ?? null;
      if (st === "BUILT" || st === "DONE") return url ?? null;
      if (st === "ERROR" || st === "NONE" || st === "FAIL") {
        throw new Error(`보고서 생성 실패 (${reportTp}): status=${st}`);
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
    const dateCompact = statDate.replace(/-/g, ""); // 20260726

    // -----------------------------------------------------------------------
    // 1) 광고효과보고서(AD): 노출·클릭·비용·평균순위
    // -----------------------------------------------------------------------
    const adUrl = await this.buildReport("AD", statDate);
    if (!adUrl) return [];
    const adRows = await this.downloadTsv(adUrl);

    // 소재+캠페인유형 단위로 노출·클릭·비용·순위를 합산.
    // 확인된 컬럼 구조:
    //   [0]날짜 [1]광고주 [2]캠페인 [3]광고그룹 [4]키워드 [5]소재 [6]비즈채널
    //   [7]노출영역코드 [8]디바이스(M/P) [+1]노출 [+2]클릭 [+3]비용 ...
    // 캠페인유형: cmp-a001-XX 의 XX (02=쇼핑검색, 01=파워링크, 04=브랜드검색)
    // 소재는 키워드/노출영역별로 여러 행에 쪼개져 있으므로 소재+유형 기준으로 합산한다.
    const perf = new Map<string, {
      adId: string; campaignType: string;
      impressions: number; clicks: number; cost: number;
      rankSum: number; rankImp: number;
    }>();

    for (const cols of adRows) {
      const adIdIdx = cols.findIndex((c) => /^nad-/.test(c));
      if (adIdIdx === -1) continue;
      const rowDate = cols.find((c) => /^\d{8}$/.test(c));
      if (rowDate && rowDate !== dateCompact) continue;

      const adId = cols[adIdIdx];
      const camp = cols.find((c) => /^cmp-/.test(c)) ?? "";
      const campaignType = camp.match(/^cmp-a001-(\d+)-/)?.[1] ?? "00";

      const devIdx = cols.findIndex((c) => c === "M" || c === "P");
      const base = devIdx !== -1 ? devIdx + 1 : adIdIdx + 4;
      const n = (k: number) => {
        const raw = cols[base + k];
        const v = raw ? Number(raw.replace(/,/g, "")) : 0;
        return Number.isFinite(v) ? v : 0;
      };
      const impressions = n(0);
      const clicks = n(1);
      const cost = n(2);
      const avgRnk = n(3);

      const key = `${adId}|${campaignType}`;
      const cur = perf.get(key) ??
        { adId, campaignType, impressions: 0, clicks: 0, cost: 0, rankSum: 0, rankImp: 0 };
      cur.impressions += impressions;
      cur.clicks += clicks;
      cur.cost += cost;
      if (avgRnk > 0 && impressions > 0) { cur.rankSum += avgRnk * impressions; cur.rankImp += impressions; }
      perf.set(key, cur);
    }

    // -----------------------------------------------------------------------
    // 2) 광고전환보고서(AD_CONVERSION): 전환수·전환매출 (별도 보고서)
    //    구매완료 전환만 따로 필요하므로 전환유형을 함께 본다.
    // -----------------------------------------------------------------------
    const conv = new Map<string, { convCount: number; convRevenue: number; totalCount: number; totalRevenue: number }>();
    try {
      const convUrl = await this.buildReport("AD_CONVERSION", statDate, 45);
      if (convUrl) {
        const convRows = await this.downloadTsv(convUrl);

        for (const cols of convRows) {
          const adId = cols.find((c) => /^nad-/.test(c));
          if (!adId) continue;
          const rowDate = cols.find((c) => /^\d{8}$/.test(c));
          if (rowDate && rowDate !== dateCompact) continue;

          // 전환 보고서 구조(확인됨):
          //   ... [device M/P] [?] [전환유형: purchase 등] [전환수] [전환매출]
          // 전환유형 문자열 위치를 기준으로 전환수/매출을 읽는다.
          const typeIdx = cols.findIndex((c) => /^[a-z_]+$/i.test(c) && c !== "M" && c !== "P");
          let cnt = 0, revenue = 0, convType = "";
          if (typeIdx !== -1) {
            convType = cols[typeIdx].toLowerCase();
            cnt = Number((cols[typeIdx + 1] ?? "0").replace(/,/g, "")) || 0;
            revenue = Number((cols[typeIdx + 2] ?? "0").replace(/,/g, "")) || 0;
          }

          const cur = conv.get(adId) ?? { convCount: 0, convRevenue: 0, totalCount: 0, totalRevenue: 0 };
          // 총 전환에는 모든 유형을 합산.
          cur.totalCount += cnt;
          cur.totalRevenue += revenue;
          // 구매완료(purchase)만 '구매완료 전환' 으로 따로 집계.
          if (convType.includes("purchase") || convType.includes("pcsale") || convType.includes("buy")) {
            cur.convCount += cnt;
            cur.convRevenue += revenue;
          }
          conv.set(adId, cur);
        }
      }
    } catch (e) {
      console.log("[수집] 전환보고서 건너뜀:", e instanceof Error ? e.message : String(e));
    }

    // -----------------------------------------------------------------------
    // 3) 소재 상세(AD_DETAIL): 소재 최종 링크 → 상품번호
    // -----------------------------------------------------------------------
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
    } catch (_) { /* 매핑은 나중에 보완 가능 */ }

    // -----------------------------------------------------------------------
    // 4) 소재+캠페인유형 기준으로 성과 + 전환 + 상품 조인
    //    전환은 소재ID 단위이므로, 소재의 대표(노출 최다) 유형 행에만 붙인다.
    // -----------------------------------------------------------------------
    // 소재별 노출 최다 유형을 찾는다 (전환을 한 번만 붙이기 위해).
    const topTypeByAd = new Map<string, { type: string; imp: number }>();
    for (const p of perf.values()) {
      const t = topTypeByAd.get(p.adId);
      if (!t || p.impressions > t.imp) topTypeByAd.set(p.adId, { type: p.campaignType, imp: p.impressions });
    }

    const out: NormalizedRow[] = [];
    for (const p of perf.values()) {
      const isTopType = topTypeByAd.get(p.adId)?.type === p.campaignType;
      // 전환은 소재 대표 유형 행에만 1회 반영 (중복 방지).
      const c = isTopType
        ? (conv.get(p.adId) ?? { convCount: 0, convRevenue: 0, totalCount: 0, totalRevenue: 0 })
        : { convCount: 0, convRevenue: 0, totalCount: 0, totalRevenue: 0 };
      const avgRnk = p.rankImp > 0 ? p.rankSum / p.rankImp : 0;
      out.push(mapRow({
        adId: p.adId,
        productId: adToProduct.get(p.adId),
        campaignType: p.campaignType,
        impCnt: p.impressions,
        clkCnt: p.clicks,
        salesAmt: p.cost,
        avgRnk,
        ccnt: c.convCount,
        convAmt: c.convRevenue,
        totalConvCnt: c.totalCount,
        totalConvAmt: c.totalRevenue,
        statDt: statDate,
      }, statDate));
    }
    console.log(`[수집] 소재·유형 조합 ${out.length}건 (전환 ${conv.size}, 상품매핑 ${adToProduct.size})`);
    return out;
  }

}


// 스마트스토어/쇼핑 링크에서 상품번호를 뽑아낸다.
function extractProductId(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/\/products\/(\d+)/) || url.match(/[?&]nvMid=(\d+)/) || url.match(/(\d{9,})/);
  return m ? m[1] : null;
}

// POST /stat-reports 응답에서 보고서 ID 를 꺼낸다.
// 네이버 버전/문서에 따라 필드명이 다르므로 알려진 후보를 모두 시도한다.
function pickId(obj: Record<string, unknown>): string | null {
  const candidates = ["reportJobId", "id", "statReportJobId", "jobId", "reportId"];
  for (const k of candidates) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v) !== "") return String(v);
  }
  return null;
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

