import * as XLSX from "xlsx";
import type {
  CreativeMapping, DailyPoint, GroupStat, PeriodSummary, ProductStat, RawRow, UnmappedRow,
} from "./types";

// 엑셀에는 수식을 넣지 않는다. 서버에서 계산한 최종 값만 기록한다.

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename, { compression: true });
}

function sheet(rows: Record<string, unknown>[], colWidths?: number[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  if (colWidths) ws["!cols"] = colWidths.map((w) => ({ wch: w }));
  else if (rows.length) {
    ws["!cols"] = Object.keys(rows[0]).map((k) => ({
      wch: Math.min(Math.max(k.length + 4, 12), 48),
    }));
  }
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  return ws;
}

// ---------------------------------------------------------------------------
// 시트 변환기 — 엑셀 원본과 같은 헤더를 유지한다.
// ---------------------------------------------------------------------------
export const toResult2 = (rows: RawRow[]) =>
  rows.map((r) => ({
    "소재": r.creative_id,
    "상품번호(스마트스토어)": r.mall_product_id ?? r.ad_type_label ?? 0,
    "노출수": r.impressions,
    "클릭수": r.clicks,
    "총비용": Number(r.cost),
    "평균노출순위": r.avg_rank ?? "",
    "구매완료 전환수": r.conv_count,
    "구매완료 전환매출액(원)": Number(r.conv_revenue),
    "총 전환수": r.total_conv_count,
    "총 전환매출액(원)": Number(r.total_conv_revenue),
    "날짜": r.stat_date,
  }));

export const toProductSheet = (rows: ProductStat[]) =>
  rows.map((r) => ({
    "쇼핑몰 상품ID": r.mall_product_id ?? "",
    "상품번호(스마트스토어)": r.smartstore_product_no ?? "",
    "노출용 상품명": r.display_name,
    "기본 상품명": r.base_name,
    "상품군 종류": r.product_group_name,
    "노출수": r.impressions,
    "클릭수": r.clicks,
    "CTR": Number(r.ctr),
    "CPC": Math.round(Number(r.cpc)),
    "총비용": Number(r.cost),
    "구매완료 전환수": r.conv_count,
    "구매완료 전환매출액(원)": Number(r.conv_revenue),
    "구매완료 ROAS": Number(r.conv_roas),
    "총 전환수": r.total_conv_count,
    "총 전환매출액(원)": Number(r.total_conv_revenue),
    "총 전환 ROAS": Number(r.total_roas),
  }));

export const toGroupSheet = (rows: GroupStat[]) =>
  rows.map((r) => ({
    "상품군 종류": r.product_group_name,
    "노출수": r.impressions,
    "클릭수": r.clicks,
    "CTR": Number(r.ctr),
    "CPC": Math.round(Number(r.cpc)),
    "총비용": Number(r.cost),
    "구매완료 전환수": r.conv_count,
    "구매완료 전환매출액(원)": Number(r.conv_revenue),
    "구매완료 ROAS": Number(r.conv_roas),
    "총 전환수": r.total_conv_count,
    "총 전환매출액(원)": Number(r.total_conv_revenue),
    "총 전환 ROAS": Number(r.total_roas),
    "포함 상품 수": r.product_count,
  }));

export const toUnmappedSheet = (rows: UnmappedRow[]) =>
  rows.map((r) => ({
    "소재 ID": r.creative_id,
    "API 상품값": r.raw_product_value,
    "최초 발생일": r.first_date,
    "최근 발생일": r.last_date,
    "노출수": r.impressions,
    "클릭수": r.clicks,
    "광고비": Number(r.cost),
    "미매핑 사유": r.reason,
  }));

export const toMappingSheet = (rows: CreativeMapping[]) =>
  rows.map((r) => ({
    "소재 ID": r.creative_id,
    "쇼핑몰 상품ID": r.products?.mall_product_id ?? "",
    "상품번호(스마트스토어)": r.products?.smartstore_product_no ?? "",
    "노출용 상품명": r.products?.display_name ?? "",
    "기본 상품명": r.products?.base_name ?? "",
    "상품군": r.products?.product_groups?.name ?? "",
    "사용 여부": r.is_active ? "Y" : "N",
    "최초 등록일": r.created_at?.slice(0, 10) ?? "",
    "최종 수정일": r.updated_at?.slice(0, 10) ?? "",
  }));

const summaryRows = (s: PeriodSummary, from: string, to: string) => [
  { "항목": "조회 기간", "값": `${from} ~ ${to}` },
  { "항목": "총 노출수", "값": s.impressions },
  { "항목": "총 클릭수", "값": s.clicks },
  { "항목": "CTR", "값": Number(s.ctr) },
  { "항목": "총 광고비", "값": Number(s.cost) },
  { "항목": "CPC", "값": Math.round(Number(s.cpc)) },
  { "항목": "구매완료 전환수", "값": s.conv_count },
  { "항목": "구매완료 전환매출액", "값": Number(s.conv_revenue) },
  { "항목": "구매완료 ROAS", "값": Number(s.conv_roas) },
  { "항목": "총 전환수", "값": s.total_conv_count },
  { "항목": "총 전환매출액", "값": Number(s.total_conv_revenue) },
  { "항목": "총 전환 ROAS", "값": Number(s.total_roas) },
];

// ---------------------------------------------------------------------------
// 단일 시트 다운로드
// ---------------------------------------------------------------------------
export function exportSheet(
  name: string, rows: Record<string, unknown>[], filename: string,
) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(rows), name.slice(0, 31));
  download(wb, filename);
}

