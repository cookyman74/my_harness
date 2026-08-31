// E1(Eval v1·design §1·§2): 하네스 아티팩트 4축 단일 평가 — **계층A(정적·결정적)만**.
//   트리거·구조·유도·가지치기를 파일 파싱만으로 채점(LLM·삭제 테스트=계층B/E3·여기 없음).
//   findings 는 전부 **구조적·저위험**(delete-candidate 같은 고위험 LLM 판정 없음). evaluation_mode="static".
//   설계 안전 반영: kind별 rubric 분기(TOML 은 문장 삭제/유도 미적용)·min-gate(구조 과락→상한)·완전성 가드·content-hash anchor.
import { createHash } from "node:crypto";
import { opendir } from "node:fs/promises";
import { join } from "node:path";
import { readAgents, readSkills, readCappedDef } from "./harness.js";
import { isSafeSegment } from "../lib/paths.js";
import { computeHarnessScorecard, type Finding as HFinding } from "./scorecard.js";
import TOML from "@iarna/toml";

export type Axis = "trigger" | "structure" | "induction" | "pruning";
export type ArtifactRubric = "md-agent" | "md-skill" | "toml-agent";
export type Grade = "A" | "B" | "C" | "D";

// P0-d: 계층B 확장 지점. 현재 산출은 전부 "static" 이지만 타입을 리터럴로 굳혀두면
//   계층B(deep·cross_checked)를 붙일 때 인터페이스부터 깨진다 — 확장 지점을 미리 연다.
export type EvaluationMode = "static" | "deep" | "cross_checked";

// P0-d: confidence 하드코딩 3곳(toml-agent 0.45 · md-agent 0.5 · md-skill 0.5)을 rubric×mode 표로 분리.
//   값 자체는 현행 유지(회귀 금지) — 흩어진 리터럴을 단일 출처로 모으는 것이 목적이다.
//   toml-agent 가 낮은 이유: 4축 중 induction/pruning 미적용(구조화 파일)이라 근거 축이 적다.
//   deep/cross_checked 는 계층B 도입 전까지 **미측정**이다. 추측값을 넣으면 계층B가 붙기도 전에
//   "높은 confidence" 가 UI 에 노출된다 — 도입 시점에 실측으로 채운다(R-1: 없는 것을 전제하지 않는다).
export const CONFIDENCE_BY_RUBRIC_MODE: Record<ArtifactRubric, Partial<Record<EvaluationMode, number>>> = {
  "toml-agent": { static: 0.45 },
  "md-agent": { static: 0.5 },
  "md-skill": { static: 0.5 },
};
export function confidenceOf(rubric: ArtifactRubric, mode: EvaluationMode): number {
  const v = CONFIDENCE_BY_RUBRIC_MODE[rubric][mode];
  if (v == null) throw new Error(`confidence 미정의: rubric=${rubric} mode=${mode} — 계층B 도입 시 실측값으로 채울 것`);
  return v;
}

// P0-d: 등급 임계를 명명 상수로 노출한다. 테스트가 0.9/0.75/0.6 리터럴을 박으면
//   캘리브레이션으로 임계가 바뀔 때 "테스트가 현행값을 고정" 하는 교착이 생긴다(계획서 R14).
//   경계 테스트는 이 상수를 참조해 **채택된 임계의 직전·직후**를 검증해야 한다.
// 필수 섹션 목록의 **단일 출처**. `SKILL.md:113`(에이전트 5종)·ADR-001 D7 과 같은 값이어야 한다.
// 문자열 포함 매칭이므로 `## 입력/출력 프로토콜`·`## 팀 통신 프로토콜` 은 둘 다 "프로토콜" 을,
// `## 협업 / 팀 통신 프로토콜` 은 "협업" 을 만족한다.
export const REQUIRED_SECTIONS = {
  agent: ["역할", "원칙", "프로토콜", "에러", "협업"],
  skill: ["절차", "트리거"],
} as const;

export const GRADE_THRESHOLDS = { A: 0.9, B: 0.75, C: 0.6 } as const;

export interface Finding {
  axis: Axis | "completeness";
  target: { anchor: string; range?: string; field?: string }; // content-hash anchor(line-only stale 방지·design §2)
  action: "add-trigger-context" | "shrink-skill" | "move-to-references" | "add-required-section" | "dedupe" | "rewrite-description";
  why: string;
  risk: "low" | "med"; // E1 정적은 저위험만(고위험 delete=계층B/E3)
}
export interface ArtifactScore {
  kind: "agent" | "skill";
  name: string;
  path: string;
  runtime: string;
  rubric: ArtifactRubric;
  scores: Partial<Record<Axis, number>>; // 적용 축만(TOML 은 induction/pruning 제외)
  grade: Grade;
  evaluation_mode: EvaluationMode;
  confidence: number; // rubric×mode 표에서 도출(confidenceOf) — 흩어진 리터럴 금지
  findings: Finding[];
}
export interface ArtifactEval {
  artifacts: ArtifactScore[];
  rollup: {
    axisAvg: Partial<Record<Axis, number>>;
    gradeDist: Record<Grade, number>;
    worst: Array<{ name: string; axis: Axis; score: number }>;
    count: number;
    // 관계 건강(구성 자기평가 흡수): 4축이 못 잡는 그래프 신호. 차트 하나로 전체 현황.
    health: { orphan: number; deadLink: number; coverageGap: number; drift: number };
  };
}

