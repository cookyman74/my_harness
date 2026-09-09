// M-A A2/A3/A4(T2/T3/T5) — computeConfigHash 결정성 · 분류(raw 불변) · 스냅샷/waiver.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeConfigHash, computeHarnessScorecard, canonicalFindingId,
} from "../src/server/adapters/scorecard.js";
import { writeHarnessScorecardSnapshot } from "../src/server/adapters/scorecard-snapshot.js";

describe("T2 computeConfigHash — 결정성", () => {
  const a = { path: "a", content: "x" }, b = { path: "b", content: "y" };
  it("동일 내용 = 동일 해시", () => {
    expect(computeConfigHash([a, b])).toBe(computeConfigHash([a, b]));
  });
  it("파일 순서 무관(정렬)", () => {
    expect(computeConfigHash([a, b])).toBe(computeConfigHash([b, a]));
  });
  it("1바이트 변경 = 해시 변경", () => {
    expect(computeConfigHash([a, b])).not.toBe(computeConfigHash([a, { path: "b", content: "z" }]));
  });
});

describe("canonicalFindingId — target 옵셔널 세그먼트 규칙", () => {
  it("target 없으면 세그먼트 생략", () => {
    expect(canonicalFindingId({ type: "orphan", runtime: "claude", subject_kind: "agent", subject: "a" } as any))
      .toBe("orphan:claude:agent:a");
  });
  it("target 있으면 추가", () => {
    expect(canonicalFindingId({ type: "dead_link", runtime: "claude", subject_kind: "agent", subject: "a", target: "x" } as any))
      .toBe("dead_link:claude:agent:a:x");
  });
});

async function fixture(agents: Record<string, string>, skills: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "hui-sc-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
  for (const [name, body] of Object.entries(agents))
    await writeFile(join(root, ".claude", "agents", name + ".md"), body);
  for (const [name, body] of Object.entries(skills)) {
    await mkdir(join(root, ".claude", "skills", name), { recursive: true });
    await writeFile(join(root, ".claude", "skills", name, "SKILL.md"), body);
  }
  return root;
}
const fm = (o: Record<string, string>) => "---\n" + Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n---\n본문";

describe("T3 분류 — raw 불변·상호배타", () => {
  let root: string;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("skills 미선언 에이전트 = link_unknown(고아 아님·감점 아님)", async () => {
    root = await fixture({ solo: fm({ name: "solo", description: "x" }) }, {});
    const sc = await computeHarnessScorecard(root);
    const f = sc.findings.find((x) => x.subject === "solo")!;
    expect(f.type).toBe("link_unknown");
    // 전수 고아 오탐 0(현 A35 버그 해소)
    expect(sc.findings.filter((x) => x.type === "orphan" && x.subject_kind === "agent").length).toBe(0);
  });

  it("skills:[] 명시 빈배열 = orphan(agent)", async () => {
    root = await fixture({ empty: fm({ name: "empty", skills: "[]" }) }, {});
    const f = (await computeHarnessScorecard(root)).findings.find((x) => x.subject === "empty")!;
    expect(f.type).toBe("orphan");
    expect(f.subject_kind).toBe("agent");
  });

  it("선언 스킬이 디스크 부재 = dead_link(target=스킬)", async () => {
    root = await fixture({ a: fm({ name: "a", skills: "[ghost]" }) }, {});
    const f = (await computeHarnessScorecard(root)).findings.find((x) => x.type === "dead_link")!;
    expect(f.subject).toBe("a"); expect(f.target).toBe("ghost");
  });

  it("아무 에이전트도 선언 안 한 스킬 = orphan(skill) 확정 — 레거시(link_unknown) 에이전트 있어도 유지", async () => {
    root = await fixture(
      { legacy: fm({ name: "legacy", description: "미선언" }) },  // link_unknown 유발
      { lonely: fm({ name: "lonely", description: "s" }) },
    );
    const sc = await computeHarnessScorecard(root);
    expect(sc.findings.some((x) => x.type === "orphan" && x.subject === "lonely")).toBe(true); // 은폐 안 됨(C1)
  });

  it("오케스트레이터 orchestrates 배정 = coverage_gap 아님 / 미배정 = coverage_gap", async () => {
    root = await fixture(
      { worker: fm({ name: "worker", skills: "[s1]" }), idle: fm({ name: "idle", skills: "[s1]" }) },
      {
        s1: fm({ name: "s1", description: "s" }),
        orch: fm({ name: "orch", description: "오케스트레이터", orchestrates: "[worker]" }),
      },
    );
    const sc = await computeHarnessScorecard(root);
    expect(sc.findings.some((x) => x.type === "coverage_gap" && x.subject === "worker")).toBe(false);
    expect(sc.findings.some((x) => x.type === "coverage_gap" && x.subject === "idle")).toBe(true);
  });
});

describe("T5 스냅샷·waiver", () => {
  let root: string;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("writeHarnessScorecardSnapshot: generated_at 스탬프 + JSON + summary append", async () => {
    root = await fixture({ solo: fm({ name: "solo", description: "x" }) }, {});
    const sc = await computeHarnessScorecard(root);
    expect(sc.generated_at).toBeNull(); // compute 는 결정적(스탬프 없음)
    await writeHarnessScorecardSnapshot(sc, root, "2026-07-11T00:00:00Z");
    const written = JSON.parse(await readFile(join(root, "_workspace", "evals", "harness_scorecard.json"), "utf8"));
    expect(written.generated_at).toBe("2026-07-11T00:00:00Z");
    expect(written.config_hash).toBe(sc.config_hash);
    const summary = await readFile(join(root, "_workspace", "evals", "harness_summary.jsonl"), "utf8");
    expect(summary.trim().split("\n").length).toBe(1);
  });

  it("waiver edge 단위 억제(동일 subject 다중 dead_link 중 하나만)", async () => {
    root = await fixture({ a: fm({ name: "a", skills: "[ghost1, ghost2]" }) }, {});
    let sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    const dead = sc.findings.filter((x) => x.type === "dead_link");
    expect(dead.length).toBe(2);
    const waiveId = canonicalFindingId(dead.find((x) => x.target === "ghost1")!);
    await mkdir(join(root, "_workspace", "evals"), { recursive: true });
    await writeFile(join(root, "_workspace", "evals", "waivers.json"),
      JSON.stringify([{ finding_id: waiveId, reason: "wip", expires_at: "2026-12-31" }]));
    sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    expect(sc.findings.find((x) => x.target === "ghost1")!.waived).toBe(true);
    expect(sc.findings.find((x) => x.target === "ghost2")!.waived).toBe(false); // 하나만 억제
  });

  it("만료 waiver = 재부상(waived:false)", async () => {
    root = await fixture({ a: fm({ name: "a", skills: "[ghost1]" }) }, {});
    let sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    const id = canonicalFindingId(sc.findings.find((x) => x.type === "dead_link")!);
    await mkdir(join(root, "_workspace", "evals"), { recursive: true });
    await writeFile(join(root, "_workspace", "evals", "waivers.json"),
      JSON.stringify([{ finding_id: id, reason: "old", expires_at: "2026-01-01" }]));
    sc = await computeHarnessScorecard(root, { now: "2026-07-11" });
    expect(sc.findings.find((x) => x.type === "dead_link")!.waived).toBe(false);
  });
});
