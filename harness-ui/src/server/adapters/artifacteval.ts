// E1(Eval v1·design §1·§2): 하네스 아티팩트 4축 단일 평가 — **계층A(정적·결정적)만**.
//   트리거·구조·유도·가지치기를 파일 파싱만으로 채점(LLM·삭제 테스트=계층B/E3·여기 없음).
//   findings 는 전부 **구조적·저위험**(delete-candidate 같은 고위험 LLM 판정 없음). evaluation_mode="static".
//   설계 안전 반영: kind별 rubric 분기(TOML 은 문장 삭제/유도 미적용)·min-gate(구조 과락→상한)·완전성 가드·content-hash anchor.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readAgents, readSkills } from "./harness.js";

export type Axis = "trigger" | "structure" | "induction" | "pruning";
export type ArtifactRubric = "md-agent" | "md-skill" | "toml-agent";
export type Grade = "A" | "B" | "C" | "D";

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
  evaluation_mode: "static";
  confidence: number; // static 은 낮음(계층B 전)
  findings: Finding[];
}
export interface ArtifactEval {
  artifacts: ArtifactScore[];
  rollup: {
    axisAvg: Partial<Record<Axis, number>>;
    gradeDist: Record<Grade, number>;
    worst: Array<{ name: string; axis: Axis; score: number }>;
    count: number;
  };
}

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// frontmatter/본문 분리(harness.parseFrontmatter 는 필드만·본문 필요) — 첫 --- 쌍.
function splitBody(text: string): { fm: string; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { fm: "", body: text.replace(/^﻿/, "") };
  return { fm: m[1]!, body: text.slice(m[0].length) };
}
function lines(s: string): string[] { return s.split(/\r?\n/); }
function bodyLineCount(body: string): number { return lines(body).filter((l) => l.trim().length > 0).length; }

