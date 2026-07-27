const nf = new Intl.NumberFormat("ko-KR");

export const num = (v: number | null | undefined) => nf.format(Math.round(Number(v ?? 0)));

/** 금액은 원 단위, 소수점 없이 */
export const won = (v: number | null | undefined) => `${num(v)}원`;

/** 소수 비율(0.0234)을 퍼센트 문자열로 */
export const pct = (v: number | null | undefined, digits = 2) =>
  `${(Number(v ?? 0) * 100).toFixed(digits)}%`;

/** ROAS 는 배수가 아니라 퍼센트로 보는 관행을 따른다 (3.85 -> 385%) */
export const roasPct = (v: number | null | undefined, digits = 0) =>
  `${(Number(v ?? 0) * 100).toFixed(digits)}%`;

export const decimal = (v: number | null | undefined, digits = 1) =>
  Number(v ?? 0).toFixed(digits);

/** 이미 퍼센트 스케일인 값 (증감률 등) */
export const signedPct = (v: number | null, digits = 1) => {
  if (v === null || !Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
};

export const compact = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${(v / 10_000).toFixed(1)}만`;
  return num(v);
};

export const shortDate = (d: string) => d.slice(5).replace("-", "/");
