import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Plus, Pencil, Trash2, Check, X } from "lucide-react";
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
        <div className="max-h-[28rem] overflow-auto">
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
                <tr key={g.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    {editId === g.id ? (
                      <Input className="h-7 w-64 text-xs" value={editName} autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveRename(g.id)} />
                    ) : (
                      <span className="font-medium">{g.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{g.product_count}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {editId === g.id ? (
                        <>
                          <button className="rounded p-1 hover:bg-surface-2" onClick={() => saveRename(g.id)} title="저장">
                            <Check className="h-4 w-4 text-good" />
                          </button>
                          <button className="rounded p-1 hover:bg-surface-2" onClick={() => setEditId(null)} title="취소">
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="rounded p-1 hover:bg-surface-2"
                            onClick={() => { setEditId(g.id); setEditName(g.name); }} title="이름 변경">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button className="rounded p-1 hover:bg-surface-2"
                            onClick={() => removeGroup(g.id, g.name)} title="삭제">
                            <Trash2 className="h-4 w-4 text-bad" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
