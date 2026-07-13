// F13(M-b): 공용·서브 스킬 역인덱스 — 스킬 → 그 스킬을 쓰는 하네스(오케스트레이터) 매핑 + 분류.
//   읽기·진단 전용(side-effect 0). 편집은 F7(#/skills) 딥링크(중복 편집기 금지).
//   분류(상호배타): orchestrator(orchestrates: 선언 + 팀 보유) / shared-sub(≥1 하네스가 씀) / orphan(아무도 안 씀).
import { readAgents, readSkills } from "./harness.js";
import { listHarnesses } from "./harnesslist.js";
import { editableSkillDirs, type RuntimeId } from "./runtimes.js";

export type SkillClassification = "orchestrator" | "shared-sub" | "orphan";
export interface SkillUsageEntry {
  skill: string;
  runtimes: RuntimeId[];      // 실 런타임(공유 스킬 .agents = codex+gemini 둘 다·다중 배지·R1 감사)
  runtimePaths: string[];
  classification: SkillClassification;
  usedBy: string[];           // 이 스킬을 쓰는 하네스(오케스트레이터) 이름
  editViaF7: boolean;         // 편집 가능(F7 딥링크·M-b=claude만)
}

// 경로 → 런타임 집합. `.agents/skills`는 Codex·Gemini **공유**(둘 다 반환·단일 codex 오표기 방지·R1 감사).
function runtimesOfPath(rp: string): RuntimeId[] {
  if (rp.startsWith(".gemini")) return ["gemini"];
  if (rp.startsWith(".agents")) return ["codex", "gemini"]; // 공유
  if (rp.startsWith(".codex")) return ["codex"];
  return ["claude"];
}

export async function skillUsage(root: string): Promise<{ skills: SkillUsageEntry[] }> {
  const [agents, skills, { harnesses }] = await Promise.all([readAgents(root), readSkills(root), listHarnesses(root)]);
  // 멀티런타임 동일 name 대비: single map(last-wins) 금지 → name → AgentInfo[] 멀티맵(R1 HIGH).
  const agentsByName = new Map<string, typeof agents>();
  for (const a of agents) { const l = agentsByName.get(a.name) ?? []; l.push(a); agentsByName.set(a.name, l); }
  // 오케스트레이터 = orchestrates 선언 + 팀 보유(이름 휴리스틱만인 미선언은 orchestrator로 분류 안 함·R1 MED).
  const orchestratorNames = new Set(harnesses.filter((h) => h.orchestratesDeclared && h.agents.length > 0).map((h) => h.name));

  // 역맵: 스킬 name → 하네스 이름 집합. 배정 에이전트는 **오케스트레이터의 런타임**에서 resolve(멀티런타임 정확).
  const usedBy = new Map<string, Set<string>>();
  for (const h of harnesses) {
    for (const an of h.agents) {
      const cands = agentsByName.get(an) ?? [];
      // 오케스트레이터 런타임의 agent만(공유 orchestrator=codex는 codex·gemini 허용). 동일 런타임 부재 → 미귀속(타 런타임 오귀속 금지·R2 HIGH).
      const allowed: RuntimeId[] = h.runtime === "codex" ? ["codex", "gemini"] : [h.runtime as RuntimeId];
      const a = cands.find((c) => allowed.includes(c.runtime));
      for (const sk of a?.skills ?? []) {
        if (!usedBy.has(sk)) usedBy.set(sk, new Set());
        usedBy.get(sk)!.add(h.name);
      }
    }
  }

  const out: SkillUsageEntry[] = skills.map((s) => {
    const used = usedBy.get(s.name);
    const classification: SkillClassification =
      orchestratorNames.has(s.name) ? "orchestrator" : used && used.size > 0 ? "shared-sub" : "orphan";
    const runtimes = [...new Set(s.runtimePaths.flatMap(runtimesOfPath))];
    return {
      skill: s.name, runtimes, runtimePaths: s.runtimePaths, classification,
      usedBy: used ? [...used].sort() : [],
      // F14(M-c): 편집 가능 스킬 dir(.claude/.agents/.gemini·SKILL.md md)면 F7 편집 가능. (동일 name 다중 런타임은 ambiguous 409 — 드묾)
      editViaF7: s.runtimePaths.some((p) => editableSkillDirs().some((d) => p === d || p.startsWith(d + "/"))),
    };
  });
  out.sort((a, b) => {
    const rank = { orphan: 0, "shared-sub": 1, orchestrator: 2 } as const;
    return rank[a.classification] - rank[b.classification] || a.skill.localeCompare(b.skill);
  });
  return { skills: out };
}
