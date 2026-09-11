import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Upload } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { api, supabase } from "@/lib/supabase";
import { parseResult2File } from "@/lib/excel";
import { parseGfaFile, classifyGfa, gfaLabelOf } from "@/lib/gfa";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardHeader, ErrorState, Input, Select, TableSkeleton } from "@/components/ui";

const RULE_LABELS: Record<string, { label: string; unit: string; hint: string }> = {
  cost_no_conversion: { label: "광고비 소진, 구매완료 전환 0", unit: "원 이상", hint: "이 금액 이상 쓴 상품 중 구매완료가 없는 경우" },
  low_roas: { label: "ROAS 목표 미달", unit: "% 미만", hint: "구매완료 ROAS 기준" },
  high_cpc: { label: "CPC 상승", unit: "원 초과", hint: "클릭당 비용 기준" },
  low_ctr: { label: "CTR 저조", unit: "% 미만", hint: "노출 100회 이상인 상품만 대상" },
  cost_spike: { label: "전일 대비 광고비 급증", unit: "% 이상", hint: "전일 광고비 대비 증가율" },
  revenue_drop: { label: "전일 대비 매출 급감", unit: "% 이상", hint: "전일 매출 대비 감소율" },
  unmapped_creative: { label: "신규 소재 매핑 없음", unit: "", hint: "임계값 없이 항상 검사" },
  sync_failed: { label: "데이터 수집 실패", unit: "", hint: "임계값 없이 항상 검사" },
  missing_data: { label: "전일 데이터 없음", unit: "", hint: "임계값 없이 항상 검사" },
};