// 관계 FindingType → 4축 매핑(design §8 흡수): orphan/coverage=가지치기·dead_link=구조·오탐 아닌 감점만.
//   subject_kind agent/skill 인 것만 per-artifact 병합. pointer/runtime(dead_link 포인터·drift)은 rollup.health 로.
export type RelHit = { axis: Axis; mult: number; risk: "low" | "med"; action: Finding["action"]; why: string };
export function relOfFinding(f: HFinding): RelHit | null {
  switch (f.type) {
    case "orphan": return { axis: "pruning", mult: 0.55, risk: "med", action: "dedupe", why: "연결 증거 없음(orphan) — 삭제 후보(사람 판단)" };
    case "coverage_gap": return { axis: "pruning", mult: 0.85, risk: "low", action: "dedupe", why: "오케스트레이터 미배정(coverage-gap)" };
    case "dead_link": return { axis: "structure", mult: 0.7, risk: "med", action: "add-required-section", why: `끊긴 포인터(dead-link${f.target ? ": " + f.target : ""})` };
    case "incomplete_def": return { axis: "structure", mult: 0.8, risk: "low", action: "add-required-section", why: "무효/불완전 선언(incomplete-def)" };
    default: return null; // link_unknown/unknown_scope/oversize(4축 구조 중복) = 감점 아님
  }
}

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// frontmatter/본문 분리(harness.parseFrontmatter 는 필드만·본문 필요) — 첫 --- 쌍.
function splitBody(text: string): { fm: string; body: string } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { fm: "", body: text.replace(/^\uFEFF/, "") };
  return { fm: m[1]!, body: text.slice(m[0].length) };
}
function lines(s: string): string[] { return s.split(/\r?\n/); }
function bodyLineCount(body: string): number { return lines(body).filter((l) => l.trim().length > 0).length; }

