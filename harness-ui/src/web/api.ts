// API 클라이언트 — session 토큰(Bearer) 첨부. 쿼리 토큰 금지(§0-VOID). XSS: 반환값은 React 가 escape.
import type { RunSubmitResult } from "./agent-run.js";
import { ApiGetError } from "./errors.js"; // U1: GET 실패 상태코드 보존(한국어 매핑용)
export { ApiGetError } from "./errors.js";
// 세션 단일 출처 = sessionStorage(모듈 인스턴스 분리·리로드에도 일관). getSession() 이 유일 판독기.
const KEY = "harness-session";
function getSession(): string | null { try { return sessionStorage.getItem(KEY); } catch { return null; } }
function setSession(s: string): void { try { sessionStorage.setItem(KEY, s); } catch { /* private mode */ } }
function clearSession(): void { try { sessionStorage.removeItem(KEY); } catch { /* noop */ } }

// fragment(#) 토큰 → session 교환. strip 을 fetch 이전에 동기 수행(A34: 왕복 중 주소창 노출 방지).
// hash 있으면 항상 재교환(무효 캐시 덮어씀). 없으면 캐시 사용. 교환 성공분만 신뢰.
// ★ router hash(`#/...`)는 화면 라우팅·딥링크(`#/runs?run=`)용 — bootstrap 토큰으로 오소비 금지.
//   런처 fragment 토큰은 `#<hex>`(§A34·`#/` 로 시작 안 함)만 해당 → 새 탭/리로드서 run focus 보존.
export async function bootstrapSession(): Promise<string | null> {
  const isToken = location.hash.startsWith("#") && !location.hash.startsWith("#/");
  const hash = isToken ? decodeURIComponent(location.hash.slice(1)) : "";
  if (!hash) return getSession(); // router hash(또는 hash 없음) → 캐시 세션 사용·hash 보존
  history.replaceState(null, "", location.pathname + location.search); // ★ fetch 이전 동기 strip(토큰만 제거)
  try {
    const r = await fetch("/api/auth/exchange", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ bootstrap: hash }),
    });
    if (!r.ok) { clearSession(); return null; } // 무효 토큰 → 잔존 캐시도 제거(stale 마스킹 방지)
    const { session } = await r.json();
    setSession(session);
    return session;
  } catch { return null; }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const s = getSession();
  return s ? { authorization: `Bearer ${s}`, ...extra } : extra;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const r = await fetch(path, { headers: authHeaders() });
  if (r.status === 401) { clearSession(); throw new ApiGetError(401, path); } // stale 세션 폐기(무한 401 방지)
  if (!r.ok) throw new ApiGetError(r.status, path);                            // U1: 상태코드 보존 → 한국어 매핑
  return r.json() as Promise<T>;
}

// mutating: same-origin(Origin 자동)·content-type json. 서버가 Origin/Host/token 검증.
export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(`${r.status}: ${JSON.stringify(detail)}`);
  }
  return r.json() as Promise<T>;
}

// ── F2 에이전트 프리필 New Run(M10) ──
// POST /api/runs 거부(400 unauthorized-tool·409 agent-definition-changed)를 구조 보존 승격.
// error/detail 을 그대로 담아 UI 가 한국어로 매핑(agent-run.runSubmitErrorText·A100 — 조용한 드롭 금지).
export class RunSubmitError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly detail?: string[]) {
    super(code);
    this.name = "RunSubmitError";
  }
}

// 실행 제출 — apiPost(문자열 throw)와 달리 status/error/detail 구조 보존(400/409 인라인 매핑용).
export async function submitRun(body: unknown): Promise<RunSubmitResult> {
  const r = await fetch("/api/runs", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  // MED: 401 은 구조 보존(ApiGetError) 으로 승격 → readErrorText 가 세션 만료·재로그인 동선(A84)으로 매핑.
  //   (구: 평문 Error → readErrorText 가 "네트워크 오류"로 오표시). clearSession 은 stale 세션 폐기 유지.
  if (r.status === 401) { clearSession(); throw new ApiGetError(401, "/api/runs"); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({} as { error?: string; detail?: unknown }));
    const detail = Array.isArray(d.detail) ? d.detail.map((x: unknown) => String(x)) : undefined;
    throw new RunSubmitError(r.status, String(d.error ?? r.status), detail);
  }
  return r.json() as Promise<RunSubmitResult>;
}

