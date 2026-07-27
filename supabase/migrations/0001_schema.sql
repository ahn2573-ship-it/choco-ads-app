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