// ---------------------------------------------------------------------------
// 전체 보고서 — 원본 엑셀과 유사한 시트 구성
// ---------------------------------------------------------------------------
export function exportFullReport(params: {
  from: string; to: string;
  summary: PeriodSummary;
  daily: DailyPoint[];
  products: ProductStat[];
  groups: GroupStat[];
  raw: RawRow[];
  unmapped: UnmappedRow[];
}) {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb, sheet(summaryRows(params.summary, params.from, params.to)), "대시보드 요약",
  );
  XLSX.utils.book_append_sheet(wb, sheet(params.daily.map((d) => ({
    "날짜": d.stat_date,
    "노출수": d.impressions,
    "클릭수": d.clicks,
    "CTR": Number(d.ctr),
    "총비용": Number(d.cost),
    "CPC": Math.round(Number(d.cpc)),
    "구매완료 전환수": d.conv_count,
    "구매완료 전환매출액(원)": Number(d.conv_revenue),
    "구매완료 ROAS": Number(d.conv_roas),
    "총 전환수": d.total_conv_count,
    "총 전환매출액(원)": Number(d.total_conv_revenue),
    "총 전환 ROAS": Number(d.total_roas),
  }))), "일별 추이");
  XLSX.utils.book_append_sheet(wb, sheet(toGroupSheet(params.groups)), "상품군별 데이터");
  XLSX.utils.book_append_sheet(wb, sheet(toProductSheet(params.products)), "상품별 데이터");
  XLSX.utils.book_append_sheet(wb, sheet(toResult2(params.raw)), "result2");
  XLSX.utils.book_append_sheet(wb, sheet(toUnmappedSheet(params.unmapped)), "미매핑 소재");

  download(wb, `초코펫하우스_광고보고서_${params.from}_${params.to}.xlsx`);
}

// ---------------------------------------------------------------------------
// 업로드 파싱
// ---------------------------------------------------------------------------
export interface ParsedMappingRow {
  creative_id: string;
  mall_product_id: string;
  smartstore_product_no?: string;
  display_name?: string;
  base_name?: string;
  group_name?: string;
  is_active: boolean;
}

/** 매핑 일괄 업로드 파일을 파싱한다. 헤더는 다운로드 양식과 동일하게 받는다. */
export async function parseMappingFile(file: File): Promise<{
  rows: ParsedMappingRow[];
  errors: string[];
}> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const rows: ParsedMappingRow[] = [];
  const errors: string[] = [];

  json.forEach((r, i) => {
    const line = i + 2;
    const creative = String(r["소재 ID"] ?? r["소재"] ?? "").trim();
    const mall = String(r["쇼핑몰 상품ID"] ?? "").trim();
    if (!creative) {
      errors.push(`${line}행: 소재 ID 가 비어 있습니다.`);
      return;
    }
    if (!/^\d+$/.test(mall)) {
      errors.push(`${line}행: 쇼핑몰 상품ID 가 숫자가 아닙니다 (${mall || "빈 값"}).`);
      return;
    }
    rows.push({
      creative_id: creative,
      mall_product_id: mall,
      smartstore_product_no: String(r["상품번호(스마트스토어)"] ?? "").trim() || undefined,
      display_name: String(r["노출용 상품명"] ?? "").trim() || undefined,
      base_name: String(r["기본 상품명"] ?? "").trim() || undefined,
      group_name: String(r["상품군"] ?? r["상품군 종류"] ?? "").trim() || undefined,
      is_active: String(r["사용 여부"] ?? "Y").trim().toUpperCase() !== "N",
    });
  });

  return { rows, errors };
}