// ── F5 문서/artifact 뷰어(M8) ──
// 서버 계약(server-builder 확정·이대로 소비):
//   GET /api/docs → { root, tree, count, truncated }
//   GET /api/docs/* → 미리보기 { path,name,mime,size,renderable,binary,truncated,content }
//   GET /api/docs/*?download=1 → attachment raw(8MB 초과 413)
//   GET /api/runs/:runId/artifacts(/*) → 기존(다운로드 전용·raw text)
export type DocsNode =
  | { type: "dir"; name: string; path: string; children: DocsNode[] }
  | { type: "file"; name: string; path: string; ext: string };
// F9(M14): 무 source(레거시) → root:"docs". ?source= → root=소스 상대경로·enabled 동반. root 를 string 으로 완화.
export type DocsTree = { root: string; tree: DocsNode[]; count: number; truncated: boolean; enabled?: boolean };
export type DocPreview = {
  path: string; name: string; mime: string; size: number;
  renderable: boolean; binary: boolean; truncated: boolean; content: string | null;
};

// 상대경로 → URL(세그먼트별 인코딩·구분자 슬래시 보존). 서버가 rel.split("/") 로 세그먼트 재검증.
export function encodeDocPath(rel: string): string {
  return rel.split("/").map(encodeURIComponent).join("/");
}

// ── F9 Docs 다중 소스(M14) — 소스 인지 경로 빌더(?source=<id> 쿼리). source null → 레거시(무 source) ──
// 서버 확정 계약(server-builder 완료·이대로 소비):
//   GET /api/docs/sources → { enabled:boolean, sources:[{id,label,path,valid,enabled}] }  (id=경로 sha256 16자 opaque)
//   GET /api/docs?source=<id> → { root, tree, count, truncated, enabled }  (docsMenuEnabled=false→{enabled:false,tree:[]}·미등록 id→400 invalid-source)
//   GET /api/docs/*?source=<id>[&download=1] → sendPreview shape 또는 attachment
export function docsTreePath(source: string | null): string {
  return source ? `/api/docs?source=${encodeURIComponent(source)}` : "/api/docs";
}
export function docPreviewPath(rel: string, source: string | null): string {
  const base = `/api/docs/${encodeDocPath(rel)}`;
  return source ? `${base}?source=${encodeURIComponent(source)}` : base;
}
export type DocsSourceInfo = { id: string; label: string; path: string; valid: boolean; enabled: boolean };
export type DocsSourcesList = { enabled: boolean; sources: DocsSourceInfo[] };

// 소스 설정 쓰기(mutating·config RMW·타 필드 보존은 서버 권위). dryRun=true → 프리뷰(디스크 미변경·per-소스 유효성).
export type DocsSourceDryRun = { id: string; label: string; path: string; valid: boolean; error: string | null };
export type DocsSourcesDryRunResult = { ok: true; dryRun: true; written: false; docsMenuEnabled: boolean; sources: DocsSourceDryRun[] };
export type DocsSourcesSaved = { ok: true; written: true; docsSources: Array<{ label: string; path: string }>; docsMenuEnabled: boolean };

// 400 거부를 구조 보존 승격(ProjectRootError/EvalsConfigError 동형). invalid(경로별 error) 보존 → UI 인라인 매핑.
export class DocsSourcesError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly invalid?: Array<{ path: string; error: string }>,
  ) {
    super(code);
    this.name = "DocsSourcesError";
  }
}

