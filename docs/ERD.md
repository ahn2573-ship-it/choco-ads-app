# ERD 및 데이터 흐름

## 1. 데이터 흐름도

```
┌──────────────────┐
│  광고 API        │  네이버 검색광고 (또는 Mock)
└────────┬─────────┘
         │  ① 매일 KST 09:00 (= UTC 00:00)
         │     pg_cron → pg_net → Edge Function
         ▼
┌──────────────────────────────────────────────┐
│  Edge Function: sync-ads (Deno)              │
│  ─ API Key/Secret 은 여기에만 존재            │
│  ─ Adapter 교체 가능 (mock / naver_searchad) │
│  ─ 실패 시 최대 3회 재시도                    │
│                                              │
│  fetchDaily()                                │
│    → mapRow()      필드명 정규화             │
│    → dedupeRows()  응답 내 중복 합산          │
│    → 소재 upsert                             │
│    → 매핑 조회 (소재→상품, 상품ID→상품)       │
│    → upsert (dedupe_key 유니크)              │
│    → sync_logs 기록                          │
│    → fn_scan_alerts()                        │
└────────┬─────────────────────────────────────┘
         │  ②
         ▼
┌──────────────────────────────────────────────┐
│  Postgres (Supabase)                         │
│                                              │
│  ad_performance_daily   ← RAW, 삭제 없이 누적 │
│         │                                    │
│         ├─ v_ad_performance (뷰)             │
│         │     bucket = product / other_ad /  │
│         │              unmapped              │
│         │                                    │
│         ├─ fn_period_summary()   KPI         │
│         ├─ fn_daily_series()     추이        │
│         ├─ fn_product_stats()    상품별      │
│         ├─ fn_group_stats()      상품군별    │
│         ├─ fn_creative_stats()   소재별      │
│         ├─ fn_unmapped()         미매핑      │
│         └─ fn_zero_conversion_products()     │
└────────┬─────────────────────────────────────┘
         │  ③ RPC (anon key + RLS)
         ▼
┌──────────────────────────────────────────────┐
│  React SPA (GitHub Pages, 정적)              │
│  대시보드 · 상품별 · 상품군별 · RAW ·          │
│  미매핑 · 매핑관리 · 알림 · 수집이력 · 설정    │
│                                              │
│  SheetJS → 엑셀 다운로드 / 업로드             │
└──────────────────────────────────────────────┘
```

**RAW 와 가공 데이터의 경계**: `ad_performance_daily` 만 원본이고,
상품별·상품군별 수치는 어디에도 저장하지 않습니다. 조회 시점에 함수가 계산합니다.
그래서 매핑을 고치면 과거 집계 결과가 자동으로 따라옵니다.

## 2. ERD

