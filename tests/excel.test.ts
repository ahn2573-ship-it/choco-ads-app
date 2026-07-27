import { describe, expect, it } from "vitest";
import { toGroupSheet, toProductSheet, toResult2 } from "../src/lib/excel";
import type { GroupStat, ProductStat, RawRow } from "../src/lib/types";

const raw: RawRow = {
  id: "1", stat_date: "2026-07-22", creative_id: "nad-a001-01-000000202997465",
  product_id: "p1", mall_product_id: "4141857911", ad_type_label: null,
  impressions: 526, clicks: 22, cost: 38948, avg_rank: 3,
  conv_count: 1, conv_revenue: 34920, total_conv_count: 5, total_conv_revenue: 572820,
  source: "api",
};

describe("result2 형식 내보내기", () => {
  it("원본 엑셀과 같은 헤더를 쓴다", () => {
    const [row] = toResult2([raw]);
    expect(Object.keys(row)).toEqual([
      "소재", "상품번호(스마트스토어)", "노출수", "클릭수", "총비용", "평균노출순위",
      "구매완료 전환수", "구매완료 전환매출액(원)", "총 전환수", "총 전환매출액(원)", "날짜",
    ]);
  });

  it("상품 매핑이 없으면 광고 유형을, 그것도 없으면 0 을 넣는다", () => {
    const [withType] = toResult2([{ ...raw, mall_product_id: null, ad_type_label: "파워링크" }]);
    expect(withType["상품번호(스마트스토어)"]).toBe("파워링크");

    const [unmapped] = toResult2([{ ...raw, mall_product_id: null, ad_type_label: null }]);
    expect(unmapped["상품번호(스마트스토어)"]).toBe(0);
  });

  it("수식이 아니라 계산된 값이 들어간다", () => {
    const [row] = toResult2([raw]);
    expect(typeof row["총비용"]).toBe("number");
    expect(String(row["총비용"]).startsWith("=")).toBe(false);
  });
});

describe("상품별 / 상품군별 시트", () => {
  const product: ProductStat = {
    product_id: "p1", mall_product_id: "4141857911", smartstore_product_no: null,
    display_name: "논슬립스텝 2.0 소형", base_name: "논슬립 스텝 2.0",
    product_group_id: "g1", product_group_name: "강아지계단",
    impressions: 14423, clicks: 88, ctr: 0.0061, cpc: 2114.93, cost: 186114,
    conv_count: 10, conv_revenue: 717880, conv_roas: 3.8572,
    total_conv_count: 28, total_conv_revenue: 2167880, total_roas: 11.648,
    creative_count: 4,
  };

  it("상품별 시트 헤더", () => {
    const [row] = toProductSheet([product]);
    expect(Object.keys(row)).toContain("구매완료 ROAS");
    expect(Object.keys(row)).toContain("총 전환 ROAS");
    expect(row["상품군 종류"]).toBe("강아지계단");
  });

  it("CPC 는 원 단위 정수로 반올림", () => {
    const [row] = toProductSheet([product]);
    expect(row["CPC"]).toBe(2115);
  });

  it("상품군 시트에는 포함 상품 수가 들어간다", () => {
    const group: GroupStat = {
      product_group_id: "g1", product_group_name: "강아지계단",
      impressions: 20293, clicks: 175, ctr: 0.0086, cpc: 1755, cost: 307069,
      conv_count: 19, conv_revenue: 1415650, conv_roas: 4.6103,
      total_conv_count: 50, total_conv_revenue: 4834650, total_roas: 15.74,
      product_count: 3,
    };
    const [row] = toGroupSheet([group]);
    expect(row["포함 상품 수"]).toBe(3);
  });
});
