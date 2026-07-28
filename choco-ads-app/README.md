# 초코펫하우스 광고 데이터 자동화

엑셀 `초코펫하우스_데일리보고서.xlsx` 로 하던 일별 광고 데이터 정리를 웹 서비스로 옮긴 것입니다.
API 수집 → 상품 매핑 → 집계 → 대시보드 → 엑셀 내보내기까지 전 과정을 자동화합니다.

- **호스팅**: GitHub Pages (정적 SPA)
- **데이터베이스 / 인증 / 서버 로직**: Supabase (Postgres · Auth · Edge Functions · pg_cron)

---

## 1. 명세 대비 스택 변경 사항과 이유

원 명세는 Next.js + Vercel 이었지만 배포 대상이 GitHub Pages 로 정해져 변경했습니다.
**GitHub Pages 는 정적 파일만 서빙하므로 Server Actions 나 API Route 가 실행되지 않습니다.**

| 명세 | 실제 구현 | 이유 |
|---|---|---|
| Next.js + Vercel | **Vite + React SPA → GitHub Pages** | 서버 런타임 없이 정적 빌드만 배포 가능 |
| Server Actions / API Route | **Supabase Edge Function (Deno)** | API Key·Secret 을 서버에만 두려면 실행 환경이 필요 |
| Prisma / Drizzle | **SQL 마이그레이션 + Postgres 함수** | 서버 런타임이 없어 ORM 계층이 놓일 자리가 없음. 집계는 DB 안에서 |
| Vercel Cron | **pg_cron + pg_net** | Supabase 내부 스케줄러로 Edge Function 호출 |
| React Router | **HashRouter** | Pages 는 SPA fallback 을 지원하지 않아 `/products/123` 새로고침 시 404 |

바뀌지 않은 원칙: 모든 집계는 서버(Postgres)에서 수행하고, 프런트엔드는 계산하지 않습니다.
API Secret 은 브라우저 번들에 절대 포함되지 않습니다.

---

## 2. 빠른 시작

### 2.1 사전 준비

