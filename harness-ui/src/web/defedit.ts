// F7 M12 정의 편집기 — 순수 로직(React·fetch 무의존·테스트 대상).
// 서버 확정 계약 소비(shape 미러)·400/403/409 error 코드 한국어 매핑(조용한 드롭 금지·A80)·
// 라인 diff(로드본↔편집본 미리보기 + 409 병합 나란히 비교·A86/A93)·name 필수 힌트·롤백 body 도출.
// XSS: diff 는 순수 텍스트 op 배열만 반환 — 렌더는 React escape(dangerouslySetInnerHTML 금지·마크다운 아님).

export type DefKind = "agent" | "skill";

// GET /api/{agents|skills}/:name/definition → 200 (server-builder 확정·이대로 소비).
export type DefinitionDoc = {
  name: string;
  sourcePath: string;
  pathId: string;
  content: string;
  baseHash: string;
  mtimeMs: number;
  editable: boolean;
};

// PUT 성공 응답(200). codexDriftWarning=true(듀얼 피어 v0.7 비대상 — drift 경고만·DW8).
export type PutDefResult = {
  ok: true;
  prevHash: string;
  newHash: string;
  pathId: string;
  sourcePath: string;
  codexDriftWarning: boolean;
};

// POST …/rollback 성공 응답(200).
export type RollbackResult = {
  ok: true;
  prevHash: string;
  restoredHash: string;
  pathId: string;
};

// ── 서버 error 코드 → 한국어 인라인(A80·조용한 드롭 금지) ──
// GET(invalid-name·path-unsafe·not-found·ambiguous-definition·codex-only-v0.7)
// PUT(edit-disabled·bad-input·too-large·integrity·backup-failed·path-unsafe·not-found·stale-write·
//     path-id-mismatch·proposal-not-available·ambiguous-definition·codex-only-v0.7)
// rollback(edit-disabled·bad-input·path-unsafe·not-found·stale-rollback·backup-hash-mismatch·no-backup·integrity)
export const DEF_EDIT_ERRORS: Record<string, string> = {
  "invalid-name": "이름이 유효하지 않습니다.",
  "path-unsafe": "정의 파일 경로가 안전하지 않습니다(경계 밖·심링크) · 거부되었습니다.",
  "not-found": "정의 파일을 찾을 수 없습니다.",
  "ambiguous-definition": "같은 이름의 정의가 여러 개입니다 · 비결정 해소를 막기 위해 편집을 거부합니다(중복 이름 정리 필요).",
  "codex-only-v0.7": "이 스킬은 .agents(codex) 전용입니다 · .claude 정의 편집은 현재 지원하지 않습니다.",
  "edit-disabled": "정의 편집이 비활성 상태입니다 · Settings에서 켜세요.",
  "bad-input": "요청 형식이 올바르지 않습니다.",
  "too-large": "정의 파일이 최대 크기를 초과했습니다.",
  "integrity": "정의 무결성 검증에 실패했습니다(필수 필드 누락·YAML 위반·이름 변경 등).",
  "backup-failed": "백업 생성에 실패해 저장을 중단했습니다(되돌리기 불가 상태 방지).",
  "stale-write": "디스크의 정의가 그사이 변경되었습니다 · 편집 내용을 보존한 채 병합이 필요합니다.",
  "path-id-mismatch": "정의 경로가 조회 시점과 달라졌습니다 · 편집기를 다시 여세요.",
  "proposal-not-available": "평가 제안 적용 기능은 아직 사용할 수 없습니다.",
  "stale-rollback": "되돌리기 기준 상태가 디스크와 일치하지 않습니다 · 새로고침 후 다시 시도하세요.",
  "backup-hash-mismatch": "백업이 손상·변조되어 되돌릴 수 없습니다.",
  "no-backup": "되돌릴 백업이 없습니다.",
};

// integrity(400) 세부 코드(canonicalizeDefinition error) → 한국어. name 필수 안내 포함.
export const INTEGRITY_DETAIL: Record<string, string> = {
  "no-frontmatter": "frontmatter(--- 블록)가 없습니다.",
  "yaml-parse": "YAML 파싱에 실패했습니다(문법 오류).",
  "empty-frontmatter": "frontmatter 내용이 비어 있습니다.",
  "multi-document": "여러 YAML 문서(--- 반복)는 허용되지 않습니다.",
  "duplicate-key": "중복된 키가 있습니다.",
  "not-a-map": "frontmatter 는 키-값 맵이어야 합니다.",
  "field:name": "name 필드가 필요합니다(name 없는 스킬은 저장 시 name: 명시 필요).",
  "field:description": "description 필드가 필요합니다.",
  "schema": "정의 스키마 검증에 실패했습니다.",
  "name-changed": "이름(name)은 변경할 수 없습니다(리네임 금지).",
  "empty-body": "본문이 비어 있습니다.",
  "reader-divergence": "재직렬화 결과가 런타임 리더 파싱과 달라 거부되었습니다.",
};

// error 코드 → 한국어 인라인 메시지(A5). 미지 코드 → 상태코드·코드 포함 폴백(조용한 드롭 아님).
// integrity 는 detail(문자열 세부코드) 을 추가 병기(name 필수 안내 등).
export function defEditErrorText(code: string, status?: number, detail?: unknown): string {
  if (code === "integrity" && typeof detail === "string") {
    const sub = INTEGRITY_DETAIL[detail];
    return `${DEF_EDIT_ERRORS.integrity}${sub ? ` — ${sub}` : ` (${detail})`}`;
  }
  const known = DEF_EDIT_ERRORS[code];
  if (known) return known;
  return `정의 편집 실패${status ? ` (${status})` : ""}${code ? ` · ${code}` : ""}.`;
}

