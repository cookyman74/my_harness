// B5 — **TS 와 CLI 가 같은 답을 내는가.** 같은 규칙을 두 곳에 구현했으므로 갈라지면 그게 결함이다.
//
// 대조 대상: `scorecard.ts`(TS, 요청마다 도는 순수 함수) ↔ `skills/myharness/scripts/check-behaviors.sh`
// (CLI 배치). 서버가 셸을 부를 수 없다는 아키텍처 결정(ADR D5 계열) 때문에 구현이 둘인 것이지,
// **판정이 둘이어도 된다는 뜻이 아니다.**
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeHarnessScorecard } from "../src/server/adapters/scorecard.js";

const sh = promisify(execFile);
const CLI = join(__dirname, "../../skills/myharness/scripts/check-behaviors.sh");

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-par-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const BODY = "# a1\n## 핵심 역할\n역할.\n## 작업 원칙\n원칙.\n## 입력/출력 프로토콜\n입출력.\n## 에러 핸들링\n에러.\n## 협업\n협업.\n";

// **차단 수준만 비교한다.** CLI 는 고아를 `⚠ warn`(rc 0)으로, TS 는 `severity: "low"` finding 으로
// 낸다 — 표현이 다를 뿐 둘 다 "막지는 않지만 알린다"로 같다. 비교식이 rc 만 보면 이 둘이
// 갈라진 것처럼 보인다. 그래서 **CLI 의 `✗`(fail) ↔ TS 의 severity med 이상**을 대조한다.
async function cliFails(): Promise<boolean> {
  try { await sh("bash", [CLI, "."], { cwd: root }); return false; }
  catch { return true; }
}
/** BEHAVIOR 관심사의 finding 인가 — 끊긴 참조·고아·`behaviors:` 형식 오류. */
const isBehaviorFinding = (f: { subject_kind: string; type: string; detail?: string }): boolean =>
  f.subject_kind === "behavior" ||
  ((f.type === "dead_link" || f.type === "incomplete_def") && (f.detail ?? "").includes("behaviors"));

async function tsFinds(): Promise<boolean> {
  const r = await computeHarnessScorecard(root, { now: "2026-01-01" });
  return r.findings.some((f) => (f.severity === "high" || f.severity === "med") && isBehaviorFinding(f));
}
/** 알림 수준(warn 포함) — 고아처럼 차단하지 않는 신호의 대조용. */
async function tsNotices(): Promise<boolean> {
  const r = await computeHarnessScorecard(root, { now: "2026-01-01" });
  return r.findings.some(isBehaviorFinding);
}

async function writeAgentRaw(fm: string): Promise<void> {
  await writeFile(join(root, ".claude", "agents", "a1.md"), `---\n${fm}\n---\n${BODY}`);
}
async function writeSpecRaw(dir: string, raw: string): Promise<void> {
  await mkdir(join(root, ".agents", "behaviors", dir), { recursive: true });
  await writeFile(join(root, ".agents", "behaviors", dir, "BEHAVIOR.md"), raw);
}
const goodSpec = (name: string) => `---\nname: ${name}\ndescription: ${name} 기준\n---\n## Intent\n의도.\n## Failure modes\n실패.\n`;
const goodFm = (behaviors?: string) =>
  ["name: a1", "description: 테스트할 때 사용, 다른 것과 달리"].concat(behaviors ? [behaviors] : []).join("\n");

