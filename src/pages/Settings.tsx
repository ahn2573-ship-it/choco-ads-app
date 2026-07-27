import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { api, supabase } from "@/lib/supabase";
import { parseResult2File } from "@/lib/excel";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardHeader, ErrorState, Input, Select, TableSkeleton } from "@/components/ui";

const RULE_LABELS: Record<string, { label: string; unit: string; hint: string }> = {
  cost_no_conversion: { label: "광고비 소진, 구매완료 전환 0", unit: "원 이상", hint: "이 금액 이상 쓴 상품 중 구매완료가 없는 경우" },
  low_roas: { label: "ROAS 목표 미달", unit: "% 미만", hint: "구매완료 ROAS 기준" },
  high_cpc: { label: "CPC 상승", unit: "원 초과", hint: "클릭당 비용 기준" },
  low_ctr: { label: "CTR 저조", unit: "% 미만", hint: "노출 100회 이상인 상품만 대상" },
  cost_spike: { label: "전일 대비 광고비 급증", unit: "% 이상", hint: "전일 광고비 대비 증가율" },
  revenue_drop: { label: "전일 대비 매출 급감", unit: "% 이상", hint: "전일 매출 대비 감소율" },
  unmapped_creative: { label: "신규 소재 매핑 없음", unit: "", hint: "임계값 없이 항상 검사" },
  sync_failed: { label: "데이터 수집 실패", unit: "", hint: "임계값 없이 항상 검사" },
  missing_data: { label: "전일 데이터 없음", unit: "", hint: "임계값 없이 항상 검사" },
};