// ── 축별 계층A 채점(결정적) ─────────────────────────────────────────────
// ① 트리거 — description ROI(존재·길이 밴드·트리거 상황 키워드·near-miss 구분). 언어 편향 있어 finding 위주.
const TRIGGER_KW = /(때|시\b|요청|사용|할\s*때|use\s+when|when\b|trigger)/i;
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
function scoreStructure(body: string, hasRefs: boolean, kind: "agent" | "skill", findings: Finding[], anchor: string): { score: number; gateFail: boolean } {
  const n = bodyLineCount(body);
  let s = 1.0, gateFail = false;
  if (kind === "skill") {
    if (n > 500) { s -= Math.min(0.5, (n - 500) / 1000); findings.push({ axis: "structure", target: { anchor, range: `1-${n}` }, action: "shrink-skill", why: `SKILL 본문 ${n}줄(>500 목표) — 조건부 자료 references/로`, risk: "low" }); }
    if (!hasRefs && n > 300) { s -= 0.2; findings.push({ axis: "structure", target: { anchor }, action: "move-to-references", why: "본문 큰데 references/ 분리 없음(2계층 위반)", risk: "med" }); }
    if (n > 800 && !hasRefs) gateFail = true; // min-gate: 구조 과락
    // 대용량 인라인 코드펜스(>60줄) 탐지
    const ls = lines(body); let fenceStart = -1;
    for (let i = 0; i < ls.length; i++) {
      if (FENCE.test(ls[i]!)) { if (fenceStart < 0) fenceStart = i; else { if (i - fenceStart > 60) { s -= 0.1; findings.push({ axis: "structure", target: { anchor, range: `${fenceStart + 1}-${i + 1}` }, action: "move-to-references", why: `대용량 인라인 블록(${i - fenceStart}줄)·references/로`, risk: "low" }); } fenceStart = -1; } }
    }
  } else {
    if (n === 0) { s = 0; findings.push({ axis: "structure", target: { anchor }, action: "add-required-section", why: "에이전트 본문 없음", risk: "med" }); }
    else if (n > 400) { s -= Math.min(0.3, (n - 400) / 1000); }
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

// 완전성 가드(design §1·§9): 필수 섹션 존재(agent: 역할·프로토콜·에러 / skill: 절차·트리거). 없으면 finding(삭제 마스크용).
function completenessFindings(body: string, kind: "agent" | "skill", findings: Finding[], anchor: string): void {
  const req = kind === "agent" ? ["역할", "프로토콜", "에러"] : ["절차", "트리거"];
  for (const sec of req) if (!body.includes(sec)) findings.push({ axis: "completeness", target: { anchor }, action: "add-required-section", why: `필수 섹션 '${sec}' 미검출(정적 추정)`, risk: "low" });
}

function gradeOf(avg: number, gateFail: boolean): Grade {
  if (gateFail) return "D"; // min-gate: 구조 과락은 정성 점수로 세탁 불가
  return avg >= 0.9 ? "A" : avg >= 0.75 ? "B" : avg >= 0.6 ? "C" : "D";
}

async function hasReferences(root: string, skillDir: string): Promise<boolean> {
  try { const e = await readdir(join(root, skillDir, "references")); return e.length > 0; } catch { return false; }
}
async function readRaw(root: string, sourcePath: string): Promise<string | null> {
  try { return await readFile(join(root, ...sourcePath.split("/")), "utf8"); } catch { return null; }
}

export async function evaluateArtifacts(root: string): Promise<ArtifactEval> {
  const artifacts: ArtifactScore[] = [];
  const [agents, skills] = await Promise.all([readAgents(root), readSkills(root)]);

  // ── 에이전트 ──
  for (const a of agents) {
    const raw = await readRaw(root, a.sourcePath);
    if (raw === null) continue;
    const anchor = sha(raw);
    const isToml = a.sourcePath.endsWith(".toml");
    const findings: Finding[] = [];
    const scores: Partial<Record<Axis, number>> = {};
    if (isToml) {
      // toml-agent: 문장 삭제/유도 미적용(구조화 파일) → 트리거(description)·구조(필드 완전성)만.
      const nm = raw.match(/^[ \t]*name[ \t]*=/m), dm = raw.match(/^[ \t]*description[ \t]*=[ \t]*["'](.+?)["']/m);
      scores.trigger = scoreTrigger(dm?.[1] ?? "", findings, anchor);
      scores.structure = nm && dm ? 1 : 0.5;
      if (!nm || !dm) findings.push({ axis: "structure", target: { anchor }, action: "add-required-section", why: "필수 필드(name/description) 미검출", risk: "med" });
      const avg = (scores.trigger! + scores.structure!) / 2;
      artifacts.push({ kind: "agent", name: a.name, path: a.sourcePath, runtime: a.runtime, rubric: "toml-agent", scores, grade: gradeOf(avg, false), evaluation_mode: "static", confidence: 0.45, findings });
      continue;
    }
    const { body } = splitBody(raw);
    scores.trigger = scoreTrigger(a.role, findings, anchor); // role=description 미러
    const st = scoreStructure(body, false, "agent", findings, anchor);
    scores.structure = st.score;
    scores.induction = scoreInduction(body);
    scores.pruning = scorePruning(body, findings, anchor);
    completenessFindings(body, "agent", findings, anchor);
    const avg = (scores.trigger + scores.structure + scores.induction + scores.pruning) / 4;
    artifacts.push({ kind: "agent", name: a.name, path: a.sourcePath, runtime: a.runtime, rubric: "md-agent", scores, grade: gradeOf(avg, st.gateFail), evaluation_mode: "static", confidence: 0.5, findings });
  }

  // ── 스킬 ──
  for (const s of skills) {
    const sourcePath = (s.runtimePaths[0] ?? "") + "/SKILL.md"; // 대표 런타임 경로
    const raw = await readRaw(root, sourcePath);
    if (raw === null) continue;
    const anchor = sha(raw);
    const findings: Finding[] = [];
    const skillDir = s.runtimePaths[0] ?? "";
    const refs = await hasReferences(root, skillDir);
    const { body } = splitBody(raw);
    const scores: Partial<Record<Axis, number>> = {};
    scores.trigger = scoreTrigger(s.description, findings, anchor);
    const st = scoreStructure(body, refs, "skill", findings, anchor);
    scores.structure = st.score;
    scores.induction = scoreInduction(body);
    scores.pruning = scorePruning(body, findings, anchor);
    completenessFindings(body, "skill", findings, anchor);
    const avg = (scores.trigger + scores.structure + scores.induction + scores.pruning) / 4;
    artifacts.push({ kind: "skill", name: s.name, path: sourcePath, runtime: s.runtimePaths.join(","), rubric: "md-skill", scores, grade: gradeOf(avg, st.gateFail), evaluation_mode: "static", confidence: 0.5, findings });
  }

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
  worst.sort((x, y) => x.score - y.score);
  return { artifacts, rollup: { axisAvg, gradeDist, worst: worst.slice(0, 10), count: artifacts.length } };
}
