// 하네스 인벤토리 (설계 §API /api/harness, /api/agents, /api/skills).
// 정적 파일 파싱: .claude/agents/*.md, .claude/skills/*/SKILL.md, .codex/agents/*.toml, .agents/skills/.
import { constants } from "node:fs";
import { readdir, stat, open } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ARGV_TOKEN, isSafeSegment } from "../lib/paths.js";
import { agentSources, skillDirs, editableMdAgentDirs, editableTomlAgentDirs, editableSkillDirs, type RuntimeId } from "./runtimes.js";
import TOML from "@iarna/toml";

// F15(M-e·R1): TOML top-level `name`(문자열)만 추출. multiline 문자열 내부 오탐 차단(정규식 대체).
//   파싱 실패/비문자열 = null → caller 가 파일명 폴백(resolve 용도·PUT 은 별도 strict 검증).
function tomlTopLevelName(text: string): string | null {
  try {
    const d = TOML.parse(text) as Record<string, unknown>;
    return typeof d.name === "string" ? d.name : null;
  } catch { return null; }
}

// 정의 스캔 바운드(agy#2 OOM/DoS 방어): 파일당 read 상한 + 디렉토리당 개수 상한.
const MAX_DEF_BYTES = 262144;   // 정의 파일당 read 상한(256KB) — 거대 파일 OOM 차단
const MAX_AGENT_FILES = 500;    // 디렉토리당 스캔 개수 상한 — 전건 read 폭발 차단

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}
async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name).slice(0, MAX_AGENT_FILES);
  } catch { return []; }
}
// O_NOFOLLOW open → fstat 정규파일·크기 검사 → 상한 내 바운드 read. 비정규/초과/오픈실패 = null(스킵).
// 전체 readFile 대신 크기캡 read 로 거대 정의 파일 OOM 을 차단(statestats.readCapped 동형).
export async function readCappedDef(p: string): Promise<string | null> {
  let fh;
  try { fh = await open(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { return null; }
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.size > MAX_DEF_BYTES) return null; // 초과 파일 skip — read 미수행(OOM 방어)
    const buf = Buffer.alloc(st.size);
    await fh.read(buf, 0, st.size, 0);
    return buf.toString("utf8");
  } catch { return null; }
  finally { await fh.close().catch(() => {}); }
}
// agy#1(R1 HIGH·스캔 상한 DoS): 반환 dir 수에 MAX_AGENT_FILES 개수 상한(slice) 적용 —
//   listFiles 와 동일 바운드. `.claude/skills` 하위 수십만 dir(scanSkillDir·readSkills·inventory)에서
//   무제한 스캔(CPU/IO/OOM)을 차단. 상한 초과분은 미스캔(fail-safe: 편집 대상 미발견=404, 은폐 아님).
async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).slice(0, MAX_AGENT_FILES);
  } catch { return []; }
}

// 프론트matter(간이): --- ... --- 블록에서 key: value 추출. BOM 제거·멀티라인 값 누적·따옴표 안전 제거.
function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}
// name canonical: 경로/확장자 제거·trim(파일명 basename 기준·설계 §3-1).
function canonName(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "").split(/[\\/]/).pop()!.replace(/\.(md|toml)$/i, "").trim();
}