export function Settings() {
  const { accountId } = useAppState();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newMatch, setNewMatch] = useState("contains");

  const rules = useQuery({ queryKey: ["alert-rules"], queryFn: api.alertRules });
  const excluded = useQuery({ queryKey: ["excluded"], queryFn: api.excludedAdTypes });

  async function saveRule(id: string, patch: { threshold?: number | null; is_active?: boolean }) {
    await api.saveAlertRule({ id, ...patch });
    qc.invalidateQueries({ queryKey: ["alert-rules"] });
  }

  async function addExcluded() {
    if (!newLabel.trim()) return;
    await api.saveExcludedAdType({ label: newLabel.trim(), match_type: newMatch, is_active: true });
    setNewLabel("");
    qc.invalidateQueries({ queryKey: ["excluded"] });
  }

  // -------------------------------------------------------------------------
  // result2 엑셀을 초기 데이터로 가져오기
  // -------------------------------------------------------------------------
  async function importResult2(file: File) {
    if (!accountId) return;
    setImporting(true);
    setMessage(null);
    try {
      const { rows, errors } = await parseResult2File(file);
      if (!rows.length) {
        setMessage("읽을 수 있는 행이 없습니다. result2 시트 헤더를 확인하세요.");
        return;
      }

      // 소재 등록
      const creativeIds = [...new Set(rows.map((r) => r.creative_id))].filter((c) => c !== "-");
      await supabase.from("creatives").upsert(
        creativeIds.map((creative_id) => ({ ad_account_id: accountId, creative_id })),
        { onConflict: "ad_account_id,creative_id", ignoreDuplicates: true },
      );

      // 기존 매핑으로 상품 연결
      const { data: mappings } = await supabase
        .from("creative_product_mappings")
        .select("creative_id, product_id, products(mall_product_id)")
        .eq("ad_account_id", accountId);
      const byCreative = new Map(
        (mappings ?? []).map((m) => [m.creative_id, {
          productId: m.product_id,
          // deno-lint-ignore no-explicit-any
          mallId: (m as any).products?.mall_product_id ?? null,
        }]),
      );

      const isNumeric = (v: string) => /^\d+$/.test(v) && v !== "0";
      const mallIds = [...new Set(rows.map((r) => r.product_ref).filter(isNumeric))];
      const { data: products } = await supabase.from("products")
        .select("id, mall_product_id").in("mall_product_id", mallIds);
      const byMall = new Map((products ?? []).map((p) => [p.mall_product_id, p.id]));

      const payload = rows.map((r) => {
        const viaCreative = byCreative.get(r.creative_id);
        const numeric = isNumeric(r.product_ref);
        return {
          ad_account_id: accountId,
          stat_date: r.stat_date,
          creative_id: r.creative_id,
          product_id: viaCreative?.productId ?? (numeric ? byMall.get(r.product_ref) ?? null : null),
          mall_product_id: numeric ? r.product_ref : viaCreative?.mallId ?? null,
          ad_type_label: !numeric && r.product_ref && r.product_ref !== "0" ? r.product_ref : null,
          impressions: r.impressions,
          clicks: r.clicks,
          cost: r.cost,
          avg_rank: r.avg_rank,
          conv_count: r.conv_count,
          conv_revenue: r.conv_revenue,
          total_conv_count: r.total_conv_count,
          total_conv_revenue: r.total_conv_revenue,
          source: "excel_import",
        };
      });

      // 청크 단위 upsert — 같은 날짜를 다시 올려도 중복되지 않는다.
      let done = 0;
      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase.from("ad_performance_daily")
          .upsert(payload.slice(i, i + 500), {
            onConflict: "ad_account_id,stat_date,creative_id,dedupe_key",
          });
        if (error) throw new Error(error.message);
        done += Math.min(500, payload.length - i);
      }

      setMessage(`${done}건을 반영했습니다.` + (errors.length ? ` (${errors.length}건 건너뜀)` : ""));
      qc.invalidateQueries();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "가져오기에 실패했습니다.");
    } finally {
      setImporting(false);
    }
  }

  if (rules.error) return <ErrorState error={rules.error} onRetry={() => rules.refetch()} />;

  return (
    <>
      <PageHeader title="설정" description="알림 규칙, 집계 제외 항목, 초기 데이터 가져오기" />

      {message && (
        <div className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-xs">{message}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* 알림 규칙 --------------------------------------------------------- */}
        <Card>
          <CardHeader title="알림 규칙"
            description="임계값을 비우면 해당 규칙은 검사하지 않습니다" />
          {rules.isLoading ? <TableSkeleton rows={6} cols={3} /> : (
            <ul className="divide-y divide-line">
              {(rules.data ?? []).map((r) => {
                const meta = RULE_LABELS[r.rule_type] ?? { label: r.rule_type, unit: "", hint: "" };
                return (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <label className="flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        onChange={(e) => saveRule(r.id, { is_active: e.target.checked })}
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{meta.label}</p>
                      <p className="text-2xs text-ink-faint">{meta.hint}</p>
                    </div>
                    {meta.unit && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          className="h-8 w-28 text-right text-xs"
                          defaultValue={r.threshold ?? ""}
                          onBlur={(e) => saveRule(r.id, {
                            threshold: e.target.value === "" ? null : Number(e.target.value),
                          })}
                        />
                        <span className="w-16 text-2xs text-ink-faint">{meta.unit}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* 제외 광고 유형 ---------------------------------------------------- */}
        <Card>
          <CardHeader
            title="일반 상품 집계 제외 항목"
            description="제외된 값은 삭제되지 않고 '기타 광고 유형'으로 따로 볼 수 있습니다"
          />
          {excluded.isLoading ? <TableSkeleton rows={5} cols={3} /> : (
            <ul className="divide-y divide-line">
              {(excluded.data ?? []).map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={e.is_active}
                    onChange={(ev) => api.saveExcludedAdType({
                      id: e.id, label: e.label, match_type: e.match_type,
                      is_active: ev.target.checked,
                    }).then(() => qc.invalidateQueries({ queryKey: ["excluded"] }))}
                  />
                  <span className="flex-1 text-sm">{e.label}</span>
                  <Badge tone="neutral">
                    {e.match_type === "exact" ? "정확히 일치" : "포함"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 border-t border-line px-4 py-3">
            <Input className="h-8 flex-1 text-xs" placeholder="추가할 광고 유형"
              value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <Select className="h-8 text-xs" value={newMatch} onChange={(e) => setNewMatch(e.target.value)}>
              <option value="contains">포함</option>
              <option value="exact">정확히 일치</option>
            </Select>
            <Button size="sm" variant="primary" onClick={addExcluded} disabled={!newLabel.trim()}>
              <Plus className="h-3.5 w-3.5" /> 추가
            </Button>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-2xs text-ink-faint">
            상품번호 0 과 매핑 실패 건은 규칙과 무관하게 항상 '미매핑'으로 분리됩니다.
          </p>
        </Card>

        {/* 엑셀 가져오기 ----------------------------------------------------- */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="엑셀 초기 데이터 가져오기"
            description="기존 데일리보고서의 result2 시트를 그대로 올리면 RAW 데이터로 들어갑니다"
          />
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <input
              ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importResult2(f);
                e.target.value = "";
              }}
            />
            <Button variant="primary" loading={importing} onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> result2 엑셀 올리기
            </Button>
            <p className="text-xs text-ink-muted">
              필요한 헤더: 소재 · 상품번호(스마트스토어) · 노출수 · 클릭수 · 총비용 ·
              평균노출순위 · 구매완료 전환수 · 구매완료 전환매출액(원) · 총 전환수 ·
              총 전환매출액(원) · 날짜
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