export function Settings() {
  const { accountId } = useAppState();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newMatch, setNewMatch] = useState("contains");

  // 네이버 GFA -----------------------------------------------------------
  const gfaFileRef = useRef<HTMLInputElement>(null);
  const [gfaImporting, setGfaImporting] = useState(false);
  const [gfaMessage, setGfaMessage] = useState<string | null>(null);
  const [newKw, setNewKw] = useState("");
  const [newKwGroup, setNewKwGroup] = useState("");

  const rules = useQuery({ queryKey: ["alert-rules"], queryFn: api.alertRules });
  const excluded = useQuery({ queryKey: ["excluded"], queryFn: api.excludedAdTypes });
  const groupOptions = useQuery({ queryKey: ["groups-for-gfa"], queryFn: api.listGroups });
  const gfaRules = useQuery({
    queryKey: ["gfa-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gfa_group_rules")
        .select("id, keyword, priority, is_active, group_id, product_groups(name)")
        .order("priority").order("keyword");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  async function saveRule(id: string, patch: { threshold?: number | null; is_active?: boolean }) {
    await api.saveAlertRule({ id, ...patch });
    qc.invalidateQueries({ queryKey: ["alert-rules"] });
  }

  async function addExcluded() {
    if (!newLabel.trim()) return;
    await api.saveExcludedAdType({ label: newLabel.trim(), match_type: newMatch, is_active: true });
    setNewLabel("");
    qc.invalidateQueries({ queryKey: ["excluded"] });
  }

  // -------------------------------------------------------------------------
  // result2 엑셀을 초기 데이터로 가져오기
  // -------------------------------------------------------------------------
  async function importResult2(file: File) {
    if (!accountId) return;
    setImporting(true);
    setMessage(null);
    try {
      const { rows, errors } = await parseResult2File(file);
      if (!rows.length) {
        setMessage("읽을 수 있는 행이 없습니다. result2 시트 헤더를 확인하세요.");
        return;
      }

      // 소재 등록
      const creativeIds = [...new Set(rows.map((r) => r.creative_id))].filter((c) => c !== "-");
      await supabase.from("creatives").upsert(
        creativeIds.map((creative_id) => ({ ad_account_id: accountId, creative_id })),
        { onConflict: "ad_account_id,creative_id", ignoreDuplicates: true },
      );

      // 기존 매핑으로 상품 연결
      const { data: mappings } = await supabase
        .from("creative_product_mappings")
        .select("creative_id, product_id, products(mall_product_id)")
        .eq("ad_account_id", accountId);
      const byCreative = new Map(
        (mappings ?? []).map((m) => [m.creative_id, {
          productId: m.product_id,
          // deno-lint-ignore no-explicit-any
          mallId: (m as any).products?.mall_product_id ?? null,
        }]),
      );

      const isNumeric = (v: string) => /^\d+$/.test(v) && v !== "0";
      const mallIds = [...new Set(rows.map((r) => r.product_ref).filter(isNumeric))];
      const { data: products } = await supabase.from("products")
        .select("id, mall_product_id").in("mall_product_id", mallIds);
      const byMall = new Map((products ?? []).map((p) => [p.mall_product_id, p.id]));

      const payload = rows.map((r) => {
        const viaCreative = byCreative.get(r.creative_id);
        const numeric = isNumeric(r.product_ref);
        return {
          ad_account_id: accountId,
          stat_date: r.stat_date,
          creative_id: r.creative_id,
          product_id: viaCreative?.productId ?? (numeric ? byMall.get(r.product_ref) ?? null : null),
          mall_product_id: numeric ? r.product_ref : viaCreative?.mallId ?? null,
          ad_type_label: !numeric && r.product_ref && r.product_ref !== "0" ? r.product_ref : null,
          impressions: r.impressions,
          clicks: r.clicks,
          cost: r.cost,
          avg_rank: r.avg_rank,
          conv_count: r.conv_count,
          conv_revenue: r.conv_revenue,
          total_conv_count: r.total_conv_count,
          total_conv_revenue: r.total_conv_revenue,
          source: "excel_import",
        };
      });

      // 청크 단위 upsert — 같은 날짜를 다시 올려도 중복되지 않는다.
      let done = 0;
      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase.from("ad_performance_daily")
          .upsert(payload.slice(i, i + 500), {
            onConflict: "ad_account_id,stat_date,creative_id,dedupe_key",
          });
        if (error) throw new Error(error.message);
        done += Math.min(500, payload.length - i);
      }

      setMessage(`${done}건을 반영했습니다.` + (errors.length ? ` (${errors.length}건 건너뜀)` : ""));
      qc.invalidateQueries();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "가져오기에 실패했습니다.");
    } finally {
      setImporting(false);
    }
  }

  // -------------------------------------------------------------------------
  // 네이버 GFA RAW 가져오기 (소재이름 키워드 → 상품군 자동 분류)
  // -------------------------------------------------------------------------
  async function importGfa(file: File) {
    if (!accountId) return;
    setGfaImporting(true);
    setGfaMessage(null);
    try {
      const { rows, skipped, level } = await parseGfaFile(file);
      if (!rows.length) {
        setGfaMessage(
          "읽을 수 있는 행이 없습니다. 헤더(광고 소재 이름·ID 또는 광고 그룹 이름·ID, " +
          "그리고 기간·총비용·노출수·클릭수·구매완료 수·구매완료 전환매출액)를 확인하세요.",
        );
        return;
      }
      // 캠페인 단위 파일은 소재/그룹 이름이 없어 스텝 구분이 불가 → 안내
      const levelWarn = level === "캠페인"
        ? " ⚠ 캠페인 단위 파일이라 스텝(상품군) 구분이 어렵습니다. 소재 또는 광고그룹 단위로 내보내세요."
        : "";

      // 최신 규칙 로드 (업로드 시점 기준으로 분류)
      const { data: rulesData, error: rErr } = await supabase
        .from("gfa_group_rules")
        .select("keyword, group_id, priority, is_active")
        .eq("is_active", true);
      if (rErr) throw new Error(rErr.message);
      const groupName = new Map((groupOptions.data ?? []).map((g) => [g.id, g.name]));

      // 소재 등록(이름 포함) — 미매핑 화면·소재별 성과에서 이름이 보이도록
      const creById = new Map<string, { name: string; last: string }>();
      for (const r of rows) {
        const prev = creById.get(r.creative_id);
        if (!prev || r.stat_date > prev.last) {
          creById.set(r.creative_id, { name: r.creative_name, last: r.stat_date });
        }
      }
      await supabase.from("creatives").upsert(
        [...creById.entries()].map(([creative_id, v]) => ({
          ad_account_id: accountId, creative_id, creative_name: v.name, last_seen_at: v.last,
        })),
        { onConflict: "ad_account_id,creative_id" },
      );

      let mapped = 0, unmapped = 0;
      const unmappedNames = new Set<string>();
      const groups = groupOptions.data ?? [];
      const payload = rows.map((r) => {
        const gid = classifyGfa(r.match_text, rulesData ?? [], groups);
        if (gid) mapped++; else { unmapped++; unmappedNames.add(gfaLabelOf(r.match_text)); }
        return {
          ad_account_id: accountId,
          stat_date: r.stat_date,
          creative_id: r.creative_id,
          product_id: null,
          mall_product_id: null,
          ad_type_label: gid ? (groupName.get(gid) ?? null) : null,
          product_group_id: gid,
          campaign_type: null,
          impressions: r.impressions,
          clicks: r.clicks,
          cost: r.cost,
          avg_rank: null,
          conv_count: r.conv_count,
          conv_revenue: r.conv_revenue,
          // 총 전환수/매출 컬럼이 있으면 실제값, 없으면 구매완료로 대체 (파서에서 처리)
          total_conv_count: r.total_conv_count,
          total_conv_revenue: r.total_conv_revenue,
          cart_count: r.cart_count,
          cart_revenue: r.cart_revenue,
          media: "naver_gfa",
          source: "gfa_import",
        };
      });

      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase.from("ad_performance_daily")
          .upsert(payload.slice(i, i + 500), {
            onConflict: "ad_account_id,stat_date,creative_id,dedupe_key",
          });
        if (error) throw new Error(error.message);
      }

      const unmappedHint = unmapped
        ? ` 미매핑 상품명: ${[...unmappedNames].slice(0, 6).join(", ")}` +
          ([...unmappedNames].length > 6 ? " 등" : "") +
          ". 상품군을 만들거나 아래 규칙을 추가한 뒤 같은 파일을 다시 올리면 재분류됩니다."
        : "";
      setGfaMessage(
        `${level} 단위 파일 인식 — ${payload.length}건 반영 (상품군 매칭 ${mapped}건 · 미매핑 ${unmapped}건` +
        (skipped ? ` · 건너뜀 ${skipped}건` : "") + ")" +
        unmappedHint +
        levelWarn,
      );
      qc.invalidateQueries();
    } catch (e) {
      setGfaMessage(e instanceof Error ? e.message : "가져오기에 실패했습니다.");
    } finally {
      setGfaImporting(false);
    }
  }

  async function addGfaRule() {
    if (!newKw.trim() || !newKwGroup) return;
    const { error } = await supabase.from("gfa_group_rules")
      .insert({ keyword: newKw.trim(), group_id: newKwGroup, priority: 50 });
    if (error) { setGfaMessage(error.message); return; }
    setNewKw(""); setNewKwGroup("");
    qc.invalidateQueries({ queryKey: ["gfa-rules"] });
  }
  async function deleteGfaRule(id: string) {
    await supabase.from("gfa_group_rules").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["gfa-rules"] });
  }
  async function toggleGfaRule(id: string, is_active: boolean) {
    await supabase.from("gfa_group_rules").update({ is_active }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["gfa-rules"] });
  }

  if (rules.error) return <ErrorState error={rules.error} onRetry={() => rules.refetch()} />;

  return (
    <>
      <PageHeader title="설정" description="알림 규칙, 집계 제외 항목, 초기 데이터 가져오기" />

      {message && (
        <div className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-xs">{message}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* 알림 규칙 --------------------------------------------------------- */}
        <Card>
          <CardHeader title="알림 규칙"
            description="임계값을 비우면 해당 규칙은 검사하지 않습니다" />
          {rules.isLoading ? <TableSkeleton rows={6} cols={3} /> : (
            <ul className="divide-y divide-line">
              {(rules.data ?? []).map((r) => {
                const meta = RULE_LABELS[r.rule_type] ?? { label: r.rule_type, unit: "", hint: "" };
                return (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <label className="flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        onChange={(e) => saveRule(r.id, { is_active: e.target.checked })}
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{meta.label}</p>
                      <p className="text-2xs text-ink-faint">{meta.hint}</p>
                    </div>
                    {meta.unit && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          className="h-8 w-28 text-right text-xs"
                          defaultValue={r.threshold ?? ""}
                          onBlur={(e) => saveRule(r.id, {
                            threshold: e.target.value === "" ? null : Number(e.target.value),
                          })}
                        />
                        <span className="w-16 text-2xs text-ink-faint">{meta.unit}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* 제외 광고 유형 ---------------------------------------------------- */}
        <Card>
          <CardHeader
            title="일반 상품 집계 제외 항목"
            description="제외된 값은 삭제되지 않고 '기타 광고 유형'으로 따로 볼 수 있습니다"
          />
          {excluded.isLoading ? <TableSkeleton rows={5} cols={3} /> : (
            <ul className="divide-y divide-line">
              {(excluded.data ?? []).map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={e.is_active}
                    onChange={(ev) => api.saveExcludedAdType({
                      id: e.id, label: e.label, match_type: e.match_type,
                      is_active: ev.target.checked,
                    }).then(() => qc.invalidateQueries({ queryKey: ["excluded"] }))}
                  />
                  <span className="flex-1 text-sm">{e.label}</span>
                  <Badge tone="neutral">
                    {e.match_type === "exact" ? "정확히 일치" : "포함"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 border-t border-line px-4 py-3">
            <Input className="h-8 flex-1 text-xs" placeholder="추가할 광고 유형"
              value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <Select className="h-8 text-xs" value={newMatch} onChange={(e) => setNewMatch(e.target.value)}>
              <option value="contains">포함</option>
              <option value="exact">정확히 일치</option>
            </Select>
            <Button size="sm" variant="primary" onClick={addExcluded} disabled={!newLabel.trim()}>
              <Plus className="h-3.5 w-3.5" /> 추가
            </Button>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-2xs text-ink-faint">
            상품번호 0 과 매핑 실패 건은 규칙과 무관하게 항상 '미매핑'으로 분리됩니다.
          </p>
        </Card>

        {/* 엑셀 가져오기 ----------------------------------------------------- */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="엑셀 초기 데이터 가져오기"
            description="기존 데일리보고서의 result2 시트를 그대로 올리면 RAW 데이터로 들어갑니다"
          />
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <input
              ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importResult2(f);
                e.target.value = "";
              }}
            />
            <Button variant="primary" loading={importing} onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> result2 엑셀 올리기
            </Button>
            <p className="text-xs text-ink-muted">
              필요한 헤더: 소재 · 상품번호(스마트스토어) · 노출수 · 클릭수 · 총비용 ·
              평균노출순위 · 구매완료 전환수 · 구매완료 전환매출액(원) · 총 전환수 ·
              총 전환매출액(원) · 날짜
            </p>
          </div>
        </Card>

        {/* 네이버 GFA RAW 업로드 --------------------------------------------- */}
        <Card>
          <CardHeader
            title="네이버 GFA RAW 업로드"
            description="GFA 리포트(시간별/기기별/연령별 어느 것이든)를 올리면 소재ID+날짜로 합산되어 들어갑니다"
          />
          {gfaMessage && (
            <div className="mx-4 mt-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-2xs text-ink-muted">
              {gfaMessage}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <input
              ref={gfaFileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importGfa(f);
                e.target.value = "";
              }}
            />
            <Button variant="primary" loading={gfaImporting} onClick={() => gfaFileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> GFA 리포트 올리기
            </Button>
            <p className="text-xs text-ink-muted">
              파일명과 무관하게 <b>열(형식)만 보고</b> 필요한 값을 자동으로 뽑습니다(안 쓰는 열은 무시).
              소재/그룹/캠페인 단위를 자동 인식하며, 소재이름·그룹이름 속 키워드로 상품군을 분류합니다.
              예: <b>스텝4.0</b> → 논슬립 스텝 4.0, <b>리타겟</b> → 브랜드. 스텝 구분은 소재 또는 광고그룹 단위 파일에서 됩니다.
            </p>
          </div>
        </Card>

        {/* GFA 상품군 규칙 --------------------------------------------------- */}
        <Card>
          <CardHeader
            title="GFA 상품군 매칭 규칙 (예외·별칭)"
            description="소재이름 첫 괄호 안 상품명이 상품군 이름과 자동 매칭됩니다. 여기 규칙은 이름이 다를 때만 추가하세요 (예: 리타겟 → 브랜드)"
          />
          {gfaRules.isLoading ? <TableSkeleton rows={5} cols={3} /> : (
            <ul className="divide-y divide-line">
              {(gfaRules.data ?? []).map((r: any) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={r.is_active}
                    onChange={(e) => toggleGfaRule(r.id, e.target.checked)}
                  />
                  <span className="font-mono text-xs">{r.keyword}</span>
                  <span className="text-2xs text-ink-faint">→</span>
                  <span className="flex-1 text-sm">{r.product_groups?.name ?? "(삭제된 상품군)"}</span>
                  <Badge tone="neutral">우선 {r.priority}</Badge>
                  <button
                    onClick={() => deleteGfaRule(r.id)}
                    className="rounded p-1 text-ink-faint hover:bg-surface-sunken hover:text-ink"
                    aria-label="규칙 삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 border-t border-line px-4 py-3">
            <Input className="h-8 w-32 text-xs" placeholder="키워드 (예: 스텝4.0)"
              value={newKw} onChange={(e) => setNewKw(e.target.value)} />
            <span className="text-2xs text-ink-faint">→</span>
            <Select className="h-8 flex-1 text-xs" value={newKwGroup}
              onChange={(e) => setNewKwGroup(e.target.value)}>
              <option value="">상품군 선택</option>
              {(groupOptions.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <Button size="sm" variant="primary" onClick={addGfaRule} disabled={!newKw.trim() || !newKwGroup}>
              <Plus className="h-3.5 w-3.5" /> 추가
            </Button>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-2xs text-ink-faint">
            규칙을 바꾼 뒤에는 해당 날짜의 GFA 파일을 다시 올리면 새 규칙으로 재분류됩니다.
          </p>
        </Card>
      </div>
    </>
  );
}
