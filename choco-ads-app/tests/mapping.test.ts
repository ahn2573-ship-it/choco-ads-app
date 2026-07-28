import { describe, expect, it } from "vitest";
import {
  dedupeRows, isNumericProductId, mapRow, normalizeDate, toNumber,
} from "../supabase/functions/sync-ads/mapper";

describe("isNumericProductId — 상품 ID 와 광고 유형 구분", () => {
  it("숫자형 상품 ID", () => {
    expect(isNumericProductId("4141857911")).toBe(true);
    expect(isNumericProductId(12793789650)).toBe(true);
  });

  it("0 은 상품 ID 로 보지 않는다 — 엑셀에서 매핑 실패 표시로 쓰던 값", () => {
    expect(isNumericProductId("0")).toBe(false);
    expect(isNumericProductId(0)).toBe(false);
  });

  it("광고 유형 문자열", () => {
    expect(isNumericProductId("파워링크")).toBe(false);
    expect(isNumericProductId("브랜드 검색")).toBe(false);
    expect(isNumericProductId("쇼핑브랜드형")).toBe(false);
  });

  it("빈 값", () => {
    expect(isNumericProductId(null)).toBe(false);
    expect(isNumericProductId(undefined)).toBe(false);
    expect(isNumericProductId("")).toBe(false);
  });

  it("숫자와 문자열이 섞여 들어와도 같은 판정", () => {
    expect(isNumericProductId("4141857911")).toBe(isNumericProductId(4141857911));
  });
});

describe("toNumber", () => {
  it("천 단위 구분 기호가 붙은 값", () => {
    expect(toNumber("1,285")).toBe(1285);
  });
  it("빈 값과 잘못된 값은 0", () => {
    expect(toNumber("")).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("없음")).toBe(0);
  });
});

describe("normalizeDate — 한국 시간과 UTC 가 섞여 들어오는 경우", () => {
  it("YYYY-MM-DD 는 그대로", () => {
    expect(normalizeDate("2026-07-23", "2026-01-01")).toBe("2026-07-23");
  });

  it("YYYYMMDD 형식", () => {
    expect(normalizeDate("20260723", "2026-01-01")).toBe("2026-07-23");
  });

  it("UTC 타임스탬프는 Asia/Seoul 날짜로 바뀐다", () => {
    // UTC 2026-07-22 16:00 = KST 2026-07-23 01:00
    expect(normalizeDate("2026-07-22T16:00:00Z", "2026-01-01")).toBe("2026-07-23");
  });

  it("읽을 수 없으면 fallback", () => {
    expect(normalizeDate("", "2026-07-23")).toBe("2026-07-23");
    expect(normalizeDate(null, "2026-07-23")).toBe("2026-07-23");
  });
});

describe("mapRow — API 응답을 내부 구조로", () => {
  it("숫자 상품 ID 는 mallProductId 로", () => {
    const r = mapRow({
      adId: "nad-a001-01-000000202997465",
      productId: "4141857911",
      impCnt: 526, clkCnt: 22, salesAmt: 38948, avgRnk: 3,
      ccnt: 1, convAmt: 34920, totalConvCnt: 5, totalConvAmt: 572820,
      statDt: "2026-07-22",
    }, "2026-07-22");

    expect(r.mallProductId).toBe("4141857911");
    expect(r.adTypeLabel).toBeNull();
    expect(r.impressions).toBe(526);
    expect(r.convRevenue).toBe(34920);
  });

  it("문자열 광고 유형은 adTypeLabel 로", () => {
    const r = mapRow({ adId: "-", productId: "파워링크", impCnt: 100 }, "2026-07-22");
    expect(r.mallProductId).toBeNull();
    expect(r.adTypeLabel).toBe("파워링크");
  });

  it("상품값이 0 이면 둘 다 비운다 — 미매핑으로 분류되어야 한다", () => {
    const r = mapRow({ adId: "nad-x", productId: "0" }, "2026-07-22");
    expect(r.mallProductId).toBeNull();
    expect(r.adTypeLabel).toBeNull();
  });

  it("소재 ID 가 없으면 하이픈으로 채운다", () => {
    const r = mapRow({ impCnt: 53 }, "2026-07-22");
    expect(r.creativeId).toBe("-");
  });

  it("한글 헤더(엑셀 양식)로 들어와도 매핑된다", () => {
    const r = mapRow({
      "소재": "nad-a001-01-000000202487581",
      "상품번호(스마트스토어)": "11784716938",
      "노출수": 90, "클릭수": 2, "총비용": 1285,
      "날짜": "2026-07-22",
    }, "2026-01-01");
    expect(r.creativeId).toBe("nad-a001-01-000000202487581");
    expect(r.mallProductId).toBe("11784716938");
    expect(r.cost).toBe(1285);
    expect(r.statDate).toBe("2026-07-22");
  });
});

describe("dedupeRows — API 가 중복 행을 주는 경우", () => {
  const base = {
    creativeId: "nad-1", mallProductId: "111", adTypeLabel: null,
    clicks: 0, cost: 0, avgRank: null, convCount: 0, convRevenue: 0,
    totalConvCount: 0, totalConvRevenue: 0, statDate: "2026-07-23",
  };

  it("같은 키는 하나로 합쳐지고 지표는 합산된다", () => {
    const out = dedupeRows([
      { ...base, impressions: 100, clicks: 5, cost: 5000 },
      { ...base, impressions: 50, clicks: 3, cost: 2000 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].impressions).toBe(150);
    expect(out[0].clicks).toBe(8);
    expect(out[0].cost).toBe(7000);
  });

  it("상품이 다르면 별개 행으로 남는다", () => {
    const out = dedupeRows([
      { ...base, impressions: 10 },
      { ...base, mallProductId: "222", impressions: 20 },
    ]);
    expect(out).toHaveLength(2);
  });

  it("같은 소재라도 날짜가 다르면 합치지 않는다", () => {
    const out = dedupeRows([
      { ...base, impressions: 10 },
      { ...base, statDate: "2026-07-22", impressions: 20 },
    ]);
    expect(out).toHaveLength(2);
  });

  it("평균노출순위는 노출수 가중평균", () => {
    const out = dedupeRows([
      { ...base, impressions: 100, avgRank: 2 },
      { ...base, impressions: 300, avgRank: 4 },
    ]);
    // (2*100 + 4*300) / 400 = 3.5
    expect(out[0].avgRank).toBeCloseTo(3.5, 10);
  });

  it("소재 하나가 상품과 광고 유형 양쪽으로 들어오면 분리 보관", () => {
    const out = dedupeRows([
      { ...base, impressions: 10 },
      { ...base, mallProductId: null, adTypeLabel: "파워링크", impressions: 30 },
    ]);
    expect(out).toHaveLength(2);
  });
});
