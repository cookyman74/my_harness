// 9화면(§IA: Overview·Build·Agents·Skills·Runs·Docs·Drift·Ops·Settings). 모두 읽기(mutating=Build dry-run/실행·Drift sync-plan만).
// XSS: 전 텍스트 React escape. dangerouslySetInnerHTML 는 오직 renderMarkdown(markdown-it html:false + DOMPurify) 통과분에만(F5 DV8).
import { useState, useEffect, useRef, useMemo } from "react";
import { useApi, Async, Badge, Card, Table, ConfBadge, MetricCell } from "./ui.js";
import {
  type OverviewMetrics, type AgentsMetrics, type SkillsMetrics, type Coverage,
  coverageSummary, coverageWindowText, truncatedReasonText, windowEmptyNotice, overviewSuggestions,
} from "./metrics.js";
import {
  apiPost, apiGet, fetchArtifact, downloadDoc, downloadArtifact,
  DownloadTooLargeError, submitRun, RunSubmitError,
  postProjectRoot, ProjectRootError, cancelActiveRuns,
  getDefinition, putDefinition, rollbackDefinition, setDefinitionEdit, DefEditError,
  postEvalsConfig, EvalsConfigError,
  docsTreePath, docPreviewPath, postDocsSources, DocsSourcesError,
  CONTEXT_TREE_PATH, contextFilePath, downloadContextFile,
  postBuildDraft, postBuildCreate, postHarnessDraft, BuildError, type HarnessDraftResult,
  setFactoryMaintenance, applyFactory, type FactoryStatus, type SkillState, type FactoryTarget, type FactoryAction,
  type SkillUsageList, type SkillClassification,
  type ContextTree as ContextTreeShape, type ContextNode as CtxNode,
  type ContextFilePreview,
  type DocsNode, type DocsTree, type DocPreview,
  type DocsSourcesList,
  type SettingsInfo, type ProjectRootPreview,
  type DefKind, type DefinitionDoc, type PutDefResult,
  type EvalsIndex, type LoopIndexEntry, type LoopTrend, type TrendPoint,
  type ScorecardDetail, type EvalProposal, type EvalsConfigResolved,
  type MetricSetting,
} from "./api.js";
import {
  type ThresholdKey, FLOORS, THRESHOLD_KEYS, THRESHOLD_LABEL,
  alignmentText, gtMetricText, numOrDash, verdictCountsText, terminationExcerpt,
  evalsEmptyState, proposalDisabledText, gateShortfalls,
  parseIntInput, thresholdError, thresholdDiff, thresholdsValid,
  stageNeedsHighRiskConfirm, adoptionStageLabel, buildConfigPatch, evalsConfigErrorText,
} from "./evals.js";
import {
  defEditErrorText, diffLines, diffStats, hasChanges, isDiffCoarse, sideRows,
  skillNeedsName, skillHasClaudePath, isDirty, rollbackBodyFromSave,
} from "./defedit.js";
import { projectRootErrorText, canSave, requiresOrphanChoice, type OrphanChoice } from "./settings.js";
import {
  type Runtime, type DefKind as CtxDefKind,
  runtimeBadgeKind, availableRuntimes, filterContextTree, editDecision, findContextFile,
  buildErrorText, claudePointerSnippet,
  saveDraftSession, loadDraftSession, clearDraftSession,
} from "./context.js";
import {
  docsSourceErrorText, addSourceRow, removeSourceRow, updateSourceRow, moveSourceRow, canAddSource,
  rowIssue, rowIssueText, rowsLocallyValid, toPayloadSources, dryRunErrorByPath, allSourcesValid,
  docsSourcesState, pickDefaultSource, focusSourceFromHash, docsSourceDeepLink,
  MAX_DOCS_LABEL_LEN, MAX_DOCS_PATH_LEN,
  type SourceRow, type DryRunSource,
} from "./docs-sources.js";
import {
  type RunTemplate, type RunSubmitResult,
  toggleSelected, runSubmitErrorText, focusRunFromHash, runsDeepLink,
} from "./agent-run.js";
import { renderMarkdown } from "./render.js";
import { breadcrumbTrail, isMarkdownName, viewerBanner, localDocPath, localArtifactPath, focusDocFromHash, filterDocTree } from "./docs-view.js";
import { readErrorText } from "./errors.js";
import {
  tailDecision, isLiveRunState, isTerminalRunState,
  nextEventCursor, mergeEventItems, nextTailDelayMs,
} from "./run-tail.js";
import {
  type MetricsWindow, type WindowPreset, DEFAULT_WINDOW, PRESET_LABEL,
  metricsPath, parseLimitInput,
} from "./metrics-window.js";
import {
  type RunsFilter, type RunsQueryResult, type ChipField,
  parseQuery, buildQuery, setField, clearField, clearAll, activeChips, hasActiveFilter,
  toggleOrder, pageTo, truncationNotice, pageRange, nextOffset, prevOffset,
} from "./runs-filter.js";

type Inv = { projectRoot: string; claude: { entrypoint: string | null; agents: number; skills: number }; codex: { entrypoint: string | null; agents: number; skills: number }; workspace: { exists: boolean; runs: number } };
type Rt = Record<string, { installed: boolean; version: string | null }>;
type Stats = {
  configHealth: { agents: number; skills: number; orchestratorPresent: boolean; claudePointer: boolean; agentsPointer: boolean; orphanAgents: string[]; orphanSkills: string[]; linkUnknownAgents?: string[]; deadLinks?: string[]; coverageGaps?: string[]; coverageConfidence: string };
  d4: { projects: Array<{ project: string; resultDocs: number; missingNextStep: number }>; workspaceAbandoned: number };
  update: { manifest: boolean; factoryDrift: string };
  evolution: Array<{ date: string; change: string; source: string }>;
};

// ── F6 관측성 계층 B (M9 · W1~W9) — 공용 커버리지 고지 + Overview/Agents/Skills 편입 ──
// W6/A90: 커버리지(스캔·집계·측정비율·기간)·절단 원인(V13)을 정직 표기. "dead/미사용" 단정 금지.
function CoverageNote({ cov }: { cov: Coverage }) {
  const trunc = truncatedReasonText(cov.truncatedReason);
  const win = coverageWindowText(cov);
  return (
    <div className="coverage-note" role="note">
      <span className="muted">ⓘ {coverageSummary(cov)}{win && ` · 기간 ${win}`}
        {cov.recordedAtSource === "mtime" && (
          <span title="일부 파일시스템은 생성시각을 지원하지 않아 수정시각 기준으로 정렬됩니다 — 정렬·기간이 정확하지 않을 수 있음"> · mtime 기준</span>
        )}
      </span>
      {trunc && <span className="banner warn" role="note">⚠ {trunc}</span>}
    </div>
  );
}

// ── U3 메트릭 window 컨트롤 — 기간 프리셋(24h/7d/전체·FilterBar 패턴) + limit(고급·progressive disclosure) ──
// coverage 의 windowNewest/Oldest 는 서버가 이 window 로 재산정 → CoverageNote 표기와 정합.
function MetricsWindowBar({ win, onChange }: { win: MetricsWindow; onChange: (w: MetricsWindow) => void }) {
  const presets: WindowPreset[] = ["24h", "7d", "all"];
  const [limitDraft, setLimitDraft] = useState<string>(win.limit === null ? "" : String(win.limit));
  useEffect(() => { setLimitDraft(win.limit === null ? "" : String(win.limit)); }, [win.limit]);
  return (
    <div className="metric-window" role="group" aria-label="관측 window 선택">
      <span className="muted">관측 window:</span>
      <div className="seg-toggle" role="group" aria-label="기간 프리셋">
        {presets.map((p) => (
          <button key={p} type="button" className={win.preset === p ? "on" : ""} aria-pressed={win.preset === p}
            onClick={() => onChange({ ...win, preset: p })}>{PRESET_LABEL[p]}</button>
        ))}
      </div>
      {/* A91 과밀 방지 — limit 은 고급 접기 */}
      <details className="metric-window-adv">
        <summary>고급</summary>
        <label>집계 상한(limit)
          <input type="number" min={1} inputMode="numeric" placeholder="전체" value={limitDraft}
            aria-label="집계 편입 run 상한" onChange={(e) => setLimitDraft(e.target.value)}
            onBlur={() => onChange({ ...win, limit: parseLimitInput(limitDraft) })} />
        </label>
      </details>
    </div>
  );
}

// ── 1. Overview (A2·A3·A35-A38) ──
export function Overview() {
  const inv = useApi<Inv>("/api/harness");
  const rt = useApi<Rt>("/api/runtimes");
  const st = useApi<Stats>("/api/overview/state-stats");
  return (
    <div className="screen">
      <h2>Overview</h2>
      <Async state={rt}>{(r) => (
        <Card title="런타임">
          <Table cols={["런타임", "설치", "버전"]} rows={Object.entries(r).map(([k, v]) => [
            k, v.installed ? <Badge kind="ok">설치됨</Badge> : <Badge kind="muted">없음</Badge>, v.version ?? "—",
          ])} />
        </Card>
      )}</Async>
      <Async state={inv}>{(v) => (
        <Card title="인벤토리">
          <Table cols={["런타임", "진입점", "에이전트", "스킬"]} rows={[
            ["claude", v.claude.entrypoint ?? <Badge kind="warn">없음</Badge>, v.claude.agents, v.claude.skills],
            ["codex", v.codex.entrypoint ?? <Badge kind="muted">없음</Badge>, v.codex.agents, v.codex.skills],
          ]} />
          <p className="muted">projectRoot: {v.projectRoot} · runs: {v.workspace.runs}</p>
        </Card>
      )}</Async>
      <Async state={st}>{(s) => (
        <>
          <Card title="구성 건강도 (추정)">
            <Table cols={["항목", "값"]} rows={[
              ["오케스트레이터", s.configHealth.orchestratorPresent ? <Badge kind="ok">있음</Badge> : <Badge kind="warn">없음</Badge>],
              ["CLAUDE.md / AGENTS.md", <>{s.configHealth.claudePointer ? "✓" : "✗"} / {s.configHealth.agentsPointer ? "✓" : "✗"}</>],
              ["고아 에이전트", s.configHealth.orphanAgents.length ? <Badge kind="warn">{s.configHealth.orphanAgents.join(", ")}</Badge> : "0"],
              ["고아 스킬", s.configHealth.orphanSkills.length ? <Badge kind="warn">{s.configHealth.orphanSkills.join(", ")}</Badge> : "0"],
              ["미선언(link_unknown)", s.configHealth.linkUnknownAgents?.length ? <Badge kind="muted">{s.configHealth.linkUnknownAgents.join(", ")}</Badge> : "0"],
              ["dead-link", s.configHealth.deadLinks?.length ? <Badge kind="warn">{s.configHealth.deadLinks.join(", ")}</Badge> : "0"],
              ["커버리지 갭", s.configHealth.coverageGaps?.length ? <Badge kind="muted">{s.configHealth.coverageGaps.join(", ")}</Badge> : "0"],
              ["커버리지 신뢰도", s.configHealth.coverageConfidence],
            ]} />
          </Card>
          <Card title="산출물 관리 규율 · 업데이트 상태">
            <Table cols={["프로젝트", "결과서", "다음단계 누락"]} rows={s.d4.projects.map((p) => [
              // A59: 결과서(docs/) 클릭 → Docs 뷰어 진입
              <a className="link" href="#/docs" title="Docs 뷰어에서 결과서 열람">{p.project}</a>,
              p.resultDocs, p.missingNextStep ? <Badge kind="err">{p.missingNextStep}</Badge> : <Badge kind="ok">0</Badge>,
            ])} />
            <p className="muted">_workspace 방치: {s.d4.workspaceAbandoned} · manifest: {String(s.update.manifest)} · factoryDrift: {s.update.factoryDrift} · <a className="link" href="#/docs">문서 뷰어 열기 →</a></p>
          </Card>
          <Card title="진화 이력">
            <Table cols={["날짜", "변경", "출처"]} rows={s.evolution.slice(-12).reverse().map((e) => [e.date, e.change, e.source])} />
            <p className="muted">
              출처: CLAUDE.md·AGENTS.md 변경이력(팩토리 서술). 최근 12건. ·
              에이전트/스킬 <b>정의 변경(추가·수정)</b> 상세는 <a className="link" href="#/runs">→ History</a>
              (별개 로그 — UI 발원 구성 변경 이력).
            </p>
          </Card>
        </>
      )}</Async>
    </div>
  );
}

// ── 2. Build (A9a — dry-run 폼 골격 + 실행) ──
type HarnessEntry = { name: string; runtime: string; orchestratesDeclared: boolean; agents: string[]; missingAgents: string[]; skillCount: number; status: "linked" | "unmigrated" | "broken" };
const HSTATUS: Record<string, { label: string; kind: "ok" | "warn" | "muted" }> = {
  linked: { label: "정상", kind: "ok" }, unmigrated: { label: "미선언", kind: "muted" }, broken: { label: "대상 부재", kind: "warn" },
};

// 하네스 목록 — 오케스트레이터 스킬 + 배정 에이전트(연결 그래프 파생). backfill(orchestrates 선언) 전엔 "미선언".
function HarnessList() {
  const st = useApi<{ harnesses: HarnessEntry[] }>("/api/harnesses");
  return (
    <Card title="하네스 목록">
      <p className="muted">하네스 = 오케스트레이터 스킬 + 배정 에이전트/스킬(연결 그래프 파생). <code>orchestrates:</code> 선언 시 "정상", 미선언(추정)은 backfill 필요.</p>
      <Async state={st}>{(d) => d.harnesses.length === 0 ? (
        <div className="empty" role="status"><p className="muted">🧪 오케스트레이터 스킬이 없습니다 — 하네스 미구성.</p></div>
      ) : (
        <Table cols={["하네스(오케스트레이터)", "런타임", "에이전트", "스킬", "상태"]} rows={d.harnesses.map((h) => [
          h.name, h.runtime, `${h.agents.length}${h.missingAgents.length ? ` (+부재 ${h.missingAgents.length})` : ""}`,
          String(h.skillCount), <Badge kind={HSTATUS[h.status]?.kind ?? "muted"}>{HSTATUS[h.status]?.label ?? h.status}</Badge>,
        ])} />
      )}</Async>
    </Card>
  );
}

