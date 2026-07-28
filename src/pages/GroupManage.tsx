import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Plus, Pencil, Trash2, Check, X, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "@/lib/supabase";
import { parseGroupBulkFile } from "@/lib/excel";
import { PageHeader } from "@/components/layout/AppShell";
import { Button, Card, Input, ErrorState, Badge } from "@/components/ui";

type BulkResult = Array<{ product_name: string | null; product_id: string | null; group_name: string; status: string }>;

export function GroupManage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const groups = useQuery({
    queryKey: ["group-list"],
    queryFn: () => api.groupList(),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["group-list"] });
    qc.invalidateQueries({ queryKey: ["groups-stats"] });
  };

  async function onUpload(file: File) {
    setBusy(true); setMsg(null); setResult(null);
    try {
      const parsed = await parseGroupBulkFile(file);
      if (parsed.errors.length && parsed.assignments.length === 0) {
        setMsg(`양식을 읽지 못했습니다. ${parsed.errors[0]}`);
        return;
      }
      const res = await api.groupBulkApply(parsed.assignments, parsed.groupNames);
      setResult(res);
      const linked = res.filter((r) => r.status === "linked").length;
      const notFound = res.filter((r) => r.status === "not_found").length;
      const ambiguous = res.filter((r) => r.status === "ambiguous").length;
      setMsg(`상품군 ${parsed.groupNames.length}개 확인 · 연결 ${linked}건` +
        (notFound ? ` · 미매칭 ${notFound}건` : "") +
        (ambiguous ? ` · 중복이름 ${ambiguous}건` : ""));
      refresh();
    } catch (e) {
      setMsg(`처리 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function addGroup() {
    if (!newName.trim()) return;
    setBusy(true);
    try { await api.createGroup(newName.trim()); setNewName(""); refresh(); }
    catch (e) { setMsg(`추가 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }

  async function saveRename(id: string) {
    if (!editName.trim()) return;
    setBusy(true);
    try { await api.renameGroup(id, editName.trim()); setEditId(null); refresh(); }
    catch (e) { setMsg(`이름 변경 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }

  async function removeGroup(id: string, name: string) {
    if (!confirm(`'${name}' 상품군을 삭제할까요?\n(소속 상품은 '미분류'가 됩니다. 데이터는 지워지지 않습니다.)`)) return;
    setBusy(true);
    try { await api.deleteGroup(id); refresh(); }
    catch (e) { setMsg(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }

  if (groups.error) return <ErrorState error={groups.error} onRetry={() => groups.refetch()} />;

  const notFoundRows = (result ?? []).filter((r) => r.status !== "linked");

  return (
    <>
      <PageHeader
        title="상품군 관리"
        description="상품군을 추가·이름변경·삭제하고, 엑셀로 상품↔상품군을 한 번에 연결합니다. 이미 연결된 정보와 겹치면 새로 올린 값으로 갱신됩니다."
        actions={
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="h-3.5 w-3.5" /> 엑셀 일괄 등록
          </Button>
        }
      />
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
        onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />

      {msg && (
        <div className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm">{msg}</div>
      )}

      {/* 미매칭 결과 */}
      {notFoundRows.length > 0 && (
        <Card className="mb-4">
          <div className="border-b border-line px-4 py-3 text-sm font-medium">
            연결하지 못한 항목 {notFoundRows.length}건 — 상품명/상품ID가 정확히 일치하지 않습니다
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2 text-ink-faint">
                <tr>
                  <th className="px-4 py-2 text-left">상품명</th>
                  <th className="px-4 py-2 text-left">상품ID</th>
                  <th className="px-4 py-2 text-left">그룹명</th>
                  <th className="px-4 py-2 text-left">사유</th>
                </tr>
              </thead>
              <tbody>
                {notFoundRows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-4 py-2">{r.product_name ?? "-"}</td>
                    <td className="px-4 py-2">{r.product_id ?? "-"}</td>
                    <td className="px-4 py-2">{r.group_name}</td>
                    <td className="px-4 py-2">
                      <Badge tone={r.status === "ambiguous" ? "warn" : "neutral"}>
                        {r.status === "ambiguous" ? "이름 중복" : "상품 못 찾음"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 상품군 목록 + 관리 */}
      <Card>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Input className="h-8 w-56 text-xs" placeholder="새 상품군 이름"
            value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGroup()} />
          <Button onClick={addGroup} disabled={busy || !newName.trim()}>
            <Plus className="h-3.5 w-3.5" /> 추가
          </Button>
        </div>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs text-ink-faint">
              <tr>
                <th className="px-4 py-2 text-left">상품군</th>
                <th className="px-4 py-2 text-right">포함 상품 수</th>
                <th className="px-4 py-2 text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {(groups.data ?? []).map((g) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  isEditing={editId === g.id}
                  editName={editName}
                  onEditNameChange={setEditName}
                  onStartEdit={() => { setEditId(g.id); setEditName(g.name); }}
                  onSaveEdit={() => saveRename(g.id)}
                  onCancelEdit={() => setEditId(null)}
                  onDelete={() => removeGroup(g.id, g.name)}
                  onChanged={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// 상품군 한 줄 — 클릭하면 소속 상품이 펼쳐지고, 거기서 추가/제거 가능
function GroupRow({
  group, isEditing, editName, onEditNameChange,
  onStartEdit, onSaveEdit, onCancelEdit, onDelete, onChanged,
}: {
  group: { id: string; name: string; product_count: number };
  isEditing: boolean; editName: string;
  onEditNameChange: (v: string) => void;
  onStartEdit: () => void; onSaveEdit: () => void; onCancelEdit: () => void;
  onDelete: () => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const members = useQuery({
    queryKey: ["group-products", group.id],
    queryFn: () => api.productsInGroup(group.id),
    enabled: open,
  });
  const candidates = useQuery({
    queryKey: ["assign-search", addQuery],
    queryFn: () => api.productsForAssign(addQuery),
    enabled: open && addQuery.trim().length > 0,
  });

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["group-products", group.id] });
    qc.invalidateQueries({ queryKey: ["group-list"] });
    onChanged();
  };

  async function addProduct(pid: string) {
    setBusy(true);
    try { await api.setProductGroup(pid, group.id); setAddQuery(""); reload(); }
    finally { setBusy(false); }
  }
  async function removeProduct(pid: string) {
    setBusy(true);
    try { await api.setProductGroup(pid, null); reload(); }
    finally { setBusy(false); }
  }

  return (
    <>
      <tr className="border-t border-line">
        <td className="px-4 py-2">
          {isEditing ? (
            <Input className="h-7 w-64 text-xs" value={editName} autoFocus
              onChange={(e) => onEditNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSaveEdit()} />
          ) : (
            <button className="flex items-center gap-1.5 font-medium hover:text-brand-600"
              onClick={() => setOpen((v) => !v)}>
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {group.name}
            </button>
          )}
        </td>
        <td className="px-4 py-2 text-right tabular-nums">{group.product_count}</td>
        <td className="px-4 py-2">
          <div className="flex items-center justify-end gap-1">
            {isEditing ? (
              <>
                <button className="rounded p-1 hover:bg-surface-2" onClick={onSaveEdit} title="저장">
                  <Check className="h-4 w-4 text-good" />
                </button>
                <button className="rounded p-1 hover:bg-surface-2" onClick={onCancelEdit} title="취소">
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button className="rounded p-1 hover:bg-surface-2" onClick={onStartEdit} title="이름 변경">
                  <Pencil className="h-4 w-4" />
                </button>
                <button className="rounded p-1 hover:bg-surface-2" onClick={onDelete} title="삭제">
                  <Trash2 className="h-4 w-4 text-bad" />
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-line bg-surface-2/40">
          <td colSpan={3} className="px-4 py-3">
            {/* 상품 추가 검색 */}
            <div className="mb-3">
              <div className="mb-1 text-xs font-medium text-ink-muted">이 상품군에 상품 추가</div>
              <Input className="h-8 w-full max-w-md text-xs"
                placeholder="상품명 또는 상품ID 검색"
                value={addQuery} onChange={(e) => setAddQuery(e.target.value)} />
              {addQuery.trim() && (
                <div className="mt-1 max-h-44 overflow-auto rounded-md border border-line bg-surface">
                  {(candidates.data ?? []).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-ink-faint">검색 결과 없음</div>
                  ) : (
                    (candidates.data ?? []).map((p) => (
                      <button key={p.id} disabled={busy || p.product_group_id === group.id}
                        onClick={() => addProduct(p.id)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-2 disabled:opacity-40">
                        <span className="truncate">
                          {p.display_name ?? p.base_name ?? p.mall_product_id}
                          <span className="ml-1 text-ink-faint">({p.mall_product_id})</span>
                        </span>
                        {p.product_group_id === group.id
                          ? <span className="shrink-0 text-good">이미 포함</span>
                          : <Plus className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {/* 소속 상품 목록 */}
            <div className="text-xs font-medium text-ink-muted">포함 상품 {members.data?.length ?? 0}개</div>
            {members.isLoading ? (
              <div className="py-2 text-xs text-ink-faint">불러오는 중…</div>
            ) : (members.data ?? []).length === 0 ? (
              <div className="py-2 text-xs text-ink-faint">아직 상품이 없습니다. 위에서 검색해 추가하세요.</div>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(members.data ?? []).map((p) => (
                  <span key={p.id}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-1 text-xs">
                    <span className="max-w-[16rem] truncate">{p.display_name ?? p.base_name ?? p.mall_product_id}</span>
                    <span className="shrink-0 text-ink-faint">({p.mall_product_id})</span>
                    <button disabled={busy} onClick={() => removeProduct(p.id)}
                      className="rounded-full p-0.5 hover:bg-bad/10" title="이 상품군에서 제거">
                      <X className="h-3 w-3 text-bad" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
