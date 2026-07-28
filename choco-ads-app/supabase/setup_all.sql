-- ============================================================================
-- 초코펫하우스 광고 대시보드 — 전체 설치 SQL (한 번에 실행)
--
--   사용법: 이 파일을 통째로 복사해 Supabase SQL Editor 에 붙여넣고 Run.
--   설치 가이드의 3단계(마이그레이션 1~4번)를 이 파일 하나로 대체합니다.
--   0005_cron.sql(자동 수집 스케줄)은 8단계에서 값을 채워 별도로 실행합니다.
--
--   ★ 몇 번을 실행해도 안전합니다.
--     - 표/인덱스: if not exists
--     - 타입/트리거/정책: 있으면 지우고 다시 만듦
--     - 기본 데이터: 이미 있으면 건너뜀
--   전에 실패해서 절반만 들어갔더라도, 이 파일을 그대로 다시 Run 하면 됩니다.
--
--   전체를 하나의 트랜잭션으로 감쌌습니다. 중간에 실패하면 전부 취소됩니다.
-- ============================================================================

begin;


-- ###########################################################################
-- 1) 스키마 — 표 13개, 인덱스, 기본 데이터
-- ###########################################################################

-- ============================================================================
-- 초코펫하우스 광고 데이터 자동화 — 기본 스키마
-- 모든 날짜는 Asia/Seoul 기준 date 값으로 저장한다 (timestamptz 변환 금지).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 사용자 / 권한
-- ---------------------------------------------------------------------------
-- 재실행해도 안전하도록 이미 있으면 건너뛴다.
do $$ begin
  create type public.user_role as enum ('admin', 'viewer');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        public.user_role not null default 'viewer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'auth.users 확장. role 로 관리자/조회 사용자를 구분한다.';

-- 신규 가입자는 자동으로 viewer 프로필을 갖는다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 광고 계정 (멀티 계정 / 멀티 업체 대응)
-- ---------------------------------------------------------------------------
create table if not exists public.ad_accounts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  platform     text not null default 'naver_searchad',
  customer_id  text,
  account_id   text,
  timezone     text not null default 'Asia/Seoul',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 상품군 / 상품 / 소재