// POST /api/settings/docs-sources. dryRun:true → 프리뷰(200·written:false). dryRun:false → 저장(200·written:true) / 무효 400.
export async function postDocsSources(body: {
  docsSources: Array<{ label: string; path: string }>; docsMenuEnabled?: boolean; dryRun?: boolean;
}): Promise<DocsSourcesDryRunResult | DocsSourcesSaved> {
  const r = await fetch("/api/settings/docs-sources", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (r.status === 401) { clearSession(); throw new Error("401 인증 만료 — 런처 링크로 재접속"); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({} as { error?: string; invalid?: unknown }));
    const invalid = Array.isArray(d.invalid)
      ? d.invalid.map((x: { path?: unknown; error?: unknown }) => ({ path: String(x.path ?? ""), error: String(x.error ?? "") }))
      : undefined;
    throw new DocsSourcesError(r.status, String(d.error ?? r.status), invalid);
  }
  return r.json() as Promise<DocsSourcesDryRunResult | DocsSourcesSaved>;
}

// 413 too-large(다운로드 하드상한 초과) — UI 에서 로컬 열기 안내(A98)용 크기·상한 반송.
export class DownloadTooLargeError extends Error {
  constructor(public readonly size: number, public readonly max: number) {
    super("too-large");
    this.name = "DownloadTooLargeError";
  }
}

// 다운로드 → blob 저장(토큰 헤더 필요 → fetch). 413 은 DownloadTooLargeError(크기·상한)로 승격.
async function saveBlob(url: string, filename: string): Promise<void> {
  const r = await fetch(url, { headers: authHeaders() });
  if (r.status === 413) {
    const d = await r.json().catch(() => ({} as { size?: number; max?: number }));
    throw new DownloadTooLargeError(Number(d.size ?? 0), Number(d.max ?? 0));
  }
  if (r.status === 401) { clearSession(); throw new Error("401 인증 만료 — 런처 링크로 재접속"); }
  if (!r.ok) throw new Error(`${r.status}`);
  const blob = await r.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(href);
}

export function downloadDoc(rel: string, filename: string, source?: string | null): Promise<void> {
  const src = source ? `&source=${encodeURIComponent(source)}` : "";
  return saveBlob(`/api/docs/${encodeDocPath(rel)}?download=1${src}`, filename);
}

export function downloadArtifact(runId: string, name: string): Promise<void> {
  return saveBlob(`/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`, name);
}

// artifact 미리보기 텍스트(다운로드 전용 라우트 → raw text). 413 은 TooLarge 로 승격.
export async function fetchArtifact(runId: string, name: string): Promise<string> {
  const r = await fetch(`/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`, { headers: authHeaders() });
  if (r.status === 413) {
    const d = await r.json().catch(() => ({} as { size?: number; max?: number }));
    throw new DownloadTooLargeError(Number(d.size ?? 0), Number(d.max ?? 0));
  }
  if (r.status === 401) { clearSession(); throw new Error("401 인증 만료 — 런처 링크로 재접속"); }
  if (!r.ok) throw new Error(`${r.status}`);
  return r.text();
}

// ── F3 Settings projectRoot 편집(M11) ──
// 서버 확정 계약(server-builder 완료·이대로 소비):
//   GET  /api/settings → { projectRoot, projectsHome:string|null, projectsHomeProvisioned:boolean, definitionEditEnabled:boolean, mutationEnabled:false }
//   POST /api/settings/project-root (mutating·Host/Origin/token 게이트) body { path, dryRun?:boolean=false } (strict Zod·미지 필드 400)
//     dryRun:true  → { ok:true, effectiveRoot, activeRunsWarning:number, requiresRestart:true, written:false }  (디스크 무변경)
//     dryRun:false → { accepted:true, requiresRestart:true, effectiveRoot, appliedAt, activeRunsWarning }
//     409 { error:"boundary-not-provisioned" } · 400 { error } (bad-input·symlink·reparse-point·denied-system-path·no-harness-marker·outside-projects-home·escape)
export type SettingsInfo = {
  projectRoot: string;
  projectsHome: string | null;
  projectsHomeProvisioned: boolean;
  definitionEditEnabled: boolean;
  mutationEnabled: false;
};
export type ProjectRootPreview = { ok: true; effectiveRoot: string; activeRunsWarning: number; requiresRestart: true; written: false };
export type ProjectRootSaved = { accepted: true; requiresRestart: true; effectiveRoot: string; appliedAt: string; activeRunsWarning: number };

