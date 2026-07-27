import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { api } from "@/lib/supabase";
import { exportSheet, toProductSheet } from "@/lib/excel";
import { num, pct, roasPct, won } from "@/lib/format";
import { PageHeader } from "@/components/layout/AppShell";
import { PeriodFilter } from "@/components/layout/PeriodFilter";
import { DataTable, type Column } from "@/components/DataTable";
import { Button, ErrorState, Input, Select } from "@/components/ui";
import type { Bucket, ProductStat } from "@/lib/types";

export const productColumns: Column<ProductStat>[] = [
  {
    key: "display_name", header: "노출용 상품명", value: (r) => r.display_name,
    render: (r) => <span className="block max-w-xs truncate font-medium">{r.display_name}</span>,
  },
  {
    key: "base_name", header: "기본 상품명", value: (r) => r.base_name, hidden: true,
    render: (r) => <span className="block max-w-xs truncate text-ink-muted">{r.base_name}</span>,
  },
  { key: "product_group_name", header: "상품군", value: (r) => r.product_group_name },
  { key: "mall_product_id", header: "쇼핑몰 상품ID", value: (r) => r.mall_product_id ?? "" },
  {
    key: "smartstore_product_no", header: "상품번호(스마트스토어)", hidden: true,
    value: (r) => r.smartstore_product_no ?? "",
  },
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
      <span className={Number(r.conv_roas) >= 1 ? "font-medium text-good" : "text-ink"}>
        {roasPct(r.conv_roas)}
      </span>
    ),
  },
  { key: "total_conv_count", header: "총 전환수", align: "right", hidden: true, value: (r) => Number(r.total_conv_count), render: (r) => num(r.total_conv_count) },
  { key: "total_conv_revenue", header: "총 전환매출", align: "right", hidden: true, value: (r) => Number(r.total_conv_revenue), render: (r) => won(r.total_conv_revenue) },
  { key: "total_roas", header: "총 전환 ROAS", align: "right", value: (r) => Number(r.total_roas), render: (r) => roasPct(r.total_roas) },
  { key: "creative_count", header: "소재 수", align: "right", hidden: true, value: (r) => Number(r.creative_count) },
];

export function Products() {
  const { accountId, range, groups } = useAppState();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [bucket, setBucket] = useState<Bucket>("product");

  const query = useQuery({
    queryKey: ["products", accountId, range, groupId, search, bucket],
    queryFn: () => api.productStats({
      account: accountId!, from: range.from, to: range.to,
      groupId: groupId || null, search, bucket,
    }),
    enabled: Boolean(accountId),
  });

  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <>
      <PageHeader
        title="상품별 데이터"
        description={`${range.from} ~ ${range.to} 기간의 RAW 데이터를 상품 단위로 합산했습니다`}
        actions={
          <Button
            onClick={() => exportSheet(
              "상품별 데이터", toProductSheet(query.data ?? []),
              `상품별데이터_${range.from}_${range.to}.xlsx`,
            )}
            disabled={!query.data?.length}
          >
            <Download className="h-3.5 w-3.5" /> 엑셀 다운로드
          </Button>
        }
      />

      <PeriodFilter showCompare={false} />

      <DataTable
        columns={productColumns}
        rows={query.data ?? []}
        loading={query.isLoading}
        rowKey={(r) => `${r.product_id ?? "na"}-${r.display_name}`}
        onRowClick={(r) => r.product_id && navigate(`/products/${r.product_id}`)}
        defaultSort={{ key: "cost", dir: "desc" }}
        emptyTitle="집계된 상품이 없습니다"
        emptyDescription="기간을 넓히거나 광고 유형 필터를 '전체'로 바꿔보세요."
        toolbar={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-faint" />
              <Input
                className="h-8 w-64 pl-8 text-xs"
                placeholder="상품명 또는 상품ID 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select className="h-8 text-xs" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">전체 상품군</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <Select className="h-8 text-xs" value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)}>
              <option value="product">일반 상품</option>
              <option value="other_ad">기타 광고 유형</option>
              <option value="unmapped">미매핑</option>
              <option value="all">전체</option>
            </Select>
          </>
        }
      />
    </>
  );
}
