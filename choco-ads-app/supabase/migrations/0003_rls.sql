-- ============================================================================
-- RLS 정책
--   관리자(admin) : 전체 읽기 + 쓰기
--   조회자(viewer): 전체 읽기, 쓰기 불가
--   비로그인      : 접근 불가
-- API Secret 은 DB 에 저장하지 않고 Edge Function 환경변수로만 다룬다.
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- 뷰가 호출자 권한으로 동작하도록 (RLS 우회 방지)
alter view public.v_ad_performance set (security_invoker = on);

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'ad_accounts', 'product_groups', 'product_group_rules', 'products',
    'creatives', 'creative_product_mappings', 'excluded_ad_types',
    'ad_performance_daily', 'sync_logs', 'data_corrections', 'alert_rules', 'alerts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- --- 읽기: 로그인한 사용자 전체 ---------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ad_accounts', 'product_groups', 'product_group_rules', 'products',
    'creatives', 'creative_product_mappings', 'excluded_ad_types',
    'ad_performance_daily', 'sync_logs', 'data_corrections', 'alert_rules', 'alerts'
  ] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I', t);
    execute format(
      'create policy "%1$s_select" on public.%1$I for select to authenticated using (true)', t);
  end loop;
end;
$$;

-- --- 쓰기: 관리자만 -----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ad_accounts', 'product_groups', 'product_group_rules', 'products',
    'creatives', 'creative_product_mappings', 'excluded_ad_types',
    'ad_performance_daily', 'data_corrections', 'alert_rules'
  ] loop
    execute format('drop policy if exists "%1$s_write" on public.%1$I', t);
    execute format(
      'create policy "%1$s_write" on public.%1$I for all to authenticated
         using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end;
$$;

-- 알림 읽음 처리는 조회 사용자도 가능하게 둔다.
drop policy if exists "alerts_update" on public.alerts;
create policy "alerts_update" on public.alerts
  for update to authenticated using (true) with check (true);

-- sync_logs 는 Edge Function(service_role)만 쓴다. service_role 은 RLS 를 우회한다.

-- --- 프로필 -------------------------------------------------------------------
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert" on public.profiles
  for insert to authenticated with check (public.is_admin());

-- --- RPC 실행 권한 -------------------------------------------------------------
grant execute on function
  public.safe_div(numeric, numeric),
  public.fn_period_summary(uuid, date, date, uuid, uuid, text, text),
  public.fn_daily_series(uuid, date, date, uuid, uuid, text),
  public.fn_product_stats(uuid, date, date, uuid, text, text),
  public.fn_group_stats(uuid, date, date, text),
  public.fn_creative_stats(uuid, date, date, uuid),
  public.fn_unmapped(uuid, date, date),
  public.fn_zero_conversion_products(uuid, date, date, numeric)
to authenticated;

grant execute on function public.fn_backfill_mapping(uuid, text) to authenticated;