// 400/409 거부를 구조 보존 승격(submitRun 패턴 동형) → UI 가 error 코드를 한국어로 매핑(A5·조용한 드롭 금지).
export class ProjectRootError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "ProjectRootError";
  }
}

// dryRun 프리뷰(true) / 실제 쓰기(false). 취소 시 UI 는 이 함수를 dryRun:false 로 호출하지 않음(A101 — 디스크 무변경).
export async function postProjectRoot(path: string, dryRun: boolean): Promise<ProjectRootPreview | ProjectRootSaved> {
  const r = await fetch("/api/settings/project-root", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ path, dryRun }),
  });
  if (r.status === 401) { clearSession(); throw new Error("401 인증 만료 — 런처 링크로 재접속"); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({} as { error?: string }));
    throw new ProjectRootError(r.status, String(d.error ?? r.status));
  }
  return r.json() as Promise<ProjectRootPreview | ProjectRootSaved>;
}

// A99 (a) 활성 run 취소 후 재시작 — 기존 cancel 경로 재사용(POST /api/runs/:id/cancel). running 상태 run 을 조회해 각각 취소.
// 실패한 개별 취소는 삼키고 시도 수만 집계(부분 실패 격리·A83). 반환: 취소 시도 수.
export async function cancelActiveRuns(): Promise<{ attempted: number; cancelled: number }> {
  const res = await apiGet<{ items: Array<{ runId: string; state: string | null }> }>("/api/runs?state=running&limit=200");
  const ids = res.items.map((x) => x.runId);
  let cancelled = 0;
  for (const id of ids) {
    try { await apiPost(`/api/runs/${encodeURIComponent(id)}/cancel`, {}); cancelled++; } catch { /* 개별 취소 실패 격리 */ }
  }
  return { attempted: ids.length, cancelled };
}

// ── Eval v1(E1/E2) 아티팩트 4축 평가 ──
export type EvalAxis = "trigger" | "structure" | "induction" | "pruning";
export type ArtifactFinding = { axis: EvalAxis | "completeness"; target: { anchor: string; range?: string; field?: string }; action: string; why: string; risk: "low" | "med" };
export type ArtifactScore = {
  kind: "agent" | "skill"; name: string; path: string; runtime: string; rubric: string;
  scores: Partial<Record<EvalAxis, number>>; grade: "A" | "B" | "C" | "D"; evaluation_mode: string; confidence: number;
  findings: ArtifactFinding[];
};
export type ArtifactEvalResult = {
  artifacts: ArtifactScore[];
  rollup: {
    axisAvg: Partial<Record<EvalAxis, number>>; gradeDist: Record<string, number>;
    worst: Array<{ name: string; axis: EvalAxis; score: number }>; count: number;
    health: { orphan: number; deadLink: number; coverageGap: number; drift: number };
  };
};
export const getArtifactEval = () => apiGet<ArtifactEvalResult>("/api/eval/artifacts");

// E5-a 지적 AI 자동 반영(초안·비동기). 적용은 putDefinition(사람 diff 승인)로.
export type RemediationReq = { action: string; why: string; target?: { anchor?: string; range?: string; field?: string } };
export type RemediationResult =
  | { status: "running" }
  | { status: "failed"; error: string }
  | { status: "invalid"; error: string }
  | { status: "ready"; kind: "agent" | "skill"; name: string; baseHash: string; stale: boolean; originalContent: string; proposedContent: string; findings: RemediationReq[] };
export const startRemediate = (kind: "agent" | "skill", name: string, baseHash: string, findings: RemediationReq[]) =>
  apiPost<{ runId: string; status: "running" }>("/api/eval/remediate", { kind, name, baseHash, findings });
export const getRemediation = (runId: string) => apiGet<RemediationResult>(`/api/eval/remediate/${encodeURIComponent(runId)}`);

