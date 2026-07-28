// ============================================================================
// sync-ads — 일별 광고 데이터 수집 Edge Function
//
//  POST /functions/v1/sync-ads
//  body: { "date": "2026-07-23", "accountId": "<uuid>", "mode": "auto" | "manual" }
//
//  · date 생략 시 Asia/Seoul 기준 전일
//  · 같은 날짜를 다시 호출해도 upsert 되므로 중복 행이 생기지 않는다
//  · API Key / Secret 은 이 함수의 환경변수로만 존재하고 브라우저로 나가지 않는다
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { createAdapter } from "./adapters.ts";
import { dedupeRows, seoulYesterday } from "./mapper.ts";
import type { NormalizedRow } from "./types.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const startedAt = Date.now();
  const env = Deno.env.toObject();

  const supabase = createClient(
    env.SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  let body: { date?: string; accountId?: string; mode?: string } = {};
  try {
    body = await req.json();
  } catch {
    // 본문 없이 호출해도 기본값으로 동작한다.
  }

  const statDate = body.date ?? seoulYesterday();
  const mode = body.mode ?? "auto";

  // 대상 계정 결정
  let accountId = body.accountId;
  let customerId: string | undefined;
  let accountKey: string | undefined;

  const { data: account, error: accountErr } = accountId
    ? await supabase.from("ad_accounts").select("*").eq("id", accountId).single()
    : await supabase.from("ad_accounts").select("*").eq("is_active", true)
        .order("created_at").limit(1).single();

  if (accountErr || !account) {
    return json({ ok: false, error: "활성화된 광고 계정을 찾지 못했습니다." }, 400);
  }
  accountId = account.id;
  customerId = account.customer_id ?? undefined;
  accountKey = account.account_id ?? undefined;

  const { data: logRow } = await supabase.from("sync_logs").insert({
    ad_account_id: accountId,
    stat_date: statDate,
    status: "running",
    mode: env.AD_API_MODE === "live" ? "api" : "mock",
  }).select("id").single();
  const logId = logRow?.id;

  const finish = async (patch: Record<string, unknown>) => {
    if (!logId) return;
    await supabase.from("sync_logs").update({
      ...patch,
      duration_ms: Date.now() - startedAt,
      finished_at: new Date().toISOString(),
    }).eq("id", logId);
  };

  // ---- 1. 수집 (실패 시 재시도) --------------------------------------------
  let rows: NormalizedRow[] = [];
  let attempt = 0;
  let lastError: unknown = null;

  try {
    const adapter = createAdapter(env);
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      try {
        rows = await adapter.fetchDaily({ statDate, customerId, accountId: accountKey });
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        // 보고서 생성 시간 초과는 재시도해도 소용없고 함수 시간만 잡아먹는다.
        // "잠시 후 다시 시도" 하도록 즉시 중단한다.
        if (msg.includes("시간 초과") || msg.includes("timeout")) break;
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  } catch (e) {
    lastError = e;
  }

  if (lastError) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    await finish({ status: "failed", attempt, message });
    await supabase.rpc("fn_scan_alerts", { p_account: accountId, p_date: statDate });
    return json({ ok: false, error: message, attempt }, 502);
  }

  // ---- 2. 정규화 + 중복 제거 -------------------------------------------------
  const deduped = dedupeRows(rows).filter((r) => r.statDate === statDate);
  const skippedOtherDate = rows.length - deduped.length;

  // ---- 3. 소재 upsert -------------------------------------------------------
  const creativeIds = [...new Set(deduped.map((r) => r.creativeId))].filter((c) => c !== "-");
  if (creativeIds.length) {
    await supabase.from("creatives").upsert(
      creativeIds.map((creative_id) => ({
        ad_account_id: accountId,
        creative_id,
        last_seen_at: statDate,
        first_seen_at: statDate,
      })),
      { onConflict: "ad_account_id,creative_id", ignoreDuplicates: true },
    );
  }

  // ---- 4. 소재 -> 상품 매핑 조회 ---------------------------------------------
  const { data: mappings } = await supabase
    .from("creative_product_mappings")
    .select("creative_id, product_id, products(mall_product_id)")
    .eq("ad_account_id", accountId)
    .eq("is_active", true);

  const byCreative = new Map<string, { productId: string; mallProductId: string | null }>();
  for (const m of mappings ?? []) {
    byCreative.set(m.creative_id, {
      productId: m.product_id,
      // deno-lint-ignore no-explicit-any
      mallProductId: (m as any).products?.mall_product_id ?? null,
    });
  }

  // 소재별 광고유형(파워링크/브랜드검색 등)도 가져온다.
  // 상품 매핑이 없는 소재라도 광고유형이 있으면 '기타 광고 유형'으로 분류된다.
  const creativeAdType = new Map<string, string>();
  {
    const { data: crs } = await supabase
      .from("creatives")
      .select("creative_id, ad_type_label")
      .eq("ad_account_id", accountId)
      .not("ad_type_label", "is", null);
    for (const c of crs ?? []) {
      // deno-lint-ignore no-explicit-any
      const label = (c as any).ad_type_label;
      if (label) creativeAdType.set(c.creative_id, label);
    }
  }

  // 소재 매핑이 없을 때는 API 가 준 상품 ID 로도 한 번 더 찾아본다.
  const rawMallIds = [...new Set(deduped.map((r) => r.mallProductId).filter(Boolean))] as string[];
  const byMallId = new Map<string, string>();
  if (rawMallIds.length) {
    const { data: products } = await supabase
      .from("products").select("id, mall_product_id").in("mall_product_id", rawMallIds);
    for (const p of products ?? []) byMallId.set(p.mall_product_id, p.id);
  }

  // ---- 5. upsert ------------------------------------------------------------
  const payload = deduped.map((r) => {
    const viaCreative = byCreative.get(r.creativeId);
    const mallProductId = r.mallProductId ?? viaCreative?.mallProductId ?? null;
    const productId = viaCreative?.productId ??
      (r.mallProductId ? byMallId.get(r.mallProductId) ?? null : null);
    // 상품 매핑이 없으면, 소재에 등록된 광고유형(파워링크 등)을 라벨로 채운다.
    const adTypeLabel = productId ? null : (r.adTypeLabel ?? creativeAdType.get(r.creativeId) ?? null);
    return {
      ad_account_id: accountId,
      stat_date: r.statDate,
      creative_id: r.creativeId,
      product_id: productId,
      mall_product_id: mallProductId,
      ad_type_label: adTypeLabel,
      impressions: r.impressions,
      clicks: r.clicks,
      cost: r.cost,
      avg_rank: r.avgRank,
      conv_count: r.convCount,
      conv_revenue: r.convRevenue,
      total_conv_count: r.totalConvCount,
      total_conv_revenue: r.totalConvRevenue,
      source: env.AD_API_MODE === "live" ? "api" : "mock",
      raw: r.raw ?? null,
    };
  });

  const { error: upsertErr, count } = await supabase
    .from("ad_performance_daily")
    .upsert(payload, {
      onConflict: "ad_account_id,stat_date,creative_id,dedupe_key",
      count: "exact",
    });

  if (upsertErr) {
    await finish({
      status: "failed", attempt, rows_fetched: rows.length, message: upsertErr.message,
    });
    return json({ ok: false, error: upsertErr.message }, 500);
  }

  const unmapped = payload.filter((p) => !p.product_id && !p.ad_type_label).length;

  await finish({
    status: skippedOtherDate > 0 ? "partial" : "success",
    attempt,
    rows_fetched: rows.length,
    rows_upserted: count ?? payload.length,
    rows_unmapped: unmapped,
    message: skippedOtherDate > 0
      ? `요청 날짜와 다른 행 ${skippedOtherDate}건을 제외했습니다.`
      : null,
    detail: { mode, statDate, adapter: env.AD_API_MODE ?? "mock" },
  });

  // ---- 6. 알림 스캔 ----------------------------------------------------------
  await supabase.rpc("fn_scan_alerts", { p_account: accountId, p_date: statDate });

  return json({
    ok: true,
    statDate,
    fetched: rows.length,
    upserted: count ?? payload.length,
    unmapped,
    attempt,
  });
});
