// F10 M15 하네스 컨텍스트 관리 + 빌더 — 순수 로직(React·fetch 무의존·TDD 대상).
//   서버 확정 계약 소비(shape 미러)·런타임 배지/필터·편집 활성 판정(runtime==claude && 정의경로)·
//   400/403/409/429/502 error 코드 한국어 매핑(조용한 드롭 금지·A128)·미적용 초안 세션 유지(A107).
// XSS: 여기서 만드는 문자열(스니펫·에러문구)은 전부 데이터 — 렌더는 React escape(dangerouslySetInnerHTML 금지).

// 런타임 라벨(서버 contextpaths.Runtime 미러). `.agents/skills`·AGENTS.md 는 codex·agy 공유("codex/agy").
export type Runtime = "claude" | "codex" | "agy" | "codex/agy";

// GET /api/context/tree → 서버 ContextTree 미러(server-builder 확정·이대로 소비).
export type ContextNode =
  | { type: "dir"; name: string; path: string; runtime: Runtime; children: ContextNode[] }
  | { type: "file"; name: string; path: string; runtime: Runtime; ext: string };
export type ContextTopFile = { name: string; path: string; runtime: Runtime; present: boolean };
export type ContextRoot = { path: string; runtime: Runtime; present: boolean; children: ContextNode[] };
export type ContextTree = {
  projectRoot: string;
  topFiles: ContextTopFile[];
  roots: ContextRoot[];
  count: number;
  truncated: boolean;
};

// GET /api/context/file → F5 sendPreview 동형(TOML 포함). DocPreview 와 동일 shape(순환 import 회피 위해 재정의).
export type ContextFilePreview = {
  path: string; name: string; mime: string; size: number;
  renderable: boolean; binary: boolean; truncated: boolean; content: string | null;
};

// ── 런타임 배지(A128·A92 색 비의존) — 라벨 텍스트가 곧 의미(색은 보조). Badge kind 는 시각 구분만. ──
export function runtimeBadgeKind(runtime: Runtime): "ok" | "warn" | "muted" | "err" {
  switch (runtime) {
    case "claude": return "ok";       // 편집 가능(claude 정의)
    case "codex": return "warn";
    case "agy": return "muted";
    case "codex/agy": return "warn";  // 공유 런타임
    default: return "muted";
  }
}

// ── 런타임 필터(A128) — 트리에 실재(present)하는 distinct 런타임만 칩으로 노출·정본 순서 고정. ──
const RUNTIME_ORDER: Runtime[] = ["claude", "codex", "agy", "codex/agy"];

export function availableRuntimes(tree: ContextTree): Runtime[] {
  const seen = new Set<Runtime>();
  for (const f of tree.topFiles) if (f.present) seen.add(f.runtime);
  for (const r of tree.roots) if (r.present) seen.add(r.runtime);
  return RUNTIME_ORDER.filter((r) => seen.has(r));
}

// 런타임 필터 적용(null = 전체). 서브루트 내 모든 노드는 root.runtime 과 동일(정밀 서브루트 규율)이라
//   root 단위 exact 매칭으로 충분·결정적. topFiles 는 개별 runtime exact 매칭.
export function filterContextTree(tree: ContextTree, runtime: Runtime | null): ContextTree {
  if (runtime === null) return tree;
  return {
    ...tree,
    topFiles: tree.topFiles.filter((f) => f.runtime === runtime),
    roots: tree.roots.filter((r) => r.runtime === runtime),
  };
}

// 선택된 rel 경로의 파일 노드(runtime 동반) 조회 — topFiles(present) + roots 하위 재귀. 없으면 null.
//   편집 게이트 판정(editDecision)에 필요한 runtime 을 트리에서 권위적으로 재확인(클라 추정 금지).
export function findContextFile(tree: ContextTree, path: string): { runtime: Runtime; path: string } | null {
  for (const f of tree.topFiles) if (f.present && f.path === path) return { runtime: f.runtime, path: f.path };
  const walk = (nodes: ContextNode[]): { runtime: Runtime; path: string } | null => {
    for (const n of nodes) {
      if (n.type === "file") { if (n.path === path) return { runtime: n.runtime, path: n.path }; }
      else { const r = walk(n.children); if (r) return r; }
    }
    return null;
  };
  for (const root of tree.roots) { const r = walk(root.children); if (r) return r; }
  return null;
}

// ── 편집 활성 판정(A128·핵심 계약) — runtime==="claude" && 정의 경로(.claude/agents·skills)일 때만. ──
export type DefKind = "agent" | "skill";
export type EditTarget = { kind: DefKind; name: string };