// ── F16(M-f) 스킬 사본 drift 분류·다타깃 동기 ──
export type SkillCopyClass =
  | "canonical" | "symlink-to-canonical" | "hardlink-same-inode"
  | "copy-insync" | "copy-drift" | "broken";
export type SkillCopy = { dir: string; path: string; runtime: string; cls: SkillCopyClass; hash: string | null; nlink: number | null };
export type SkillSyncGroup = { skill: string; canonicalPath: string; canonicalHash: string | null; copies: SkillCopy[]; hasDrift: boolean; hasBroken: boolean };
export type SkillSyncResult = { path: string; status: string; newHash?: string; currentHash?: string };

export const getSkillGroups = () => apiGet<{ groups: SkillSyncGroup[] }>("/api/drift/skill-groups");
export const syncSkill = (skill: string, targets: { path: string; baseHash: string }[]) =>
  apiPost<{ skill: string; canonicalHash: string | null; results: SkillSyncResult[] }>(
    "/api/drift/sync-skill", { skill, targets });

// ── F7 정의 편집기(M12·첫 mutating·중대) ──
// 서버 확정 계약(server-builder 완료·이대로 소비):
//   GET  /api/{agents|skills}/:name/definition → 200 { name,sourcePath,pathId,content,baseHash,mtimeMs,editable }
//        · 400 invalid-name|path-unsafe · 404 not-found · 409 ambiguous-definition|codex-only-v0.7
//   PUT  …/definition (mutating·Host/Origin/token 게이트) body { content,baseHash,pathId,evalProposal? }
//        → 200 { ok,prevHash,newHash,pathId,sourcePath,codexDriftWarning }
//        · 403 edit-disabled · 400 bad-input|too-large|integrity(+detail)|backup-failed|path-unsafe
//        · 404 not-found · 409 stale-write(+currentHash)|path-id-mismatch|proposal-not-available|ambiguous|codex-only
//   POST …/definition/rollback body { expectedCurrentHash,backupHash }
//        → 200 { ok,prevHash,restoredHash,pathId } · 409 stale-rollback(+currentHash)|backup-hash-mismatch
//        · 404 no-backup · 400 integrity
//   POST /api/settings/definition-edit body { enabled:boolean } → 200 { ok,definitionEditEnabled }
import type { DefKind, DefinitionDoc, PutDefResult, RollbackResult } from "./defedit.js";
export type { DefKind, DefinitionDoc, PutDefResult, RollbackResult } from "./defedit.js";

// 400/403/409 거부를 구조 보존 승격(submitRun/ProjectRootError 동형). detail·currentHash 보존:
//   integrity detail(세부코드)·stale-write currentHash(A93 병합 뷰용) 을 UI 로 전달(조용한 드롭 금지).
export class DefEditError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detail?: unknown,
    public readonly currentHash?: string,
  ) {
    super(code);
    this.name = "DefEditError";
  }
}

const defSeg = (kind: DefKind) => (kind === "agent" ? "agents" : "skills");

async function defReject(r: Response): Promise<never> {
  if (r.status === 401) { clearSession(); throw new Error("401 인증 만료 — 런처 링크로 재접속"); }
  const d = await r.json().catch(() => ({} as { error?: string; detail?: unknown; currentHash?: unknown }));
  const currentHash = typeof d.currentHash === "string" ? d.currentHash : undefined;
  throw new DefEditError(r.status, String(d.error ?? r.status), d.detail, currentHash);
}

// GET 정의(이름→서버 정규경로 재조회). 클라 경로 페이로드 금지 — :name(논리 이름)만 전달.
export async function getDefinition(kind: DefKind, name: string): Promise<DefinitionDoc> {
  const r = await fetch(`/api/${defSeg(kind)}/${encodeURIComponent(name)}/definition`, { headers: authHeaders() });
  if (!r.ok) return defReject(r);
  return r.json() as Promise<DefinitionDoc>;
}