// ── 라인 diff (로드본↔편집본 미리보기 · 409 디스크본↔편집본 병합 뷰) ──
// 순수 텍스트 op 배열(LCS 기반). 렌더는 React escape — HTML 주입 없음(F5 DV8 원칙).
export type DiffKind = "same" | "add" | "del";
export type DiffOp = { kind: DiffKind; text: string };

// 대용량(256KB) 정의에서 LCS DP(O(n·m)) 메모리 폭발 방지 상한. 초과 시 coarse(전체 교체) 폴백.
const MAX_DIFF_CELLS = 2_000_000;

export function isDiffCoarse(a: string, b: string): boolean {
  if (a === b) return false;
  const n = a.split("\n").length, m = b.split("\n").length;
  return n * m > MAX_DIFF_CELLS;
}

// a(이전)→b(이후) 라인 diff. same/del(a에만)/add(b에만). 결정적.
// 개행 분리는 /\r?\n/ — 로드본(디스크·CRLF 가능)의 라인 끝 \r 를 제거해
// \n 정규화된 편집본과 내용 기준으로 비교(CRLF 로 인한 diff 오인 방지).
export function diffLines(a: string, b: string): DiffOp[] {
  if (a === b) return a === "" ? [] : a.split(/\r?\n/).map((text) => ({ kind: "same" as const, text }));
  const aa = a.split(/\r?\n/), bb = b.split(/\r?\n/);
  const n = aa.length, m = bb.length;
  if (n * m > MAX_DIFF_CELLS) {
    // coarse 폴백 — 정밀 정렬 생략(전체 삭제→전체 추가). UI 는 isDiffCoarse 로 고지.
    return [...aa.map((text) => ({ kind: "del" as const, text })), ...bb.map((text) => ({ kind: "add" as const, text }))];
  }
  // LCS 길이 DP(뒤에서 앞). dp[i][j] = aa[i..], bb[j..] 최장공통. 루프 경계가 인덱스 유효 보장(! 단언).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = aa[i] === bb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aa[i] === bb[j]) { ops.push({ kind: "same", text: aa[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { ops.push({ kind: "del", text: aa[i]! }); i++; }
    else { ops.push({ kind: "add", text: bb[j]! }); j++; }
  }
  while (i < n) { ops.push({ kind: "del", text: aa[i]! }); i++; }
  while (j < m) { ops.push({ kind: "add", text: bb[j]! }); j++; }
  return ops;
}

export function hasChanges(a: string, b: string): boolean {
  return a !== b;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const o of ops) { if (o.kind === "add") added++; else if (o.kind === "del") removed++; }
  return { added, removed };
}

// 나란히 비교(409 병합 뷰 최소구현) — del=좌측만·add=우측만·same=양쪽.
export type SideRow = { left: string | null; right: string | null; kind: DiffKind };
export function sideRows(ops: DiffOp[]): SideRow[] {
  return ops.map((o) =>
    o.kind === "same" ? { left: o.text, right: o.text, kind: o.kind }
    : o.kind === "del" ? { left: o.text, right: null, kind: o.kind }
    : { left: null, right: o.text, kind: o.kind });
}

// ── name 필수 힌트(name 없는 스킬 저장 전 안내) ──
// 런타임 동일 고정 추출: 첫 `---`~다음 `---` 쌍(harness.ts 정규식 미러).
function extractFrontmatter(content: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return m ? m[1]! : null;
}

// 렌더 미리보기용: frontmatter(--- 블록)와 본문 분리. 정의는 YAML frontmatter 를 가져 md 렌더 시 `---` 가
//   setext heading 으로 오해석(요약정보가 타이틀 폰트) → 렌더 모드는 frontmatter 를 떼고 본문만 md 렌더한다.
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: m[1]!, body: content.slice(m[0].length) };
}

// 스킬이고 frontmatter 에 name 키가 없으면 true(저장 시 400 integrity field:name 예방 안내).
export function skillNeedsName(kind: DefKind, content: string): boolean {
  if (kind !== "skill") return false;
  const fm = extractFrontmatter(content);
  if (fm === null) return true; // frontmatter 자체 부재 → name 도 없음
  return !/^name\s*:/m.test(fm);
}

// 스킬 편집 가능 사전 판정(버튼 disabled/툴팁용) — .claude 정의가 있어야 편집 대상.
// runtimePaths 가 전부 .agents(codex) 뿐이면 codex-only(v0.7 비대상) → 편집 버튼 비활성.
export function skillHasClaudePath(runtimePaths: string[]): boolean {
  return runtimePaths.some((p) => p.startsWith(".claude"));
}

// ── 편집기 상태 헬퍼 ──
export function isDirty(loaded: string, edited: string): boolean {
  return loaded !== edited;
}

// 저장 결과 → 되돌리기 body. rollback 은 현재 디스크(저장 후=newHash) 를 백업(저장 전=prevHash)으로 복원.
export function rollbackBodyFromSave(save: PutDefResult): { expectedCurrentHash: string; backupHash: string } {
  return { expectedCurrentHash: save.newHash, backupHash: save.prevHash };
}