// F7 편집 대상 정의 경로 → {kind,name}. **컨텍스트 트리가 노출하는 서브루트에 한정**(서버 classifyContextPath 동형):
//   claude md 에이전트/스킬 · codex toml 에이전트 · shared(.agents) 스킬. `.gemini`는 컨텍스트 트리 스코프 밖
//   (서버가 classifyContextPath 에서 400 invalid-path·트리 미노출)이라 **제외** — 서버/웹 동형(R5 codex MED).
//   (gemini 정의 자체는 F7 이름 재조회로 편집 가능하나, 컨텍스트 트리 딥링크 대상은 아님.)
//   이름 = 파일/디렉토리명(ARGV 정합·첫 글자 영숫자·서버 probe 와 동일 엄격도·R5 codex LOW).
const MD_AGENT_DEF = /^\.claude\/agents\/([A-Za-z0-9][A-Za-z0-9._-]*)\.md$/;
const TOML_AGENT_DEF = /^\.codex\/agents\/([A-Za-z0-9][A-Za-z0-9._-]*)\.toml$/;
const SKILL_DEF = /^(?:\.claude|\.agents)\/skills\/([A-Za-z0-9][A-Za-z0-9._-]*)\/SKILL\.md$/;

export function contextEditTarget(path: string): EditTarget | null {
  const a = MD_AGENT_DEF.exec(path) ?? TOML_AGENT_DEF.exec(path);
  if (a) return { kind: "agent", name: a[1]! };
  const s = SKILL_DEF.exec(path);
  if (s) return { kind: "skill", name: s[1]! };
  return null;
}

export type EditDecision =
  | { editable: true; kind: DefKind; name: string }
  | { editable: false; reason: string };

// 편집 버튼 게이트(A81·A128). gateOff → 사유(Settings 안내는 화면에서 부착). claude 아님/정의경로 아님 → 사유.
export function editDecision(
  node: { runtime: Runtime; path: string; type: "dir" | "file" },
  gateOn: boolean,
): EditDecision {
  if (!gateOn) return { editable: false, reason: "정의 편집이 비활성입니다" };
  if (node.type !== "file") return { editable: false, reason: "디렉토리는 편집 대상이 아닙니다" };
  // F14/F15(M-c·M-e): 편집 가능 정의(claude·gemini md·codex toml)면 런타임 무관 F7 편집. 그 외는 읽기전용(사유).
  const t = contextEditTarget(node.path);
  if (t) return { editable: true, kind: t.kind, name: t.name };
  return { editable: false, reason: contextReadonlyReason(node.runtime, node.path) };
}

// 읽기전용 사유(A128 배지 툴팁·색 비의존 텍스트). 서버 409 신호와 동형(codex/agy=v0.7 비대상·top file=읽기전용 컨텍스트).
export function contextReadonlyReason(runtime: Runtime, path: string): string {
  if (runtime === "codex") return "Codex 정의 편집은 현재 지원하지 않습니다(읽기 전용)";
  if (runtime === "agy") return "Antigravity 컨텍스트 편집은 현재 지원하지 않습니다(읽기 전용)";
  if (runtime === "codex/agy") return "Codex/Antigravity 공유 정의 편집은 현재 지원하지 않습니다(읽기 전용)";
  // claude 인데 정의 파일이 아니거나 top file(CLAUDE.md)인 경우.
  if (contextEditTarget(path) === null) return "이 파일은 읽기전용 컨텍스트입니다";
  return "읽기전용 컨텍스트입니다";
}

// ── 서버 error 코드 → 한국어 인라인(A128·조용한 드롭 금지) ──
// PUT /api/context/edit(409): <runtime>-edit-v0.7·context-file-readonly·edit-via-f7 / 400 invalid-path·bad-input.
export const CONTEXT_EDIT_ERRORS: Record<string, string> = {
  "codex-edit-v0.7": "Codex 정의 편집은 현재 지원하지 않습니다 · 읽기 전용으로 확인하세요.",
  "codex/agy-edit-v0.7": "Codex/Antigravity 공유 정의 편집은 현재 지원하지 않습니다 · 읽기 전용으로 확인하세요.",
  "agy-edit-v0.7": "Antigravity 컨텍스트 편집은 현재 지원하지 않습니다 · 읽기 전용으로 확인하세요.",
  "context-file-readonly": "이 컨텍스트 파일(CLAUDE/AGENTS/GEMINI.md)은 읽기 전용입니다 · UI 편집 대상이 아닙니다.",
  "edit-via-f7": "에이전트/스킬 정의는 정의 편집기에서 편집하세요.",
  "invalid-path": "경로가 유효하지 않습니다 · 화이트리스트 밖이거나 안전하지 않습니다.",
  "bad-input": "요청 형식이 올바르지 않습니다.",
};

