// B2 선결 ① — 필수 섹션 목록을 문서(5종)로 통일한 계약.
//
// 코드가 오래 3종(역할·프로토콜·에러)만 검사해 `SKILL.md:113` 의 5종 관례와 어긋나 있었다
// (ADR-001 R12). `작업 원칙`·`협업` 이 통째로 빠진 정의도 가드를 통과했다.
import { describe, it, expect } from "vitest";
import { REQUIRED_SECTIONS } from "../src/server/adapters/artifacteval";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "../..");

describe("B2 선결 ① — 필수 섹션 5종", () => {
  it("에이전트는 5종, 스킬은 2종이다", () => {
    expect([...REQUIRED_SECTIONS.agent]).toEqual(["역할", "원칙", "프로토콜", "에러", "협업"]);
    expect([...REQUIRED_SECTIONS.skill]).toEqual(["절차", "트리거"]);
  });

  it("`SKILL.md:113` 이 같은 5종을 규정한다 — 코드와 문서가 갈라지지 않게 고정", () => {
    const skill = readFileSync(join(REPO, "skills/myharness/SKILL.md"), "utf8");
    const line = skill.split("\n").find((l) => l.includes("필수 섹션:"));
    expect(line, "SKILL.md 에서 '필수 섹션:' 줄을 찾지 못했다").toBeTruthy();
    // 문서는 한국어 이름(핵심 역할·작업 원칙·입력/출력 프로토콜·에러 핸들링·협업)을 쓴다.
    for (const key of REQUIRED_SECTIONS.agent) expect(line!).toContain(key);
  });

  it("이 레포의 에이전트 정의가 전부 5종을 갖춘다(도그푸드)", () => {
    const dir = join(REPO, ".claude/agents");
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const f of files) {
      const heads = readFileSync(join(dir, f), "utf8").split("\n").filter((l) => /^#{1,6}\s/.test(l));
      const miss = REQUIRED_SECTIONS.agent.filter((s) => !heads.some((h) => h.includes(s)));
      if (miss.length) bad.push(`${f}: ${miss.join(",")}`);
    }
    expect(bad, `필수 섹션 누락: ${bad.join(" | ")}`).toEqual([]);
  });
});
