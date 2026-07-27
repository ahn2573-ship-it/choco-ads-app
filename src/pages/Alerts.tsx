import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, RefreshCw } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/supabase";
import { addDays, seoulToday } from "@/lib/dateRange";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge, Button, Card, EmptyState, ErrorState, Select, TableSkeleton } from "@/components/ui";

const SEVERITY: Record<string, { tone: "bad" | "warn" | "neutral"; label: string }> = {
  critical: { tone: "bad", label: "긴급" },
  warning: { tone: "warn", label: "주의" },
  info: { tone: "neutral", label: "참고" },
};

export function Alerts() {
  const { accountId } = useAppState();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [scanning, setScanning] = useState(false);

  const query = useQuery({
    queryKey: ["alerts", accountId, onlyUnread],
    queryFn: () => api.alerts(accountId!, onlyUnread),
    enabled: Boolean(accountId),
  });

  async function rescan() {
    if (!accountId) return;
    setScanning(true);
    try {
      await api.scanAlerts(accountId, addDays(seoulToday(), -1));
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["alerts-unread"] });
    } finally {
      setScanning(false);
    }
  }

  async function markRead(id: string) {
    await api.markAlertRead(id);
    qc.invalidateQueries({ queryKey: ["alerts"] });
    qc.invalidateQueries({ queryKey: ["alerts-unread"] });
  }

  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const rows = query.data ?? [];

  return (
    <>
      <PageHeader
        title="알림 센터"
        description="설정한 규칙에 걸린 항목입니다. 규칙과 임계값은 설정 화면에서 바꿀 수 있습니다."
        actions={
          <>
            <Select className="h-9 text-xs" value={onlyUnread ? "unread" : "all"}
              onChange={(e) => setOnlyUnread(e.target.value === "unread")}>
              <option value="all">전체</option>
              <option value="unread">읽지 않음</option>
            </Select>
            {isAdmin && (
              <Button variant="primary" loading={scanning} onClick={rescan}>
                <RefreshCw className="h-3.5 w-3.5" /> 전일 기준 재검사
              </Button>
            )}
          </>
        }
      />

      <Card className="overflow-hidden">
        {query.isLoading ? <TableSkeleton rows={6} cols={4} /> : rows.length === 0 ? (
          <EmptyState
            title="알림이 없습니다"
            description={isAdmin
              ? "전일 기준 재검사를 눌러 규칙을 다시 적용해 보세요."
              : "규칙에 걸린 항목이 아직 없습니다."}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id}
                className={`flex items-start gap-3 px-4 py-3 ${a.is_read ? "opacity-60" : ""}`}>
                <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY[a.severity]?.tone ?? "neutral"}>
                      {SEVERITY[a.severity]?.label ?? a.severity}
                    </Badge>
                    <span className="text-sm font-medium">{a.title}</span>
                    <span className="tnum text-2xs text-ink-faint">{a.stat_date}</span>
                  </div>
                  <p className="mt-0.5 break-words text-xs text-ink-muted">{a.body}</p>
                  {a.entity_type === "product" && a.entity_id && (
                    <button
                      onClick={() => navigate(`/products/${a.entity_id}`)}
                      className="mt-1 text-2xs text-brand-600 hover:underline"
                    >
                      상품 상세 보기
                    </button>
                  )}
                  {a.entity_type === "creative" && (
                    <button
                      onClick={() => navigate("/unmapped")}
                      className="mt-1 text-2xs text-brand-600 hover:underline"
                    >
                      미매핑 소재에서 처리
                    </button>
                  )}
                </div>
                {!a.is_read && (
                  <Button size="sm" variant="ghost" onClick={() => markRead(a.id)}>
                    <Check className="h-3.5 w-3.5" /> 읽음
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
