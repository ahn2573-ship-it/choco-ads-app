import { describe, expect, it } from "vitest";
import {
  aggregate, cpc, ctr, delta, isUnderperforming, roas, safeDiv,
} from "../src/lib/metrics";

describe("safeDiv — 분모가 0이면 오류 대신 0", () => {
  it("정상 나눗셈", () => {
    expect(safeDiv(10, 4)).toBe(2.5);
  });

  it("분모 0", () => {
    expect(safeDiv(100, 0)).toBe(0);
  });

  it("분자와 분모 모두 0", () => {
    expect(safeDiv(0, 0)).toBe(0);
  });

  it("NaN 이나 Infinity 가 새어 나오지 않는다", () => {
    expect(Number.isFinite(safeDiv(1, 0))).toBe(true);
    expect(safeDiv(Number.NaN, 5)).toBeNaN();
  });
});

describe("CTR / CPC / ROAS", () => {
  it("CTR = 클릭수 ÷ 노출수", () => {
    expect(ctr(22, 526)).toBeCloseTo(0.0418251, 6);
  });

  it("CPC = 총비용 ÷ 클릭수", () => {
    expect(cpc(38948, 22)).toBeCloseTo(1770.36, 2);
  });

  it("구매완료 ROAS = 구매완료 전환매출액 ÷ 총비용", () => {
    // 엑셀 '상품별 데이터' 첫 행과 같은 값이 나와야 한다.
    expect(roas(717880, 186114)).toBeCloseTo(3.8572, 4);
  });

  it("총 전환 ROAS", () => {
    expect(roas(2167880, 186114)).toBeCloseTo(11.6481, 4);
  });

  it("노출·클릭·광고비가 0이어도 계산이 깨지지 않는다", () => {
    expect(ctr(0, 0)).toBe(0);
    expect(cpc(0, 0)).toBe(0);
    expect(roas(50000, 0)).toBe(0);
  });
});

describe("aggregate — 합산 후 재계산", () => {
  const rows = [
    { impressions: 1000, clicks: 10, cost: 10000, conv_count: 1, conv_revenue: 50000, total_conv_count: 2, total_conv_revenue: 80000 },
    { impressions: 100, clicks: 50, cost: 5000, conv_count: 0, conv_revenue: 0, total_conv_count: 1, total_conv_revenue: 20000 },
  ];

  it("원시 지표는 단순 합계", () => {
    const a = aggregate(rows);
    expect(a.impressions).toBe(1100);
    expect(a.clicks).toBe(60);
    expect(a.cost).toBe(15000);
  });

  it("CTR 은 비율의 평균이 아니라 합계로 다시 계산한다", () => {
    const a = aggregate(rows);
    // 비율 평균이면 (0.01 + 0.5) / 2 = 0.255 로 크게 부풀려진다.
    expect(a.ctr).toBeCloseTo(60 / 1100, 10);
    expect(a.ctr).not.toBeCloseTo(0.255, 3);
  });

  it("ROAS 도 합계 기준", () => {
    const a = aggregate(rows);
    expect(a.conv_roas).toBeCloseTo(50000 / 15000, 10);
  });

  it("빈 배열이면 전부 0", () => {
    const a = aggregate([]);
    expect(a.cost).toBe(0);
    expect(a.ctr).toBe(0);
    expect(a.conv_roas).toBe(0);
  });
});

describe("delta — 지표마다 좋은 방향이 다르다", () => {
  it("ROAS 상승은 좋은 변화", () => {
    expect(delta(3.5, 2.0, "conv_roas").tone).toBe("good");
  });

  it("CPC 상승은 나쁜 변화", () => {
    expect(delta(2000, 1200, "cpc").tone).toBe("bad");
  });

  it("CPC 하락은 좋은 변화", () => {
    expect(delta(900, 1200, "cpc").tone).toBe("good");
  });

  it("광고비는 중립 — 증감만으로 좋고 나쁨을 판단하지 않는다", () => {
    expect(delta(200000, 100000, "cost").tone).toBe("flat");
  });

  it("이전 값이 0이면 변화율을 만들지 않는다", () => {
    expect(delta(500, 0, "clicks").pct).toBeNull();
  });

  it("변화율 계산", () => {
    expect(delta(150, 100, "clicks").pct).toBeCloseTo(50, 10);
    expect(delta(50, 100, "clicks").pct).toBeCloseTo(-50, 10);
  });
});

describe("isUnderperforming", () => {
  const opts = { minCost: 30000, targetRoas: 200 };

  it("광고비가 기준 미만이면 대상이 아니다", () => {
    expect(isUnderperforming({ cost: 1000, conv_count: 0, conv_roas: 0 }, opts)).toBe(false);
  });

  it("광고비를 썼는데 구매완료가 0이면 저성과", () => {
    expect(isUnderperforming({ cost: 50000, conv_count: 0, conv_roas: 0 }, opts)).toBe(true);
  });

  it("ROAS 가 목표 미달이면 저성과", () => {
    expect(isUnderperforming({ cost: 50000, conv_count: 3, conv_roas: 1.2 }, opts)).toBe(true);
  });

  it("목표를 넘기면 정상", () => {
    expect(isUnderperforming({ cost: 50000, conv_count: 3, conv_roas: 3.5 }, opts)).toBe(false);
  });
});