- Node.js 20 이상
- Supabase 프로젝트 ([supabase.com](https://supabase.com) 무료 플랜으로 충분)
- Supabase CLI (`npm i -g supabase`) — Edge Function 배포에 필요

### 2.2 설치

```bash
git clone <저장소 주소>
cd choco-ads-dashboard
npm install
cp .env.example .env
```

### 2.3 데이터베이스 구축

Supabase 대시보드 → SQL Editor 에서 **순서대로** 실행합니다.

```
supabase/migrations/0001_schema.sql       테이블·인덱스·트리거
supabase/migrations/0002_aggregation.sql  뷰·집계 함수
supabase/migrations/0003_rls.sql          RLS 정책
supabase/migrations/0004_alerts.sql       알림 스캔 함수
supabase/seed/0001_seed_from_excel.sql    첨부 엑셀 초기 데이터
```

`0005_cron.sql` 은 자동 수집 스케줄용이며, 프로젝트 레퍼런스와 service_role 키를
채워 넣은 뒤 실행합니다. 수동 수집만 쓸 거라면 건너뛰어도 됩니다.

시드에는 첨부 엑셀에서 뽑은 상품 180개, 소재 606개, 매핑 499건,
상품군 164개, RAW 410행이 들어 있습니다.

### 2.4 관리자 계정 만들기

Supabase → Authentication → Users → **Add user** 로 계정을 만든 뒤,
SQL Editor 에서 권한을 올립니다.

```sql
update public.profiles set role = 'admin' where email = '본인이메일@example.com';
```

이후 가입하는 사용자는 자동으로 `viewer` 가 됩니다.

### 2.5 환경 변수

`.env` 에 프런트엔드 값을 넣습니다. Settings → API 에서 확인할 수 있습니다.

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

`anon key` 는 공개돼도 되는 값입니다. RLS 가 접근을 통제합니다.
**`service_role` 키는 절대 `.env` 나 프런트엔드에 넣지 마세요.**

### 2.6 실행

```bash
npm run dev     # http://localhost:5173
npm test        # 집계·매핑·중복수집·날짜 계산 테스트
npm run build   # dist/ 생성
```

---

## 3. Edge Function 배포 (데이터 수집)

```bash
supabase login
supabase link --project-ref <프로젝트 레퍼런스>

# API 정보는 시크릿으로만 관리한다
supabase secrets set AD_API_MODE=mock
# 실제 API 를 붙일 때:
# supabase secrets set AD_API_MODE=live \
#   AD_API_BASE_URL=https://api.searchad.naver.com \
#   AD_API_KEY=... AD_API_SECRET=... AD_API_CUSTOMER_ID=...

supabase functions deploy sync-ads
```

`AD_API_MODE=mock` 이면 가짜 데이터로 전체 파이프라인이 돌아갑니다.
매핑된 소재 5개와 **일부러 매핑이 없는 신규 소재 1개**, 광고 유형 3종을 만들어
미매핑 처리 흐름까지 확인할 수 있습니다.

API 스펙이 확정되면 `supabase/functions/sync-ads/adapters.ts` 의
`NaverSearchAdAdapter` 와 `mapper.ts` 의 `FIELD_ALIASES` 만 고치면 됩니다.
나머지 코드는 손댈 필요가 없습니다.

---

## 4. GitHub Pages 배포

1. 저장소 → Settings → Pages → Source 를 **GitHub Actions** 로 변경
2. Settings → Secrets and variables → Actions 에 등록
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - (선택) `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` — Edge Function 자동 배포용
3. `main` 브랜치에 push

`.github/workflows/deploy.yml` 이 테스트 → 빌드 → 배포를 수행합니다.
`base` 경로는 저장소 이름에서 자동으로 잡히므로 이름을 바꿔도 그대로 동작합니다.

Supabase → Authentication → URL Configuration 에
`https://<사용자명>.github.io/<저장소명>/` 을 Site URL 로 추가하세요.

---

## 5. 매일 하는 일

자동 수집을 켜 두면 손댈 게 없지만, 흐름은 이렇습니다.

1. **09:00 (KST)** — pg_cron 이 전일 데이터를 수집. 실패하면 3회 재시도 후 알림 생성
2. **대시보드** — KPI 카드에 전일·전주·전월 대비 증감이 표시됨
3. **미매핑 소재** — 새 소재가 들어왔는데 상품 연결이 없으면 여기 쌓임.
   `매핑 처리` 버튼으로 상품을 연결하면 **과거 데이터까지 소급 적용**됨
4. **알림 센터** — 광고비를 썼는데 전환이 없는 상품, ROAS 미달 상품 등

수동으로 다시 받아야 하면 **수집 이력** 화면에서 날짜를 골라 재수집합니다.
같은 날짜를 몇 번 눌러도 행이 중복되지 않습니다.

---

## 6. 폴더 구조

```
.
├── .github/workflows/
│   ├── deploy.yml               테스트 → 빌드 → Pages 배포
│   └── deploy-functions.yml     Edge Function 배포
├── docs/
│   ├── EXCEL_ANALYSIS.md        엑셀 수식 체인 분석, 발견한 문제점
│   └── ERD.md                   ERD, 데이터 흐름도, 인덱스 전략
├── scripts/
│   └── build_seed.py            엑셀 → 시드 SQL 변환기
├── supabase/
│   ├── migrations/              0001~0005
│   ├── seed/                    엑셀에서 생성된 초기 데이터
│   └── functions/sync-ads/
│       ├── index.ts             수집 · upsert · 로깅 · 알림
│       ├── adapters.ts          Mock / 네이버 검색광고 어댑터
│       ├── mapper.ts            필드 정규화 · 중복 제거 · 날짜 변환
│       └── types.ts             어댑터 인터페이스
├── src/
│   ├── lib/
│   │   ├── metrics.ts           CTR/CPC/ROAS, 합산 후 재계산, 증감 방향
│   │   ├── dateRange.ts         Asia/Seoul 기간 프리셋, 비교 기간
│   │   ├── format.ts            천 단위·원·퍼센트 표기
│   │   ├── excel.ts             SheetJS 내보내기/가져오기
│   │   ├── supabase.ts          클라이언트 + 데이터 접근 계층
│   │   └── types.ts
│   ├── hooks/                   useAuth, useAppState
│   ├── components/
│   │   ├── ui/                  Button, Card, Modal, Skeleton, EmptyState 등
│   │   ├── layout/              AppShell, PeriodFilter
│   │   ├── charts/              Recharts 래퍼
│   │   ├── KpiStrip.tsx         KPI 카드 + 스파크라인
│   │   └── DataTable.tsx        정렬·컬럼 표시·페이지네이션
│   └── pages/                   12개 화면
└── tests/                       metrics · mapping · dateRange · excel
```

---

## 7. 집계 규칙

```
CTR              = 클릭수 ÷ 노출수
CPC              = 총비용 ÷ 클릭수
구매완료 ROAS    = 구매완료 전환매출액 ÷ 총비용
총 전환 ROAS     = 총 전환매출액 ÷ 총비용
```

**분모가 0이면 오류 대신 0** 을 돌려줍니다 (`safe_div`).

**상품군 지표는 상품별 비율의 평균이 아닙니다.** 반드시 합산된 원본으로 다시 계산합니다.

```
상품군 CTR = 상품군 전체 클릭수 ÷ 상품군 전체 노출수
```

평균을 내면 노출 100회에 클릭 50회인 상품 하나가 노출 10만 회짜리 상품과
같은 무게로 들어가 CTR 이 크게 부풀려집니다. 테스트로 고정해 두었습니다.

### 광고 유형 분류

| 분류 | 조건 | 기본 노출 |
|---|---|---|
| `product` | 상품 매핑 완료 | 기본값 |
| `other_ad` | 파워링크 · 브랜드 검색 · 쇼핑 브랜드형 등 | 필터로 전환 |
| `unmapped` | 상품번호 0, 매핑 실패 | 미매핑 화면 |

제외 항목은 **삭제하지 않고 분리**합니다. 설정 화면에서 추가·해제할 수 있습니다.

---

## 8. 권한

| 기능 | 관리자 | 조회 사용자 |
|---|:---:|:---:|
| 대시보드 · 상품별 · 상품군별 조회 | ● | ● |
| RAW 데이터 조회 | ● | ● |
| 미매핑 목록 조회 | ● | ● |
| 엑셀 다운로드 | ● | ● |
| 알림 확인 | ● | ● |
| 데이터 수집 실행 | ● | |
| 소재 매핑 추가·수정·삭제 | ● | |
| 데이터 보정 | ● | |
| 알림 규칙 · 제외 항목 설정 | ● | |

DB 레벨의 RLS 로 강제되므로, 프런트엔드를 우회해도 조회 사용자는 쓰기가 불가능합니다.

---

## 9. 엑셀 내보내기 / 가져오기

**내보내기** — 대시보드의 `전체 보고서` 버튼이 원본과 비슷한 시트 구성의 XLSX 하나를 만듭니다.

```
대시보드 요약 · 일별 추이 · 상품군별 데이터 · 상품별 데이터 · result2 · 미매핑 소재
```

화면별로 개별 다운로드도 가능합니다. **엑셀 안에 수식은 넣지 않고 계산된 최종 값만 기록합니다.**

**가져오기**

- 설정 → `result2 엑셀 올리기`: 기존 데일리보고서의 result2 시트를 그대로 올리면 RAW 로 들어갑니다
- 매핑 관리 → `엑셀 일괄 업로드`: 소재↔상품 매핑을 한 번에 등록합니다.
  다운로드 양식과 헤더가 같으므로, 받아서 고친 뒤 다시 올리면 됩니다

두 경우 모두 같은 날짜·같은 소재를 다시 올려도 중복되지 않습니다.

---

## 10. 테스트

```bash
npm test
```

| 파일 | 검증 내용 |
|---|---|
| `metrics.test.ts` | CTR/CPC/ROAS, 0으로 나누기, 합산 후 재계산, 지표별 증감 방향 |
| `mapping.test.ts` | 숫자/문자 상품 ID 판별, 한글·영문 헤더 매핑, KST/UTC 날짜, 중복 수집 |
| `dateRange.test.ts` | 기간 프리셋, 비교 기간, 월말·윤년 경계 |
| `excel.test.ts` | result2 헤더 일치, 수식 대신 값 기록, CPC 반올림 |

ROAS 테스트는 첨부 엑셀 `상품별 데이터` 첫 행의 실제 값(3.8572)을 그대로 씁니다.

---

## 11. 시드 데이터 다시 만들기

엑셀이 갱신되면 시드를 다시 생성할 수 있습니다.

```bash
python3 scripts/build_seed.py 초코펫하우스_데일리보고서_260724.xlsx \
  supabase/seed/0001_seed_from_excel.sql
```

---

## 12. 다음 단계로 열어둔 것

- **알림 채널**: `alert_rules.channel` 이 `in_app` 외에 `email` · `kakao` 를 받도록 되어 있습니다.
  `alerts` 테이블을 읽는 워커만 붙이면 됩니다.
- **멀티 계정**: 모든 테이블에 `ad_account_id` 가 있고 계정이 2개 이상이면
  상단에 선택기가 나타납니다. 다른 업체를 추가해도 구조 변경이 필요 없습니다.
- **상품군 자동 분류**: `product_group_rules` 에 기본 상품명↔상품군 규칙 473건이 들어 있어,
  신규 상품이 기존 상품명 규칙에 걸리면 상품군이 자동 배정됩니다.