// PUT 저장(content·baseHash·pathId). 낙관적 동시성·무결성·백업은 서버 권위. 409 stale-write → currentHash 보존.
export async function putDefinition(
  kind: DefKind, name: string, body: { content: string; baseHash: string; pathId: string },
): Promise<PutDefResult> {
  const r = await fetch(`/api/${defSeg(kind)}/${encodeURIComponent(name)}/definition`, {
    method: "PUT",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) return defReject(r);
  return r.json() as Promise<PutDefResult>;
}

// POST 되돌리기(expectedCurrentHash·backupHash). 저장 직후 직전본으로 원자 복원.
export async function rollbackDefinition(
  kind: DefKind, name: string, body: { expectedCurrentHash: string; backupHash: string },
): Promise<RollbackResult> {
  const r = await fetch(`/api/${defSeg(kind)}/${encodeURIComponent(name)}/definition/rollback`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) return defReject(r);
  return r.json() as Promise<RollbackResult>;
}

// 게이트 토글(mutating·config RMW·타 필드 보존은 서버). off 기본·고위험 인지 후 활성(A85).
export async function setDefinitionEdit(enabled: boolean): Promise<{ ok: true; definitionEditEnabled: boolean }> {
  const r = await fetch("/api/settings/definition-edit", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ enabled }),
  });
  if (!r.ok) return defReject(r);
  return r.json() as Promise<{ ok: true; definitionEditEnabled: boolean }>;
}

// ── F8 Eval 대시보드(M13·축소안) ──
// 서버 확정 계약(server-builder 완료·이대로 소비):
//   GET  /api/evals                       → EvalsIndex(loop 목록·최근 요약·labels·evalsAvailable)
//   GET  /api/evals/:loop                 → LoopTrend(series asc·counts·trendSource:"scorecards-inprocess")
//   GET  /api/evals/:loop/:stage/:run     → ScorecardDetail(status·scorecard|null·verified)
//   GET  /api/evals/:loop/proposal        → EvalProposal(enabled·disabledReason·gate·triggers·provenance·autoApply:false)
//   GET  /api/evals/config                → EvalsConfigResolved(adoptionStage·thresholds{value,floor,effective}·metrics)
//   POST /api/evals/config (mutating·Host/Origin/token) body EvalsConfigPatch → { ok:true, config }
//     · 400 { error:"bad-input", detail } — adoptionStage:4·floor 미만·미지 필드(strict) → 거부(silent clamp 없음)
// GET 은 useApi(path) 로 소비(순수 조회). config 쓰기만 아래 전용 함수(구조 보존 승격·조용한 드롭 금지).
import type { EvalsConfigResolved, EvalsConfigPatch } from "./evals.js";
export type {
  EvalLabels, EvalsIndex, LoopIndexEntry, LoopLatest, LoopTrend, TrendPoint, VerdictCounts,
  ScorecardDetail, Scorecard, EvalProposal, ProposalGate, ProposalTrigger, ProposalProvenance,
  EvalsConfigResolved, EvalsConfigPatch, MetricSetting, ThresholdLeaf,
} from "./evals.js";

export class EvalsConfigError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly detail?: unknown) {
    super(code);
    this.name = "EvalsConfigError";
  }
}

// Part C 저장(mutating·config RMW·타 필드 보존은 서버 권위). 400 bad-input → 구조 보존 승격.
export async function postEvalsConfig(body: EvalsConfigPatch): Promise<{ ok: true; config: EvalsConfigResolved }> {
  const r = await fetch("/api/evals/config", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (r.status === 401) { clearSession(); throw new Error("401 인증 만료 — 런처 링크로 재접속"); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({} as { error?: string; detail?: unknown }));
    throw new EvalsConfigError(r.status, String(d.error ?? r.status), d.detail);
  }
  return r.json() as Promise<{ ok: true; config: EvalsConfigResolved }>;
}

