import { createClient } from "@supabase/supabase-js";
import type {
  AdAccount, Alert, AlertRule, CreativeMapping, CreativeStat, DailyPoint,
  GroupStat, PeriodSummary, Product, ProductGroup, ProductStat, Profile,
  RawRow, SyncLog, UnmappedRow, Bucket,
} from "./types";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
  // 설정이 없으면 화면에서 안내한다. 여기서 throw 하면 빈 화면만 남는다.
  console.warn("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다.");
}

export const supabase = createClient(url ?? "http://localhost", anonKey ?? "public-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true },
});

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// ---------------------------------------------------------------------------
// 계정 / 프로필
// ---------------------------------------------------------------------------
export const api = {
  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async listAccounts(): Promise<AdAccount[]> {
    return unwrap(await supabase.from("ad_accounts").select("*")
      .eq("is_active", true).order("created_at"));
  },

  // -------------------------------------------------------------------------
  // 집계 RPC
  // -------------------------------------------------------------------------
  async summary(params: {
    account: string; from: string; to: string;
    groupId?: string | null; productId?: string | null;
    creativeId?: string | null; bucket?: Bucket; campaignType?: string | null;
    media?: string | null;
  }): Promise<PeriodSummary> {
    const rows = unwrap<PeriodSummary[]>(await supabase.rpc("fn_period_summary", {
      p_account: params.account,
      p_from: params.from,
      p_to: params.to,
      p_group_id: params.groupId ?? null,
      p_product_id: params.productId ?? null,
      p_creative_id: params.creativeId ?? null,
      p_bucket: params.bucket ?? "product",
      p_campaign_type: params.campaignType ?? null,
      p_media: params.media && params.media !== "all" ? params.media : null,
    }));
    return rows[0];
  },

  async dailySeries(params: {
    account: string; from: string; to: string;
    groupId?: string | null; productId?: string | null; bucket?: Bucket;
    campaignType?: string | null; media?: string | null;
  }): Promise<DailyPoint[]> {
    return unwrap(await supabase.rpc("fn_daily_series", {
      p_account: params.account, p_from: params.from, p_to: params.to,
      p_group_id: params.groupId ?? null, p_product_id: params.productId ?? null,
      p_bucket: params.bucket ?? "product",
      p_campaign_type: params.campaignType ?? null,
      p_media: params.media && params.media !== "all" ? params.media : null,
    }));
  },

  async campaignTypes(params: {
    account: string; from: string; to: string; media?: string | null;
  }): Promise<Array<{
    campaign_type: string; campaign_type_label: string;
    impressions: number; clicks: number; cost: number;
    conv_count: number; conv_revenue: number;
  }>> {
    return unwrap(await supabase.rpc("fn_campaign_type_summary", {
      p_account: params.account, p_from: params.from, p_to: params.to,
      p_media: params.media && params.media !== "all" ? params.media : null,
    }));
  },

  async productStats(params: {
    account: string; from: string; to: string;
    groupId?: string | null; search?: string | null; bucket?: Bucket;
    media?: string | null;
  }): Promise<ProductStat[]> {
    return unwrap(await supabase.rpc("fn_product_stats", {
      p_account: params.account, p_from: params.from, p_to: params.to,
      p_group_id: params.groupId ?? null, p_search: params.search || null,
      p_bucket: params.bucket ?? "product",
      p_media: params.media && params.media !== "all" ? params.media : null,
    }));
  },

  async groupStats(params: {
    account: string; from: string; to: string; search?: string | null;
    media?: string | null;
  }): Promise<GroupStat[]> {
    return unwrap(await supabase.rpc("fn_group_stats", {
      p_account: params.account, p_from: params.from, p_to: params.to,
      p_search: params.search || null,
      p_media: params.media && params.media !== "all" ? params.media : null,
    }));
  },

  async creativeStats(params: {
    account: string; from: string; to: string; productId?: string | null;
    media?: string | null;
  }): Promise<CreativeStat[]> {
    return unwrap(await supabase.rpc("fn_creative_stats", {
      p_account: params.account, p_from: params.from, p_to: params.to,
      p_product_id: params.productId ?? null,
      p_media: params.media && params.media !== "all" ? params.media : null,
    }));
  },

  async unmapped(params: {
    account: string; from: string; to: string; media?: string | null;
  }): Promise<UnmappedRow[]> {
    return unwrap(await supabase.rpc("fn_unmapped", {
      p_account: params.account, p_from: params.from, p_to: params.to,
      p_media: params.media && params.media !== "all" ? params.media : null,
    }));
  },

  async zeroConversion(params: {
    account: string; from: string; to: string; minCost?: number; media?: string | null;
  }) {
    return unwrap<Array<{
      product_id: string; display_name: string; product_group_name: string;
      impressions: number; clicks: number; cost: number; total_conv_count: number;
    }>>(await supabase.rpc("fn_zero_conversion_products", {
      p_account: params.account, p_from: params.from, p_to: params.to,
      p_min_cost: params.minCost ?? 0,
      p_media: params.media && params.media !== "all" ? params.media : null,
    }));
  },

  // -------------------------------------------------------------------------
  // 마스터 데이터
  // -------------------------------------------------------------------------
  async listGroups(): Promise<ProductGroup[]> {
    return unwrap(await supabase.from("product_groups").select("*")
      .eq("is_active", true).order("name"));
  },

  // 상품군 목록 + 소속 상품 수
  async groupList(): Promise<Array<{ id: string; name: string; product_count: number; is_active: boolean }>> {
    return unwrap(await supabase.rpc("fn_group_list", { p_account: null }));
  },

  // 상품군 대량 적용. 결과로 각 항목의 처리 상태(linked/not_found/ambiguous)를 돌려준다.
  async groupBulkApply(
    assignments: Array<{ productName?: string; productId?: string; groupName: string }>,
    groupNames: string[],
  ): Promise<Array<{ product_name: string | null; product_id: string | null; group_name: string; status: string }>> {
    return unwrap(await supabase.rpc("fn_group_bulk_apply", {
      p_assignments: assignments,
      p_group_names: groupNames,
    }));
  },

  // 상품군 이름 변경 / 추가 / 삭제
  async createGroup(name: string): Promise<void> {
    unwrap(await supabase.from("product_groups").insert({ name }));
  },
  async renameGroup(id: string, name: string): Promise<void> {
    unwrap(await supabase.from("product_groups").update({ name, updated_at: new Date().toISOString() }).eq("id", id));
  },
  async deleteGroup(id: string): Promise<void> {
    unwrap(await supabase.from("product_groups").delete().eq("id", id));
  },

  // 특정 상품군에 속한 상품 목록
  async productsInGroup(groupId: string): Promise<Array<{ id: string; mall_product_id: string; display_name: string | null; base_name: string | null }>> {
    return unwrap(await supabase.from("products")
      .select("id, mall_product_id, display_name, base_name")
      .eq("product_group_id", groupId)
      .order("display_name"));
  },

  // 상품군에 아직 안 들어간(또는 다른 군의) 상품을 검색 — 추가 후보용
  async productsForAssign(q: string, limit = 20): Promise<Array<{ id: string; mall_product_id: string; display_name: string | null; base_name: string | null; product_group_id: string | null }>> {
    let query = supabase.from("products")
      .select("id, mall_product_id, display_name, base_name, product_group_id")
      .limit(limit).order("display_name");
    if (q) {
      query = query.or(`display_name.ilike.%${q}%,base_name.ilike.%${q}%,mall_product_id.ilike.%${q}%`);
    }
    return unwrap(await query);
  },

  // 상품의 상품군 배정/해제 (groupId=null 이면 미분류로)
  async setProductGroup(productId: string, groupId: string | null): Promise<void> {
    unwrap(await supabase.from("products")
      .update({ product_group_id: groupId, updated_at: new Date().toISOString() })
      .eq("id", productId));
  },

  async getProduct(id: string): Promise<Product & { product_groups: { name: string } | null }> {
    return unwrap(await supabase.from("products")
      .select("*, product_groups(name)").eq("id", id).single());
  },

  async searchProducts(q: string, limit = 20): Promise<Product[]> {
    let query = supabase.from("products").select("*").limit(limit);
    if (q) {
      query = query.or(
        `display_name.ilike.%${q}%,base_name.ilike.%${q}%,mall_product_id.ilike.%${q}%`,
      );
    }
    return unwrap(await query);
  },

  async upsertProduct(p: Partial<Product>) {
    return unwrap(await supabase.from("products").upsert(p).select().single());
  },

  // -------------------------------------------------------------------------
  // 매핑
  // -------------------------------------------------------------------------
  async listMappings(params: {
    account: string; search?: string; groupId?: string | null;
    page?: number; pageSize?: number;
  }): Promise<{ rows: CreativeMapping[]; total: number }> {
    const page = params.page ?? 0;
    const size = params.pageSize ?? 50;
    let q = supabase
      .from("creative_product_mappings")
      .select(
        "*, products!inner(mall_product_id, smartstore_product_no, display_name, base_name, product_group_id, product_groups(name))",
        { count: "exact" },
      )
      .eq("ad_account_id", params.account)
      .order("updated_at", { ascending: false })
      .range(page * size, page * size + size - 1);

    if (params.search) {
      q = q.or(
        `creative_id.ilike.%${params.search}%`,
      );
    }
    if (params.groupId) q = q.eq("products.product_group_id", params.groupId);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as CreativeMapping[], total: count ?? 0 };
  },

  async saveMapping(m: {
    id?: string; ad_account_id: string; creative_id: string;
    product_id: string; is_active?: boolean; note?: string | null;
  }) {
    // upsert 하면 트리거(backfill_after_mapping)가 과거 데이터에 자동 소급 적용한다.
    // 따라서 여기서 fn_backfill_mapping 을 다시 호출하지 않는다 (중복/지연 방지).
    const { data, error } = await supabase.from("creative_product_mappings")
      .upsert(m, { onConflict: "ad_account_id,creative_id" })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteMapping(id: string) {
    const { error } = await supabase.from("creative_product_mappings").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  // -------------------------------------------------------------------------
  // RAW / 보정
  // -------------------------------------------------------------------------
  async rawRows(params: {
    account: string; from: string; to: string; search?: string;
    page?: number; pageSize?: number;
  }): Promise<{ rows: RawRow[]; total: number }> {
    const page = params.page ?? 0;
    const size = params.pageSize ?? 100;
    let q = supabase.from("ad_performance_daily")
      .select("*", { count: "exact" })
      .eq("ad_account_id", params.account)
      .gte("stat_date", params.from).lte("stat_date", params.to)
      .order("stat_date", { ascending: false }).order("cost", { ascending: false })
      .range(page * size, page * size + size - 1);
    if (params.search) q = q.ilike("creative_id", `%${params.search}%`);
    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as RawRow[], total: count ?? 0 };
  },

  async correctRow(params: {
    performanceId: string; field: string; oldValue: string; newValue: string;
    reason: string; userId: string;
  }) {
    const { error: upErr } = await supabase.from("ad_performance_daily")
      .update({ [params.field]: params.newValue, source: "manual" })
      .eq("id", params.performanceId);
    if (upErr) throw new Error(upErr.message);

    const { error } = await supabase.from("data_corrections").insert({
      performance_id: params.performanceId,
      field_name: params.field,
      old_value: params.oldValue,
      new_value: params.newValue,
      reason: params.reason,
      corrected_by: params.userId,
    });
    if (error) throw new Error(error.message);
  },

  // -------------------------------------------------------------------------
  // 수집 / 알림
  // -------------------------------------------------------------------------
  async syncLogs(account: string, limit = 30): Promise<SyncLog[]> {
    return unwrap(await supabase.from("sync_logs").select("*")
      .eq("ad_account_id", account)
      .order("started_at", { ascending: false }).limit(limit));
  },

  async triggerSync(params: { account: string; date?: string }) {
    const { data, error } = await supabase.functions.invoke("sync-ads", {
      body: { accountId: params.account, date: params.date, mode: "manual" },
    });
    if (error) throw new Error(error.message);
    return data as { ok: boolean; upserted?: number; unmapped?: number; error?: string };
  },

  async alerts(account: string, onlyUnread = false): Promise<Alert[]> {
    let q = supabase.from("alerts").select("*").eq("ad_account_id", account)
      .order("created_at", { ascending: false }).limit(200);
    if (onlyUnread) q = q.eq("is_read", false);
    return unwrap(await q);
  },

  async markAlertRead(id: string) {
    const { error } = await supabase.from("alerts").update({ is_read: true }).eq("id", id);
    if (error) throw new Error(error.message);
  },

  async scanAlerts(account: string, date: string) {
    const { error } = await supabase.rpc("fn_scan_alerts", { p_account: account, p_date: date });
    if (error) throw new Error(error.message);
  },

  async alertRules(): Promise<AlertRule[]> {
    return unwrap(await supabase.from("alert_rules").select("*").order("rule_type"));
  },

  async saveAlertRule(rule: { id: string; threshold?: number | null; is_active?: boolean }) {
    return unwrap(await supabase.from("alert_rules").update({
      threshold: rule.threshold, is_active: rule.is_active,
    }).eq("id", rule.id).select().single());
  },

  async excludedAdTypes() {
    return unwrap<Array<{ id: string; label: string; match_type: string; is_active: boolean }>>(
      await supabase.from("excluded_ad_types").select("*").order("label"),
    );
  },

  async saveExcludedAdType(row: { id?: string; label: string; match_type: string; is_active: boolean }) {
    return unwrap(await supabase.from("excluded_ad_types").upsert(row).select().single());
  },
};
