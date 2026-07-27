-- ============================================================================
-- 매일 자동 수집 스케줄 (선택 사항)
-- 아래 값을 실제 프로젝트 값으로 바꾼 뒤 Supabase SQL Editor 에서 실행한다.
--   <PROJECT_REF>  : Supabase 프로젝트 레퍼런스
--   <SERVICE_ROLE> : service_role 키. 절대 프론트엔드에 두지 않는다.
-- Vercel Cron 대신 Supabase 내부 스케줄러를 쓰는 이유는 README 참고.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 한국 시간 오전 9시 = UTC 0시. 전일 데이터를 수집한다.
select cron.schedule(
  'sync-ads-daily',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-ads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE>'
    ),
    body    := jsonb_build_object('mode', 'auto')
  );
  $$
);

-- 해제하려면:
-- select cron.unschedule('sync-ads-daily');
