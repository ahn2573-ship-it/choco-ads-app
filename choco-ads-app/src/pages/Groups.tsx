import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { api } from "@/lib/supabase";
import { exportSheet, toGroupSheet } from "@/lib/excel";
import { num, pct, roasPct, won } from "@/lib/format";
import { PageHeader } from "@/components/layout/AppShell";
import { PeriodFilter } from "@/components/layout/PeriodFilter";
import { DataTable, type Column } from "@/components/DataTable";
import { Button, ErrorState, Input } from "@/components/ui";
import type { GroupStat } from "@/lib/types";

const columns: Column<GroupStat>[] = [
  {
    key: "product_group_name", header: "상품군", value: (r) => r.product_group_name,
    render: (r) => <span className="font-medium">{r.product_group_name}</span>,
  },
  { key: "product_count", header: "포함 상품 수", align: "right", value: (r) => Number(r.product_count) },
  { key: "impressions", header: "노출수", align: "right", value: (r) => Number(r.impressions), render: (r) => num(r.impressions) },
  { key: "clicks", header: "클릭수", align: "right", value: (r) => Number(r.clicks), render: (r) => num(r.clicks) },
  { key: "ctr", header: "CTR", align: "right", value: (r) => Number(r.ctr), render: (r) => pct(r.ctr) },
  { key: "cpc", header: "CPC", align: "right", value: (r) => Number(r.cpc), render: (r) => won(r.cpc) },
  { key: "cost", header: "총비용", align: "right", value: (r) => Number(r.cost), render: (r) => <span className="font-medium">{won(r.cost)}</span> },
  { key: "conv_count", header: "구매완료 전환수", align: "right", value: (r) => Number(r.conv_count), render: (r) => num(r.conv_count) },
  { key: "conv_revenue", header: "구매완료 매출", align: "right", value: (r) => Number(r.conv_revenue), render: (r) => won(r.conv_revenue) },
  {
    key: "conv_roas", header: "구매완료 ROAS", align: "right", value: (r) => Number(r.conv_roas),
    render: (r) => (
      <span className={Number(r.conv_roas) >= 1 ? "font-medium text-good" : ""}>
        {roasPct(r.conv_roas)}
      </span>
    ),
  },
  { key: "total_conv_count", header: "총 전환수", align: "right", hidden: true, value: (r) => Number(r.total_conv_count), render: (r) => num(r.total_conv_count) },
  { key: "total_conv_revenue", header: "총 전환매출", align: "right", hidden: true, value: (r) => Number(r.total_conv_revenue), render: (r) => won(r.total_conv_revenue) },
  { key: "total_roas", header: "총 전환 ROAS", align: "right", value: (r) => Number(r.total_roas), render: (r) => roasPct(r.total_roas) },
];

export function Groups() {
  const { accountId, range } = useAppState();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["groups-stats", accountId, range, search],
    queryFn: () => api.groupStats({ account: accountId!, from: range.from, to: range.to, search }),
    enabled: Boolean(accountId),
  });

  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <>
      <PageHeader
        title="상품군별 데이터"
        description="CTR·CPC·ROAS 는 상품별 비율의 평균이 아니라 상품군 전체 합계로 다시 계산합니다"
        actions={
          <Button
            onClick={() => exportSheet(
              "상품군별 데이터", toGroupSheet(query.data ?? []),
              `상품군별데이터_${range.from}_${range.to}.xlsx`,
            )}
            disabled={!query.data?.length}
          >
            <Download className="h-3.5 w-3.5" /> 엑셀 다운로드
          </Button>
        }
      />

      <PeriodFilter showCompare={false} />

      <DataTable
        columns={columns}
        rows={query.data ?? []}
        loading={query.isLoading}
        rowKey={(r) => r.product_group_id ?? r.product_group_name}
        onRowClick={(r) => r.product_group_id && navigate(`/groups/${r.product_group_id}`)}
        defaultSort={{ key: "cost", dir: "desc" }}
        emptyTitle="집계된 상품군이 없습니다"
        toolbar={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-faint" />
            <Input className="h-8 w-56 pl-8 text-xs" placeholder="상품군 검색"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        }
      />
    </>
  );
}
