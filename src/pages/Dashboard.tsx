import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/supabase";
import { COMPARE_LABELS, comparisonRange } from "@/lib/dateRange";
import { exportFullReport } from "@/lib/excel";
import { won, num, roasPct } from "@/lib/format";
import { PageHeader } from "@/components/layout/AppShell";
import { PeriodFilter } from "@/components/layout/PeriodFilter";
import { KpiStrip } from "@/components/KpiStrip";
import { CategoryBarChart, CostRevenueChart, DailyTrendChart } from "@/components/charts/Charts";
import { Button, Card, CardHeader, EmptyState, ErrorState, Select, TableSkeleton } from "@/components/ui";
import type { Bucket } from "@/lib/types";

export function Dashboard() {
  const { accountId, range, compare, groups } = useAppState();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [groupId, setGroupId] = useState<string>("");
  const [bucket, setBucket] = useState<Bucket>("product");
  const [campaignType, setCampaignType] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const prevRange = comparisonRange(range, compare);
  const enabled = Boolean(accountId);
  const base = {
    account: accountId!, from: range.from, to: range.to,
    groupId: groupId || null, bucket,
    campaignType: campaignType || null,
  };

  // 캠페인 유형 목록 (드롭다운 선택지)
  const campaignTypes = useQuery({
    queryKey: ["campaign-types", accountId, range],
    queryFn: () => api.campaignTypes({ account: accountId!, from: range.from, to: range.to }),
    enabled,
  });

  const summary = useQuery({
    queryKey: ["summary", base],
    queryFn: () => api.summary(base),
    enabled,
  });

  const prevSummary = useQuery({
    queryKey: ["summary-prev", accountId, prevRange, groupId, bucket],
    queryFn: () => api.summary({ ...base, from: prevRange!.from, to: prevRange!.to }),
    enabled: enabled && Boolean(prevRange),
  });

  const daily = useQuery({
    queryKey: ["daily", base],
    queryFn: () => api.dailySeries(base),
    enabled,
  });

  const groupStats = useQuery({
    queryKey: ["group-stats", accountId, range],
    queryFn: () => api.groupStats({ account: accountId!, from: range.from, to: range.to }),
    enabled,
  });

  const productStats = useQuery({
    queryKey: ["product-stats", base],
    queryFn: () => api.productStats(base),
    enabled,
  });

  const zeroConv = useQuery({
    queryKey: ["zero-conv", accountId, range],
    queryFn: () => api.zeroConversion({ account: accountId!, from: range.from, to: range.to, minCost: 1 }),
    enabled,
  });

  const topByCost = useMemo(
    () => (productStats.data ?? []).slice(0, 10).map((p) => ({ ...p, cost: Number(p.cost) })),
    [productStats.data],
  );
  const topByRevenue = useMemo(
    () => [...(productStats.data ?? [])]
      .sort((a, b) => Number(b.conv_revenue) - Number(a.conv_revenue))
      .slice(0, 10),
    [productStats.data],
  );
  const topByRoas = useMemo(
    () => [...(productStats.data ?? [])]
      .filter((p) => Number(p.cost) > 0)
      .sort((a, b) => Number(b.conv_roas) - Number(a.conv_roas))
      .slice(0, 10),
    [productStats.data],
  );
  const groupCostRevenue = useMemo(
    () => (groupStats.data ?? []).slice(0, 12).map((g) => ({
      name: g.product_group_name,
      cost: Number(g.cost),
      revenue: Number(g.conv_revenue),
      id: g.product_group_id,
    })),
    [groupStats.data],
  );

  async function handleSync() {
    if (!accountId) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await api.triggerSync({ account: accountId });
      setSyncMessage(res.ok
        ? `수집 완료 — ${res.upserted ?? 0}건 반영, 미매핑 ${res.unmapped ?? 0}건`
        : `수집 실패 — ${res.error ?? "원인 미상"}`);
      await Promise.all([summary.refetch(), daily.refetch(), productStats.refetch()]);
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : "수집 요청에 실패했습니다.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleExport() {
    if (!accountId) return;
    const [raw, unmapped] = await Promise.all([
      api.rawRows({ account: accountId, from: range.from, to: range.to, pageSize: 5000 }),
      api.unmapped({ account: accountId, from: range.from, to: range.to }),
    ]);
    exportFullReport({
      from: range.from,
      to: range.to,
      summary: summary.data!,
      daily: daily.data ?? [],
      products: productStats.data ?? [],
      groups: groupStats.data ?? [],
      raw: raw.rows,
      unmapped,
    });
  }

  if (summary.error) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;

  return (
    <>
      <PageHeader
        title="대시보드"
        description="광고 API 로 수집된 일별 데이터를 기간별로 집계합니다"
        actions={
          <>
            <Select value={campaignType} onChange={(e) => setCampaignType(e.target.value)}
              className="h-9 text-xs" aria-label="캠페인 유형">
              <option value="">전체 광고</option>
              {(campaignTypes.data ?? [])
                .filter((t) => t.campaign_type !== "00")
                .map((t) => (
                  <option key={t.campaign_type} value={t.campaign_type}>
                    {t.campaign_type_label}
                  </option>
                ))}
            </Select>
            <Select value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)}
              className="h-9 text-xs" aria-label="광고 유형">
              <option value="product">일반 상품</option>
              <option value="other_ad">기타 광고 유형</option>
              <option value="unmapped">미매핑</option>
              <option value="all">전체</option>
            </Select>
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}
              className="h-9 text-xs" aria-label="상품군">
              <option value="">전체 상품군</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <Button size="md" onClick={handleExport} disabled={!summary.data}>
              <Download className="h-3.5 w-3.5" /> 전체 보고서
            </Button>
            {isAdmin && (
              <Button size="md" variant="primary" onClick={handleSync} loading={syncing}>
                <RefreshCw className="h-3.5 w-3.5" /> 전일 데이터 수집
              </Button>
            )}
          </>
        }
      />

      {syncMessage && (
        <div className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
          {syncMessage}
        </div>
      )}

      <PeriodFilter />

      <KpiStrip
        current={summary.data}
        previous={prevRange ? prevSummary.data : undefined}
        series={daily.data}
        compareLabel={COMPARE_LABELS[compare]}
        loading={summary.isLoading}
      />

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <DailyTrendChart data={daily.data ?? []} metric="cost" title="일별 광고비"
          format="won" loading={daily.isLoading} />
        <DailyTrendChart data={daily.data ?? []} metric="conv_revenue" title="일별 구매완료 매출"
          format="won" loading={daily.isLoading} />
        <DailyTrendChart data={daily.data ?? []} metric="impressions" title="일별 노출수"
          loading={daily.isLoading} />
        <DailyTrendChart data={daily.data ?? []} metric="clicks" title="일별 클릭수"
          loading={daily.isLoading} />
        <DailyTrendChart data={daily.data ?? []} metric="conv_roas" title="일별 구매완료 ROAS"
          format="roas" loading={daily.isLoading} />
        <CategoryBarChart
          data={(groupStats.data ?? []).slice(0, 10)}
          nameKey="product_group_name" valueKey="conv_roas"
          title="상품군별 구매완료 ROAS" format="roas" loading={groupStats.isLoading}
          onSelect={(g) => g.product_group_id && navigate(`/groups/${g.product_group_id}`)}
        />
      </div>

      <div className="mt-4">
        <CostRevenueChart
          data={groupCostRevenue}
          loading={groupStats.isLoading}
          onSelect={(row) => {
            const found = groupCostRevenue.find((g) => g.name === row.name);
            if (found?.id) navigate(`/groups/${found.id}`);
          }}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <CategoryBarChart data={topByCost} nameKey="display_name" valueKey="cost"
          title="상품별 광고비 TOP 10" format="won" loading={productStats.isLoading}
          onSelect={(p) => p.product_id && navigate(`/products/${p.product_id}`)} />
        <CategoryBarChart data={topByRevenue} nameKey="display_name" valueKey="conv_revenue"
          title="상품별 구매완료 매출 TOP 10" format="won" loading={productStats.isLoading}
          onSelect={(p) => p.product_id && navigate(`/products/${p.product_id}`)} />
        <CategoryBarChart data={topByRoas} nameKey="display_name" valueKey="conv_roas"
          title="상품별 구매완료 ROAS TOP 10" format="roas" loading={productStats.isLoading}
          onSelect={(p) => p.product_id && navigate(`/products/${p.product_id}`)} />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="광고비는 발생했지만 구매완료 전환이 없는 상품"
            description="집행은 되고 있으나 구매로 이어지지 않은 상품입니다"
          />
          {zeroConv.isLoading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : (zeroConv.data ?? []).length === 0 ? (
            <EmptyState title="해당하는 상품이 없습니다"
              description="선택한 기간에는 광고비를 쓴 모든 상품에서 구매완료 전환이 발생했습니다." />
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">상품명</th>
                    <th className="th">상품군</th>
                    <th className="th text-right">노출수</th>
                    <th className="th text-right">클릭수</th>
                    <th className="th text-right">광고비</th>
                    <th className="th text-right">총 전환수</th>
                  </tr>
                </thead>
                <tbody>
                  {(zeroConv.data ?? []).map((r) => (
                    <tr key={r.product_id} className="row-hover cursor-pointer"
                      onClick={() => navigate(`/products/${r.product_id}`)}>
                      <td className="td max-w-md truncate">{r.display_name}</td>
                      <td className="td text-ink-muted">{r.product_group_name}</td>
                      <td className="td text-right">{num(r.impressions)}</td>
                      <td className="td text-right">{num(r.clicks)}</td>
                      <td className="td text-right font-medium">{won(r.cost)}</td>
                      <td className="td text-right">{num(r.total_conv_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <p className="mt-4 text-2xs text-ink-faint">
        CTR = 클릭수 ÷ 노출수 · CPC = 총비용 ÷ 클릭수 · ROAS = 전환매출액 ÷ 총비용.
        모든 비율은 합산값으로 다시 계산합니다. 현재 구매완료 ROAS {roasPct(summary.data?.conv_roas ?? 0)}.
      </p>
    </>
  );
}
