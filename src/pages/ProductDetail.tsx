import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { api } from "@/lib/supabase";
import { addDays, COMPARE_LABELS, comparisonRange, seoulToday } from "@/lib/dateRange";
import { decimal, num, pct, roasPct, won } from "@/lib/format";
import { PageHeader } from "@/components/layout/AppShell";
import { PeriodFilter } from "@/components/layout/PeriodFilter";
import { KpiStrip } from "@/components/KpiStrip";
import { DailyTrendChart } from "@/components/charts/Charts";
import { Badge, Card, CardHeader, ErrorState, Skeleton, TableSkeleton } from "@/components/ui";

export function ProductDetail() {
  const { id = "" } = useParams();
  const { accountId, range, compare } = useAppState();
  const navigate = useNavigate();
  const prevRange = comparisonRange(range, compare);
  const enabled = Boolean(accountId && id);

  const product = useQuery({
    queryKey: ["product", id],
    queryFn: () => api.getProduct(id),
    enabled: Boolean(id),
  });

  const summary = useQuery({
    queryKey: ["product-summary", accountId, id, range],
    queryFn: () => api.summary({ account: accountId!, from: range.from, to: range.to, productId: id }),
    enabled,
  });

  const prevSummary = useQuery({
    queryKey: ["product-summary-prev", accountId, id, prevRange],
    queryFn: () => api.summary({
      account: accountId!, from: prevRange!.from, to: prevRange!.to, productId: id,
    }),
    enabled: enabled && Boolean(prevRange),
  });

  const daily = useQuery({
    queryKey: ["product-daily", accountId, id, range],
    queryFn: () => api.dailySeries({ account: accountId!, from: range.from, to: range.to, productId: id }),
    enabled,
  });

  const creatives = useQuery({
    queryKey: ["product-creatives", accountId, id, range],
    queryFn: () => api.creativeStats({
      account: accountId!, from: range.from, to: range.to, productId: id,
    }),
    enabled,
  });

  const today = seoulToday();
  const recent = useQuery({
    queryKey: ["product-recent", accountId, id, today],
    queryFn: async () => ({
      d7: await api.summary({ account: accountId!, from: addDays(today, -6), to: today, productId: id }),
      d30: await api.summary({ account: accountId!, from: addDays(today, -29), to: today, productId: id }),
    }),
    enabled,
  });

  if (product.error) return <ErrorState error={product.error} onRetry={() => product.refetch()} />;

  const p = product.data;

  return (
    <>
      <button
        onClick={() => navigate(-1)}
        className="mb-3 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> 뒤로
      </button>

      <PageHeader
        title={p?.display_name ?? (product.isLoading ? "불러오는 중" : "상품")}
        description={p?.base_name ?? undefined}
        actions={p?.product_groups?.name
          ? (
            <Link to={`/groups/${p.product_group_id}`}>
              <Badge tone="brand">{p.product_groups.name}</Badge>
            </Link>
          )
          : <Badge tone="warn">상품군 미분류</Badge>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["쇼핑몰 상품ID", p?.mall_product_id],
          ["상품번호(스마트스토어)", p?.smartstore_product_no ?? "미등록"],
          ["최초 등록일", p?.created_at?.slice(0, 10)],
          ["최종 수정일", p?.updated_at?.slice(0, 10)],
        ].map(([label, value]) => (
          <div key={label as string} className="card px-3.5 py-2.5">
            <p className="text-2xs uppercase tracking-wide text-ink-faint">{label}</p>
            {product.isLoading
              ? <Skeleton className="mt-1 h-4 w-24" />
              : <p className="tnum mt-0.5 text-sm">{value ?? "—"}</p>}
          </div>
        ))}
      </div>

      <PeriodFilter />

      <KpiStrip
        current={summary.data}
        previous={prevRange ? prevSummary.data : undefined}
        series={daily.data}
        compareLabel={COMPARE_LABELS[compare]}
        loading={summary.isLoading}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(["d7", "d30"] as const).map((k) => {
          const s = recent.data?.[k];
          return (
            <Card key={k}>
              <CardHeader title={k === "d7" ? "최근 7일" : "최근 30일"} />
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-4">
                {[
                  ["광고비", s ? won(s.cost) : "—"],
                  ["구매완료 매출", s ? won(s.conv_revenue) : "—"],
                  ["구매완료 ROAS", s ? roasPct(s.conv_roas) : "—"],
                  ["CPC", s ? won(s.cpc) : "—"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-2xs text-ink-faint">{label}</p>
                    <p className="tnum mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <DailyTrendChart data={daily.data ?? []} metric="cost" title="일별 광고비"
          format="won" loading={daily.isLoading} />
        <DailyTrendChart data={daily.data ?? []} metric="conv_revenue" title="일별 구매완료 매출"
          format="won" loading={daily.isLoading} />
        <DailyTrendChart data={daily.data ?? []} metric="clicks" title="일별 클릭수"
          loading={daily.isLoading} />
        <DailyTrendChart data={daily.data ?? []} metric="conv_roas" title="일별 구매완료 ROAS"
          format="roas" loading={daily.isLoading} />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader title="연결된 소재별 성과"
            description="이 상품에 매핑된 소재의 기간 합계입니다" />
          {creatives.isLoading ? <TableSkeleton rows={4} cols={8} /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">소재 ID</th>
                    <th className="th text-right">노출수</th>
                    <th className="th text-right">클릭수</th>
                    <th className="th text-right">CTR</th>
                    <th className="th text-right">CPC</th>
                    <th className="th text-right">총비용</th>
                    <th className="th text-right">구매완료 매출</th>
                    <th className="th text-right">구매완료 ROAS</th>
                    <th className="th text-right">평균노출순위</th>
                  </tr>
                </thead>
                <tbody>
                  {(creatives.data ?? []).map((c) => (
                    <tr key={c.creative_id} className="row-hover">
                      <td className="td font-mono text-2xs">{c.creative_id}</td>
                      <td className="td text-right">{num(c.impressions)}</td>
                      <td className="td text-right">{num(c.clicks)}</td>
                      <td className="td text-right">{pct(c.ctr)}</td>
                      <td className="td text-right">{won(c.cpc)}</td>
                      <td className="td text-right font-medium">{won(c.cost)}</td>
                      <td className="td text-right">{won(c.conv_revenue)}</td>
                      <td className="td text-right">{roasPct(c.conv_roas)}</td>
                      <td className="td text-right">{c.avg_rank ? decimal(c.avg_rank) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