export function contextEditErrorText(code: string, status = 409): string {
  const mapped = CONTEXT_EDIT_ERRORS[code];
  if (mapped) return mapped;
  return `편집을 처리할 수 없습니다(코드 ${code} · 상태 ${status}).`; // 미지 코드 폴백(조용한 드롭 아님)
}

// ── 빌더 error 코드 → 한국어(A124~A127·조용한 드롭 금지) ──
// draft(200/400 bad-input/403 edit-disabled/429 build-in-progress|build-cooldown/502 draft-failed|runtime-not-found|empty-draft)
// create(200/400 bad-input|too-large|invalid-name|integrity|path-unsafe/403 edit-disabled/409 name-collision/429 build-in-progress)
export const BUILD_ERRORS: Record<string, string> = {
  "bad-input": "입력이 유효하지 않습니다 · domain/role 길이·kind 값을 확인하세요.",
  "edit-disabled": "정의 편집(빌더)이 비활성 상태입니다 · Settings에서 켜세요.",
  "build-in-progress": "다른 빌드가 진행 중입니다 · 완료 후 다시 시도하세요.",
  "build-cooldown": "직전 초안 생성 직후입니다 · 잠시 후 다시 시도하세요.",
  "draft-failed": "초안 생성에 실패했습니다(런타임 오류) · 잠시 후 다시 시도하세요.",
  "runtime-not-found": "claude 실행 파일을 찾을 수 없습니다 · 설치·경로를 확인하세요.",
  "empty-draft": "초안이 비어 있습니다 · domain/role 을 구체화해 다시 시도하세요.",
  "too-large": "초안이 최대 크기를 초과했습니다.",
  "invalid-name": "이름이 유효하지 않습니다 · 첫 글자는 영숫자, 경로 문자·점 시작 금지.",
  "integrity": "초안 무결성 검증에 실패했습니다(필수 필드 누락·YAML 위반·이름 불일치).",
  "path-unsafe": "생성 경로가 안전하지 않습니다 · 거부되었습니다.",
  "name-collision": "같은 이름의 정의가 이미 있습니다 · 다른 이름을 쓰세요.",
};

export function buildErrorText(code: string, status = 400): string {
  const mapped = BUILD_ERRORS[code];
  if (mapped) return mapped;
  return `빌드를 처리할 수 없습니다(코드 ${code} · 상태 ${status}).`; // 미지 코드 폴백
}

// ── 미적용 초안 세션 유지(A107) — 서버 무상태 → 클라 sessionStorage 로 유실 방지(탭 전환·리로드). ──
// 저장 대상 = 폼 입력 + 생성된 초안 텍스트 + 생성 이름. 승인·생성 완료 시 clear(잔존 stale 방지).
export type DraftSession = {
  kind: DefKind;
  domain: string;
  role: string;
  name: string;
  draft: string | null; // null = 아직 초안 미생성(폼만 저장)
};

const DRAFT_KEY = "harness-context-draft";

export function saveDraftSession(s: DraftSession): void {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(s)); } catch { /* private mode·무시 */ }
}

// 파싱 실패·형태 불일치 → null(오염된 저장분을 조용히 폐기·크래시 금지).
export function loadDraftSession(): DraftSession | null {
  let raw: string | null;
  try { raw = sessionStorage.getItem(DRAFT_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<DraftSession>;
    if (o.kind !== "agent" && o.kind !== "skill") return null;
    if (typeof o.domain !== "string" || typeof o.role !== "string" || typeof o.name !== "string") return null;
    if (o.draft !== null && typeof o.draft !== "string") return null;
    return { kind: o.kind, domain: o.domain, role: o.role, name: o.name, draft: o.draft ?? null };
  } catch { return null; }
}

export function clearDraftSession(): void {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

// ── CLAUDE.md 포인터 스니펫(A128 · 클립보드 복사·자동 쓰기 없음) ──
// 신규 생성한 정의를 CLAUDE.md 에 사람 손으로 붙일 수 있는 포인터 마크다운. 자동 디스크 쓰기 금지(수동 붙여넣기).
export function claudePointerSnippet(t: { kind: DefKind; name: string; sourcePath: string }): string {
  if (t.kind === "agent") {
    return `- **${t.name}** (\`${t.sourcePath}\`) — 에이전트. 이 에이전트에게 위임할 작업을 여기에 기술하세요.`;
  }
  return `- **${t.name}** (\`${t.sourcePath}\`) — 스킬. 트리거 조건을 여기에 기술하세요. 예: \`${t.name}\` 관련 작업 시 이 스킬을 사용하라.`;
}
