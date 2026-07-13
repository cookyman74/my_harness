// 하네스 목록 — orchestrates: 선언 기반 파생 + 설명 오탐 방지(external-review-loop 류 서브스킬 제외).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHarnesses } from "../src/server/adapters/harnesslist.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-hl-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  await mkdir(join(root, ".claude", "skills"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const agent = (name: string, skills: string) =>
  writeFile(join(root, ".claude", "agents", `${name}.md`), `---\nname: ${name}\ndescription: d\nskills: ${skills}\n---\n본문`);
const skill = async (name: string, fm: string) => {
  await mkdir(join(root, ".claude", "skills", name), { recursive: true });
  await writeFile(join(root, ".claude", "skills", name, "SKILL.md"), `---\nname: ${name}\n${fm}\n---\n본문`);
};

describe("listHarnesses", () => {
  it("orchestrates: 선언 → 배정 에이전트·스킬 파생(linked)", async () => {
    await agent("a1", "[s1]");
    await agent("a2", "[s2]");
    await skill("myorch", "description: 팀 오케스트레이터\norchestrates: [a1, a2]");
    const { harnesses } = await listHarnesses(root);
    expect(harnesses).toHaveLength(1);
    expect(harnesses[0]!.name).toBe("myorch");
    expect(harnesses[0]!.agents).toEqual(["a1", "a2"]);
    expect(harnesses[0]!.skillCount).toBe(2);
    expect(harnesses[0]!.status).toBe("linked");
    expect(harnesses[0]!.orchestratesDeclared).toBe(true);
  });

  it("설명에 '오케스트레이터' 언급하는 서브스킬은 하네스 아님(오탐 방지)", async () => {
    // external-review-loop 재현: 설명이 "오케스트레이터가 판정"이라 하나 orchestrates: 없음·이름도 미매칭.
    await skill("external-review-loop", "description: 오케스트레이터가 이슈를 판정하는 리뷰 게이트");
    const { harnesses } = await listHarnesses(root);
    expect(harnesses).toHaveLength(0); // 목록에서 제외
  });

  it("이름에 orchestrator 포함 + orchestrates: 미선언 → 미선언(unmigrated·빈 배정)으로 노출", async () => {
    await skill("team-orchestrator", "description: d");
    const { harnesses } = await listHarnesses(root);
    expect(harnesses).toHaveLength(1);
    expect(harnesses[0]!.name).toBe("team-orchestrator");
    expect(harnesses[0]!.orchestratesDeclared).toBe(false);
    expect(harnesses[0]!.status).toBe("unmigrated");
    expect(harnesses[0]!.agents).toEqual([]);
  });

  it("orchestrates 대상 에이전트 파일 부재 → broken + missingAgents", async () => {
    await skill("orch2", "description: d\norchestrates: [ghost]");
    const { harnesses } = await listHarnesses(root);
    expect(harnesses[0]!.status).toBe("broken");
    expect(harnesses[0]!.missingAgents).toEqual(["ghost"]);
  });
});