export type ListSyntax = "missing" | "empty" | "array" | "invalid_scalar";
// 배열 계약 파서(설계 §2-2). present = 키 존재(부재 vs 빈배열 = link_unknown vs orphan 갈림).
// YAML frontmatter(--- 블록)면 그 안에서, 아니면 TOML(전문)에서 탐색. 인라인/다중행 [..]·YAML 블록리스트·scalar 판별.
export function parseFrontmatterList(textIn: string, key: string): { present: boolean; items: string[]; syntax: ListSyntax } {
  const text = textIn.replace(/^﻿/, "");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const region = fm ? fm[1]! : text;                 // YAML 블록 우선·없으면 TOML 전문
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 인라인/다중행 배열: key: [ ... ] 또는 key = [ ... ] (최초 ]까지 non-greedy). [ \t]* = 수평 공백만(개행 불식).
  const arr = region.match(new RegExp(`^[ \\t]*${esc}[ \\t]*[:=][ \\t]*\\[([\\s\\S]*?)\\]`, "m"));
  if (arr) {
    const items = [...new Set(splitList(arr[1]!).map((s) => canonName(s)).filter(Boolean))]; // dedup(중복 선언 → edge 1건·R2 agy)
    return { present: true, items, syntax: items.length ? "array" : "empty" };
  }
  // key 라인(배열 아님). [ \t]*(개행 제외) — \s* 는 개행을 삼켜 블록리스트를 scalar 로 오판.
  const kl = region.match(new RegExp(`^([ \\t]*)${esc}[ \\t]*[:=][ \\t]*(.*)$`, "m"));
  if (!kl) return { present: false, items: [], syntax: "missing" };
  const rest = kl[2]!.trim();
  if (rest === "") {
    // YAML 블록 리스트: 다음 라인들의 `- item` 수집(들여쓰기 무관·비대시 라인에서 종료)
    const after = region.slice(kl.index! + kl[0]!.length).split(/\r?\n/);
    const items: string[] = [];
    for (const line of after) {
      if (line.trim() === "") continue;
      const dm = line.match(/^\s*-\s*(.+)$/);
      if (dm) items.push(canonName(dm[1]!));
      else break;                                     // 리스트 종료
    }
    const uniq = [...new Set(items.filter(Boolean))]; // dedup(R2 agy)
    return uniq.length ? { present: true, items: uniq, syntax: "array" } : { present: true, items: [], syntax: "empty" };
  }
  return { present: true, items: [], syntax: "invalid_scalar" }; // scalar 금지(PRD §3-1)
}

export function parseFrontmatter(textIn: string): Record<string, string> {
  const text = textIn.replace(/^\uFEFF/, ""); // BOM 제거
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  let key: string | null = null;
  const buf: string[] = [];
  const flush = () => { if (key) out[key] = stripQuotes(buf.join(" ").trim()); key = null; buf.length = 0; };
  for (const line of m[1]!.split(/\r?\n/)) {
    // 새 키 = 비들여쓰기 `key:` (YAML). 연속행 = **들여쓴** 라인만(비들여쓰기 "Note:" 오분할 차단, agy#3).
    const isIndented = /^\s/.test(line);
    const kv = !isIndented ? line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/) : null;
    if (kv) { flush(); key = kv[1]!; buf.push(kv[2]!); }
    else if (key && isIndented && line.trim()) { buf.push(line.trim()); }
  }
  flush();
  return out;
}

// F2(M10): tools = U⊆D 상한 D의 소스(정의 frontmatter → argv-token 필터). targets/domainTemplate/permissionMode = run-template 프리필 초안.
export type AgentInfo = {
  name: string; runtime: RuntimeId; sourcePath: string; role: string; skills: string[];
  skillsDeclared: boolean; skillsSyntax: ListSyntax;   // M-A: 선언 여부(present)·문법(scalar 거부) — link_unknown/orphan 분류
  tools: string[]; targets: string[]; domainTemplate: string; permissionMode: string | null;
};
// M-A(R2 M3·R3 MED): orchestrates·references 를 runtimePath 별로 보존(dedup 병합이 런타임 증거를 섞지 않도록).
export type SkillEvidence = { items: string[]; declared: boolean; syntax: ListSyntax };
export type SkillInfo = {
  name: string; runtimePaths: string[]; description: string; references: string[]; triggers: string;
  orchestratesByRuntimePath: Record<string, SkillEvidence>;
  referencesByRuntimePath: Record<string, string[]>;
};

const MAX_TOOLS = 40;      // argv 배열 상한(RunRequest.allowedTools.max(40) 정합)
const MAX_TOOL_LEN = 60;   // 개별 tool 길이 상한(.max(60) 정합)
const TARGET_ENUM = ["agents", "skills", "orchestrator"]; // RunRequest.targets enum

