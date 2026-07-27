import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Search, Trash2, Upload } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { api, supabase } from "@/lib/supabase";
import { exportSheet, parseMappingFile, toMappingSheet } from "@/lib/excel";
import { PageHeader } from "@/components/layout/AppShell";
import {
  Badge, Button, Card, ErrorState, Input, Modal, Pagination, Select, TableSkeleton,
} from "@/components/ui";
import type { Product } from "@/lib/types";

const PAGE_SIZE = 50;

export function Mappings() {
  const { accountId, groups } = useAppState();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [creativeId, setCreativeId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const list = useQuery({
    queryKey: ["mappings", accountId, page, search, groupId],
    queryFn: () => api.listMappings({
      account: accountId!, page, pageSize: PAGE_SIZE, search, groupId: groupId || null,
    }),
    enabled: Boolean(accountId),
  });

  const productSearch = useQuery({
    queryKey: ["product-search", productQuery],
    queryFn: () => api.searchProducts(productQuery),
    enabled: editorOpen,
  });

  async function saveMapping() {
    if (!accountId || !creativeId.trim() || !selectedProduct) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.saveMapping({
        ad_account_id: accountId,
        creative_id: creativeId.trim(),
        product_id: selectedProduct.id,
        is_active: true,
      });
      setEditorOpen(false);
      setCreativeId("");
      setSelectedProduct(null);
      setMessage("매핑을 저장하고 기존 데이터에도 적용했습니다.");
      qc.invalidateQueries({ queryKey: ["mappings"] });
      qc.invalidateQueries({ queryKey: ["unmapped"] });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "매핑 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File) {
    if (!accountId) return;
    setMessage(null);
    setErrors([]);
    const { rows, errors: parseErrors } = await parseMappingFile(file);
    setErrors(parseErrors);
    if (!rows.length) {
      setMessage("반영할 행이 없습니다. 양식을 확인하세요.");
      return;
    }

    // 1) 상품군 확보
    const groupNames = [...new Set(rows.map((r) => r.group_name).filter(Boolean))] as string[];
    if (groupNames.length) {
      await supabase.from("product_groups")
        .upsert(groupNames.map((name) => ({ name })), { onConflict: "name", ignoreDuplicates: true });
    }
    const { data: allGroups } = await supabase.from("product_groups").select("id, name");
    const groupByName = new Map((allGroups ?? []).map((g) => [g.name, g.id]));

    // 2) 상품 확보
    const productPayload = [...new Map(rows.map((r) => [r.mall_product_id, r])).values()]
      .map((r) => ({
        mall_product_id: r.mall_product_id,
        smartstore_product_no: r.smartstore_product_no ?? null,
        display_name: r.display_name ?? null,
        base_name: r.base_name ?? null,
        product_group_id: r.group_name ? groupByName.get(r.group_name) ?? null : null,
      }));
    const { error: prodErr } = await supabase.from("products")
      .upsert(productPayload, { onConflict: "mall_product_id" });
    if (prodErr) {
      setMessage(`상품 저장 실패: ${prodErr.message}`);
      return;
    }

    const { data: products } = await supabase.from("products")
      .select("id, mall_product_id")
      .in("mall_product_id", productPayload.map((p) => p.mall_product_id));
    const productByMall = new Map((products ?? []).map((p) => [p.mall_product_id, p.id]));

    // 3) 소재 + 매핑
    await supabase.from("creatives").upsert(
      rows.map((r) => ({ ad_account_id: accountId, creative_id: r.creative_id })),
      { onConflict: "ad_account_id,creative_id", ignoreDuplicates: true },
    );

    const mappingPayload = rows
      .filter((r) => productByMall.has(r.mall_product_id))
      .map((r) => ({
        ad_account_id: accountId,
        creative_id: r.creative_id,
        product_id: productByMall.get(r.mall_product_id)!,
        is_active: r.is_active,
      }));

    const { error: mapErr } = await supabase.from("creative_product_mappings")
      .upsert(mappingPayload, { onConflict: "ad_account_id,creative_id" });

    if (mapErr) {
      setMessage(`매핑 저장 실패: ${mapErr.message}`);
      return;
    }

    setMessage(`${mappingPayload.length}건의 매핑을 반영했습니다.` +
      (parseErrors.length ? ` (${parseErrors.length}건은 건너뜀)` : ""));
    qc.invalidateQueries({ queryKey: ["mappings"] });
    qc.invalidateQueries({ queryKey: ["unmapped"] });
  }

  async function remove(id: string) {
    if (!confirm("이 매핑을 삭제할까요? 기존 집계 결과에는 영향을 주지 않습니다.")) return;
    await api.deleteMapping(id);
    qc.invalidateQueries({ queryKey: ["mappings"] });
  }

  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  const rows = list.data?.rows ?? [];

  return (
    <>
      <PageHeader
        title="소재 매핑 관리"
        description="소재 ID 를 상품에 연결합니다. 저장하면 과거 RAW 데이터에도 자동으로 적용됩니다."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            <Button onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> 엑셀 일괄 업로드
            </Button>
            <Button onClick={() => exportSheet(
              "소재 매핑", toMappingSheet(rows), "소재매핑.xlsx",
            )} disabled={!rows.length}>
              <Download className="h-3.5 w-3.5" /> 엑셀 다운로드
            </Button>
            <Button variant="primary" onClick={() => setEditorOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> 매핑 추가
            </Button>
          </>
        }
      />

      {message && (
        <div className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-xs">{message}</div>
      )}
      {errors.length > 0 && (
        <div className="mb-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
          <p className="font-medium">건너뛴 행 {errors.length}건</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-ink-faint" />
            <Input className="h-8 w-72 pl-8 text-xs" placeholder="소재 ID 검색"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          <Select className="h-8 text-xs" value={groupId}
            onChange={(e) => { setGroupId(e.target.value); setPage(0); }}>
            <option value="">전체 상품군</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </div>

        {list.isLoading ? <TableSkeleton rows={10} cols={7} /> : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">소재 ID</th>
                  <th className="th">쇼핑몰 상품ID</th>
                  <th className="th">상품번호(스마트스토어)</th>
                  <th className="th">노출용 상품명</th>
                  <th className="th">기본 상품명</th>
                  <th className="th">상품군</th>
                  <th className="th">사용 여부</th>
                  <th className="th">최종 수정일</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="row-hover">
                    <td className="td max-w-[16rem] truncate font-mono text-2xs">{m.creative_id}</td>
                    <td className="td tnum">{m.products?.mall_product_id}</td>
                    <td className="td tnum text-ink-muted">
                      {m.products?.smartstore_product_no ?? "—"}
                    </td>
                    <td className="td max-w-xs truncate">{m.products?.display_name}</td>
                    <td className="td max-w-xs truncate text-ink-muted">{m.products?.base_name}</td>
                    <td className="td">{m.products?.product_groups?.name ?? "(미분류)"}</td>
                    <td className="td">
                      <Badge tone={m.is_active ? "good" : "neutral"}>
                        {m.is_active ? "사용" : "미사용"}
                      </Badge>
                    </td>
                    <td className="td tnum text-2xs text-ink-faint">{m.updated_at?.slice(0, 10)}</td>
                    <td className="td">
                      <Button size="sm" variant="ghost" onClick={() => remove(m.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onChange={setPage} />
      </Card>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title="매핑 추가"
        footer={
          <>
            <Button onClick={() => setEditorOpen(false)}>취소</Button>
            <Button variant="primary" loading={saving} onClick={saveMapping}
              disabled={!creativeId.trim() || !selectedProduct}>
              저장
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">소재 ID</label>
            <Input value={creativeId} onChange={(e) => setCreativeId(e.target.value)}
              placeholder="nad-a001-01-000000000000000" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">연결할 상품</label>
            <Input value={productQuery} onChange={(e) => setProductQuery(e.target.value)}
              placeholder="상품명 또는 쇼핑몰 상품ID 로 검색" />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-line">
              {(productSearch.data ?? []).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProduct(p)}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs hover:bg-surface-sunken ${
                    selectedProduct?.id === p.id ? "bg-brand-50" : ""
                  }`}
                >
                  <span className="font-medium">{p.display_name ?? p.base_name}</span>
                  <span className="tnum text-ink-faint">{p.mall_product_id}</span>
                </button>
              ))}
              {productSearch.data?.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-ink-faint">
                  일치하는 상품이 없습니다. 엑셀 일괄 업로드로 상품을 먼저 등록하세요.
                </p>
              )}
            </div>
          </div>
          {selectedProduct && (
            <p className="rounded bg-brand-50 px-3 py-2 text-xs text-brand-700">
              선택: {selectedProduct.display_name ?? selectedProduct.base_name}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
