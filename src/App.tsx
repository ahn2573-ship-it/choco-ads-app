import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppStateProvider } from "@/hooks/useAppState";
import { AppShell } from "@/components/layout/AppShell";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Products } from "@/pages/Products";
import { ProductDetail } from "@/pages/ProductDetail";
import { Groups } from "@/pages/Groups";
import { GroupManage } from "@/pages/GroupManage";
import { GroupDetail } from "@/pages/GroupDetail";
import { RawData } from "@/pages/RawData";
import { Mappings } from "@/pages/Mappings";
import { Unmapped } from "@/pages/Unmapped";
import { Alerts } from "@/pages/Alerts";
import { SyncLogs } from "@/pages/SyncLogs";
import { Settings } from "@/pages/Settings";
import { EmptyState, Skeleton } from "@/components/ui";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});

/** 관리자 전용 라우트 */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, profile } = useAuth();
  if (!profile) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!isAdmin) {
    return (
      <EmptyState
        title="접근 권한이 없습니다"
        description="이 화면은 관리자만 볼 수 있습니다. 권한이 필요하면 관리자에게 요청하세요."
      />
    );
  }
  return <>{children}</>;
}

function Shell() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-24 w-64 rounded-lg" />
      </div>
    );
  }

  if (!session) return <Login />;

  return (
    <AppStateProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="products" element={<Products />} />
          <Route path="products/:id" element={<ProductDetail />} />
          <Route path="groups" element={<Groups />} />
          <Route path="groups/manage" element={<AdminOnly><GroupManage /></AdminOnly>} />
          <Route path="groups/:id" element={<GroupDetail />} />
          <Route path="raw" element={<RawData />} />
          <Route path="unmapped" element={<Unmapped />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="mappings" element={<AdminOnly><Mappings /></AdminOnly>} />
          <Route path="sync" element={<AdminOnly><SyncLogs /></AdminOnly>} />
          <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppStateProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </HashRouter>
    </QueryClientProvider>
  );
}