// C: 하네스 전체 자동 빌드 — 도메인 한 문장 → 팩토리 exec(격리·무도구·plan) 로 세트 초안 → 검토 → 전체 생성(build/create 반복·자동적용 없음).
function HarnessAutoBuild({ gateOn, onCreated }: { gateOn: boolean; onCreated: () => void }) {
  const [domain, setDomain] = useState("");
  const [draft, setDraft] = useState<HarnessDraftResult["draft"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<string[]>([]);
  const genDraft = async () => {
    setBusy(true); setMsg(null); setDraft(null); setCreated([]);
    try { setDraft((await postHarnessDraft({ domain })).draft); }
    catch (e) { setMsg(e instanceof BuildError ? `초안 실패: ${e.code}` : String(e)); }
    finally { setBusy(false); }
  };
  const createAll = async () => {
    if (!draft) return;
    setBusy(true); setMsg(null);
    // leaf-first(C audit HIGH): 스킬→에이전트→오케스트레이터 마지막. 오케스트레이터는 에이전트를 orchestrates 참조하므로
    // 마지막에 생성해야 중간 실패 시 dangling(고아 오케스트레이터) 방지.
    const items = [
      ...draft.skills.map((s) => ({ kind: "skill" as const, ...s })),
      ...draft.agents.map((a) => ({ kind: "agent" as const, ...a })),
      { kind: "skill" as const, ...draft.orchestrator },
    ];
    const done: string[] = []; const skipped: string[] = [];
    try {
      for (const it of items) {
        try { await postBuildCreate({ kind: it.kind, name: it.name, content: it.content }); done.push(`${it.kind}:${it.name}`); }
        catch (e) {
          // 멱등 재시도(C R2): 이미 존재(name-collision)는 skip·계속(부분실패 후 재클릭 시 교착 방지). 그 외만 중단.
          //   단 skip 은 done 과 분리(C R3): 기존 동명 정의는 내용이 초안과 다를 수 있어 "성공"으로 뭉뚱그리면 false-success.
          if (e instanceof BuildError && e.code === "name-collision") { skipped.push(`${it.kind}:${it.name}`); continue; }
          setMsg(`${it.name} 생성 실패: ${e instanceof BuildError ? e.code : String(e)} (${done.length}개 생성 후 중단·재클릭 시 이어서 시도)`); break;
        }
      }
      setCreated([...done, ...skipped.map((s) => `${s}(기존·건너뜀)`)]);
      const allAccountedFor = done.length + skipped.length === items.length;
      if (allAccountedFor) {
        const skipNote = skipped.length ? ` · ${skipped.length}개는 기존 동명 존재로 건너뜀(내용 상이 가능 — 확인 필요)` : "";
        setMsg(`하네스 생성 완료 (신규 ${done.length}개${skipNote})`); onCreated();
      }
    } finally { setBusy(false); }
  };
  if (!gateOn) return <Card title="하네스 전체 자동 빌드 (실험)"><p className="muted">🔒 정의 편집 비활성 — Settings에서 켜야 사용 가능.</p></Card>;
  const total = draft ? 1 + draft.agents.length + draft.skills.length : 0;
  return (
    <Card title="하네스 전체 자동 빌드 (실험)">
      <p className="muted">
        도메인 한 문장 → 팩토리가 <b>오케스트레이터+에이전트+스킬 초안</b>을 생성(격리·무도구 LLM·plan·디스크 미기록) → 검토 → 전체 생성.
        <b>자동 적용 아님</b>(생성 버튼 필요). 생성분은 <a className="link" href="#/runs">History</a>에 기록.
      </p>
      <div className="form">
        <label className="full">도메인<textarea value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={400} rows={2} placeholder="예: PDF 청구서 파싱·검증 자동화 하네스" /></label>
        <button disabled={busy || !domain} onClick={genDraft}>{busy ? "생성 중…" : "하네스 초안 생성"}</button>
      </div>
      {draft && (
        <>
          <Table cols={["종류", "이름"]} rows={[
            ["오케스트레이터", draft.orchestrator.name],
            ...draft.agents.map((a) => ["에이전트", a.name] as [string, string]),
            ...draft.skills.map((s) => ["스킬", s.name] as [string, string]),
          ]} />
          <details className="tier-b"><summary>초안 내용 미리보기(JSON)</summary><pre className="out">{JSON.stringify(draft, null, 2).slice(0, 6000)}</pre></details>
          <button className="primary" disabled={busy} onClick={createAll}>{busy ? "생성 중…" : `전체 생성 (${total}개)`}</button>
        </>
      )}
      {created.length > 0 && <p className="muted">생성됨: {created.join(", ")}</p>}
      {msg && <p className="muted">{msg}</p>}
    </Card>
  );
}

// Harness = 하네스 빌드 허브 — 목록 + 하네스 전체 자동빌드(C) + 정의 빌더(에이전트/스킬 단건).
export function Build() {
  const set = useApi<SettingsInfo>("/api/settings"); // definitionEditEnabled(빌더 게이트·A81)
  const gateOn = set.data?.definitionEditEnabled === true;
  const toHistory = () => { location.hash = "#/runs"; };
  return (
    <div className="screen">
      <h2>Harness <span className="ver">하네스 빌드</span></h2>
      <p className="lead">
        하네스(오케스트레이터+에이전트+스킬)를 <b>구성·빌드</b>한다 — 목록 · <b>전체 자동 빌드</b> · 정의 빌더(단건).
        구성 변경은 <a className="link" href="#/runs">History</a>에 기록. (조회·편집: <a className="link" href="#/context">Context</a> · <a className="link" href="#/agents">Agents</a>/<a className="link" href="#/skills">Skills</a>.)
      </p>
      <FactoryPanel />
      <HarnessList />
      <SkillUsageSection />
      <h3 className="lens-h">🏗 하네스 전체 자동 빌드 <span className="lens-tag">실험</span></h3>
      <HarnessAutoBuild gateOn={gateOn} onCreated={toHistory} />
      <h3 className="lens-h">🔨 정의 빌더 <span className="lens-tag muted">에이전트/스킬 단건</span></h3>
      <ContextBuilder gateOn={gateOn} onCreated={toHistory} />
    </div>
  );
}

// ── 3. Agents (A3 · F2 M10 프리필 New Run) ──
export function Agents() {
  const st = useApi<{ agents: Array<{ name: string; runtime: string; sourcePath: string; role: string; skills: string[] }> }>("/api/agents");
  const set = useApi<SettingsInfo>("/api/settings"); // F7: definitionEditEnabled(편집 버튼 게이트·A81)
  const [sel, setSel] = useState<string | null>(null);
  const [runFor, setRunFor] = useState<string | null>(null); // F2: New Run 프리필 폼 대상 에이전트
  const [editFor, setEditFor] = useState<string | null>(null); // F7: 정의 편집 대상 에이전트
  const gateOn = set.data?.definitionEditEnabled === true;
  return (
    <div className="screen">
      <h2>Agents</h2>
      <p className="lead">에이전트를 선택해 역할·연결 스킬을 보고, 요청(New Run)하거나 정의를 편집한다.</p>
      <Async state={st}>{(d) => (
        <div className="md-layout">
          {/* 스캔 쉬운 선택 리스트(이름·런타임 배지·역할 발췌·스킬 수) */}
          <div className="itemlist" role="list">
            {d.agents.length === 0 && <p className="muted">에이전트 없음</p>}
            {d.agents.map((a) => (
              <button key={a.name} role="listitem" className={a.name === sel ? "item on" : "item"}
                aria-current={a.name === sel} onClick={() => setSel(a.name)}>
                <span className="item-top">
                  <span className="item-name">{a.name}</span>
                  <span className="badge muted">{a.runtime}</span>
                </span>
                <span className="item-meta">{a.role || "(설명 없음)"}</span>
                {a.skills.length > 0 && <span className="item-meta">스킬 {a.skills.length}개</span>}
              </button>
            ))}
          </div>
          {/* 상세(스티키) — 미선택 시 빈 상태 안내 */}
          <div className="detail-sticky">
            {sel ? (() => { const a = d.agents.find((x) => x.name === sel); return a ? (
              <Card title={a.name}>
                <p className="muted">{a.sourcePath} · {a.runtime}</p>
                <p>{a.role || "(설명 없음)"}</p>
                {a.skills.length > 0 && (
                  <div className="chipset" aria-label="연결 스킬">
                    {a.skills.map((sk) => <span key={sk} className="chip-soft">{sk}</span>)}
                  </div>
                )}
                <div className="detail-actions">
                  {/* F2 W1/A67: 프리필 New Run 진입점(라벨 RF2 정합) */}
                  <button className="primary" onClick={() => setRunFor(a.name)}>이 에이전트에게 요청 (New Run)</button>
                  {/* F7 A80/A81: 정의 편집 진입(게이트 off·codex → 비활성 + 이유 툴팁 + Settings 딥링크) */}
                  <EditButton
                    reason={!gateOn ? "정의 편집이 비활성입니다" : a.runtime !== "claude" ? "Codex 에이전트 정의 편집은 현재 지원하지 않습니다" : null}
                    showSettingsLink={!gateOn}
                    onEdit={() => setEditFor(a.name)}
                  />
                </div>
              </Card>
            ) : null; })() : (
              <div className="detail-empty" role="note">← 왼쪽에서 에이전트를 선택하면 상세·요청·편집이 열립니다.</div>
            )}
            {/* F7 A80/A83: 편집기 인라인 — 상세 컬럼 안에서 펼침(자체 Card·3-state 유지·실패 격리) */}
            {editFor && <DefinitionEditor key={"agent:" + editFor} kind="agent" name={editFor} onClose={() => setEditFor(null)} />}
          </div>
        </div>
      )}</Async>
      {/* F2 W1/A83: 프리필 폼은 독립 카드로 렌더 — run-template 로드 실패가 Agents 화면 전체를 무너뜨리지 않음 */}
      {runFor && <AgentRunForm key={runFor} name={runFor} onClose={() => setRunFor(null)} />}
    </div>
  );
}

// F2 M10 — 에이전트 프리필 New Run 폼(대화형 아님·최초 1회 제출·fire-and-observe).
// run-template 을 로드(A83 독립 3-state) → Build 동형 편집폼. allowedTools 는 D 체크박스로만(A100·U⊆D 구조 보장).
const TARGET_ENUM = ["agents", "skills", "orchestrator"] as const;

function AgentRunForm({ name, onClose }: { name: string; onClose: () => void }) {
  const tmpl = useApi<RunTemplate>(`/api/agents/${encodeURIComponent(name)}/run-template`);
  return (
    <Card title={`New Run · ${name}`}>
      <button className="link" onClick={onClose}>✕ 닫기</button>
      {/* A83: 폼 영역만 독립 로딩/에러(3-state) — 실패해도 상세 카드·usage 유지 */}
      <Async state={tmpl}>{(t) => <AgentRunFormBody template={t} />}</Async>
    </Card>
  );
}

function AgentRunFormBody({ template }: { template: RunTemplate }) {
  const D = template.suggestedAllowedTools;
  const [runtime, setRuntime] = useState<"codex" | "claude">(template.runtime);
  const [mode, setMode] = useState("build");
  const [domain, setDomain] = useState(template.domainTemplate);
  const [perm, setPerm] = useState<"read-only" | "workspace-write">(template.permissionMode);
  const [permConfirmed, setPermConfirmed] = useState(false); // A85: workspace-write 상향 명시 확인
  const [targets, setTargets] = useState<string[]>(() => TARGET_ENUM.filter((x) => template.targets.includes(x)));
  const [tools, setTools] = useState<string[]>(() => [...D]); // U=D 기본(사용자는 D 내에서 뺄 수만)
  const [dry, setDry] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunSubmitResult | null>(null);
  const [err, setErr] = useState<string | null>(null); // 400/409 인라인 매핑(A100)

  const permBlocked = perm === "workspace-write" && !permConfirmed; // A85 미확인 시 제출 차단
  const changePerm = (v: "read-only" | "workspace-write") => { setPerm(v); if (v === "read-only") setPermConfirmed(false); };
  const toggleTarget = (t: string, on: boolean) =>
    setTargets((prev) => on ? [...new Set([...prev, t])] : prev.filter((x) => x !== t));

  const submit = async () => {
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await submitRun({
        runtime, mode, domain, permissionMode: perm, targets,
        allowedTools: tools, dryRun: dry,
        agent: template.agent, agentFingerprint: template.fingerprint, // 지문 echo(stale 폼 → 409)
      });
      setResult(r);
    } catch (e) {
      // 400/409 는 runSubmitErrorText 유지, 그 외(401 재인증·네트워크 등)는 U1 readErrorText 로 매핑(원시 String(e) 금지).
      if (e instanceof RunSubmitError) setErr(runSubmitErrorText(e.status, e.code, e.detail));
      else setErr(readErrorText(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="form">
      <label>런타임
        <select value={runtime} onChange={(e) => setRuntime(e.target.value as "codex" | "claude")}>
          <option value="codex">codex</option><option value="claude">claude</option>
        </select>
      </label>
      <label>모드<input value={mode} onChange={(e) => setMode(e.target.value)} maxLength={40} /></label>
      <label>권한
        <select value={perm} onChange={(e) => changePerm(e.target.value as "read-only" | "workspace-write")}>
          <option value="read-only">read-only (기본·보수적)</option>
          <option value="workspace-write">workspace-write</option>
        </select>
      </label>
      <label className="full">작업(domain)<textarea value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={4000} rows={4} /></label>

      {/* F2 W2/A100: allowedTools = 에이전트 정의 D 체크박스로만(자유입력 없음 → U⊆D 구조 보장) */}
      <fieldset className="tool-fieldset full">
        <legend>도구 (allowedTools)</legend>
        <p className="muted">이 에이전트가 선언한 도구만 선택 가능 · D 밖 추가 불가(뺄 수만).</p>
        {D.length === 0
          ? <p className="muted">🕳 이 에이전트는 도구를 선언하지 않았습니다(도구 없이 실행).</p>
          : D.map((t) => (
              <label key={t} className="check">
                <input type="checkbox" checked={tools.includes(t)}
                  onChange={(e) => setTools((prev) => toggleSelected(prev, t, e.target.checked, D))} />
                {t}
              </label>
            ))}
      </fieldset>

      {/* targets(정의 프리필·enum 편집) */}
      <fieldset className="target-fieldset full">
        <legend>대상(targets)</legend>
        {TARGET_ENUM.map((t) => (
          <label key={t} className="check">
            <input type="checkbox" checked={targets.includes(t)} onChange={(e) => toggleTarget(t, e.target.checked)} />
            {t}
          </label>
        ))}
      </fieldset>

      <label className="check"><input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} /> dry-run(미리보기만)</label>

      {/* A85: 권한 상향 위험 확인(색 아님·아이콘+텍스트·명시 확인 게이트) */}
      {perm === "workspace-write" && (
        <div className="banner warn full" role="note">
          <p>⚠ workspace-write 는 파일 쓰기 권한을 상향합니다. run-template 기본은 read-only 입니다.</p>
          <label className="check"><input type="checkbox" checked={permConfirmed} onChange={(e) => setPermConfirmed(e.target.checked)} /> 권한 상향을 확인합니다</label>
        </div>
      )}

      <button className="primary" disabled={busy || !domain || !mode || permBlocked} onClick={submit}>
        {busy ? "제출 중…" : dry ? "미리보기" : "실행"}
      </button>
      {!dry && <p className="warn-text">⚠ 실 실행은 CLI 프로세스를 spawn합니다(fire-and-observe · 대화형 아님).</p>}

      {/* A100: 서버 거부(400 unauthorized-tool·409 agent-definition-changed) 인라인 — 조용한 드롭 아님 */}
      {err && <p className="banner err full" role="alert">⚠ {err}</p>}

      {/* A87: 제출 성공 착지 배너 + runId 딥링크(→ History에서 관찰) */}
      {result && (result.dryRun
        ? <div className="banner full" role="status">
            <p>👁 미리보기(파일 미기록) · runId <code className="path">{result.runId}</code></p>
            <pre className="out">{JSON.stringify(result.preview, null, 2)}</pre>
          </div>
        : <div className="banner ok full" role="status">
            <p>✓ 실행이 생성되었습니다 · runId <code className="path">{result.runId}</code></p>
            <a className="link" href={runsDeepLink(result.runId)}>→ History에서 관찰</a>
          </div>)}
    </div>
  );
}

// ── 4. Skills (A4·A43 triggers) ──
export function Skills() {
  const st = useApi<{ skills: Array<{ name: string; description: string; triggers: string; references: string[]; runtimePaths: string[] }> }>("/api/skills");
  const set = useApi<SettingsInfo>("/api/settings"); // F7: definitionEditEnabled(편집 버튼 게이트·A81)
  const [sel, setSel] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<string | null>(null); // F7: 정의 편집 대상 스킬
  const gateOn = set.data?.definitionEditEnabled === true;
  return (
    <div className="screen">
      <h2>Skills</h2>
      <p className="lead">스킬을 선택해 트리거·설명·참조를 보고, 정의를 편집한다.</p>
      <Async state={st}>{(d) => (
        <div className="md-layout">
          <div className="itemlist" role="list">
            {d.skills.length === 0 && <p className="muted">스킬 없음</p>}
            {d.skills.map((s) => (
              <button key={s.name} role="listitem" className={s.name === sel ? "item on" : "item"}
                aria-current={s.name === sel} onClick={() => setSel(s.name)}>
                <span className="item-top"><span className="item-name">{s.name}</span></span>
                <span className="item-meta">{s.triggers || s.description || "(설명 없음)"}</span>
              </button>
            ))}
          </div>
          <div className="detail-sticky">
            {sel ? (() => { const s = d.skills.find((x) => x.name === sel); return s ? (
              <Card title={s.name}>
                <p className="muted">{s.runtimePaths.join(", ")}</p>
                <p>{s.description || "(설명 없음)"}</p>
                {s.triggers && <p className="item-meta">트리거: {s.triggers}</p>}
                {s.references.length > 0 && (
                  <div className="chipset" aria-label="참조">
                    {s.references.map((r) => <span key={r} className="chip-soft">{r}</span>)}
                  </div>
                )}
                <div className="detail-actions">
                  {/* F7 A80/A81: 정의 편집 진입(게이트 off·codex-only → 비활성 + 이유 툴팁 + Settings 딥링크) */}
                  <EditButton
                    reason={!gateOn ? "정의 편집이 비활성입니다" : !skillHasClaudePath(s.runtimePaths) ? "Codex 전용 스킬 정의 편집은 현재 지원하지 않습니다" : null}
                    showSettingsLink={!gateOn}
                    onEdit={() => setEditFor(s.name)}
                  />
                </div>
              </Card>
            ) : null; })() : (
              <div className="detail-empty" role="note">← 왼쪽에서 스킬을 선택하면 상세·편집이 열립니다.</div>
            )}
            {/* F7 A80/A83: 편집기 인라인 — 상세 컬럼 안에서 펼침(자체 Card·3-state·실패 격리) */}
            {editFor && <DefinitionEditor key={"skill:" + editFor} kind="skill" name={editFor} onClose={() => setEditFor(null)} />}
          </div>
        </div>
      )}</Async>
    </div>
  );
}

// ── F7 정의 편집기 (M12 · A80·A81·A85·A86·A93 · 첫 mutating·중대) ──
// XSS: textarea·diff·merge 는 전부 React escape(순수 텍스트) — dangerouslySetInnerHTML 금지(마크다운 렌더 아님).

// A81: 편집 진입 버튼. reason!=null → 비활성 + 이유 툴팁(색 비의존·텍스트 병기·빈 비활성 금지) + Settings 딥링크.
function EditButton({ reason, showSettingsLink, onEdit }: { reason: string | null; showSettingsLink: boolean; onEdit: () => void }) {
  if (!reason) return <button className="primary edit-btn" onClick={onEdit}>✎ 정의 편집</button>;
  return (
    <span className="edit-disabled-wrap">
      <button className="edit-btn" disabled aria-disabled="true" title={reason}>✎ 정의 편집</button>
      <span className="muted edit-reason" role="note">🔒 {reason}
        {showSettingsLink && <> · <a className="link" href="#/settings">Settings에서 켜기 →</a></>}
      </span>
    </span>
  );
}

// 통합 diff 미리보기(로드본→편집본) — +/−/space 마크로 색 비의존(A92). 순수 텍스트 렌더.
function DiffView({ before, after }: { before: string; after: string }) {
  if (!hasChanges(before, after)) return <p className="muted" role="status">변경 없음</p>;
  const ops = diffLines(before, after);
  const stats = diffStats(ops);
  return (
    <div className="def-diff" role="group" aria-label="변경 미리보기(로드본 → 편집본)">
      <p className="muted">추가 +{stats.added} / 삭제 −{stats.removed} 라인{isDiffCoarse(before, after) && " · 대용량 정의 — 개략 비교(전체 교체)"}</p>
      <div className="out def-diff-body">
        {ops.map((o, i) => (
          <div key={i} className={`dl dl-${o.kind}`}>
            <span className="dl-mark" aria-hidden="true">{o.kind === "add" ? "+" : o.kind === "del" ? "−" : " "}</span>
            <span className="dl-text">{o.text === "" ? " " : o.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// A93 병합 뷰 — 디스크 현재본 ↔ 내 편집분(보존) 나란히 비교. 편집분 유실 방지의 시각적 근거.
function MergeView({ disk, edited }: { disk: string; edited: string }) {
  const rows = sideRows(diffLines(disk, edited));
  return (
    <div className="def-merge" role="group" aria-label="디스크 현재본과 내 편집분 나란히 비교">
      <div className="def-merge-head"><span>디스크 현재본</span><span>내 편집분 (보존됨)</span></div>
      <div className="def-merge-body">
        {rows.map((r, i) => (
          <div key={i} className={`mr mr-${r.kind}`}>
            <span className="mr-cell mr-left">{r.left ?? " "}</span>
            <span className="mr-cell mr-right">{r.right ?? " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// A93 stale-write 충돌 상태(편집분 보존 병합). diskContent=null → 디스크 현재본 재조회 실패 폴백.
type StaleConflict = { currentHash: string; diskContent: string | null };

function DefinitionEditor({ kind, name, onClose }: { kind: DefKind; name: string; onClose: () => void }) {
  const [doc, setDoc] = useState<DefinitionDoc | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [edited, setEdited] = useState<string>("");
  const [baseHash, setBaseHash] = useState<string>(""); // 낙관적 동시성 기준(저장·adopt 시 갱신)
  const [showDiff, setShowDiff] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<PutDefResult | null>(null);
  const [rolledBack, setRolledBack] = useState(false);
  const [rbBusy, setRbBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null); // 400/403/409 인라인(A80)
  const [conflict, setConflict] = useState<StaleConflict | null>(null); // A93
  const [copied, setCopied] = useState(false);

  // 정의 로드(이름→서버 정규경로 재조회). A83: 편집기 카드 안에서만 3-state.
  useEffect(() => {
    let live = true;
    setDoc(null); setLoadErr(null); setSaveResult(null); setConflict(null); setErr(null);
    getDefinition(kind, name)
      .then((d) => { if (live) { setDoc(d); setEdited(d.content); setBaseHash(d.baseHash); } })
      .catch((e) => { if (live) setLoadErr(e instanceof DefEditError ? defEditErrorText(e.code, e.status, e.detail) : String(e)); });
    return () => { live = false; };
  }, [kind, name]);

  const dirty = doc != null && isDirty(doc.content, edited);

  // A86: 미저장 이탈 경고(브라우저 unload). 앱 내 닫기는 confirm() 게이트(아래 doClose).
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const doClose = () => {
    if (dirty && !window.confirm("저장하지 않은 편집 내용이 있습니다. 편집기를 닫을까요?")) return;
    onClose();
  };

  const editable = doc?.editable === true;

  // 저장 실행(확인 다이얼로그에서 호출). 성공 → 재조회로 canonical 반영·rollback 준비. 실패 → 인라인/A93.
  const doSave = async () => {
    if (!doc) return;
    setSaving(true); setErr(null);
    try {
      const res = await putDefinition(kind, name, { content: edited, baseHash, pathId: doc.pathId });
      setConfirmOpen(false); setConflict(null); setRolledBack(false);
      setSaveResult(res); setBaseHash(res.newHash);
      // canonical 재직렬화본을 재조회해 diff 기준 갱신(실패해도 저장 성공 배너 유지·A83).
      try { const d = await getDefinition(kind, name); setDoc(d); setEdited(d.content); setBaseHash(d.baseHash); } catch { /* 재조회 실패 격리 */ }
    } catch (e) {
      setConfirmOpen(false);
      if (e instanceof DefEditError && e.status === 409 && e.code === "stale-write") {
        // A93: 자동 재로드 금지 — 편집분(edited) 보존한 채 디스크 현재본 조회해 병합 뷰.
        const ch = e.currentHash ?? "";
        setErr(defEditErrorText(e.code, e.status));
        getDefinition(kind, name)
          .then((d) => setConflict({ currentHash: e.currentHash ?? d.baseHash, diskContent: d.content }))
          .catch(() => setConflict({ currentHash: ch, diskContent: null }));
      } else {
        setErr(e instanceof DefEditError ? defEditErrorText(e.code, e.status, e.detail) : String(e));
      }
    } finally { setSaving(false); }
  };

  // A93: 디스크 최신본 기준으로 재저장 준비 — baseHash 를 디스크 현재 해시로 채택(편집분은 그대로 유지·의도적 덮어쓰기).
  const adoptDiskBase = () => {
    if (!conflict) return;
    setBaseHash(conflict.currentHash);
    setConflict(null); setErr(null);
  };

  const copyEdited = async () => {
    try { await navigator.clipboard.writeText(edited); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setCopied(false); }
  };

  // "되돌리기" = POST rollback(expectedCurrentHash=newHash·backupHash=prevHash). 성공 → 재조회 반영.
  const doRollback = async () => {
    if (!saveResult) return;
    setRbBusy(true); setErr(null);
    try {
      await rollbackDefinition(kind, name, rollbackBodyFromSave(saveResult));
      setSaveResult(null); setRolledBack(true);
      const d = await getDefinition(kind, name); setDoc(d); setEdited(d.content); setBaseHash(d.baseHash);
    } catch (e) {
      setErr(e instanceof DefEditError ? defEditErrorText(e.code, e.status, e.detail) : String(e));
    } finally { setRbBusy(false); }
  };

  return (
    <Card title={`정의 편집 · ${name}`}>
      <button className="link" onClick={doClose}>✕ 닫기</button>
      {loadErr && <p className="banner err" role="alert">⚠ {loadErr}</p>}
      {!doc && !loadErr && <p className="muted">불러오는 중…</p>}
      {doc && (
        <>
          <p className="muted"><code className="path">{doc.sourcePath}</code>{dirty && <span className="warn-text"> · 미저장 변경 있음</span>}</p>

          {!editable && (
            <p className="banner warn" role="note">🔒 정의 편집이 비활성입니다 — 뷰어 전용. <a className="link" href="#/settings">Settings에서 켜기 →</a></p>
          )}

          {/* name 필수 안내(name 없는 스킬 저장 전 힌트·400 integrity field:name 예방) */}
          {editable && skillNeedsName(kind, edited) && (
            <p className="banner warn" role="note">⚠ 이 스킬 정의에 <code>name:</code> 필드가 없습니다 — 저장하려면 frontmatter 에 <code>name: {name}</code> 를 명시하세요.</p>
          )}

          <label className="def-textarea-label">
            정의 원문 (frontmatter + 본문)
            <textarea className="def-textarea" value={edited} onChange={(e) => setEdited(e.target.value)}
              readOnly={!editable} aria-label="정의 원문 편집" spellCheck={false} rows={20} />
          </label>

          <div className="def-editor-toolbar">
            <button className="link" aria-pressed={showDiff} onClick={() => setShowDiff((v) => !v)}>
              {showDiff ? "변경 미리보기 접기" : "변경 미리보기 (diff)"}
            </button>
            {editable && (
              <button className="primary" disabled={!dirty || saving} onClick={() => { setErr(null); setConfirmOpen(true); }}>
                저장…
              </button>
            )}
          </div>

          {showDiff && <DiffView before={doc.content} after={edited} />}

          {/* 400/403/409 인라인 에러(조용한 드롭 금지·A80) */}
          {err && <p className="banner err" role="alert">⚠ {err}</p>}

          {/* A93 stale-write 편집분 보존 병합 뷰 — 자동 재로드 금지·편집 textarea 보존 */}
          {conflict && (
            <div className="banner warn def-conflict" role="alert">
              <p>⚠ 디스크의 정의가 편집 중 변경되었습니다. <b>편집 내용은 그대로 보존</b>됩니다(덮어쓰기 전 확인).</p>
              <div className="def-conflict-actions">
                <button onClick={copyEdited}>📋 편집분 클립보드 복사{copied && " ✓"}</button>
                <button onClick={adoptDiskBase} title="디스크 최신본을 기준으로 삼아 편집분으로 덮어쓸 준비를 합니다(편집분 유지).">디스크 최신본 기준으로 재저장 준비</button>
              </div>
              {conflict.diskContent != null
                ? <MergeView disk={conflict.diskContent} edited={edited} />
                : <p className="muted">디스크 현재본을 불러오지 못했습니다 — 편집분을 복사해 수동 병합하세요.</p>}
            </div>
          )}

          {/* A79/A85 저장 성공 착지 — 편집≠실행 안내 + Codex drift 경고 + 되돌리기 */}
          {saveResult && (
            <div className="banner ok def-saved" role="status">
              <p>✓ 저장됨 · 이전 해시 <code className="path">{saveResult.prevHash.slice(0, 12)}</code> → 새 해시 <code className="path">{saveResult.newHash.slice(0, 12)}</code></p>
              <p className="muted">이 저장은 정의 파일 기록만 합니다(실행 아님) — 실행하려면 <b>New Run / Ask Agent</b> 로 진행하세요.</p>
              {saveResult.codexDriftWarning && (
                <p className="warn-text">⚠ Codex 병행 정의(.codex/.agents)는 자동 갱신되지 않습니다 — 불일치 발생 가능.</p>
              )}
              <button disabled={rbBusy} onClick={doRollback}>{rbBusy ? "되돌리는 중…" : "↩ 되돌리기 (직전 백업 복원)"}</button>
            </div>
          )}
          {rolledBack && <p className="banner ok" role="status">↩ 직전 백업으로 되돌렸습니다.</p>}
        </>
      )}

      {/* A85: 비가역 파일 변경 확인 다이얼로그(포커스 트랩·ESC 는 ConfirmDialog) */}
      {confirmOpen && doc && (
        <ConfirmDialog title="정의 파일 저장 확인" onCancel={() => setConfirmOpen(false)}>
          <p className="muted">아래 정의 파일을 <b>비가역적으로 변경</b>합니다(직전 1개 백업 후 원자 교체). 취소하면 어떤 쓰기도 하지 않습니다.</p>
          <p><code className="path">{doc.sourcePath}</code></p>
          <DiffView before={doc.content} after={edited} />
          {err && <p className="banner err" role="alert">⚠ {err}</p>}
          <div className="modal-actions">
            <button onClick={() => setConfirmOpen(false)} disabled={saving}>취소 (변경 없음)</button>
            <button className="primary" disabled={saving} onClick={doSave}>{saving ? "저장 중…" : "저장 (파일 쓰기)"}</button>
          </div>
        </ConfirmDialog>
      )}
    </Card>
  );
}

// ── 5. Runs (A5·A6·A52 — 필터/검색/정렬/페이지·목록·상세) ──
// 서버 enum(schemas.ts RunState/Runtime) 과 정확히 일치.
const RUN_STATES = ["queued", "running", "blocked", "failed", "completed", "cancelled", "stale"] as const;
const RUNTIMES = ["claude", "codex"] as const;
const SORT_OPTS: Array<[RunsFilter["sort"], string]> = [
  ["recordedAt", "기록 시각"], ["updatedAt", "갱신 시각"], ["state", "상태"],
];
const stateKind = (s: string | null): "ok" | "err" | "warn" | "muted" =>
  s === "completed" ? "ok" : s === "failed" || s === "cancelled" ? "err" : s === "blocked" || s === "stale" ? "warn" : "muted";

// History = 하네스 구성 변경 이력(에이전트/스킬 추가·수정·삭제) — Build/Context 편집이 남긴 ledger(/api/config-changes).
type ConfigChange = { at: string; action: "create" | "edit" | "delete"; kind: "agent" | "skill"; name: string; runtime: string; path: string };
const CHANGE_ACTION: Record<string, { label: string; kind: "ok" | "warn" | "muted" }> = {
  create: { label: "추가", kind: "ok" }, edit: { label: "수정", kind: "muted" }, delete: { label: "삭제", kind: "warn" },
};
export function Runs() {
  const st = useApi<{ changes: ConfigChange[]; total: number }>("/api/config-changes");
  return (
    <div className="screen">
      <h2>History <span className="ver">구성 변경 이력</span></h2>
      <p className="lead">
        하네스 구성(에이전트·스킬)을 <b>추가·수정·삭제</b>한 기록. <a className="link" href="#/build">Build</a>에서 생성하거나
        <a className="link" href="#/context">Context</a>/<a className="link" href="#/agents">Agents</a>에서 편집하면 여기 남는다(읽기 전용).
      </p>
      <Card title="변경 기록 (최신순)">
        <Async state={st}>{(d) => d.changes.length === 0 ? (
          <div className="empty" role="status">
            <p className="muted">🧪 아직 구성 변경 기록이 없습니다.</p>
            <p className="muted">Build에서 에이전트/스킬을 생성하거나 정의를 편집하면 기록됩니다.</p>
          </div>
        ) : (
          <>
            <Table cols={["시각", "동작", "종류", "이름", "경로"]} rows={d.changes.map((c) => [
              c.at.replace("T", " ").slice(0, 19),
              <Badge kind={CHANGE_ACTION[c.action]?.kind ?? "muted"}>{CHANGE_ACTION[c.action]?.label ?? c.action}</Badge>,
              c.kind === "agent" ? "에이전트" : "스킬",
              c.name,
              <code className="path">{c.path}</code>,
            ])} />
            <p className="muted">총 {d.total}건 · UI에서 발생한 구성 변경만 기록(CLI 직접 변경은 미포함).</p>
          </>
        )}</Async>
      </Card>
    </div>
  );
}

// 필터바 — 텍스트/셀렉트 드래프트를 "검색"으로 일괄 적용(키스트로크 refetch 방지).
// filter prop 변경(칩 제거·초기화·페이지) 시에만 드래프트 재동기 → 입력 중 clobber 없음.
function FilterBar({ filter, onApply }: { filter: RunsFilter; onApply: (f: RunsFilter) => void }) {
  const [draft, setDraft] = useState<RunsFilter>(filter);
  useEffect(() => { setDraft(filter); }, [filter]);
  const set = (k: ChipField, v: string) => setDraft(setField(draft, k, v));
  // ISO(offset) ↔ datetime-local(YYYY-MM-DDTHH:mm) 표시 왕복.
  const toLocal = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); onApply({ ...draft, offset: 0 }); };
  return (
    <form className="filterbar" onSubmit={submit}>
      <label>상태
        <select value={draft.state ?? ""} onChange={(e) => set("state", e.target.value)}>
          <option value="">전체</option>
          {RUN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>런타임
        <select value={draft.runtime ?? ""} onChange={(e) => set("runtime", e.target.value)}>
          <option value="">전체</option>
          {RUNTIMES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>모드<input value={draft.mode ?? ""} maxLength={40} onChange={(e) => set("mode", e.target.value)} /></label>
      <label>에이전트<input value={draft.agent ?? ""} maxLength={120} onChange={(e) => set("agent", e.target.value)} /></label>
      <label>기록 시각(파일시스템) 이후<input type="datetime-local" value={toLocal(draft.from)} onChange={(e) => set("from", e.target.value ? new Date(e.target.value).toISOString() : "")} /></label>
      <label>기록 시각(파일시스템) 이전<input type="datetime-local" value={toLocal(draft.to)} onChange={(e) => set("to", e.target.value ? new Date(e.target.value).toISOString() : "")} /></label>
      <label className="grow">검색어<input value={draft.q ?? ""} maxLength={200} placeholder="목표·모드·에이전트·요청자" onChange={(e) => set("q", e.target.value)} /></label>
      <label>정렬
        <select value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value as RunsFilter["sort"], offset: 0 })}>
          {SORT_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </label>
      <button type="button" className="order-toggle" aria-label={`정렬 방향 — 현재 ${draft.order === "desc" ? "내림차순" : "오름차순"}`}
        onClick={() => setDraft(toggleOrder(draft))}>
        {draft.order === "desc" ? "↓ 내림차순" : "↑ 오름차순"}
      </button>
      <button type="submit">검색</button>
    </form>
  );
}

// 결과 카운트·절단 고지·mtime 비결정 고지·페이지네이션.
function ResultBar({ data, onPage }: { data: RunsQueryResult; onPage: (offset: number) => void }) {
  const range = pageRange(data);
  const notice = truncationNotice(data.truncatedReason);
  // 페이지 이동은 서버가 실제 적용한 offset/limit(clamp된) 기준 — 클라 filter.limit 로 오점프 방지.
  const prevDisabled = data.offset <= 0;
  const nextDisabled = !data.hasMore;
  return (
    <div className="resultbar">
      <div className="result-meta">
        <span className="count">총 {data.total}건{range && <span className="muted"> · {range.start}–{range.end} 표시</span>}</span>
        {notice && (
          <span className="trunc-warn" role="note" title={notice.tip}>
            ⚠ {notice.label} <span className="muted">— {notice.tip}</span>
          </span>
        )}
        {data.recordedAtSource === "mtime" && (
          <span className="src-note muted" title="일부 파일시스템은 생성시각 미지원 — 최근 상태갱신 시각 기준. 정렬·기간이 정확하지 않을 수 있음.">
            ⓘ 기록 시각 = mtime(정렬 비결정 가능)
          </span>
        )}
      </div>
      <div className="pager">
        <button disabled={prevDisabled} aria-label="이전 페이지" onClick={() => onPage(prevOffset(data))}>◂ 이전</button>
        <button disabled={nextDisabled} aria-label="다음 페이지" onClick={() => onPage(nextOffset(data))}>다음 ▸</button>
      </div>
    </div>
  );
}

// events 응답(서버 계약 readEvents: { items, nextAfter, hasMore, runState, schemaVersion }) → 표시 행(최근 30건).
// 서버 Event 스키마 필드는 `event`(≠ 구 `type`). 계약 미러 — shape 회귀 방지(테스트 고정).
export function runEventRows(e: { items: Array<{ seq: number; event: string; message?: string }> }): Array<{ seq: number; event: string; message: string }> {
  return e.items.slice(-30).map((x) => ({ seq: x.seq, event: x.event, message: x.message ?? "" }));
}

// ── U2 라이브 tail 훅 — running run 은 nextAfter 커서로 증분 폴링·append(중복 없음)·terminal 도달 시 중지 ──
// 정적 run(non-live)은 최초 1회 스냅샷 유지(기존 동작). 언마운트/runId 변경 시 clearTimeout(누수 0).
type EventItem = { seq: number; event: string; message?: string };
type EventsResp = { items: EventItem[]; nextAfter: number; hasMore: boolean; runState: string | null; schemaVersion: string };
type LiveEvents = { items: EventItem[]; runState: string | null; loading: boolean; err: string | null; tailing: boolean };

function useLiveEvents(runId: string): LiveEvents {
  const [items, setItems] = useState<EventItem[]>([]);
  const [runState, setRunState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tailing, setTailing] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = -1; // after exclusive: -1 → seq 0 포함
    let nonLiveStreak = 0; // 연속 비-live(null/unknown) 응답 수 — 좀비 방지 상한(HIGH#1)
    let drainStreak = 0;   // 연속 hasMore drain 수 — 0ms 타이트 루프 폭주 방지(HIGH#2)
    // 폴링마다 최신 상태 반영(setItems 함수형 업데이트로 append). first=true 는 최초 로드(3-state).
    const poll = async (first: boolean) => {
      const path = `/api/runs/${encodeURIComponent(runId)}/events?after=${cursor}&limit=1000`;
      try {
        const resp = await apiGet<EventsResp>(path);
        if (!live) return;
        cursor = nextEventCursor(cursor, resp);
        setItems((prev) => mergeEventItems(prev, resp.items));
        setRunState(resp.runState);
        setErr(null);
        if (first) setLoading(false);
        // HIGH#1: 중지는 명시적 terminal 에서만. null/unknown 은 계속 폴링(막 시작한 run 흡수).
        nonLiveStreak = isLiveRunState(resp.runState) ? 0 : nonLiveStreak + 1;
        const decision = tailDecision(resp.runState, nonLiveStreak);
        if (decision === "stop-terminal") { setTailing(false); return; } // terminal → 폴링 중지
        if (decision === "stop-nonlive-cap") { // 비-live 장시간 지속 → 좀비 방지 중지+안내
          setTailing(false);
          setErr("실행 상태를 확인할 수 없어 실시간 갱신을 중단했습니다 — 페이지를 새로고침하세요.");
          return;
        }
        setTailing(true);
        drainStreak = resp.hasMore ? drainStreak + 1 : 0; // backlog 연속 카운트(폭주 상한용)
        timer = setTimeout(() => poll(false), nextTailDelayMs(resp.hasMore, drainStreak)); // backlog 는 (상한 내)즉시, 아니면 주기
      } catch (e) {
        if (!live) return;
        if (first) { setErr(readErrorText(e)); setLoading(false); return; } // 최초 실패 → 에러 3-state
        drainStreak = 0;
        timer = setTimeout(() => poll(false), nextTailDelayMs(false)); // tail 중 일시 실패 → 주기 재시도(중단 안 함)
      }
    };
    // runId 변경 시 상태 리셋(stale 렌더 방지)
    setItems([]); setRunState(null); setLoading(true); setErr(null); setTailing(false);
    poll(true);
    return () => { live = false; if (timer) clearTimeout(timer); }; // 언마운트/재실행 시 타이머 정리(누수 0)
  }, [runId]);
  return { items, runState, loading, err, tailing };
}

function RunDetail({ runId }: { runId: string }) {
  const run = useApi<{ manifest: unknown; status: { state: string; exitCode: number | null; error: string | null } | null }>(`/api/runs/${encodeURIComponent(runId)}`);
  const ev = useLiveEvents(runId); // U2: running 은 라이브 tail, 정적 run 은 1회 스냅샷
  const ag = useApi<{ agents: Array<{ name: string; state: string }> }>(`/api/runs/${encodeURIComponent(runId)}/agents`);
  const arts = useApi<{ files: string[] }>(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
  const set = useApi<{ projectRoot: string }>("/api/settings");
  const [artName, setArtName] = useState<string | null>(null);
  const [artText, setArtText] = useState<string | null>(null);
  const [artErr, setArtErr] = useState<React.ReactNode>(null);
  const projectRoot = set.data?.projectRoot ?? "";
  // U2: live→terminal 전환 시 status/agents/artifacts 를 1회 재조회(최종 상태 정합). 정적 run 최초 로드 시 중복 fetch 방지(prev 가 live 였을 때만).
  const prevRunState = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevRunState.current;
    prevRunState.current = ev.runState;
    if (isLiveRunState(prev) && isTerminalRunState(ev.runState)) { run.reload(); ag.reload(); arts.reload(); }
  }, [ev.runState]); // eslint-disable-line react-hooks/exhaustive-deps
  const openArt = (name: string) => {
    setArtName(name); setArtText(null); setArtErr(null);
    fetchArtifact(runId, name)
      .then(setArtText)
      .catch((e) => {
        if (e instanceof DownloadTooLargeError)
          setArtErr(<>⚠ 파일이 너무 큼 · 로컬에서 열기: <code className="path">{localArtifactPath(projectRoot, runId, name)}</code></>);
        else setArtErr(<>불러오기 실패: {String(e)}</>);
      });
  };
  return (
    <Card title={runId.slice(0, 40)}>
      <Async state={run}>{(r) => (
        <p>상태: {r.status ? <Badge kind={r.status.state === "completed" ? "ok" : r.status.state === "failed" ? "err" : "muted"}>{r.status.state}</Badge> : "무효"} {r.status?.exitCode != null && `· exit ${r.status.exitCode}`}{r.status?.error && <span className="error"> · {r.status.error}</span>}</p>
      )}</Async>
      <Async state={ag}>{(a) => a.agents.length > 0 ? <Table cols={["에이전트", "상태"]} rows={a.agents.map((x) => [x.name, x.state])} /> : <p className="muted">에이전트 상태 없음</p>}</Async>
      {/* U2 이벤트 tail — A82/A84 3-state(로딩/에러+재시도/빈). live 이면 실시간 인디케이터. */}
      <div className="events-panel">
        <div className="events-head">
          <span className="muted">이벤트</span>
          {ev.tailing && <span className="live-tag" role="status" aria-live="polite" title="running run 을 실시간으로 tail 중입니다">🟢 실시간 (live)</span>}
          {isTerminalRunState(ev.runState) && <span className="muted" title="종료 상태 도달 — tail 중지">■ 종료됨</span>}
        </div>
        {ev.loading && ev.items.length === 0 ? <p className="muted">불러오는 중…</p>
          : ev.err ? <p className="error" role="alert">⚠ {ev.err}</p>
          : (() => { const rows = runEventRows({ items: ev.items }); return (
              <div className="events">{rows.length === 0 ? <p className="muted">이벤트 없음</p> : rows.map((x) => (
                <div key={x.seq} className="evline"><span className="seq">#{x.seq}</span> <b>{x.event}</b> {x.message}</div>
              ))}</div>
            ); })()}
      </div>
      {/* A83: 산출물 패널은 트리·이벤트와 독립 로딩. 한 산출물 실패(413/오류)가 다른 패널 미붕괴 */}
      <Async state={arts}>{(f) => f.files.length > 0 ? (
        <div>
          <p className="muted">산출물:</p>
          <div className="artlist">
            {f.files.map((name) => (
              <button key={name} className={"link" + (name === artName ? " on" : "")} aria-current={name === artName ? "true" : undefined}
                onClick={() => openArt(name)}>📄 {name}</button>
            ))}
          </div>
          {artErr && <p className="banner err" role="alert">{artErr}</p>}
          {artName && artText != null && !artErr && (
            <FileViewer model={{
              name: artName, content: artText, renderable: true, binary: false, truncated: false,
              size: artText.length, localPath: localArtifactPath(projectRoot, runId, artName),
              download: () => downloadArtifact(runId, artName),
            }} />
          )}
        </div>
      ) : <p className="muted">산출물 없음</p>}</Async>
    </Card>
  );
}

// ── F5 공유 뷰어 컴포넌트 (A59·A89·A98·DV8) ──
// docs 미리보기·run artifact 를 공통 렌더. 렌더↔raw 토글·다운로드·잘림/바이너리/413 배너. 읽기전용.
type ViewerModel = {
  name: string; content: string | null; renderable: boolean; binary: boolean;
  truncated: boolean; size: number; localPath: string; download: () => Promise<void>;
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileViewer({ model }: { model: ViewerModel }) {
  const mdEligible = isMarkdownName(model.name) && model.renderable && model.content != null;
  const [mode, setMode] = useState<"render" | "raw">(mdEligible ? "render" : "raw");
  const [dlErr, setDlErr] = useState<React.ReactNode>(null);
  const [busy, setBusy] = useState(false);
  // 파일 전환 시 토글/에러 초기화(A89 — 새 파일은 렌더 기본).
  useEffect(() => { setMode(mdEligible ? "render" : "raw"); setDlErr(null); }, [model.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const banner = viewerBanner(model);
  const doDownload = async () => {
    setBusy(true); setDlErr(null);
    try { await model.download(); }
    catch (e) {
      if (e instanceof DownloadTooLargeError)
        setDlErr(<>파일이 너무 큼({fmtBytes(e.size)} · 상한 {fmtBytes(e.max)}) — 로컬에서 열기: <code className="path">{model.localPath}</code></>);
      else setDlErr(<>다운로드 실패: {String(e)}</>);
    } finally { setBusy(false); }
  };
  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        {mdEligible && (
          <div className="seg-toggle" role="group" aria-label="표시 방식">
            <button className={mode === "render" ? "on" : ""} aria-pressed={mode === "render"} onClick={() => setMode("render")}>렌더</button>
            <button className={mode === "raw" ? "on" : ""} aria-pressed={mode === "raw"} onClick={() => setMode("raw")}>원문(raw)</button>
          </div>
        )}
        <span className="viewer-size muted">{fmtBytes(model.size)}</span>
        <button className="dl-btn" disabled={busy} onClick={doDownload}>{busy ? "다운로드 중…" : "⤓ 다운로드"}</button>
      </div>
      {model.truncated && <p className="banner warn" role="note">✂ 미리보기 잘림(상한까지 표시) · 전체 내용은 다운로드로 확인</p>}
      {dlErr && <p className="banner err" role="alert">⚠ {dlErr}</p>}
      {banner === "binary" && <p className="banner" role="note">⛔ 미리보기 불가(바이너리) · 다운로드로 확인</p>}
      {banner === "not-renderable" && <p className="banner" role="note">⛔ 미리보기 불가(이 형식) · 다운로드로 확인</p>}
      {!banner && model.content != null && (
        mode === "render" && mdEligible
          // DV8: renderMarkdown(markdown-it html:false + DOMPurify allowlist + scheme 화이트리스트 + img/svg 차단) 통과분만 주입.
          ? <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(model.content) }} />
          // raw/텍스트는 React escape(비실행).
          : <pre className="out">{model.content}</pre>
      )}
    </div>
  );
}

// 파일 트리(재귀·읽기전용·A89). 키보드 조작(button)·현재 선택 aria-current.
function DocTree({ nodes, selected, onSelect }: { nodes: DocsNode[]; selected: string | null; onSelect: (path: string) => void }) {
  return (
    <ul className="doctree" role="tree">
      {nodes.map((n) => n.type === "dir" ? (
        <li key={n.path} role="treeitem" aria-expanded="true">
          <span className="tree-dir">📁 {n.name}</span>
          {n.children.length > 0 && <DocTree nodes={n.children} selected={selected} onSelect={onSelect} />}
        </li>
      ) : (
        <li key={n.path} role="none">
          <button role="treeitem" className={"tree-file link" + (n.path === selected ? " on" : "")}
            aria-current={n.path === selected ? "true" : undefined} onClick={() => onSelect(n.path)}>📄 {n.name}</button>
        </li>
      ))}
    </ul>
  );
}

// 브레드크럼(A89) — 읽기전용 경로 표시.
function Breadcrumb({ rel, rootLabel = "docs" }: { rel: string; rootLabel?: string }) {
  const trail = breadcrumbTrail(rel, rootLabel);
  return (
    <nav className="breadcrumb" aria-label="파일 경로">
      {trail.map((t, i) => (
        <span key={t.path}>
          {i > 0 && <span className="sep" aria-hidden="true"> / </span>}
          <span className={i === trail.length - 1 ? "crumb cur" : "crumb"}>{t.name}</span>
        </span>
      ))}
    </nav>
  );
}

// docs 파일 미리보기 패널 — 트리와 독립 로딩(A83). 3-state. F9(M14): source 지정 시 소스별 열람(?source=).
function DocPanel({ rel, projectRoot, source, sourcePath, rootLabel }: {
  rel: string; projectRoot: string; source: string | null; sourcePath: string; rootLabel: string;
}) {
  const prev = useApi<DocPreview>(docPreviewPath(rel, source));
  return (
    <Card title={rel}>
      <Breadcrumb rel={rel} rootLabel={rootLabel} />
      <Async state={prev}>{(p) => (
        <FileViewer model={{
          name: p.name, content: p.content, renderable: p.renderable, binary: p.binary,
          truncated: p.truncated, size: p.size, localPath: localDocPath(projectRoot, rel, sourcePath),
          download: () => downloadDoc(rel, p.name, source),
        }} />
      )}</Async>
    </Card>
  );
}

// ── 6. Docs (F5·A53·A59·A89·A98 · F9 M14 다중 소스 A118·A120) ──
// 소스 목록(GET /api/docs/sources)을 먼저 조회 → 드롭다운·빈/무효 CTA(A120) 분기. 실제 트리/열람은 DocsBrowser 로 위임.
export function Docs() {
  const sources = useApi<DocsSourcesList>("/api/docs/sources");
  return (
    <div className="screen">
      <h2>Docs</h2>
      <Async state={sources}>{(p) => {
        const state = docsSourcesState(p);
        if (state === "disabled") return (
          <div className="empty" role="status">
            <p className="muted">📴 Docs 메뉴가 비활성화되어 있습니다.</p>
            <p className="muted">Settings → “Docs 소스” 에서 메뉴를 켜세요. <a className="link" href="#/settings">Settings 열기 →</a></p>
          </div>
        );
        if (state === "no-sources" || state === "all-invalid") return (
          <div className="empty" role="status">
            <p className="muted">📂 표시할 산출물 소스가 없습니다{state === "all-invalid" ? "(등록된 소스가 모두 무효)" : ""}.</p>
            <p className="muted">Settings 에서 문서 소스를 추가하세요. <a className="link" href="#/settings">Settings 에서 추가 →</a></p>
          </div>
        );
        return <DocsBrowser payload={p} />;
      }}</Async>
    </div>
  );
}

// 소스 선택 + 트리 + 미리보기. 소스 전환 시 선택 파일 초기화(stale 렌더 방지). ?source=/?path= 딥링크 왕복.
function DocsBrowser({ payload }: { payload: DocsSourcesList }) {
  const set = useApi<{ projectRoot: string }>("/api/settings");
  const [source, setSource] = useState<string | null>(() => pickDefaultSource(payload, focusSourceFromHash(location.hash)));
  const [sel, setSel] = useState<string | null>(() => focusDocFromHash(location.hash));
  const [q, setQ] = useState("");
  const tree = useApi<DocsTree>(source ? docsTreePath(source) : null);
  const cur = payload.sources.find((s) => s.id === source) ?? null;
  const sourcePath = cur?.path ?? "docs";
  const rootLabel = cur?.label ?? "docs";
  // 선택 소스/파일 → URL 반영(새로고침·공유 보존).
  useEffect(() => {
    history.replaceState(null, "", location.pathname + location.search + docsSourceDeepLink(source, sel));
  }, [source, sel]);
  const onSourceChange = (id: string) => { setSource(id); setSel(null); setQ(""); };
  return (
    <>
      <div className="doc-source-bar">
        <label className="doc-source-pick">📚 문서 소스
          <select value={source ?? ""} aria-label="문서 소스 선택"
            onChange={(e) => onSourceChange(e.target.value)}>
            {payload.sources.map((s) => (
              // 무효 소스는 표시하되 비활성 + 이유(A120). 색 비의존(⛔ 아이콘·텍스트 병기).
              <option key={s.id} value={s.id} disabled={!s.valid}
                title={s.valid ? s.path : `무효 소스(${s.path}) — Settings 에서 확인·수정 필요`}>
                {s.valid ? `${s.label} · ${s.path}` : `⛔ ${s.label} · ${s.path} (무효)`}
              </option>
            ))}
          </select>
        </label>
        <a className="link doc-source-manage" href="#/settings">소스 관리(Settings) →</a>
      </div>
      <div className="split resizable">
        {/* A83: 트리 패널은 미리보기와 독립 로딩. 미리보기 실패가 트리를 무너뜨리지 않음. 좌측 트리 최소폭 기본·마우스 리사이즈. */}
        <Card title={`문서 트리 · ${rootLabel} (읽기전용)`}>
          <Async state={tree}>{(t) => t.tree.length === 0 ? (
            <div className="empty" role="status"><p className="muted">📂 이 소스에 문서 없음</p></div>
          ) : (() => {
            const shown = filterDocTree(t.tree, q); // U6: 간단 트리 필터(부분일치·대소문자 무시)
            return (
              <>
                {t.truncated && <p className="banner warn" role="note">✂ 트리 절단 · {t.count}개까지 표시</p>}
                <label className="doc-filter">🔎 <input value={q} placeholder="파일 이름/경로 필터" maxLength={120}
                  aria-label="문서 트리 필터" onChange={(e) => setQ(e.target.value)} /></label>
                {shown.length === 0
                  ? <p className="muted" role="status">필터에 맞는 문서 없음</p>
                  : <DocTree nodes={shown} selected={sel} onSelect={setSel} />}
              </>
            );
          })()}</Async>
        </Card>
        {sel
          ? <DocPanel key={`${source}:${sel}`} rel={sel} source={source} sourcePath={sourcePath}
              rootLabel={rootLabel} projectRoot={set.data?.projectRoot ?? ""} />
          : <Card title="미리보기"><p className="muted">좌측에서 파일을 선택하세요.</p></Card>}
      </div>
    </>
  );
}

// ── 6. Drift (A4 · full + sync-plan 미리보기) ──
type Finding = { id: string; severity: string; runtime: string; paths: string[]; evidence: string; suggestedAction: string };
export function Drift() {
  const st = useApi<{ findings: Finding[] }>("/api/drift");
  const [plan, setPlan] = useState<string>("");
  const kind = (s: string) => s === "ok" ? "ok" : s === "stale" ? "warn" : "err";
  return (
    <div className="screen">
      <h2>Drift</h2>
      <button onClick={() => apiPost("/api/drift/sync-plan", {}).then((p) => setPlan(JSON.stringify(p, null, 2))).catch((e) => setPlan(String(e)))}>동기화 계획 미리보기(무변경)</button>
      {plan && <pre className="out">{plan}</pre>}
      <Async state={st}>{(d) => d.findings.length === 0 ? <div className="muted">drift 없음</div> : (
        <Table cols={["심각도", "런타임", "경로", "근거", "제안"]} rows={d.findings.map((f) => [
          <Badge kind={kind(f.severity) as "ok" | "warn" | "err"}>{f.severity}</Badge>, f.runtime, f.paths.join(", "), f.evidence, f.suggestedAction,
        ])} />
      )}</Async>
    </div>
  );
}

// ── 7. Ops (A7·A8) ──
export function Ops() {
  const st = useApi<{ updatedAt: string; runtimes: Record<string, { installed: boolean; version: string | null; health: string; authenticated: string }> }>("/api/ops/status");
  return (
    <div className="screen">
      <h2>Ops</h2>
      <Async state={st}>{(s) => (
        <Card title={`런타임 상태 · ${s.updatedAt.slice(0, 19)}`}>
          {/* usage/quota 컬럼 제거 — 비-TTY 서버서 상시 조회 불가(개선 불가·무의미)라 삭제. */}
          <Table cols={["런타임", "건강", "버전", "인증"]} rows={Object.entries(s.runtimes).map(([k, v]) => [
            k, <Badge kind={v.health === "ok" ? "ok" : "muted"}>{v.health}</Badge>, v.version ?? "—",
            v.authenticated === "조회 미지원" ? <span className="muted" title="agy는 CLI 비대화형 인증 조회를 지원하지 않습니다 · 설치·리뷰 사용은 정상">조회 미지원</span> : v.authenticated,
          ])} />
        </Card>
      )}</Async>
    </div>
  );
}

// ── A85/A99 확인 다이얼로그(A92 — 포커스 트랩·ESC·키보드) ──
// projectRoot 변경 = 비가역 config 쓰기이므로 dryRun 프리뷰 후 명시 확인 게이트. 취소 시 어떤 쓰기도 안 함(A101).
function ConfirmDialog({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const focusables = () => Array.from(
      box.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')
    ).filter((x) => !x.hasAttribute("disabled") && x.tabIndex !== -1);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onCancel(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      const first = f[0], last = f[f.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    box.addEventListener("keydown", onKey);
    return () => box.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cfm-title" ref={ref}>
        <h3 id="cfm-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ── F13(M-b) 공용·서브 스킬 섹션 (#/build · 읽기전용·분류·역인덱스) ──
function classBadge(c: SkillClassification): { kind: "ok" | "warn" | "muted"; label: string } {
  if (c === "orchestrator") return { kind: "ok", label: "오케스트레이터" };
  if (c === "shared-sub") return { kind: "muted", label: "공용 서브" };
  return { kind: "warn", label: "orphan(미사용)" };
}
function SkillUsageSection() {
  const st = useApi<SkillUsageList>("/api/skills-usage");
  return (
    <>
      <h3 className="lens-h">🧩 공용·서브 스킬 <span className="lens-tag muted">분류·사용 하네스(역인덱스)</span></h3>
      <Async state={st}>{(s) => s.skills.length === 0 ? <Card title="스킬"><p className="muted">스킬 없음.</p></Card> : (
        <Card title={`스킬 ${s.skills.length}개 — 분류·역인덱스`}>
          <Table cols={["스킬", "런타임", "분류", "사용 하네스", "편집"]} rows={s.skills.map((u) => {
            const b = classBadge(u.classification);
            return [
              u.skill,
              <span>{u.runtimes.map((r) => <Badge key={r} kind="muted">{r}</Badge>)}{u.runtimePaths.some((p) => p.startsWith(".agents")) && <span className="muted"> (공유)</span>}</span>,
              <Badge kind={b.kind}>{b.label}</Badge>,
              u.usedBy.length ? u.usedBy.join(", ") : <span className="muted">—</span>,
              u.editViaF7 ? <a className="link" href="#/skills">편집 →</a> : <span className="muted" title="현재 Claude 정의만 편집(F14 확장 예정)">읽기전용</span>,
            ];
          })} />
          <p className="muted">편집·생성·삭제는 <a className="link" href="#/skills">Skills</a>(F7)에서 — 중복 편집기 금지. <b>orphan</b> = 어느 하네스도 안 쓰는 스킬.</p>
        </Card>
      )}</Async>
    </>
  );
}

// ── Factory (F11 — myharness 설치·업데이트·유지관리) ──
function skillStateLabel(s: SkillState): { badge: "ok" | "warn" | "muted" | "err"; text: string } {
  if (s.kind === "absent") return { badge: "muted", text: "미설치" };
  if (s.kind === "symlink") return s.synced ? { badge: "ok", text: "설치됨 · 최신(정본 심링크)" } : { badge: "warn", text: "심링크가 다른 곳 — 재연결 권장" };
  if (s.kind === "copy") return { badge: "warn", text: "설치됨 · 복사본(옛 버전일 수 있음) — 업데이트 권장" };
  return { badge: "err", text: "예기치 않은 형태(파일 등)" };
}
const skillSynced = (s: SkillState) => s.kind === "symlink" && s.synced;
// 적용 결과 method → 사람 문구.
function methodText(m: string): string {
  return m === "symlink" ? "심링크 연결" : m === "copy" ? "복사 설치" : m === "removed" ? "제거" : m === "noop" ? "이미 최신(변경 없음)" : m;
}
// 복사 버튼 — 클립보드 없으면 조용히 미노출(로컬 dev·안전). 실패 시 피드백.
function CopyBtn({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  if (typeof navigator === "undefined" || !navigator.clipboard) return null;
  const onClick = async () => {
    try { await navigator.clipboard.writeText(text); setState("done"); }
    catch { setState("fail"); }
    setTimeout(() => setState("idle"), 1500);
  };
  return <button className="fac-copy" onClick={onClick} aria-label="명령 복사">
    {state === "done" ? "복사됨 ✓" : state === "fail" ? "복사 실패" : "복사"}
  </button>;
}

function FactoryTargetCard({ title, dest, state, enabled, onApply, busy, pendingAction }: {
  title: string; dest: string; state: SkillState; enabled: boolean; busy: boolean;
  pendingAction: FactoryAction | null; onApply: (action: FactoryAction) => void;
}) {
  const lbl = skillStateLabel(state);
  const installed = state.kind !== "absent";
  const synced = skillSynced(state);
  const btnText = (action: FactoryAction, label: string) => (pendingAction === action ? "처리 중…" : label);
  return (
    <Card title={title}>
      <p><Badge kind={lbl.badge}>{lbl.text}</Badge></p>
      <p className="muted mono">{dest}</p>
      <div className="row fac-actions" style={{ gap: 8, flexWrap: "wrap" }}>
        {!installed && <button className="primary" disabled={!enabled || busy} onClick={() => onApply("install")}>{btnText("install", "설치")}</button>}
        {installed && synced && <span className="fac-latest" title="이미 정본과 동기됨">최신 ✓</span>}
        {installed && !synced && <button disabled={!enabled || busy} onClick={() => onApply("update")}>{btnText("update", "업데이트(재동기)")}</button>}
        {installed && <button className="danger" disabled={!enabled || busy} onClick={() => onApply("remove")}>{btnText("remove", "제거")}</button>}
      </div>
    </Card>
  );
}

// #/build 상단 상주 카드(모드 스위치 아님). 미설치=강조·펼침 / 설치·최신=얇은 스트립.
//   build 는 factory 설치와 무관하게 동작 — 이 카드는 안내·유지관리일 뿐 build 를 막지 않는다.
export function FactoryPanel() {
  const st = useApi<FactoryStatus>("/api/factory/status");
  const [pending, setPending] = useState<{ target: FactoryTarget; action: FactoryAction } | null>(null);
  const [toggling, setToggling] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false); // 관리 상세 펼침(설치돼 있으면 기본 접힘)
  // useApi 는 reload 시 data 를 null 로 비운다 → 마지막 상태를 캐시해 재조회 중 카드/메시지 소멸 방지.
  const [cached, setCached] = useState<FactoryStatus | null>(null);
  useEffect(() => { if (st.data) setCached(st.data); }, [st.data]);
  // 재조회(st.loading) 중에도 버튼 잠금 유지 → 성공 후 stale 버튼 재클릭 경쟁 차단.
  const busy = pending !== null || toggling || st.loading;

  const toggleMaint = async (enabled: boolean) => {
    if (busy) return; // 쓰기 진행 중 게이트 변경 금지
    setToggling(true); setMsg(null);
    try { await setFactoryMaintenance(enabled); st.reload(); }
    catch (e) { setMsg({ ok: false, text: "유지관리 토글 실패: " + readErrorText(e) }); } finally { setToggling(false); }
  };
  const apply = async (target: FactoryTarget, action: FactoryAction) => {
    const label = target === "claude-skill" ? "Claude 글로벌 스킬" : "Codex 글로벌 스킬";
    const verb = action === "install" ? "설치" : action === "update" ? "업데이트" : "제거";
    if (action === "remove" && !window.confirm(`${label} 을(를) 제거할까요?\n(실물 디렉토리는 하드삭제 없이 백업 후 이동됩니다.)`)) return;
    setOpen(true); // 결과를 계속 보이도록 상세 유지(설치 성공→installed 로 자동 접힘 방지)
    setPending({ target, action }); setMsg(null);
    try {
      const r = await applyFactory(target, action, action === "remove" ? true : undefined);
      // 낙관적 캐시 패치(codex R2): 재조회 전/실패해도 배지가 결과와 즉시 일치(제거 후 '설치됨' 모순 방지).
      const key = target === "claude-skill" ? "claudeSkill" : "codexSkill";
      setCached((prev) => (prev ? { ...prev, targets: { ...prev.targets, [key]: r.state } } : prev));
      setMsg({ ok: true, text: `${label} ${verb} 완료 · ${methodText(r.method)}${r.backup ? ` (기존은 백업됨)` : ""}` });
      st.reload();
    } catch (e) {
      setMsg({ ok: false, text: `${label} ${verb} 실패: ${readErrorText(e)}` });
    } finally { setPending(null); }
  };
  const pendingFor = (target: FactoryTarget): FactoryAction | null =>
    pending && pending.target === target ? pending.action : null;

  const s = st.data ?? cached; // 재조회 중엔 캐시로 유지
  if (!s) { // 최초 로딩 or 에러(캐시 없음)
    if (st.err) return (
      <section className="fac-strip"><div className="fac-strip-head">
        <Badge kind="warn">팩토리 상태 조회 실패</Badge><span className="muted">{st.err}</span>
      </div></section>
    );
    return null; // 로딩 중 — 조용히
  }
  if (!s.isFactoryRepo) return null; // 비팩토리 레포 → 숨김(build 는 계속 동작)

  // 설치 여부(어떤 방식이든) + 주의 필요(미설치·마켓 구버전·비동기 복사본).
  const installed = s.targets.marketplace.installed || s.targets.claudeSkill.kind !== "absent" || s.targets.codexSkill.kind !== "absent";
  const attention = !installed || s.targets.marketplace.updateAvailable
    || (s.targets.claudeSkill.kind !== "absent" && !skillSynced(s.targets.claudeSkill))
    || (s.targets.codexSkill.kind !== "absent" && !skillSynced(s.targets.codexSkill));
  const expanded = open || !installed; // 미설치면 강제 펼침(온보딩 강조)
  const summary = !installed ? "팩토리(myharness) 미설치" : attention ? "팩토리 점검 필요" : "팩토리 최신 ✓";
  const summaryKind: "ok" | "warn" = !installed || attention ? "warn" : "ok";
  const toggleLabel = expanded ? "접기" : attention ? "업데이트 · 관리" : "관리";

  return (
    <section className={"fac-strip" + (expanded ? " open" : "")}>
      <div className="fac-strip-head">
        <Badge kind={summaryKind}>{summary}</Badge>
        <span className="muted">정본 myharness {s.sourceVersion ?? "?"}</span>
        {st.err && <span className="fac-stale" title={st.err}>· 상태 재조회 실패(캐시 표시)</span>}
        <span className="grow" />
        <button className="fac-toggle" onClick={() => setOpen((o) => !o)} disabled={!installed}
          aria-expanded={expanded} aria-controls="fac-detail">{toggleLabel}</button>
      </div>
      {expanded && <div className="fac-detail" id="fac-detail">
        {!installed && <p className="fac-lead">이 하네스를 찍어내는 <b>팩토리(myharness)</b>를 설치하면 Claude Code/Codex에서 하네스를 직접 만들 수 있습니다. (웹 자동 빌드는 설치 없이도 동작합니다.)</p>}
        {msg && <p className={msg.ok ? "fac-msg ok" : "fac-msg err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
        <Card title="유지관리 게이트">
          <p className="muted">설치·업데이트·제거는 HOME(<span className="mono">~/.claude</span>·<span className="mono">~/.codex</span>)에 스킬 파일을 씁니다. 안전을 위해 기본 잠금.</p>
          <label className={"fac-gate" + (s.maintenanceEnabled ? "" : " locked")} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={s.maintenanceEnabled} disabled={busy} onChange={(e) => toggleMaint(e.target.checked)} />
            <span>{s.maintenanceEnabled ? "유지관리 허용됨 — 아래 버튼 사용 가능" : "🔒 잠김 — 설치·업데이트하려면 여기를 켜세요"}</span>
          </label>
        </Card>
        <FactoryTargetCard title="Claude Code · 글로벌 스킬" dest="~/.claude/skills/myharness"
          state={s.targets.claudeSkill} enabled={s.maintenanceEnabled} busy={busy}
          pendingAction={pendingFor("claude-skill")} onApply={(a) => apply("claude-skill", a)} />
        <FactoryTargetCard title="Codex · 글로벌 스킬" dest="~/.codex/skills/myharness"
          state={s.targets.codexSkill} enabled={s.maintenanceEnabled} busy={busy}
          pendingAction={pendingFor("codex-skill")} onApply={(a) => apply("codex-skill", a)} />
        <Card title="Claude Code · marketplace 플러그인">
          {s.targets.marketplace.installed ? <>
            <p><Badge kind={s.targets.marketplace.updateAvailable ? "warn" : "ok"}>
              {s.targets.marketplace.updateAvailable ? `업데이트 가능 (${s.targets.marketplace.version} → ${s.sourceVersion})` : `설치됨 (${s.targets.marketplace.version})`}
            </Badge></p>
            <p className="muted">marketplace 플러그인은 앱이 직접 갱신할 수 없습니다. Claude Code 에서 실행:</p>
            <p className="fac-cmd"><span className="mono">/plugin update myharness</span><CopyBtn text="/plugin update myharness" /></p>
          </> : <p className="muted">marketplace 플러그인 미설치(감지 안 됨). 필요하면 Claude Code <code>/plugin install</code>, 또는 위 글로벌 스킬로 설치.</p>}
        </Card>
        <p className="muted">참고: marketplace 플러그인과 글로벌 스킬을 <b>동시에</b> 두면 같은 이름 스킬이 중복될 수 있습니다. 하나를 선택하세요.</p>
      </div>}
    </section>
  );
}

// ── 8. Settings (F3 M11 — projectRoot 편집·A68~A71·A85·A94·A97·A99·A101) ──
export function Settings() {
  const st = useApi<SettingsInfo>("/api/settings");
  return (
    <div className="screen">
      <h2>Settings</h2>
      {/* A83: 현재값·편집폼이 하나의 3-state 로 — 조회 실패가 화면 전체를 무너뜨리지 않음 */}
      <Async state={st}>{(s) => <SettingsBody info={s} onSaved={st.reload} />}</Async>
    </div>
  );
}

function SettingsBody({ info, onSaved }: { info: SettingsInfo; onSaved: () => void }) {
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<ProjectRootPreview | null>(null); // dryRun 프리뷰(확인 다이얼로그 오픈 트리거)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);   // 검증(dryRun) 인라인 에러
  const [savedAt, setSavedAt] = useState<string | null>(null); // 저장 성공 토스트

  const provisioned = info.projectsHomeProvisioned;

  // "검증" → dryRun:true 프리뷰(디스크 미변경). 성공 시 확인 다이얼로그 오픈. 400/409 → 한국어 인라인(A5).
  const doValidate = async () => {
    setBusy(true); setErr(null); setSavedAt(null); setPreview(null);
    try {
      const r = await postProjectRoot(path.trim(), true);
      if ("ok" in r) setPreview(r); // dryRun 응답(written:false)
    } catch (e) {
      if (e instanceof ProjectRootError) setErr(projectRootErrorText(e.code, e.status));
      else setErr(String(e));
    } finally { setBusy(false); }
  };

  return (
    <>
      <Card title="설정">
        <Table cols={["항목", "값"]} rows={[
          ["projectRoot (현재 유효값)", <code className="path">{info.projectRoot}</code>],
          ["projectsHome (경계)", info.projectsHome ? <code className="path">{info.projectsHome}</code> : <Badge kind="warn">미설정</Badge>],
          ["정의 편집", info.definitionEditEnabled ? <Badge kind="warn">활성</Badge> : <Badge kind="ok">비활성</Badge>],
          ["파일수정 API", info.mutationEnabled ? <Badge kind="warn">활성</Badge> : <Badge kind="ok">비활성(조회 전용)</Badge>],
        ]} />
      </Card>

      {/* W-D/A97: 미프로비저닝 → 편집 폼 비활성 + 정확한 프로비저닝 액션(데드엔드 방지) */}
      {!provisioned ? (
        <Card title="프로젝트 경로 편집 (사용 불가)">
          <div className="banner warn" role="note">
            <p>⚠ 프로젝트 경계가 아직 프로비저닝되지 않았습니다.</p>
            <p className="muted">
              편집을 활성화하려면 <code className="path">HARNESS_PROJECTS_HOME</code> 환경변수로 프로젝트 경계를 지정하고 서버를 재시작하세요.
            </p>
            {info.projectsHome && (
              <p className="muted">감지된 경로 후보: <code className="path">{info.projectsHome}</code></p>
            )}
          </div>
          <fieldset className="form" disabled aria-disabled="true">
            <label className="full">프로젝트 루트 경로
              <input value="" placeholder="경계 프로비저닝 후 사용 가능" readOnly />
            </label>
          </fieldset>
        </Card>
      ) : (
        <Card title="프로젝트 경로 편집 (재시작 후 반영)">
          <div className="form">
            <label className="full">새 프로젝트 루트 경로 (절대경로)
              <input value={path} onChange={(e) => { setPath(e.target.value); setErr(null); }}
                placeholder={info.projectsHome ? `${info.projectsHome}/…` : "/absolute/path/to/project"}
                aria-invalid={err ? "true" : undefined} maxLength={4096} spellCheck={false} />
            </label>
            <p className="muted full">경계(projectsHome) 하위의 하네스 디렉토리만 허용됩니다 · 검증(미리보기) 후 확인해야 저장됩니다(디스크 미변경).</p>
            <button className="primary" disabled={busy || !path.trim()} onClick={doValidate}>
              {busy && !preview ? "검증 중…" : "검증 (미리보기)"}
            </button>
          </div>
          {err && <p className="banner err" role="alert">⚠ {err}</p>}
          {savedAt && (
            <p className="banner ok" role="status">✓ 저장됨 · 재시작 후 반영됩니다 ({savedAt.slice(0, 19)})</p>
          )}
        </Card>
      )}

      {/* F7 A78/A85: 정의 편집 게이트 토글 — off 기본·고위험 인지 후 활성. off 시 편집기 뷰어 전용 */}
      <DefinitionEditToggle enabled={info.definitionEditEnabled} onSaved={onSaved} />

      {/* F9 A118/A119: Docs 소스 편집기 + 메뉴 토글 — 자체 3-state(GET /api/docs/sources). 조회 실패가 상단 설정을 무너뜨리지 않음 */}
      <DocsSourcesEditor />

      {/* A85/A99/A101: dryRun 프리뷰 확인 다이얼로그 → "저장"=dryRun:false 쓰기. 취소 시 어떤 쓰기도 안 함 */}
      {preview && (
        <ProjectRootConfirm
          path={path.trim()}
          preview={preview}
          onCancel={() => setPreview(null)}
          onSaved={(appliedAt) => { setPreview(null); setSavedAt(appliedAt); setPath(""); onSaved(); }}
        />
      )}
    </>
  );
}

// A85/A99/A101 확인 다이얼로그 — 프리뷰 결과 표시 + activeRunsWarning>0 시 2선택 + "저장"(dryRun:false).
function ProjectRootConfirm({ path, preview, onCancel, onSaved }: {
  path: string; preview: ProjectRootPreview; onCancel: () => void; onSaved: (appliedAt: string) => void;
}) {
  const warn = preview.activeRunsWarning;
  const [choice, setChoice] = useState<OrphanChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doSave = async () => {
    setBusy(true); setErr(null);
    try {
      // A99 (a): 활성 run 취소 후 재시작(cancel 경로 재사용) → 그다음 실제 쓰기.
      if (choice === "cancel-first") await cancelActiveRuns();
      const r = await postProjectRoot(path, false); // dryRun:false = 실제 config 쓰기
      if ("accepted" in r) onSaved(r.appliedAt);
    } catch (e) {
      if (e instanceof ProjectRootError) setErr(projectRootErrorText(e.code, e.status));
      else setErr(String(e));
    } finally { setBusy(false); }
  };

  return (
    <ConfirmDialog title="프로젝트 루트 변경 확인" onCancel={onCancel}>
      <p className="muted">아래 경로로 <b>config 를 변경</b>합니다. 이 변경은 <b>서버 재시작 후</b> 반영됩니다(라이브 재바인딩 아님).</p>
      <Table cols={["항목", "값"]} rows={[
        ["적용될 유효 루트", <code className="path">{preview.effectiveRoot}</code>],
        ["재시작 필요", "예 (requiresRestart)"],
        ["활성 run", warn > 0 ? <Badge kind="warn">{warn}건</Badge> : <Badge kind="ok">없음</Badge>],
      ]} />

      {/* W-B1/A99: activeRunsWarning>0 일 때만 2선택 명시(과경고 금지) */}
      {requiresOrphanChoice(warn) && (
        <fieldset className="form" style={{ marginTop: 12 }}>
          <legend>실행 중 작업 처리 (선택 필요)</legend>
          <label className="check">
            <input type="radio" name="orphan" checked={choice === "cancel-first"}
              onChange={() => setChoice("cancel-first")} />
            활성 run 취소 후 재시작 (통제 유지 · 진행 중 {warn}건을 취소)
          </label>
          <label className="check">
            <input type="radio" name="orphan" checked={choice === "headless-continue"}
              onChange={() => setChoice("headless-continue")} />
            헤드리스 계속 승인 (⚠ 통제 상실 · 재시작 후에도 계속 실행되어 API 토큰이 소진될 수 있음)
          </label>
        </fieldset>
      )}

      {err && <p className="banner err" role="alert">⚠ {err}</p>}

      <div className="modal-actions">
        <button onClick={onCancel} disabled={busy}>취소 (변경 없음)</button>
        <button className="primary" disabled={busy || !canSave(warn, choice)} onClick={doSave}>
          {busy ? "저장 중…" : "저장 (config 쓰기)"}
        </button>
      </div>
    </ConfirmDialog>
  );
}

// F7 A78/A85 — 정의 편집 게이트 토글. off 기본(fail-closed). 켜기 = 고위험(첫 파일 쓰기 기능) → 확인 다이얼로그.
// 끄기는 위험 감소이므로 직접 적용. off 시 편집기 뷰어 전용(GET editable=false → PUT/rollback 403).
function DefinitionEditToggle({ enabled, onSaved }: { enabled: boolean; onSaved: () => void }) {
  const [confirmOn, setConfirmOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = async (next: boolean) => {
    setBusy(true); setErr(null);
    try {
      await setDefinitionEdit(next);
      setConfirmOn(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof DefEditError ? defEditErrorText(e.code, e.status, e.detail) : String(e));
    } finally { setBusy(false); }
  };

  return (
    <Card title="정의 편집 허용 (고위험)">
      <p className="muted">
        {enabled ? <><Badge kind="warn">활성</Badge> 에이전트/스킬 정의 파일(.claude) 편집이 허용됩니다.</>
                 : <><Badge kind="ok">비활성</Badge> 편집기는 뷰어 전용입니다(파일 쓰기 불가).</>}
      </p>
      <div className="detail-actions">
        {enabled
          ? <button disabled={busy} onClick={() => apply(false)}>{busy ? "적용 중…" : "정의 편집 끄기 (뷰어 전용으로)"}</button>
          : <button className="primary" disabled={busy} onClick={() => { setErr(null); setConfirmOn(true); }}>정의 편집 켜기…</button>}
      </div>
      {err && <p className="banner err" role="alert">⚠ {err}</p>}

      {/* A85: 활성화는 첫 파일 쓰기 기능 → 고위험 명시 확인 게이트 */}
      {confirmOn && (
        <ConfirmDialog title="정의 편집 활성화 확인 (고위험)" onCancel={() => setConfirmOn(false)}>
          <p className="muted">
            정의 편집을 켜면 UI 에서 <b>.claude 정의 파일(에이전트/스킬)을 직접 수정</b>할 수 있게 됩니다.
            이는 읽기전용 원칙의 유일한 예외이며 <b>파일이 곧 실행 정의</b>이므로 손상 시 실행에 직접 영향을 줍니다.
          </p>
          <p className="warn-text">⚠ 편집자=실행자 전제(로컬 단일 사용자). 저장은 원자 교체·직전 1개 백업으로 되돌릴 수 있습니다.</p>
          {err && <p className="banner err" role="alert">⚠ {err}</p>}
          <div className="modal-actions">
            <button onClick={() => setConfirmOn(false)} disabled={busy}>취소</button>
            <button className="primary" disabled={busy} onClick={() => apply(true)}>{busy ? "적용 중…" : "활성화"}</button>
          </div>
        </ConfirmDialog>
      )}
    </Card>
  );
}

// ── F9 A118/A119 Docs 소스 편집기 + 메뉴 토글 ──
// 자체 3-state(GET /api/docs/sources). 소스 목록(라벨+경로·추가/삭제/재정렬)·dryRun 검증(per-소스 인라인)·저장.
// 저장은 요청마다 서버가 재검증(무효 400·config 미기록). dryRun 은 디스크 미변경 프리뷰(A119).
export function DocsSourcesEditor() {
  const st = useApi<DocsSourcesList>("/api/docs/sources");
  return (
    <Card title="문서(산출물) 소스">
      <Async state={st}>{(p) => <DocsSourcesForm initial={p} onSaved={st.reload} />}</Async>
    </Card>
  );
}

function DocsSourcesForm({ initial, onSaved }: { initial: DocsSourcesList; onSaved: () => void }) {
  const [rows, setRows] = useState<SourceRow[]>(() => initial.sources.map((s) => ({ label: s.label, path: s.path })));
  const [menuOn, setMenuOn] = useState<boolean>(initial.enabled);
  const [busy, setBusy] = useState<"" | "validate" | "save">("");
  const [preview, setPreview] = useState<DryRunSource[] | null>(null); // dryRun 결과(per-소스 인라인)
  const [err, setErr] = useState<string | null>(null);                 // 폼 전역 에러(bad-input 등)
  const [saved, setSaved] = useState(false);                           // 저장 성공 토스트(A85)

  const localValid = rowsLocallyValid(rows);
  const errByPath = preview ? dryRunErrorByPath(preview) : {};
  const previewOk = preview ? allSourcesValid(preview) : false;

  const setRow = (i: number, patch: Partial<SourceRow>) => {
    setRows((r) => updateSourceRow(r, i, patch)); setPreview(null); setSaved(false); setErr(null);
  };
  const reorder = (i: number, dir: -1 | 1) => { setRows((r) => moveSourceRow(r, i, dir)); setPreview(null); setSaved(false); };
  const remove = (i: number) => { setRows((r) => removeSourceRow(r, i)); setPreview(null); setSaved(false); };
  const add = () => { setRows((r) => addSourceRow(r)); setPreview(null); setSaved(false); };

  // dryRun 검증(디스크 미변경) — per-소스 valid/error 인라인(A119).
  const doValidate = async () => {
    setBusy("validate"); setErr(null); setSaved(false); setPreview(null);
    try {
      const r = await postDocsSources({ docsSources: toPayloadSources(rows), docsMenuEnabled: menuOn, dryRun: true });
      if ("sources" in r) setPreview(r.sources);
    } catch (e) {
      setErr(e instanceof DocsSourcesError ? docsSourceErrorText(e.code, e.status) : String(e));
    } finally { setBusy(""); }
  };

  // 저장(dryRun:false) — 서버 재검증·무효면 400(config 미기록). invalid 배열을 per-경로 인라인으로 승격.
  const doSave = async () => {
    setBusy("save"); setErr(null); setSaved(false);
    try {
      const r = await postDocsSources({ docsSources: toPayloadSources(rows), docsMenuEnabled: menuOn, dryRun: false });
      if ("written" in r && r.written) {
        // 서버 canonical 결과로 폼 재동기화(R5 codex LOW): 중복·lexical-equivalent 병합·정규화된 저장본을 반영
        // → 저장 배너와 실제 저장본 불일치 제거.
        if (Array.isArray(r.docsSources)) setRows(r.docsSources.map((s) => ({ label: s.label, path: s.path })));
        if (typeof r.docsMenuEnabled === "boolean") setMenuOn(r.docsMenuEnabled);
        setSaved(true); setPreview(null); onSaved();
      }
    } catch (e) {
      if (e instanceof DocsSourcesError) {
        // invalid(경로별) → dryRun 프리뷰 형태로 인라인 표시 재사용. 그 외(bad-input) → 폼 전역.
        if (e.invalid && e.invalid.length) {
          setPreview(e.invalid.map((x) => ({ id: x.path, label: "", path: x.path, valid: false, error: x.error })));
          setErr(docsSourceErrorText(e.code, e.status));
        } else setErr(docsSourceErrorText(e.code, e.status));
      } else setErr(String(e));
    } finally { setBusy(""); }
  };

  return (
    <>
      {/* A118: Docs 메뉴 on/off 스위치(색 비의존·라벨 병기·키보드). off = 사이드바 Docs 비활성 */}
      <label className="check docs-menu-toggle">
        <input type="checkbox" checked={menuOn} role="switch" aria-checked={menuOn}
          onChange={(e) => { setMenuOn(e.target.checked); setSaved(false); }} />
        Docs 메뉴 표시 {menuOn ? <Badge kind="ok">켜짐</Badge> : <Badge kind="muted">꺼짐(사이드바 숨김)</Badge>}
      </label>

      <p className="muted full">각 소스는 라벨 + projectRoot 하위 상대경로입니다(예: <code>docs</code>·<code>documentation/api</code>). 절대경로·<code>..</code>·심링크는 거부됩니다.</p>

      {rows.length === 0
        ? <p className="muted" role="status">등록된 소스가 없습니다 · “소스 추가”로 문서 폴더를 등록하세요(비우면 Docs 화면이 빈 상태가 됩니다).</p>
        : (
          <ul className="docs-source-list">
            {rows.map((row, i) => {
              const issue = rowIssue(row);
              const perr = errByPath[row.path.trim()]; // dryRun/저장 거부의 per-경로 에러(undefined=미검증)
              return (
                <li key={i} className="docs-source-row">
                  <input className="src-label" value={row.label} placeholder="라벨" maxLength={MAX_DOCS_LABEL_LEN}
                    aria-label={`소스 ${i + 1} 라벨`} onChange={(e) => setRow(i, { label: e.target.value })} />
                  <input className="src-path path" value={row.path} placeholder="상대경로 (예: docs)" maxLength={MAX_DOCS_PATH_LEN}
                    spellCheck={false} aria-label={`소스 ${i + 1} 경로`}
                    aria-invalid={issue || perr ? "true" : undefined} onChange={(e) => setRow(i, { path: e.target.value })} />
                  <div className="src-actions">
                    <button type="button" aria-label={`소스 ${i + 1} 위로`} disabled={i === 0} onClick={() => reorder(i, -1)}>↑</button>
                    <button type="button" aria-label={`소스 ${i + 1} 아래로`} disabled={i === rows.length - 1} onClick={() => reorder(i, 1)}>↓</button>
                    <button type="button" aria-label={`소스 ${i + 1} 삭제`} onClick={() => remove(i)}>✕ 삭제</button>
                  </div>
                  {/* 인라인 유효성: 로컬(빈/길이) 우선, 그다음 서버 dryRun/저장 거부(A119 한국어) */}
                  {issue && <p className="src-issue err" role="alert">⚠ {rowIssueText(issue)}</p>}
                  {!issue && perr && <p className="src-issue err" role="alert">⚠ {docsSourceErrorText(perr)}</p>}
                  {!issue && preview && perr === null && <p className="src-issue ok" role="status">✓ 유효</p>}
                </li>
              );
            })}
          </ul>
        )}

      <div className="detail-actions">
        <button type="button" disabled={!canAddSource(rows)} onClick={add}>＋ 소스 추가</button>
        <button type="button" disabled={busy !== "" || !localValid} onClick={doValidate}>
          {busy === "validate" ? "검증 중…" : "검증 (미리보기)"}
        </button>
        <button className="primary" type="button" disabled={busy !== "" || !localValid || !previewOk} onClick={doSave}>
          {busy === "save" ? "저장 중…" : "저장 (config 쓰기)"}
        </button>
      </div>
      <p className="muted full">저장하려면 먼저 “검증(미리보기)”으로 모든 소스가 유효해야 합니다(디스크 미변경). 무효 소스가 있으면 저장이 거부됩니다.</p>

      {err && <p className="banner err" role="alert">⚠ {err}</p>}
      {preview && previewOk && !saved && <p className="banner ok" role="status">✓ 모든 소스 유효 · 저장할 수 있습니다.</p>}
      {saved && <p className="banner ok" role="status">✓ 소스 설정이 저장되었습니다(즉시 반영 · 재시작 불필요).</p>}
    </>
  );
}

// ── 9. Eval (F8 M13 · 축소안 — Part A 읽기 · Part B 제안(자동금지) · Part C config) ──
// 교리: alignment≠품질 · 자동 적용 절대 없음(제안+사람 승인만) · floor 미만 저장 불가 · 단계4 잠금.
// XSS: scorecard 자유 텍스트(warnings·termination_reason 등)는 데이터(지시 흡수 금지). 렌더 정책 2분기:
//   - 표(loop index·trend)의 terminationReason: terminationExcerpt(evals.ts)로 제어문자 제거·개행 단일화·N자 절단
//     → React text 노드 escape(실행 불가·표 레이아웃 방어). 긴 마크다운은 표에 부적합.
//   - 상세(ScorecardDetailCard)의 termination_reason/warnings 전문: SafeMd(render.ts DV8 sanitizer) 통과.

const fmtMs = (ms: number): string => {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 19).replace("T", " ");
};

// A90/A103 정합도 배지 — "정합도(품질 아님)" + 산정식 툴팁(색 비의존·텍스트 병기).
function AlignmentBadgeLegend({ formula }: { formula: string }) {
  return (
    <span className="align-legend" role="note" tabIndex={0} title={formula}
      aria-label={`정합도(품질 아님) · 산정식 ${formula}`}>
      📐 정합도(품질 아님) <span className="muted">— {formula}</span>
    </span>
  );
}

// verified:false → "미검증" 배지(사유 툴팁). true → "검증됨"(재도출 일치).
function VerifiedBadge({ verified, reason }: { verified: boolean; reason?: string | null }) {
  return verified
    ? <Badge kind="ok">✓ 검증됨</Badge>
    : <span title={reason ?? "검증 실패 또는 불가"}><Badge kind="warn">⚠ 미검증</Badge></span>;
}

// scorecard 자유 텍스트 = 데이터(지시 흡수 금지). DV8 파이프라인(markdown-it html:false + DOMPurify)만 통과분 주입.
function SafeMd({ text }: { text: string }) {
  return <div className="md-body scorecard-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

type ScFinding = { id: string; type: string; subject: string; subject_kind: string; target?: string; runtime: string; severity: string; provenance: string; waived: boolean; waiver_expires_at?: string; waiver_reason?: string; detail?: string };
type HarnessScorecard = {
  scope: { root: string; runtime: string };
  counts: Record<string, number> & { agents: number; skills: number };
  findings: ScFinding[];
  config_hash: string; state_key: string; stale: boolean;
  factory: { policyAuditApplicable: boolean } | null;
  built: { portable: boolean };
  loop_ref: { path: string } | null;
  diag: unknown | null;
};
type ScTrend = {
  points: { at: string; penalized: number; debt: number }[];
  verdict: "improved" | "regressed" | "steady" | "insufficient";
  delta: number | null; findingDelta: "available" | "approximate";
  newFindings: string[] | null; resolvedFindings: string[] | null;
  latest: { debt: number; generated_at: string } | null;
};
const FINDING_LABEL: Record<string, string> = {
  orphan: "고아", link_unknown: "미선언(부채)", dead_link: "dead-link", coverage_gap: "커버리지 갭",
  unknown_scope: "교차 scope", incomplete_def: "정의 불완전", oversize: "500줄 초과",
};
const VERDICT: Record<string, { label: string; kind: "ok" | "warn" | "muted" }> = {
  improved: { label: "개선", kind: "ok" }, regressed: { label: "퇴행", kind: "warn" },
  steady: { label: "유지", kind: "muted" }, insufficient: { label: "데이터 부족", kind: "muted" },
};

function HarnessScorecardCard() {
  const sc = useApi<HarnessScorecard>("/api/eval/harness-scorecard");
  const trend = useApi<ScTrend>("/api/eval/harness-scorecard/trend");
  const [snapMsg, setSnapMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recordSnapshot = async () => {
    setBusy(true); setSnapMsg(null);
    try {
      const r = await apiPost<{ written: boolean }>("/api/eval/harness-scorecard/snapshot", {});
      setSnapMsg(r.written ? "스냅샷 기록됨 — 추세 갱신" : "변경 없음 — 구성 파일(.claude/agents·skills) 미변경이라 스킵(중복 방지). 정의가 바뀌면 자동 기록.");
      trend.reload();
    } catch (e) { setSnapMsg("기록 실패: " + String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Card title="구성 자기평가 (harness_scorecard · 주축)">
      <p className="muted">
        하네스 <b>구성 상태</b>(에이전트·스킬·오케스트레이터 연결)를 정적 파싱으로 측정. 아래 루프 평가는 보조 신호(loop_ref). ·
        <b>미선언(link_unknown)은 "아직 모름"</b>(감점 아님·마이그레이션 부채) — 고아(확실히 무연결)와 구분.
      </p>
      <Async state={sc}>{(d) => {
        const active = d.findings.filter((f) => !f.waived);
        const waived = d.findings.filter((f) => f.waived);
        const byType = (t: string) => active.filter((f) => f.type === t);
        const orphanBy = (k: string) => active.filter((f) => f.type === "orphan" && f.subject_kind === k).length;
        const order = ["orphan", "dead_link", "coverage_gap", "incomplete_def", "oversize", "unknown_scope", "link_unknown"];
        return (
          <>
            {/* A. 라이브 건강도 — ①요약 ②분류 두 표에 제목·설명 부여 */}
            <h4 className="sc-sub">① 요약</h4>
            <p className="sc-desc">이 하네스가 factory인지·에이전트/스킬 수·고아 수·config 지문(state_key). 지금 상태 한눈.</p>
            <Table cols={["항목", "값"]} rows={[
              ["범위(runtime)", <Badge kind={d.scope.runtime === "factory" ? "ok" : "muted"}>{d.scope.runtime}</Badge>],
              ["에이전트 / 스킬", `${d.counts.agents} / ${d.counts.skills}`],
              ["고아 — 에이전트 / 스킬", `${orphanBy("agent")} / ${orphanBy("skill")}`],
              ["namespace", <>
                <Badge kind={d.factory ? "ok" : "muted"}>factory {d.factory ? "policy-audit" : "n/a"}</Badge>{" "}
                <Badge kind="muted">built portable</Badge>{" "}
                <Badge kind="muted">diag {d.diag ? "있음" : "미실행"}</Badge>{" "}
                {d.loop_ref && <Badge kind="muted">loop_ref</Badge>}{d.stale && <> <Badge kind="warn">stale</Badge></>}
              </>],
              ["state_key", <code>{d.state_key.slice(0, 12)}</code>],
            ]} />
            <h4 className="sc-sub">② 분류별 결함</h4>
            <p className="sc-desc">
              <b>고아</b>=확실히 무연결(감점) · <b>미선언(부채)</b>=아직 모름·감점X(마이그레이션 부채) ·
              <b>dead-link</b>=선언 대상 파일 부재 · <b>커버리지 갭</b>=오케스트레이터 미배정. 건수 클릭 시 대상 펼침.
            </p>
            <Table cols={["분류", "건수", "대상"]} rows={order.map((t) => {
              const items = byType(t);
              const isDebt = t === "link_unknown" || t === "unknown_scope";
              const sev = items[0]?.severity;
              return [
                <>{FINDING_LABEL[t] ?? t}{sev && items.length > 0 && <> <Badge kind={sev === "high" || sev === "med" ? "warn" : "muted"}>{sev}</Badge></>}</>,
                items.length ? <Badge kind={isDebt ? "muted" : "warn"}>{items.length}</Badge> : "0",
                items.length ? (
                  <details className="tier-b"><summary>{items.slice(0, 4).map((f) => f.subject + (f.target ? `→${f.target}` : "")).join(", ")}{items.length > 4 ? " …" : ""}</summary>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                      {items.map((f) => <li key={f.id}><code>{f.subject}{f.target ? `→${f.target}` : ""}</code> <span className="muted">· {f.provenance}{f.detail ? ` · ${f.detail}` : ""}</span></li>)}
                    </ul>
                  </details>
                ) : "—",
              ];
            })} />
            {orphanBy("agent") === 0 && <p className="muted">✓ 고아 에이전트 0 — skills 실파싱(구 A35 전수 오탐 해소).</p>}
            {waived.length > 0 && (
              <details className="tier-b"><summary>억제(waived) {waived.length}건</summary>
                <Table cols={["항목", "만료", "사유"]} rows={waived.map((f) => [
                  `${FINDING_LABEL[f.type] ?? f.type}: ${f.subject}${f.target ? `→${f.target}` : ""}`,
                  f.waiver_expires_at ?? "무기한", f.waiver_reason ?? "—",
                ])} />
              </details>
            )}
            {/* B. 추세 — 시계열(스냅샷 간 비교) */}
            <hr className="sc-div" />
            <h4 className="sc-sub">③ 추세 <span className="sc-tag">스냅샷 시계열</span></h4>
            <p className="sc-desc">
              위 ①②는 <b>지금 한 시점</b>, 여기는 <b>스냅샷 사이 변화</b>. 감점 결함 증감으로 <b>개선/퇴행</b> 판정 ·
              신규/해소 결함 · 부채 추이. <b>스냅샷 2개 이상</b> 쌓여야 판정(아래 [지금 스냅샷 기록]으로 축적).
            </p>
            <Async state={trend}>{(t) => {
              const v = VERDICT[t.verdict]!;
              return (
                <Table cols={["항목", "값"]} rows={[
                  ["판정", <><Badge kind={v.kind}>{v.label}</Badge>{t.delta != null && <span className="muted"> (감점 Δ {t.delta > 0 ? "+" : ""}{t.delta})</span>}</>],
                  ["신규 / 해소", t.findingDelta === "approximate" ? <span className="muted">근사(항목 초과)</span> :
                    `${t.newFindings?.length ?? 0} / ${t.resolvedFindings?.length ?? 0}`],
                  ["부채(link_unknown)", t.latest ? String(t.latest.debt) : "—"],
                  ["스냅샷 수 / 마지막 기록", `${t.points.length}${t.latest ? " · " + t.latest.generated_at : ""}`],
                ]} />
              );
            }}</Async>
            {trend.data?.verdict === "insufficient" && (
              <p className="muted">추세 미축적(스냅샷 &lt;2) — 오케스트레이터 Phase 0/7-5가 <code>harness-scorecard.mjs --snapshot</code> 실행 시 쌓임. 또는 아래 [지금 기록].</p>
            )}
            <div style={{ marginTop: 10 }}>
              <button type="button" className="primary" disabled={busy} onClick={recordSnapshot}>{busy ? "기록 중…" : "지금 스냅샷 기록"}</button>
              {snapMsg && <span className="muted" style={{ marginLeft: 10 }}>{snapMsg}</span>}
            </div>
          </>
        );
      }}</Async>
    </Card>
  );
}

const ADOPTION_STAGES = [
  { n: 1, label: "측정·로깅", desc: "기록만" },
  { n: 2, label: "사람 검토", desc: "수동 판단" },
  { n: 3, label: "제안(실험)", desc: "개선안 emit" },
  { n: 4, label: "잠금", desc: "표시 전용" },
] as const;

type GateStatus = {
  stage: number; nextStage: number | null;
  logging: { count: number; required: number; met: boolean };
  adjudicated: { count: number; required: number; met: boolean };
  eligible: boolean; recommendation: "advance" | "hold" | "locked";
  reasons: string[]; counterSignals: string[]; autoAdvanceEligible: boolean; note: string;
};

// 자기평가 체계의 상태 헤더 — 채택 단계 스테퍼 + 졸업 게이트(에이전트 분석·추천, 사람 정보결정 상향).
function AdoptionStageHeader() {
  const st = useApi<EvalsConfigResolved>("/api/evals/config");
  const gate = useApi<GateStatus>("/api/evals/gate");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const advance = async (cfg: EvalsConfigResolved, to: number) => {
    setBusy(true); setMsg(null);
    try {
      const form = {
        adoptionStage: to as 1 | 2 | 3,
        metrics: cfg.metrics,
        thresholds: {
          minAdjudicatedClaims: String(cfg.thresholds.minAdjudicatedClaims.value),
          rollingN: String(cfg.thresholds.rollingN.value),
          declineStreak: String(cfg.thresholds.declineStreak.value),
        } as Record<string, string>,
      };
      await apiPost("/api/evals/config", buildConfigPatch(cfg, form));
      setMsg(`단계 ${to}로 상향됨(사람 결정 반영)`); st.reload(); gate.reload();
    } catch (e) { setMsg("상향 실패: " + String(e)); } finally { setBusy(false); }
  };
  return (
    <Card title="자기평가 체계 · 채택 단계">
      <Async state={st}>{(cfg) => (
        <>
          <div className="stage-steps" role="list" aria-label="채택 단계">
            {ADOPTION_STAGES.map((s) => (
              <span key={s.n} role="listitem"
                className={"stage-step" + (s.n === cfg.adoptionStage ? " on" : s.n < cfg.adoptionStage ? " past" : "")}>
                <b>{s.n}</b> {s.label}
              </span>
            ))}
          </div>
          <p className="muted">
            현재 <b>단계 {cfg.adoptionStage} · {ADOPTION_STAGES[cfg.adoptionStage - 1]!.label}</b> — 자동화 수위(1 측정만 → 4 잠금)를
            규정하며 두 렌즈(구성·루프) 공통. <b>제안은 자동 적용되지 않습니다</b>(사람 승인). {cfg.adoptionStage === 4 && "🔒 설정 잠금(표시 전용)."}
          </p>
          {/* 졸업 게이트 — 조건 진척·에이전트 권고·반대신호·정보결정 상향(추인 아님·자동 승격 아님) */}
          <Async state={gate}>{(g) => (
            <div className="gate-panel">
              <div className="gate-head">
                <b>다음 단계 게이트{g.nextStage ? ` (→ ${g.nextStage} · ${ADOPTION_STAGES[g.nextStage - 1]!.label})` : ""}</b>
                {g.recommendation === "advance" && <Badge kind="ok">상향 권장</Badge>}
                {g.recommendation === "hold" && <Badge kind="muted">보류</Badge>}
                {g.recommendation === "locked" && <Badge kind="muted">잠금</Badge>}
              </div>
              <Table cols={["조건", "진척", "충족"]} rows={[
                ["로깅(관측)", `${g.logging.count} / ${g.logging.required}`, g.logging.met ? <Badge kind="ok">✓</Badge> : <Badge kind="warn">✗</Badge>],
                ["판정 누적(adjudicated)", `${g.adjudicated.count} / ${g.adjudicated.required}`, g.adjudicated.met ? <Badge kind="ok">✓</Badge> : <Badge kind="warn">✗</Badge>],
                ["사람 승인", "필수(자동 승격 아님)", <Badge kind="muted">—</Badge>],
              ]} />
              {g.reasons.length > 0 && <p className="muted">· {g.reasons.join(" · ")}</p>}
              {g.counterSignals.length > 0 && (
                <div className="gate-counter">
                  <p className="warn-text">⚠ 반대신호(상향 신중):</p>
                  <ul>{g.counterSignals.map((c, i) => <li key={i} className="muted">{c}</li>)}</ul>
                </div>
              )}
              {g.recommendation === "advance" && g.nextStage && g.nextStage <= 3 && (
                <div className="gate-actions">
                  <button type="button" className="primary" disabled={busy} onClick={() => advance(cfg, g.nextStage!)}>
                    {busy ? "상향 중…" : `단계 ${g.nextStage}로 상향`}
                  </button>
                  <span className="muted">
                    {g.autoAdvanceEligible ? " 저위험(검토만 켬)" : " 근거·반대신호 확인 후 결정"} · 되돌리기 신중(자동 행동 권한 확대)
                  </span>
                </div>
              )}
              {g.stage === 3 && <p className="muted">3→4(자동 적용)는 UI 상향 없음 — 승인 사다리·수동 결정(교리).</p>}
              {msg && <p className="muted">{msg}</p>}
            </div>
          )}</Async>
        </>
      )}</Async>
    </Card>
  );
}

export function Eval() {
  const idx = useApi<EvalsIndex>("/api/evals");
  const [loop, setLoop] = useState<string | null>(null);
  return (
    <div className="screen">
      <h2>Eval <span className="ver">자기평가</span></h2>
      <p className="muted">
        하네스를 <b>두 렌즈</b>로 잰다 — <b>구성(주축)</b>: 에이전트·스킬·오케스트레이터 건강도 / <b>루프(보조)</b>: 외부리뷰 효율.
        위 <b>채택 단계</b>가 자동화 수위를 정하고, <b>제안은 자동 적용되지 않는다</b>(정의 편집기에서 수동 검토·저장). 점수는 "정합도"이지 품질 점수가 아니다.
      </p>
      <AdoptionStageHeader />
      <h3 className="lens-h">🎯 구성 <span className="lens-tag">주축</span></h3>
      <HarnessScorecardCard />
      <h3 className="lens-h">🔁 루프 <span className="lens-tag muted">보조</span></h3>
      <Async state={idx}>{(d) => <EvalIndexBody idx={d} loop={loop} onLoop={setLoop} />}</Async>
    </div>
  );
}

function EvalIndexBody({ idx, loop, onLoop }: { idx: EvalsIndex; loop: string | null; onLoop: (l: string | null) => void }) {
  const empty = evalsEmptyState(idx);
  return (
    <>
      {/* A104: 빈/미실행 = 고장 아님 + 실행 위치/방법 CTA(데드엔드 금지) */}
      {empty && (
        <Card title={empty.title}>
          <div className="empty" role="status">
            <p>{empty.kind === "unavailable" ? "⛔" : "🧪"} {empty.body}</p>
            <p className="muted">{empty.cta}</p>
          </div>
        </Card>
      )}
      {!empty && (
        <Card title="평가 결과 보기 (읽기 전용)">
          {idx.truncated && <p className="banner warn" role="note">✂ 루프 스캔 절단(상한 도달) · 일부만 표시</p>}
          <Table cols={["루프", "run 수(열거)", "최근 정합도", "최근 종료사유"]} rows={idx.loops.map((l) => [
            <button className="link" onClick={() => onLoop(l.loop)}>{l.loop}</button>,
            l.runCount,
            l.latest ? <span title={idx.labels.alignmentFormula}>{alignmentText(l.latest.alignmentScore)}{!l.latest.verified && " ⚠"}</span> : <span className="muted">—</span>,
            l.latest?.terminationReason
              ? <span title={l.latest.terminationReason}>{terminationExcerpt(l.latest.terminationReason) || "—"}</span>
              : <span className="muted">—</span>,
          ])} />
          <p className="muted">🕳 '미측정'·'손상' 항목의 세부는 해당 루프를 열어 추세의 <b>유효 / 미측정 / 손상</b> 개수에서 확인하세요. (목록은 최신 1건만 읽어 메모리를 아낍니다.)</p>
          <p className="muted">{idx.note}</p>
        </Card>
      )}
      {loop && <LoopTrendCard key={loop} loop={loop} onClose={() => onLoop(null)} />}
      {loop && <ProposalCard key={"prop:" + loop} loop={loop} />}
      {/* Part C 지표관리 — 루프 판정 거버넌스(임계·지표·채택 단계 편집). 고급으로 접어 계층 분리. */}
      <details className="tier-b lens-adv">
        <summary>⚙ 고급 · 루프 판정 설정 (임계·지표·채택 단계 편집)</summary>
        <EvalsConfigCard />
      </details>
    </>
  );
}

// Part A 추세 — GET /api/evals/:loop. series(asc) 테이블 + run 선택 → scorecard 상세.
function LoopTrendCard({ loop, onClose }: { loop: string; onClose: () => void }) {
  const st = useApi<LoopTrend>(`/api/evals/${encodeURIComponent(loop)}`);
  const [sel, setSel] = useState<{ stage: string; run: string } | null>(null);
  return (
    <Card title={`추세 · ${loop}`}>
      <button className="link" onClick={onClose}>✕ 닫기</button>
      <Async state={st}>{(d) => !d.found || d.series.length === 0 ? (
        <div className="empty" role="status">
          <p className="muted">🧪 이 루프의 유효 scorecard 가 없습니다(격리 {d.counts.corrupt} · 미측정 {d.counts.unavailable}).</p>
          <p className="muted">평가 루프를 실행하면 추세가 표시됩니다.</p>
        </div>
      ) : (
        <>
          <AlignmentBadgeLegend formula={d.labels.alignmentFormula} />
          <p className="muted">
            추세 소스: {d.trendSource === "scorecards-inprocess" ? "화면 내 재계산" : d.trendSource}(검증된 원장 아님 → <b>미검증 표시</b>) ·
            유효 {d.counts.valid} / 미측정 {d.counts.unavailable} / 손상 {d.counts.corrupt}
            {d.truncated && " · ✂ 절단(일부만)"}
          </p>
          <Table cols={["기록 시각", "단계/실행", "정합도", "라운드(정규화)", "번복률", "판정 수", "종료 사유", "품질(참고)", "검증"]}
            rows={d.series.map((p) => [
              fmtMs(p.recordedAtMs),
              <button className="link" onClick={() => setSel({ stage: p.stageId, run: p.runId })}>{p.stageId}/{p.runId.slice(0, 16)}</button>,
              <span title={d.labels.alignmentFormula}>{alignmentText(p.alignmentScore)}</span>,
              numOrDash(p.roundsNormalized),
              <span title={d.labels.overturnedRejectionRate} className={p.overturnedRejectionRate === null ? "muted" : ""}>{gtMetricText(p.overturnedRejectionRate)}</span>,
              verdictCountsText(p.verdictCounts),
              p.terminationReason
                ? <span title={p.terminationReason}>{terminationExcerpt(p.terminationReason) || "—"}</span>
                : <span className="muted">—</span>,
              p.qualityLabel ? <span title={d.labels.qualityLabel}>{p.qualityLabel} <Badge kind="muted">LLM 해석</Badge></span> : <span className="muted">—</span>,
              <VerifiedBadge verified={p.verified} reason={p.unverifiedReason} />,
            ])} />
          <p className="muted">📐 정합도 산정식: {d.labels.alignmentFormula} · <b>{d.labels.alignmentScore}</b></p>
          <p className="muted">🌐 {d.labels.missedDefectRate}</p>
          {sel && <ScorecardDetailCard key={sel.stage + "/" + sel.run} loop={loop} stage={sel.stage} run={sel.run} onClose={() => setSel(null)} />}
        </>
      )}</Async>
    </Card>
  );
}

// Part A scorecard 상세 — GET /api/evals/:loop/:stage/:run. 자유 텍스트는 DV8/React escape.
function ScorecardDetailCard({ loop, stage, run, onClose }: { loop: string; stage: string; run: string; onClose: () => void }) {
  const st = useApi<ScorecardDetail>(`/api/evals/${encodeURIComponent(loop)}/${encodeURIComponent(stage)}/${encodeURIComponent(run)}`);
  return (
    <Card title={`평가 기록 · ${stage}/${run.slice(0, 24)}`}>
      <button className="link" onClick={onClose}>✕ 닫기</button>
      <Async state={st}>{(d) => {
        if (d.status !== "ok" || !d.scorecard) {
          const label = d.status === "unavailable" ? "미측정 (아직 측정 안 됨 · 고장 아님)" : d.status === "corrupt" ? "손상 (기록 무결성 위반)" : "찾을 수 없음";
          return <div className="empty" role="status"><p className="muted">⛔ {label}{d.reason && <> · {d.reason}</>}</p></div>;
        }
        const c = d.scorecard;
        return (
          <>
            <p><VerifiedBadge verified={d.verified} reason={d.unverifiedReason} /> {!d.verified && <span className="warn-text">{d.unverifiedReason}</span>}</p>
            <AlignmentBadgeLegend formula={d.labels.alignmentFormula} />
            <Table cols={["항목", "값"]} rows={[
              ["정합도(품질 아님)", <span title={d.labels.alignmentFormula}>{alignmentText(c.alignment_score ?? null)}</span>],
              ["라운드 / 정규화 라운드", <>{numOrDash(c.rounds ?? null)} / {numOrDash(c.rounds_normalized ?? null)}</>],
              ["판정 건수", verdictCountsText(c.verdict_counts ? { confirmed: c.verdict_counts.confirmed ?? 0, partial: c.verdict_counts.partial ?? 0, deferred: c.verdict_counts.deferred ?? 0, rejected: c.verdict_counts.rejected ?? 0, duplicate: c.verdict_counts.duplicate ?? 0 } : null)],
              ["missed_defect_rate", <span className="muted" title={d.labels.missedDefectRate}>{gtMetricText(c.missed_defect_rate ?? null)}</span>],
              ["기각 번복률", <span className="muted" title={d.labels.overturnedRejectionRate}>{gtMetricText(c.overturned_rejection_rate ?? null)}</span>],
              ["quality_label(LLM 해석)", c.quality_label ? <span title={d.labels.qualityLabel}>{c.quality_label} <Badge kind="muted">LLM 해석</Badge></span> : <span className="muted">—</span>],
              ["computed_by", c.computed_by ?? <span className="muted">—</span>],
            ]} />
            {/* 종료사유·경고 = 반신뢰 _workspace 자유 텍스트 → DV8 sanitize(지시 흡수/스크립트 무력화) */}
            {c.termination_reason && (
              <div className="scorecard-block">
                <p className="muted">종료 사유 (안전 처리됨):</p>
                <SafeMd text={c.termination_reason} />
              </div>
            )}
            {Array.isArray(c.warnings) && c.warnings.length > 0 && (
              <div className="scorecard-block">
                <p className="muted">⚠ 경고 (기록 데이터 · 안전 처리됨 · 지시로 해석하지 않음):</p>
                {c.warnings.map((w, i) => <SafeMd key={i} text={w} />)}
              </div>
            )}
          </>
        );
      }}</Async>
    </Card>
  );
}

// Part B 제안 카드 — GET /api/evals/:loop/proposal. 자동 적용 절대 없음 · CTA=F7 수동 · "미적용" 유지.
function ProposalCard({ loop }: { loop: string }) {
  const st = useApi<EvalProposal>(`/api/evals/${encodeURIComponent(loop)}/proposal`);
  return (
    <Card title={`자기개선 제안 · ${loop} (사람 승인만)`}>
      <Async state={st}>{(p) => (
        <>
          {/* 어느 상태든 유지되는 교리 배너: 자동 적용 없음·미적용 */}
          <p className="banner" role="note">
            🔒 이 제안은 <b>정보성</b>입니다 — 자동 적용되지 않으며(<code>autoApply: false</code>), 저장 전까지 <b>미적용</b> 상태입니다.
            적용하려면 {p.applyPath}.
          </p>
          {!p.enabled || p.disabledReason ? (
            <div className="empty" role="status">
              <p className="muted">🚫 {proposalDisabledText(p)}</p>
              {p.disabledReason === "adoption-stage-below-3" && (
                <p className="muted">아래 <b>평가지표 설정</b>에서 채택 단계를 3(실험 단계)으로 올리세요.</p>
              )}
              {p.gate && p.disabledReason === "insufficient-data" && <GateTable gate={p.gate} />}
            </div>
          ) : (
            <>
              {p.gate && <GateTable gate={p.gate} />}
              {/* 악화 트리거(근거 인용) — detail 은 서버 구성 문자열(React escape) */}
              <div className="proposal-triggers">
                {p.triggers.map((t, i) => (
                  <div key={i} className="trigger" role="note">
                    <p><Badge kind="warn">{t.kind}</Badge> {t.detail}</p>
                    {t.evidence.length > 0 && (
                      <ul className="evidence">{t.evidence.map((e, j) => <li key={j} className="path">{e}</li>)}</ul>
                    )}
                  </div>
                ))}
              </div>
              {/* provenance(소스경로·runId·computedBy·표본수·검증상태) */}
              {p.provenance && (
                <details className="provenance">
                  <summary>근거 출처 (소스·표본·검증)</summary>
                  <Table cols={["항목", "값"]} rows={[
                    ["계산 방법", p.provenance.computedBy],
                    ["표본 수", p.provenance.sampleSize],
                    ["검증 상태", p.provenance.verificationStatus],
                    ["runIds", p.provenance.runIds.join(", ") || "—"],
                  ]} />
                  <p className="muted">소스 scorecard:</p>
                  <ul className="src-paths">{p.provenance.sourcePaths.map((s, i) => <li key={i} className="path">{s}</li>)}</ul>
                </details>
              )}
              {/* 인용 scorecard */}
              {p.citedScorecards.length > 0 && (
                <Table cols={["단계/실행", "정합도", "검증"]} rows={p.citedScorecards.map((c) => [
                  `${c.stageId}/${c.runId.slice(0, 16)}`,
                  <span title={p.labels.alignmentFormula}>{alignmentText(c.alignmentScore)}</span>,
                  <VerifiedBadge verified={c.verified} />,
                ])} />
              )}
              {/* A112/A105 CTA — "승인"이 아니라 "편집기에서 검토·저장"(수동·F7) */}
              <div className="detail-actions">
                <a className="primary link" href="#/agents">✎ 편집기에서 검토·저장 (수동)</a>
              </div>
              <p className="muted">※ 평가기준·에이전트 tools/skills·역할·게이트 변경은 <b>항상 사람 승인</b>입니다. 여기서 자동 반영되는 것은 없습니다.</p>
            </>
          )}
          <p className="muted">{p.note}</p>
        </>
      )}</Async>
    </Card>
  );
}

// A106 게이트 표 — 실데이터 기준(config 값 아님). 미충족 항목 "N회 더 필요" 정직 표기.
function GateTable({ gate }: { gate: EvalProposal["gate"] }) {
  if (!gate) return null;
  const short = gateShortfalls(gate);
  return (
    <div className="gate-block" role="note">
      <Table cols={["게이트 조건", "현재", "요구", "충족"]} rows={[
        ["판정 주장(adjudicated)", gate.adjudicated, gate.minAdjudicated, gate.adjudicatedMet ? <Badge kind="ok">✓</Badge> : <Badge kind="warn">미달</Badge>],
        ["유효 관측(rolling)", gate.observations, gate.rollingN, gate.observationsMet ? <Badge kind="ok">✓</Badge> : <Badge kind="warn">미달</Badge>],
        ["연속 하락(streak)", gate.declineStreak, gate.requiredStreak, gate.streakMet ? <Badge kind="ok">✓</Badge> : <Badge kind="warn">미달</Badge>],
        ["발화(fires)", gate.fires ? <Badge kind="warn">발화</Badge> : <Badge kind="ok">비발화</Badge>, "", ""],
      ]} />
      {short.length > 0 && <p className="muted">🕳 미충족: {short.join(" · ")}</p>}
    </div>
  );
}

// Part C 지표관리 — GET config → 폼 → POST(mutating). floor 상시 표시·미만 인라인 거부·단계3 고위험 확인.
function EvalsConfigCard() {
  const st = useApi<EvalsConfigResolved>("/api/evals/config");
  return (
    <Card title="루프 판정 설정 (채택 단계·임계·지표)">
      {/* 정합: adoptionStage 4 = display-only 잠금 → 폼 편집 비활성(쓰기 경로 없음·교리). 1~3 만 편집 폼. */}
      <Async state={st}>{(cfg) => cfg.adoptionStage === 4
        ? <LockedConfigView key="locked" cfg={cfg} />
        : <EvalsConfigForm key={cfg.adoptionStage} cfg={cfg} onSaved={st.reload} />}</Async>
    </Card>
  );
}

// A108: 단계4 잠금 = display-only. 편집 컨트롤·저장 버튼 없음(교리). 현재값만 읽기전용 표기.
function LockedConfigView({ cfg }: { cfg: EvalsConfigResolved }) {
  return (
    <div className="locked-config">
      <p className="banner full" role="note">🔒 채택 단계 <b>4(잠금·표시 전용)</b> — 설정은 읽기 전용입니다. UI에 쓰기 경로가 없습니다.</p>
      <p className="muted">현재 저장값: {adoptionStageLabel(cfg.adoptionStage)} · 제안 활성: {cfg.proposalsEnabled ? "예" : "아니오"}</p>
      <Table cols={["지표", "활성", "가중치"]} rows={Object.entries(cfg.metrics).map(([k, m]) => [
        k, m.enabled ? <Badge kind="ok">on</Badge> : <Badge kind="muted">off</Badge>, m.weight,
      ])} />
      <Table cols={["임계값", "값", "floor", "적용값(effective)"]} rows={THRESHOLD_KEYS.map((k) => [
        THRESHOLD_LABEL[k], cfg.thresholds[k].value, cfg.thresholds[k].floor, cfg.thresholds[k].effective,
      ])} />
      <details className="tier-b">
        <summary>thetaByRisk · normalization (읽기전용)</summary>
        <pre className="out">{JSON.stringify({ thetaByRisk: cfg.thresholds.thetaByRisk, normalization: cfg.normalization }, null, 2)}</pre>
      </details>
    </div>
  );
}

function EvalsConfigForm({ cfg, onSaved }: { cfg: EvalsConfigResolved; onSaved: () => void }) {
  // 부모가 stage 4 를 LockedConfigView 로 분기 → 여기 도달값은 1~3. 방어적으로 4 는 3 으로 clamp(잠금 진입 불가).
  const [stage, setStage] = useState<1 | 2 | 3>(() => (cfg.adoptionStage === 4 ? 3 : cfg.adoptionStage));
  const [metrics, setMetrics] = useState<Record<string, MetricSetting>>(() => ({ ...cfg.metrics }));
  const [inputs, setInputs] = useState<Record<ThresholdKey, string>>(() => ({
    minAdjudicatedClaims: String(cfg.thresholds.minAdjudicatedClaims.value),
    rollingN: String(cfg.thresholds.rollingN.value),
    declineStreak: String(cfg.thresholds.declineStreak.value),
  }));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const metricKeys = Object.keys(metrics);
  const thresholdsOk = thresholdsValid(inputs);
  const canSubmit = thresholdsOk && !busy;

  const setInput = (k: ThresholdKey, v: string) => { setInputs((p) => ({ ...p, [k]: v })); setErr(null); setSavedAt(null); };
  const setMetric = (k: string, patch: Partial<MetricSetting>) => {
    setMetrics((p) => ({ ...p, [k]: { ...p[k]!, ...patch } })); setSavedAt(null);
  };

  const doSave = async () => {
    setBusy(true); setErr(null);
    try {
      const patch = buildConfigPatch(cfg, { adoptionStage: stage, metrics, thresholds: inputs });
      const r = await postEvalsConfig(patch);
      setConfirmOpen(false);
      setSavedAt(new Date().toISOString());
      setStage(r.config.adoptionStage === 4 ? 3 : r.config.adoptionStage); // POST 는 1~3 만 → 4 는 도달 불가(방어적 clamp)
      onSaved();
    } catch (e) {
      setConfirmOpen(false);
      if (e instanceof EvalsConfigError) setErr(evalsConfigErrorText(e.code, e.status));
      else setErr(String(e));
    } finally { setBusy(false); }
  };

  // 저장 클릭 → floor 검증(버튼 disabled 로 1차)·단계3 전환은 고위험 확인 다이얼로그(A111/A85).
  const onSaveClick = () => {
    if (!thresholdsOk) return;
    setErr(null);
    if (stageNeedsHighRiskConfirm(cfg.adoptionStage, stage)) setConfirmOpen(true);
    else doSave();
  };

  return (
    <>
      {/* 채택 단계 — 1~3 편집 · 4 는 잠금(display-only) */}
      <div className="form">
        <label>채택 단계 (adoptionStage)
          <select value={stage} onChange={(e) => { setStage(Number(e.target.value) as 1 | 2 | 3); setSavedAt(null); }}>
            <option value={1}>{adoptionStageLabel(1)}</option>
            <option value={2}>{adoptionStageLabel(2)}</option>
            <option value={3}>{adoptionStageLabel(3)}</option>
          </select>
        </label>
        <p className="muted full">현재 저장값: {adoptionStageLabel(cfg.adoptionStage)} · 제안 활성: {cfg.proposalsEnabled ? "예(단계≥3)" : "아니오"}</p>
        {stage === 3 && cfg.adoptionStage < 3 && (
          <p className="banner warn full" role="note">🧪 단계 3 은 <b>실험 단계</b>(제안 생성 활성) — 저장 시 고위험 확인이 필요합니다.</p>
        )}
        {/* A108: 단계4 = display-only 잠금(쓰기 경로 없음) */}
        <p className="banner full" role="note">🔒 단계 4(잠금·표시 전용)는 UI에서 설정할 수 없습니다 — 쓰기 경로가 없습니다.</p>
      </div>

      {/* per-metric enable/weight */}
      <fieldset className="form full">
        <legend>지표 (per-metric enable / weight 0~1)</legend>
        {metricKeys.length === 0
          ? <p className="muted">등록된 지표가 없습니다(기본값).</p>
          : metricKeys.map((k) => (
              <div key={k} className="metric-row">
                <label className="check">
                  <input type="checkbox" checked={metrics[k]!.enabled} onChange={(e) => setMetric(k, { enabled: e.target.checked })} />
                  {k}
                </label>
                <label>가중치
                  <input type="number" min={0} max={1} step={0.05} value={metrics[k]!.weight}
                    onChange={(e) => setMetric(k, { weight: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} />
                </label>
              </div>
            ))}
      </fieldset>

      {/* 임계값 — floor 상시 표시 · 미만 인라인 거부(silent clamp 금지) · old→effective diff */}
      <fieldset className="form full">
        <legend>임계값 (floor 미만 저장 불가 · 자동 보정 없음)</legend>
        {THRESHOLD_KEYS.map((k) => {
          const leaf = cfg.thresholds[k];
          const diff = thresholdDiff(k, leaf, inputs[k]);
          const errText = thresholdError(k, parseIntInput(inputs[k]));
          return (
            <div key={k} className="threshold-row">
              <label>{THRESHOLD_LABEL[k]}
                <input type="number" inputMode="numeric" value={inputs[k]} min={FLOORS[k]}
                  aria-invalid={errText ? "true" : undefined} onChange={(e) => setInput(k, e.target.value)} />
                <span className="floor-hint muted"> · 최소(floor) {FLOORS[k]} 상시</span>
              </label>
              {errText
                ? <p className="banner err" role="alert">⚠ {errText}</p>
                : diff.changed && <p className="muted diff-hint">변경: {diff.oldValue} → {diff.newValue} (적용값 effective = {diff.newEffective}; effective = max(값, floor))</p>}
              {!diff.changed && !errText && <p className="muted diff-hint">현재 {leaf.value} · 적용값(effective) {leaf.effective}</p>}
            </div>
          );
        })}
      </fieldset>

      {/* thetaByRisk·normalization = 이번 UI 범위 밖(보존·clobber 금지) */}
      <details className="tier-b">
        <summary>thetaByRisk · normalization (보존 · 이 폼에서 미편집)</summary>
        <pre className="out">{JSON.stringify({ thetaByRisk: cfg.thresholds.thetaByRisk, normalization: cfg.normalization }, null, 2)}</pre>
        <p className="muted">이 값들은 저장 시 현재값 그대로 보존됩니다(형제 필드 clobber 금지).</p>
      </details>

      {err && <p className="banner err" role="alert">⚠ {err}</p>}
      {savedAt && <p className="banner ok" role="status">✓ 저장됨 ({savedAt.slice(0, 19)}) · 적용값(effective)은 floor 미만으로 내려가지 않습니다.</p>}

      <div className="detail-actions">
        <button className="primary" disabled={!canSubmit} onClick={onSaveClick}>{busy ? "저장 중…" : "설정 저장"}</button>
        {!thresholdsOk && <span className="muted"> · 임계값이 floor 미만이거나 무효입니다(저장 불가).</span>}
      </div>

      {/* A111/A85: 단계3 전환 고위험 확인 다이얼로그 */}
      {confirmOpen && (
        <ConfirmDialog title="채택 단계 3 전환 확인 (고위험 · 실험 단계)" onCancel={() => setConfirmOpen(false)}>
          <p className="muted">
            채택 단계 <b>3(실험 단계)</b>으로 올리면 자기개선 <b>제안 생성이 활성화</b>됩니다.
            제안은 <b>정보성</b>이며 <b>자동 적용되지 않습니다</b>(F7 편집기 수동 검토·저장·사람 승인 backstop).
          </p>
          <p className="warn-text">⚠ 이 점수는 "정합도"이며 품질 보증이 아닙니다. 제안은 추세 기반 후보이지 확정이 아닙니다.</p>
          {err && <p className="banner err" role="alert">⚠ {err}</p>}
          <div className="modal-actions">
            <button onClick={() => setConfirmOpen(false)} disabled={busy}>취소 (변경 없음)</button>
            <button className="primary" disabled={busy} onClick={doSave}>{busy ? "저장 중…" : "단계 3 으로 저장"}</button>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

// ── 11. Context (F10 M15 — 멀티런타임 컨텍스트 관리 + 빌더 · A128 · 중대) ──
// 읽기 트리(런타임 배지·필터)·F5 뷰어 재사용(md/TOML·바이너리·절단)·편집=Claude 정의만(F7 진입)·
// 빌더(초안→승인→생성·미적용 초안 세션 유지 A107·포인터 스니펫 복사). 빈/로딩/에러 3-state(A82~A84).
// XSS: 트리·스니펫·초안은 전부 데이터 — 렌더는 React escape / FileViewer 는 DV8 파이프라인만.
export function Context() {
  const tree = useApi<ContextTreeShape>(CONTEXT_TREE_PATH);
  const set = useApi<SettingsInfo>("/api/settings"); // definitionEditEnabled(편집·빌더 게이트·A81)
  const gateOn = set.data?.definitionEditEnabled === true;
  return (
    <div className="screen">
      <h2>Context</h2>
      <p className="muted">
        멀티런타임 하네스 컨텍스트(읽기 전용) + 기존 정의 편집. 편집은 Claude 정의(<code>.claude/agents·skills</code>)만 가능하며,
        Codex·Antigravity 정의와 CLAUDE.md·AGENTS.md·GEMINI.md 는 현재 편집을 지원하지 않습니다(읽기 전용).
        신규 에이전트/스킬 <b>빌드</b>는 <a className="link" href="#/build">Build</a>에서.
      </p>
      {/* A83: 트리는 자체 3-state. 빌더는 Build 화면으로 이동(F10→Build 승격). */}
      <Async state={tree}>{(t) => <ContextBrowser tree={t} gateOn={gateOn} onChanged={tree.reload} />}</Async>
    </div>
  );
}

// 트리(런타임 배지·필터) + 미리보기 + 편집 게이트. isEmpty → "컨텍스트 없음"(빌더는 상위에서 별도 표시).
function ContextBrowser({ tree, gateOn, onChanged }: { tree: ContextTreeShape; gateOn: boolean; onChanged: () => void }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<{ kind: CtxDefKind; name: string } | null>(null);
  const runtimes = availableRuntimes(tree);
  const filtered = filterContextTree(tree, runtime);
  const isEmpty = tree.topFiles.every((f) => !f.present) && tree.roots.every((r) => !r.present);
  const selNode = sel ? findContextFile(tree, sel) : null;
  if (isEmpty) return (
    <div className="empty" role="status">
      <p className="muted">📂 컨텍스트 없음 — 하네스 구성(<code>.claude</code>/<code>.codex</code>/<code>.agents</code>·CLAUDE.md 등)을 확인하세요.</p>
    </div>
  );
  return (
    <>
      {tree.truncated && <p className="banner warn" role="note">✂ 트리 절단 · {tree.count}개까지 표시 · 전체는 파일 시스템에서 확인</p>}
      <div className="ctx-filterbar" role="group" aria-label="런타임 필터">
        <span className="muted">런타임 필터:</span>
        <button className={runtime === null ? "chip on" : "chip"} aria-pressed={runtime === null} onClick={() => setRuntime(null)}>전체</button>
        {runtimes.map((rt) => (
          <button key={rt} className={runtime === rt ? "chip on" : "chip"} aria-pressed={runtime === rt} onClick={() => setRuntime(rt)}>{rt}</button>
        ))}
      </div>
      <div className="split resizable">
        <Card title="컨텍스트 트리 (읽기전용)">
          <ContextTreeView tree={filtered} selected={sel} onSelect={setSel} />
        </Card>
        {sel && selNode
          ? <ContextFilePanel key={sel} rel={sel} node={selNode} gateOn={gateOn}
              projectRoot={tree.projectRoot} onEdit={(kind, name) => setEditFor({ kind, name })} />
          : <Card title="미리보기"><p className="muted">좌측에서 파일을 선택하세요.</p></Card>}
      </div>
      {/* F7 정의 편집기 재사용(claude 정의만·독립 3-state) — 저장 시 구조 변경 없음이나 안전상 재조회는 편집기 내부. */}
      {editFor && <DefinitionEditor key={editFor.kind + ":" + editFor.name} kind={editFor.kind} name={editFor.name}
        onClose={() => { setEditFor(null); onChanged(); }} />}
    </>
  );
}

// 재귀 노드 목록(읽기전용·키보드) — DocTree 동형. 런타임은 서브루트 단위 균일이라 노드별 배지 생략(그룹 헤더에 표기).
function ContextTreeView({ tree, selected, onSelect }: { tree: ContextTreeShape; selected: string | null; onSelect: (p: string) => void }) {
  return (
    <>
      <div className="ctx-group">
        <p className="ctx-group-head muted">프로젝트 컨텍스트 파일</p>
        {tree.topFiles.length === 0
          ? <p className="muted">(필터에 맞는 항목 없음)</p>
          : (
            <ul className="doctree" role="tree">
              {tree.topFiles.map((f) => (
                <li key={f.path} role="none">
                  {f.present
                    ? <button role="treeitem" className={"tree-file link" + (f.path === selected ? " on" : "")}
                        aria-current={f.path === selected ? "true" : undefined} onClick={() => onSelect(f.path)}>
                        📄 {f.name} <Badge kind={runtimeBadgeKind(f.runtime)}>{f.runtime}</Badge>
                      </button>
                    : <span className="muted tree-absent">📄 {f.name} <Badge kind="muted">없음</Badge></span>}
                </li>
              ))}
            </ul>
          )}
      </div>
      {tree.roots.map((r) => (
        <div key={r.path} className="ctx-group">
          <p className="ctx-group-head">
            <code className="path">{r.path}</code> <Badge kind={runtimeBadgeKind(r.runtime)}>{r.runtime}</Badge>
            {!r.present && <> <Badge kind="muted">없음</Badge></>}
          </p>
          {r.present && (r.children.length > 0
            ? <ContextNodeList nodes={r.children} selected={selected} onSelect={onSelect} />
            : <p className="muted">(비어 있음)</p>)}
        </div>
      ))}
    </>
  );
}

function ContextNodeList({ nodes, selected, onSelect }: { nodes: CtxNode[]; selected: string | null; onSelect: (p: string) => void }) {
  return (
    <ul className="doctree" role="tree">
      {nodes.map((n) => n.type === "dir" ? (
        <li key={n.path} role="treeitem" aria-expanded="true">
          <span className="tree-dir">📁 {n.name}</span>
          {n.children.length > 0 && <ContextNodeList nodes={n.children} selected={selected} onSelect={onSelect} />}
        </li>
      ) : (
        <li key={n.path} role="none">
          <button role="treeitem" className={"tree-file link" + (n.path === selected ? " on" : "")}
            aria-current={n.path === selected ? "true" : undefined} onClick={() => onSelect(n.path)}>📄 {n.name}</button>
        </li>
      ))}
    </ul>
  );
}

// 파일 미리보기(F5 FileViewer 재사용) + 편집 게이트(A128). editDecision 이 runtime==claude && 정의경로일 때만 활성.
function ContextFilePanel({ rel, node, gateOn, projectRoot, onEdit }: {
  rel: string; node: { runtime: Runtime; path: string }; gateOn: boolean; projectRoot: string;
  onEdit: (kind: CtxDefKind, name: string) => void;
}) {
  const prev = useApi<ContextFilePreview>(contextFilePath(rel));
  const decision = editDecision({ runtime: node.runtime, path: rel, type: "file" }, gateOn);
  return (
    <Card title={rel}>
      <div className="ctx-file-actions detail-actions">
        {decision.editable
          ? <button className="primary edit-btn" onClick={() => onEdit(decision.kind, decision.name)}>✎ 정의 편집</button>
          : <span className="muted edit-reason" role="note" title={decision.reason}>🔒 {decision.reason}
              {!gateOn && <> · <a className="link" href="#/settings">Settings에서 켜기 →</a></>}
            </span>}
      </div>
      {/* A83: 미리보기는 트리와 독립 3-state. md/TOML 렌더·바이너리 안내·절단 배지는 FileViewer(DV8) 내부. */}
      <Async state={prev}>{(p) => (
        <FileViewer model={{
          name: p.name, content: p.content, renderable: p.renderable, binary: p.binary,
          truncated: p.truncated, size: p.size, localPath: localDocPath(projectRoot, rel, ""),
          download: () => downloadContextFile(rel, p.name),
        }} />
      )}</Async>
    </Card>
  );
}

// 빌더(A124~A127) — 폼→초안(build/draft·디스크 미기록)→편집·승인→생성(build/create). 미적용 초안 세션 유지(A107).
function ContextBuilder({ gateOn, onCreated }: { gateOn: boolean; onCreated: () => void }) {
  const restored = useMemo(() => loadDraftSession(), []);
  const [kind, setKind] = useState<CtxDefKind>(restored?.kind ?? "agent");
  const [domain, setDomain] = useState(restored?.domain ?? "");
  const [role, setRole] = useState(restored?.role ?? "");
  const [name, setName] = useState(restored?.name ?? "");
  const [draft, setDraft] = useState<string | null>(restored?.draft ?? null);
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ sourcePath: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // A107: 폼/초안 변경분을 세션에 지속(탭 전환·리로드에도 유실 방지). 생성 완료 후엔 저장 스킵(clear 유지).
  useEffect(() => {
    if (created) return;
    saveDraftSession({ kind, domain, role, name, draft });
  }, [kind, domain, role, name, draft, created]);

  const genDraft = async () => {
    setDrafting(true); setErr(null); setCreated(null);
    try { setDraft((await postBuildDraft({ kind, domain, role })).draft); }
    catch (e) { setErr(e instanceof BuildError ? buildErrorText(e.code, e.status) : readErrorText(e)); }
    finally { setDrafting(false); }
  };

  const doCreate = async () => {
    if (draft == null) return;
    setCreating(true); setErr(null);
    try {
      const r = await postBuildCreate({ kind, name, content: draft });
      setConfirmOpen(false); setCreated({ sourcePath: r.sourcePath });
      clearDraftSession(); onCreated();
    } catch (e) {
      setConfirmOpen(false);
      setErr(e instanceof BuildError ? buildErrorText(e.code, e.status) : readErrorText(e));
    } finally { setCreating(false); }
  };

  const copySnippet = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(claudePointerSnippet({ kind, name, sourcePath: created.sourcePath }));
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  };

  const reset = () => { setDraft(null); setName(""); setDomain(""); setRole(""); setCreated(null); setErr(null); clearDraftSession(); };
  const targetPath = kind === "agent" ? `.claude/agents/${name}.md` : `.claude/skills/${name}/SKILL.md`;

  return (
    <Card title="빌더 — 신규 정의 초안·생성 (사람 승인 필수)">
      {!gateOn && (
        <p className="banner warn" role="note">🔒 정의 편집(빌더)이 비활성입니다 — 초안 생성·저장이 불가합니다.
          <a className="link" href="#/settings"> Settings에서 켜기 →</a></p>
      )}
      <div className="form">
        <label>종류(kind)
          <select value={kind} onChange={(e) => setKind(e.target.value as CtxDefKind)} disabled={!gateOn}>
            <option value="agent">agent</option><option value="skill">skill</option>
          </select>
        </label>
        <label>이름(name)<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
          placeholder="예: my-agent (첫 글자 영숫자)" disabled={!gateOn} /></label>
        <label className="full">도메인(domain)<textarea value={domain} onChange={(e) => setDomain(e.target.value)}
          maxLength={400} rows={2} disabled={!gateOn} /></label>
        <label className="full">역할(role)<textarea value={role} onChange={(e) => setRole(e.target.value)}
          maxLength={200} rows={2} disabled={!gateOn} /></label>
        <button className="primary" disabled={!gateOn || drafting || !domain || !role} onClick={genDraft}>
          {drafting ? "초안 생성 중…" : "초안 생성 (디스크 미기록)"}
        </button>
      </div>

      {/* 400/403/429/502 인라인(조용한 드롭 금지·A128) */}
      {err && <p className="banner err" role="alert">⚠ {err}</p>}

      {/* 미적용 초안 미리보기 — 편집 가능·승인 전까지 디스크 미기록(A107 세션 유지) */}
      {draft != null && !created && (
        <div className="ctx-draft">
          <p className="muted">📝 초안 미리보기(디스크 미기록·미적용) — 검토·수정 후 승인하세요. frontmatter 의 <code>name:</code> 은 위 이름과 일치해야 합니다(불일치 시 무결성 거부).</p>
          <label className="def-textarea-label">초안 원문 (편집 가능)
            <textarea className="def-textarea" value={draft} onChange={(e) => setDraft(e.target.value)}
              rows={16} spellCheck={false} aria-label="초안 원문 편집" />
          </label>
          <div className="def-editor-toolbar">
            <button className="link" onClick={reset}>초안 폐기</button>
            <button className="primary" disabled={!gateOn || !name || creating} onClick={() => { setErr(null); setConfirmOpen(true); }}>승인·생성…</button>
          </div>
        </div>
      )}

      {/* 생성 성공 — 편집≠실행 안내 + CLAUDE.md 포인터 스니펫 복사(자동 쓰기 없음·A128) */}
      {created && (
        <div className="banner ok" role="status">
          <p>✓ 생성됨 · <code className="path">{created.sourcePath}</code></p>
          <p className="muted">이 생성은 정의 파일 기록만 합니다(실행 아님). CLAUDE.md 포인터는 <b>자동 추가되지 않습니다</b> — 아래 스니펫을 복사해 직접 붙여넣으세요.</p>
          <div className="detail-actions">
            <button onClick={copySnippet}>📋 CLAUDE.md 포인터 스니펫 복사{copied && " ✓"}</button>
            <button className="link" onClick={reset}>새 초안 시작</button>
          </div>
        </div>
      )}

      {/* A85: 비가역 파일 생성 확인 다이얼로그 */}
      {confirmOpen && draft != null && (
        <ConfirmDialog title="신규 정의 파일 생성 확인" onCancel={() => setConfirmOpen(false)}>
          <p className="muted">아래 정의 파일을 <b>새로 생성</b>합니다(디스크 기록). 취소하면 어떤 쓰기도 하지 않습니다.</p>
          <p><code className="path">{targetPath}</code></p>
          {err && <p className="banner err" role="alert">⚠ {err}</p>}
          <div className="modal-actions">
            <button onClick={() => setConfirmOpen(false)} disabled={creating}>취소 (변경 없음)</button>
            <button className="primary" disabled={creating} onClick={doCreate}>{creating ? "생성 중…" : "생성 (파일 쓰기)"}</button>
          </div>
        </ConfirmDialog>
      )}
    </Card>
  );
}
