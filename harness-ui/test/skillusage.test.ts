// F13(M-b): 공용·서브 스킬 역인덱스·분류(orchestrator/shared-sub/orphan).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillUsage } from "../src/server/adapters/skillusage.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-su-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  await mkdir(join(root, ".claude", "skills"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const agent = (name: string, skills: string) =>
  writeFile(join(root, ".claude", "agents", `${name}.md`), `---\nname: ${name}\ndescription: d\nskills: ${skills}\n---\n본문`);
const skill = async (name: string, fm = "") => {
  await mkdir(join(root, ".claude", "skills", name), { recursive: true });
  await writeFile(join(root, ".claude", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n${fm}\n---\n본문`);
};

describe("skillUsage — 역인덱스·분류", () => {
  it("orchestrator / shared-sub / orphan 분류 + usedBy 역맵", async () => {
    await agent("a1", "[used-skill]");
    await skill("orch", "orchestrates: [a1]");   // 오케스트레이터
    await skill("used-skill");                    // a1 이 씀 → shared-sub
    await skill("lonely");                        // 아무도 안 씀 → orphan
    const { skills } = await skillUsage(root);
    const by = Object.fromEntries(skills.map((s) => [s.skill, s]));
    expect(by["orch"]!.classification).toBe("orchestrator");
    expect(by["used-skill"]!.classification).toBe("shared-sub");
    expect(by["used-skill"]!.usedBy).toEqual(["orch"]);
    expect(by["lonely"]!.classification).toBe("orphan");
    expect(by["lonely"]!.usedBy).toEqual([]);
  });
  it("정렬: orphan 먼저(주의 필요)", async () => {
    await agent("a1", "[s-used]");
    await skill("orch", "orchestrates: [a1]");
    await skill("s-used");
    await skill("z-orphan");
    const { skills } = await skillUsage(root);
    expect(skills[0]!.classification).toBe("orphan");
  });
  it("editViaF7 = claude 경로 있으면 true", async () => {
    await skill("s1");
    const { skills } = await skillUsage(root);
    expect(skills.find((s) => s.skill === "s1")!.editViaF7).toBe(true);
  });

  it("멀티런타임 동일 agent name — 오케스트레이터 런타임 agent로 usedBy resolve(R1 HIGH)", async () => {
    // .claude/agents/a1(→s-claude) + .gemini/agents/a1(→s-gemini). claude 오케스트레이터는 s-claude 를 써야.
    await agent("a1", "[s-claude]"); // .claude/agents/a1
    await mkdir(join(root, ".gemini", "agents"), { recursive: true });
    await writeFile(join(root, ".gemini", "agents", "a1.md"), "---\nname: a1\ndescription: d\nskills: [s-gemini]\n---\n본문");
    await skill("orch", "orchestrates: [a1]"); // .claude/skills → runtime=claude
    await skill("s-claude");
    await skill("s-gemini");
    const { skills } = await skillUsage(root);
    const by = Object.fromEntries(skills.map((s) => [s.skill, s]));
    expect(by["s-claude"]!.usedBy).toEqual(["orch"]); // claude 오케스트레이터 → claude a1 → s-claude
    expect(by["s-gemini"]!.classification).toBe("orphan"); // 다른 런타임 a1 은 이 오케스트레이터가 안 씀
  });

  it("claude 오케스트레이터가 gemini 전용 agent 선언 → 그 스킬 미귀속(fallback 오귀속 금지·R2 HIGH)", async () => {
    await mkdir(join(root, ".gemini", "agents"), { recursive: true });
    await writeFile(join(root, ".gemini", "agents", "gonly.md"), "---\nname: gonly\ndescription: d\nskills: [g-skill]\n---\n본문");
    await skill("orch", "orchestrates: [gonly]"); // claude 오케스트레이터·gonly 는 gemini 에만
    await skill("g-skill");
    const { skills } = await skillUsage(root);
    // claude 오케스트레이터 런타임에 gonly agent 없음 → g-skill 미귀속(orphan). gemini agent 로 오귀속 금지.
    expect(skills.find((s) => s.skill === "g-skill")!.classification).toBe("orphan");
  });

  it("이름 휴리스틱만인 미선언 스킬은 orchestrator 아님(R1 MED)", async () => {
    await skill("my-orchestrator"); // 이름에 orchestrator·orchestrates: 없음·팀 0
    const { skills } = await skillUsage(root);
    expect(skills.find((s) => s.skill === "my-orchestrator")!.classification).toBe("orphan");
  });

  it("`.agents/skills` 공유 스킬 = codex+gemini 런타임(단일 codex 아님·R1 MED)", async () => {
    await mkdir(join(root, ".agents", "skills", "shared1"), { recursive: true });
    await writeFile(join(root, ".agents", "skills", "shared1", "SKILL.md"), "---\nname: shared1\ndescription: d\n---\n본문");
    const { skills } = await skillUsage(root);
    expect(skills.find((s) => s.skill === "shared1")!.runtimes.sort()).toEqual(["codex", "gemini"]);
  });

  it("broken(dangling) symlink 스킬 dir → 크래시 없이 skip(fail-soft·R8-g)", async () => {
    const { symlink } = await import("node:fs/promises");
    await symlink("/nonexistent/xyz", join(root, ".claude", "skills", "broken"), "dir").catch(() => {});
    await skill("real1");
    const { skills } = await skillUsage(root); // throw 안 함
    expect(skills.find((s) => s.skill === "real1")).toBeTruthy();
    expect(skills.find((s) => s.skill === "broken")).toBeFalsy(); // dangling → skip
  });
});
