import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { api } from "@/lib/supabase";
import { COMPARE_LABELS, comparisonRange } from "@/lib/dateRange";
import { roasPct, won } from "@/lib/format";
import { PageHeader } from "@/components/layout/AppShell";
import { PeriodFilter } from "@/components/layout/PeriodFilter";
import { KpiStrip } from "@/components/KpiStrip";
import { CategoryBarChart, DailyTrendChart } from "@/components/charts/Charts";
import { DataTable } from "@/components/DataTable";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { productColumns } from "./Products";

export function GroupDetail() {
  const { id = "" } = useParams();
  const { accountId, range, compare, groups } = useAppState();
  const navigate = useNavigate();
  const prevRange = comparisonRange(range, compare);
  const enabled = Boolean(accountId && id);

  const group = groups.find((g) => g.id === id);

  const summary = useQuery({
    queryKey: ["group-summary", accountId, id, range],
    queryFn: () => api.summary({ account: accountId!, from: range.from, to: range.to, groupId: id }),
    enabled,
  });

  const prevSummary = useQuery({
    queryKey: ["group-summary-prev", accountId, id, prevRange],
    queryFn: () => api.summary({
      account: accountId!, from: prevRange!.from, to: prevRange!.to, groupId: id,
    }),
    enabled: enabled && Boolean(prevRange),
  });

  const daily = useQuery({
    queryKey: ["group-daily", accountId, id, range],
    queryFn: () => api.dailySeries({ account: accountId!, from: range.from, to: range.to, groupId: id }),
    enabled,
  });

  const products = useQuery({
    queryKey: ["group-products", accountId, id, range],
    queryFn: () => api.productStats({
      account: accountId!, from: range.from, to: range.to, groupId: id,
    }),
    enabled,
  });

  const rows = products.data ?? [];

  const { best, worst } = useMemo(() => {
    const spending = rows.filter((r) => Number(r.cost) > 0);
    const sorted = [...spending].sort((a, b) => Number(b.conv_roas) - Number(a.conv_roas));
    return { best: sorted.slice(0, 3), worst: sorted.slice(-3).reverse() };
  }, [rows]);

  return (
    <>
      <button onClick={() => navigate(-1)}
        className="mb-3 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> 뒤로
      </button>

      <PageHeader
        title={group?.name ?? "상품군"}
        description={`${rows.length}개 상품의 성과를 합산했습니다`}
      />

      <PeriodFilter />

      <KpiStrip
        current={summary.data}
        previous={prevRange ? prevSummary.data : undefined}
        series={daily.data}
        compareLabel={COMPARE_LABELS[compare]}
        loading={summary.isLoading}
      />

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <DailyTrendChart data={daily.data ?? []} metric="cost" title="상품군 일별 광고비"
          format="won" loading={daily.isLoading} />
        <DailyTrendChart data={daily.data ?? []} metric="conv_revenue" title="상품군 일별 구매완료 매출"
          format="won" loading={daily.isLoading} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <CategoryBarChart data={rows.slice(0, 10)} nameKey="display_name" valueKey="cost"
          title="상품별 광고비" format="won" loading={products.isLoading}
          onSelect={(p) => p.product_id && navigate(`/products/${p.product_id}`)} />
        <CategoryBarChart
          data={[...rows].sort((a, b) => Number(b.conv_revenue) - Number(a.conv_revenue)).slice(0, 10)}
          nameKey="display_name" valueKey="conv_revenue"
          title="상품별 구매완료 매출" format="won" loading={products.isLoading}
          onSelect={(p) => p.product_id && navigate(`/products/${p.product_id}`)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {[
          { key: "best", title: "우수 상품", icon: TrendingUp, tone: "text-good", list: best,
            desc: "구매완료 ROAS 상위" },
          { key: "worst", title: "개선 필요 상품", icon: TrendingDown, tone: "text-bad", list: worst,
            desc: "구매완료 ROAS 하위" },
        ].map((box) => (
          <Card key={box.key}>
            <CardHeader title={box.title} description={box.desc} />
            {box.list.length === 0
              ? <EmptyState title="해당하는 상품이 없습니다" />
              : (
                <ul className="divide-y divide-line">
                  {box.list.map((p) => (
                    <li key={p.product_id ?? p.display_name}
                      className="row-hover flex cursor-pointer items-center gap-3 px-4 py-2.5"
                      onClick={() => p.product_id && navigate(`/products/${p.product_id}`)}>
                      <box.icon className={`h-4 w-4 shrink-0 ${box.tone}`} />
                      <span className="min-w-0 flex-1 truncate text-sm">{p.display_name}</span>
                      <span className="tnum text-xs text-ink-muted">{won(p.cost)}</span>
                      <span className={`tnum w-16 text-right text-sm font-medium ${box.tone}`}>
                        {roasPct(p.conv_roas)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        ))}
      </div>

      <div className="mt-4">
        <DataTable
          columns={productColumns.filter((c) => c.key !== "product_group_name")}
          rows={rows}
          loading={products.isLoading}
          rowKey={(r) => `${r.product_id ?? "na"}-${r.display_name}`}
          onRowClick={(r) => r.product_id && navigate(`/products/${r.product_id}`)}
          defaultSort={{ key: "cost", dir: "desc" }}
          emptyTitle="이 상품군에는 집계된 상품이 없습니다"
        />
      </div>
    </>
  );
}
