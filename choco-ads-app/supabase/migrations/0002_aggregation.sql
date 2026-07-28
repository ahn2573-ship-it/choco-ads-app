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
