import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/supabase";
import { resolveRange, type CompareMode, type DateRange } from "@/lib/dateRange";
import type { AdAccount, ProductGroup } from "@/lib/types";

interface AppStateValue {
  accounts: AdAccount[];
  accountId: string | null;
  setAccountId: (id: string) => void;
  groups: ProductGroup[];
  range: DateRange;
  setRange: (r: DateRange) => void;
  compare: CompareMode;
  setCompare: (c: CompareMode) => void;
  loading: boolean;
  error: unknown;
}

const AppStateContext = createContext<AppStateValue | null>(null);

const STORAGE_KEY = "choco-ads.filters";

function loadSaved(): { accountId?: string; range?: DateRange; compare?: CompareMode } {
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

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.listAccounts });
  const groupsQuery = useQuery({ queryKey: ["groups"], queryFn: api.listGroups });

  useEffect(() => {
    if (!accountId && accountsQuery.data?.length) setAccountId(accountsQuery.data[0].id);
  }, [accountsQuery.data, accountId]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ accountId, range, compare }));
  }, [accountId, range, compare]);

  const value = useMemo<AppStateValue>(() => ({
    accounts: accountsQuery.data ?? [],
    accountId,
    setAccountId,
    groups: groupsQuery.data ?? [],
    range,
    setRange,
    compare,
    setCompare,
    loading: accountsQuery.isLoading,
    error: accountsQuery.error,
  }), [accountsQuery.data, accountsQuery.isLoading, accountsQuery.error,
       groupsQuery.data, accountId, range, compare]);

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