export interface ParsedRawRow {
  creative_id: string;
  product_ref: string;
  impressions: number;
  clicks: number;
  cost: number;
  avg_rank: number | null;
  conv_count: number;
  conv_revenue: number;
  total_conv_count: number;
  total_conv_revenue: number;
  stat_date: string;
}

const toNum = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const toDate = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  // 엑셀 시리얼 값
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30 + n));
    return d.toISOString().slice(0, 10);
  }
  return "";
};

/** result2 형식 엑셀을 그대로 읽어 초기 데이터로 넣을 때 사용한다. */
export async function parseResult2File(file: File): Promise<{
  rows: ParsedRawRow[];
  errors: string[];
}> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const name = wb.SheetNames.includes("result2") ? "result2" : wb.SheetNames[0];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "" });

  const rows: ParsedRawRow[] = [];
  const errors: string[] = [];

  json.forEach((r, i) => {
    const line = i + 2;
    const creative = String(r["소재"] ?? "").trim();
    const date = toDate(r["날짜"]);
    if (!creative) {
      errors.push(`${line}행: 소재 값이 없습니다.`);
      return;
    }
    if (!date) {
      errors.push(`${line}행: 날짜를 읽지 못했습니다.`);
      return;
    }
    rows.push({
      creative_id: creative,
      product_ref: String(r["상품번호(스마트스토어)"] ?? "").trim(),
      impressions: toNum(r["노출수"]),
      clicks: toNum(r["클릭수"]),
      cost: toNum(r["총비용"]),
      avg_rank: r["평균노출순위"] === "" ? null : toNum(r["평균노출순위"]),
      conv_count: toNum(r["구매완료 전환수"]),
      conv_revenue: toNum(r["구매완료 전환매출액(원)"]),
      total_conv_count: toNum(r["총 전환수"]),
      total_conv_revenue: toNum(r["총 전환매출액(원)"]),
      stat_date: date,
    });
  });

  return { rows, errors };
}

// ---------------------------------------------------------------------------
// 상품군 대량 관리 업로드
// 양식: 상품명 | 그룹명 | (선택)상품ID  +  별도 열 '상품군 종류'(그룹 목록)
//   - 상품명↔그룹 매핑으로 상품을 상품군에 연결
//   - '상품군 종류' 열의 값들은 그룹 자체를 미리 만들어 두는 데 쓴다
//   - 상품ID 열이 있으면 이름 대신 ID 로 정확히 식별
// ---------------------------------------------------------------------------
export interface ParsedGroupBulk {
  /** 상품↔그룹 연결 (상품명 또는 상품ID 기준) */
  assignments: Array<{ productName?: string; productId?: string; groupName: string }>;
  /** 새로 만들 상품군 이름 목록 (중복 제거) */
  groupNames: string[];
  errors: string[];
}

export async function parseGroupBulkFile(file: File): Promise<ParsedGroupBulk> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const assignments: ParsedGroupBulk["assignments"] = [];
  const groupSet = new Set<string>();
  const errors: string[] = [];

  const pick = (r: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      if (v !== undefined && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  json.forEach((r, i) => {
    const line = i + 2;
    const productName = pick(r, ["상품명", "기본 상품명", "노출용 상품명", "productName"]);
    const productId = pick(r, ["상품ID", "쇼핑몰 상품ID", "상품번호(스마트스토어)", "productId"]);
    const groupName = pick(r, ["그룹명", "상품군", "groupName"]);
    // '상품군 종류' 열: 그룹 목록 정의용 (상품 연결과 별개)
    const groupType = pick(r, ["상품군 종류", "상품군종류", "groupType"]);

    if (groupType) groupSet.add(groupType);
    if (groupName) groupSet.add(groupName);

    // 상품 연결 행: 그룹명이 있고, 상품명이나 상품ID 중 하나라도 있으면.
    if (groupName && (productName || productId)) {
      assignments.push({
        productName: productName || undefined,
        productId: productId || undefined,
        groupName,
      });
    } else if (!groupType && (productName || productId) && !groupName) {
      errors.push(`${line}행: 그룹명이 비어 있습니다.`);
    }
  });

  return { assignments, groupNames: [...groupSet], errors };
}
