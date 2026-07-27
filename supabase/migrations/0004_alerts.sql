-- ============================================================================
-- 성과 알림 / 자동 진단
-- 채널은 alert_rules.channel 로 분리되어 있고, 현재는 in_app 만 실제 발송한다.
-- 이메일·카카오는 alerts 테이블을 읽는 별도 워커를 붙이면 되도록 구조만 열어둔다.
-- ============================================================================

create or replace function public.fn_scan_alerts(
  p_account uuid,
  p_date    date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_count  integer := 0;
  v_prev   date := p_date - 1;
begin
  -- 같은 날짜 재스캔 시 중복 생성을 막는다.
  delete from public.alerts
  where ad_account_id = p_account and stat_date = p_date and is_read = false;

  for r in select * from public.alert_rules
           where is_active and (ad_account_id is null or ad_account_id = p_account)
  loop
    if r.rule_type = 'cost_no_conversion' then
      insert into public.alerts (rule_id, ad_account_id, stat_date, severity, title, body,
                                 entity_type, entity_id, metric_value)
      select r.id, p_account, p_date, 'warning',
             '광고비 소진, 구매완료 전환 0',
             coalesce(z.display_name, '(이름 없음)') || ' — 광고비 ' ||
               to_char(z.cost, 'FM999,999,999') || '원, 구매완료 0건',
             'product', z.product_id::text, z.cost
      from public.fn_zero_conversion_products(p_account, p_date, p_date, coalesce(r.threshold, 0)) z;

    elsif r.rule_type = 'low_roas' then
      insert into public.alerts (rule_id, ad_account_id, stat_date, severity, title, body,
                                 entity_type, entity_id, metric_value)
      select r.id, p_account, p_date, 'warning',
             'ROAS 목표 미달',
             s.display_name || ' — 구매완료 ROAS ' ||
               to_char(s.conv_roas * 100, 'FM999,999.0') || '%',
             'product', s.product_id::text, s.conv_roas * 100
      from public.fn_product_stats(p_account, p_date, p_date) s
      where s.cost > 0 and s.conv_roas * 100 < coalesce(r.threshold, 0);

    elsif r.rule_type = 'high_cpc' then
      insert into public.alerts (rule_id, ad_account_id, stat_date, severity, title, body,
                                 entity_type, entity_id, metric_value)
      select r.id, p_account, p_date, 'info',
             'CPC 기준 초과',
             s.display_name || ' — CPC ' || to_char(s.cpc, 'FM999,999') || '원',
             'product', s.product_id::text, s.cpc
      from public.fn_product_stats(p_account, p_date, p_date) s
      where s.clicks > 0 and s.cpc > coalesce(r.threshold, 1e9);

    elsif r.rule_type = 'low_ctr' then
      insert into public.alerts (rule_id, ad_account_id, stat_date, severity, title, body,
                                 entity_type, entity_id, metric_value)
      select r.id, p_account, p_date, 'info',
             'CTR 기준 미달',
             s.display_name || ' — CTR ' || to_char(s.ctr * 100, 'FM999.00') || '%',
             'product', s.product_id::text, s.ctr * 100
      from public.fn_product_stats(p_account, p_date, p_date) s
      where s.impressions >= 100 and s.ctr * 100 < coalesce(r.threshold, 0);

    elsif r.rule_type = 'cost_spike' then
      insert into public.alerts (rule_id, ad_account_id, stat_date, severity, title, body,
                                 entity_type, entity_id, metric_value)
      select r.id, p_account, p_date, 'warning',
             '전일 대비 광고비 급증',
             t.display_name || ' — ' || to_char(t.pct, 'FM999,999') || '% 증가',
             'product', t.product_id::text, t.pct
      from (
        select c.product_id, c.display_name,
               public.safe_div(c.cost - pv.cost, nullif(pv.cost, 0)) * 100 as pct
        from public.fn_product_stats(p_account, p_date, p_date) c
        join public.fn_product_stats(p_account, v_prev, v_prev) pv
          on pv.product_id = c.product_id
        where pv.cost > 0
      ) t
      where t.pct >= coalesce(r.threshold, 1e9);

    elsif r.rule_type = 'revenue_drop' then
      insert into public.alerts (rule_id, ad_account_id, stat_date, severity, title, body,
                                 entity_type, entity_id, metric_value)
      select r.id, p_account, p_date, 'warning',
             '전일 대비 매출 급감',
             t.display_name || ' — ' || to_char(abs(t.pct), 'FM999,999') || '% 감소',
             'product', t.product_id::text, t.pct
      from (
        select c.product_id, c.display_name,
               public.safe_div(c.conv_revenue - pv.conv_revenue, nullif(pv.conv_revenue, 0)) * 100 as pct
        from public.fn_product_stats(p_account, p_date, p_date) c
        join public.fn_product_stats(p_account, v_prev, v_prev) pv
          on pv.product_id = c.product_id
        where pv.conv_revenue > 0
      ) t
      where -t.pct >= coalesce(r.threshold, 1e9);

    elsif r.rule_type = 'unmapped_creative' then
      insert into public.alerts (rule_id, ad_account_id, stat_date, severity, title, body,
                                 entity_type, entity_id, metric_value)
      select r.id, p_account, p_date, 'critical',
             '매핑되지 않은 소재',
             u.creative_id || ' — ' || u.reason || ', 광고비 ' ||
               to_char(u.cost, 'FM999,999,999') || '원',
             'creative', u.creative_id, u.cost
      from public.fn_unmapped(p_account, p_date, p_date) u;

    elsif r.rule_type = 'missing_data' then
      if not exists (
        select 1 from public.ad_performance_daily
        where ad_account_id = p_account and stat_date = p_date
      ) then
        insert into public.alerts (rule_id, ad_account_id, stat_date, severity, title, body, entity_type)
        values (r.id, p_account, p_date, 'critical', '데이터 없음',
                to_char(p_date, 'YYYY-MM-DD') || ' 날짜의 광고 데이터가 수집되지 않았습니다.', 'sync');
      end if;

    elsif r.rule_type = 'sync_failed' then
      insert into public.alerts (rule_id, ad_account_id, stat_date, severity, title, body,
                                 entity_type, entity_id)
      select r.id, p_account, p_date, 'critical', '데이터 수집 실패',
             coalesce(l.message, '원인 미상'), 'sync', l.id::text
      from public.sync_logs l
      where l.ad_account_id = p_account and l.stat_date = p_date and l.status = 'failed';
    end if;
  end loop;

  select count(*) into v_count from public.alerts
  where ad_account_id = p_account and stat_date = p_date;

  return v_count;
end;
$$;

grant execute on function public.fn_scan_alerts(uuid, date) to authenticated;
