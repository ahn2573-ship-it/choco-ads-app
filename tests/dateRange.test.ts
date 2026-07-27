import { describe, expect, it } from "vitest";
import {
  addDays, comparisonRange, diffDays, resolveRange,
} from "../src/lib/dateRange";

// 2026-07-24 는 금요일이다.
const TODAY = "2026-07-24";

describe("기간 프리셋 (Asia/Seoul 기준)", () => {
  it("어제", () => {
    expect(resolveRange("yesterday", TODAY)).toMatchObject({
      from: "2026-07-23", to: "2026-07-23",
    });
  });

  it("최근 7일은 오늘을 포함해 7일", () => {
    const r = resolveRange("last7", TODAY);
    expect(r).toMatchObject({ from: "2026-07-18", to: "2026-07-24" });
    expect(diffDays(r.from, r.to)).toBe(6);
  });

  it("최근 30일", () => {
    expect(resolveRange("last30", TODAY).from).toBe("2026-06-25");
  });

  it("이번 주는 월요일부터", () => {
    expect(resolveRange("thisWeek", TODAY)).toMatchObject({
      from: "2026-07-20", to: "2026-07-24",
    });
  });

  it("지난주는 월~일 전체", () => {
    expect(resolveRange("lastWeek", TODAY)).toMatchObject({
      from: "2026-07-13", to: "2026-07-19",
    });
  });

  it("이번 달", () => {
    expect(resolveRange("thisMonth", TODAY)).toMatchObject({
      from: "2026-07-01", to: "2026-07-24",
    });
  });

  it("지난달은 말일까지", () => {
    expect(resolveRange("lastMonth", TODAY)).toMatchObject({
      from: "2026-06-01", to: "2026-06-30",
    });
  });

  it("월말 경계 — 3월 기준 지난달은 2월 28일까지", () => {
    expect(resolveRange("lastMonth", "2026-03-15").to).toBe("2026-02-28");
  });
});

describe("비교 기간", () => {
  const range = { from: "2026-07-18", to: "2026-07-24", key: "last7" as const };

  it("직전 기간은 같은 길이로 바로 앞", () => {
    expect(comparisonRange(range, "prev_period")).toMatchObject({
      from: "2026-07-11", to: "2026-07-17",
    });
  });

  it("전주 동일 기간", () => {
    expect(comparisonRange(range, "prev_week")).toMatchObject({
      from: "2026-07-11", to: "2026-07-17",
    });
  });

  it("전월 동일 기간", () => {
    expect(comparisonRange(range, "prev_month")).toMatchObject({
      from: "2026-06-18", to: "2026-06-24",
    });
  });

  it("비교 없음", () => {
    expect(comparisonRange(range, "none")).toBeNull();
  });

  it("하루짜리 기간의 직전 기간은 전일", () => {
    const one = { from: "2026-07-23", to: "2026-07-23", key: "yesterday" as const };
    expect(comparisonRange(one, "prev_period")).toMatchObject({
      from: "2026-07-22", to: "2026-07-22",
    });
  });

  it("비교 기간의 길이는 원본과 같다", () => {
    const c = comparisonRange(range, "prev_period")!;
    expect(diffDays(c.from, c.to)).toBe(diffDays(range.from, range.to));
  });
});

describe("날짜 연산은 타임존에 흔들리지 않는다", () => {
  it("월 경계를 넘어가는 덧셈", () => {
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("윤년", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});