// ── BEHAVIOR 참조(ADR-001 D1·D7) ───────────────────────────────────────
// `behaviors:` 는 frontmatter 가 **단일 출처**다. 본문을 heuristic 하게 읽지 않는다.
// 지원 형태는 `check-behaviors.sh` 와 같다: 블록 시퀀스 · `[a, b]` flow. 그 외는 참조 0개로 본다
// (채점기는 검사기가 아니다 — 형식 위반은 `check-behaviors.sh` 가 fail 시킨다).
const BEHAVIOR_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export function parseBehaviorRefs(fm: string): string[] {
  const ls = lines(fm).map((l) => l.replace(/\r$/, ""));
  const i = ls.findIndex((l) => /^behaviors:/.test(l));
  if (i < 0) return [];
  const inline = ls[i]!.replace(/^behaviors:[ \t]*/, "").replace(/[ \t]*#.*$/, "").trim();
  const out: string[] = [];
  const push = (v: string): void => {
    const s = v.replace(/[ \t]*#.*$/, "").trim().replace(/^["']|["']$/g, "").trim();
    if (s && BEHAVIOR_NAME.test(s)) out.push(s);
  };
  if (inline.startsWith("[") && inline.endsWith("]")) {
    for (const part of inline.slice(1, -1).split(",")) push(part);
    return out;
  }
  if (inline) return []; // 스칼라 등 미지원 표기 — 참조 0개
  for (let k = i + 1; k < ls.length; k++) {
    const l = ls[k]!;
    if (/^[ \t]*$/.test(l) || /^[ \t]*#/.test(l)) continue; // 빈 줄·주석은 블록을 닫지 않는다
    if (!/^[ \t]*-/.test(l)) break;                          // 항목이 아니면 다음 키
    push(l.replace(/^[ \t]*-[ \t]*/, ""));
  }
  return out;
}

// 섹션 포인터 — `> BEHAVIOR: <name>` 한 줄 고정(ADR-001 D1·R16~R18).
// 들여쓰기 3칸까지, 이름은 디렉토리명 규칙(`\S+` 는 `../x` 경로 탈출을 허용해 폐기·R18).
// **코드펜스 안은 제외**한다(R17: 정규식만 쓰면 예제 문자열을 포인터로 오인한다).
const POINTER = /^ {0,3}>\s*BEHAVIOR:\s*([a-z0-9]([a-z0-9-]*[a-z0-9])?)\s*$/;
const FENCE_ANY = /^\s{0,3}(?:```|~~~)/;   // 물결표 fence 도 fence 다
export type PointerScan = { pointers: string[]; unclosedFence: boolean; nonPointerLines: number };
export function scanPointers(body: string): PointerScan {
  const ls = lines(body);
  let inFence = false, fenceTok = "";
  const pointers: string[] = [];
  let nonPointerLines = 0;
  for (const raw of ls) {
    const l = raw.replace(/\r$/, "");
    const fm = FENCE_ANY.exec(l);
    if (fm) {
      const tok = l.trim().slice(0, 3);
      if (!inFence) { inFence = true; fenceTok = tok; continue; }
      if (tok === fenceTok) { inFence = false; fenceTok = ""; continue; }
    }
    if (inFence) { if (l.trim()) nonPointerLines++; continue; }  // 펜스 안 내용도 **실체로 센다**
    const pm = POINTER.exec(l);
    if (pm) { pointers.push(pm[1]!); continue; }
    if (l.trim()) nonPointerLines++;
  }
  return { pointers, unclosedFence: inFence, nonPointerLines };
}

// 본문을 heading 단위로 쪼갠다(R11 양 엔진 — 현행엔 "특정 heading 에 속한 본문"을 보는 로직이
// 없었다). 각 섹션의 **실체 줄**(포인터 아닌 내용)과 **포인터**를 함께 센다.
export type Section = { heading: string; pointers: string[]; substantive: number };
export function splitSections(body: string): Section[] {
  const ls = lines(body);
  const out: Section[] = [];
  let cur: string[] = [], head = "";
  const flush = (): void => {
    if (!head && cur.length === 0) return;
    const sc = scanPointers(cur.join("\n"));
    out.push({ heading: head, pointers: sc.pointers, substantive: sc.nonPointerLines });
  };
  let inFence = false, tok = "";
  for (const raw of ls) {
    const l = raw.replace(/\r$/, "");
    const fm = FENCE_ANY.exec(l);
    if (fm) { const t2 = l.trim().slice(0, 3); if (!inFence) { inFence = true; tok = t2; } else if (t2 === tok) { inFence = false; tok = ""; } }
    // 펜스 안의 `## …` 는 heading 이 아니다(예제 코드).
    if (!inFence && /^#{1,6}\s/.test(l)) { flush(); head = l; cur = []; continue; }
    cur.push(l);
  }
  flush();
  return out;
}

// ── 축별 계층A 채점(결정적) ─────────────────────────────────────────────
// ① 트리거 — description ROI(존재·길이 밴드·트리거 상황 키워드·near-miss 구분). 언어 편향 있어 finding 위주.
// \b 는 한글 경계에서 불안정(agy MED) → 한글은 명시 문맥, 영어만 \b 사용.
const TRIGGER_KW = /(때|요청|사용|할\s*때|하려면|하는\s*경우|use\s+when|\bwhen\b|trigger)/i;
const NEARMISS_KW = /(아니|않|말고|대신|달리|instead|unlike|not\s+for|near-miss|유사하나|구분|\bvs\b)/i;
function scoreTrigger(desc: string, findings: Finding[], anchor: string): number {
  const d = (desc ?? "").trim();
  if (!d) { findings.push({ axis: "trigger", target: { anchor, field: "description" }, action: "rewrite-description", why: "description 없음(트리거 불가)", risk: "med" }); return 0; }
  let s = 0.4; // 존재
  const len = d.length;
  if (len >= 40 && len <= 600) s += 0.2; else if (len < 40) findings.push({ axis: "trigger", target: { anchor, field: "description" }, action: "add-trigger-context", why: `description 과소(${len}자)·트리거 상황 부족`, risk: "low" });
  if (TRIGGER_KW.test(d)) s += 0.25; else findings.push({ axis: "trigger", target: { anchor, field: "description" }, action: "add-trigger-context", why: "구체 트리거 상황(언제 쓰는지) 문구 없음", risk: "low" });
  if (NEARMISS_KW.test(d)) s += 0.15; else findings.push({ axis: "trigger", target: { anchor, field: "description" }, action: "add-trigger-context", why: "near-miss(유사하나 트리거 금지) 구분 없음", risk: "low" });
  return clamp01(s);
}

// ② 구조 — 2계층. skill: 본문 ≤500·references 분리·대용량 인라인 블록. agent: 본문·섹션.
const FENCE = /^```/;
export type BehaviorCtx = {
  declared: readonly string[];          // frontmatter `behaviors:` 에 선언된 이름
  bodies: ReadonlyMap<string, string>;  // **사전 읽기**한 BEHAVIOR 본문(존재하는 것만)
};
// ADR-001 D7 — 검사마다 입력이 다르다.
//   원칙: *내용을 옮겨 빠져나갈 수 있는 검사는 합성, 정의 파일 자체의 형태를 보는 검사는 원본.*
//   필수 섹션·본문 부실·references 분리 = **정의 body**(합성 전)
//   줄 수 상한·대용량 코드펜스     = **합성 body**(정의 + 참조 BEHAVIOR)
// `mergedBody` 를 안 주면 body 와 같다(BEHAVIOR 미선언 정의).
function scoreStructure(body: string, hasRefs: boolean, kind: "agent" | "skill", findings: Finding[], anchor: string, missingReq: number, mergedBody?: string, bctx?: BehaviorCtx): { score: number; gateFail: boolean } {
  const n = bodyLineCount(body);
  const merged = mergedBody ?? body;
  const nMerged = bodyLineCount(merged);
  let s = 1.0, gateFail = false;

  // 닫히지 않은 코드펜스 → **그 정의를 즉시 과락(D) 판정**한다(ADR D7·R26 agy HIGH).
  // 정의 body 와 참조 BEHAVIOR body 를 **둘 다** 본다(R27) — 정의에만 걸면 BEHAVIOR 안의
  // 깨진 펜스가 무검사로 합성돼 런타임 프롬프트를 망가뜨린다.
  // ⚠ **프로세스를 종료하지 않는다**(R23) — TS 파서가 throw/exit 하면 평가 루프·UI 가 죽는다.
  const brokenIn = scanPointers(body).unclosedFence
    ? "정의"
    : [...(bctx?.bodies.entries() ?? [])].find(([, b]) => scanPointers(b).unclosedFence)?.[0];
  if (brokenIn) {
    findings.push({ axis: "structure", target: { anchor }, action: "add-required-section", why: `닫히지 않은 코드펜스(${brokenIn}) — 판독 불가·구조 과락`, risk: "med" });
    return { score: 0, gateFail: true };
  }

  if (bctx && bctx.declared.length > 0) {
    // **`behaviors:` 선언 정의의 "본문 부실" 판정은 줄 수가 아니라 구조로 한다**(ADR D7·R8 codex).
    // D1 대로 판단 기준을 BEHAVIOR 로 보내면 정의 body 가 얇아진다 — `n < 5` 를 그대로 적용하면
    // **규약을 지킬수록 과락**해 D7 채점 중립성과 정면 충돌한다.
    const missDim: string[] = [];
    const dead = bctx.declared.filter((d) => !bctx.bodies.has(d));
    for (const [name, b] of bctx.bodies) {
      const secs = splitSections(b);
      for (const dim of ["Intent", "Failure modes"]) {
        const hit = secs.find((x) => x.heading.includes(dim));
        if (!hit || hit.substantive === 0) missDim.push(`${name}/${dim}`);
      }
    }
    // ⓐ 필수 heading 전부(= missingReq 0) ⓑ 끊긴 참조 0 ⓒ 참조 BEHAVIOR 가 비어 있지 않음
    // ⓓ FOR-EACH 섹션 채워짐 — **`completenessMissing` 이 이미 판정했다**(R31: 여기서 다시
    //    감점하면 같은 사실에 두 번 감점된다). missingReq 가 그 결과다.
    // ⓔ 정의에 실체가 남아 있다 — 필수 섹션 중 최소 하나에 포인터 아닌 실제 본문.
    const anySubstantive = splitSections(body).some((x) => x.substantive > 0);
    const why: string[] = [];
    if (missingReq > 0) why.push(`필수 섹션 ${missingReq}건 미충족`);
    if (dead.length) why.push(`끊긴 참조 ${dead.join(",")}`);
    if (missDim.length) why.push(`참조 BEHAVIOR 부실 ${missDim.join(",")}`);
    if (!anySubstantive) why.push("정의에 포인터 아닌 실제 본문이 없다(껍데기)");
    if (why.length) {
      findings.push({ axis: "structure", target: { anchor }, action: "add-required-section", why: `본문 부실(구조 판정·behaviors: 선언) — ${why.join(" / ")}`, risk: "med" });
      return { score: 0.3, gateFail: true };
    }
  } else if (n < 5) {
    // 본문 부실(shell) 은 kind 무관 구조 과락 — codex MED: 빈 본문이 1.0/고등급 되던 rubric drift 차단.
    findings.push({ axis: "structure", target: { anchor }, action: "add-required-section", why: `본문 부실(${n}줄)·절차/역할 실체 없음`, risk: "med" });
    return { score: n === 0 ? 0 : 0.3, gateFail: true };
  }
  // 필수 섹션 누락은 구조 감점 + 다수 누락 시 과락(완전성=별도 축 아닌 구조 가드·design §1).
  if (missingReq > 0) s -= Math.min(0.45, missingReq * 0.18);
  if (missingReq >= 2) gateFail = true;
  // 합성 줄 수 내역 — finding 의 `range` 를 **생략**하는 대신 `why` 에 출처를 적는다(ADR D7 추가 계약 ①:
  // 합성 줄 수는 **정의 파일에 존재하지 않는 줄**을 가리키므로 range 를 달면 잘못된 수정 범위가 된다).
  const bd = nMerged !== n ? ` (정의 ${n}줄 + 참조 BEHAVIOR ${nMerged - n}줄 = 합계 ${nMerged}줄)` : "";
  if (kind === "skill") {
    // 줄 수 상한·대용량 코드펜스는 **합성 body** — 내용을 BEHAVIOR 로 옮겨 감점을 우회하는 것을 막는다(R5).
    if (nMerged > 500) { s -= Math.min(0.5, (nMerged - 500) / 1000); findings.push({ axis: "structure", target: { anchor }, action: "shrink-skill", why: `SKILL 본문 ${nMerged}줄(>500 목표)${bd} — 조건부 자료 references/로`, risk: "low" }); }
    // ⚠ references 분리 판단은 **정의 body 의 줄 수**로 한다(합성 아님·R8 양 엔진):
    // 짧고 정상적인 정의가 큰 BEHAVIOR 를 참조하면 **분리할 내용이 없는데도** 지시가 붙고,
    // 시키는 대로 해도 BEHAVIOR 소유 내용은 못 옮겨 **빈 references/ 로 감점만 우회**하게 된다.
    // `hasRefs` 와 줄 수가 **같은 구조 사실을 측정해야** 한다.
    if (!hasRefs && n > 300) { s -= 0.2; findings.push({ axis: "structure", target: { anchor }, action: "move-to-references", why: "본문 큰데 references/ 분리 없음(2계층 위반)", risk: "med" }); }
    if (nMerged > 800 && !hasRefs) gateFail = true; // min-gate: 구조 과락
    // 대용량 인라인 코드펜스(>60줄) 탐지 — 합성 body 기준·range 생략(합성 좌표라 정의 파일에 없다)
    const ls = lines(merged); let fenceStart = -1;
    for (let i = 0; i < ls.length; i++) {
      if (FENCE.test(ls[i]!)) { if (fenceStart < 0) fenceStart = i; else { if (i - fenceStart > 60) { s -= 0.1; findings.push({ axis: "structure", target: { anchor }, action: "move-to-references", why: `대용량 인라인 블록(${i - fenceStart}줄)${bd}·references/로`, risk: "low" }); } fenceStart = -1; } }
    }
  } else {
    if (nMerged > 400) s -= Math.min(0.3, (nMerged - 400) / 1000);
  }
  return { score: clamp01(s), gateFail };
}

// ③ 유도 — 명령형·why·leading. 언어 편향 큼 → **낮은 가중치·finding 위주**(design §1). 점수 관대.
const IMPERATIVE = /(한다|하라|하자|해야|확인|생성|검증|반영|작성|사용한다|따른다|imperative|must|should|do\b)/;
const WHY_KW = /(왜|이유|때문|because|why|so\s+that)/i;
function scoreInduction(body: string): number {
  const ls = lines(body).filter((l) => l.trim());
  if (ls.length === 0) return 0.5;
  const imp = ls.filter((l) => IMPERATIVE.test(l)).length / ls.length;
  const why = WHY_KW.test(body) ? 0.3 : 0;
  return clamp01(0.4 + imp * 0.3 + why); // 관대(정적 신호 약함)
}

// ④ 가지치기 — 계층A는 **중복 문장만**(삭제 테스트=계층B/E3·여기 없음). 1 − 중복비율.
function scorePruning(body: string, findings: Finding[], anchor: string): number {
  const sents = body.split(/[.\n。]/).map((x) => x.trim().toLowerCase().replace(/\s+/g, " ")).filter((x) => x.length > 15);
  if (sents.length === 0) return 1;
  const seen = new Set<string>(); let dup = 0;
  for (const s of sents) { if (seen.has(s)) dup++; else seen.add(s); }
  const ratio = dup / sents.length;
  if (dup > 0) findings.push({ axis: "pruning", target: { anchor }, action: "dedupe", why: `중복/유사 문장 ${dup}개`, risk: "low" });
  return clamp01(1 - ratio);
}

// 완전성 가드(design §1·§9): 필수 섹션 존재. 누락 수 반환(구조 감점·가드).
//   agent 5종 = 역할·원칙·프로토콜·에러·협업 / skill 2종 = 절차·트리거.
//   ⚠ 코드가 오래 **3종**(역할·프로토콜·에러)만 검사해 `SKILL.md:113` 의 5종 관례와 어긋나 있었다
//   (ADR-001 R12). 그래서 `작업 원칙`·`협업` 이 통째로 빠진 정의도 가드를 통과했다 —
//   ADR D7 이 "정의 소유라 본문 필수"라 한 `협업` 이 채점에서 아예 없던 셈이다.
//   **문서 쪽(5종)으로 통일한다** — 실측: 이 레포의 에이전트 6개 중 5개는 이미 5종을 갖췄고
//   `stabilizer.md` 하나만 `협업` 이 없었다(팀 모드는 `팀 통신 프로토콜` 을 **추가**하는 것이지
//   `협업` 을 대체하지 않는다·SKILL.md:113). 규칙을 약화하는 대신 그 정의를 고쳤다.
//   heading(## …) 라인 기준(codex LOW: 본문 언급 오탐 방지). 누락은 finding + scoreStructure 로 감점/과락.
function completenessMissing(body: string, kind: "agent" | "skill", findings: Finding[], anchor: string, declared: readonly string[] = []): number {
  // **이 검사가 FOR-EACH 섹션 내용물 판정의 단독 소유자다**(ADR D7·R31 agy HIGH — 예전엔
  // "본문 부실" 조건에도 같은 검사를 적어 중복 감점이 났다). 모든 정의에 일률 적용된다.
  // 사유를 둘로 구분한다: heading 자체가 없음 / heading 은 있으나 본문·포인터 둘 다 없음
  // (후자를 "섹션이 통째로 없다"고 보고하면 거짓 실패로 읽힌다·R31).
  const secs = splitSections(body);
  const req = kind === "agent" ? REQUIRED_SECTIONS.agent : REQUIRED_SECTIONS.skill;
  let missing = 0;
  for (const sec of req) {
    const hit = secs.find((s) => s.heading.includes(sec));
    if (!hit) {
      missing++;
      findings.push({ axis: "completeness", target: { anchor }, action: "add-required-section", why: `필수 섹션 heading '${sec}' 미검출`, risk: "low" });
      continue;
    }
    // 채워짐 = ① 실제 본문 또는 ② **유효한** 섹션 포인터(그 이름이 이 파일의 `behaviors:` 에 있어야 한다).
    const valid = hit.pointers.filter((p) => declared.includes(p));
    if (hit.substantive === 0 && valid.length === 0) {
      missing++;
      const why = hit.pointers.length > 0
        ? `필수 섹션 '${sec}' 이 비어 있다 — 섹션 포인터 '${hit.pointers[0]}' 가 frontmatter behaviors: 에 없다`
        : `필수 섹션 '${sec}' 에 heading 만 있고 본문·포인터가 없다`;
      findings.push({ axis: "completeness", target: { anchor }, action: "add-required-section", why, risk: "low" });
    }
  }
  return missing;
}

// present(number) 축만 평균 — 관계 감점 반영 후 재계산·TOML 부분축 안전.
function avgOf(scores: Partial<Record<Axis, number>>): number {
  const vs = Object.values(scores).filter((v): v is number => typeof v === "number");
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
}
/**
 * 등급 산정. **테스트가 실제 구현을 타야 하므로 export 한다**(R1 양 엔진 HIGH/MED):
 * 테스트가 같은 삼항식을 복제해 검증하면 구현이 `>=` → `>` 로 바뀌어도 통과해 안전망이 사라진다.
 */
export function gradeOf(avg: number, gateFail: boolean): Grade {
  if (gateFail) return "D"; // min-gate: 구조 과락은 정성 점수로 세탁 불가
  const T = GRADE_THRESHOLDS;
  return avg >= T.A ? "A" : avg >= T.B ? "B" : avg >= T.C ? "C" : "D";
}

// 동시성 제한 map(agy HIGH: 무제한 Promise.all 은 대형 하네스서 EMFILE·1개 reject 로 전체 붕괴). 순서 보존(결정적).
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let idx = 0;
  const worker = async (): Promise<void> => { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i]!, i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// references/ 에 .md 참조가 하나라도 있나(opendir 순회·첫 매치 early-return·최대 상한·codex MED: readdir 전량 materialize 방지).
async function hasReferences(root: string, skillDir: string): Promise<boolean> {
  // readRaw 와 동일 엄격 패턴(codex R4 LOW 통일): 빈/선두 슬래시/빈 세그먼트/불안전 세그먼트 거부(filter 정규화 아님).
  if (!skillDir || skillDir.startsWith("/")) return false;
  const segs = skillDir.split("/");
  if (segs.length === 0 || segs.some((s) => !isSafeSegment(s))) return false;
  let dir;
  try { dir = await opendir(join(root, ...segs, "references")); } catch { return false; }
  try {
    let seen = 0;
    for await (const e of dir) { if (++seen > 2000) break; if (e.isFile() && e.name.endsWith(".md")) return true; } // early-return·상한
    return false;
  } catch { return false; } finally { await dir.close().catch(() => {}); }
}
// 안전 read: per-seg isSafeSegment(traversal) + filter(Boolean)(빈 세그먼트·agy MED) + readCappedDef(O_NOFOLLOW·캡·심링크). 예외 흡수(agy HIGH).
// 참조된 BEHAVIOR 본문을 **사전 읽기**한다(ADR D7 조건 ⓒ — `scoreStructure` 가 TS 에서 직접
// 판정하려면 입력으로 받아야 한다. "B1 셸 검사 결과를 채점기가 소비"는 아키텍처상 불가능하다:
// 채점은 UI 요청마다 도는 동기 TS 루프이고 `check-behaviors.sh` 는 CLI 배치다·R27 agy HIGH).
// 이름은 디렉토리명 규칙을 통과한 것만 오므로 경로 탈출은 성립하지 않지만, `isSafeSegment` 로 한 번 더 막는다.
async function readBehaviorBodies(root: string, names: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(names)];
  await mapLimit(uniq, 8, async (nm) => {
    if (!isSafeSegment(nm)) return null;
    try {
      const raw = await readCappedDef(join(root, ".agents", "behaviors", nm, "BEHAVIOR.md"));
      if (raw != null) out.set(nm, splitBody(raw).body);
    } catch { /* 없으면 끊긴 참조 — 조건 ⓑ 가 잡는다 */ }
    return null;
  });
  return out;
}

async function readRaw(root: string, sourcePath: string): Promise<string | null> {
  try {
    // malformed(빈 경로·선두 '/' = 빈 runtimePath) 거부 — codex LOW: root/SKILL.md 오인 방지. 정본은 dir 로 시작.
    if (!sourcePath || sourcePath.startsWith("/")) return null;
    const segs = sourcePath.split("/");
    if (segs.length < 2 || segs.some((s) => !isSafeSegment(s))) return null; // 빈/불안전 세그먼트 거부(filter 아닌 엄격)
    return await readCappedDef(join(root, ...segs));
  } catch { return null; }
}

// TOML top-level 문자열 필드(name/description) — 정규식 대신 @iarna 파서(codex MED: 이스케이프/멀티라인/주석 오판).
function tomlField(text: string, key: string): string | null {
  try { const d = TOML.parse(text) as Record<string, unknown>; const v = d[key]; return typeof v === "string" ? v : null; }
  catch { return null; }
}

// 관계 신호 → 축 감점 + finding. **축별 최강 감점 1회**(compound 과감점 방지·both HIGH/MED) +
//   대상 축 부재(TOML: pruning/induction 없음) 시 structure 폴백(감점 누락 방지·agy HIGH). findings 는 전건(정보).
export function applyRel(scores: Partial<Record<Axis, number>>, findings: Finding[], hits: RelHit[], anchor: string): void {
  const byAxis = new Map<Axis, number>();
  for (const h of hits) {
    const ax: Axis = typeof scores[h.axis] === "number" ? h.axis : "structure"; // 부재 축 → structure(항상 존재)
    byAxis.set(ax, Math.min(byAxis.get(ax) ?? 1, h.mult));                       // 최강(min) 감점만·compound 금지
    findings.push({ axis: h.axis, target: { anchor }, action: h.action, why: h.why, risk: h.risk });
  }
  for (const [ax, mult] of byAxis) { const cur = scores[ax]; if (typeof cur === "number") scores[ax] = clamp01(cur * mult); }
}

export async function evaluateArtifacts(root: string, opts?: { now?: string }): Promise<ArtifactEval> {
  // 이 함수는 계층A(정적·결정적)만 산출한다. 계층B가 붙으면 여기서 mode 가 갈린다.
  const MODE: EvaluationMode = "static";
  const now = opts?.now ?? "2026-01-01"; // findings 는 now 무관(결정성)·generated_at 만 영향
  const [agents, skills, hsc] = await Promise.all([
    readAgents(root), readSkills(root),
    computeHarnessScorecard(root, { now }).catch(() => null), // 관계 진단 흡수(실패 시 4축만·fail-open)
  ]);
  // 관계 findings 색인: (kind|name) → RelHit[]. non-waived 만. pointer/runtime 은 health 집계로.
  const relBy = new Map<string, RelHit[]>();
  const health = { orphan: 0, deadLink: 0, coverageGap: 0, drift: 0 };
  for (const f of hsc?.findings ?? []) {
    if (f.waived) continue;
    if (f.type === "orphan") health.orphan++;
    else if (f.type === "dead_link") health.deadLink++;
    else if (f.type === "coverage_gap") health.coverageGap++;
    else if (f.type === "unknown_scope") health.drift++;
    if (f.subject_kind !== "agent" && f.subject_kind !== "skill") continue; // pointer/runtime → health 만
    const hit = relOfFinding(f); if (!hit) continue;
    const key = f.subject_kind + "|" + f.subject;
    (relBy.get(key) ?? relBy.set(key, []).get(key)!).push(hit);
  }
  // 동시성 제한 read(agy HIGH: 무제한 병렬 EMFILE 방지·순서 보존). limit 8.
  const agentRaw = await mapLimit(agents, 8, (a) => readRaw(root, a.sourcePath));
  const skillPaths = skills.map((s) => (s.runtimePaths[0] ?? "") + "/SKILL.md");
  const skillRaw = await mapLimit(skills, 8, (_, i) => readRaw(root, skillPaths[i]!));
  const skillRefs = await mapLimit(skills, 8, (s) => hasReferences(root, s.runtimePaths[0] ?? ""));
  // 참조된 BEHAVIOR 를 **한 번만** 읽는다 — 공유 BEHAVIOR 는 여러 정의가 가리킨다.
  // (줄 수는 참조하는 정의마다 반복 계산되며 **이는 의도된 동작**이다·R11 — 각 정의의
  //  실제 프롬프트 분량이 그만큼이기 때문이다. 읽기만 공유한다.)
  const allRefs = [
    ...agentRaw.flatMap((r) => (r == null ? [] : parseBehaviorRefs(splitBody(r).fm))),
    ...skillRaw.flatMap((r) => (r == null ? [] : parseBehaviorRefs(splitBody(r).fm))),
  ];
  const behaviorBodies = await readBehaviorBodies(root, allRefs);

  const artifacts: ArtifactScore[] = [];

  // ── 에이전트 ──
  agents.forEach((a, i) => {
    const raw = agentRaw[i]; if (raw == null) return;
    const anchor = sha(raw);
    const findings: Finding[] = [];
    const scores: Partial<Record<Axis, number>> = {};
    if (a.sourcePath.endsWith(".toml")) {
      // toml-agent: 문장 삭제/유도 미적용(구조화 파일) → 트리거(description)·구조(필드 완전성)만. @iarna 파싱.
      const name = tomlField(raw, "name"), desc = tomlField(raw, "description");
      scores.trigger = scoreTrigger(desc ?? "", findings, anchor);
      scores.structure = name && desc ? 1 : 0.5;
      if (!name || !desc) findings.push({ axis: "structure", target: { anchor }, action: "add-required-section", why: "필수 필드(name/description) 미검출·또는 TOML 파싱 실패", risk: "med" });
      applyRel(scores, findings, relBy.get("agent|" + a.name) ?? [], anchor);
      artifacts.push({ kind: "agent", name: a.name, path: a.sourcePath, runtime: a.runtime, rubric: "toml-agent", scores, grade: gradeOf(avgOf(scores), false), evaluation_mode: MODE, confidence: confidenceOf("toml-agent", MODE), findings });
      return;
    }
    const { fm, body } = splitBody(raw);
    const declared = parseBehaviorRefs(fm);
    const bodies = behaviorBodies;
    const bctx: BehaviorCtx | undefined = declared.length
      ? { declared, bodies: new Map(declared.filter((d) => bodies.has(d)).map((d) => [d, bodies.get(d)!])) }
      : undefined;
    // 합성 body — `induction`·`pruning`·줄 수 계열의 입력. 내용을 BEHAVIOR 로 옮겼다고
    // 명령형 비율이 떨어지거나 중복 검출이 사라지면 **규약을 지킬수록 손해**가 된다(ADR D7).
    const merged = bctx ? [body, ...bctx.bodies.values()].join("\n") : body;
    const missing = completenessMissing(body, "agent", findings, anchor, declared);
    scores.trigger = scoreTrigger(a.role, findings, anchor); // role=description 미러
    const st = scoreStructure(body, false, "agent", findings, anchor, missing, merged, bctx);
    scores.structure = st.score;
    scores.induction = scoreInduction(merged);
    scores.pruning = scorePruning(merged, findings, anchor);
    applyRel(scores, findings, relBy.get("agent|" + a.name) ?? [], anchor); // 관계 신호(dead-link 등) 감점
    artifacts.push({ kind: "agent", name: a.name, path: a.sourcePath, runtime: a.runtime, rubric: "md-agent", scores, grade: gradeOf(avgOf(scores), st.gateFail), evaluation_mode: MODE, confidence: confidenceOf("md-agent", MODE), findings });
  });

  // ── 스킬 ──
  skills.forEach((s, i) => {
    const raw = skillRaw[i]; if (raw == null) return;
    const anchor = sha(raw);
    const findings: Finding[] = [];
    const { fm, body } = splitBody(raw);
    const declared = parseBehaviorRefs(fm);
    const bctx: BehaviorCtx | undefined = declared.length
      ? { declared, bodies: new Map(declared.filter((d) => behaviorBodies.has(d)).map((d) => [d, behaviorBodies.get(d)!])) }
      : undefined;
    const merged = bctx ? [body, ...bctx.bodies.values()].join("\n") : body;
    const missing = completenessMissing(body, "skill", findings, anchor, declared);
    const scores: Partial<Record<Axis, number>> = {};
    scores.trigger = scoreTrigger(s.description, findings, anchor);
    const st = scoreStructure(body, skillRefs[i]!, "skill", findings, anchor, missing, merged, bctx);
    scores.structure = st.score;
    scores.induction = scoreInduction(merged);
    scores.pruning = scorePruning(merged, findings, anchor);
    applyRel(scores, findings, relBy.get("skill|" + s.name) ?? [], anchor); // orphan/coverage 감점(가지치기)
    artifacts.push({ kind: "skill", name: s.name, path: skillPaths[i]!, runtime: s.runtimePaths.join(","), rubric: "md-skill", scores, grade: gradeOf(avgOf(scores), st.gateFail), evaluation_mode: MODE, confidence: confidenceOf("md-skill", MODE), findings });
  });

  // 결정성(codex/agy MED): path 로 안정 정렬(스캔 순서 무관·동일 출력 보장).
  artifacts.sort((x, y) => x.path.localeCompare(y.path));

  // ── 롤업 ──
  const axisSum: Record<string, { sum: number; n: number }> = {};
  const gradeDist: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0 };
  const worst: Array<{ name: string; axis: Axis; score: number }> = [];
  for (const a of artifacts) {
    gradeDist[a.grade]++;
    for (const [ax, v] of Object.entries(a.scores)) {
      if (typeof v !== "number") continue;
      (axisSum[ax] ??= { sum: 0, n: 0 }).sum += v; axisSum[ax]!.n++;
      if (v < 0.6) worst.push({ name: a.name, axis: ax as Axis, score: v });
    }
  }
  const axisAvg: Partial<Record<Axis, number>> = {};
  for (const [ax, { sum, n }] of Object.entries(axisSum)) axisAvg[ax as Axis] = n ? Math.round((sum / n) * 100) / 100 : 0;
  // 동점 tie-break(name→axis) 로 slice cutoff 결정적(codex/agy MED).
  worst.sort((x, y) => x.score - y.score || x.name.localeCompare(y.name) || x.axis.localeCompare(y.axis));
  return { artifacts, rollup: { axisAvg, gradeDist, worst: worst.slice(0, 10), count: artifacts.length, health } };
}