// ── F10 하네스 컨텍스트 관리 + 빌더(M15·중대) ──
// 서버 확정 계약(server-builder 완료·이대로 소비):
//   GET  /api/context/tree                    → ContextTree(topFiles·roots·count·truncated)
//   GET  /api/context/file?path=<rel>[&download=1] → DocPreview 동형(F5 sendPreview·TOML 포함) / 400·404·413
//   PUT  /api/context/edit body {path}(아무것도 안 씀·읽기전용 신호) → 409 <runtime>-edit-v0.7|context-file-readonly|edit-via-f7
//   POST /api/context/build/draft body {kind,domain,role} → 200 {ok,kind,draft,applied:false} / 400·403·429·502
//   POST /api/context/build/create body {kind,name,content} → 200 {ok,created,sourcePath,pathId,newHash} / 400·403·409·429
import type {
  ContextTree, ContextFilePreview, DefKind as CtxDefKind,
} from "./context.js";
export type {
  Runtime, ContextTree, ContextNode, ContextTopFile, ContextRoot, ContextFilePreview,
  DraftSession, EditTarget, EditDecision,
} from "./context.js";

export const CONTEXT_TREE_PATH = "/api/context/tree";

// GET 파일 미리보기 경로(useApi 소비). rel 전체를 단일 쿼리값으로 인코딩(서버가 req.query.path.split("/") 재검증).
export function contextFilePath(rel: string): string {
  return `/api/context/file?path=${encodeURIComponent(rel)}`;
}

// 다운로드(413 → DownloadTooLargeError 승격·saveBlob 재사용).
export function downloadContextFile(rel: string, filename: string): Promise<void> {
  return saveBlob(`/api/context/file?path=${encodeURIComponent(rel)}&download=1`, filename);
}

// 400/409 거부를 구조 보존 승격(submitRun/DefEditError 동형) → UI 가 error 코드를 한국어로 매핑(조용한 드롭 금지).
export class ContextEditError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "ContextEditError";
  }
}
export class BuildError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly detail?: unknown) {
    super(code);
    this.name = "BuildError";
  }
}

// PUT /api/context/edit — 아무것도 쓰지 않는 읽기전용 신호(서버가 409 <runtime>-edit-v0.7 등 반환·방어용).
export type ContextEditProbe = { editable: boolean; runtime?: string };
export async function checkContextEdit(path: string): Promise<ContextEditProbe> {
  const r = await fetch("/api/context/edit", {
    method: "PUT",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ path }),
  });
  if (r.status === 401) { clearSession(); throw new ApiGetError(401, "/api/context/edit"); }
  if (r.status === 409) {
    const d = await r.json().catch(() => ({} as { error?: string }));
    throw new ContextEditError(409, String(d.error ?? "409")); // 읽기전용 신호(정상 흐름) — 구조 보존
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({} as { error?: string }));
    throw new ContextEditError(r.status, String(d.error ?? r.status));
  }
  return r.json() as Promise<ContextEditProbe>;
}

export type BuildDraftResult = { ok: true; kind: CtxDefKind; draft: string; applied: false };
export type BuildCreateResult = { ok: true; created: true; sourcePath: string; pathId: string; newHash: string };

// POST /api/context/build/draft — 초안 생성(디스크 미기록·applied:false). 400/403/429/502 구조 보존 승격.
export async function postBuildDraft(body: { kind: CtxDefKind; domain: string; role: string }): Promise<BuildDraftResult> {
  const r = await fetch("/api/context/build/draft", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (r.status === 401) { clearSession(); throw new ApiGetError(401, "/api/context/build/draft"); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({} as { error?: string; detail?: unknown }));
    throw new BuildError(r.status, String(d.error ?? r.status), d.detail);
  }
  return r.json() as Promise<BuildDraftResult>;
}

// POST /api/context/build/create — 승인 초안 → 신규 정의 생성(디스크 기록). 400/403/409/429 구조 보존 승격.
export async function postBuildCreate(body: { kind: CtxDefKind; name: string; content: string }): Promise<BuildCreateResult> {
  const r = await fetch("/api/context/build/create", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (r.status === 401) { clearSession(); throw new ApiGetError(401, "/api/context/build/create"); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({} as { error?: string; detail?: unknown }));
    throw new BuildError(r.status, String(d.error ?? r.status), d.detail);
  }
  return r.json() as Promise<BuildCreateResult>;
}

