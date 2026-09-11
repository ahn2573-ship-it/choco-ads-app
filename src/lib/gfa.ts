import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// 네이버 GFA RAW 리포트 파서 (형식 자동 인식 · 파일명 무관)
//   · 파일명이 아니라 "헤더(열 이름)"만 보고 필요한 값을 골라냅니다.
//   · 시간별 / 기기·OS별 / 연령·성별별 등 어떤 분해 리포트를 올려도, 같은 데이터를
//     "소재ID + 날짜" 단위로 합산하므로 결과 합계는 동일합니다.
//   · 열 순서가 바뀌거나, 쓰지 않는 열(앱설치·위시리스트·사용자정의 등)이 잔뜩
//     있어도 무시하고 필요한 열만 이름으로 찾아 씁니다.
//   · 소재 이름이 없으면 광고그룹 → 캠페인 이름 순으로 대체 인식합니다.
// ---------------------------------------------------------------------------

export interface GfaParsedRow {
  creative_id: string;       // 소재ID(없으면 그룹ID/캠페인ID) — 집계·중복방지 키
  creative_name: string;     // 화면 표시용 이름
  match_text: string;        // 상품군 분류용(소재+그룹+캠페인 이름을 합친 텍스트)
  stat_date: string;         // YYYY-MM-DD
  impressions: number;
  clicks: number;
  cost: number;
  conv_count: number;
  conv_revenue: number;
  total_conv_count: number;
  total_conv_revenue: number;
  cart_count: number;
  cart_revenue: number;
}

export interface GfaRule {
  keyword: string;
  group_id: string;
  priority: number;
  is_active?: boolean;
}

export type GfaLevel = "소재" | "광고그룹" | "캠페인" | "알수없음";

// 열 이름 후보. 레벨(소재/그룹/캠페인)별로 분리해 어떤 단위 파일인지 자동 인식한다.
const NAME = {
  creative: ["광고 소재 이름", "소재 이름", "소재명"],
  group: ["광고 그룹 이름", "광고그룹 이름", "그룹 이름", "그룹명"],
  campaign: ["캠페인 이름", "캠페인명"],
};
const ID = {
  creative: ["광고 소재 ID", "소재 ID", "소재ID"],
  group: ["광고 그룹 ID", "광고그룹 ID", "그룹 ID", "그룹ID"],
  campaign: ["캠페인 ID", "캠페인ID"],
};
const METRIC = {
  date: ["기간", "날짜", "일자"],
  cost: ["총비용", "비용", "광고비"],
  imp:  ["노출수", "노출"],
  clk:  ["클릭수", "클릭"],
  conv: ["구매완료 수", "구매완료 전환수"],
  rev:  ["구매완료 전환매출액", "구매완료 매출"],
  totalConv: ["총 전환수"],
  totalRev:  ["총 전환매출액"],
  cartConv: ["장바구니 담기 수", "장바구니 전환수", "장바구니담기수"],
  cartRev:  ["장바구니 전환매출액", "장바구니 매출"],
};

// 헤더 비교용 정규화: 공백/BOM 제거 + 끝의 단위 괄호 "(원)","(%)" 제거
const norm = (s: string) => s.replace(/\uFEFF/g, "").replace(/\s/g, "").replace(/\((?:원|%)\)$/g, "");

/** 후보 이름들 중 실제 존재하는 열의 값을 돌려준다(정확→정규화 순). 없으면 "" */
function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in row && String(row[k] ?? "").trim() !== "") return row[k];
  }
  const rowKeys = Object.keys(row);
  for (const k of keys) {
    const hit = rowKeys.find((h) => norm(h) === norm(k));
    if (hit && String(row[hit] ?? "").trim() !== "") return row[hit];
  }
  return "";
}

/** 후보 열 중 하나라도 파일에 존재하는지(값 유무와 무관) */
function hasColumn(sample: Record<string, unknown>, keys: string[]): boolean {
  const rowKeys = Object.keys(sample);
  return keys.some((k) => k in sample || rowKeys.some((h) => norm(h) === norm(k)));
}

const toNum = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function toDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v ?? "").trim();
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (/^\d+(\.\d+)?$/.test(s) && (XLSX as any).SSF?.parse_date_code) {
    const dt = (XLSX as any).SSF.parse_date_code(Number(s));
    if (dt) return `${dt.y}-${String(dt.m).padStart(2, "0")}-${String(dt.d).padStart(2, "0")}`;
  }
  return null;
}

