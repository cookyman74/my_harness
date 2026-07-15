// Eval v1 E1: 아티팩트 4축 계층A 평가 — 결정성·좋은/나쁜 아티팩트 구분·kind별 rubric·min-gate·롤업.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateArtifacts } from "../src/server/adapters/artifacteval.js";
import { buildServer } from "../src/server/index.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-ev-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function skill(name: string, fm: string, body: string, refs?: Record<string, string>) {
  await mkdir(join(root, ".claude", "skills", name), { recursive: true });
  await writeFile(join(root, ".claude", "skills", name, "SKILL.md"), `---\n${fm}\n---\n${body}`);
  if (refs) { await mkdir(join(root, ".claude", "skills", name, "references"), { recursive: true });
    for (const [f, c] of Object.entries(refs)) await writeFile(join(root, ".claude", "skills", name, "references", f), c); }
}
async function agent(name: string, fm: string, body: string) {
  await writeFile(join(root, ".claude", "agents", `${name}.md`), `---\n${fm}\n---\n${body}`);
}

describe("evaluateArtifacts — 계층A 4축", () => {
  it("좋은 스킬(구체 description·트리거·near-miss·짧은 본문·절차/트리거 섹션) → 높은 등급", async () => {
    await skill("good",
      "name: good\ndescription: PDF 추출·병합 처리; .pdf 요청 시 사용, 이미지 변환과 달리 문서 작업만",
      "# good\n## 트리거\n조건 명시한다.\n## 절차\n1. 읽는다.\n2. 검증한다. 왜냐하면 안전 때문.\n");
    const g = (await evaluateArtifacts(root)).artifacts.find((a) => a.name === "good")!;
    expect(g.rubric).toBe("md-skill");
    expect(g.evaluation_mode).toBe("static");
    expect(g.scores.trigger).toBeGreaterThanOrEqual(0.9);   // 존재+길이+키워드+near-miss
    expect(["A", "B"]).toContain(g.grade);
  });

  it("나쁜 스킬(description 없음·거대 본문·references 없음) → 낮은 등급·findings", async () => {
    const huge = Array.from({ length: 900 }, (_, i) => `줄 ${i} 내용을 채운다 확인한다.`).join("\n");
    await skill("bad", "name: bad\ndescription: x", huge);
    const b = (await evaluateArtifacts(root)).artifacts.find((a) => a.name === "bad")!;
    expect(b.grade).toBe("D");                               // min-gate(본문>800·refs 0)
    expect(b.findings.some((f) => f.action === "shrink-skill")).toBe(true);
    expect(b.findings.every((f) => f.risk === "low" || f.risk === "med")).toBe(true); // E1 고위험 없음
  });

  it("references 분리한 큰 스킬 → 구조 감점 완화", async () => {
    const big = Array.from({ length: 350 }, (_, i) => `본문 ${i} 절차 확인.`).join("\n");
    await skill("split", "name: split\ndescription: 큰 스킬 할 때 사용, 소규모 아님", big, { "a.md": "참조자료" });
    const s = (await evaluateArtifacts(root)).artifacts.find((a) => a.name === "split")!;
    // references 있으니 move-to-references(refs 없음) finding 안 뜸
    expect(s.findings.some((f) => f.action === "move-to-references" && f.why.includes("분리 없음"))).toBe(false);
  });

  it("TOML 에이전트 → toml-agent rubric(유도/가지치기 미적용·트리거/구조만)", async () => {
    await mkdir(join(root, ".codex", "agents"), { recursive: true });
    await writeFile(join(root, ".codex", "agents", "cx.toml"), 'name = "cx"\ndescription = "Codex 작업 시 사용, 다른 용도 아님"\n');
    const t = (await evaluateArtifacts(root)).artifacts.find((a) => a.name === "cx")!;
    expect(t.rubric).toBe("toml-agent");
    expect(t.scores.induction).toBeUndefined();   // 미적용
    expect(t.scores.pruning).toBeUndefined();
    expect(t.scores.trigger).toBeGreaterThan(0);
  });

  it("결정성 — 같은 입력 2회 동일 점수(계층A)", async () => {
    await skill("det", "name: det\ndescription: 결정성 테스트 할 때 사용, 유사작업 아님", "# det\n## 절차\n한다.\n## 트리거\n조건.\n");
    const r1 = (await evaluateArtifacts(root)).artifacts.find((a) => a.name === "det")!;
    const r2 = (await evaluateArtifacts(root)).artifacts.find((a) => a.name === "det")!;
    expect(r2.scores).toEqual(r1.scores);
    expect(r2.grade).toBe(r1.grade);
  });

  it("롤업 — axisAvg·gradeDist·worst·count", async () => {
    await skill("s1", "name: s1\ndescription: A 작업 할 때 사용, B 아님", "# s1\n## 절차\n한다.\n## 트리거\n x.\n");
    await agent("a1", "name: a1\ndescription: 에이전트 역할 때 사용", "# a1\n## 역할\n역할.\n## 협업 프로토콜\n메시지.\n## 에러 핸들링\n재시도.\n");
    const ev = await evaluateArtifacts(root);
    expect(ev.rollup.count).toBe(2);
    expect(ev.rollup.gradeDist.A + ev.rollup.gradeDist.B + ev.rollup.gradeDist.C + ev.rollup.gradeDist.D).toBe(2);
    expect(typeof ev.rollup.axisAvg.trigger).toBe("number");
  });
});

describe("GET /api/eval/artifacts — 읽기전용 계약", () => {
  it("200 · {artifacts, rollup} · side-effect 0", async () => {
    await skill("api", "name: api\ndescription: API 테스트 할 때 사용, 그 외 아님", "# api\n## 절차\n한다.\n## 트리거\n x.\n");
    const r = await buildServer({ projectRoot: root }).inject({ url: "/api/eval/artifacts" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(Array.isArray(b.artifacts)).toBe(true);
    expect(b.rollup.count).toBeGreaterThanOrEqual(1);
    expect(b.artifacts[0].evaluation_mode).toBe("static");
  });
});