// C: 하네스 전체 초안 — 오케스트레이터+에이전트+스킬 세트(디스크 미기록·applied:false). 생성은 postBuildCreate 반복.
export type HarnessDraftItem = { name: string; content: string };
export type HarnessDraftResult = { ok: true; applied: false; draft: { orchestrator: HarnessDraftItem; agents: HarnessDraftItem[]; skills: HarnessDraftItem[] } };
export async function postHarnessDraft(body: { domain: string }): Promise<HarnessDraftResult> {
  const r = await fetch("/api/context/build/harness-draft", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ ...body, runtime: "claude" }),
  });
  if (r.status === 401) { clearSession(); throw new ApiGetError(401, "/api/context/build/harness-draft"); }
  if (!r.ok) {
    const d = await r.json().catch(() => ({} as { error?: string; detail?: unknown }));
    throw new BuildError(r.status, String(d.error ?? r.status), d.detail);
  }
  return r.json() as Promise<HarnessDraftResult>;
}

// F13(M-b): 공용·서브 스킬 역인덱스·분류(읽기전용).
export type SkillClassification = "orchestrator" | "shared-sub" | "orphan";
export interface SkillUsageEntry {
  skill: string; runtimes: string[]; runtimePaths: string[];
  classification: SkillClassification; usedBy: string[]; editViaF7: boolean;
}
export interface SkillUsageList { skills: SkillUsageEntry[] }

// F11: 팩토리(myharness) 유지관리 — 상태 조회 + 설치/업데이트/제거 + 게이트 토글.
export type SkillState =
  | { kind: "absent" }
  | { kind: "symlink"; points: string; synced: boolean }
  | { kind: "copy" }
  | { kind: "foreign" };
export interface FactoryStatus {
  isFactoryRepo: boolean;
  sourceVersion: string | null;
  maintenanceEnabled: boolean;
  targets: {
    claudeSkill: SkillState;
    sharedSkill: SkillState;
    marketplace: { installed: boolean; version: string | null; updateAvailable: boolean };
  };
}
export type FactoryTarget = "claude-skill" | "shared-skill";
export type FactoryAction = "install" | "update" | "remove";
export const setFactoryMaintenance = (enabled: boolean) =>
  apiPost<{ ok: true; factoryMaintenanceEnabled: boolean }>("/api/settings/factory-maintenance", { enabled });
export const applyFactory = (target: FactoryTarget, action: FactoryAction, confirm?: boolean) =>
  apiPost<{ ok: true; method: string; backup?: string; state: SkillState }>(
    "/api/factory/apply",
    confirm === undefined ? { target, action } : { target, action, confirm },
  );

// ── A94 전역 재연결 — 연결 프로브(healthz 비인증 + 경량 인증 GET) ──
// healthz(/api/ 밖·session-token 무관)로 liveness → up 이면 인증 GET(/api/settings)으로 토큰/bootstrap 확립 확인.
// 반환은 connection.nextConn 이 소비하는 Probe. 개별 통신 에러를 여기서 흡수(오버레이가 전역 처리·토스트 폭주 금지).
export async function probeConnection(): Promise<
  { healthOk: false } | { healthOk: true; authOk: true } | { healthOk: true; authOk: false; status: number }
> {
  try {
    const h = await fetch("/healthz", { signal: AbortSignal.timeout(4000) });
    if (!h.ok) return { healthOk: false };
  } catch { return { healthOk: false }; }
  // health up → 인증 확립 확인. 세션 없으면 401 취급(재인증 동선).
  if (!getSession()) return { healthOk: true, authOk: false, status: 401 };
  try {
    const r = await fetch("/api/settings", { headers: authHeaders(), signal: AbortSignal.timeout(4000) });
    if (r.status === 401) return { healthOk: true, authOk: false, status: 401 };
    if (!r.ok) return { healthOk: true, authOk: false, status: r.status };
    return { healthOk: true, authOk: true };
  } catch { return { healthOk: false }; } // 인증 GET 자체가 네트워크 실패 → 재시작 진행 중 취급(offline)
}
