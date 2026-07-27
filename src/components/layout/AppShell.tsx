import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  BarChart3, Bell, Boxes, Database, LayoutDashboard, Link2, LogOut, Menu,
  Package, RefreshCw, Settings, TriangleAlert,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { api } from "@/lib/supabase";
import { Badge, Select } from "@/components/ui";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "성과",
    items: [
      { to: "/", label: "대시보드", icon: LayoutDashboard },
      { to: "/products", label: "상품별 데이터", icon: Package },
      { to: "/groups", label: "상품군별 데이터", icon: Boxes },
    ],
  },
  {
    section: "데이터",
    items: [
      { to: "/raw", label: "RAW 데이터", icon: Database },
      { to: "/unmapped", label: "미매핑 소재", icon: TriangleAlert },
      { to: "/mappings", label: "소재 매핑 관리", icon: Link2, adminOnly: true },
      { to: "/sync", label: "수집 이력", icon: RefreshCw, adminOnly: true },
    ],
  },
  {
    section: "운영",
    items: [
      { to: "/alerts", label: "알림 센터", icon: Bell },
      { to: "/settings", label: "설정", icon: Settings, adminOnly: true },
    ],
  },
];

export function AppShell() {
  const { profile, isAdmin, signOut } = useAuth();
  const { accounts, accountId, setAccountId } = useAppState();
  const [open, setOpen] = useState(false);

  const unread = useQuery({
    queryKey: ["alerts-unread", accountId],
    queryFn: () => api.alerts(accountId!, true),
    enabled: Boolean(accountId),
    refetchInterval: 60_000,
  });

  return (
    <div className="flex min-h-screen">
      {/* 사이드바 */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface",
          "transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <BarChart3 className="h-5 w-5 text-brand-500" />
          <div className="leading-tight">
            <p className="text-sm font-semibold">광고 성과 콘솔</p>
            <p className="text-2xs text-ink-faint">초코펫하우스</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((group) => {
            const items = group.items.filter((i) => !i.adminOnly || isAdmin);
            if (!items.length) return null;
            return (
              <div key={group.section} className="mb-4">
                <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                  {group.section}
                </p>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) => cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-brand-50 font-medium text-brand-700"
                        : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                    )}
                  >
                    <item.icon className="h-4 w-4" strokeWidth={1.75} />
                    <span className="flex-1">{item.label}</span>
                    {item.to === "/alerts" && (unread.data?.length ?? 0) > 0 && (
                      <Badge tone="bad">{unread.data!.length}</Badge>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <p className="truncate text-xs font-medium">{profile?.full_name ?? profile?.email}</p>
          <div className="mt-1 flex items-center justify-between">
            <Badge tone={isAdmin ? "brand" : "neutral"}>{isAdmin ? "관리자" : "조회 사용자"}</Badge>
            <button
              onClick={signOut}
              className="flex items-center gap-1 text-2xs text-ink-faint hover:text-ink"
            >
              <LogOut className="h-3 w-3" /> 로그아웃
            </button>
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* 본문 */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur">
          <button
            className="rounded p-1.5 text-ink-muted hover:bg-surface-sunken lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="메뉴 열기"
          >
            <Menu className="h-5 w-5" />
          </button>

          {accounts.length > 1 && (
            <Select
              value={accountId ?? ""}
              onChange={(e) => setAccountId(e.target.value)}
              aria-label="광고 계정"
            >
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}

          <div className="ml-auto" id="topbar-slot" />
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title, description, actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-ink-faint">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
