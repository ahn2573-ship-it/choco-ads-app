import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, PencilLine, Search } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/supabase";
import { exportSheet, toResult2 } from "@/lib/excel";
import { decimal, num, won } from "@/lib/format";
import { PageHeader } from "@/components/layout/AppShell";
import { PeriodFilter } from "@/components/layout/PeriodFilter";
import {
  Badge, Button, Card, ErrorState, Input, Modal, Pagination, TableSkeleton,
} from "@/components/ui";
import type { RawRow } from "@/lib/types";

const PAGE_SIZE = 100;

const EDITABLE: Array<{ field: keyof RawRow; label: string }> = [
  { field: "impressions", label: "노출수" },
  { field: "clicks", label: "클릭수" },
  { field: "cost", label: "총비용" },
  { field: "conv_count", label: "구매완료 전환수" },
  { field: "conv_revenue", label: "구매완료 전환매출액" },
  { field: "total_conv_count", label: "총 전환수" },
  { field: "total_conv_revenue", label: "총 전환매출액" },
];

export function RawData() {
  const { accountId, range } = useAppState();
  const { isAdmin, session } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RawRow | null>(null);
  const [field, setField] = useState<keyof RawRow>("cost");
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["raw", accountId, range, page, search],
    queryFn: () => api.rawRows({
      account: accountId!, from: range.from, to: range.to,
      page, pageSize: PAGE_SIZE, search,
    }),
    enabled: Boolean(accountId),
  });

  async function save() {
    if (!editing || !session?.user) return;
    setSaving(true);
    setError(null);
    try {
      await api.correctRow({
        performanceId: editing.id,
        field: field as string,
        oldValue: String(editing[field] ?? ""),
        newValue,
        reason,
        userId: session.user.id,
      });
      setEditing(null);
      setReason("");
      setNewValue("");
      qc.invalidateQueries({ queryKey: ["raw"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "보정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const rows = query.data?.rows ?? [];

  return (
    <>
      <PageHeader
        title="RAW 데이터"
        description="엑셀 result2 시트에 해당하는 원본 데이터입니다. 값 수정은 보정 이력으로 남습니다."
        actions={
          <Button onClick={() => exportSheet(
            "result2", toResult2(rows), `result2_${range.from}_${range.to}.xlsx`,
          )} disabled={!rows.length}>
            <Download className="h-3.5 w-3.5" /> result2 형식 다운로드
          </Button>
        }
      />

      <PeriodFilter showCompare={false} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-faint" />
            <Input className="h-8 w-72 pl-8 text-xs" placeholder="소재 ID 검색"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          <span className="text-2xs text-ink-faint">
            {query.data?.total.toLocaleString("ko-KR") ?? 0}건
          </span>
        </div>

        {query.isLoading ? <TableSkeleton rows={10} cols={9} /> : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">날짜</th>
                  <th className="th">소재</th>
                  <th className="th">상품 / 광고 유형</th>
                  <th className="th text-right">노출수</th>
                  <th className="th text-right">클릭수</th>
                  <th className="th text-right">총비용</th>
                  <th className="th text-right">평균순위</th>
                  <th className="th text-right">구매완료</th>
                  <th className="th text-right">구매완료 매출</th>
                  <th className="th text-right">총 전환매출</th>
                  <th className="th">출처</th>
                  {isAdmin && <th className="th" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="row-hover">
                    <td className="td tnum">{r.stat_date}</td>
                    <td className="td max-w-[16rem] truncate font-mono text-2xs">{r.creative_id}</td>
                    <td className="td">
                      {r.product_id
                        ? <span className="tnum">{r.mall_product_id}</span>
                        : r.ad_type_label
                          ? <Badge tone="neutral">{r.ad_type_label}</Badge>
                          : <Badge tone="warn">미매핑</Badge>}
                    </td>
                    <td className="td text-right">{num(r.impressions)}</td>
                    <td className="td text-right">{num(r.clicks)}</td>
                    <td className="td text-right">{won(r.cost)}</td>
                    <td className="td text-right">{r.avg_rank ? decimal(r.avg_rank) : "—"}</td>
                    <td className="td text-right">{num(r.conv_count)}</td>
                    <td className="td text-right">{won(r.conv_revenue)}</td>
                    <td className="td text-right">{won(r.total_conv_revenue)}</td>
                    <td className="td text-2xs text-ink-faint">{r.source}</td>
                    {isAdmin && (
                      <td className="td">
                        <Button size="sm" variant="ghost" onClick={() => {
                          setEditing(r);
                          setField("cost");
                          setNewValue(String(r.cost));
                        }}>
                          <PencilLine className="h-3.5 w-3.5" /> 보정
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={query.data?.total ?? 0} onChange={setPage} />
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="데이터 보정"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>취소</Button>
            <Button variant="primary" loading={saving} onClick={save}
              disabled={!reason.trim() || newValue === ""}>
              보정 저장
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="rounded bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
            RAW 데이터는 원칙적으로 API 재수집으로 고칩니다. 재수집이 불가능한 경우에만 보정하세요.
            보정 전 값과 사유, 수정자, 수정 시각이 함께 저장됩니다.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">보정 항목</label>
            <select
              className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm"
              value={field as string}
              onChange={(e) => {
                const f = e.target.value as keyof RawRow;
                setField(f);
                setNewValue(String(editing?.[f] ?? ""));
              }}
            >
              {EDITABLE.map((f) => (
                <option key={f.field as string} value={f.field as string}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">현재 값</label>
              <Input value={String(editing?.[field] ?? "")} readOnly className="bg-surface-sunken" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">보정 값</label>
              <Input type="number" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">보정 사유</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="예: API 이중 집계로 광고비가 2배로 들어옴" />
          </div>
          {error && <p className="rounded bg-bad-soft px-2.5 py-2 text-xs text-bad">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
