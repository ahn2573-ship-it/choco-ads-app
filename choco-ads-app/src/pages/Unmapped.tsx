import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Link2 } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/supabase";
import { exportSheet, toUnmappedSheet } from "@/lib/excel";
import { num, won } from "@/lib/format";
import { PageHeader } from "@/components/layout/AppShell";
import { PeriodFilter } from "@/components/layout/PeriodFilter";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, TableSkeleton } from "@/components/ui";
import type { Product, UnmappedRow } from "@/lib/types";

export function Unmapped() {
  const { accountId, range } = useAppState();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [target, setTarget] = useState<UnmappedRow | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["unmapped", accountId, range],
    queryFn: () => api.unmapped({ account: accountId!, from: range.from, to: range.to }),
    enabled: Boolean(accountId),
  });

  const productSearch = useQuery({
    queryKey: ["product-search", productQuery],
    queryFn: () => api.searchProducts(productQuery),
    enabled: Boolean(target),
  });

  async function assign() {
    if (!accountId || !target || !selected) return;
    setSaving(true);
    try {
      await api.saveMapping({
        ad_account_id: accountId,
        creative_id: target.creative_id,
        product_id: selected.id,
        is_active: true,
      });
      setMessage(`${target.creative_id} 를 ${selected.display_name ?? selected.mall_product_id} 에 연결했습니다.`);
      setTarget(null);
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["unmapped"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } finally {
      setSaving(false);
    }
  }

  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const rows = query.data ?? [];

  return (
    <>
      <PageHeader
        title="미매핑 소재"
        description="상품 정보를 찾지 못한 데이터입니다. 임의로 배정하지 않고 여기에 모아둡니다."
        actions={
          <Button onClick={() => exportSheet(
            "미매핑 소재", toUnmappedSheet(rows), `미매핑소재_${range.from}_${range.to}.xlsx`,
          )} disabled={!rows.length}>
            <Download className="h-3.5 w-3.5" /> 엑셀 다운로드
          </Button>
        }
      />

      {message && (
        <div className="mb-3 rounded-md border border-good/30 bg-good-soft px-3 py-2 text-xs text-good">
          {message}
        </div>
      )}

      <PeriodFilter showCompare={false} />

      <Card className="overflow-hidden">
        {query.isLoading ? <TableSkeleton rows={6} cols={7} /> : rows.length === 0 ? (
          <EmptyState
            title="미매핑 소재가 없습니다"
            description="선택한 기간에 들어온 모든 소재가 상품에 연결되어 있습니다."
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">소재 ID</th>
                  <th className="th">API 상품값</th>
                  <th className="th">최초 발생일</th>
                  <th className="th">최근 발생일</th>
                  <th className="th text-right">노출수</th>
                  <th className="th text-right">클릭수</th>
                  <th className="th text-right">광고비</th>
                  <th className="th">미매핑 사유</th>
                  {isAdmin && <th className="th" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.creative_id + r.raw_product_value} className="row-hover">
                    <td className="td max-w-[18rem] truncate font-mono text-2xs">{r.creative_id}</td>
                    <td className="td tnum">{r.raw_product_value}</td>
                    <td className="td tnum">{r.first_date}</td>
                    <td className="td tnum">{r.last_date}</td>
                    <td className="td text-right">{num(r.impressions)}</td>
                    <td className="td text-right">{num(r.clicks)}</td>
                    <td className="td text-right font-medium">{won(r.cost)}</td>
                    <td className="td"><Badge tone="warn">{r.reason}</Badge></td>
                    {isAdmin && (
                      <td className="td">
                        <Button size="sm" variant="primary" onClick={() => setTarget(r)}>
                          <Link2 className="h-3.5 w-3.5" /> 매핑 처리
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title="매핑 처리"
        footer={
          <>
            <Button onClick={() => setTarget(null)}>취소</Button>
            <Button variant="primary" loading={saving} onClick={assign} disabled={!selected}>
              연결하고 과거 데이터에 적용
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="rounded bg-surface-sunken px-3 py-2 text-xs">
            소재 <span className="font-mono">{target?.creative_id}</span> —{" "}
            {target?.reason}
          </p>
          <Input value={productQuery} onChange={(e) => setProductQuery(e.target.value)}
            placeholder="상품명 또는 쇼핑몰 상품ID 검색" />
          <div className="max-h-56 overflow-y-auto rounded-md border border-line">
            {(productSearch.data ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className={`flex w-full flex-col items-start px-3 py-2 text-left text-xs hover:bg-surface-sunken ${
                  selected?.id === p.id ? "bg-brand-50" : ""
                }`}
              >
                <span className="font-medium">{p.display_name ?? p.base_name}</span>
                <span className="tnum text-ink-faint">{p.mall_product_id}</span>
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
