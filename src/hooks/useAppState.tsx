import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/supabase";
import { resolveRange, type CompareMode, type DateRange } from "@/lib/dateRange";
import type { AdAccount, ProductGroup } from "@/lib/types";

// 광고 매체 필터. all = 전체(네이버+메타), 이후 매체 추가 시 확장.
export type MediaFilter = "all" | "naver" | "meta";

interface AppStateValue {
  accounts: AdAccount[];
  accountId: string | null;
  setAccountId: (id: string) => void;
  groups: ProductGroup[];
  range: DateRange;
  setRange: (r: DateRange) => void;
  compare: CompareMode;
  setCompare: (c: CompareMode) => void;
  media: MediaFilter;
  setMedia: (m: MediaFilter) => void;
  loading: boolean;
  error: unknown;
}
const AppStateContext = createContext<AppStateValue | null>(null);
const STORAGE_KEY = "choco-ads.filters";
function loadSaved(): { accountId?: string; range?: DateRange; compare?: CompareMode; media?: MediaFilter } {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
export function AppStateProvider({ children }: { children: ReactNode }) {
  const saved = loadSaved();
  const [accountId, setAccountId] = useState<string | null>(saved.accountId ?? null);
  const [range, setRange] = useState<DateRange>(saved.range ?? resolveRange("last7"));
  const [compare, setCompare] = useState<CompareMode>(saved.compare ?? "prev_period");
  const [media, setMedia] = useState<MediaFilter>(saved.media ?? "all");
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: api.listGroups });
  useEffect(() => {
    if (!accountId && accountsQuery.data?.length) setAccountId(accountsQuery.data[0].id);
  }, [accountsQuery.data, accountId]);
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ accountId, range, compare, media }));
  }, [accountId, range, compare, media]);
  const value = useMemo<AppStateValue>(() => ({
    accounts: accountsQuery.data ?? [],
    accountId,
    setAccountId,
    groups: groupsQuery.data ?? [],
    range,
    setRange,
    compare,
    setCompare,
    media,
    setMedia,
    loading: accountsQuery.isLoading,
    error: accountsQuery.error,
  }), [accountsQuery.data, accountsQuery.isLoading, accountsQuery.error,
       groupsQuery.data, accountId, range, compare, media]);
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState 는 AppStateProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}
/** 계정이 정해진 뒤에만 쿼리를 돌리기 위한 헬퍼 */
export function useAccountId(): string {
  const { accountId } = useAppState();
  return accountId ?? "";
}
