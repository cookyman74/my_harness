// F12(M-a): 런타임 어댑터 레지스트리 SSOT + gemini 읽기 편입(editable=false).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIMES, runtimeById, agentSources, skillDirs, runtimeOfPath } from "../src/server/adapters/runtimes.js";
import { readAgents, readSkills } from "../src/server/adapters/harness.js";
import { computeHarnessScorecard } from "../src/server/adapters/scorecard.js";

describe("RUNTIMES 레지스트리 (SSOT)", () => {
  it("3 런타임(claude·codex·gemini)·id 유일", () => {
    expect(RUNTIMES.map((r) => r.id)).toEqual(["claude", "codex", "gemini"]);
    expect(runtimeById("gemini")?.agent.format).toBe("md-frontmatter"); // Gemini=md(Claude 동일)
    expect(runtimeById("codex")?.agent.format).toBe("toml");
  });
  it("agentSources = 런타임별 dir·ext·format", () => {
    const s = agentSources();
    expect(s.find((x) => x.id === "gemini")).toMatchObject({ dir: ".gemini/agents", ext: ".md", format: "md-frontmatter" });
    expect(s.find((x) => x.id === "codex")).toMatchObject({ dir: ".codex/agents", ext: ".toml", format: "toml" });
  });
  it("skillDirs = 합집합·priority 내림차순(claude 최상위·회귀 보존·.agents>.gemini)", () => {
    const dirs = skillDirs().map((d) => d.dir);
    expect(dirs).toContain(".claude/skills");
    expect(dirs).toContain(".agents/skills");
    expect(dirs).toContain(".gemini/skills");
    expect(dirs[0]).toBe(".claude/skills"); // claude-first 보존(기존 readSkills 순회 회귀 방지·agy HIGH)
    expect(dirs.indexOf(".agents/skills")).toBeLessThan(dirs.indexOf(".gemini/skills")); // 별칭 우선순위
  });
  it("runtimeOfPath — .gemini→gemini · .agents/.codex→codex · else claude", () => {
    expect(runtimeOfPath(".gemini/skills/x")).toBe("gemini");
    expect(runtimeOfPath(".agents/skills/x")).toBe("codex");
    expect(runtimeOfPath(".codex/agents/x")).toBe("codex");
    expect(runtimeOfPath(".claude/agents/x")).toBe("claude");
  });
  it("editable — claude·gemini md·codex toml 에이전트 모두 편집 가능(M-c·M-e)", () => {
    expect(runtimeById("claude")?.agent.editable).toBe(true);
    expect(runtimeById("gemini")?.agent.editable).toBe(true);  // M-c: md=Claude 동일 파서
    expect(runtimeById("codex")?.agent.editable).toBe(true);   // M-e(F15): Codex TOML limited-edit 개방
  });
});

describe("gemini 읽기 편입 (레지스트리 순회)", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hui-rt-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("`.gemini/agents/*.md` 가 readAgents 에 runtime=gemini 로 편입", async () => {
    await mkdir(join(root, ".gemini", "agents"), { recursive: true });
    await writeFile(join(root, ".gemini", "agents", "g1.md"), "---\nname: g1\ndescription: d\nskills: [s1]\n---\n본문");
    const agents = await readAgents(root);
    const g = agents.find((a) => a.name === "g1");
    expect(g).toBeTruthy();
    expect(g!.runtime).toBe("gemini");
    expect(g!.sourcePath).toBe(".gemini/agents/g1.md");
    expect(g!.skills).toEqual(["s1"]);
  });

  it("`.gemini/skills/*/SKILL.md` 가 readSkills 에 편입(runtimePath 포함)", async () => {
    await mkdir(join(root, ".gemini", "skills", "gs1"), { recursive: true });
    await writeFile(join(root, ".gemini", "skills", "gs1", "SKILL.md"), "---\nname: gs1\ndescription: d\n---\n본문");
    const skills = await readSkills(root);
    const s = skills.find((x) => x.name === "gs1");
    expect(s).toBeTruthy();
    expect(s!.runtimePaths).toContain(".gemini/skills/gs1");
    expect(runtimeOfPath(s!.runtimePaths[0]!)).toBe("gemini");
  });

  it("scorecard: `.gemini/skills` orphan → runtime=gemini(claude 오분류 아님·R8-b·codex HIGH)", async () => {
    await mkdir(join(root, ".gemini", "skills", "unused"), { recursive: true });
    await writeFile(join(root, ".gemini", "skills", "unused", "SKILL.md"), "---\nname: unused\ndescription: d\n---\n본문");
    const sc = await computeHarnessScorecard(root);
    const orphan = sc.findings.find((f) => f.subject === "unused" && f.type === "orphan");
    expect(orphan).toBeTruthy();
    expect(orphan!.runtime).toBe("gemini"); // 이전 skillRuntime 하드코딩은 claude 로 오분류
  });
});
