import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { api } from "@/lib/supabase";
import { addDays, seoulToday } from "@/lib/dateRange";
import { num } from "@/lib/format";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge, Button, Card, EmptyState, ErrorState, Input, TableSkeleton } from "@/components/ui";

const STATUS: Record<string, { tone: "good" | "bad" | "warn" | "neutral"; label: string }> = {
  success: { tone: "good", label: "성공" },
  partial: { tone: "warn", label: "일부 성공" },
  failed: { tone: "bad", label: "실패" },
  running: { tone: "neutral", label: "진행 중" },
};

export function SyncLogs() {
  const { accountId } = useAppState();
  const qc = useQueryClient();
  const [date, setDate] = useState(addDays(seoulToday(), -1));
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 기간 일괄 수집
  const [bulkFrom, setBulkFrom] = useState(addDays(seoulToday(), -7));
  const [bulkTo, setBulkTo] = useState(addDays(seoulToday(), -1));
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const bulkCancel = useState<{ v: boolean }>({ v: false })[0];

  const query = useQuery({
    queryKey: ["sync-logs", accountId],
    queryFn: () => api.syncLogs(accountId!),
    enabled: Boolean(accountId),
    refetchInterval: 15_000,
  });

  async function run() {
    if (!accountId) return;
    setRunning(true);
    setMessage(null);
    try {
      const res = await api.triggerSync({ account: accountId, date });
      setMessage(res.ok
        ? `${date} 수집 완료 — ${res.upserted ?? 0}건 반영, 미매핑 ${res.unmapped ?? 0}건`
        : `수집 실패 — ${res.error ?? "원인 미상"}`);
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "수집 요청에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  async function runBulk() {
    if (!accountId) return;
    if (bulkFrom > bulkTo) { setMessage("시작일이 종료일보다 뒤입니다."); return; }
    // 날짜 목록 생성 (과거 → 최근)
    const dates: string[] = [];
    let d = bulkFrom;
    while (d <= bulkTo) { dates.push(d); d = addDays(d, 1); }
    if (dates.length > 40) { setMessage("한 번에 최대 40일까지만 수집할 수 있습니다. 기간을 줄여주세요."); return; }

    bulkCancel.v = false;
    setBulkRunning(true);
    setMessage(null);
    let ok = 0, fail = 0;
    for (let i = 0; i < dates.length; i++) {
      if (bulkCancel.v) { setMessage(`중단됨 — ${ok}일 완료, ${fail}일 실패`); break; }
      setBulkProgress({ done: i, total: dates.length, current: dates[i] });
      try {
        const res = await api.triggerSync({ account: accountId, date: dates[i] });
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
      // 각 날짜 사이 잠깐 쉼 (네이버 rate limit 여유)
      await new Promise((r) => setTimeout(r, 800));
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
    }
    setBulkProgress(null);
    setBulkRunning(false);
    if (!bulkCancel.v) setMessage(`기간 수집 완료 — 성공 ${ok}일, 실패 ${fail}일`);
    qc.invalidateQueries({ queryKey: ["sync-logs"] });
  }

  const rows = query.data ?? [];

  return (
    <>
      <PageHeader
        title="수집 이력"
        description="자동 수집은 한국 시간 매일 오전 9시에 전일 데이터를 가져옵니다."
        actions={
          <>
            <Input type="date" value={date} max={seoulToday()}
              onChange={(e) => setDate(e.target.value)} className="h-9 w-40 text-xs" />
            <Button variant="primary" loading={running} onClick={run}>
              <RefreshCw className="h-3.5 w-3.5" /> 이 날짜 다시 수집
            </Button>
          </>
        }
      />

      {message && (
        <div className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-xs">{message}</div>
      )}

      <p className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
        같은 날짜를 다시 수집해도 기존 행이 갱신될 뿐 중복으로 쌓이지 않습니다.
        API 호출이 실패하면 최대 3회까지 자동으로 재시도합니다.
      </p>

      {/* 기간 일괄 수집 */}
      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="text-xs font-medium">기간 일괄 수집</span>
          <Input type="date" value={bulkFrom} max={seoulToday()}
            onChange={(e) => setBulkFrom(e.target.value)}
            className="h-8 w-36 text-xs" disabled={bulkRunning} />
          <span className="text-xs text-ink-faint">~</span>
          <Input type="date" value={bulkTo} max={seoulToday()}
            onChange={(e) => setBulkTo(e.target.value)}
            className="h-8 w-36 text-xs" disabled={bulkRunning} />
          {!bulkRunning ? (
            <Button variant="primary" onClick={runBulk}>
              <RefreshCw className="h-3.5 w-3.5" /> 기간 수집 시작
            </Button>
          ) : (
            <Button onClick={() => { bulkCancel.v = true; }}>중단</Button>
          )}
          <span className="text-xs text-ink-faint">
            하루씩 순서대로 수집합니다. 한 번에 최대 40일.
          </span>
        </div>
        {bulkProgress && (
          <div className="border-t border-line px-4 py-3">
            <div className="mb-1.5 flex justify-between text-xs">
              <span>{bulkProgress.current} 수집 중…</span>
              <span className="text-ink-faint">{bulkProgress.done} / {bulkProgress.total}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
              <div className="h-full bg-brand-500 transition-all"
                style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }} />
            </div>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        {query.isLoading ? <TableSkeleton rows={8} cols={8} /> : rows.length === 0 ? (
          <EmptyState title="수집 이력이 없습니다"
            description="위에서 날짜를 고르고 수집을 한 번 실행해 보세요." />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">시작 시각</th>
                  <th className="th">대상 날짜</th>
                  <th className="th">상태</th>
                  <th className="th">모드</th>
                  <th className="th text-right">수집</th>
                  <th className="th text-right">반영</th>
                  <th className="th text-right">미매핑</th>
                  <th className="th text-right">시도</th>
                  <th className="th text-right">소요</th>
                  <th className="th">메시지</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="row-hover">
                    <td className="td tnum text-2xs">
                      {new Date(l.started_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                    </td>
                    <td className="td tnum">{l.stat_date ?? "—"}</td>
                    <td className="td">
                      <Badge tone={STATUS[l.status]?.tone ?? "neutral"}>
                        {STATUS[l.status]?.label ?? l.status}
                      </Badge>
                    </td>
                    <td className="td text-2xs text-ink-muted">{l.mode}</td>
                    <td className="td text-right">{num(l.rows_fetched)}</td>
                    <td className="td text-right font-medium">{num(l.rows_upserted)}</td>
                    <td className="td text-right">
                      {l.rows_unmapped > 0
                        ? <span className="text-warn">{num(l.rows_unmapped)}</span>
                        : "0"}
                    </td>
                    <td className="td text-right">{l.attempt}</td>
                    <td className="td text-right text-2xs text-ink-faint">
                      {l.duration_ms ? `${(l.duration_ms / 1000).toFixed(1)}초` : "—"}
                    </td>
                    <td className="td max-w-xs truncate text-2xs text-ink-muted">
                      {l.message ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
