// F12(M-a): 런타임 어댑터 레지스트리 — 런타임 경로/포맷의 단일 출처(SSOT).
//   **M-a 스코프:** 읽기(harness.ts readAgents/readSkills/inventory)·분류(harnesslist.ts·scorecard.ts)가 레지스트리 순회.
//   install(factory.ts)·auth 감지(runtime.ts)는 필드만 선언·**실사용은 F17(M-d)서 이관**(F11 v1.5.1 동작 보존).
//   새 런타임 편입 = 항목 1개 추가(로직 수정 0). 하드코딩 경로 산재 금지(I9).
//   설계 근거: docs/harness-ui/v0.8/design/design-v0.8.md §2. agent/skill 포맷 분리(R1 감사·Codex agent=toml·skill=md).
import { homedir } from "node:os";
import { join } from "node:path";

export type RuntimeId = "claude" | "codex" | "gemini";
export type AgentFormat = "md-frontmatter" | "toml";

export interface RuntimeAdapter {
  id: RuntimeId;
  label: string;
  agent: {
    dir: string;          // 프로젝트 상대 (POSIX): ".claude/agents"
    ext: ".md" | ".toml";
    format: AgentFormat;  // 파서 선택(스키마 validator는 F14/F15에서 런타임별)
    editable: boolean;    // F14(md)/F15(toml)에서 개방. M-a 현재: claude만 true(gemini/codex 편집은 후속).
  };
  skills: Array<{
    dir: string;          // 프로젝트 상대 (POSIX): ".claude/skills" | ".agents/skills" | ".gemini/skills"
    priority: number;     // 동일 name 시 상위 채택(별칭 우선순위 — 공식: .agents/skills > .gemini/skills)
    editable: boolean;    // M-a: claude(.claude/skills)만 true.
  }>;
  rulesFile: string;      // 읽기 표시용(CLAUDE/AGENTS/GEMINI.md)·install 대상 아님.
  install: {
    channel: "claude" | "shared"; // shared = .agents/skills(Codex+Gemini 공유). 선검증 대상(R8-j).
    userDest: string;             // 절대 경로(홈 기준). 심링크 설치 목적지.
  };
  authBin: string | null; // CLI 인증 조회용 bin(claude/codex). null = 파일 근거(gemini oauth_creds).
}

const H = homedir();

// 확정 항목(공식문서·design §2-2). editable/install userDest 는 F14/F17·선검증(§10)에서 확정.
export const RUNTIMES: readonly RuntimeAdapter[] = [
  {
    id: "claude", label: "Claude Code",
    agent: { dir: ".claude/agents", ext: ".md", format: "md-frontmatter", editable: true },
    // priority: Claude 최상위(20) — 기존 readSkills 순회(.claude/skills 먼저·claude-first dedup) 보존(회귀 방지·agy HIGH).
    //   그 아래 .agents/skills(10) > .gemini/skills(5)(공식 별칭 우선순위).
    skills: [{ dir: ".claude/skills", priority: 20, editable: true }],
    rulesFile: "CLAUDE.md",
    install: { channel: "claude", userDest: join(H, ".claude", "skills", "myharness") },
    authBin: "claude",
  },
  {
    id: "codex", label: "Codex",
    // M-e(F15): Codex 에이전트 = TOML → limited-edit 개방(주석 보존 verbatim·semantic diff). toml.ts 경유.
    agent: { dir: ".codex/agents", ext: ".toml", format: "toml", editable: true },
    skills: [{ dir: ".agents/skills", priority: 10, editable: false }],
    rulesFile: "AGENTS.md",
    install: { channel: "shared", userDest: join(H, ".agents", "skills", "myharness") },
    authBin: "codex",
  },
  {
    id: "gemini", label: "Antigravity (Gemini)",
    // M-c(F14): Gemini 에이전트 = md(Claude 동일 파서) → editable. 선검증 결정.
    agent: { dir: ".gemini/agents", ext: ".md", format: "md-frontmatter", editable: true },
    // 공식 별칭 우선순위: .agents/skills > .gemini/skills(동일 tier). 스킬=SKILL.md(md) → editable(M-c).
    skills: [{ dir: ".agents/skills", priority: 10, editable: true }, { dir: ".gemini/skills", priority: 5, editable: true }],
    rulesFile: "GEMINI.md",
    install: { channel: "shared", userDest: join(H, ".agents", "skills", "myharness") },
    authBin: null, // 비대화형 CLI 인증 조회 미지원 → 파일 근거(runtime.ts).
  },
] as const;

export function runtimeById(id: string): RuntimeAdapter | undefined {
  return RUNTIMES.find((r) => r.id === id);
}

// F14(M-c): 편집 가능 md 에이전트 dir(claude·gemini). md 파서 경유(canonicalizeDefinition).
export function editableMdAgentDirs(): string[] {
  return RUNTIMES.filter((r) => r.agent.editable && r.agent.format === "md-frontmatter").map((r) => r.agent.dir);
}
// F15(M-e): 편집 가능 TOML 에이전트 dir(codex). toml 파서 경유(canonicalizeTomlAgent·limited-edit).
export function editableTomlAgentDirs(): string[] {
  return RUNTIMES.filter((r) => r.agent.editable && r.agent.format === "toml").map((r) => r.agent.dir);
}
// F14(M-c): 편집 가능 스킬 dir(SKILL.md·md). 어느 런타임이든 editable=true 면 편집 가능(.agents/skills 공유 포함).
export function editableSkillDirs(): string[] {
  const s = new Set<string>();
  for (const r of RUNTIMES) for (const sk of r.skills) if (sk.editable) s.add(sk.dir);
  return [...s];
}

// readAgents 순회용: {runtime, dir, ext, format}.
export function agentSources(): Array<{ id: RuntimeId; dir: string; ext: ".md" | ".toml"; format: AgentFormat }> {
  return RUNTIMES.map((r) => ({ id: r.id, dir: r.agent.dir, ext: r.agent.ext, format: r.agent.format }));
}

// readSkills 순회용: 전 런타임 스킬 dir 합집합(중복 dir 제거·priority 내림차순 — 상위 우선).
export function skillDirs(): Array<{ dir: string; priority: number }> {
  const byDir = new Map<string, number>();
  for (const r of RUNTIMES) for (const s of r.skills) {
    const prev = byDir.get(s.dir);
    if (prev === undefined || s.priority > prev) byDir.set(s.dir, s.priority);
  }
  return [...byDir.entries()].map(([dir, priority]) => ({ dir, priority })).sort((a, b) => b.priority - a.priority);
}

// runtimePath(예: ".agents/skills/foo") → 런타임 id 추정(harnesslist·표시용).
//   .agents/skills 는 Codex·Gemini 공유라 대표값 codex(공유 표기는 F13에서 정교화).
export function runtimeOfPath(rp: string): RuntimeId {
  if (rp.startsWith(".gemini")) return "gemini";
  if (rp.startsWith(".agents") || rp.startsWith(".codex")) return "codex";
  return "claude";
}