describe("B5 — TS ↔ CLI 판정 일치", () => {
  it.each([
    ["정상 구성", async () => { await writeAgentRaw(goodFm("behaviors:\n  - gate")); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["끊긴 참조", async () => { await writeAgentRaw(goodFm("behaviors:\n  - nosuch")); }],

    ["미적용(스펙·참조 둘 다 없음)", async () => { await writeAgentRaw(goodFm()); }],
    // ── 아래가 R1 agy 가 잡은 갈라짐들 ──
    ["스펙 frontmatter 없음", async () => { await writeAgentRaw(goodFm("behaviors:\n  - broken")); await writeSpecRaw("broken", "본문만 있다\n"); }],
    ["스펙 description 없음", async () => { await writeAgentRaw(goodFm("behaviors:\n  - nodesc")); await writeSpecRaw("nodesc", "---\nname: nodesc\n---\n## Intent\n의도.\n## Failure modes\n실패.\n"); }],
    ["스펙 name↔디렉토리명 불일치", async () => { await writeAgentRaw(goodFm("behaviors:\n  - mism")); await writeSpecRaw("mism", goodSpec("other")); }],
    ["스펙 name 규칙 위반", async () => { await writeAgentRaw(goodFm("behaviors:\n  - Bad")); await writeSpecRaw("Bad", goodSpec("Bad")); }],
    ["정의 frontmatter 에 tab", async () => { await writeAgentRaw("name: a1\ndescription: t\nbehaviors:\n\t- gate"); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["정의 중복 키", async () => { await writeAgentRaw("name: a1\ndescription: t\nbehaviors: [gate]\nbehaviors: [nosuch]"); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["정의 비정규 키(콜론 앞 공백)", async () => { await writeAgentRaw("name: a1\ndescription: t\nbehaviors : [gate]"); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["정의 flow sequence", async () => { await writeAgentRaw(goodFm("behaviors: [gate, nosuch]")); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["정의 목록 중간 주석", async () => { await writeAgentRaw(goodFm("behaviors:\n  - gate\n# 주석\n  - nosuch")); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["정의 들여쓰기 없는 항목", async () => { await writeAgentRaw(goodFm("behaviors:\n- gate\n- nosuch")); await writeSpecRaw("gate", goodSpec("gate")); }],
    // ── R2 codex 가 잡은 갈라짐 ──
    ["정의 BOM", async () => { await writeFile(join(root, ".claude", "agents", "a1.md"), `\uFEFF---\n${goodFm("behaviors:\n  - gate")}\n---\n${BODY}`); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["정의 frontmatter 미종료", async () => { await writeFile(join(root, ".claude", "agents", "a1.md"), `---\n${goodFm("behaviors:\n  - gate")}\n${BODY}`); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["스펙 BOM", async () => { await writeAgentRaw(goodFm("behaviors:\n  - gate")); await writeSpecRaw("gate", "\uFEFF" + goodSpec("gate")); }],
    ["정의 블록 스칼라 안 콜론 문장", async () => {
      await writeFile(join(root, ".claude", "agents", "a1.md"),
        `---\nname: a1\ndescription: >\n  테스트할 때 사용한다.\n  참고: 다른 것과 달리 판정만.\nbehaviors:\n  - gate\n---\n${BODY}`);
      await writeSpecRaw("gate", goodSpec("gate"));
    }],
    ["정의 들여쓴 behaviors 키", async () => {
      await writeAgentRaw("name: a1\ndescription: t\n  behaviors: [nosuch]");
      await writeSpecRaw("gate", goodSpec("gate"));
    }],
    // ── R3 agy 가 잡은 갈라짐 ──
    ["무효 스펙(참조 없음)", async () => { await writeAgentRaw(goodFm()); await writeSpecRaw("broken", "본문만\n"); }],
    ["스펙 name↔디렉토리명 불일치(참조 없음)", async () => { await writeAgentRaw(goodFm()); await writeSpecRaw("mism", goodSpec("other")); }],
    ["미지원 스칼라 표기", async () => { await writeAgentRaw(goodFm("behaviors: gate")); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["빈 목록 `behaviors: []`", async () => { await writeAgentRaw(goodFm("behaviors: []")); await writeSpecRaw("gate", goodSpec("gate")); }],
    ["레거시 정의(frontmatter 없음·behaviors 무관)", async () => {
      await writeFile(join(root, ".claude", "agents", "a1.md"), "# a1\n본문만 있는 레거시 정의\n");
      await writeSpecRaw("gate", goodSpec("gate"));
      await mkdir(join(root, ".claude", "agents"), { recursive: true });
      await writeFile(join(root, ".claude", "agents", "a2.md"), `---\n${goodFm("behaviors:\n  - gate")}\n---\n${BODY}`);
    }],
    ["스펙 주석 뒤 실제 내용", async () => {
      await writeAgentRaw(goodFm("behaviors:\n  - hc2"));
      await writeSpecRaw("hc2", "---\nname: hc2\ndescription: 정상\n---\n## Intent\n<!-- 참고 -->실제 의도\n## Failure modes\n실패\n");
    }],
    ["정의 블록 스칼라 안 key-like 줄", async () => {
      await writeFile(join(root, ".claude", "agents", "a1.md"),
        `---\nname: a1\ndescription: t\nnotes: |\n  behaviors: 이건 본문이다\n  name: 이것도 본문\nbehaviors:\n  - gate\n---\n${BODY}`);
      await writeSpecRaw("gate", goodSpec("gate"));
    }],
    ["스펙 블록 스칼라 안 key-like 줄", async () => {
      await writeAgentRaw(goodFm("behaviors:\n  - bs"));
      await writeSpecRaw("bs", "---\nname: bs\nnotes: >\n  name: 본문이다\ndescription: 정상\n---\n## Intent\n의도.\n## Failure modes\n실패.\n");
    }],
    ["TOML 에이전트의 behaviors 참조(미지원·명시 보고)", async () => {
      await writeAgentRaw(goodFm());
      await mkdir(join(root, ".codex", "agents"), { recursive: true });
      await writeFile(join(root, ".codex", "agents", "t1.toml"),
        'name = "t1"\ndescription = "toml 에이전트"\nbehaviors = ["gate"]\n');
      await writeSpecRaw("gate", goodSpec("gate"));
    }],
    ["정의 블록 안 들여쓴 비항목", async () => {
      await writeAgentRaw(goodFm("behaviors:\n  - gate\n  잘못된 줄"));
      await writeSpecRaw("gate", goodSpec("gate"));
    }],
    ["고아 스펙의 필수 차원 부실", async () => {
      await writeAgentRaw(goodFm());
      await writeSpecRaw("lonely-thin", "---\nname: lonely-thin\ndescription: 고아\n---\n## Intent\n## Failure modes\n");
    }],
    ["고아 스펙이지만 차원 정상", async () => {
      await writeAgentRaw(goodFm());
      await writeSpecRaw("lonely-ok", goodSpec("lonely-ok"));
    }],
    ["스펙 과대(256KB 초과)", async () => {
      await writeAgentRaw(goodFm("behaviors:\n  - big"));
      const pad = Array.from({ length: 9000 }, (_, i) => `padding line padding line ${i}`).join("\n");
      await writeSpecRaw("big", `---\nname: big\ndescription: 과대\n---\n## Intent\n${pad}\n## Failure modes\n실패.\n`);
    }],
  ])("%s — 두 구현이 같은 판정을 낸다", async (_n, setup) => {
    await setup();
    const [cli, ts] = [await cliFails(), await tsFinds()];
    expect(ts, `CLI=${cli ? "결함" : "정상"} / TS=${ts ? "결함" : "정상"} — 판정이 갈렸다`).toBe(cli);
  });

  it("고아 스펙 — 둘 다 **알리되 막지 않는다**(CLI warn ↔ TS low severity)", async () => {
    await writeAgentRaw(goodFm());
    await writeSpecRaw("lonely", goodSpec("lonely"));
    expect(await cliFails(), "CLI 가 고아로 차단했다").toBe(false);
    expect(await tsFinds(), "TS 가 고아를 차단 수준으로 올렸다").toBe(false);
    expect(await tsNotices(), "TS 가 고아를 아예 알리지 않았다").toBe(true);
  });

  it("수평선으로 차원을 위장해도 **양쪽 다 안 속는다**", async () => {
    await writeAgentRaw(goodFm("behaviors:\n  - hr"));
    await writeSpecRaw("hr", "---\nname: hr\ndescription: 위장\n---\n## Intent\n---\n## Failure modes\n---\n");
    expect(await cliFails(), "CLI 가 수평선 위장을 통과시켰다").toBe(true);
    const { evaluateArtifacts } = await import("../src/server/adapters/artifacteval.js");
    const r = await evaluateArtifacts(root);
    const a = r.artifacts.find((x) => x.name === "a1")!;
    expect(a.findings.some((f) => f.why.includes("참조 BEHAVIOR 부실")), "채점기가 수평선 위장을 놓쳤다").toBe(true);
  });

  it("여러 줄 주석으로 차원을 위장해도 **양쪽 다 안 속는다** — CLI 는 fail, TS 채점은 thin 으로 잡는다", async () => {
    await writeAgentRaw(goodFm("behaviors:\n  - hc"));
    await writeSpecRaw("hc", "---\nname: hc\ndescription: 위장\n---\n## Intent\n\n<!--\n## Failure modes\n가짜\n-->\n");
    // CLI: 차원 누락으로 fail.
    expect(await cliFails(), "CLI 가 주석 위장을 통과시켰다").toBe(true);
    // TS 진단(scorecard)은 **참조 해석**만 본다 — 차원 충실도는 채점(scoreStructure) 소관이라
    // 여기서 finding 을 내지 않는 것이 맞다(같은 사실에 두 번 감점 금지·R31).
    expect(await tsFinds()).toBe(false);
    // 그러나 **채점기는 반드시 잡아야 한다** — 그래야 위장이 어디서도 통하지 않는다.
    const { evaluateArtifacts } = await import("../src/server/adapters/artifacteval.js");
    const r = await evaluateArtifacts(root);
    const a = r.artifacts.find((x) => x.name === "a1")!;
    expect(a.findings.some((f) => f.why.includes("참조 BEHAVIOR 부실")), "채점기가 주석 위장을 놓쳤다").toBe(true);
  });

  it("내용 충실도(thin BEHAVIOR)는 **둘 다 참조를 해석한다** — 채점(scoreStructure) 소관이라 여기선 안 본다", async () => {
    await writeAgentRaw(goodFm("behaviors:\n  - thin"));
    await writeSpecRaw("thin", "---\nname: thin\ndescription: 얇음\n---\n## Intent\n## Failure modes\n");
    // CLI 는 thin 을 fail 로 보고하지만 참조 자체는 유효로 본다(VALID 에 남는다).
    // TS 는 dead_link 를 내지 않아야 한다 — 참조는 해석되기 때문이다.
    expect(await tsFinds()).toBe(false);
  });
});
