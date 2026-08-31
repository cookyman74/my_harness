// B5 — BEHAVIOR 진단 UI 연결. ADR-001 D6 이 채택한 "진단 접기 안에 보인다"를 실제로 만든다.
//
// **새 `FindingType` 을 만들지 않는다** — 기존 `dead_link`·`orphan` 에 `subject_kind: "behavior"`
// 로 얹는다. 분류를 늘리면 소비처(집계·UI·테스트)가 전부 갈라진다.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeHarnessScorecard } from "../src/server/adapters/scorecard.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-b5-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const BODY = "# a1\n## 핵심 역할\n역할.\n## 작업 원칙\n원칙.\n## 입력/출력 프로토콜\n입출력.\n## 에러 핸들링\n에러.\n## 협업\n협업.\n";
async function agent(name: string, behaviors?: string[]): Promise<void> {
  const fm = [`name: ${name}`, "description: 테스트할 때 사용, 다른 것과 달리"]
    .concat(behaviors ? ["behaviors:", ...behaviors.map((b) => `  - ${b}`)] : []).join("\n");
  await writeFile(join(root, ".claude", "agents", `${name}.md`), `---\n${fm}\n---\n${BODY}`);
}
async function behavior(name: string): Promise<void> {
  await mkdir(join(root, ".agents", "behaviors", name), { recursive: true });
  await writeFile(join(root, ".agents", "behaviors", name, "BEHAVIOR.md"),
    `---\nname: ${name}\ndescription: ${name} 기준\n---\n## Intent\n의도.\n## Failure modes\n실패.\n`);
}
const sc = () => computeHarnessScorecard(root, { now: "2026-01-01" });

describe("B5 — BEHAVIOR 진단 합류", () => {
  it("끊긴 참조는 기존 `dead_link` 로 나온다(새 분류 없음)", async () => {
    await agent("a1", ["nosuch"]);
    const r = await sc();
    const f = r.findings.find((x) => x.type === "dead_link" && x.target === "nosuch");
    expect(f, "dead_link finding 이 없다").toBeTruthy();
    expect(f!.subject).toBe("a1");
    expect(f!.subject_kind).toBe("agent");   // 주체는 정의다 — 끊긴 쪽이 정의이므로
    expect(f!.detail).toContain(".agents/behaviors/nosuch");
  });

  it("참조되지 않는 스펙은 기존 `orphan` + `subject_kind: behavior`", async () => {
    await agent("a1");
    await behavior("lonely");
    const r = await sc();
    const f = r.findings.find((x) => x.type === "orphan" && x.subject === "lonely");
    expect(f, "orphan finding 이 없다").toBeTruthy();
    expect(f!.subject_kind).toBe("behavior");
  });

  it("정상 참조는 finding 을 만들지 않는다", async () => {
    await agent("a1", ["gate"]);
    await behavior("gate");
    const r = await sc();
    expect(r.findings.filter((x) => x.subject_kind === "behavior")).toEqual([]);
    expect(r.findings.filter((x) => x.target === "gate")).toEqual([]);
  });

  it("BEHAVIOR 미적용 하네스는 behavior finding 0 — 조용한 통과가 아니라 참조도 0인 상태다", async () => {
    await agent("a1");
    const r = await sc();
    expect(r.findings.filter((x) => x.subject_kind === "behavior")).toEqual([]);
  });

  it("`FindingType` 유니온이 늘어나지 않았다(ADR D6 코드 계약)", async () => {
    const src = await readFile(join(__dirname, "../src/server/adapters/scorecard.ts"), "utf8");
    const m = /export type FindingType =([\s\S]*?);/.exec(src);
    expect(m).toBeTruthy();
    const members = [...m![1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect(members.sort()).toEqual(
      ["coverage_gap", "dead_link", "incomplete_def", "link_unknown", "orphan", "oversize", "unknown_scope"]);
  });

  it("`counts` 는 기존 7종 그대로 — behavior 가 새 카운터를 만들지 않는다", async () => {
    await agent("a1"); await behavior("lonely");
    const r = await sc();
    expect(Object.keys(r.counts).sort()).toEqual(
      ["agents", "coverage_gap", "dead_link", "incomplete_def", "link_unknown", "orphan", "oversize", "skills", "unknown_scope"]);
    expect(r.counts.orphan).toBeGreaterThan(0);   // behavior 고아가 기존 카운터에 합류한다
  });

  it("서버는 `check-behaviors.sh` 를 실행하지 않는다 — 요청마다 도는 순수 TS 다(ADR D5 계열)", async () => {
    const src = await readFile(join(__dirname, "../src/server/adapters/scorecard.ts"), "utf8");
    expect(src).not.toMatch(/child_process|execFile|spawn\(/);
    expect(src).not.toContain("check-behaviors.sh\"");
  });

  it("최상위 노출 불변 — UI 는 BEHAVIOR 를 진단 접기 안에서만 보여준다", async () => {
    const ui = await readFile(join(__dirname, "../src/web/screens.tsx"), "utf8");
    // 진단 뷰(`sc-diagnostics`) 밖에서 behavior 를 최상위 카드로 노출하지 않는다.
    const idx = ui.indexOf('orphanBy("behavior")');
    expect(idx, "진단 요약에 BEHAVIOR 고아 행이 없다").toBeGreaterThan(0);
    const diagIdx = ui.indexOf("sc-diagnostics");
    expect(diagIdx).toBeGreaterThan(0);
  });
});
