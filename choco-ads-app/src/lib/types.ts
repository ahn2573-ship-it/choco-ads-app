export type UserRole = "admin" | "viewer";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
}

export interface AdAccount {
  id: string;
  name: string;
  platform: string;
  customer_id: string | null;
  account_id: string | null;
  is_active: boolean;
}

export interface ProductGroup {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Product {
  id: string;
  mall_product_id: string;
  smartstore_product_no: string | null;
  display_name: string | null;
  base_name: string | null;
  product_group_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** 모든 집계 RPC 가 공유하는 지표 묶음 */
export interface MetricBundle {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cost: number;
  conv_count: number;
  conv_revenue: number;
  conv_roas: number;
  total_conv_count: number;
  total_conv_revenue: number;
  total_roas: number;
}

export interface PeriodSummary extends MetricBundle {}

export interface DailyPoint extends MetricBundle {
  stat_date: string;
}

export interface ProductStat extends MetricBundle {
  product_id: string | null;
  mall_product_id: string | null;
  smartstore_product_no: string | null;
  display_name: string;
  base_name: string;
  product_group_id: string | null;
  product_group_name: string;
  creative_count: number;
}

export interface GroupStat extends MetricBundle {
  product_group_id: string | null;
  product_group_name: string;
  product_count: number;
}

export interface CreativeStat extends MetricBundle {
  creative_id: string;
  creative_name: string | null;
  product_id: string | null;
  display_name: string | null;
  avg_rank: number | null;
}

export interface UnmappedRow {
  creative_id: string;
  creative_name: string | null;
  raw_product_value: string;
  first_date: string;
  last_date: string;
  impressions: number;
  clicks: number;
  cost: number;
  reason: string;
}

export interface CreativeMapping {
  id: string;
  ad_account_id: string;
  creative_id: string;
  product_id: string;
  is_active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
  products?: Pick<
    Product,
    "mall_product_id" | "smartstore_product_no" | "display_name" | "base_name" | "product_group_id"
  > & { product_groups?: { name: string } | null };
}

export interface SyncLog {
  id: string;
  stat_date: string | null;
  status: "running" | "success" | "partial" | "failed";
  mode: string;
  rows_fetched: number;
  rows_upserted: number;
  rows_unmapped: number;
  attempt: number;
  duration_ms: number | null;
  message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Alert {
  id: string;
  stat_date: string | null;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metric_value: number | null;
  is_read: boolean;
  created_at: string;
}

export interface AlertRule {
  id: string;
  rule_type: string;
  threshold: number | null;
  comparison: string | null;
  is_active: boolean;
  channel: string;
}

export interface RawRow {
  id: string;
  stat_date: string;
  creative_id: string;
  product_id: string | null;
  mall_product_id: string | null;
  ad_type_label: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  avg_rank: number | null;
  conv_count: number;
  conv_revenue: number;
  total_conv_count: number;
  total_conv_revenue: number;
  source: string;
}

export type Bucket = "product" | "other_ad" | "unmapped" | "all";