/** GFA RAW 파일(.csv/.xlsx)을 읽어 "가장 세부 단위 + 날짜"로 합산한다. */
export async function parseGfaFile(file: File): Promise<{
  rows: GfaParsedRow[];
  skipped: number;
  rawCount: number;
  level: GfaLevel;
}> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  if (!json.length) return { rows: [], skipped: 0, rawCount: 0, level: "알수없음" };
  const sample = json[0];

  // 어느 단위의 파일인지 헤더로 자동 인식 (세부 단위 우선: 소재 > 그룹 > 캠페인)
  const idKeys = hasColumn(sample, ID.creative) ? ID.creative
    : hasColumn(sample, ID.group) ? ID.group
    : hasColumn(sample, ID.campaign) ? ID.campaign : null;
  const level: GfaLevel =
    idKeys === ID.creative ? "소재" :
    idKeys === ID.group ? "광고그룹" :
    idKeys === ID.campaign ? "캠페인" : "알수없음";

  const hasTotal = hasColumn(sample, METRIC.totalConv);

  const map = new Map<string, GfaParsedRow>();
  let skipped = 0;

  for (const r of json) {
    // 키: 인식된 단위의 ID. 못 찾으면 소재→그룹→캠페인 순으로 폴백.
    const id = String(pick(r, idKeys ?? [...ID.creative, ...ID.group, ...ID.campaign]) ?? "").trim();
    const date = toDate(pick(r, METRIC.date));
    if (!id || !date) { skipped++; continue; }

    const cName = String(pick(r, NAME.creative) ?? "").trim();
    const gName = String(pick(r, NAME.group) ?? "").trim();
    const pName = String(pick(r, NAME.campaign) ?? "").trim();
    const display = cName || gName || pName || id;
    const matchText = [cName, gName, pName].filter(Boolean).join(" ");

    const conv = toNum(pick(r, METRIC.conv));
    const rev = toNum(pick(r, METRIC.rev));
    const key = `${id}|${date}`;
    const cur = map.get(key) ?? {
      creative_id: id,
      creative_name: display,
      match_text: matchText || display,
      stat_date: date,
      impressions: 0, clicks: 0, cost: 0,
      conv_count: 0, conv_revenue: 0, total_conv_count: 0, total_conv_revenue: 0,
      cart_count: 0, cart_revenue: 0,
    };
    cur.impressions  += toNum(pick(r, METRIC.imp));
    cur.clicks       += toNum(pick(r, METRIC.clk));
    cur.cost         += toNum(pick(r, METRIC.cost));
    cur.conv_count   += conv;
    cur.conv_revenue += rev;
    cur.total_conv_count   += hasTotal ? toNum(pick(r, METRIC.totalConv)) : conv;
    cur.total_conv_revenue += hasTotal ? toNum(pick(r, METRIC.totalRev))  : rev;
    cur.cart_count   += toNum(pick(r, METRIC.cartConv));
    cur.cart_revenue += toNum(pick(r, METRIC.cartRev));
    map.set(key, cur);
  }

  return { rows: [...map.values()], skipped, rawCount: json.length, level };
}

export interface GfaGroup { id: string; name: string; }

// 이름 비교용 정규화: 공백 제거 + 소문자
const normName = (s: string) => (s ?? "").replace(/\s/g, "").toLowerCase();

/** 이름의 "첫 번째 괄호" 안 텍스트를 뽑는다. 예: 전환_관심사(논슬립 스텝 4.0)_스퀘어형 → 논슬립 스텝 4.0 */
export function firstParen(text: string): string {
  const m = (text ?? "").match(/\(([^()]+)\)/);
  return m ? m[1].trim() : "";
}

/**
 * 소재/그룹/캠페인 이름 텍스트를 상품군에 매칭한다.
 *   1) 명시 규칙(keyword 포함) 우선 — 리타겟→브랜드 등 예외/별칭 처리
 *   2) 규칙에 없으면, 첫 괄호 안 상품명을 상품군 이름과 자동 매칭
 *      (정확히 일치 → 없으면 가장 구체적(긴)으로 포함 일치)
 *   매칭 없으면 null(미매핑).
 */
export function classifyGfa(text: string, rules: GfaRule[], groups: GfaGroup[] = []): string | null {
  const n = (text ?? "").toLowerCase();

  // 1) 명시 규칙
  const active = rules
    .filter((r) => r.is_active !== false && r.keyword)
    .sort((a, b) => (a.priority - b.priority) || (b.keyword.length - a.keyword.length));
  for (const r of active) {
    if (n.includes(r.keyword.toLowerCase())) return r.group_id;
  }

  // 2) 첫 괄호 상품명 → 상품군 이름 자동 매칭
  const token = normName(firstParen(text));
  if (token && groups.length) {
    const exact = groups.find((g) => normName(g.name) === token);
    if (exact) return exact.id;
    // 포함 일치: 가장 구체적인(정규화 이름이 가장 긴) 상품군 우선
    const contains = groups
      .filter((g) => {
        const gn = normName(g.name);
        return gn && (token.includes(gn) || gn.includes(token));
      })
      .sort((a, b) => normName(b.name).length - normName(a.name).length);
    if (contains.length) return contains[0].id;
  }

  return null;
}

/** 미매핑 안내용 — 첫 괄호 상품명(없으면 앞부분)만 뽑아 보여준다. */
export function gfaLabelOf(text: string): string {
  return firstParen(text) || (text ?? "").split(/[_\s]/)[0] || text || "";
}