// 나열 분해 공통 전처리(agy#1): 대괄호·따옴표 제거 후 콤마/공백 split.
// claude `.md`(YAML `Read, Grep`·리스트 잔재 "- Read")와 codex `.toml`(배열 `["Read","Bash"]`) 양쪽에서
// 순수 토큰만 남긴다 — 미제거 시 `["Read` 같은 오염 토큰이 argv 필터에 전부 드롭돼 D 가 항상 빈 배열이 됨.
function splitList(raw: string): string[] {
  return raw.replace(/[[\]"']/g, " ").split(/[,\s]+/);
}

// frontmatter/toml `tools` → 배열 분해·argv-token 필터·dedupe·clamp.
// argv 요소 안전(leading-dash 차단)·경로 조립 아님. YAML 대시("-")·괄호 스펙(Bash(git:*)) 등 비-token 은 필터로 드롭.
export function deriveTools(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of splitList(raw)) {
    const t = tok.trim();
    if (!t || t.length > MAX_TOOL_LEN || !ARGV_TOKEN.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TOOLS) break;
  }
  return out;
}

function deriveTargets(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const tok of splitList(raw)) {
    const t = tok.trim();
    if (TARGET_ENUM.includes(t) && !out.includes(t)) out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

// 정의 지문(stale 폼 탐지·통합감사 R4-#1). 프리필/D 에 영향 주는 정규화 필드만 해싱 →
// 무관한 편집(주석 등)엔 불변, sourcePath·tools·targets·domain·permissionMode 변경 시에만 변동. 삭제는 findAgent=undefined 로 별도 처리.
export function agentFingerprint(a: AgentInfo): string {
  const canon = JSON.stringify({
    n: a.name, r: a.runtime, p: a.sourcePath,
    t: [...a.tools].sort(), g: [...a.targets].sort(), d: a.domainTemplate, m: a.permissionMode,
  });
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

// 단일 파일 → AgentInfo 구성(전건 스캔·단건 fast-path 공유 — 동일 구성 보장으로 지문 일치).
// sourcePath 는 POSIX 리터럴 결합("/") — OS 구분자 무관 결정적 지문(agy#3). 파일 접근엔 미사용(표시·지문 전용).
// md-frontmatter 에이전트(Claude·Gemini 공통 포맷·F12 레지스트리). runtime·dir 주입(하드코딩 제거).
function buildMdAgent(runtime: RuntimeId, dir: string, f: string, text: string): AgentInfo {
  const fm = parseFrontmatter(text);
  const sk = parseFrontmatterList(text, "skills");   // M-A: skills:[] 하드코딩 제거 → 실파싱
  return {
    name: fm.name ?? f.replace(/\.md$/, ""), runtime, sourcePath: dir + "/" + f,
    role: fm.description ?? "", skills: sk.items, skillsDeclared: sk.present, skillsSyntax: sk.syntax,
    tools: deriveTools(fm.tools), targets: deriveTargets(fm.targets),
    domainTemplate: fm.domainTemplate ?? "", permissionMode: fm.permissionMode ?? null,
  };
}
// TOML 에이전트(Codex). runtime·dir 주입.
function buildTomlAgent(runtime: RuntimeId, dir: string, f: string, text: string): AgentInfo {
  const nm = text.match(/^\s*name\s*=\s*["'](.+?)["']/m);
  // codex .toml `tools = ["Read", ...]` / `targets = [...]` — 배열 문법은 splitList 가 정제(agy#1).
  const toolsM = text.match(/^\s*tools\s*=\s*(.+)$/m);
  const targetsM = text.match(/^\s*targets\s*=\s*(.+)$/m);
  const sk = parseFrontmatterList(text, "skills");   // TOML 다중행 배열 지원(R2 agy)
  return {
    name: nm?.[1] ?? f.replace(/\.toml$/, ""), runtime, sourcePath: dir + "/" + f,
    role: "", skills: sk.items, skillsDeclared: sk.present, skillsSyntax: sk.syntax,
    tools: deriveTools(toolsM?.[1]), targets: deriveTargets(targetsM?.[1]),
    domainTemplate: "", permissionMode: null,
  };
}
// dir(POSIX 상대) → OS 결합 세그먼트. 파일 접근용(cross-platform).
const segsOf = (dir: string): string[] => dir.split("/");

// run-template·POST U⊆D 재도출의 단일 진입점(동일 재도출 함수 — 템플릿/제출 D 일치 보장).
// fast-path(agy#2): 이름=파일명 규약이면 후보 1~2개만 크기캡 read — 전 디렉토리 read 폭발 회피.
// 불일치(fm.name≠파일명)·비안전 세그먼트 시 전건 스캔 폴백(정확성 유지).
export async function findAgent(root: string, name: string): Promise<AgentInfo | undefined> {
  if (isSafeSegment(name)) {
    // F12: 레지스트리 순회 fast-path(런타임별 dir·ext·format).
    for (const s of agentSources()) {
      const file = name + s.ext;
      const t = await readCappedDef(join(root, ...segsOf(s.dir), file));
      if (t === null) continue;
      const a = s.format === "toml" ? buildTomlAgent(s.id, s.dir, file, t) : buildMdAgent(s.id, s.dir, file, t);
      if (a.name === name) return a;
    }
  }
  return (await readAgents(root)).find((a) => a.name === name);
}

export async function readAgents(root: string): Promise<AgentInfo[]> {
  const out: AgentInfo[] = [];
  // F12: 레지스트리 순회(claude .md · codex .toml · gemini .md). 하드코딩 경로 제거(I9).
  for (const s of agentSources()) {
    const adir = join(root, ...segsOf(s.dir));
    for (const f of await listFiles(adir, s.ext)) {
      const text = await readCappedDef(join(adir, f));
      if (text === null) continue; // 초과/비정규/오픈실패 skip(OOM 방어)
      out.push(s.format === "toml" ? buildTomlAgent(s.id, s.dir, f, text) : buildMdAgent(s.id, s.dir, f, text));
    }
  }
  return out;
}

export async function readSkills(root: string): Promise<SkillInfo[]> {
  const out: SkillInfo[] = [];
  const seen = new Set<string>();
  // F12: 레지스트리 스킬 dir 합집합(priority 내림차순 — 동일 name 시 상위 채택). .claude/skills·.agents/skills·.gemini/skills.
  for (const { dir: base } of skillDirs()) {
    const sdir = join(root, ...segsOf(base));
    for (const dir of await listDirs(sdir)) {
      const skillMd = join(sdir, dir, "SKILL.md");
      const text = await readCappedDef(skillMd);   // O_NOFOLLOW·크기캡(무제한 readFile 금지·OOM/symlink 방어·impl R1 HIGH)
      if (text === null) continue;                 // 부재/초과/비정규/심링크 skip
      const fm = parseFrontmatter(text);
      const canonical = fm.name ?? dir;           // dedupe는 frontmatter name 기준(codex#5)
      const refs = await listFiles(join(sdir, dir, "references"), ".md");
      const rp = base + "/" + dir;                 // runtimePath 키
      const orch = parseFrontmatterList(text, "orchestrates"); // 오케스트레이터 배정 edge(런타임별 보존)
      if (seen.has(canonical)) {
        // 동일 canonical 이 .claude/.agents 양쪽 → runtimePaths 병합 + 증거는 runtimePath 별로 보존(런타임 섞임 방지·R3 MED)
        const cur = out.find((s) => s.name === canonical);
        if (cur && !cur.runtimePaths.includes(rp)) {
          cur.runtimePaths.push(rp);
          cur.orchestratesByRuntimePath[rp] = { items: orch.items, declared: orch.present, syntax: orch.syntax };
          cur.referencesByRuntimePath[rp] = refs;
        }
        continue;
      }
      seen.add(canonical);
      out.push({
        name: canonical, runtimePaths: [rp],
        description: fm.description ?? "", references: refs, triggers: fm.description ?? "",
        orchestratesByRuntimePath: { [rp]: { items: orch.items, declared: orch.present, syntax: orch.syntax } },
        referencesByRuntimePath: { [rp]: refs },
      });
    }
  }
  return out;
}

// --- F7(M12) 편집 대상 정규 sourcePath 재조회 (DW2) --------------------------
// 클라이언트 경로 신뢰 금지 — :name(논리 frontmatter name) → 디스크에서 정규 sourcePath 를 서버가 재도출.
// 편집 대상은 `.claude/agents/*.md`·`.claude/skills/{dir}/SKILL.md` **만**(I8 예외 경계). 재사용: 본 파일
// 내부의 readCappedDef(O_NOFOLLOW·크기캡)·parseFrontmatter·listFiles/listDirs(신규 스캐너 발명 금지).
export type DefResolution =
  | { ok: true; sourcePath: string }
  | { ok: false; error: "not-found" | "ambiguous-definition" | "codex-only-v0.7" };

// 에이전트: `.claude/agents/*.md` 를 dedupe 없이 원본 스캔해 frontmatter name(부재 시 파일명) === name 매칭
// 수를 센다. md(claude·gemini) + toml(codex) 편집 가능 dir 전부 스캔. ≥2 → ambiguous. 0 → not-found.
export async function resolveEditableAgent(root: string, name: string): Promise<DefResolution> {
  // F14(M-c): 편집 가능 md 에이전트 dir(claude·gemini) 전건 스캔. 다중 매치(런타임/파일) = ambiguous(비결정 해소 금지·runtime 파라미터는 후속).
  const matches: string[] = [];
  for (const dir of editableMdAgentDirs()) {
    const adir = join(root, ...dir.split("/"));
    for (const f of await listFiles(adir, ".md")) {
      const text = await readCappedDef(join(adir, f));
      if (text === null) continue;
      const canonical = parseFrontmatter(text).name ?? f.replace(/\.md$/, "");
      if (canonical === name) matches.push(dir + "/" + f);
    }
  }
  // F15(M-e): 편집 가능 TOML 에이전트 dir(codex) 도 동일 매치 집계 — md·toml 교차 다중매치 = ambiguous.
  //   R1(agy HIGH): 정규식 name 추출은 multiline 문자열(prompt/instructions) 내부 `name = "..."` 를 오탐 →
  //   에이전트 self-DoS. **strict TOML 파싱으로 top-level name 만** 인정(파싱 실패 = 파일명 폴백·명시 정책).
  for (const dir of editableTomlAgentDirs()) {
    const adir = join(root, ...dir.split("/"));
    for (const f of await listFiles(adir, ".toml")) {
      const text = await readCappedDef(join(adir, f));
      if (text === null) continue;
      const canonical = tomlTopLevelName(text) ?? f.replace(/\.toml$/, "");
      if (canonical === name) matches.push(dir + "/" + f);
    }
  }
  if (matches.length > 1) return { ok: false, error: "ambiguous-definition" };
  if (matches.length === 1) return { ok: true, sourcePath: matches[0]! };
  return { ok: false, error: "not-found" };
}

// 스킬: `.claude/skills/{dir}/SKILL.md` 를 **dedupe 없이** 원본 스캔(readSkills 의 교차 dedupe 가 동일 name
// 두 dir 을 하나로 병합해 모호성을 은폐하므로 재사용 금지). canonical(fm.name ?? dir) === name 매칭 dir 수를 센다.
// ≥2 → ambiguous. 0 이면 `.agents/skills` 에 있으면 codex-only-v0.7·없으면 404.
async function scanSkillDir(root: string, base: string, name: string): Promise<string[]> {
  const sdir = join(root, base);
  const matches: string[] = [];
  for (const dir of await listDirs(sdir)) {
    if (!isSafeSegment(dir)) continue;
    const text = await readCappedDef(join(sdir, dir, "SKILL.md"));
    if (text === null) continue;
    if ((parseFrontmatter(text).name ?? dir) === name) matches.push(dir);
  }
  return matches;
}
export async function resolveEditableSkill(root: string, name: string): Promise<DefResolution> {
  // F14(M-c): 편집 가능 스킬 dir(.claude/skills·.agents/skills·.gemini/skills·SKILL.md md) 전건 스캔.
  //   다중 매치(런타임/dir) = ambiguous(비결정 해소 금지). `.agents/skills`도 이제 편집 가능(codex-only-v0.7 제거).
  const matches: string[] = [];
  for (const base of editableSkillDirs()) {
    for (const dir of await scanSkillDir(root, base, name)) matches.push(base + "/" + dir + "/SKILL.md");
  }
  if (matches.length > 1) return { ok: false, error: "ambiguous-definition" };
  if (matches.length === 1) return { ok: true, sourcePath: matches[0]! };
  return { ok: false, error: "not-found" };
}

export async function harnessInventory(root: string) {
  const agents = await readAgents(root);
  const skills = await readSkills(root);
  return {
    projectRoot: root,
    claude: {
      entrypoint: (await exists(join(root, "CLAUDE.md"))) ? "CLAUDE.md" : null,
      agents: agents.filter((a) => a.runtime === "claude").length,
      skills: skills.filter((s) => s.runtimePaths.some((p) => p.startsWith(".claude"))).length,
    },
    codex: {
      entrypoint: (await exists(join(root, "AGENTS.md"))) ? "AGENTS.md" : null,
      agents: agents.filter((a) => a.runtime === "codex").length,
      skills: skills.filter((s) => s.runtimePaths.some((p) => p.startsWith(".agents"))).length,
    },
    // F12(M-a): agy/gemini 편입. 규칙=GEMINI.md·에이전트=`.gemini/agents/*.md`(md·레지스트리)·스킬=`.gemini/skills`+`.agents/skills`(공유).
    agy: {
      entrypoint: (await exists(join(root, "GEMINI.md"))) ? "GEMINI.md" : null,
      agents: agents.filter((a) => a.runtime === "gemini").length,
      skills: skills.filter((s) => s.runtimePaths.some((p) => p.startsWith(".agents") || p.startsWith(".gemini"))).length,
    },
    workspace: { exists: await exists(join(root, "_workspace")), runs: (await listDirs(join(root, "_workspace", "runs"))).length },
  };
}