```
                        ┌───────────────────┐
                        │   ad_accounts     │
                        │───────────────────│
                        │ id (PK)           │
                        │ name              │
                        │ platform          │
                        │ customer_id       │
                        │ timezone          │
                        └─────────┬─────────┘
                                  │ 1
            ┌─────────────────────┼─────────────────────┐
            │ N                   │ N                   │ N
┌───────────▼──────────┐ ┌────────▼─────────┐ ┌─────────▼────────┐
│     creatives        │ │   sync_logs      │ │     alerts       │
│──────────────────────│ │──────────────────│ │──────────────────│
│ id (PK)              │ │ id (PK)          │ │ id (PK)          │
│ ad_account_id (FK)   │ │ ad_account_id FK │ │ ad_account_id FK │
│ creative_id          │ │ stat_date        │ │ rule_id (FK)     │
│ creative_name        │ │ status           │ │ severity         │
│ first/last_seen_at   │ │ rows_fetched     │ │ title / body     │
│ UNIQUE(account,      │ │ rows_upserted    │ │ entity_type/id   │
│        creative_id)  │ │ attempt, message │ │ is_read          │
└───────────┬──────────┘ └──────────────────┘ └─────────┬────────┘
            │                                            │ N
            │                                  ┌─────────▼────────┐
            │                                  │   alert_rules    │
            │                                  │──────────────────│
            │                                  │ id (PK)          │
            │                                  │ rule_type        │
            │                                  │ threshold        │
            │                                  │ channel          │
            │                                  └──────────────────┘
            │
┌───────────▼───────────────────┐
│ creative_product_mappings     │
│───────────────────────────────│         ┌────────────────────┐
│ id (PK)                       │         │  product_groups    │
│ ad_account_id (FK)            │         │────────────────────│
│ creative_id                   │         │ id (PK)            │
│ product_id (FK) ──────────┐   │         │ name (UNIQUE)      │
│ is_active, note           │   │         │ is_active          │
│ UNIQUE(account,creative)  │   │         └─────────┬──────────┘
└───────────────────────────┼───┘                   │ 1
                            │ N                     │
                  ┌─────────▼─────────────┐         │
                  │      products         │◄────────┘
                  │───────────────────────│    N
                  │ id (PK)               │
                  │ mall_product_id UNIQUE│  ← 쇼핑몰 상품ID
                  │ smartstore_product_no │  ← 스마트스토어 상품번호 (별도)
                  │ display_name          │  ← 노출용 상품명
                  │ base_name             │  ← 기본 상품명
                  │ product_group_id (FK) │
                  │ is_active             │
                  └─────────┬─────────────┘
                            │ 1
                            │ N
      ┌─────────────────────▼──────────────────────┐
      │        ad_performance_daily                │
      │────────────────────────────────────────────│
      │ id (PK)                                    │
      │ ad_account_id (FK)                         │
      │ stat_date            ← Asia/Seoul 기준 date │
      │ creative_id                                │
      │ product_id (FK, nullable)                  │
      │ mall_product_id                            │
      │ ad_type_label        ← 파워링크 등          │
      │ impressions, clicks, cost, avg_rank        │
      │ conv_count, conv_revenue                   │
      │ total_conv_count, total_conv_revenue       │
      │ source (api|excel_import|manual)           │
      │ raw (jsonb)                                │
      │ dedupe_key  ← GENERATED                    │
      │   coalesce(mall_product_id,                │
      │            ad_type_label, '-')             │
      │                                            │
      │ UNIQUE(ad_account_id, stat_date,           │
      │        creative_id, dedupe_key)            │
      └─────────┬──────────────────────────────────┘
                │ 1
                │ N
      ┌─────────▼──────────────┐
      │   data_corrections     │
      │────────────────────────│
      │ id (PK)                │
      │ performance_id (FK)    │
      │ field_name             │
      │ old_value / new_value  │
      │ reason                 │
      │ corrected_by (FK)      │
      │ created_at             │
      └────────────────────────┘

  보조 테이블
  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
  │ product_group_rules  │  │  excluded_ad_types   │  │    profiles      │
  │──────────────────────│  │──────────────────────│  │──────────────────│
  │ base_name (UNIQUE)   │  │ label (UNIQUE)       │  │ id (FK auth.users│
  │ group_id (FK)        │  │ match_type           │  │ role: admin|viewer│
  └──────────────────────┘  │ is_active            │  └──────────────────┘
                            └──────────────────────┘
```

## 3. 인덱스 전략

RAW 데이터는 하루 200~400행씩 무기한 누적되므로, 1년이면 약 10만 행, 5년이면 50만 행입니다.

| 인덱스 | 대상 쿼리 |
|---|---|
| `ad_perf_dedupe_uidx` (UNIQUE) | upsert 충돌 판정, 중복 수집 방지 |
| `ad_perf_date_idx (계정, 날짜)` | 기간 조회 — 거의 모든 화면의 진입점 |
| `ad_perf_product_idx (상품, 날짜)` | 상품 상세 페이지 |
| `ad_perf_creative_idx (계정, 소재, 날짜)` | 소재별 성과 |
| `ad_perf_unmapped_idx` (부분 인덱스, `product_id is null`) | 미매핑 목록 — 전체의 2% 미만이라 부분 인덱스가 효율적 |

## 4. 예외 상황 처리 위치

| 예외 | 처리 |
|---|---|
| API 중복 수집 | `dedupe_key` 유니크 + upsert / `dedupeRows()` |
| 소재 ID 없음 | `creativeId = '-'` 로 채우고 미매핑 처리 |
| 소재↔상품 매핑 없음 | `bucket='unmapped'`, 미매핑 화면에 노출 |
| 상품명↔상품군 매핑 없음 | `product_group_name = '(미분류)'` |
| 상품 ID 숫자/문자 혼용 | `isNumericProductId()` 로 text 통일 후 판정 |
| 광고비·클릭 0 | `safe_div()` → 0 반환 |
| 상품 하나에 소재 여럿 | 정상. `creative_count` 로 표시 |
| 소재 하나가 상품 여럿 | `UNIQUE(account, creative_id)` 로 구조적 차단 |
| 일부 페이지만 수집 | `sync_logs.status='partial'` + 알림 |
| KST/UTC 혼재 | `normalizeDate()` 가 Asia/Seoul 로 통일 |
| 재수집으로 값 변경 | upsert 갱신, `sync_logs` 에 이력 |
| 상품명 변경, ID 동일 | `mall_product_id` 가 키. 이름은 갱신만 |