-- ---------------------------------------------------------------------------
create table if not exists public.product_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 엑셀 '상품군 분류' 시트의 B:C (기본 상품명 -> 그룹명) 대응.
-- 신규 상품이 들어왔을 때 상품군을 자동 배정하는 규칙으로 사용한다.
create table if not exists public.product_group_rules (
  id          uuid primary key default gen_random_uuid(),
  base_name   text not null unique,
  group_id    uuid not null references public.product_groups (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.products (
  id                    uuid primary key default gen_random_uuid(),
  -- 쇼핑몰 상품ID 와 스마트스토어 상품번호는 값이 같은 경우가 있어도 분리 보관한다.
  mall_product_id       text not null unique,
  smartstore_product_no text,
  display_name          text,          -- 노출용 상품명
  base_name             text,          -- 기본 상품명
  product_group_id      uuid references public.product_groups (id) on delete set null,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists products_group_idx on public.products (product_group_id);
create index if not exists products_smartstore_idx on public.products (smartstore_product_no);
create index if not exists products_base_name_idx on public.products (base_name);

create table if not exists public.creatives (
  id             uuid primary key default gen_random_uuid(),
  ad_account_id  uuid not null references public.ad_accounts (id) on delete cascade,
  creative_id    text not null,
  creative_name  text,
  first_seen_at  date,
  last_seen_at   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ad_account_id, creative_id)
);

-- 하나의 소재는 하나의 상품에만 연결된다 (엑셀의 잘못된 다중 연결을 구조로 차단).
create table if not exists public.creative_product_mappings (
  id             uuid primary key default gen_random_uuid(),
  ad_account_id  uuid not null references public.ad_accounts (id) on delete cascade,
  creative_id    text not null,
  product_id     uuid not null references public.products (id) on delete cascade,
  is_active      boolean not null default true,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ad_account_id, creative_id)
);

create index if not exists cpm_product_idx on public.creative_product_mappings (product_id);

-- ---------------------------------------------------------------------------
-- 제외 광고 유형 (브랜드 검색 / 파워링크 / 쇼핑 브랜드형 등)
-- ---------------------------------------------------------------------------
create table if not exists public.excluded_ad_types (
  id          uuid primary key default gen_random_uuid(),
  label       text not null unique,
  match_type  text not null default 'exact' check (match_type in ('exact', 'contains')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.excluded_ad_types (label, match_type) values
  ('파워링크', 'exact'),
  ('브랜드 검색', 'contains'),
  ('브랜드검색', 'contains'),
  ('쇼핑브랜드형', 'contains'),
  ('쇼핑 브랜드형', 'contains')
on conflict (label) do nothing;

-- ---------------------------------------------------------------------------
-- 일별 RAW 성과 (엑셀 result2 대체)
-- ---------------------------------------------------------------------------
create table if not exists public.ad_performance_daily (
  id                  uuid primary key default gen_random_uuid(),
  ad_account_id       uuid not null references public.ad_accounts (id) on delete cascade,
  stat_date           date not null,
  creative_id         text not null,
  product_id          uuid references public.products (id) on delete set null,
  mall_product_id     text,
  ad_type_label       text,   -- 숫자 상품ID가 아닌 값 (파워링크 등)
  impressions         bigint  not null default 0,
  clicks              bigint  not null default 0,
  cost                numeric(18, 2) not null default 0,
  avg_rank            numeric(10, 2),
  conv_count          bigint  not null default 0,
  conv_revenue        numeric(18, 2) not null default 0,
  total_conv_count    bigint  not null default 0,
  total_conv_revenue  numeric(18, 2) not null default 0,
  source              text not null default 'api',   -- api | excel_import | manual
  raw                 jsonb,
  -- 중복 수집 방지 키: 계정 + 날짜 + 소재 + (상품ID 또는 광고유형)
  dedupe_key          text generated always as
                      (coalesce(nullif(mall_product_id, ''), nullif(ad_type_label, ''), '-')) stored,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists ad_perf_dedupe_uidx
  on public.ad_performance_daily (ad_account_id, stat_date, creative_id, dedupe_key);
create index if not exists ad_perf_date_idx on public.ad_performance_daily (ad_account_id, stat_date);
create index if not exists ad_perf_product_idx on public.ad_performance_daily (product_id, stat_date);
create index if not exists ad_perf_creative_idx on public.ad_performance_daily (ad_account_id, creative_id, stat_date);
create index if not exists ad_perf_unmapped_idx on public.ad_performance_daily (ad_account_id, stat_date)
  where product_id is null;

comment on column public.ad_performance_daily.dedupe_key is
  '중복 수집 방지용 생성 컬럼. 상품ID가 없으면 광고 유형, 둘 다 없으면 하이픈.';

-- ---------------------------------------------------------------------------
-- 수집 로그 / 데이터 보정
-- ---------------------------------------------------------------------------
create table if not exists public.sync_logs (
  id             uuid primary key default gen_random_uuid(),
  ad_account_id  uuid references public.ad_accounts (id) on delete cascade,
  stat_date      date,
  status         text not null check (status in ('running', 'success', 'partial', 'failed')),
  mode           text not null default 'api',   -- api | mock | manual
  rows_fetched   integer not null default 0,
  rows_upserted  integer not null default 0,
  rows_unmapped  integer not null default 0,
  attempt        integer not null default 1,
  duration_ms    integer,
  message        text,
  detail         jsonb,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists sync_logs_date_idx on public.sync_logs (ad_account_id, stat_date desc, started_at desc);

create table if not exists public.data_corrections (
  id             uuid primary key default gen_random_uuid(),
  performance_id uuid not null references public.ad_performance_daily (id) on delete cascade,
  field_name     text not null,
  old_value      text,
  new_value      text,
  reason         text not null,
  corrected_by   uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists data_corrections_perf_idx on public.data_corrections (performance_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 알림 규칙 / 알림
-- ---------------------------------------------------------------------------
create table if not exists public.alert_rules (
  id             uuid primary key default gen_random_uuid(),
  ad_account_id  uuid references public.ad_accounts (id) on delete cascade,
  rule_type      text not null,   -- cost_no_conversion | low_roas | high_cpc | low_ctr |
                                  -- cost_spike | revenue_drop | unmapped_creative |
                                  -- sync_failed | missing_data
  threshold      numeric(18, 2),
  comparison     text default 'lt' check (comparison in ('lt', 'lte', 'gt', 'gte')),
  is_active      boolean not null default true,
  channel        text not null default 'in_app',   -- in_app | email | kakao (확장용)
  config         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.alerts (
  id             uuid primary key default gen_random_uuid(),
  rule_id        uuid references public.alert_rules (id) on delete set null,
  ad_account_id  uuid references public.ad_accounts (id) on delete cascade,
  stat_date      date,
  severity       text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title          text not null,
  body           text,
  entity_type    text,   -- product | product_group | creative | sync
  entity_id      text,
  metric_value   numeric(18, 2),
  is_read        boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists alerts_feed_idx on public.alerts (ad_account_id, is_read, created_at desc);

-- 기본 알림 규칙 (재실행 시 중복 생성 방지)
insert into public.alert_rules (rule_type, threshold, comparison)
select * from (values
  ('cost_no_conversion', 30000::numeric, 'gte'),
  ('low_roas', 200, 'lt'),
  ('high_cpc', 3000, 'gt'),
  ('low_ctr', 0.5, 'lt'),
  ('cost_spike', 50, 'gte'),
  ('revenue_drop', 50, 'gte'),
  ('unmapped_creative', null, null),
  ('sync_failed', null, null),
  ('missing_data', null, null)
) as v(rule_type, threshold, comparison)
where not exists (
  select 1 from public.alert_rules a where a.rule_type = v.rule_type
);

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'ad_accounts', 'product_groups', 'products', 'creatives',
    'creative_product_mappings', 'ad_performance_daily', 'alert_rules'
  ] loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$I
       for each row execute function public.touch_updated_at()', t);
  end loop;
end;
$$;


-- ###########################################################################
-- 2) 집계 — 뷰와 계산 함수 10개 (CTR/CPC/ROAS)
-- ###########################################################################

-- ============================================================================
-- 집계 뷰 + RPC 함수
-- 엑셀의 피벗/XLOOKUP/SUMIFS 체인을 전부 DB 집계로 대체한다.
-- 비율 지표(CTR, CPC, ROAS)는 항상 "합산 후 계산"한다. 평균의 평균 금지.
-- ============================================================================

-- 0으로 나누면 오류 대신 0을 돌려준다.
create or replace function public.safe_div(n numeric, d numeric)
returns numeric
language sql
immutable
as $$
  select case when d is null or d = 0 then 0 else n / d end;
$$;

-- ---------------------------------------------------------------------------
-- 기본 뷰: RAW + 상품/상품군 정보 + 분류 버킷
--   product     : 상품 매핑이 완료된 정상 데이터
--   other_ad    : 파워링크 / 브랜드 검색 / 쇼핑 브랜드형 등 제외 광고 유형
--   unmapped    : 소재는 있으나 상품 매핑이 없는 데이터 (상품번호 0 포함)
-- ---------------------------------------------------------------------------
create or replace view public.v_ad_performance as
select
  a.id,
  a.ad_account_id,
  a.stat_date,
  a.creative_id,
  a.product_id,
  a.mall_product_id,
  a.ad_type_label,
  a.impressions,
  a.clicks,
  a.cost,
  a.avg_rank,
  a.conv_count,
  a.conv_revenue,
  a.total_conv_count,
  a.total_conv_revenue,
  a.source,
  p.smartstore_product_no,
  p.display_name,
  p.base_name,
  p.product_group_id,
  g.name as product_group_name,
  case
    when a.product_id is not null then 'product'
    when exists (
      select 1 from public.excluded_ad_types e
      where e.is_active
        and a.ad_type_label is not null
        and (
          (e.match_type = 'exact' and a.ad_type_label = e.label)
          or (e.match_type = 'contains' and a.ad_type_label ilike '%' || e.label || '%')
        )
    ) then 'other_ad'
    else 'unmapped'
  end as bucket
from public.ad_performance_daily a
left join public.products p on p.id = a.product_id
left join public.product_groups g on g.id = p.product_group_id;

-- ---------------------------------------------------------------------------
-- 기간 KPI 요약
-- ---------------------------------------------------------------------------
create or replace function public.fn_period_summary(
  p_account   uuid,
  p_from      date,
  p_to        date,
  p_group_id  uuid default null,
  p_product_id uuid default null,
  p_creative_id text default null,
  p_bucket    text default 'product'   -- 'product' | 'other_ad' | 'unmapped' | 'all'
)
returns table (
  impressions        bigint,
  clicks             bigint,
  cost               numeric,
  conv_count         bigint,
  conv_revenue       numeric,
  total_conv_count   bigint,
  total_conv_revenue numeric,
  ctr                numeric,
  cpc                numeric,
  conv_roas          numeric,
  total_roas         numeric
)
language sql
stable
as $$
  with base as (
    select
      coalesce(sum(v.impressions), 0)::bigint         as impressions,
      coalesce(sum(v.clicks), 0)::bigint              as clicks,
      coalesce(sum(v.cost), 0)::numeric               as cost,
      coalesce(sum(v.conv_count), 0)::bigint          as conv_count,
      coalesce(sum(v.conv_revenue), 0)::numeric       as conv_revenue,
      coalesce(sum(v.total_conv_count), 0)::bigint    as total_conv_count,
      coalesce(sum(v.total_conv_revenue), 0)::numeric as total_conv_revenue
    from public.v_ad_performance v
    where v.ad_account_id = p_account
      and v.stat_date between p_from and p_to
      and (p_bucket = 'all' or v.bucket = p_bucket)
      and (p_group_id is null or v.product_group_id = p_group_id)
      and (p_product_id is null or v.product_id = p_product_id)
      and (p_creative_id is null or v.creative_id = p_creative_id)
  )
  select
    b.impressions, b.clicks, b.cost, b.conv_count, b.conv_revenue,
    b.total_conv_count, b.total_conv_revenue,
    public.safe_div(b.clicks, b.impressions)          as ctr,
    public.safe_div(b.cost, b.clicks)                 as cpc,
    public.safe_div(b.conv_revenue, b.cost)           as conv_roas,
    public.safe_div(b.total_conv_revenue, b.cost)     as total_roas
  from base b;
$$;

-- ---------------------------------------------------------------------------
-- 일별 추이
-- ---------------------------------------------------------------------------
create or replace function public.fn_daily_series(
  p_account    uuid,
  p_from       date,
  p_to         date,
  p_group_id   uuid default null,
  p_product_id uuid default null,
  p_bucket     text default 'product'
)
returns table (
  stat_date          date,
  impressions        bigint,
  clicks             bigint,
  cost               numeric,
  conv_count         bigint,
  conv_revenue       numeric,
  total_conv_count   bigint,
  total_conv_revenue numeric,
  ctr                numeric,
  cpc                numeric,
  conv_roas          numeric,
  total_roas         numeric
)
language sql
stable
as $$
  with days as (
    select d::date as stat_date
    from generate_series(p_from, p_to, interval '1 day') d
  ),
  agg as (
    select
      v.stat_date,
      sum(v.impressions)::bigint         as impressions,
      sum(v.clicks)::bigint              as clicks,
      sum(v.cost)::numeric               as cost,
      sum(v.conv_count)::bigint          as conv_count,
      sum(v.conv_revenue)::numeric       as conv_revenue,
      sum(v.total_conv_count)::bigint    as total_conv_count,
      sum(v.total_conv_revenue)::numeric as total_conv_revenue
    from public.v_ad_performance v
    where v.ad_account_id = p_account
      and v.stat_date between p_from and p_to
      and (p_bucket = 'all' or v.bucket = p_bucket)
      and (p_group_id is null or v.product_group_id = p_group_id)
      and (p_product_id is null or v.product_id = p_product_id)
    group by v.stat_date
  )
  select
    d.stat_date,
    coalesce(a.impressions, 0), coalesce(a.clicks, 0), coalesce(a.cost, 0),
    coalesce(a.conv_count, 0), coalesce(a.conv_revenue, 0),
    coalesce(a.total_conv_count, 0), coalesce(a.total_conv_revenue, 0),
    public.safe_div(coalesce(a.clicks, 0), coalesce(a.impressions, 0)),
    public.safe_div(coalesce(a.cost, 0), coalesce(a.clicks, 0)),
    public.safe_div(coalesce(a.conv_revenue, 0), coalesce(a.cost, 0)),
    public.safe_div(coalesce(a.total_conv_revenue, 0), coalesce(a.cost, 0))
  from days d
  left join agg a on a.stat_date = d.stat_date
  order by d.stat_date;
$$;

-- ---------------------------------------------------------------------------
-- 상품별 집계 (엑셀 '상품별 데이터' 시트 대체)
-- ---------------------------------------------------------------------------
create or replace function public.fn_product_stats(
  p_account   uuid,
  p_from      date,
  p_to        date,
  p_group_id  uuid default null,
  p_search    text default null,
  p_bucket    text default 'product'
)
returns table (
  product_id            uuid,
  mall_product_id       text,
  smartstore_product_no text,
  display_name          text,
  base_name             text,
  product_group_id      uuid,
  product_group_name    text,
  impressions           bigint,
  clicks                bigint,
  ctr                   numeric,
  cpc                   numeric,
  cost                  numeric,
  conv_count            bigint,
  conv_revenue          numeric,
  conv_roas             numeric,
  total_conv_count      bigint,
  total_conv_revenue    numeric,
  total_roas            numeric,
  creative_count        bigint
)
language sql
stable
as $$
  with agg as (
    select
      v.product_id,
      max(v.mall_product_id)             as mall_product_id,
      max(v.smartstore_product_no)       as smartstore_product_no,
      max(v.display_name)                as display_name,
      max(v.base_name)                   as base_name,
      -- uuid 에는 max() 집계가 없어 text 로 변환 후 다시 uuid 로.
      -- product_id 로 묶여 있어 그룹 내 값은 어차피 동일하다.
      max(v.product_group_id::text)::uuid as product_group_id,
      max(v.product_group_name)          as product_group_name,
      max(v.ad_type_label)               as ad_type_label,
      sum(v.impressions)::bigint         as impressions,
      sum(v.clicks)::bigint              as clicks,
      sum(v.cost)::numeric               as cost,
      sum(v.conv_count)::bigint          as conv_count,
      sum(v.conv_revenue)::numeric       as conv_revenue,
      sum(v.total_conv_count)::bigint    as total_conv_count,
      sum(v.total_conv_revenue)::numeric as total_conv_revenue,
      count(distinct v.creative_id)::bigint as creative_count
    from public.v_ad_performance v
    where v.ad_account_id = p_account
      and v.stat_date between p_from and p_to
      and (p_bucket = 'all' or v.bucket = p_bucket)
      and (p_group_id is null or v.product_group_id = p_group_id)
    group by v.product_id, coalesce(v.ad_type_label, '')
  )
  select
    a.product_id,
    a.mall_product_id,
    a.smartstore_product_no,
    coalesce(a.display_name, a.ad_type_label, '(미매핑)') as display_name,
    coalesce(a.base_name, a.ad_type_label, '(미매핑)')    as base_name,
    a.product_group_id,
    coalesce(a.product_group_name, '(미분류)')            as product_group_name,
    a.impressions,
    a.clicks,
    public.safe_div(a.clicks, a.impressions)      as ctr,
    public.safe_div(a.cost, a.clicks)             as cpc,
    a.cost,
    a.conv_count,
    a.conv_revenue,
    public.safe_div(a.conv_revenue, a.cost)       as conv_roas,
    a.total_conv_count,
    a.total_conv_revenue,
    public.safe_div(a.total_conv_revenue, a.cost) as total_roas,
    a.creative_count
  from agg a
  where p_search is null
     or coalesce(a.display_name, '') ilike '%' || p_search || '%'
     or coalesce(a.base_name, '')    ilike '%' || p_search || '%'
     or coalesce(a.mall_product_id, '') ilike '%' || p_search || '%'
     or coalesce(a.smartstore_product_no, '') ilike '%' || p_search || '%'
  order by a.cost desc;
$$;

-- ---------------------------------------------------------------------------
-- 상품군별 집계 (엑셀 '상품군별 데이터' 시트 대체)
-- 상품별 비율의 평균이 아니라 원본 합계로 다시 계산한다.
-- ---------------------------------------------------------------------------
create or replace function public.fn_group_stats(
  p_account uuid,
  p_from    date,
  p_to      date,
  p_search  text default null
)
returns table (
  product_group_id   uuid,
  product_group_name text,
  impressions        bigint,
  clicks             bigint,
  ctr                numeric,
  cpc                numeric,
  cost               numeric,
  conv_count         bigint,
  conv_revenue       numeric,
  conv_roas          numeric,
  total_conv_count   bigint,
  total_conv_revenue numeric,
  total_roas         numeric,
  product_count      bigint
)
language sql
stable
as $$
  with agg as (
    select
      v.product_group_id,
      coalesce(v.product_group_name, '(미분류)') as product_group_name,
      sum(v.impressions)::bigint         as impressions,
      sum(v.clicks)::bigint              as clicks,
      sum(v.cost)::numeric               as cost,
      sum(v.conv_count)::bigint          as conv_count,
      sum(v.conv_revenue)::numeric       as conv_revenue,
      sum(v.total_conv_count)::bigint    as total_conv_count,
      sum(v.total_conv_revenue)::numeric as total_conv_revenue,
      count(distinct v.product_id)::bigint as product_count
    from public.v_ad_performance v
    where v.ad_account_id = p_account
      and v.stat_date between p_from and p_to
      and v.bucket = 'product'
    group by v.product_group_id, coalesce(v.product_group_name, '(미분류)')
  )
  select
    a.product_group_id,
    a.product_group_name,
    a.impressions,
    a.clicks,
    public.safe_div(a.clicks, a.impressions)      as ctr,
    public.safe_div(a.cost, a.clicks)             as cpc,
    a.cost,
    a.conv_count,
    a.conv_revenue,
    public.safe_div(a.conv_revenue, a.cost)       as conv_roas,
    a.total_conv_count,
    a.total_conv_revenue,
    public.safe_div(a.total_conv_revenue, a.cost) as total_roas,
    a.product_count
  from agg a
  where p_search is null or a.product_group_name ilike '%' || p_search || '%'
  order by a.cost desc;
$$;

-- ---------------------------------------------------------------------------
-- 소재별 집계 (상품 상세 페이지용)
-- ---------------------------------------------------------------------------
create or replace function public.fn_creative_stats(
  p_account    uuid,
  p_from       date,
  p_to         date,
  p_product_id uuid default null
)
returns table (
  creative_id        text,
  creative_name      text,
  product_id         uuid,
  display_name       text,
  impressions        bigint,
  clicks             bigint,
  ctr                numeric,
  cpc                numeric,
  cost               numeric,
  conv_count         bigint,
  conv_revenue       numeric,
  conv_roas          numeric,
  total_conv_count   bigint,
  total_conv_revenue numeric,
  total_roas         numeric,
  avg_rank           numeric
)
language sql
stable
as $$
  with agg as (
    select
      v.creative_id,
      max(v.product_id::text)::uuid      as product_id,
      max(v.display_name)                as display_name,
      sum(v.impressions)::bigint         as impressions,
      sum(v.clicks)::bigint              as clicks,
      sum(v.cost)::numeric               as cost,
      sum(v.conv_count)::bigint          as conv_count,
      sum(v.conv_revenue)::numeric       as conv_revenue,
      sum(v.total_conv_count)::bigint    as total_conv_count,
      sum(v.total_conv_revenue)::numeric as total_conv_revenue,
      -- 평균노출순위는 노출수 가중평균으로 계산한다.
      public.safe_div(sum(v.avg_rank * v.impressions), sum(v.impressions)) as avg_rank
    from public.v_ad_performance v
    where v.ad_account_id = p_account
      and v.stat_date between p_from and p_to
      and (p_product_id is null or v.product_id = p_product_id)
    group by v.creative_id
  )
  select
    a.creative_id,
    c.creative_name,
    a.product_id,
    a.display_name,
    a.impressions,
    a.clicks,
    public.safe_div(a.clicks, a.impressions),
    public.safe_div(a.cost, a.clicks),
    a.cost,
    a.conv_count,
    a.conv_revenue,
    public.safe_div(a.conv_revenue, a.cost),
    a.total_conv_count,
    a.total_conv_revenue,
    public.safe_div(a.total_conv_revenue, a.cost),
    round(a.avg_rank, 2)
  from agg a
  left join public.creatives c
    on c.creative_id = a.creative_id and c.ad_account_id = p_account
  order by a.cost desc;
$$;

-- ---------------------------------------------------------------------------
-- 미매핑 소재 목록
-- ---------------------------------------------------------------------------
create or replace function public.fn_unmapped(
  p_account uuid,
  p_from    date,
  p_to      date
)
returns table (
  creative_id   text,
  creative_name text,
  raw_product_value text,
  first_date    date,
  last_date     date,
  impressions   bigint,
  clicks        bigint,
  cost          numeric,
  reason        text
)
language sql
stable
as $$
  select
    v.creative_id,
    c.creative_name,
    coalesce(v.mall_product_id, v.ad_type_label, '0') as raw_product_value,
    min(v.stat_date) as first_date,
    max(v.stat_date) as last_date,
    sum(v.impressions)::bigint as impressions,
    sum(v.clicks)::bigint      as clicks,
    sum(v.cost)::numeric       as cost,
    case
      when v.creative_id = '-' or v.creative_id is null then '소재 ID 없음'
      when not exists (
        select 1 from public.creative_product_mappings m
        where m.ad_account_id = p_account and m.creative_id = v.creative_id
      ) then '소재-상품 매핑 없음'
      else '상품 정보 없음'
    end as reason
  from public.v_ad_performance v
  left join public.creatives c
    on c.creative_id = v.creative_id and c.ad_account_id = p_account
  where v.ad_account_id = p_account
    and v.stat_date between p_from and p_to
    and v.bucket = 'unmapped'
  group by v.creative_id, c.creative_name,
           coalesce(v.mall_product_id, v.ad_type_label, '0'), v.mall_product_id, v.ad_type_label
  order by sum(v.cost) desc, sum(v.impressions) desc;
$$;

-- ---------------------------------------------------------------------------
-- 저성과 진단: 광고비는 썼는데 구매완료 전환이 0인 상품
-- ---------------------------------------------------------------------------
create or replace function public.fn_zero_conversion_products(
  p_account  uuid,
  p_from     date,
  p_to       date,
  p_min_cost numeric default 0
)
returns table (
  product_id   uuid,
  display_name text,
  product_group_name text,
  impressions  bigint,
  clicks       bigint,
  cost         numeric,
  total_conv_count bigint
)
language sql
stable
as $$
  select
    v.product_id,
    max(v.display_name),
    coalesce(max(v.product_group_name), '(미분류)'),
    sum(v.impressions)::bigint,
    sum(v.clicks)::bigint,
    sum(v.cost)::numeric,
    sum(v.total_conv_count)::bigint
  from public.v_ad_performance v
  where v.ad_account_id = p_account
    and v.stat_date between p_from and p_to
    and v.bucket = 'product'
  group by v.product_id
  having sum(v.conv_count) = 0 and sum(v.cost) >= p_min_cost and sum(v.cost) > 0
  order by sum(v.cost) desc;
$$;

-- ---------------------------------------------------------------------------
-- 매핑 저장 후 기존 RAW 데이터에 소급 적용
-- ---------------------------------------------------------------------------
create or replace function public.fn_backfill_mapping(
  p_account     uuid,
  p_creative_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_count integer;
begin
  select m.product_id into v_product_id
  from public.creative_product_mappings m
  where m.ad_account_id = p_account and m.creative_id = p_creative_id and m.is_active;

  if v_product_id is null then
    return 0;
  end if;

  update public.ad_performance_daily a
  set product_id = v_product_id,
      mall_product_id = coalesce(a.mall_product_id, p.mall_product_id)
  from public.products p
  where p.id = v_product_id
    and a.ad_account_id = p_account
    and a.creative_id = p_creative_id
    and a.product_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 매핑이 생기거나 바뀌면 자동으로 소급 적용한다.
create or replace function public.trg_backfill_mapping()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_backfill_mapping(new.ad_account_id, new.creative_id);
  return new;
end;
$$;

drop trigger if exists backfill_after_mapping on public.creative_product_mappings;
create trigger backfill_after_mapping
  after insert or update on public.creative_product_mappings
  for each row execute function public.trg_backfill_mapping();


-- ###########################################################################
-- 3) 보안 — RLS 정책 (관리자/조회자 권한)
-- ###########################################################################

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


-- ###########################################################################
-- 4) 알림 — 성과 자동 검사 함수
-- ###########################################################################

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


commit;

-- ============================================================================
-- 설치 완료. 다음: 2_seed_from_excel.sql 을 실행해 엑셀 데이터를 넣으세요.
-- ============================================================================
